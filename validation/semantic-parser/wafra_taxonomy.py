#!/usr/bin/env python3
"""Frozen projection from ArBanking77 intents to the Wafra parser contract.

This mapping is derived **only** from the 77 English intent names published in
``Banking77_intents.csv``.  It was written before any Saudi / Moroccan /
Tunisian utterance was inspected and must not be edited in response to
held-out dialect results.  Changing it invalidates every stored benchmark, so
``MAPPING_VERSION`` is bumped and re-runs are required if it ever changes.

Contract families come from ``src/lib/parser-research-contract.ts`` plus two
research-only buckets that the production contract folds into ``unknown``:

``service``   non-ledger card/account servicing wording
``exchange``  FX rate questions

``direction`` is the *intended* direction of the money movement and is
independent of ``state``: a declined outgoing transfer is still ``debit``.
"""

from __future__ import annotations

MAPPING_VERSION = "2026-09-20.1"

# Families that can create a ledger row when the state is ``posted``.
LEDGER_FAMILIES = frozenset(
    {
        "purchase",
        "transfer",
        "cash-withdrawal",
        "refund",
        "fee",
        "recurring-payment",
        "salary",
        "utility",
    }
)

STATES = ("posted", "failed", "future", "informational", "unknown")
DIRECTIONS = ("debit", "credit", "none")

# intent_en -> (family, state, direction)
INTENT_PROJECTION: dict[str, tuple[str, str, str]] = {
    "card arrival": ("service", "informational", "none"),
    "card linking": ("service", "informational", "none"),
    "exchange rate": ("exchange", "informational", "none"),
    "card payment wrong exchange rate": ("purchase", "posted", "debit"),
    "extra charge on statement": ("fee", "posted", "debit"),
    "pending cash withdrawal": ("cash-withdrawal", "future", "debit"),
    "fiat currency support": ("service", "informational", "none"),
    "card delivery estimate": ("service", "informational", "none"),
    "automatic top up": ("recurring-payment", "informational", "credit"),
    "card not working": ("service", "informational", "none"),
    "exchange via app": ("exchange", "informational", "none"),
    "lost or stolen card": ("service", "informational", "none"),
    "age limit": ("service", "informational", "none"),
    "pin blocked": ("service", "informational", "none"),
    "contactless not working": ("service", "informational", "none"),
    "top up by bank transfer charge": ("fee", "informational", "debit"),
    "pending top up": ("transfer", "future", "credit"),
    "cancel transfer": ("transfer", "informational", "debit"),
    "top up limits": ("service", "informational", "none"),
    "wrong amount of cash received": ("cash-withdrawal", "posted", "debit"),
    "card payment fee charged": ("fee", "posted", "debit"),
    "transfer not received by recipient": ("transfer", "posted", "debit"),
    "supported cards and currencies": ("service", "informational", "none"),
    "getting virtual card": ("service", "informational", "none"),
    "card acceptance": ("service", "informational", "none"),
    "top up reverted": ("transfer", "failed", "credit"),
    "balance not updated after cheque or cash deposit": ("balance", "informational", "credit"),
    "card payment not recognised": ("purchase", "posted", "debit"),
    "edit personal details": ("service", "informational", "none"),
    "why verify identity": ("authentication", "informational", "none"),
    "unable to verify identity": ("authentication", "failed", "none"),
    "get physical card": ("service", "informational", "none"),
    "visa or mastercard": ("service", "informational", "none"),
    "topping up by card": ("service", "informational", "none"),
    "disposable card limits": ("service", "informational", "none"),
    "compromised card": ("service", "informational", "none"),
    "atm support": ("service", "informational", "none"),
    "direct debit payment not recognised": ("recurring-payment", "posted", "debit"),
    "passcode forgotten": ("authentication", "informational", "none"),
    "declined cash withdrawal": ("cash-withdrawal", "failed", "debit"),
    "pending card payment": ("purchase", "future", "debit"),
    "lost or stolen phone": ("service", "informational", "none"),
    "request refund": ("refund", "informational", "credit"),
    "declined transfer": ("transfer", "failed", "debit"),
    "Refund not showing up": ("refund", "informational", "credit"),
    "declined card payment": ("purchase", "failed", "debit"),
    "pending transfer": ("transfer", "future", "debit"),
    "terminate account": ("service", "informational", "none"),
    "card swallowed": ("service", "informational", "none"),
    "transaction charged twice": ("purchase", "posted", "debit"),
    "verify source of funds": ("authentication", "informational", "none"),
    "transfer timing": ("transfer", "informational", "debit"),
    "reverted card payment?": ("refund", "posted", "credit"),
    "change pin": ("service", "informational", "none"),
    "beneficiary not allowed": ("transfer", "failed", "debit"),
    "transfer fee charged": ("fee", "posted", "debit"),
    "receiving money": ("transfer", "posted", "credit"),
    "failed transfer": ("transfer", "failed", "debit"),
    "transfer into account": ("transfer", "informational", "credit"),
    "verify top up": ("authentication", "informational", "none"),
    "getting spare card": ("service", "informational", "none"),
    "top up by cash or cheque": ("service", "informational", "none"),
    "order physical card": ("service", "informational", "none"),
    "virtual card not working": ("service", "informational", "none"),
    "wrong exchange rate for cash withdrawal": ("cash-withdrawal", "posted", "debit"),
    "get disposable virtual card": ("service", "informational", "none"),
    "top up failed": ("transfer", "failed", "credit"),
    "balance not updated after bank transfer": ("balance", "informational", "credit"),
    "cash withdrawal not recognised": ("cash-withdrawal", "posted", "debit"),
    "exchange charge": ("fee", "informational", "debit"),
    "top up by card charge": ("fee", "informational", "debit"),
    "activate my card": ("service", "informational", "none"),
    "cash withdrawal charge": ("fee", "informational", "debit"),
    "card about to expire": ("service", "informational", "none"),
    "apple pay or google pay": ("service", "informational", "none"),
    "verify my identity": ("authentication", "informational", "none"),
    "country support": ("service", "informational", "none"),
}

