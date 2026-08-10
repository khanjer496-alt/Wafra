/**
 * What leaves this phone when a user reports a bug — and, at much greater
 * length, what does not.
 *
 * THE CONSTRAINT THIS FILE EXISTS UNDER. The product's central claim is that
 * the ledger stays on the device: Private Mode is local-only, the relay throws
 * message text away after parsing, and Settings says so in as many words. A
 * feedback feature that quietly posted someone's bank transactions to an
 * inbox would not be a small inconsistency, it would falsify the one sentence
 * everything else on the privacy screen rests on. So this module is written to
 * be readable by a sceptic:
 *
 *  1. It builds a payload. It does not send one — see `submitFeedback`, which
 *     is a stub with no network in it at all.
 *  2. `formatFeedbackPayload` renders the WHOLE payload as text, and that same
 *     text is what the screen puts in front of the user before they tap Send.
 *     Not a summary of it, not a description of it: the artifact itself.
 *  3. Redaction happens to the LEDGER, before any report is generated from it.
 *     `cardDiagnostics()` never sees a real merchant name, so it cannot print
 *     one. That is a much stronger property than scrubbing its prose
 *     afterwards, and it is the property the tests pin.
 *
 * WHAT A DEBUGGING AGENT ACTUALLY NEEDS, versus what is merely lying around.
 * The two bug classes this app produces are not served by the same data, and
 * conflating them is what turns "attach diagnostics" into "upload everything":
 *
 *  • A PARSER bug — an entry read wrong, a merchant unrecognised, a format
 *    skipped — is about the SHAPE of a bank message. Which words are in which
 *    order, where the labels fall, which separators the bank used. The amount
 *    is noise; a message with every digit replaced by `#` reproduces the bug
 *    exactly as well as the real one, and often better, because it collapses
 *    twelve Carrefour charges into one format.
 *  • A TOTALS bug — a card payment counted twice, a balance in the sum that
 *    should not be, a statement filed against the wrong account — is about
 *    ARITHMETIC. The amounts are the whole evidence and the merchant names are
 *    irrelevant: `cardDiagnostics()` found a real double-count from the
 *    figures and the relationships between accounts, not from anyone's name.
 *
 * So the choice offered is not one all-or-nothing switch. It is three levels,
 * nested so that each is a strict superset of the one before it, which is the
 * only shape a person can hold in their head at the moment of deciding:
 *
 *   none    — your words, the app version, the platform. Nothing else.
 *   shapes  — plus message shapes with every digit blanked, plus counts.
 *   figures — plus the card diagnostic, with its amounts and balances.
 *
 * Names are redacted at EVERY level, including `figures`. There is no level of
 * this feature that sends a merchant name, an account name or a last four.
 *
 * PRIVATE MODE forces `none`, in this function and not only in the screen.
 * Two independent reasons, either of which would be enough: Private Mode's
 * documented meaning is that nothing derived from the user's banking leaves
 * the device, and a feature that quietly made an exception for itself would be
 * the exact betrayal the setting exists to prevent; and separately, store.tsx
 * already deletes every retained `raw`, so `shapes` on such a device would be
 * structurally empty and only look like a choice. The payload records
 * `withheld: 'private-mode'` so the receiving agent reads "this user chose
 * local-only" rather than "this user could not be bothered".
 *
 * Pure. No React, no network, no clock, no platform lookup — the build
 * metadata is passed IN, the same way `noFormatsReason()` in accuracy.ts takes
 * its platform flag, and for the same reason: this module is compiled and
 * exercised in the Node test build, which has no react-native in it.
 */
import { cardDiagnostics, parserCoverage, unreadFormats } from '@/lib/accuracy';
import { categoryLabel } from '@/lib/categories';
import {
  FEEDBACK_DELIVERY,
  type FeedbackDeliveryDisclosure,
} from '@/lib/feedback-wire';
import { STRUCTURAL_TITLES } from '@/lib/sms-parser';
import type { Account, CardDue, CategoryId, Transaction } from '@/lib/types';

/** Bumped when the payload's shape changes, so the receiving end can tell. */
export const FEEDBACK_SCHEMA = 2;

