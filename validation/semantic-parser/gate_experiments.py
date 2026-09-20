#!/usr/bin/env python3
"""Compare auto-import gate policies over cached model probabilities.

``run_benchmark.py --dump-proba`` writes each model's per-split probability
matrix.  This script reads those and explores gate designs without refitting
anything, so the expensive part (training) happens once and the policy
question -- *what has to be true before Wafra writes a row by itself?* -- can
be answered many times.

Every policy is tuned on the MSA+PAL validation split under one objective:
zero unsafe auto-imports first, then maximum safe coverage.  It is then
evaluated once, untouched, on each dialect test set.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np

import deterministic
import metrics as metrics_mod
from arb_data import load_split
from gate import GateConfig, decide, select_thresholds, top2
from wafra_taxonomy import HIGH_RISK_INTENTS, MAPPING_VERSION, is_ledger_eligible, project

HERE = Path(__file__).parent
RESULTS = HERE / "results"
EVAL_SPLITS = ("msa", "pal", "saudi", "moroccan", "tunisian")


def load_proba(tag: str, model: str) -> tuple[tuple[str, ...], dict[str, np.ndarray]]:
    path = RESULTS / f"proba-{tag}-{model.replace(':', '_').replace('/', '_')}.npz"
    blob = np.load(path, allow_pickle=False)
    labels = tuple(str(x) for x in blob["labels"])
    return labels, {k[len("proba_") :]: blob[k] for k in blob.files if k.startswith("proba_")}


def ensemble(matrices: list[np.ndarray]) -> np.ndarray:
    """Plain probability average.  No weights -- nothing tuned it."""
    stacked = np.stack(matrices)
    return stacked.mean(axis=0).astype(np.float32)


def run_policy(
    rows,
    proba: np.ndarray,
    labels: tuple[str, ...],
    secondary: list[str | None],
    config: GateConfig,
    *,
    state_rules,
    family_rules,
) -> list[dict]:
    records = []
    for i, row in enumerate(rows):
        intent, conf, margin = top2(proba[i], labels)
        verdict = decide(
            row.text,
            primary_intent=intent,
            confidence=conf,
            margin=margin,
            secondary_intent=secondary[i],
            state_rules=state_rules,
            family_rules=family_rules,
            config=config,
        )
        records.append(
            {
                "text": row.text,
                "outcome": verdict["outcome"],
                "reason": verdict["reason"],
                "evidence": verdict["evidence"],
                "pred_intent": intent,
                "true_intent": row.intent_en,
                "pred_family": verdict["family"],
                "pred_state": verdict["state"],
                "pred_direction": verdict["direction"],
                "true_family": row.family,
                "true_state": row.state,
                "true_direction": row.direction,
                "confidence": verdict["confidence"],
                "high_risk": row.intent_en in HIGH_RISK_INTENTS,
            }
        )
    return records


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", required=True, help="tag used by run_benchmark --dump-proba")
    parser.add_argument("--primary", default="linear")
    parser.add_argument("--secondary", default="charcnn")
    parser.add_argument("--third", default="", help="optional third model for unanimity")
    parser.add_argument("--out", default="")
    args = parser.parse_args()

    val = load_split("val", purpose="train")
    tests = {name: load_split(name, purpose="evaluate") for name in EVAL_SPLITS}
    rules = deterministic.load_rules(RESULTS / "evidence-rules.json")

    p_labels, p_proba = load_proba(args.tag, args.primary)
    s_labels, s_proba = load_proba(args.tag, args.secondary)
    third = None
    if args.third:
        third = load_proba(args.tag, args.third)

    def intents_from(labels, proba, split):
        return [labels[int(i)] for i in proba[split].argmax(1)]

    ens_labels, ens_proba = p_labels, {}
    if s_labels == p_labels:
        ens_proba = {
            split: ensemble([p_proba[split], s_proba[split]]) for split in p_proba
        }

    policies: dict[str, dict] = {
        "A-confidence-only": {
            "proba": p_proba,
            "labels": p_labels,
            "secondary": None,
            "base": GateConfig(require_agreement=False, require_family_corroboration=False,
                               honour_state_veto=False),
            "search_corroboration": False,
            "description": "one model, confidence and margin only -- the control",
        },
        "B-deterministic-veto": {
            "proba": p_proba,
            "labels": p_labels,
            "secondary": None,
            "base": GateConfig(require_agreement=False, require_family_corroboration=False,
                               honour_state_veto=True),
            "search_corroboration": False,
            "description": "one model plus the auditable non-posting marker veto",
        },
        "C-independent-agreement": {
            "proba": p_proba,
            "labels": p_labels,
            "secondary": args.secondary,
            "base": GateConfig(require_agreement=True, require_family_corroboration=False,
                               honour_state_veto=False),
            "search_corroboration": False,
            "description": "two independent models must agree on family and state",
        },
        "D-hybrid": {
            "proba": p_proba,
            "labels": p_labels,
            "secondary": args.secondary,
            "base": GateConfig(require_agreement=True, require_family_corroboration=True,
                               honour_state_veto=True),
            "search_corroboration": True,
            "description": "agreement + marker veto + optional family corroboration",
        },
    }
    policies["F-deterministic-evidence-required"] = {
        "proba": p_proba,
        "labels": p_labels,
        "secondary": args.secondary,
        "base": GateConfig(require_agreement=True, require_family_corroboration=False,
                           honour_state_veto=True, require_financial_evidence=True),
        "search_corroboration": False,
        "description": (
            "hybrid plus an exactly extracted amount whose role is unambiguous "
            "for the proposed family -- the deterministic-first design"
        ),
    }
    if ens_proba:
        policies["E-ensemble-hybrid"] = {
            "proba": ens_proba,
            "labels": ens_labels,
            "secondary": args.secondary,
            "base": GateConfig(require_agreement=True, require_family_corroboration=True,
                               honour_state_veto=True),
            "search_corroboration": True,
            "description": "averaged probabilities, then the hybrid gate",
        }

    report: dict = {
        "experiment": "gate-policy-comparison",
        "tag": args.tag,
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "mapping_version": MAPPING_VERSION,
        "primary": args.primary,
        "secondary": args.secondary,
        "tuning_split": "MSA_PAL_val",
        "objective": "zero unsafe auto-imports on val, then maximum safe coverage",
        "policies": {},
    }

    for name, spec in policies.items():
        sec_val = (
            intents_from(s_labels, s_proba, "val") if spec["secondary"] else [None] * len(val)
        )
        tuning = select_thresholds(
            val,
            spec["proba"]["val"],
            spec["labels"],
            sec_val,
            state_rules=rules["state"],
            family_rules=rules["family"],
            base=spec["base"],
            grid_family_corroboration=(True, False) if spec["search_corroboration"] else None,
        )
        config = GateConfig(**tuning["selected"])

        entry = {
            "description": spec["description"],
            "selected_config": tuning["selected"],
            "val": tuning["selected_val_metrics"],
            "zero_unsafe_configs_on_val": tuning["zero_unsafe_configs_on_val"],
            "splits": {},
        }
        for split, rows in tests.items():
            sec = (
                intents_from(s_labels, s_proba, split)
                if spec["secondary"]
                else [None] * len(rows)
            )
            records = run_policy(
                rows, spec["proba"][split], spec["labels"], sec, config,
                state_rules=rules["state"], family_rules=rules["family"],
            )
            high_risk = [r for r in records if r["high_risk"]]
            entry["splits"][split] = {
                "semantic": metrics_mod.semantic_report(records),
                "gate": metrics_mod.gate_report(records),
                "gate_high_risk": metrics_mod.gate_report(high_risk) if high_risk else None,
                "abstain_reasons": _reasons(records),
            }
            g = entry["splits"][split]["gate"]
            print(
                f"{name:22s} {split:9s} auto={g['auto_import_rate']:.3f} "
                f"unsafe={g['unsafe_auto_imports']:3d} phantom={g['phantom_auto_imports']:3d} "
                f"coverage={g['safe_auto_import_coverage']:.3f}",
                flush=True,
            )
        report["policies"][name] = entry
        print("", flush=True)

    out = Path(args.out) if args.out else RESULTS / f"gate-policies-{args.tag}.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=float), encoding="utf-8")
    print(f"wrote {out}")
    return 0


def _reasons(records: list[dict]) -> dict:
    from collections import Counter

    counts = Counter(r["reason"] for r in records if r["outcome"] != "auto-import")
    return dict(counts.most_common(12))


if __name__ == "__main__":
    raise SystemExit(main())
