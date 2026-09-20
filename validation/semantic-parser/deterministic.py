#!/usr/bin/env python3
"""Deterministic financial evidence layer.

Two separate jobs, deliberately kept apart:

1. :func:`extract_amounts` / :func:`select_amount_role` -- exact amount and
   currency extraction and the amount-role safety concept carried over from the
   existing Wafra parser.  Never probabilistic; abstains when ambiguous.

2. :class:`EvidenceRules` -- an auditable, finite marker list used only as a
   **veto and corroboration** signal for the semantic model.  Handoff items 7
   and 8 showed a hand-written lexicon is far too thin to be the primary
   semantic engine, so this layer never classifies on its own.  Markers are
   mined from the MSA+PAL *training* split, precision-filtered on training, and
   then re-checked on the MSA+PAL *validation* split; a marker that does not
   hold up on validation is dropped.  No dialect test data is ever used.
"""

from __future__ import annotations

import functools
import json
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path

# --------------------------------------------------------------------------
# Exact amount / currency extraction (deterministic, preserved from Wafra)
# --------------------------------------------------------------------------

CURRENCY_EXPONENTS = {
    "BHD": 3, "JOD": 3, "KWD": 3, "OMR": 3, "TND": 3, "LYD": 3, "IQD": 3,
    "JPY": 0, "KRW": 0,
}
DEFAULT_EXPONENT = 2

# ISO 4217 codes seen across Wafra's review markets.  A bare three-letter token
# only counts as a currency when it is on this list, so "FOR"/"REF"/"OTP" can
# never be read as money.
ISO_CURRENCIES = frozenset(
    """AED SAR QAR KWD BHD OMR JOD EGP ILS LBP IQD SYP YER TND MAD DZD LYD SDG
    USD EUR GBP CHF CAD AUD NZD JPY CNY HKD SGD MYR IDR THB PHP VND KRW
    INR PKR BDT LKR NPR TRY RUB UAH PLN CZK HUF RON SEK NOK DKK ISK
    ZAR NGN KES UGX TZS GHS MUR MAD BRL MXN ARS CLP COP PEN""".split()
)

# Arabic decimal and thousands separators, folded 1:1 so match offsets in the
# folded string still line up with the original body.
_DIGIT_FOLD = {
    **{0x0660 + i: chr(0x30 + i) for i in range(10)},
    **{0x06F0 + i: chr(0x30 + i) for i in range(10)},
    0x066B: ".",
    0x066C: ",",
    0x02D9: ".",
}


def fold_numerals(text: str) -> str:
    """Arabic-Indic digits and separators -> ASCII, preserving string length."""
    return text.translate(_DIGIT_FOLD)


CURRENCY_ALIASES = {
    "د.أ": "JOD", "AED": "AED", "DHS": "AED", "DH": "AED", "درهم": "AED", "د.إ": "AED",
    "SAR": "SAR", "SR": "SAR", "ريال": "SAR", "ر.س": "SAR",
    "USD": "USD", "$": "USD", "دولار": "USD",
    "EUR": "EUR", "€": "EUR", "يورو": "EUR",
    "GBP": "GBP", "£": "GBP",
    "KWD": "KWD", "د.ك": "KWD", "BHD": "BHD", "د.ب": "BHD",
    "OMR": "OMR", "ر.ع": "OMR", "QAR": "QAR", "ر.ق": "QAR",
    "JOD": "JOD", "د.ا": "JOD", "EGP": "EGP", "ج.م": "EGP",
    "ILS": "ILS", "شيكل": "ILS", "TND": "TND", "MAD": "MAD", "درهم مغربي": "MAD",
}

# Arabic currency words that appear next to the number in real alerts.
ARABIC_CURRENCY_WORDS = {
    "درهم": "AED", "درهما": "AED", "دراهم": "AED",
    "ريال": "SAR", "ريالا": "SAR", "ريالات": "SAR",
    "دولار": "USD", "دولارا": "USD", "دولارات": "USD",
    "يورو": "EUR", "جنيه": "EGP", "شيكل": "ILS", "شيقل": "ILS",
    "دينار": "JOD", "دينارا": "JOD",
}