/**
 * How much of the ledger the user chose to attach. Nested: `figures` contains
 * everything `shapes` does, and `shapes` everything `none` does.
 */
export type FeedbackDetail = 'none' | 'shapes' | 'figures';

/** In the order they are offered, safest first. */
export const FEEDBACK_DETAILS: readonly FeedbackDetail[] = ['none', 'shapes', 'figures'];

/**
 * A ceiling on the free-text note.
 *
 * Not a formatting nicety: without one, "paste the messages that went wrong"
 * is an invitation to put an entire SMS inbox through a box that shows six
 * lines at a time, and the user cannot read what they are sending. The screen
 * enforces the same number on the input so the limit is visible while typing
 * rather than discovered afterwards.
 */
export const FEEDBACK_MESSAGE_MAX = 2000;
/** Highest-value unread formats only; the complete count remains in `counts`. */
export const FEEDBACK_SHAPES_MAX = 25;

/** Everything about the build, none of it about the user. */
export interface FeedbackBuild {
  /** `Constants.expoConfig.version`. */
  version: string;
  /** `Platform.OS` — passed in, because this module has no react-native. */
  platform: string;
  /** UI language, which is also the language the report was written in. */
  language: string;
  /** Market pack id, e.g. `ae`. Decides the parser grammar. */
  marketId: string;
  /** The pack's display currency, e.g. `AED`. */
  currency: string;
  /** Local-only posture. Forces `detail` to `none`; see the header. */
  privateMode: boolean;
}

/** The read-only slice of the ledger a report can be built from. */
export interface FeedbackLedger {
  accounts: Account[];
  transactions: Transaction[];
  cardDues: CardDue[];
  merchantOverrides?: Record<string, CategoryId>;
}

export interface FeedbackInput {
  /** The user's own words. Truncated and digit-masked, never otherwise edited. */
  message: string;
  /** What the user asked to attach. Private Mode may override it. */
  detail: FeedbackDetail;
  build: FeedbackBuild;
  ledger: FeedbackLedger;
}

/** One bank-message format the parser could not read, with the digits gone. */
export interface FeedbackShape {
  /** The message with every digit replaced by `#` and known names aliased. */
  shape: string;
  /** What the parser made of it: an alias, or a title it minted itself. */
  title: string;
  /** English category label — the report is read by whoever fixes it. */
  category: string;
  /** How many rows in the ledger share this format. */
  count: number;
  /** `unread` = no merchant found at all; `uncategorized` = named, unfiled. */
  reason: string;
}

/**
 * Counts, and nothing but counts.
 *
 * Safe at `shapes` and above because a count names nobody and spends nothing:
 * "402 rows imported, 391 named" is the single most useful line in a parser
 * report and cannot be worked back to a transaction. Withheld at `none`
 * anyway, so that "message only" means exactly that.
 */
export interface FeedbackCounts {
  accounts: number;
  transactions: number;
  cardDues: number;
  /** Rows the parser itself wrote, from a bank message. */
  imported: number;
  /** Of those, rows there was nothing for the parser to get right. */
  skipped: number;
  /** Purchases where a shop name was expected. */
  measured: number;
  /** Of `measured`, rows the parser named. */
  named: number;
  /** Of `measured`, rows the user had already answered for. */
  decided: number;
  /** Of `measured`, rows whose category the parser was asked for. */
  categoryMeasured: number;
  /** Of `categoryMeasured`, rows filed under something other than `other`. */
  categorised: number;
  /** Distinct unrecognised formats — the length of `shapes`. */
  formats: number;
}

export interface FeedbackPayload {
  schema: number;
  /** The user's words, truncated to the cap and with long digit runs masked. */
  message: string;
  /** What the user asked for. */
  detailRequested: FeedbackDetail;
  /** What is actually attached. Differs from the above only in Private Mode. */
  detail: FeedbackDetail;
  /** Why the two differ, so the receiving agent is not left guessing. */
  withheld: 'private-mode' | null;
  /** Retention and reviewer disclosure shown before the user sends. */
  delivery: FeedbackDeliveryDisclosure;
  build: FeedbackBuild;
  /** Null at `none`. */
  counts: FeedbackCounts | null;
  /** Null at `none`. Empty on a device that keeps no message text. */
  shapes: FeedbackShape[] | null;
  /** `cardDiagnostics()` over the redacted ledger. Null below `figures`. */
  diagnostic: string | null;
}

