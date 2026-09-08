# Protected iOS Shortcut batch adapter

This change adds `StageWafraShortcutHistoryIntent` alongside the existing
history actions. It accepts at most 50 selected message records with explicit
ISO 8601 time-zone offsets. It does not query Messages, finish an import, open
Wafra, or change either currently published Shortcut graph.

## Preserved boundaries

The caller must already hold the session authorization returned by the protected
Begin action. The adapter uses the existing bounded, protected storage and expiry
rules. Input schema, duplicate JSON members, IDs and text sizes are validated
before timestamp conversion. Original input bytes, including rejected records,
are authenticated under a separate request domain; cross-mode replay is refused.

Valid offsets are normalized to UTC with exact milliseconds. Unknown offsets,
invalid dates, missing time zones, excessive fractions and out-of-range instants
are rejected. Persisted records still use the unchanged strict UTC v1 contract.
The legacy Stage action remains strict; no existing producer is silently widened.

## Verification and release scope

The native host suite exercises accepted/rejected offsets, leap and year
boundaries, exact record round-trips, retry authentication, cross-mode conflicts,
50-record limits, duplicate IDs, expiry, erase and strict stored-record validation.
The generated and compiled metadata gates require the new action's exact
parameters, background mode, authentication policy and EN/AR resources. Normal
CI still runs the full native app build; `--host-only` is a local development
option, not a replacement for that gate.

This is a validated building block for a future batched extraction Shortcut,
not evidence of faster real-inbox extraction or complete large-inbox coverage.
The current published history Shortcut and its existing coverage limitation
remain unchanged until a replacement producer is separately exercised on an
iPhone and its graph is deliberately published.
