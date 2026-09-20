#!/usr/bin/env python3
"""Wafra local semantic parser benchmark on real ArBanking77 data.

Train on the real MSA+Palestinian split, tune only on the MSA+PAL validation
split, then evaluate once, untouched, on the Saudi / Moroccan / Tunisian
dialect test sets.

Usage:
    python run_benchmark.py --models linear,centroid,charcnn --tag cpu-run-1
    python run_benchmark.py --models linear,charcnn,geotrend-ft --tag full

Every run writes a self-describing JSON to ``results/`` containing the exact
configuration, seeds, dataset digests and metrics, so another session can
compare without re-deriving anything.
"""

from __future__ import annotations

import argparse
import json
import platform
import random
import sys
import time
from dataclasses import asdict
from pathlib import Path

import numpy as np
import torch

import deterministic
import gate as gate_mod
import metrics as metrics_mod
from arb_data import UNSEEN_DIALECTS, dataset_provenance, load_split, split_digest
from models import ByteCharCNN, CharCNNConfig, CharNGramCentroid, CharNGramLinear, set_all_seeds
from wafra_taxonomy import HIGH_RISK_INTENTS, MAPPING_VERSION, is_ledger_eligible, project

HERE = Path(__file__).parent
RESULTS = HERE / "results"
EVAL_SPLITS = ("msa", "pal", "saudi", "moroccan", "tunisian")
SEED = 20260920


# --------------------------------------------------------------------------


def build_model(name: str):
    if name == "linear":
        return CharNGramLinear(ngram_range=(2, 5), min_df=2, C=12.0, max_features=300_000, seed=SEED)
    if name == "linear-robust":
        # Representation chosen on the MSA<->PAL transfer proxy, not on any
        # sealed dialect split: see results/dialect-shift-dev-v1.json.
        return CharNGramLinear(
            ngram_range=(2, 5), min_df=2, C=12.0, max_features=300_000,
            fold_orthography=True, augment_copies=1, augment_rate=0.08, seed=SEED,
        )
    if name == "centroid":
        return CharNGramCentroid(seed=SEED)
    if name == "charcnn":
        return ByteCharCNN(CharCNNConfig(seed=SEED))
    if name == "charcnn-tiny":
        return ByteCharCNN(
            CharCNNConfig(embed_dim=32, channels=64, hidden=96, epochs=30, seed=SEED)
        )
    if name.startswith("hf:"):
        from pretrained import PretrainedEncoderClassifier

        _, model_id, mode = name.split(":", 2)
        return PretrainedEncoderClassifier(model_id, mode=mode, seed=SEED)
    raise KeyError(f"unknown model {name!r}")


def measure_latency(model, texts: list[str], repeats: int = 200) -> dict:
    """Batch-1 CPU latency on the real inference path."""
    torch.set_num_threads(1)
    rng = random.Random(SEED)
    sample = [rng.choice(texts) for _ in range(repeats)]
    for text in sample[:10]:  # warm up
        model.predict_proba([text])
    timings = []
    for text in sample:
        started = time.perf_counter()
        model.predict_proba([text])
        timings.append((time.perf_counter() - started) * 1000.0)
    torch.set_num_threads(4)
    return metrics_mod.latency_report(timings)


def records_for(rows, proba, labels, *, secondary_intents=None, config=None,
                state_rules=None, family_rules=None) -> list[dict]:
    out = []
    for i, row in enumerate(rows):
        intent, conf, margin = gate_mod.top2(proba[i], labels)
        family, state, direction = project(intent)
        record = {
            "text": row.text,
            "true_intent": row.intent_en,
            "pred_intent": intent,
            "true_family": row.family,
            "true_state": row.state,
            "true_direction": row.direction,
            "pred_family": family,
            "pred_state": state,
            "pred_direction": direction,
            "confidence": float(conf),
            "margin": float(margin),
            "high_risk": row.intent_en in HIGH_RISK_INTENTS,
            "ledger_eligible": is_ledger_eligible(row.family, row.state),
        }
        if config is not None:
            verdict = gate_mod.decide(
                row.text,
                primary_intent=intent,
                confidence=conf,
                margin=margin,
                secondary_intent=None if secondary_intents is None else secondary_intents[i],
                state_rules=state_rules,
                family_rules=family_rules,
                config=config,
            )
            record["outcome"] = verdict["outcome"]
            record["reason"] = verdict["reason"]
            record["evidence"] = verdict["evidence"]
            record["safety_blockers"] = verdict["safety_blockers"]
        out.append(record)
    return out


