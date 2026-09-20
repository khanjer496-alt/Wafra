#!/usr/bin/env python3
"""Loader for the real SinaLab/ArBanking77 corpus.

Source of truth: https://github.com/SinaLab/ArBanking77 (``data/`` directory).
The Hugging Face mirror ``SinaLab/ArBanking77`` only publishes ~1k-row *sample*
CSVs and does not carry the Saudi / Moroccan / Tunisian dialect test sets, so
the git checkout is required.  No synthetic text is ever substituted here.

Training and model selection use MSA+PAL train/val only.  The dialect test
sets are returned sealed: :func:`load_split` refuses to hand back a dialect
split unless the caller passes ``purpose="evaluate"``.
"""

from __future__ import annotations

import csv
import hashlib
import os
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from wafra_taxonomy import project

DEFAULT_DATA_ROOT = Path(
    os.environ.get("ARBANKING77_DATA", "/home/user/sinalab/arbanking77/data")
)

TRAIN_SPLITS = ("train", "val")
DIALECT_SPLITS = ("msa", "pal", "saudi", "moroccan", "tunisian")
# msa/pal test sets share the training dialects; saudi/moroccan/tunisian are the
# genuinely unseen dialect shift this experiment is about.
UNSEEN_DIALECTS = ("saudi", "moroccan", "tunisian")

SPLIT_FILES = {
    "train": "Banking77_Arabized_MSA_PAL_train.csv",
    "val": "Banking77_Arabized_MSA_PAL_val.csv",
    "msa": "Banking77_Arabized_MSA_test.csv",
    "pal": "Banking77_Arabized_PAL_test.csv",
    "saudi": "Banking77_Arabized_Saudi_test.csv",
    "moroccan": "Banking77_Arabized_Moroccan_test.csv",
    "tunisian": "Banking77_Arabized_Tunisian_test.csv",
}

_ARABIC_DIACRITICS = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")
_WS = re.compile(r"\s+")


def normalize(text: str) -> str:
    """Deterministic normalization shared by every model in the benchmark.

    Unicode NFKC, strip Arabic diacritics/tatweel, fold Arabic-Indic digits to
    ASCII, collapse whitespace.  Deliberately does *not* fold alef/ya/ta-marbuta
    variants: that is orthographic information the dialect sets actually carry.
    """
    text = unicodedata.normalize("NFKC", text)
    text = _ARABIC_DIACRITICS.sub("", text)
    out = []
    for ch in text:
        code = ord(ch)
        if 0x0660 <= code <= 0x0669:  # Arabic-Indic digits
            out.append(chr(code - 0x0660 + 0x30))
        elif 0x06F0 <= code <= 0x06F9:  # Extended Arabic-Indic digits
            out.append(chr(code - 0x06F0 + 0x30))
        else:
            out.append(ch)
    return _WS.sub(" ", "".join(out)).strip()


@dataclass(frozen=True)
class Example:
    text: str
    intent_ar: str
    intent_en: str
    family: str
    state: str
    direction: str
    split: str

    @property
    def joint(self) -> str:
        return f"{self.family}|{self.state}"


