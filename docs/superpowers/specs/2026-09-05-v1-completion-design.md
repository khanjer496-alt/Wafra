# Wafra v1 completion

The user's September 5 instruction authorizes implementation of a redesigned app, improved iOS alerts/history/Shortcuts, and preparation for TestFlight and Android. This extends the September 4 visual-only scope and adopts the audit's correctness/recovery recommendations. It does not authorize fabricated legal/store/device evidence or Git publication.

## Product direction

Make Wafra a personal money journal: clear, confident typography; open ledger sections instead of nested summary boxes; one main financial answer per screen; useful empty states; and a hands-on first experience. Preserve the warm semantic palette, Arabic support, exact-money formatting, four tab destinations, and existing financial definitions. Home net after spending remains net after spending, never an invented safe-to-spend figure.

Onboarding demonstrates a clearly labeled sample alert becoming a transaction. Users can begin tracking without completing goals/budget questions. Personalization stays available and amounts still require real income evidence. iPhone setup resumes after app restarts, supports canceled installs and retries, and distinguishes skipped, ready, and first captured alert. Sample data never enters the personal ledger.

The later user correction makes both future-alert setup and history completion required before declaring bank setup complete. A first real SMS is not required to finish setup. Manual tracking is a separate path; it never marks incomplete bank setup complete. Preserve the proven history Shortcut graph and its current bounds. Keep primary screens short; detailed recovery and privacy explanations belong in Help or a dedicated sheet.

## Correctness and reliability

Every ingestion path must enforce currency/exponent at ledger admission. Pasted alerts use shared semantics. Historical review expiry starts at discovery. Invalid backups leave authoritative ledger/preferences unchanged. CSV exports retain correct currency/scale. App-created plaintext export files receive controlled cleanup. Relay body limits apply while streaming. CI runs both native behavior suites.

## iPhone capabilities

Future selected-sender alerts use a user-created Apple Message automation. History is a separate user-started operation over retained Messages. Improve installation, progress, recovery, and current artifact integrity without claiming unsupported background capture or removing conservative bounds without evidence. Verify current artifacts and builds; keep physical automation acceptance distinct from simulator/unit results.

## Release truth

Prepare exact version-1 candidates, configuration checks, metadata, and tested local Android/iOS artifacts where tools allow. Resolve configuration from real available sources. Record remaining external account, legal, billing, signing, physical-device, or store-review gates precisely. Readiness is earned by passing those gates, not by suppressing checks.

## Acceptance

- Audited monetary and persistence defects have focused regressions and no launch-market regressions.
- Onboarding has an interactive sample, optional personalization, and durable iPhone resume.
- Core screens visibly change composition and remain usable in light/dark, Arabic, and larger text.
- iPhone installation cancellation/missing app/retry/skipped/readiness states are actionable and truthful.
- Full app/server/native suites, typecheck, lint, browser navigation, and relevant native walkthroughs pass.
- Build/artifact/configuration evidence identifies what is tested versus externally blocked.