_AMOUNT_RE = re.compile(
    r"(?P<pre>[A-Z]{3}|[$€£]|د\.[أإاكبمق]|ر\.[سعق]|ج\.م|[ء-ي]{3,8})?\s*"
    r"(?P<num>\d{1,3}(?:[.,\u00a0\u202f ]\d{3})+(?:[.,]\d{1,3})?|\d+(?:[.,]\d{1,3})?)\s*"
    r"(?P<post>[A-Z]{3}|[$€£]|د\.[أإاكبمق]|ر\.[سعق]|ج\.م|[ء-ي]{3,8})?",
)

# Wording that says what an amount *is*.  Used only to label amount roles; an
# amount whose role cannot be established deterministically is never selected
# as the transaction amount.
AMOUNT_ROLE_MARKERS: dict[str, tuple[str, ...]] = {
    "balance": (
        "available balance", "avail bal", "avl bal", "current balance", "balance",
        "الرصيد المتاح", "الرصيد", "رصيد", "المتاح",
    ),
    "limit": (
        "credit limit", "available limit", "card limit", "limit",
        "حد الائتمان", "الحد الائتماني", "الحد المتاح", "سقف",
    ),
    "minimum-due": (
        "minimum due", "min due", "minimum payment", "min amt due",
        "الحد الادنى", "الحد الأدنى", "أقل مبلغ مستحق",
    ),
    "statement-total": (
        "statement balance", "total due", "total amount due", "amount due", "statement",
        "المبلغ المستحق", "كشف الحساب", "إجمالي المستحق",
    ),
    "fee": (
        "fee", "fees", "charge of", "service charge", "commission",
        "رسوم", "رسم", "عمولة",
    ),
    "transaction": (
        "purchase of", "purchase", "payment of", "paid", "withdrawal of", "withdrawn",
        "withdrawal", "transfer of", "transferred", "debited with", "debited",
        "credited with", "credited", "spent", "charged with", "charged", "amount of",
        "شراء", "سحب", "تحويل", "دفع", "خصم", "إيداع", "ايداع", "بمبلغ", "مبلغ",
    ),
}

# Tokens that mark the following digits as an identifier, not money.
_IDENTIFIER_LEFT = (
    "acct", "account", "a/c", "card", "ending", "ref", "reference", "no.", "no ",
    "number", "trx", "txn", "iban", "otp", "code", "pin", "auth",
    "حساب", "بطاقة", "البطاقة", "رقم", "مرجع", "المنتهية", "رمز",
)

# Digit runs that belong to an identifier, not to money.  They are masked to
# "#" before amount matching -- same length, so every offset stays valid.
_MASKED_TOKEN = re.compile(r"\b[A-Za-z*\u00b7\u2022]*[Xx\u00b7\u2022]{2,}[-\u2011]?\d+\b|\b\d+[Xx\u00b7\u2022]{2,}[A-Za-z]*\b")
_LABELLED_ID = re.compile(
    r"(?:acct|account|a/c|card|ending|ends?\s+with|ref|reference|txn|trx|iban|otp|pin|"
    r"code|no\.?|number|\u0631\u0642\u0645|\u062d\u0633\u0627\u0628|\u0628\u0637\u0627\u0642\u0629|\u0627\u0644\u0628\u0637\u0627\u0642\u0629|\u0645\u0631\u062c\u0639|\u0631\u0645\u0632)"
    r"[\s:#*\u00b7]{0,4}(\d{2,})",
    re.IGNORECASE,
)


def mask_identifiers(text: str) -> str:
    """Blank out digits that belong to card/account/reference tokens.

    Length preserving, so match offsets computed on the masked string still
    address the original body.
    """
    chars = list(text)

    def blank(lo: int, hi: int) -> None:
        for i in range(lo, hi):
            if chars[i].isdigit():
                chars[i] = "#"

    for match in _MASKED_TOKEN.finditer(text):
        blank(match.start(), match.end())
    for match in _LABELLED_ID.finditer(text):
        blank(match.start(1), match.end(1))
    return "".join(chars)


_CLAUSE_SPLIT = re.compile(r"[.،,;|\n\r؛]|\s-\s")


@dataclass(frozen=True)
class AmountCandidate:
    raw: str
    minor_units: int
    currency: str | None
    start: int
    end: int
    roles: tuple[str, ...]
    clause: str

    def as_dict(self) -> dict:
        return {
            "raw": self.raw,
            "minor_units": self.minor_units,
            "currency": self.currency,
            "roles": list(self.roles),
        }


_HAMZA_FOLD = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ى": "ي", "ة": "ه"})


