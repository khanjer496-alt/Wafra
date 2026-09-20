#!/usr/bin/env python3
"""The auto-import safety gate.

The product requirement this benchmark exists to test is not accuracy:

    unsafe auto-imports == 0, with safe automatic coverage pushed toward 90%.

So the gate never trusts a single confidence number.  An auto-import needs
**all** of:

* the primary model predicts a posted, ledger-affecting family;
* an independent second model agrees on family *and* state;
* the deterministic marker layer raises no veto;
* confidence and top-1/top-2 margin clear thresholds chosen on MSA+PAL val.

Everything else becomes ``review`` (a person confirms) or ``refuse`` (the
message is not a ledger event at all).  Thresholds are fitted only on val;
:func:`select_thresholds` never sees a dialect split.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

from wafra_taxonomy import LEDGER_FAMILIES, project

NON_POSTING_STATES = ("failed", "future", "informational")


@dataclass(frozen=True)
class GateConfig:
    confidence_threshold: float = 0.90
    margin_threshold: float = 0.20
    require_agreement: bool = True
    require_family_corroboration: bool = True
    honour_state_veto: bool = True

    def to_json(self) -> dict:
        return asdict(self)


def _band(confidence: float) -> str:
    if confidence >= 0.90:
        return "high"
    if confidence >= 0.60:
        return "medium"
    return "low"


def decide(
    text: str,
    *,
    primary_intent: str,
    confidence: float,
    margin: float,
    secondary_intent: str | None,
    state_rules=None,
    family_rules=None,
    config: GateConfig,
) -> dict:
    """Return the structured rationale Ask Wafra is allowed to see.

    The returned dict deliberately contains no raw SMS beyond what the caller
    already holds, no account or card identifiers, and no ledger authority --
    it is a decision record, not an instruction.
    """
    family, state, direction = project(primary_intent)
    evidence: list[str] = []
    blockers: list[str] = []

    state_hits = state_rules.evidence(text) if state_rules else {}
    family_hits = family_rules.evidence(text) if family_rules else {}

    for label, hits in state_hits.items():
        evidence.extend(f"state:{label}:{h}" for h in hits[:2])
    for label, hits in family_hits.items():
        evidence.extend(f"family:{label}:{h}" for h in hits[:2])

    # 1. Deterministic veto: wording that says this did not post.
    if config.honour_state_veto and state == "posted":
        vetoes = [s for s in NON_POSTING_STATES if s in state_hits]
        if vetoes:
            blockers.append(f"deterministic-non-posting-marker:{'/'.join(sorted(vetoes))}")

    # 2. Deterministic corroboration: the family must not be contradicted.
    family_corroborated = family in family_hits
    if family_hits and not family_corroborated:
        strongest = max(family_hits, key=lambda k: len(family_hits[k]))
        if strongest != family:
            blockers.append(f"family-evidence-conflict:{strongest}")

    # 3. Independent semantic agreement.
    agreed = False
    if secondary_intent is not None:
        sec_family, sec_state, _ = project(secondary_intent)
        agreed = (sec_family, sec_state) == (family, state)
        if not agreed:
            blockers.append(f"model-disagreement:{sec_family}|{sec_state}")

    # 4. Outcome.
    if state != "posted":
        outcome = "refuse"
        reason = f"non-posting-state:{state}"
    elif family not in LEDGER_FAMILIES:
        outcome = "refuse"
        reason = f"non-ledger-family:{family}"
    elif blockers:
        outcome = "review"
        reason = blockers[0]
    elif confidence < config.confidence_threshold:
        outcome = "review"
        reason = "below-confidence-threshold"
    elif margin < config.margin_threshold:
        outcome = "review"
        reason = "below-margin-threshold"
    elif config.require_agreement and secondary_intent is None:
        outcome = "review"
        reason = "no-independent-agreement-available"
    elif config.require_family_corroboration and not family_corroborated:
        outcome = "review"
        reason = "no-deterministic-family-evidence"
    else:
        outcome = "auto-import"
        reason = "agreed-corroborated-confident"

    return {
        "outcome": outcome,
        "reason": reason,
        "family": family,
        "state": state,
        "direction": direction,
        "confidence": float(confidence),
        "margin": float(margin),
        "confidence_band": _band(confidence),
        "evidence": evidence[:8],
        "safety_blockers": blockers,
        "independent_agreement": agreed,
        "family_corroborated": family_corroborated,
    }


def top2(proba_row: np.ndarray, labels: tuple[str, ...]) -> tuple[str, float, float]:
    order = np.argsort(-proba_row)
    best = float(proba_row[order[0]])
    second = float(proba_row[order[1]]) if len(order) > 1 else 0.0
    return labels[int(order[0])], best, best - second


def select_thresholds(
    val_rows,
    primary_proba: np.ndarray,
    primary_labels: tuple[str, ...],
    secondary_intents: list[str | None],
    *,
    state_rules,
    family_rules,
    base: GateConfig,
    grid_confidence=(0.50, 0.60, 0.70, 0.80, 0.85, 0.90, 0.95, 0.97, 0.99),
    grid_margin=(0.0, 0.05, 0.10, 0.20, 0.30, 0.50),
) -> dict:
    """Choose (confidence, margin) on val: zero unsafe imports, max coverage.

    Runs only on the MSA+PAL validation split.  Ties break toward the larger
    margin, i.e. the more conservative gate.
    """
    from metrics import gate_report

    trials = []
    for tau in grid_confidence:
        for margin_min in grid_margin:
            config = GateConfig(
                confidence_threshold=tau,
                margin_threshold=margin_min,
                require_agreement=base.require_agreement,
                require_family_corroboration=base.require_family_corroboration,
                honour_state_veto=base.honour_state_veto,
            )
            records = []
            for i, row in enumerate(val_rows):
                intent, conf, margin = top2(primary_proba[i], primary_labels)
                verdict = decide(
                    row.text,
                    primary_intent=intent,
                    confidence=conf,
                    margin=margin,
                    secondary_intent=secondary_intents[i],
                    state_rules=state_rules,
                    family_rules=family_rules,
                    config=config,
                )
                records.append(
                    {
                        "text": row.text,
                        "outcome": verdict["outcome"],
                        "pred_family": verdict["family"],
                        "pred_state": verdict["state"],
                        "pred_direction": verdict["direction"],
                        "true_family": row.family,
                        "true_state": row.state,
                        "true_direction": row.direction,
                        "confidence": verdict["confidence"],
                    }
                )
            report = gate_report(records)
            trials.append(
                {
                    "config": config.to_json(),
                    "unsafe_auto_imports": report["unsafe_auto_imports"],
                    "safe_auto_import_coverage": report["safe_auto_import_coverage"],
                    "auto_import_rate": report["auto_import_rate"],
                }
            )

    clean = [t for t in trials if t["unsafe_auto_imports"] == 0]
    pool = clean or trials
    pool.sort(
        key=lambda t: (
            t["unsafe_auto_imports"],
            -t["safe_auto_import_coverage"],
            -t["config"]["margin_threshold"],
        )
    )
    return {
        "selected": pool[0]["config"],
        "selected_val_metrics": {
            k: pool[0][k] for k in ("unsafe_auto_imports", "safe_auto_import_coverage", "auto_import_rate")
        },
        "zero_unsafe_configs_on_val": len(clean),
        "trials": trials,
    }