def load_intent_map(data_root: Path = DEFAULT_DATA_ROOT) -> dict[str, str]:
    """Arabic intent label -> English intent name."""
    mapping: dict[str, str] = {}
    with open(data_root / "Banking77_intents.csv", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            mapping[row["label_ar"].strip()] = row["label_en"].strip()
    if len(mapping) != 77:
        raise ValueError(f"expected 77 intents, found {len(mapping)}")
    return mapping


def load_split(
    split: str,
    *,
    purpose: str,
    data_root: Path = DEFAULT_DATA_ROOT,
) -> list[Example]:
    """Load one split.

    ``purpose`` must be ``"train"`` for train/val and ``"evaluate"`` for the
    dialect test sets.  The check is a tripwire, not security: it makes an
    accidental "tune on Saudi" loop fail loudly instead of silently producing
    an untrustworthy number.
    """
    if split not in SPLIT_FILES:
        raise KeyError(f"unknown split {split!r}")
    if split in TRAIN_SPLITS and purpose != "train":
        raise ValueError(f"split {split!r} is a fitting split; pass purpose='train'")
    if split not in TRAIN_SPLITS and purpose != "evaluate":
        raise ValueError(
            f"split {split!r} is a sealed holdout; pass purpose='evaluate' and never "
            "use it for hyperparameter selection"
        )

    intents = load_intent_map(data_root)
    rows: list[Example] = []
    with open(data_root / SPLIT_FILES[split], encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            intent_ar = row["label"].strip()
            intent_en = intents[intent_ar]
            family, state, direction = project(intent_en)
            rows.append(
                Example(
                    text=normalize(row["text"]),
                    intent_ar=intent_ar,
                    intent_en=intent_en,
                    family=family,
                    state=state,
                    direction=direction,
                    split=split,
                )
            )
    if not rows:
        raise ValueError(f"split {split!r} loaded empty from {data_root}")
    return rows


def dialect_provenance(data_root: Path = DEFAULT_DATA_ROOT) -> dict[str, str]:
    """Normalized training-pool text -> "msa" or "pal".

    ``Banking77_full_corpus.csv`` keeps the MSA and Palestinian renderings of
    each source question in separate columns, so the MSA+PAL training pool can
    be split by dialect.  That makes an honest dialect-shift development setup
    possible -- fit on MSA, measure transfer on PAL -- without ever touching the
    sealed Saudi / Moroccan / Tunisian sets.
    """
    msa: set[str] = set()
    pal: set[str] = set()
    with open(data_root / "Banking77_full_corpus.csv", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            for column in ("Question_MSA1", "Question_MSA2"):
                value = (row.get(column) or "").strip()
                if value and value != "NULL":
                    msa.add(normalize(value))
            for column in ("Question_PAL1", "Question_PAL2"):
                value = (row.get(column) or "").strip()
                if value and value != "NULL":
                    pal.add(normalize(value))
    shared = msa & pal
    return {
        **{text: "msa" for text in msa - shared},
        **{text: "pal" for text in pal - shared},
    }


def by_dialect(rows: list[Example], data_root: Path = DEFAULT_DATA_ROOT) -> dict[str, list[Example]]:
    """Partition fitting-pool rows into ``msa``, ``pal`` and ``unknown``."""
    provenance = dialect_provenance(data_root)
    out: dict[str, list[Example]] = {"msa": [], "pal": [], "unknown": []}
    for row in rows:
        out[provenance.get(row.text, "unknown")].append(row)
    return out


def split_digest(rows: list[Example]) -> str:
    """Stable content hash so a stored result can be tied to exact data."""
    digest = hashlib.sha256()
    for row in rows:
        digest.update(row.intent_en.encode("utf-8"))
        digest.update(b"\x1f")
        digest.update(row.text.encode("utf-8"))
        digest.update(b"\x1e")
    return digest.hexdigest()


def dataset_provenance(data_root: Path = DEFAULT_DATA_ROOT) -> dict:
    """Per-file sha256 + row counts, recorded alongside every result file."""
    info = {}
    for split, name in SPLIT_FILES.items():
        path = data_root / name
        raw = path.read_bytes()
        info[split] = {
            "file": name,
            "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw),
        }
    return info


if __name__ == "__main__":
    import collections
    import json

    from wafra_taxonomy import HIGH_RISK_INTENTS, is_ledger_eligible

    summary = {}
    for split in SPLIT_FILES:
        purpose = "train" if split in TRAIN_SPLITS else "evaluate"
        rows = load_split(split, purpose=purpose)
        hr = [r for r in rows if r.intent_en in HIGH_RISK_INTENTS]
        ledger = [r for r in rows if is_ledger_eligible(r.family, r.state)]
        summary[split] = {
            "rows": len(rows),
            "intents_present": len({r.intent_en for r in rows}),
            "high_risk_rows": len(hr),
            "ledger_eligible_rows": len(ledger),
            "digest": split_digest(rows)[:16],
            "family_counts": dict(collections.Counter(r.family for r in rows).most_common()),
        }
    print(json.dumps(summary, indent=2, ensure_ascii=False))
