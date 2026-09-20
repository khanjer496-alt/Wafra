#!/usr/bin/env python3
"""Hyperparameter selection for the char n-gram linear baseline.

MSA+PAL val only.  This script cannot load a dialect test set: ``arb_data``
refuses the split unless ``purpose="evaluate"``, which is never passed here.
Run it before ``run_benchmark.py`` and copy the winning config across.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

from arb_data import dataset_provenance, load_split, split_digest
from models import CharNGramLinear
from wafra_taxonomy import MAPPING_VERSION, project

RESULTS = Path(__file__).parent / "results"

GRID = [
    {"ngram_range": (2, 4), "min_df": 2, "C": 4.0, "max_features": 300_000},
    {"ngram_range": (2, 5), "min_df": 2, "C": 4.0, "max_features": 300_000},
    {"ngram_range": (2, 5), "min_df": 2, "C": 1.0, "max_features": 300_000},
    {"ngram_range": (2, 5), "min_df": 2, "C": 12.0, "max_features": 300_000},
    {"ngram_range": (2, 6), "min_df": 2, "C": 4.0, "max_features": 400_000},
    {"ngram_range": (1, 5), "min_df": 1, "C": 4.0, "max_features": 400_000},
    {"ngram_range": (2, 5), "min_df": 3, "C": 4.0, "max_features": 150_000},
]


def score(model, rows) -> dict:
    proba = model.predict_proba([r.text for r in rows])
    preds = [model.labels[i] for i in proba.argmax(1)]
    conf = proba.max(1)
    intent = float(np.mean([p == r.intent_en for p, r in zip(preds, rows)]))
    fam = float(np.mean([project(p)[0] == r.family for p, r in zip(preds, rows)]))
    state = float(np.mean([project(p)[1] == r.state for p, r in zip(preds, rows)]))
    joint = float(np.mean([project(p)[:2] == (r.family, r.state) for p, r in zip(preds, rows)]))
    return {
        "intent_accuracy": intent,
        "family_accuracy": fam,
        "state_accuracy": state,
        "joint_accuracy": joint,
        "mean_confidence": float(conf.mean()),
    }


def main() -> int:
    train = load_split("train", purpose="train")
    val = load_split("val", purpose="train")
    print(f"train={len(train)} val={len(val)}", file=sys.stderr)

    runs = []
    for cfg in GRID:
        started = time.time()
        model = CharNGramLinear(**cfg)
        model.fit(train, val)
        metrics = score(model, val)
        runs.append(
            {
                "config": model.describe(),
                "val": metrics,
                "fit_seconds": time.time() - started,
                "size": model.deployable_bytes(),
            }
        )
        print(
            f"{cfg} -> joint={metrics['joint_accuracy']:.4f} "
            f"intent={metrics['intent_accuracy']:.4f}",
            file=sys.stderr,
        )

    runs.sort(key=lambda r: (-r["val"]["joint_accuracy"], -r["val"]["intent_accuracy"]))
    payload = {
        "experiment": "tune-char-ngram-linear",
        "selection_split": "MSA_PAL_val",
        "sealed_splits_touched": [],
        "mapping_version": MAPPING_VERSION,
        "train_digest": split_digest(train),
        "val_digest": split_digest(val),
        "dataset": dataset_provenance(),
        "runs": runs,
        "selected": runs[0]["config"],
    }
    RESULTS.mkdir(exist_ok=True)
    out = RESULTS / "tune-char-ngram-linear.json"
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