def _fold_hamza(token: str) -> str:
    return token.translate(_HAMZA_FOLD)


def _resolve_currency(pre: str | None, post: str | None) -> str | None:
    """Currency from the token adjacent to the number, Latin code or Arabic word."""
    for token in (pre, post):
        if not token:
            continue
        token = token.strip()
        upper = token.upper()
        hit = (
            CURRENCY_ALIASES.get(upper)
            or CURRENCY_ALIASES.get(token)
            or CURRENCY_ALIASES.get(_fold_hamza(token))
            or ARABIC_CURRENCY_WORDS.get(token)
            or ARABIC_CURRENCY_WORDS.get(_fold_hamza(token))
            or ARABIC_CURRENCY_WORDS.get(token.removeprefix("ال"))
        )
        if hit:
            return hit
        if token == upper and upper in ISO_CURRENCIES:
            return upper
    return None


def parse_money(raw: str, currency: str | None) -> Decimal | None:
    """Parse a written number into a Decimal, or abstain.

    Bank alerts mix US grouping (``14,671.30``), European grouping
    (``1.240,60``), bare decimals (``32,70``) and three-decimal Gulf currencies
    (``12.345`` KWD).  Getting this wrong silently writes the wrong number into
    someone's ledger, so genuinely ambiguous forms return ``None`` and the
    caller abstains rather than guessing.
    """
    raw = raw.strip()
    # A space, NBSP or narrow NBSP between three-digit groups is a thousands
    # separator (fr-FR, ru-RU and others write "1 240,60").
    raw = re.sub(r"(?<=\d)[\u00a0\u202f ](?=\d{3})", "", raw).replace(" ", "")
    if not raw or not raw[0].isdigit():
        return None
    exponent = CURRENCY_EXPONENTS.get(currency or "", DEFAULT_EXPONENT)

    def _grouped(parts: list[str]) -> bool:
        return (
            1 <= len(parts[0]) <= 3
            and all(len(p) == 3 for p in parts[1:])
        )

    def _decimal(int_part: str, frac: str) -> Decimal | None:
        if len(frac) > exponent:
            return None  # more precision than the currency has -> not a plain amount
        return Decimal(f"{int_part}.{frac}")

    dots, commas = raw.count("."), raw.count(",")

    if dots and commas:
        # The rightmost separator is the decimal point; the other groups.
        if raw.rfind(".") > raw.rfind(","):
            decimal_sep, group_sep = ".", ","
        else:
            decimal_sep, group_sep = ",", "."
        int_part, _, frac = raw.rpartition(decimal_sep)
        if group_sep in frac or not frac.isdigit():
            return None
        parts = int_part.split(group_sep)
        if not all(p.isdigit() for p in parts) or not _grouped(parts):
            return None
        return _decimal("".join(parts), frac)

    sep = "." if dots else ("," if commas else "")
    if not sep:
        return Decimal(raw) if raw.isdigit() else None

    parts = raw.split(sep)
    if not all(p.isdigit() for p in parts):
        return None

    if len(parts) > 2:
        # Repeated separator can only be grouping.
        return Decimal("".join(parts)) if _grouped(parts) else None

    head, tail = parts
    if len(tail) != 3:
        return _decimal(head, tail)

    # Exactly three digits after a single separator: grouping or a
    # three-decimal currency.  Only one reading can be right.
    if exponent == 3:
        if sep == ".":
            return _decimal(head, tail)
        # "KWD 1,500" is 1500 dinars or 1.500 dinars depending on the bank's
        # formatting.  Nothing in the text decides it, so abstain.
        return None
    return Decimal(head + tail) if _grouped(parts) else None


def _to_minor(num: str, currency: str | None) -> int | None:
    value = parse_money(num, currency)
    if value is None:
        return None
    exponent = CURRENCY_EXPONENTS.get(currency or "", DEFAULT_EXPONENT)
    scaled = value.scaleb(exponent)
    if scaled != scaled.to_integral_value():
        return None
    return int(scaled)


