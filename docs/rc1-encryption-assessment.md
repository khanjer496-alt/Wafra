# RC1 encryption assessment — 9 November 2026

Conclusion: the existing `ITSAppUsesNonExemptEncryption=false` is **not sufficiently substantiated for submission**. It cannot be justified as OS-only HTTPS. Keep submission blocked until the publisher completes Apple's current questionnaire and records the applicable exemption or required documentation. This review does not issue an export classification or change the declaration speculatively.

Inventory: `app.json` enables expo-sqlite `useSQLCipher`; `src/lib/state-storage.native.ts` encrypts the local ledger using an on-device key held in SecureStore. `src/lib/relay-crypto.ts` uses third-party noble X25519 key agreement, HKDF-SHA256 derivation and AES-GCM decryption for sealed relay payloads. These are published standard algorithms implemented beyond OS TLS. OS Keychain/file protection and transport TLS are additional protections. P01/P02 add no new algorithm or cryptographic purpose.

Apple's [export-compliance overview](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance) requires assessment including third-party libraries. Its [Info.plist key documentation](https://developer.apple.com/documentation/bundleresources/information-property-list/itsappusesnonexemptencryption) permits NO for no encryption or documented exempt encryption. Standard algorithms alone do not prove exemption. Local financial-data protection and sealed relay are candidates for an applicable exemption, not evidence that one has been established. Country availability, including France, matters to documentation requirements.

Before submission, record the current binary/library inventory, countries of distribution, exact questionnaire answers, exemption basis and any Apple/BIS/French reporting or documentation obligation. If non-exempt, use YES and the reviewed documentation/code as applicable. No account questionnaire, legal classification, documentation upload or signing was performed here.

# Widget product gate

`eas.json` uses the documented local version source, with iOS auto-increment disabled in the inherited base profile. `app.json` supplies literal `ios.buildNumber` 192. iOS Release’s 9 November ASC readback found the highest uploaded build was 190, with neither 191 nor 192 present, and reserved 192 within the team for the single preview check (`Shared/launch-review/ios-build-192-reservation.json`, checked at 00:38 UTC). This is a team reservation, not an Apple-side write; recheck availability before the preview. `app.config.js` validates this literal without relying on `EAS_BUILD_IOS_BUILD_NUMBER`. Host and extension native generation must use the same local build and marketing versions. Bump the literal deliberately for subsequent candidates. [Expo local version documentation](https://docs.expo.dev/build-reference/app-versions/#local-version-source) describes this version source. The cited [eas-cli issue 4458](https://github.com/expo/eas-cli/issues/4458) concerns repacking with remote versions; it is not proof that a full-build environment variable will be available during config evaluation.

**Required before any upload:** iOS Release runs one real EAS preview build from the approved pushed commit, downloads and extracts that IPA, then runs `python3 scripts/check-ios-product-versions.py <Payload/Wafra.app>`. Record the source commit, EAS build ID, IPA SHA-256 and checker output. The checker rejects missing/unexpanded/non-numeric versions and compares both CFBundleVersion and CFBundleShortVersionString for the host and every PlugIns extension. A successful synthetic fixture or prebuild is not this evidence. No upload is authorized until this real-product check passes and the release review gates clear.

The `ios-testflight.yml` "Verify the actual signed IPA and App Intent resources" step also runs the checker on the extracted signed app **after build, before submit/upload**. EAS local build signs internally, so this workflow cannot insert a pre-signing gate. `npm run ship:ios` now builds without auto-submission; use the checked workflow for any separately authorized upload. No real IPA or archive was built or checked in this code-fix task.

`ios-submit-verified-artifact.yml` independently extracts the downloaded IPA and
runs the current product-version checker before submission, including for older
artifacts whose accompanying hash/signing report predates the checker. A matching
hash report alone does not clear the version gate. Failure to extract exactly one
host app, unresolved versions or any host/extension version mismatch stops the
job before EAS submission.

These checks cover `ios-testflight.yml` and `ios-submit-verified-artifact.yml`.
Historical build120/121/150 direct-submit/public workflows remain unchecked
legacy routes outside this fix; do not dispatch them or edit/push those workflow
files for the RC (build120 also triggers on a matching push to main). This is not a
claim that every workflow in the repository is gated or that submission is
authorized. The real preview IPA and live ASC build-number checks remain required.

The version-source setting is shared by EAS platforms. The GitHub Android build workflow still stamps versionCode from its run number; any future direct EAS Android build must explicitly reserve a fresh local versionCode rather than assume the old remote counter applies. Android build/publication remains on hold.
