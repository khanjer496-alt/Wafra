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

from deterministic import extract_amounts, select_amount_role
from wafra_taxonomy import LEDGER_FAMILIES, project

NON_POSTING_STATES = ("failed", "future", "informational")

# Ask Wafra may be handed these codes and nothing else.
#
# ``evidence`` below records which marker actually matched, which is message
# content: knowing the body contained the word "declined" is knowing part of
# the body.  That stays on device, for debugging and for this benchmark.  The
# codes are a closed vocabulary that describes the *shape* of the decision, so
# an explanation model can say why Wafra did something without ever being told
# what the message said.
RATIONALE_CODES = (
    "posting-wording-present",
    "non-posting-wording-present",
    "family-wording-matches",
    "family-wording-conflicts",
    "no-family-wording",
    "amount-role-unambiguous",
    "amount-role-ambiguous",
    "amount-missing",
    "amount-currency-unknown",
    "models-agree",
    "models-disagree",
    "single-model-only",
    "confidence-high",
    "confidence-medium",
    "confidence-low",
    "margin-narrow",
    "state-not-posted",
    "family-not-ledger",
)


@dataclass(frozen=True)
class GateConfig:
    confidence_threshold: float = 0.90
    margin_threshold: float = 0.20
    require_agreement: bool = True
    require_family_corroboration: bool = True
    honour_state_veto: bool = True
    require_financial_evidence: bool = False

    @property
    def uses_markers(self) -> bool:
        """Whether the auditable marker layer participates at all."""
        return self.honour_state_veto or self.require_family_corroboration

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

    use_markers = config.uses_markers
    state_hits = state_rules.evidence(text) if (state_rules and use_markers) else {}
    family_hits = family_rules.evidence(text) if (family_rules and use_markers) else {}

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

    # 3. Deterministic financial evidence: an exactly extracted amount whose
    # role is unambiguous for the proposed family.  Text that carries no such
    # amount is not a posting alert at all, whatever the model believes.
    amount_index: int | None = None
    amount_reason = "not-required"
    if config.require_financial_evidence:
        candidates = extract_amounts(text)
        amount_index, amount_reason = select_amount_role(candidates, family)
        if amount_index is None:
            blockers.append(f"no-deterministic-amount:{amount_reason}")
        else:
            picked = candidates[amount_index]
            evidence.append(f"amount:{picked.currency or 'unknown-currency'}:{amount_reason}")
            if picked.currency is None:
                blockers.append("amount-without-currency")

    # 4. Independent semantic agreement.
    agreed = False
    if secondary_intent is not None:
        sec_family, sec_state, _ = project(secondary_intent)
        agreed = (sec_family, sec_state) == (family, state)
        if not agreed:
            blockers.append(f"model-disagreement:{sec_family}|{sec_state}")

    # 5. Outcome.
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

    codes: list[str] = []
    if any(s in state_hits for s in NON_POSTING_STATES):
        codes.append("non-posting-wording-present")
    if "posted" in state_hits:
        codes.append("posting-wording-present")
    if family_corroborated:
        codes.append("family-wording-matches")
    elif family_hits:
        codes.append("family-wording-conflicts")
    elif use_markers:
        codes.append("no-family-wording")
    if config.require_financial_evidence:
        if amount_index is not None:
            codes.append("amount-role-unambiguous")
        elif amount_reason == "no-amount":
            codes.append("amount-missing")
        else:
            codes.append("amount-role-ambiguous")
    if secondary_intent is None:
        codes.append("single-model-only")
    else:
        codes.append("models-agree" if agreed else "models-disagree")
    codes.append(f"confidence-{_band(confidence)}")
    if margin < config.margin_threshold:
        codes.append("margin-narrow")
    if state != "posted":
        codes.append("state-not-posted")
    elif family not in LEDGER_FAMILIES:
        codes.append("family-not-ledger")

    unknown = [c for c in codes if c not in RATIONALE_CODES]
    if unknown:  # pragma: no cover - guards the closed vocabulary
        raise ValueError(f"rationale codes outside the published set: {unknown}")

    return {
        "outcome": outcome,
        "reason": reason,
        "rationale_codes": codes,
        "family": family,
        "state": state,
        "direction": direction,
        "confidence": float(confidence),
        "margin": float(margin),
        "confidence_band": _band(confidence),
        # Local only: contains matched marker text.  Never crosses a network
        # boundary; Ask Wafra receives ``rationale_codes`` instead.
        "evidence": evidence[:8],
        "safety_blockers": blockers,
        "independent_agreement": agreed,
        "family_corroborated": family_corroborated,
        "selected_amount_index": amount_index,
        "amount_selection": amount_reason,
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
    grid_family_corroboration=None,
) -> dict:
    """Choose the gate settings on val: zero unsafe imports, then max coverage.

    Searches confidence, margin and -- when the caller offers the choice --
    whether a deterministic family marker is required.  Marker mining showed
    the safety-critical families carry almost no high-precision markers, so
    forcing corroboration can cost most of the coverage while buying no
    safety.  Let validation decide rather than asserting it.

    Runs only on the MSA+PAL validation split.  Ties break toward the more
    conservative gate: require corroboration first, then the larger margin.
    """
    from metrics import gate_report

    corroboration_options = (
        grid_family_corroboration
        if grid_family_corroboration is not None
        else (base.require_family_corroboration,)
    )
    trials = []
    trial_space = [
        (tau, margin_min, corroborate)
        for tau in grid_confidence
        for margin_min in grid_margin
        for corroborate in corroboration_options
    ]
    for tau, margin_min, corroborate in trial_space:
        config = GateConfig(
            confidence_threshold=tau,
            margin_threshold=margin_min,
            require_agreement=base.require_agreement,
            require_family_corroboration=corroborate,
            honour_state_veto=base.honour_state_veto,
            require_financial_evidence=base.require_financial_evidence,
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
            not t["config"]["require_family_corroboration"],
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
