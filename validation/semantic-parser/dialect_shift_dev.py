#!/usr/bin/env python3
"""Dialect-shift development harness -- no sealed data involved.

Tuning a model for dialect robustness on the MSA+PAL validation split does not
work: that split is the *same* two dialects the model trained on, so it cannot
see a transfer failure coming.  Tuning against the Saudi / Moroccan / Tunisian
test sets would make them worthless as holdouts.

Way out: the MSA+PAL training pool itself contains two dialects, and
``Banking77_full_corpus.csv`` says which rendering each row came from.  Fit on
MSA only, measure on Palestinian only (and the reverse), entirely inside the
fitting pool.  A representation choice that improves MSA->PAL transfer is a
principled candidate for improving MSA+PAL -> unseen dialect, and the sealed
sets stay sealed.

Run this to pick a representation, then run the sealed benchmark once.
"""

from __future__ import annotations

import argparse
import json
import random
import time
import unicodedata
from pathlib import Path

import numpy as np

from arb_data import by_dialect, load_split
from wafra_taxonomy import HIGH_RISK_INTENTS, MAPPING_VERSION, project

HERE = Path(__file__).parent
RESULTS = HERE / "results"
SEED = 20260920

_ORTHOGRAPHIC_FOLD = str.maketrans({
    "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا",
    "ى": "ي", "ئ": "ي",
    "ة": "ه",
    "ؤ": "و",
    "گ": "ك", "چ": "ج", "پ": "ب", "ڤ": "ف",
})


def fold_orthography(text: str) -> str:
    """Collapse the alef/ya/ta-marbuta spelling variants dialects disagree on."""
    return text.translate(_ORTHOGRAPHIC_FOLD)


def augment(text: str, rng: random.Random, rate: float) -> str:
    """Cheap character noise standing in for unseen dialectal spelling.

    Drops, doubles or swaps characters.  It does not invent vocabulary, so it
    can only help a model tolerate spelling drift, never unseen synonyms.
    """
    chars = list(text)
    out = []
    for ch in chars:
        roll = rng.random()
        if roll < rate / 3:
            continue
        if roll < 2 * rate / 3:
            out.append(ch)
        out.append(ch)
    if len(out) > 3 and rng.random() < rate:
        i = rng.randrange(len(out) - 1)
        out[i], out[i + 1] = out[i + 1], out[i]
    return "".join(out)


def build_vectorizer(variant: dict):
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.pipeline import FeatureUnion

    char = TfidfVectorizer(
        analyzer="char_wb",
        ngram_range=tuple(variant["char_ngrams"]),
        min_df=variant.get("min_df", 2),
        max_features=variant.get("max_features", 300_000),
        sublinear_tf=True,
    )
    if not variant.get("word_ngrams"):
        return char
    word = TfidfVectorizer(
        analyzer="word",
        ngram_range=tuple(variant["word_ngrams"]),
        min_df=variant.get("min_df", 2),
        sublinear_tf=True,
    )
    return FeatureUnion([("char", char), ("word", word)])


def fit_and_score(variant: dict, fit_rows, eval_rows) -> dict:
    from sklearn.linear_model import LogisticRegression

    rng = random.Random(SEED)
    prep = fold_orthography if variant.get("fold_orthography") else (lambda t: t)

    texts = [prep(r.text) for r in fit_rows]
    labels_out = [r.intent_en for r in fit_rows]
    copies = variant.get("augment_copies", 0)
    if copies:
        for _ in range(copies):
            texts.extend(augment(prep(r.text), rng, variant["augment_rate"]) for r in fit_rows)
            labels_out.extend(r.intent_en for r in fit_rows)

    classes = tuple(sorted({r.intent_en for r in fit_rows}))
    index = {name: i for i, name in enumerate(classes)}
    y = np.array([index[name] for name in labels_out])

    vec = build_vectorizer(variant)
    started = time.time()
    X = vec.fit_transform(texts)
    clf = LogisticRegression(C=variant.get("C", 12.0), max_iter=2000, random_state=SEED)
    clf.fit(X, y)
    fit_seconds = time.time() - started

    Xe = vec.transform([prep(r.text) for r in eval_rows])
    proba = clf.predict_proba(Xe)
    preds = [classes[i] for i in proba.argmax(1)]

    def acc(fn) -> float:
        return float(np.mean([fn(p, r) for p, r in zip(preds, eval_rows)]))

    high_risk = [(p, r) for p, r in zip(preds, eval_rows) if r.intent_en in HIGH_RISK_INTENTS]
    return {
        "n_fit": len(texts),
        "n_eval": len(eval_rows),
        "features": int(X.shape[1]),
        "fit_seconds": fit_seconds,
        "intent_accuracy": acc(lambda p, r: p == r.intent_en),
        "family_accuracy": acc(lambda p, r: project(p)[0] == r.family),
        "state_accuracy": acc(lambda p, r: project(p)[1] == r.state),
        "joint_accuracy": acc(lambda p, r: project(p)[:2] == (r.family, r.state)),
        "high_risk_joint_accuracy": float(
            np.mean([project(p)[:2] == (r.family, r.state) for p, r in high_risk])
        )
        if high_risk
        else None,
        "mean_confidence": float(proba.max(1).mean()),
    }


