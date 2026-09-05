# Wafra v1 completion implementation plan

**Goal:** Implement the approved September 5 completion request and prepare honest iOS/Android v1 release candidates.
**Architecture:** Shared conservative interpretation and money admission; small validation/export helpers; durable iPhone setup state; existing screen primitives with redesigned composition.
**Stack:** Expo SDK55, React Native0.83, TypeScript, Swift/Kotlin, Cloudflare Worker.
**Spec:** `docs/superpowers/specs/2026-09-05-v1-completion-design.md`.

## Constraints

Preserve pre-existing work in the current tree. Workers have non-overlapping ownership. No commits/pushes without explicit authorization. Never log secrets, fabricate store configuration, or relax privacy/money gates for green tests. Use isolated test builds during parallel implementation. Main owns shared package/type/test-harness integration and device interaction.

## 1. Import correctness — parser worker

- [x] Add failing cross-currency fixtures (AED source into USD/KWD/JPY), payroll path-parity regression, and old-alert discovery retention regression.
- [x] Fix interpreter/session policy and import-plan admission; coordinate commit-time validation with store owner.
- [x] Route `src/app/import-sms.tsx` through shared interpretation and safe review handling.
- [x] Fix Android discovery TTL in `src/lib/auto-import.ts`.
- [x] Run focused interpreter/import-plan/corpus/review tests in isolated build and obtain independent review.

## 2. iPhone setup and history — iOS worker

- [x] Add behavior cases for canceled installation, missing Shortcuts, re-add, skipped count, and readiness regression.
- [x] Implement recoverable stages in `ios-setup.tsx`, setup controllers, checklist components, and localized copy.
- [x] Expose exact Apple navigation and action-critical history preflight.
- [x] Inspect/build/check both current Shortcut artifacts; implement conservative history improvements supported by actual platform behavior.
- [x] Provide main the persisted resume contract; verify native module/artifact tests and identify physical gaps.

## 3. Backup/export/privacy/CI — reliability worker

- [x] Add rejected malformed nested backup cases and ensure failure leaves ledger/preferences intact.
- [x] Add currency/exponent and quoted-field CSV cases; extract `ledger-export.ts`.
- [x] Add controlled temporary-export cleanup and erase coverage.
- [x] Add bounded stream reader tests for absent/invalid Content-Length and oversized chunks.
- [x] Run live-capture Swift tests in macOS CI and honor BASE in browser navigation.
- [x] Run focused checks, report exact files, and obtain independent review.

## 4. Design and first-use — main

- [x] Replace static `MoneyPreview` with a localized interactive sample-to-entry demonstration; no ledger writes.
- [x] Improve onboarding composition, offer direct start and optional personalization; hydrate saved preferences and resume iPhone setup.
- [x] Redesign Home/Flow/Wallet/Bills composition using existing tokens and financial selectors, preserving accessible controls and routes.
- [x] Hide decorative native symbols from accessibility; resolve lint warnings.
- [x] Update meaningful onboarding tests and existing navigation/layout expectations without weakening behavioral checks.
- [x] Export a fresh demo build, inspect all core screens and first-use states, correct visible defects.

## 5. Integration and launch verification — main

- [x] Integrate new pure modules into the existing test build and preserve exact suite-count gates.
- [x] Independently review all money/privacy/native edits; resolve findings.
- [x] Run typecheck, lint, Doctor, full app/server/native suite and browser suites (staged verification; exact limits in evidence report).
- [ ] Build and operate the current iOS app and available Android emulator using Argent; verify import/setup/navigation and accessible layouts.
- [x] Inspect actual EAS/signing/store prerequisites; run configuration/metadata/dependency gates. Use disposable native prebuild output for Android if needed.
- [ ] Prepare candidate artifacts and record hashes/build IDs where available. Do not substitute local compile success for real SMS, payment, or store acceptance.
- [x] Finalize v1 implementation/evidence report with completed work and remaining precise external gates.

## Integration status — September 5

The source implementation above is complete; final integration remains in progress. Required iOS bank setup now means both future setup ready and history completed, without waiting for a real SMS. Manual tracking stays separate. Detailed Help/privacy copy was moved out of the main setup/settings surfaces.

Independent integration review found additional parser32 fixes: minimum-only statements must not supply a total; settlement needs allocated money rather than a timestamp alone; legacy timestamp/amount duplicates must respect distinct cards; fuller captures must preserve known bank identity; malformed spaced/scientific local-money tokens must not yield partial amounts. Focused regressions and final combined verification are being completed.

