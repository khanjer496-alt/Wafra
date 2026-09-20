#!/usr/bin/env python3
"""Render a benchmark result JSON as the markdown tables used in the writeup."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

SPLIT_ORDER = ("msa", "pal", "saudi", "moroccan", "tunisian")
SEEN = {"msa": "seen", "pal": "seen", "saudi": "HELD OUT", "moroccan": "HELD OUT", "tunisian": "HELD OUT"}


def pct(value) -> str:
    if value is None:
        return "-"
    try:
        return f"{float(value) * 100:.2f}%"
    except (TypeError, ValueError):
        return "-"


def num(value, digits: int = 3) -> str:
    if value is None:
        return "-"
    try:
        return f"{float(value):.{digits}f}"
    except (TypeError, ValueError):
        return "-"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("result")
    parser.add_argument("--subset", default="all", choices=("all", "high_risk_subset"))
    args = parser.parse_args()

    payload = json.loads(Path(args.result).read_text(encoding="utf-8"))
    models = payload["models"]

    print(f"# {payload['experiment']} — tag `{payload['tag']}`")
    print(f"\nseed {payload['seed']} · mapping {payload['mapping_version']} · {payload['created']}")
    print(f"\ntrain `{payload['train_split']}` · tuning `{payload['tuning_split']}`")
    print(f"sealed: {', '.join(payload['sealed_dialect_splits'])}\n")

    print("## Cost")
    print("\n| model | params | artifact | fit | batch-1 p50 | batch-1 p95 |")
    print("|---|---|---|---|---|---|")
    for name, entry in models.items():
        size = entry["size"]
        params = size.get("parameters")
        artifact = size.get("estimated_int8_total") or size.get("serialized_bytes")
        lat = entry["latency_batch1_cpu"]
        print(
            f"| {name} | {params if params else '-'} | {artifact / 1e6:.2f} MB | "
            f"{entry['fit_seconds']:.0f}s | {num(lat.get('p50_ms'), 2)} ms | {num(lat.get('p95_ms'), 2)} ms |"
        )

    key = args.subset
    print(f"\n## Semantic accuracy ({'full test set' if key == 'all' else 'high-risk subset'})")
    print("\n| model | split | | n | family | state | joint | direction | intent |")
    print("|---|---|---|---|---|---|---|---|---|")
    for name, entry in models.items():
        for split in SPLIT_ORDER:
            block = entry["splits"][split]["hybrid_gate"][key]
            if not block:
                continue
            print(
                f"| {name} | {split} | {SEEN[split]} | {block['n']} | "
                f"{pct(block['family_accuracy'])} | {pct(block['state_accuracy'])} | "
                f"{pct(block['joint_accuracy'])} | {pct(block['direction_accuracy'])} | "
                f"{pct(block['intent_accuracy'])} |"
            )

    print("\n## Gate safety — hybrid (evidence + agreement + confidence + margin)")
    print("\n| model | split | | auto | unsafe | phantom | flips | safe coverage | review | refuse |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for name, entry in models.items():
        for split in SPLIT_ORDER:
            g = entry["splits"][split]["hybrid_gate"]["gate"]
            print(
                f"| {name} | {split} | {SEEN[split]} | {pct(g['auto_import_rate'])} | "
                f"**{g['unsafe_auto_imports']}** | {g['phantom_auto_imports']} | "
                f"{g['direction_flip_auto_imports']} | {pct(g['safe_auto_import_coverage'])} | "
                f"{pct(g['review_rate'])} | {pct(g['refuse_rate'])} |"
            )

    print("\n## Gate safety — confidence-only control")
    print("\n| model | split | | auto | unsafe | phantom | safe coverage |")
    print("|---|---|---|---|---|---|---|")
    for name, entry in models.items():
        for split in SPLIT_ORDER:
            g = entry["splits"][split]["confidence_only_gate"]["gate"]
            print(
                f"| {name} | {split} | {SEEN[split]} | {pct(g['auto_import_rate'])} | "
                f"**{g['unsafe_auto_imports']}** | {g['phantom_auto_imports']} | "
                f"{pct(g['safe_auto_import_coverage'])} |"
            )

    print("\n## Calibration")
    print("\n| model | split | ECE | MCE | Brier | conf>=0.90 and wrong |")
    print("|---|---|---|---|---|---|")
    for name, entry in models.items():
        for split in SPLIT_ORDER:
            c = entry["splits"][split]["hybrid_gate"]["calibration"]
            print(
                f"| {name} | {split} | {num(c['ece'])} | {num(c['mce'])} | {num(c['brier'])} | "
                f"{c['overconfident_wrong_at_0.90']} / {c['n']} "
                f"({pct(c['overconfident_wrong_rate'])}) |"
            )

    print("\n## Selected gate thresholds (fitted on MSA+PAL val)")
    print("\n| model | confidence | margin | agreement | family evidence | state veto | val unsafe | val coverage |")
    print("|---|---|---|---|---|---|---|---|")
    for name, entry in models.items():
        t = entry["gate_tuning_on_val"]["hybrid"]
        c, m = t["selected"], t["selected_val_metrics"]
        print(
            f"| {name} | {c['confidence_threshold']} | {c['margin_threshold']} | "
            f"{c['require_agreement']} | {c['require_family_corroboration']} | "
            f"{c['honour_state_veto']} | {m['unsafe_auto_imports']} | "
            f"{pct(m['safe_auto_import_coverage'])} |"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