VARIANTS = [
    {"name": "baseline-char2-5", "char_ngrams": [2, 5]},
    {"name": "fold-orthography", "char_ngrams": [2, 5], "fold_orthography": True},
    {"name": "char+word", "char_ngrams": [2, 5], "word_ngrams": [1, 2]},
    {"name": "fold+char+word", "char_ngrams": [2, 5], "word_ngrams": [1, 2], "fold_orthography": True},
    {"name": "fold+augment", "char_ngrams": [2, 5], "fold_orthography": True,
     "augment_copies": 1, "augment_rate": 0.08},
    {"name": "fold+char+word+augment", "char_ngrams": [2, 5], "word_ngrams": [1, 2],
     "fold_orthography": True, "augment_copies": 1, "augment_rate": 0.08},
    {"name": "fold-char3-6", "char_ngrams": [3, 6], "fold_orthography": True,
     "max_features": 400_000},
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", default="v1")
    args = parser.parse_args()

    train = load_split("train", purpose="train")
    val = load_split("val", purpose="train")
    parts_train = by_dialect(train)
    parts_val = by_dialect(val)
    print(
        f"train msa={len(parts_train['msa'])} pal={len(parts_train['pal'])} "
        f"unknown={len(parts_train['unknown'])}",
        flush=True,
    )

    setups = {
        # The transfer directions that matter: fit one dialect, meet another.
        "msa->pal": (parts_train["msa"], parts_train["pal"] + parts_val["pal"]),
        "pal->msa": (parts_train["pal"], parts_train["msa"] + parts_val["msa"]),
        # In-dialect control, so a variant that only helps generally is visible.
        "msa->msa-val": (parts_train["msa"], parts_val["msa"]),
    }

    report = {
        "experiment": "dialect-shift-development",
        "tag": args.tag,
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "seed": SEED,
        "mapping_version": MAPPING_VERSION,
        "sealed_splits_touched": [],
        "note": (
            "Fit and evaluation both come from the MSA+PAL fitting pool, split "
            "by the dialect column in Banking77_full_corpus.csv. The Saudi, "
            "Moroccan and Tunisian test sets are not loaded by this script."
        ),
        "setup_sizes": {k: {"fit": len(a), "eval": len(b)} for k, (a, b) in setups.items()},
        "variants": {},
    }

    for variant in VARIANTS:
        report["variants"][variant["name"]] = {"config": variant, "setups": {}}
        for setup, (fit_rows, eval_rows) in setups.items():
            scores = fit_and_score(variant, fit_rows, eval_rows)
            report["variants"][variant["name"]]["setups"][setup] = scores
            print(
                f"{variant['name']:26s} {setup:12s} joint={scores['joint_accuracy']:.4f} "
                f"intent={scores['intent_accuracy']:.4f} "
                f"hr_joint={scores['high_risk_joint_accuracy']:.4f} "
                f"({scores['fit_seconds']:.0f}s)",
                flush=True,
            )

    ranked = sorted(
        report["variants"].items(),
        key=lambda kv: -kv[1]["setups"]["msa->pal"]["joint_accuracy"],
    )
    report["ranked_by_msa_to_pal_joint"] = [name for name, _ in ranked]
    report["selected"] = ranked[0][0]

    RESULTS.mkdir(exist_ok=True)
    out = RESULTS / f"dialect-shift-dev-{args.tag}.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nselected by MSA->PAL transfer: {report['selected']}")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