/* ═══════════════════════════ Redaction ═══════════════════════════════════
 *
 * By VOCABULARY, not by pattern. A regex that tries to recognise "this looks
 * like a shop name" in free bank text is a guess, and a guess is exactly what
 * a privacy guarantee cannot be built from. But the vocabulary is not unknown
 * here: the ledger already holds every account name, every last four and every
 * merchant title the parser read. Those are literal strings, they can be
 * replaced literally, and what is left cannot contain them.
 *
 * Aliases are LETTERS — `[shop A]`, `[card B]` — for a mechanical reason as
 * well as a readable one: message shapes have every digit replaced by `#`
 * afterwards, and a numeric alias would be blanked along with the amounts,
 * collapsing eight distinct shops into eight copies of `[shop #]`. Letters
 * survive that pass, so the report keeps the thing that makes it useful:
 * WHICH rows are the same shop, without saying which shop.
 *
 * The last four gets an alias rather than a blanking for the same reason.
 * cardDiagnostics' whole double-count check is "is this last four on more than
 * one account that contributes" — replace both with `####` and every card in
 * the ledger collides; delete them and the check reads as vacuous. `[·A]` on
 * two rows says "these two are the same physical card" and says nothing else.
 */

/**
 * Titles the parser minted for itself, which name no shop and are kept
 * verbatim because they are the most informative thing in the report.
 *
 * `STRUCTURAL_TITLES` is the parser's own list. The five below are the same
 * idea under names it keeps elsewhere — `NO_MERCHANT_TITLES` and
 * `GENERIC_MERCHANT` in accuracy.ts, `STRUCTURAL_TITLE_KEYS` in i18n.ts —
 * and aliasing them would be actively harmful: 'Card purchase' IS the signal
 * that the parser found no merchant, and a report calling it `[shop C]` hides
 * the very failure it was sent to describe.
 */
const PARSER_MINTED_TITLES = new Set([
  ...STRUCTURAL_TITLES,
  'Card purchase',
  'Card statement',
  'Bill payment',
  'Savings transfer',
  'Salary',
]);

/** 'Card •3644' and 'Card •3644 payment' — a minted title with digits in it. */
const CARD_TITLE_RE = /^Card •([0-9Xx*]{2,6})( payment)?$/;

/**
 * A name shorter than this is not replaced.
 *
 * Literal substitution over free text is indiscriminate: an account the user
 * called "Al" would delete those two letters from the middle of every Arabic
 * word in every message, and the shape a parser bug is reported through would
 * be destroyed to hide a string that identifies nobody.
 */
const MIN_ALIASABLE = 3;

/**
 * A merchant's own words are aliased too, not only its full name.
 *
 * The full-name rule alone has a hole big enough to drive the feature through,
 * and the fixture in the suite is the shape of it: the parser reads
 * "CARREFOUR HYPERMARKET AL BARSHA" from one bank's format and files it, then
 * a SECOND bank writes "CARREFOUR MARKET JLT", which the parser cannot read at
 * all. The literal never matches, the row is exactly the kind of row worth
 * reporting, and the trade name walks out inside it.
 *
 * So every distinctive WORD of a name the ledger knows carries that name's
 * alias. This is still vocabulary — nothing is guessed about text the ledger
 * has never seen — but it reaches the variants, the abbreviations and the
 * branch suffixes that a literal cannot.
 *
 * Four characters and above, because shorter tokens are matched without a word
 * boundary and would start eating the middles of ordinary words. That is the
 * deliberate trade: over-redaction replaces a word with `[shop A]` and costs a
 * little fidelity in a shape; under-redaction publishes where somebody shops.
 */
const MIN_WORD_ALIASABLE = 4;

/**
 * Words that must NOT be taken from a merchant name.
 *
 * Two kinds. The grammar of a bank message — `card`, `balance`, `ending`,
 * `spent` — because a merchant called "Card Zone" would otherwise delete the
 * word "card" from every message in the report and destroy the one thing a
 * parser bug is diagnosed from. And geography — `dubai`, `sharjah`, `emirates`
 * — which names a city of three and a half million people and identifies
 * nobody, while appearing inside half the trade names in the market.
 *
 * A bank's own name is excluded separately, from `bankName`, because that
 * field is kept on purpose: it says which SMS grammar misread the message.
 */
