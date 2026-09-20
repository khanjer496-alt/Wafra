#!/usr/bin/env python3
"""Scoring for the Wafra semantic-parser benchmark.

Two independent axes are reported and must not be conflated:

*Semantic accuracy* -- family / state / joint / direction correctness.

*Gate safety*       -- what the auto-import policy actually did.  The product
                       requirement is ``unsafe_auto_imports == 0`` with safe
                       coverage pushed toward 90%, not maximum accuracy.

An auto-import is **unsafe** when the gate committed a decision whose family or
state disagrees with ground truth.  ``phantom_auto_imports`` counts the worst
subset: a ledger row created for something that never posted (declined,
pending, or a pure question).  ``direction_flips`` counts an auto-import that
would have moved money the wrong way.
"""

from __future__ import annotations

import math
from collections import Counter

from wafra_taxonomy import LEDGER_FAMILIES, is_ledger_eligible


def _acc(hits: int, total: int) -> float:
    return float(hits) / total if total else float("nan")


def semantic_report(records: list[dict]) -> dict:
    """``records``: dicts with true_/pred_ family, state, direction, intent."""
    n = len(records)
    fam = sum(1 for r in records if r["pred_family"] == r["true_family"])
    st = sum(1 for r in records if r["pred_state"] == r["true_state"])
    joint = sum(
        1
        for r in records
        if r["pred_family"] == r["true_family"] and r["pred_state"] == r["true_state"]
    )
    direction = sum(1 for r in records if r["pred_direction"] == r["true_direction"])
    intent = sum(1 for r in records if r.get("pred_intent") == r.get("true_intent"))
    return {
        "n": n,
        "family_accuracy": _acc(fam, n),
        "state_accuracy": _acc(st, n),
        "joint_accuracy": _acc(joint, n),
        "direction_accuracy": _acc(direction, n),
        "intent_accuracy": _acc(intent, n),
    }


def calibration_report(records: list[dict], bins: int = 15) -> dict:
    """ECE / MCE / Brier against joint (family+state) correctness."""
    usable = [r for r in records if r.get("confidence") is not None]
    if not usable:
        return {"n": 0, "ece": None, "mce": None, "brier": None, "bins": []}

    edges = [i / bins for i in range(bins + 1)]
    buckets: list[dict] = []
    ece = 0.0
    mce = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        sel = [
            r
            for r in usable
            if (r["confidence"] > lo or (lo == 0.0 and r["confidence"] >= 0.0))
            and r["confidence"] <= hi
        ]
        if not sel:
            continue
        conf = sum(r["confidence"] for r in sel) / len(sel)
        acc = _acc(
            sum(
                1
                for r in sel
                if r["pred_family"] == r["true_family"] and r["pred_state"] == r["true_state"]
            ),
            len(sel),
        )
        gap = abs(acc - conf)
        ece += (len(sel) / len(usable)) * gap
        mce = max(mce, gap)
        buckets.append(
            {"lo": lo, "hi": hi, "n": len(sel), "mean_confidence": conf, "accuracy": acc}
        )

    brier = sum(
        (
            r["confidence"]
            - (
                1.0
                if r["pred_family"] == r["true_family"] and r["pred_state"] == r["true_state"]
                else 0.0
            )
        )
        ** 2
        for r in usable
    ) / len(usable)

    # Overconfident-and-wrong is the failure mode the handoff flagged.
    overconfident = [
        r
        for r in usable
        if r["confidence"] >= 0.90
        and not (r["pred_family"] == r["true_family"] and r["pred_state"] == r["true_state"])
    ]
    return {
        "n": len(usable),
        "ece": ece,
        "mce": mce,
        "brier": brier,
        "overconfident_wrong_at_0.90": len(overconfident),
        "overconfident_wrong_rate": _acc(len(overconfident), len(usable)),
        "bins": buckets,
    }


def gate_report(records: list[dict]) -> dict:
    """Score the auto-import / review / refuse policy."""
    n = len(records)
    outcomes = Counter(r["outcome"] for r in records)
    auto = [r for r in records if r["outcome"] == "auto-import"]

    unsafe = [
        r
        for r in auto
        if r["pred_family"] != r["true_family"] or r["pred_state"] != r["true_state"]
    ]
    phantom = [r for r in auto if not is_ledger_eligible(r["true_family"], r["true_state"])]
    flips = [r for r in auto if r["pred_direction"] != r["true_direction"]]

    eligible = [r for r in records if is_ledger_eligible(r["true_family"], r["true_state"])]
    safe_auto = [
        r
        for r in auto
        if r["pred_family"] == r["true_family"] and r["pred_state"] == r["true_state"]
    ]
    safe_eligible_auto = [r for r in safe_auto if is_ledger_eligible(r["true_family"], r["true_state"])]

    # A refusal is correct when the item genuinely must not create a ledger row.
    refused = [r for r in records if r["outcome"] == "refuse"]
    wrongly_refused = [r for r in refused if is_ledger_eligible(r["true_family"], r["true_state"])]

    return {
        "n": n,
        "outcomes": dict(outcomes),
        "auto_import_rate": _acc(len(auto), n),
        "unsafe_auto_imports": len(unsafe),
        "unsafe_auto_import_rate": _acc(len(unsafe), n),
        "phantom_auto_imports": len(phantom),
        "direction_flip_auto_imports": len(flips),
        "auto_import_precision": _acc(len(safe_auto), len(auto)) if auto else float("nan"),
        "ledger_eligible_n": len(eligible),
        "safe_auto_import_coverage": _acc(len(safe_eligible_auto), len(eligible)),
        "review_rate": _acc(outcomes.get("review", 0), n),
        "refuse_rate": _acc(outcomes.get("refuse", 0), n),
        "wrongly_refused": len(wrongly_refused),
        "wrongly_refused_rate": _acc(len(wrongly_refused), len(eligible)),
        "unsafe_examples": [
            {
                "text": r["text"][:160],
                "true": f'{r["true_family"]}|{r["true_state"]}',
                "pred": f'{r["pred_family"]}|{r["pred_state"]}',
                "confidence": r.get("confidence"),
                "evidence": r.get("evidence", []),
            }
            for r in unsafe[:25]
        ],
    }


def confusion_top(records: list[dict], k: int = 12) -> list[dict]:
    counter = Counter(
        (f'{r["true_family"]}|{r["true_state"]}', f'{r["pred_family"]}|{r["pred_state"]}')
        for r in records
        if r["pred_family"] != r["true_family"] or r["pred_state"] != r["true_state"]
    )
    return [
        {"true": true, "pred": pred, "count": count}
        for (true, pred), count in counter.most_common(k)
    ]


def latency_report(samples_ms: list[float]) -> dict:
    if not samples_ms:
        return {}
    ordered = sorted(samples_ms)

    def pct(p: float) -> float:
        idx = min(len(ordered) - 1, max(0, math.ceil(p * len(ordered)) - 1))
        return ordered[idx]

    return {
        "n": len(ordered),
        "mean_ms": sum(ordered) / len(ordered),
        "p50_ms": pct(0.50),
        "p95_ms": pct(0.95),
        "p99_ms": pct(0.99),
        "max_ms": ordered[-1],
    }
