# Wafra v1 completion evidence — September 5, 2026

Status: parser32 beta source reviewed and verified; iOS replacement build51 finished; Android replacement build23 finished. Physical-device acceptance and production configuration remain outstanding. No store submission or Git publication.

## Native screenshots

The PNGs in this directory are unedited Argent screenshots from the current local iOS simulator app and current Metro source. The floating development menu was hidden through its development-only preference. No production UI was modified to remove it.

- iOS 26.1, iPhone 17 simulator, app.wafra.ios.
- `ios-onboarding.png`: concise first experience; sample does not write to the ledger.
- `ios-setup-required.png`: future and past alerts are both required for bank setup.
- `ios-setup-help.png`: concise installation/recovery help.
- `ios-manual-home.png`: manual tracking after leaving unfinished bank setup.
- `ios-settings-capture-off.png`: manual mode has automatic capture off and a permanent Bank alerts entry.
- `ios-messages-privacy.png`: detailed retention/security disclosure available on demand.
- `ios-settings-arabic.png`, `ios-setup-arabic.png`: current Arabic settings/setup layouts.

## Native walkthrough

Verified: interactive sample, direct Start tracking, required bank setup, real Apple History Shortcut installation sheet, cancel/re-add recovery, persisted unfinished setup after force quit/relaunch, Back to separate manual mode, manual completion, Settings Bank alerts availability while capture is off, privacy sheet open/close, language switching and Arabic setup.

A first real SMS is not required to finish setup. Setup completion requires future readiness and a completed history result. No simulator test is claimed as real Message automation delivery or a full retained-history import. The existing physically tested Shortcut graph and its under-3,000-message bound remain unchanged. A zero-retained-message run currently stops in Shortcuts before a completion callback; it must not falsely complete bank setup. Back → manual tracking remains available.

## Local platform limitations

The current native iOS build succeeded. Native history/live-capture behavioral and compiled-metadata/resource checks were run separately; source changes after those checks are TypeScript/UI/parser changes, not native Swift changes.

Android native prebuild succeeded, but local Gradle builds exhausted disk space and the emulator later failed to reboot. No AVD was wiped. Disk had about 0.6 GB free during final integration; the user was asked to free about 10 GB. No physical Android device is available. Cloud Android builds do not establish runtime/device behavior.

## Correctness changes found by independent review

- Currency and decimal scale are validated at import planning and authoritative application, before queue acknowledgement or cursor advancement.
- Paste uses the same interpretation boundary as other imports.
- Exact timestamp/amount delivery keys cannot merge explicitly different cards. Fuller messages preserve compatible bank/card identity through reload.
- Changed legacy amount/direction needs retained source evidence; strong provider identities remain authoritative. Clock-only uncertainty cannot delete a distinct purchase/refund.
- Whole malformed local-money tokens, including space grouping and scientific notation, are refused instead of becoming numeric prefixes.
- A statement needs a readable total; minimum-only reminders are not debts or expenses. Explicit English card-bill and Arabic statement totals remain supported.
- Settlement depends on allocated payment amounts. A payment timestamp remains timing evidence for allocation and cannot settle a later, larger total by itself.

Legacy dues have no original-source or total-provenance field. Equal total/minimum values cannot safely identify corrupt historical statements, so no blanket deletion/migration was made. Timestamp-only legacy settlements reopen when payment evidence is insufficient.

## Release prerequisites

Production preflight reports nine unresolved configuration blockers: iOS and Android RevenueCat keys; public privacy, terms and support URLs; placeholder legal contact; incomplete relay operator/jurisdiction; terms placeholders; and store-listing placeholders. Real values were requested from the user and were not fabricated. Founder/internal beta profiles are distinct from production billing readiness.

Two earlier signed cloud build rounds succeeded but predate final parser32 integration and are superseded. Replacement version1.0.0 candidates:

- iOS history-beta, build51: https://expo.dev/accounts/nnnkk/projects/wafra/builds/b8a831b4-a9b3-43c3-9197-5f3e4473e3d2
- Android internal APK preview, versionCode23: https://expo.dev/accounts/nnnkk/projects/wafra/builds/2a3677e2-3453-4461-8bf1-c48c44f386f9

Both uploaded with existing frozen credentials. iOS build51 finished successfully; Android build23 also finished successfully. The final iOS IPA is linked in `beta-builds.json`. They have not been submitted to stores. `source-snapshot.json` records the303-file implementation/configuration checksum at upload. New universal-parser work authorized in another thread starts after this snapshot and is not part of these candidates.

## Verification results