def evaluate_records(records: list[dict]) -> dict:
    high_risk = [r for r in records if r["high_risk"]]
    payload = {
        "all": metrics_mod.semantic_report(records),
        "high_risk_subset": metrics_mod.semantic_report(high_risk) if high_risk else None,
        "calibration": metrics_mod.calibration_report(records),
        "top_confusions": metrics_mod.confusion_top(records),
    }
    if "outcome" in records[0]:
        payload["gate"] = metrics_mod.gate_report(records)
        payload["gate_high_risk"] = metrics_mod.gate_report(high_risk) if high_risk else None
    return payload


# --------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", default="linear,centroid,charcnn")
    parser.add_argument("--secondary", default="charcnn",
                        help="model used for independent agreement in the hybrid gate")
    parser.add_argument("--tag", default="run")
    parser.add_argument("--latency-repeats", type=int, default=200)
    parser.add_argument("--rules", default="", help="reuse a saved evidence-rules JSON")
    parser.add_argument(
        "--dump-proba",
        action="store_true",
        help="also write each model's per-split probability matrix, so gate "
        "policy can be explored later without refitting anything",
    )
    args = parser.parse_args()

    set_all_seeds(SEED)
    RESULTS.mkdir(exist_ok=True)

    train = load_split("train", purpose="train")
    val = load_split("val", purpose="train")
    tests = {name: load_split(name, purpose="evaluate") for name in EVAL_SPLITS}

    # ---- deterministic evidence layer (mined on train, audited on val) ----
    rules_path = Path(args.rules) if args.rules else RESULTS / "evidence-rules.json"
    if rules_path.exists() and args.rules:
        rules = deterministic.load_rules(rules_path)
        print(f"loaded evidence rules from {rules_path}", flush=True)
    else:
        started = time.time()
        rules = {
            "state": deterministic.EvidenceRules.mine("state", train, val),
            "family": deterministic.EvidenceRules.mine("family", train, val),
        }
        deterministic.save_rules(rules, rules_path)
        print(
            f"mined evidence rules in {time.time() - started:.0f}s "
            f"(state={rules['state'].marker_count()} family={rules['family'].marker_count()}) "
            f"-> {rules_path}",
            flush=True,
        )

    names = [n.strip() for n in args.models.split(",") if n.strip()]
    fitted: dict[str, object] = {}
    proba_cache: dict[str, dict[str, np.ndarray]] = {}

    for name in names:
        started = time.time()
        print(f"\n=== fitting {name} ===", flush=True)
        model = build_model(name)
        model.fit(train, val)
        fit_seconds = time.time() - started
        fitted[name] = model
        proba_cache[name] = {"val": model.predict_proba([r.text for r in val])}
        for split, rows in tests.items():
            t0 = time.time()
            proba_cache[name][split] = model.predict_proba([r.text for r in rows])
            print(f"  scored {split} ({len(rows)}) in {time.time() - t0:.1f}s", flush=True)
        model._fit_seconds = fit_seconds  # noqa: SLF001 - recorded in the result file
        print(f"  fit in {fit_seconds:.0f}s", flush=True)
        if args.dump_proba:
            path = RESULTS / f"proba-{args.tag}-{name.replace(':', '_').replace('/', '_')}.npz"
            np.savez_compressed(
                path,
                labels=np.array(model.labels),
                **{f"proba_{split}": matrix for split, matrix in proba_cache[name].items()},
            )
            print(f"  wrote {path.name}", flush=True)

    secondary_name = args.secondary if args.secondary in fitted else None
    if secondary_name is None and args.secondary:
        print(f"WARNING: secondary model {args.secondary!r} not fitted; "
              "hybrid gate falls back to no-agreement", file=sys.stderr)

    def secondary_intents(split: str, n: int) -> list[str | None]:
        if secondary_name is None:
            return [None] * n
        model = fitted[secondary_name]
        proba = proba_cache[secondary_name][split]
        return [model.labels[int(i)] for i in proba.argmax(1)]

    summary: dict = {
        "experiment": "arbanking77-dialect-holdout",
        "tag": args.tag,
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "seed": SEED,
        "mapping_version": MAPPING_VERSION,
        "train_split": "Banking77_Arabized_MSA_PAL_train.csv",
        "tuning_split": "Banking77_Arabized_MSA_PAL_val.csv",
        "sealed_dialect_splits": list(UNSEEN_DIALECTS),
        "digests": {
            "train": split_digest(train),
            "val": split_digest(val),
            **{name: split_digest(rows) for name, rows in tests.items()},
        },
        "dataset": dataset_provenance(),
        "environment": {
            "python": platform.python_version(),
            "torch": torch.__version__,
            "platform": platform.platform(),
        },
        "evidence_rules": {
            "path": str(rules_path.relative_to(HERE)),
            "state_markers": rules["state"].marker_count(),
            "family_markers": rules["family"].marker_count(),
        },
        "models": {},
    }

    for name in names:
        model = fitted[name]
        print(f"\n=== evaluating {name} ===", flush=True)

        # Threshold selection: MSA+PAL val only, never a dialect split.
        hybrid_base = gate_mod.GateConfig(
            require_agreement=secondary_name is not None and secondary_name != name,
            require_family_corroboration=True,
        )
        tuning = gate_mod.select_thresholds(
            val,
            proba_cache[name]["val"],
            model.labels,
            secondary_intents("val", len(val)) if hybrid_base.require_agreement else [None] * len(val),
            state_rules=rules["state"],
            family_rules=rules["family"],
            base=hybrid_base,
            grid_family_corroboration=(True, False),
        )
        hybrid_cfg = gate_mod.GateConfig(**tuning["selected"])

        # Confidence-only control, to show what the handoff warned about.
        conf_base = gate_mod.GateConfig(
            require_agreement=False, require_family_corroboration=False, honour_state_veto=False
        )
        conf_tuning = gate_mod.select_thresholds(
            val,
            proba_cache[name]["val"],
            model.labels,
            [None] * len(val),
            state_rules=None,
            family_rules=None,
            base=conf_base,
        )
        conf_cfg = gate_mod.GateConfig(**conf_tuning["selected"])

        entry: dict = {
            "config": model.describe(),
            "fit_seconds": getattr(model, "_fit_seconds", None),
            "size": {
                "serialized_bytes": model.size_bytes(),
                **(model.deployable_bytes() if hasattr(model, "deployable_bytes") else {}),
                **({"parameters": model.parameter_count()} if hasattr(model, "parameter_count") else {}),
            },
            "latency_batch1_cpu": measure_latency(
                model, [r.text for r in tests["saudi"]], repeats=args.latency_repeats
            ),
            "gate_tuning_on_val": {
                "hybrid": {k: tuning[k] for k in ("selected", "selected_val_metrics", "zero_unsafe_configs_on_val")},
                "confidence_only": {
                    k: conf_tuning[k]
                    for k in ("selected", "selected_val_metrics", "zero_unsafe_configs_on_val")
                },
            },
            "splits": {},
        }

        for split, rows in tests.items():
            proba = proba_cache[name][split]
            sec = secondary_intents(split, len(rows)) if hybrid_cfg.require_agreement else [None] * len(rows)

            hybrid_records = records_for(
                rows, proba, model.labels,
                secondary_intents=sec, config=hybrid_cfg,
                state_rules=rules["state"], family_rules=rules["family"],
            )
            conf_records = records_for(
                rows, proba, model.labels,
                secondary_intents=[None] * len(rows), config=conf_cfg,
                state_rules=None, family_rules=None,
            )
            entry["splits"][split] = {
                "n": len(rows),
                "hybrid_gate": evaluate_records(hybrid_records),
                "confidence_only_gate": {
                    "gate": metrics_mod.gate_report(conf_records),
                    "calibration": metrics_mod.calibration_report(conf_records),
                },
            }
            sem = entry["splits"][split]["hybrid_gate"]["all"]
            g = entry["splits"][split]["hybrid_gate"]["gate"]
            gc = entry["splits"][split]["confidence_only_gate"]["gate"]
            print(
                f"  {split:9s} fam={sem['family_accuracy']:.4f} state={sem['state_accuracy']:.4f} "
                f"joint={sem['joint_accuracy']:.4f} | hybrid unsafe={g['unsafe_auto_imports']} "
                f"cov={g['safe_auto_import_coverage']:.3f} | conf-only unsafe={gc['unsafe_auto_imports']} "
                f"cov={gc['safe_auto_import_coverage']:.3f}",
                flush=True,
            )

        summary["models"][name] = entry

    out = RESULTS / f"benchmark-{args.tag}.json"
    out.write_text(json.dumps(summary, indent=2, ensure_ascii=False, default=float), encoding="utf-8")
    print(f"\nwrote {out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