const NAME_STOPWORDS = new Set([
  'card', 'cards', 'bank', 'banks', 'account', 'accounts', 'credit', 'debit',
  'balance', 'limit', 'available', 'avail', 'amount', 'purchase', 'payment',
  'payments', 'transfer', 'withdrawal', 'deposit', 'statement', 'salary',
  'refund', 'charge', 'charged', 'spent', 'using', 'from', 'with', 'your',
  'ending', 'date', 'time', 'dirham', 'dubai', 'abu', 'dhabi', 'sharjah',
  'ajman', 'fujairah', 'emirates', 'riyadh', 'jeddah', 'trading', 'general',
  'store', 'stores', 'shop', 'market', 'mall', 'centre', 'center', 'city',
  'branch', 'company', 'group', 'national', 'international', 'online',
]);

/** 0 → A, 25 → Z, 26 → AA. Carries no digits, by construction. */
function letterAlias(n: number): string {
  let out = '';
  let i = n;
  do {
    out = String.fromCharCode(65 + (i % 26)) + out;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Aliases {
  /** Lowercased account name → `[card A]` / `[account A]`. */
  names: Map<string, string>;
  /** Last four → `[·A]`. */
  last4: Map<string, string>;
  /** Lowercased merchant title → `[shop A]`. */
  titles: Map<string, string>;
  /** One distinctive word of a merchant name → that merchant's alias. */
  words: Map<string, string>;
  /** Every real string above, as one case-insensitive alternation. */
  strip: RegExp | null;
}

function buildAliases(ledger: FeedbackLedger): Aliases {
  const names = new Map<string, string>();
  let cards = 0;
  let accounts = 0;
  for (const a of ledger.accounts) {
    const key = a.name.trim().toLowerCase();
    if (!key || names.has(key)) continue;
    names.set(
      key,
      a.kind === 'card' ? `[card ${letterAlias(cards++)}]` : `[account ${letterAlias(accounts++)}]`,
    );
  }

  const last4 = new Map<string, string>();
  for (const a of ledger.accounts) {
    if (a.last4 && !last4.has(a.last4)) last4.set(a.last4, `[·${letterAlias(last4.size)}]`);
  }

  const titles = new Map<string, string>();
  for (const tx of ledger.transactions) {
    const title = tx.title.trim();
    const key = title.toLowerCase();
    if (!title || titles.has(key)) continue;
    if (PARSER_MINTED_TITLES.has(title) || CARD_TITLE_RE.test(title)) continue;
    titles.set(key, `[shop ${letterAlias(titles.size)}]`);
  }

  // The banks' own names stay legible; see NAME_STOPWORDS.
  const bankWords = new Set<string>();
  for (const a of ledger.accounts) {
    for (const w of (a.bankName ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (w) bankWords.add(w);
    }
  }

  const words = new Map<string, string>();
  for (const [title, alias] of titles) {
    for (const w of title.split(/[^\p{L}\p{N}]+/u)) {
      if (w.length < MIN_WORD_ALIASABLE) continue;
      if (NAME_STOPWORDS.has(w) || bankWords.has(w) || words.has(w)) continue;
      words.set(w, alias);
    }
  }

  // Longest first, so "Emirates NBD Credit" is consumed before "Emirates NBD"
  // can eat half of it and leave the rest behind — and so a full merchant name
  // always wins over one of its own words.
  const literals = [...names.keys(), ...titles.keys(), ...last4.keys(), ...words.keys()]
    .filter((s) => s.length >= MIN_ALIASABLE)
    .sort((a, b) => b.length - a.length);

  return {
    names,
    last4,
    titles,
    words,
    strip: literals.length ? new RegExp(literals.map(escapeRegExp).join('|'), 'gi') : null,
  };
}

/** Whatever alias that literal has; `[redacted]` if it is somehow unknown. */
function aliasFor(a: Aliases, literal: string): string {
  const key = literal.toLowerCase();
  return (
    a.names.get(key) ?? a.titles.get(key) ?? a.last4.get(literal) ?? a.words.get(key) ?? '[redacted]'
  );
}

/** Every known name and last four out of a free-text string. */
function stripNames(a: Aliases, text: string): string {
  if (!a.strip) return text;
  a.strip.lastIndex = 0;
  return text.replace(a.strip, (m) => aliasFor(a, m));
}

/**
 * A bank message reduced to its shape: names aliased, then every digit gone.
 *
 * Order matters and is not interchangeable. Names first, because a merchant
 * name can contain digits ("Adnoc 44") and would stop matching its literal
 * once they were blanked. Digits second, which removes the amount, the date,
 * the reference, the balance and any card number the alias table never knew
 * about — the belt to the vocabulary's braces.
 *
 * WHAT THIS CANNOT PROMISE, stated here rather than discovered later. The
 * vocabulary is the set of merchants the parser SUCCEEDED at reading, and the
 * messages worth reporting are the ones it failed at — so a shop named only
 * inside an unparsed message has no entry in the table. Every digit is still
 * gone, and every merchant the ledger knows anywhere is still gone from every
 * message (the table is global, not per-row), which covers the ordinary case
 * of a shop that parsed on Tuesday and did not on Friday. The residue is a
 * trade name in a format the parser has never once read. That residue is why
 * this feature shows the user the exact text before sending it: the screen is
 * not decoration on top of the redaction, it is the last line of it.
 */
function messageShape(a: Aliases, raw: string): string {
  return stripNames(a, raw).replace(/\d/g, '#');
}

/** The same set, lowercased — merchant-override keys are stored lowercased. */
const MINTED_TITLE_KEYS = new Set([...PARSER_MINTED_TITLES].map((s) => s.toLowerCase()));

/**
 * A stored `merchantOverrides` key, aliased.
 *
 * Keys are already lowercased by whoever wrote them, so this cannot go through
 * `redactTitle` — that one matches the parser's minted titles by their exact
 * capitalisation. An override whose merchant has since been deleted from the
 * ledger has no alias to take; it collapses to a single anonymous key, which
 * no row can look up and which therefore changes no figure.
 */
function redactMerchantKey(a: Aliases, merchant: string): string {
  const key = merchant.trim().toLowerCase();
  const alias = a.titles.get(key);
  if (alias) return alias.toLowerCase();
  return MINTED_TITLE_KEYS.has(key) ? key : '[shop ?]';
}

/** A title, aliased unless the parser minted it. */
function redactTitle(a: Aliases, title: string): string {
  const trimmed = title.trim();
  if (PARSER_MINTED_TITLES.has(trimmed)) return trimmed;
  const card = CARD_TITLE_RE.exec(trimmed);
  if (card) {
    const digits = a.last4.get(card[1]) ?? '[·?]';
    return `Card •${digits}${card[2] ?? ''}`;
  }
  return a.titles.get(trimmed.toLowerCase()) ?? '[shop ?]';
}

/**
 * The ledger with every name replaced, ready to be reported on.
 *
 * `keepFigures` is the difference between the two attachable levels. At
 * `shapes` no amount is reported at all, so the figures are not carried into
 * the redacted copy either — a value that is never present cannot leak from a
 * code path nobody re-reads.
 *
 * Kept deliberately: `bankName`, `cardType`, `kind`, dates, `isTransfer`,
 * `cardPaymentSide`, `source`. A bank name identifies which SMS grammar
 * misread the message, which is the single most load-bearing fact in a parser
 * report; there are about a dozen banks in this market and knowing someone
 * uses one of them identifies nobody. Dropped deliberately: `note`, which is
 * free text the user wrote about a specific purchase and has no diagnostic
 * value whatsoever.
 */
function redactLedger(
  ledger: FeedbackLedger,
  aliases: Aliases,
  keepFigures: boolean,
): FeedbackLedger {
  const money = (fils: number | undefined): number | undefined =>
    fils === undefined ? undefined : keepFigures ? fils : 0;

  const accounts: Account[] = ledger.accounts.map((a) => ({
    ...a,
    name: a.name.trim() ? aliasFor(aliases, a.name.trim()) : '[account ?]',
    last4: a.last4 ? aliases.last4.get(a.last4) : undefined,
    openingFils: keepFigures ? a.openingFils : 0,
    snapshotFils: money(a.snapshotFils),
    creditLimitFils: money(a.creditLimitFils),
  }));

  const transactions: Transaction[] = ledger.transactions.map((t) => ({
    ...t,
    title: redactTitle(aliases, t.title),
    note: undefined,
    raw: t.raw ? messageShape(aliases, t.raw) : undefined,
    amountFils: keepFigures ? t.amountFils : 0,
    originalAmountMinor: keepFigures ? t.originalAmountMinor : undefined,
  }));

  const cardDues: CardDue[] = ledger.cardDues.map((d) => ({
    ...d,
    totalDueFils: keepFigures ? d.totalDueFils : 0,
    minDueFils: keepFigures ? d.minDueFils : 0,
    paidFils: keepFigures ? d.paidFils : 0,
  }));

  /**
   * The pins have to move with the names, or the report lies about the user.
   *
   * `parserCoverage` reads `merchantOverrides[tx.title.trim().toLowerCase()]`
   * to decide which rows the user has already answered for. Alias the titles
   * and leave the keys alone and every one of those lookups misses: `decided`
   * collapses to zero, those rows fall into `categoryMeasured` instead, and
   * the report accuses the parser of failing on rows the user had settled
   * themselves. Same key derivation as the lookup, so the two cannot drift.
   */
  const merchantOverrides: Record<string, CategoryId> = {};
  for (const [merchant, category] of Object.entries(ledger.merchantOverrides ?? {})) {
    merchantOverrides[redactMerchantKey(aliases, merchant)] = category;
  }

  return { accounts, transactions, cardDues, merchantOverrides };
}

/**
 * The user's own words, minus anything that looks like an account number.
 *
 * Their sentence is theirs and is not otherwise touched — a report rewritten
 * by the app is a report the user did not make. But "my card ending
 * 4532109988776655 was charged twice" is the single most likely thing to be
 * typed into a box on this screen, so long digit runs are masked the same way
 * accuracy.ts masks them, and the screen says so above the box.
 */
export function scrubFeedbackMessage(text: string): string {
  return text
    .slice(0, FEEDBACK_MESSAGE_MAX)
    .replace(/\d{5,}/g, (m) => `····${m.slice(-4)}`)
    .trim();
}

/**
 * The payload, complete, from the ledger and the user's words.
 *
 * Deterministic and side-effect free: the same ledger and the same choice
 * produce the same bytes, which is what lets the screen render the payload it
 * is about to send rather than a description of it.
 */
export function buildFeedbackPayload(input: FeedbackInput): FeedbackPayload {
  const requested = input.detail;
  // The override lives HERE and not only in the screen. A guard that exists
  // only in the UI is one refactor away from not existing.
  const withheld = input.build.privateMode && requested !== 'none' ? 'private-mode' : null;
  const detail: FeedbackDetail = withheld ? 'none' : requested;

  const base: FeedbackPayload = {
    schema: FEEDBACK_SCHEMA,
    message: scrubFeedbackMessage(input.message),
    detailRequested: requested,
    detail,
    withheld,
    delivery: { ...FEEDBACK_DELIVERY },
    build: { ...input.build },
    counts: null,
    shapes: null,
    diagnostic: null,
  };

  if (detail === 'none') return base;

  const aliases = buildAliases(input.ledger);
  const keepFigures = detail === 'figures';
  const safe = redactLedger(input.ledger, aliases, keepFigures);

  const coverage = parserCoverage({
    transactions: safe.transactions,
    merchantOverrides: safe.merchantOverrides,
  });

  const allShapes: FeedbackShape[] = unreadFormats(safe.transactions, (id) =>
    categoryLabel(id, 'en'),
  ).map((f) => ({
    // The state was redacted before this ran, so `raw` is already a shape.
    // Passed through `stripNames` once more anyway: defence in depth costs one
    // regex over a few dozen short strings, and the cost of being wrong here
    // is the product's central claim.
    shape: stripNames(aliases, f.raw),
    title: f.title,
    category: f.category,
    count: f.count,
    reason: f.reason,
  }));
  const shapes = allShapes.slice(0, FEEDBACK_SHAPES_MAX);

  return {
    ...base,
    counts: {
      accounts: safe.accounts.length,
      transactions: safe.transactions.length,
      cardDues: safe.cardDues.length,
      imported: coverage.imported,
      skipped: coverage.skipped,
      measured: coverage.measured,
      named: coverage.named,
      decided: coverage.decided,
      categoryMeasured: coverage.categoryMeasured,
      categorised: coverage.categorised,
      formats: allShapes.length,
    },
    shapes,
    // Same reasoning as `shape` above: the diagnostic is generated from an
    // already-redacted ledger and cannot contain a name, and it is scrubbed
    // again on the way out because this is the one place in the app where a
    // missed field would be visible to somebody else.
    diagnostic: keepFigures ? stripNames(aliases, cardDiagnostics(safe)) : null,
  };
}

/* ═══════════════════════════ Rendering ═══════════════════════════════════ */

/** One line per attachment level, in the report's own words. */
const DETAIL_LINES: Record<FeedbackDetail, string> = {
  none: 'message only — nothing from the ledger is attached',
  shapes: 'message shapes and counts — no amounts, no names',
  figures: 'message shapes, counts, and the card diagnostic with its amounts — no names',
};

/**
 * The payload as text — what the screen shows, and what a "save a copy" hands
 * to the share sheet.
 *
 * ENGLISH, deliberately, and the screen says so in Arabic above it. This is a
 * diagnostic artifact read by whoever fixes the bug, exactly like the card
 * diagnostic it contains, which has been English-only since it was written.
 * Translating it would leave half a report in each language and would make
 * `cardDiagnostics`' own prose the odd one out.
 *
 * Every field of the payload appears here. That is the contract the screen
 * relies on: "see exactly what will be sent" is only true if the rendering is
 * complete, so this function is checked field-by-field in the suite rather
 * than eyeballed.
 */
export function formatFeedbackPayload(p: FeedbackPayload): string {
  const out: string[] = ['WAFRA FEEDBACK', `schema ${p.schema}`, ''];

  out.push('WHAT YOU WROTE');
  out.push(...(p.message ? p.message.split('\n').map((l) => `  ${l}`) : ['  (nothing yet)']));
  out.push('');

  out.push('THIS BUILD');
  out.push(
    `  Wafra ${p.build.version} · ${p.build.platform} · ${p.build.language} · ` +
      `${p.build.marketId} (${p.build.currency})`,
  );
  out.push(`  private mode: ${p.build.privateMode ? 'on' : 'off'}`);
  out.push('');

  out.push('ATTACHED');
  out.push(`  ${DETAIL_LINES[p.detail]}`);
  if (p.withheld === 'private-mode') {
    out.push(
      `  asked for "${p.detailRequested}" and held it back: Private Mode is on, so nothing`,
      '  derived from this ledger leaves the device. Not an oversight and not a',
      '  transport failure — the user chose local-only.',
    );
  }
  out.push('');

  out.push('DELIVERY');
  out.push(`  kept for at most ${p.delivery.retentionDays} days`);
  out.push(`  readable by: ${p.delivery.reviewedBy === 'wafra-maintainers' ? 'Wafra maintainers' : p.delivery.reviewedBy}`);
  out.push(`  third-party AI review: ${p.delivery.thirdPartyAi ? 'yes' : 'no'}`);
  out.push('');

  if (p.counts) {
    const c = p.counts;
    out.push('COUNTS');
    out.push(
      `  ${c.accounts} account(s) · ${c.transactions} entr${c.transactions === 1 ? 'y' : 'ies'}` +
        ` · ${c.cardDues} statement(s)`,
    );
    out.push(`  read from bank messages: ${c.imported}`);
    out.push(`  of those, nothing to get right (transfers, structural, credits): ${c.skipped}`);
    out.push(`  purchases where a shop name was expected: ${c.measured}`);
    out.push(`    named by the parser: ${c.named}`);
    out.push(`    already answered by the user: ${c.decided}`);
    out.push(`  categories the parser was asked for: ${c.categoryMeasured}`);
    out.push(`    filed as something other than "other": ${c.categorised}`);
    out.push(`  distinct unrecognised formats: ${c.formats}`);
    out.push('');
  }

  if (p.shapes) {
    out.push(`MESSAGE SHAPES (${p.shapes.length})`);
    if (!p.shapes.length) {
      out.push(
        '  none — either every message read cleanly, or this device keeps no',
        '  message text at all (the iOS relay discards it after parsing).',
      );
    }
    p.shapes.forEach((s, i) => {
      out.push(`  ${i + 1}. ${s.reason} · ${s.count} row(s) · read as "${s.title}" / ${s.category}`);
      out.push(...s.shape.split('\n').map((l) => `       ${l}`));
    });
    const omitted = Math.max(0, (p.counts?.formats ?? p.shapes.length) - p.shapes.length);
    if (omitted > 0) out.push(`  ${omitted} additional format(s) stayed on this phone.`);
    out.push('');
    out.push('  Every digit above is replaced by #, so no amount, date, reference');
    out.push('  or card number survives. Names are replaced by [shop A], [card A].');
    out.push('');
  }

  if (p.diagnostic) {
    out.push('CARD DIAGNOSTIC');
    out.push(...p.diagnostic.split('\n').map((l) => `  ${l}`));
    out.push('');
  }

  out.push(
    'Every name in this report is an alias. [shop A] is the same shop everywhere',
    'it appears and [·A] is the same card, which is what makes a double-count',
    'visible; neither can be read back to the real one.',
  );

  return out.join('\n');
}

/* ═══════════════════════════ Transport ═══════════════════════════════════ */

/** What the transport hands back so the screen can tell the user it landed. */
export interface FeedbackReceipt {
  /** The transport's own id for this report — an issue number, a ticket id. */
  id: string;
}

/** Implement this. It is the entire surface between capture and transport. */
export type FeedbackTransport = (payload: FeedbackPayload) => Promise<FeedbackReceipt>;

/**
 * Thrown by `submitFeedback` when no transport has been installed.
 *
 * A stub that resolved quietly would be the worst of the available options: the
 * screen would say "sent", the user would believe their report was on its way,
 * and it would be nowhere. Throwing a NAMED error means the screen can tell
 * this apart from a network failure and say the true thing — sending is not
 * connected in this build, here is your report, save a copy — which is what
 * `src/app/feedback.tsx` does with it.
 */
export class FeedbackTransportMissingError extends Error {
  constructor() {
    super('No feedback transport is installed. Call setFeedbackTransport() first.');
    this.name = 'FeedbackTransportMissingError';
  }
}

let transport: FeedbackTransport | null = null;

/**
 * Install the transport. Called once, at startup, by whoever owns delivery.
 *
 * A setter rather than a direct import so this module keeps its promise of
 * having no network in it: the thing that opens a socket lives on the other
 * side of this function, and the tests can drive `submitFeedback` end to end
 * without one.
 */
export function setFeedbackTransport(fn: FeedbackTransport | null): void {
  transport = fn;
}

/** Whether sending is wired up at all — the screen asks before offering it. */
export function isFeedbackTransportInstalled(): boolean {
  return transport !== null;
}

/**
 * ═══ STUB — the transport agent implements the other side of this. ═══
 *
 * The contract, in full:
 *
 *   setFeedbackTransport(async (payload: FeedbackPayload): Promise<FeedbackReceipt> => …)
 *
 * Requirements on that implementation:
 *
 *  • It receives `payload` ONLY on an explicit tap. Nothing in this module or
 *    in feedback.tsx calls it on mount, on a timer, or on a retry.
 *  • It must send the payload as given. It may serialise it, it may not
 *    enrich it: the user was shown `formatFeedbackPayload(payload)` and
 *    consented to that, so a transport that attaches a device id, a push
 *    token, an installation uuid or a ledger field of its own has sent
 *    something nobody agreed to.
 *  • It must reject on failure rather than resolve. The screen distinguishes
 *    a missing transport from a failed send and says something different for
 *    each; a swallowed error collapses the two.
 *  • `payload.detail === 'none'` is a complete, valid report, not a
 *    degenerate one. It is what every Private Mode user sends.
 */
export async function submitFeedback(payload: FeedbackPayload): Promise<FeedbackReceipt> {
  if (!transport) throw new FeedbackTransportMissingError();
  return transport(payload);
}