- Complete preceding parser32 integration run:66 app suites +3 server suites, exit0 (`/tmp/wafra-v1-parser32-combined3.log`).
- Final additional guard requires matching retained source for a changed legacy amount. Its fresh canonical run passed the first51 app suites and all3 server suites, then stopped during iOS UX verification under resource pressure (`/tmp/wafra-v1-parser32-final.log`). Re-ran all15 remaining suites against that same final build successfully (`/tmp/wafra-v1-parser32-final-resume.log`). This covers all66 app suites without claiming a single uninterrupted final wrapper pass.
- Additional final importer check:227/0, including equal-clock different-card and different-price events, partial-bank-evidence retention, true same-source salary healing, refunds and strong-provider booked-amount preservation.
- Final relevant counts: parser984; unit776; bank corpus1338; interpreter84; semantics matrix985; iOS controller370; iOS UX227; onboarding77; accounting46; global adversarial3487 assertions over1144 mutated alerts. Counts describe tests, not universal accuracy or real-world bank coverage.
- Root/server TypeScript, repository ESLint and diff checks passed. The final privacy wording-only change passed root/server TypeScript, scoped ESLint and289 contracts. It clarifies that Wafra cannot directly access the Messages inbox; user-run Shortcut history import remains supported. The privacy PNG was captured before this one-clause clarification.
- Expo Doctor20/20 passed earlier; dependency versions did not change after that check.
- Native history348; live store130, bridge51 and resource78 passed separately. Current native compiled App Intents metadata/resources were checked against the already-built current-source iOS app. Native Swift did not change afterward. These are not physical automation claims.
- Fresh parser32 browser suites passed: smoke63, reporting-period13, persistence6, navigation65, with no page errors. Arabic layout/mirroring and light/dark/system appearance were exercised. `/tmp/wafra-v1-parser32-e2e.log`; export `/tmp/wafra-v1-parser32-web`. This export predates only the final privacy sentence clarification; that source-only copy change was checked by contracts/typecheck/lint.

## Physical-device handoff

The user subsequently connected an iPhone and explicitly authorized device verification in the separate setup thread. That thread owns physical-device interaction; this main thread has not interacted with the physical phone. The connected device is an iPhone16Pro on iOS26.6.1 with Wafra1.0.0 build45 installed. No reinstall, erase or financial mutation was made during identification. Real capture/history outcomes and physical-only gaps must be recorded separately. The final candidate must actually be installed before attributing physical results to build51.

## Skills assessment

The existing Expo SDK55, native design, Argent interaction/QA and release skills cover the work; another generic skill installation is unnecessary. The effective parser expertise comes from repository fixtures, monetary invariants and independent parser/card-ledger review. Generic universal-parser claims are not a substitute for evidence. Current AE/SA compatibility stays distinct from broader supported-format review and worldwide storefront billing.



The final production `check-release-config.mjs` run still reports the nine blockers listed above. The default OTA configuration check passes. Running the production-environment check without loading EAS variables is not production evidence; its local missing-variable result is not counted as an additional release blocker.

## Final iOS artifact inspection

The physical-device thread downloaded and inspected `/tmp/Wafra-1.0.0-51-parser32.ipa` (25.6 MB). SHA-256: `a13cf0378025da25de94bb6b97e8b90ad78102c6795de7d7a3bb48d314818b5d`.

The package identifies `app.wafra.ios`, version1.0.0 build51, with the expected signing team, `beta-reports-active=true`, `get-task-allow=false`, and no provisioned-device list. This confirms TestFlight distribution rather than direct development-device installation. The new Bank messages and Privacy details copy is present.

Existing App Store Connect authentication passed its diagnostic. The physical-device thread requested explicit approval to upload build51 to TestFlight; approval is pending. No submission or public review has occurred. The installed physical build45 launches, but screen-inspection transport is still being resolved. No ledger import, reset or erase was performed during these checks.


## Android build23 verification resumed

Disk availability recovered to about14 GB, allowing emulator QA to resume. `/tmp/Wafra-1.0.0-23-parser32.apk` verifies with APK Signature Scheme v2, one signer. SHA-256: `685293e2521f36b62721e8925a620ab1bc17afc5427298a4957624e63e5495ff`. Package `app.wafra.android`, version1.0.0, versionCode23, minSDK24, target/compileSDK36.

Wafra_Pixel booted successfully and the signed release APK installed/launched. Runtime walkthrough is in progress. The emulator had a1080×1920 resolution override inside a1080×2400 physical frame, causing discovery/tap coordinate mismatch. The override was temporarily reset for native-size QA; restore1080×1920 at cleanup. This is a tooling/device configuration issue, not an app navigation finding.