# The 13 intents the previous handoff stress-tested.  Kept verbatim so the new
# numbers stay comparable with the recorded hand-written-lexicon results.
HIGH_RISK_INTENTS: tuple[str, ...] = (
    "pending cash withdrawal",
    "declined cash withdrawal",
    "pending card payment",
    "request refund",
    "declined transfer",
    "Refund not showing up",
    "declined card payment",
    "pending transfer",
    "transaction charged twice",
    "reverted card payment?",
    "transfer fee charged",
    "receiving money",
    "failed transfer",
)


def project(intent_en: str) -> tuple[str, str, str]:
    """Return ``(family, state, direction)`` for an English intent name."""
    try:
        return INTENT_PROJECTION[intent_en]
    except KeyError as exc:  # pragma: no cover - guards a corrupt intent file
        raise KeyError(f"intent not covered by MAPPING_VERSION {MAPPING_VERSION}: {intent_en!r}") from exc


def is_ledger_eligible(family: str, state: str) -> bool:
    """True when a correct auto-import would create a real ledger row."""
    return state == "posted" and family in LEDGER_FAMILIES


FAMILIES: tuple[str, ...] = tuple(sorted({f for f, _, _ in INTENT_PROJECTION.values()}))
JOINT_LABELS: tuple[str, ...] = tuple(
    sorted({f"{f}|{s}" for f, s, _ in INTENT_PROJECTION.values()})
)

if __name__ == "__main__":
    import collections
    import json

    fam = collections.Counter(f for f, _, _ in INTENT_PROJECTION.values())
    st = collections.Counter(s for _, s, _ in INTENT_PROJECTION.values())
    di = collections.Counter(d for _, _, d in INTENT_PROJECTION.values())
    print(json.dumps({
        "mapping_version": MAPPING_VERSION,
        "intents": len(INTENT_PROJECTION),
        "families": fam,
        "states": st,
        "directions": di,
        "joint_labels": len(JOINT_LABELS),
        "high_risk_intents": len(HIGH_RISK_INTENTS),
    }, indent=2, ensure_ascii=False))
