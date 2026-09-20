#!/usr/bin/env python3
"""Amount-role safety benchmark for the deterministic extraction layer.

Separate from the semantic benchmark on purpose.  ArBanking77 utterances are
customer questions and carry essentially no money amounts, so they cannot test
the thing that actually corrupts a ledger: picking the *available balance*,
*credit limit*, *statement total* or *minimum due* instead of the transaction
amount.

Corpus: Wafra's own privacy-safe bank-alert fixtures (``scripts/test/fixtures``).
Those rows are near-real templates and standard-derived reconstructions, not
consented customer evidence, and this script does not treat them as such --
they are a decoy stress test for a rule layer, never training data.

The pass bar is the acceptance gate from the handoff: an amount is either
extracted exactly or not selected at all.  A wrong selection is a hard failure
no matter how rare.
"""

from __future__ import annotations

import argparse
import json
import time
from collections import Counter
from pathlib import Path

from deterministic import extract_amounts, select_amount_role

HERE = Path(__file__).parent
RESULTS = HERE / "results"


def run(rows: list[dict], *, use_family: bool = False) -> dict:
    per_row = []
    timings = []
    for row in rows:
        expected = row["expected"]
        started = time.perf_counter()
        candidates = extract_amounts(row["body"])
        index, reason = select_amount_role(
            candidates, expected.get("family") if use_family else None
        )
        timings.append((time.perf_counter() - started) * 1000.0)

        want_minor = expected.get("minorUnits")
        want_currency = expected.get("currency")
        decoy_minor = expected.get("decoyMinorUnits")

        selected = candidates[index] if index is not None else None
        got_minor = str(selected.minor_units) if selected else None
        got_currency = selected.currency if selected else None

        amount_ok = selected is not None and want_minor is not None and got_minor == want_minor
        currency_ok = selected is not None and got_currency == want_currency
        picked_decoy = bool(selected and decoy_minor and got_minor == decoy_minor)

        # A candidate whose role is a decoy role is present in the body.
        decoy_present = bool(decoy_minor) or any(
            c.roles and "transaction" not in c.roles for c in candidates
        )

        per_row.append(
            {
                "id": row["id"],
                "corpus": row["corpus"],
                "market": row.get("market"),
                "status": expected.get("status"),
                "reason": reason,
                "selected": selected is not None,
                "amount_correct": amount_ok,
                "currency_correct": currency_ok,
                "picked_decoy": picked_decoy,
                "decoy_present": decoy_present,
                "expected_minor": want_minor,
                "got_minor": got_minor,
                "expected_currency": want_currency,
                "got_currency": got_currency,
                "candidates": [c.as_dict() for c in candidates],
                "body": row["body"][:200],
            }
        )

    selected_rows = [r for r in per_row if r["selected"]]
    wrong = [r for r in selected_rows if not (r["amount_correct"] and r["currency_correct"])]
    wrong_amount = [r for r in selected_rows if not r["amount_correct"]]
    decoy_rows = [r for r in per_row if r["decoy_present"]]
    decoy_selected = [r for r in decoy_rows if r["selected"]]

    return {
        "n": len(per_row),
        "selected": len(selected_rows),
        "selection_rate": len(selected_rows) / len(per_row),
        "abstained": len(per_row) - len(selected_rows),
        "unsafe_selections": len(wrong),
        "unsafe_amount_selections": len(wrong_amount),
        "picked_decoy": sum(1 for r in per_row if r["picked_decoy"]),
        "amount_precision": (len(selected_rows) - len(wrong_amount)) / len(selected_rows)
        if selected_rows
        else None,
        "exact_amount_and_currency_coverage": sum(
            1 for r in per_row if r["amount_correct"] and r["currency_correct"]
        )
        / len(per_row),
        "decoy_subset": {
            "n": len(decoy_rows),
            "selected": len(decoy_selected),
            "unsafe": sum(
                1 for r in decoy_selected if not (r["amount_correct"] and r["currency_correct"])
            ),
            "picked_decoy": sum(1 for r in decoy_rows if r["picked_decoy"]),
        },
        "abstain_reasons": dict(Counter(r["reason"] for r in per_row if not r["selected"])),
        "latency_ms": {
            "mean": sum(timings) / len(timings),
            "p95": sorted(timings)[int(len(timings) * 0.95) - 1],
            "max": max(timings),
        },
        "failures": [r for r in wrong][:40],
        "per_row": per_row,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--fixtures", default=str(RESULTS / "wafra-alert-fixtures.json")
    )
    parser.add_argument("--tag", default="deterministic")
    args = parser.parse_args()

    payload = json.loads(Path(args.fixtures).read_text(encoding="utf-8"))
    rows = payload["rows"]
    report = run(rows)
    report_family = run(rows, use_family=True)

    by_corpus = {}
    for corpus in sorted({r["corpus"] for r in rows}):
        subset = [r for r in rows if r["corpus"] == corpus]
        sub = run(subset, use_family=True)
        by_corpus[corpus] = {k: v for k, v in sub.items() if k not in ("per_row", "failures")}

    out = {
        "experiment": "amount-role-safety",
        "tag": args.tag,
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "corpus_note": (
            "Wafra repository fixtures: privacy-safe near-real templates and "
            "standard-derived reconstructions, not consented customer evidence."
        ),
        "fixture_count": len(rows),
        "overall_family_blind": {k: v for k, v in report.items() if k != "per_row"},
        "overall_family_conditioned": {
            k: v for k, v in report_family.items() if k != "per_row"
        },
        "by_corpus": by_corpus,
        "per_row": report_family["per_row"],
    }
    RESULTS.mkdir(exist_ok=True)
    path = RESULTS / f"amount-role-{args.tag}.json"
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")

    for label, o in (("family-blind", report), ("family-conditioned", report_family)):
        print(
            f"[{label}] rows={o['n']} selected={o['selected']} ({o['selection_rate']:.1%}) "
            f"unsafe={o['unsafe_selections']} picked_decoy={o['picked_decoy']} "
            f"exact_coverage={o['exact_amount_and_currency_coverage']:.1%}"
        )
        print(f"          abstain reasons: {o['abstain_reasons']}")
    o = report_family
    print(
        f"rows={o['n']} selected={o['selected']} ({o['selection_rate']:.1%}) "
        f"unsafe={o['unsafe_selections']} picked_decoy={o['picked_decoy']} "
        f"exact_coverage={o['exact_amount_and_currency_coverage']:.1%}"
    )
    print(f"abstain reasons: {o['abstain_reasons']}")
    for f in o["failures"][:12]:
        print(f"  FAIL {f['id']}: want {f['expected_currency']} {f['expected_minor']} "
              f"got {f['got_currency']} {f['got_minor']} ({f['reason']})")
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
