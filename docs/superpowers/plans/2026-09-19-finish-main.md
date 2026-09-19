# Finish current main repairs

Goal: preserve ledger rows, complete residual diagnostics/public-page/security work, and restore meaningful validation without overwriting the older dirty checkout.

Initial audit base: `0d8623bf93546047698e870233f82c175b0422db`.
Final reviewed base: `abb50ee48f9c2b9b747036de6a88903606a54e76`.
Final carrier: `/Users/naserkhanjar/Wafra-main-ready-20260919`, branch `fix/main-ready-20260919`.

## Constraints

- Expo SDK 55; Node 22.22.3 and npm 10.9.8.
- Preserve canonical checkout edits; port reviewed hunks rather than stale whole files.
- Do not blindly merge superseded PRs or modify the concurrently updated parser behavior.
- No commit, push, deployment, model invocation, store submission, or legal-choice changes without explicit authorization.

## Completed implementation

- [x] Reproduce inline ledger loss, write regression cases, force initial full chunk persistence, verify exact money/identities and browser transfer review.
- [x] Add complete feedback deadlines, accurate delivery wording, bounded scan/sending progress, and focused transport/privacy tests.
- [x] Generate and inspect public pages, correct factual local-capture wording, retain legal draft decisions, verify real local Pages 404 behavior.
- [x] Port the reviewed feedback-security patch; isolate publisher privileges, test consent/candidate/copy boundaries, provision offline native fixtures and compiler/runtime dependencies.
- [x] Align retired browser expectations with current product behavior, preserving meaningful data/consent/navigation assertions; fix observed narrow/large-text onboarding layout and radio accessibility defects.
- [x] Integrate current parser revisions without changing parsing logic; complete Arabic labels, correct the inconsistent synthetic fixture, and remove the obsolete literal backfill-version assertion.
- [x] Run app/server, host-native, browser, type, lint and focused workflow checks; obtain independent reviews and resolve findings.
- [x] Finish the full isolated Docker baseline/red/green canary sequence and record its successful outcome.
- [x] Obtain explicit commit/push and Android build/install/device-QA authorization.
- [ ] Publish the reviewed changes after agreeing push order with the active crash/performance task; check GitHub CI.
- [ ] Test one combined latest APK on the connected Android phone after the coordinated build/install handoff. Store/site deployment remains separate.

Verification and precise external limits: `docs/test-evidence/2026-09-19-main-repairs.md`.