Two rounds of signed EAS preview/history-beta builds succeeded, but predate these final fixes and are superseded. Parser32 replacement builds51(iOS) and23(Android) are in progress. No store submission, Git commit or push occurred. Physical new-SMS delivery remains unverified. Android local build/runtime QA is blocked by disk exhaustion; the AVD is preserved. Production configuration reports nine genuine billing/legal/public-URL/metadata blockers. See the final evidence report when available.

Evidence: `docs/test-evidence/2026-09-05-v1-completion/README.md`. Physical-device verification is owned by the separate setup thread; installed build45 is not candidate build51. Universal-parser work starts after the recorded beta snapshot and remains a separate integration.

## 6. Universal review integration — active continuation

The user clarified that UAE/Saudi behavior must improve too. Protect correct outputs, fix defects, and apply generic extraction to readable misses in every market. An unknown issuer must not require fabricated registry evidence.

- Add a distinct, whitelisted generic review entry to the existing encrypted tray, retaining current expiry/caps/tombstones and stripping raw text/sender/unknown properties on admission and hydration.
- Bind original native capture identity and observation time in the host. Confirm against authoritative, unexpired state and retain exact currency/exponent checks and durability before native acknowledgement.
- Route validated extraction before source discard on Android, local iOS, history and paste. Retain correct automatic results; generic review eligibility must not grant known-bank automation qualification or learned automatic rules.
- Show source-grounded suggestions, explicit alternatives and missing fields in the existing review flow. Unknown posting status requires explicit confirmation. Statement/balance/card-payment facts must never appear as ordinary expense/income.
- Give readable UAE/Saudi misses the same review opportunity as other currencies/issuers. Add integration regressions for both regions, privacy, expiry, duplicate/reload and rejected confirmation.
- Keep the completed beta51/23 source snapshot distinct from this next integration. Review and verify the integrated app before replacing those artifacts.

Ownership: main owns store/UI/shared harness and integration documentation; schema/promotion worker owns alert-review-tray, generic-review-entry and review-promotion plus their focused tests; capture worker owns existing capture adapters plus corresponding tests after the schema contract is agreed. The universal-module thread is frozen/read-only unless a new-module fix is delegated. The copy worker owns only the requested i18n keys.

## Updated user direction and publication coordination

- The final parser and categorization core must be global, with UAE/Saudi patterns as optional refinements and regression evidence, never a country allowlist.
- The user additionally authorized comprehensive categorization improvements, including current formats and preserving directional/manual corrections.
- The user authorized a concurrent whole-app visual pass. The release/UI thread owns its agreed tab/Home/header/scaffold/choice-sheet/card-list/transaction-list/token surfaces; main owns generic review/add/import UI, store and parser integration. No overlapping edits.
- After all work and the visual pass: run final checks, create matching iOS/Android test builds, update the wafaraa landing page download links, then commit/push the finished version. Commit/push authorization is now explicit, but direct main publication was not specified. The release thread owns the final Git/release sequence; main has made no commits, pushes or TestFlight submissions.
- TestFlight upload authorization persists in the physical-device thread. Build51 is held as an older native checkpoint because the user requested current updates first; wait for the matching final candidate.

## Current integration checkpoint — September 5, global round two

The global core, review-to-ledger integration, directional categories, and native capture identity fixes are implemented. Round-two parser sources are frozen; the root test runner now includes their seven suites. Preserve the original unseen evaluation (2/24 parser and 4/8 categorization) alongside the corrected, now-exposed regression results; passing the exposed cases is not a worldwide accuracy claim.

Fresh combined verification found and fixed a shared-server compilation dependency: category metadata imported its icon identifier type from a React component. The identifier union now lives in a pure TypeScript module, with the existing UI export preserved. App and server typechecks pass after this separation. Full app/server/native checks and expanded multilingual review UI tests are running against current sources.

The user replaced the previous brand direction and has now authorized implementation of a synthesis based on real product references. The release/UI thread is implementing that design; prior screen approvals and beta51/23 cannot establish final visual readiness. Final builds/publication remain pending that source freeze and combined device verification. Android23 is installed with synthetic capture evidence and retained data for a final upgrade test; disk exhaustion no longer blocks that installation. Physical new-SMS delivery on the final build remains unverified.

The precision audit reproduced rounded-zero values and inconsistent screen totals. Main corrected Home income/spending/net, Flow composition totals, and Wallet reliable balance/debt projections to retain exact minor units. Source-level regression cases failed before the fixes and now pass (32/32, including AED 0.49/0.51, KWD 0.001, JPY, pooled categories, and unknown/archived balances). The UI thread is applying matching exact display formatting; the previous combined gate is not sufficient to verify these later edits. Native history-store verification passed 348 checks; its current Xcode resource/intent build is still running.
