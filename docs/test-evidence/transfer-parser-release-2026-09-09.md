# Transfer parser release candidate — 9 September 2026

## Scope

Parser version 38 requests a recheck of already scanned version-37 Android
history. It retains source/destination evidence, distinguishes a corroborating
bank confirmation from another posting, and links independently observed card
repayment receipts. Matching only amount and time remains a suggestion, never
proof of common account ownership. Explicit user decisions take precedence.

Partly masked transfer sources no longer inherit an unrelated first card.
An ordinary parsed event seen before any source account is discovered is kept
with an unresolved attribution instead of silently being dropped. That holding
reference cannot assert a bank balance or an immediately funded cash payment.
Colliding account endings do not create a new unscoped global account hint.
The compact iOS capture path retains the source account/card ambiguity fact.

This candidate also includes the optional, collapsed transfer-history browser
documented in `transfer-history-ux-2026-09-09.md`. It does not implement a new
iOS history extraction Shortcut, erase user history, or classify every unknown
recipient as external.

## Verification performed locally

- TypeScript checks, lint and the Ledger & Light design guard passed.
- All 580 repair, workflow, iOS-journey and onboarding-action tests passed with
  zero failed or skipped tests against this working source.
- The owner-supplied full-history replay completed with no failed assertions.
  It exercises existing-ledger upgrade, repeat import, JSON restore, a fresh
  ledger and its repeat, original-money protection, and synthetic manual-edit
  and ownership-decision probes on cloned records. All processing is read-only
  with respect to the installed application.
- Native storage and full application/browser runs were interrupted by the
  local machine running out of disk space. Their partial logs are not a pass
  for the complete gate. Clean GitHub CI and build results are required before
  presenting this candidate as a verified installer.

The corpus, account identifiers, raw messages, derived financial totals and
private replay outputs are not committed. Local results are under the ignored
`builds/resume-20260908/transfer-final-20260909/` directory. Replay is reproducible:

```sh
bash scripts/test/build.sh
TZ=Asia/Dubai node scripts/audit-transfer-corpus.cjs \
  /path/to/owner-personal-review.json /path/to/private-report.json
```

The script discloses recovered provider identities versus stable audit-only
identities. It does not claim to reproduce the native SMS database provider or
physical-device performance. Planned funding observations can be absorbed by
the shipping payment-flow reducer; repeatability is checked against the complete
durable state, not merely the count of proposed batch rows.

## Release boundary

Use the canonical `ci.yml`, `build-apk.yml` and `ios-testflight.yml` workflows on
the exact main-line commit. Keep public APK corpus export and experimental
notification capture disabled. Check the actual signature before installing an
Android update; never uninstall or clear application data as a workaround.
The iOS GitHub-macOS route retains the verified IPA before submission and gates
submission on successful exact-source CI. Build completion, Apple processing
and TestFlight distribution are separate outcomes and must be reported as such.

Independent worker review was unavailable because the connector returned
`WORKER_IDENTITY_LOST`; no independent approval is claimed.
