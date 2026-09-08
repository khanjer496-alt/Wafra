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

## Signed beta build when hosted EAS capacity is unavailable

The canonical `ios-testflight.yml` also supports an explicitly selected
`build_host=github-macos` route for `history-beta`. It runs the documented
`eas build --local` process on a GitHub macOS runner with Xcode 26.2 or newer,
Node 22.22.3 and existing managed signing credentials. It does not change an
Expo subscription. GitHub runner usage is still consumed.

An optional full `source_commit` pins a main-line application revision while a
short-lived build-tooling branch is being repaired. The checkout verifies main
ancestry; no encoded source replacement or different app branch is used. Before
submission, the workflow verifies store signing, identity, release entitlements,
the actual compiled history metadata and EN/AR resources, and successful CI for
that exact source. The IPA and a source/hash report are retained before upload to
TestFlight so a submission failure does not require rebuilding.