def _clause_spans(text: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    cursor = 0
    for match in _CLAUSE_SPLIT.finditer(text):
        # A period between digits is a decimal point, not a clause break.
        if match.group(0) == "." and 0 < match.start() and match.end() < len(text):
            before, after = text[match.start() - 1], text[match.end()]
            # decimal point, or an abbreviation dot such as "د.أ" / "ر.س"
            if (before.isdigit() and after.isdigit()) or (before.isalpha() and after.isalpha()):
                continue
        if match.start() > cursor:
            spans.append((cursor, match.start()))
        cursor = match.end()
    if cursor < len(text):
        spans.append((cursor, len(text)))
    return spans or [(0, len(text))]


def _clause_for(spans: list[tuple[int, int]], pos: int) -> tuple[int, int]:
    for lo, hi in spans:
        if lo <= pos < hi:
            return lo, hi
    return spans[-1]


def _roles_for(text: str, lower: str, span: tuple[int, int], start: int, end: int) -> tuple[str, ...]:
    """Role of an amount = nearest role marker inside its own clause.

    Clause-scoped and nearest-wins, because "Purchase AED 250. Available
    balance AED 12,300" must not mark the purchase as a balance.  A marker that
    precedes the amount beats an equally distant one that follows it.
    """
    lo, hi = span
    best: tuple[float, int, str] | None = None
    for role, words in AMOUNT_ROLE_MARKERS.items():
        for word in words:
            offset = lower.find(word, lo, hi)
            while offset != -1:
                mid = offset + len(word) / 2
                if offset < start:
                    distance = start - (offset + len(word))
                    side = 0  # preceding marker wins ties
                else:
                    distance = offset - end
                    side = 1
                distance = max(distance, 0.0)
                key = (distance, side, role)
                if best is None or key < best:
                    best = key
                offset = lower.find(word, offset + 1, hi)
    return (best[2],) if best else ()


def _looks_like_identifier(lower: str, start: int) -> bool:
    """True when the digits are an account/card/reference, not money.

    Only the token immediately before the digits counts.  A wider window turns
    "card purchase GBP 47.90" into an identifier because the word *card*
    appears somewhere to the left, which silently drops real amounts.
    """
    left = lower[max(0, start - 24) : start].rstrip()
    if not left:
        return False
    trailing = left.split()[-1] if left.split() else ""
    trailing = trailing.strip("*#:.,-")
    return any(trailing == tok.strip() or trailing.endswith(tok.strip()) for tok in _IDENTIFIER_LEFT)


def extract_amounts(text: str) -> list[AmountCandidate]:
    """Exact, deterministic amount extraction.  Never guesses.

    A run of digits only becomes a money candidate when it carries a currency
    token or a decimal fraction, and is not immediately preceded by wording
    that marks it as an account, card, reference, or one-time code.
    """
    text = fold_numerals(text)
    scan = mask_identifiers(text)
    lower = text.lower()
    spans = _clause_spans(text)
    out: list[AmountCandidate] = []
    for match in _AMOUNT_RE.finditer(scan):
        num = match.group("num")
        start, end = match.start("num"), match.end("num")
        currency = _resolve_currency(match.group("pre"), match.group("post"))
        if currency is None:
            # Without a currency token a bare integer is far more likely to be
            # a card fragment, a reference or a date than money.
            if not any(ch in num for ch in ".,"):
                continue
            if " " in num or "\u00a0" in num or "\u202f" in num:
                continue  # space grouping is only trustworthy next to a currency
            if _looks_like_identifier(lower, start):
                continue
        minor = _to_minor(num, currency)
        if minor is None:
            continue
        span = _clause_for(spans, start)
        out.append(
            AmountCandidate(
                raw=match.group(0).strip(),
                minor_units=minor,
                currency=currency,
                start=start,
                end=end,
                roles=_roles_for(text, lower, span, start, end),
                clause=text[span[0] : span[1]].strip(),
            )
        )
    return out


# Which amount roles legitimately *are* the transaction amount, given the
# family the semantic layer proposed.  A fee alert's fee is the transaction; a
# purchase alert's fee line is not.  Everything absent from this table is a
# decoy for that family.
TRANSACTION_ROLES_BY_FAMILY: dict[str, frozenset[str]] = {
    "fee": frozenset({"transaction", "fee"}),
    "statement": frozenset({"transaction", "statement-total"}),
    "balance": frozenset({"transaction", "balance"}),
}
DEFAULT_TRANSACTION_ROLES = frozenset({"transaction"})


def select_amount_role(
    candidates: list[AmountCandidate], family: str | None = None
) -> tuple[int | None, str]:
    """Pick the transaction amount, or abstain.

    Returns ``(index_or_None, reason)``.  ``family`` is the family the semantic
    layer proposed; it only ever *narrows* what may be selected, and passing
    nothing keeps the strictest reading.  The safety rule is that an amount is
    selected only when exactly one candidate carries a role that counts as the
    transaction for that family, or when the message holds a single money value
    and no decoy role anywhere.
    """
    if not candidates:
        return None, "no-amount"

    currencies = {c.currency for c in candidates if c.currency}
    if len(currencies) > 1:
        # An FX alert quotes both the billed and the settled amount.  Nothing
        # in the body says which one the ledger uses, so never pick one.
        return None, "multi-currency-ambiguous"

    accepted = TRANSACTION_ROLES_BY_FAMILY.get(family or "", DEFAULT_TRANSACTION_ROLES)
    transactional = [i for i, c in enumerate(candidates) if accepted & set(c.roles)]
    decoyed = [i for i, c in enumerate(candidates) if c.roles and not (accepted & set(c.roles))]

    if len(transactional) == 1:
        return transactional[0], "unique-transaction-role"
    if len(transactional) > 1:
        values = {candidates[i].minor_units for i in transactional}
        if len(values) == 1:
            return transactional[0], "repeated-transaction-amount"
        return None, "multiple-transaction-roles"
    if len(candidates) == 1 and not decoyed:
        # Exactly one money value in the whole message and nothing anywhere in
        # it reads as a balance / limit / statement / minimum-due decoy.  There
        # is no other number it could be confused with.
        return 0, "sole-candidate-no-decoys"
    if decoyed:
        return None, "only-decoy-roles"
    return None, "no-transaction-role"


# --------------------------------------------------------------------------
# Auditable marker evidence (veto / corroboration only)
# --------------------------------------------------------------------------

_WORD_RE = re.compile(r"[^\W\d_]+", re.UNICODE)

# Hand-authored core.  Small on purpose: these are the markers a human reviewer
# can defend line by line.  Everything else is mined and precision-gated.
CORE_MARKERS: dict[str, dict[str, tuple[str, ...]]] = {
    "state": {
        "failed": (
            "declined", "failed", "rejected", "unsuccessful",
            "مرفوض", "مرفوضة", "رفض", "فشل", "فشلت", "لم تتم", "ما تمت", "ماتمت",
            "لم ينجح", "تعذر", "ما نجح", "طلع رفض",
        ),
        "future": (
            "pending", "on hold", "awaiting", "not yet posted",
            "معلق", "معلقة", "معلقه", "قيد التنفيذ", "قيد المعالجة", "لسه", "لسا",
            "بانتظار", "في الانتظار", "ما زالت", "مازالت",
        ),
        "informational": (
            "how do i", "how can i", "can i", "what is", "is it possible",
            "كيف", "كيفاش", "هل", "شو", "ايش", "إيش", "وش", "شنو", "متى", "امتى",
            "ليش", "علاش", "لماذا", "قداش", "كم", "ممكن", "بدي اعرف", "ابغى اعرف",
        ),
    },
    "family": {
        "cash-withdrawal": ("atm", "cash withdrawal", "صراف", "سحب نقدي", "السحب", "كاش"),
        "transfer": ("transfer", "تحويل", "حوالة", "حواله", "أحول", "احول"),
        "purchase": ("card payment", "purchase", "دفع بالبطاقة", "شراء", "مشترياتي"),
        "refund": ("refund", "استرداد", "استرجاع", "ارجاع", "إرجاع"),
        "fee": ("fee", "charge", "commission", "رسوم", "رسم", "عمولة"),
        "balance": ("balance", "رصيد", "الرصيد"),
        "authentication": ("verify", "identity", "otp", "passcode", "تحقق", "هويتي", "رمز"),
    },
}


def tokenize(text: str) -> list[str]:
    return _WORD_RE.findall(text.lower())


@functools.lru_cache(maxsize=65536)
def _candidate_features(text: str) -> frozenset[str]:
    words = tokenize(text)
    feats: set[str] = set(words)
    feats.update(f"{a} {b}" for a, b in zip(words, words[1:]))
    # Arabic clitics mean surface words differ across dialects; short in-word
    # character n-grams recover a lot of that without becoming a model.
    for word in words:
        if len(word) >= 5:
            for size in (4, 5):
                for i in range(len(word) - size + 1):
                    feats.add(f"~{word[i : i + size]}")
    return frozenset(feats)


@dataclass
class EvidenceRules:
    """Frozen marker list plus the audit numbers that justified each marker."""

    axis: str
    markers: dict[str, list[str]] = field(default_factory=dict)
    audit: dict = field(default_factory=dict)

    # -- mining -------------------------------------------------------------
    @classmethod
    def mine(
        cls,
        axis: str,
        train_rows,
        val_rows,
        *,
        min_support: int = 25,
        min_precision: float = 0.97,
        min_val_precision: float = 0.95,
        min_val_support: int = 3,
        max_per_class: int = 400,
    ) -> "EvidenceRules":
        getter = (lambda r: getattr(r, axis))
        support: dict[str, Counter] = defaultdict(Counter)
        totals: Counter = Counter()
        for row in train_rows:
            label = getter(row)
            for feat in _candidate_features(row.text):
                support[feat][label] += 1
                totals[feat] += 1

        kept: dict[str, list[tuple[str, float, int]]] = defaultdict(list)
        for feat, total in totals.items():
            if total < min_support:
                continue
            label, hits = support[feat].most_common(1)[0]
            precision = hits / total
            if precision >= min_precision:
                kept[label].append((feat, precision, total))

        # Re-check on validation; drop anything that does not survive.
        val_support: dict[str, Counter] = defaultdict(Counter)
        val_totals: Counter = Counter()
        for row in val_rows:
            label = getter(row)
            for feat in _candidate_features(row.text):
                val_support[feat][label] += 1
                val_totals[feat] += 1

        markers: dict[str, list[str]] = {}
        audit: dict = {"axis": axis, "per_class": {}, "thresholds": {
            "min_support": min_support,
            "min_precision": min_precision,
            "min_val_precision": min_val_precision,
            "min_val_support": min_val_support,
            "max_per_class": max_per_class,
        }}
        for label, feats in kept.items():
            survivors = []
            for feat, precision, total in sorted(feats, key=lambda x: (-x[1], -x[2])):
                vt = val_totals.get(feat, 0)
                if vt < min_val_support:
                    continue
                vp = val_support[feat][label] / vt
                if vp < min_val_precision:
                    continue
                survivors.append((feat, precision, total, vp, vt))
                if len(survivors) >= max_per_class:
                    break
            if survivors:
                markers[label] = [f for f, *_ in survivors]
                audit["per_class"][label] = {
                    "kept": len(survivors),
                    "candidates": len(feats),
                    "examples": [
                        {"marker": f, "train_precision": p, "train_support": t,
                         "val_precision": vp, "val_support": vt}
                        for f, p, t, vp, vt in survivors[:8]
                    ],
                }
        return cls(axis=axis, markers=markers, audit=audit)

    # -- use ---------------------------------------------------------------
    def evidence(self, text: str) -> dict[str, list[str]]:
        feats = _candidate_features(text)
        hits: dict[str, list[str]] = {}
        core = CORE_MARKERS.get(self.axis, {})
        lowered = text.lower()
        for label, words in core.items():
            found = [w for w in words if w in lowered]
            if found:
                hits.setdefault(label, []).extend(f"core:{w}" for w in found[:4])
        for label, markers in self.markers.items():
            found = [m for m in markers if m in feats]
            if found:
                hits.setdefault(label, []).extend(f"mined:{m}" for m in found[:4])
        return hits

    def vote(self, text: str) -> tuple[str | None, int]:
        """Strongest marker class and its hit count, or ``(None, 0)``."""
        hits = self.evidence(text)
        if not hits:
            return None, 0
        label = max(hits, key=lambda k: len(hits[k]))
        return label, len(hits[label])

    def to_json(self) -> dict:
        return {"axis": self.axis, "markers": self.markers, "audit": self.audit}

    @classmethod
    def from_json(cls, payload: dict) -> "EvidenceRules":
        return cls(axis=payload["axis"], markers=payload["markers"], audit=payload.get("audit", {}))

    def marker_count(self) -> int:
        return sum(len(v) for v in self.markers.values())


def save_rules(rules: dict[str, EvidenceRules], path: Path) -> None:
    path.write_text(
        json.dumps({axis: r.to_json() for axis, r in rules.items()}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def load_rules(path: Path) -> dict[str, EvidenceRules]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {axis: EvidenceRules.from_json(body) for axis, body in payload.items()}
