# Final beta release — September 5, 2026

Status: preparation only. No final build, TestFlight upload, website deployment,
commit, or push is recorded here yet.

## Release order

The user authorized finishing parser/categorization and other active work,
then reviewing and improving the actual iOS and Android interface, producing
tested beta builds, updating the landing-page downloads, and committing/pushing
the finished work. The current publication branch is
`codex/universal-parser-adversarial-tests`; direct publication to `main` was not
requested.

The existing iOS 51 and Android 23 candidates predate universal-review integration
and must not be presented as the final version. Native source must be frozen
again after the interface pass, with build artifacts tied to that snapshot.

## Verified distribution prerequisites

- Both beta configuration checks passed:
  `node scripts/check-release-config.mjs --intent build --platform ios --profile history-beta --submit true`
  and `node scripts/check-release-config.mjs --intent build --platform android --profile preview --submit false`.
- EAS uses remote versions with automatic increments for those profiles.
- `apksigner verify --print-certs` passed for the existing public Android
  version 15 APK and EAS Android 23. Both have certificate SHA-256
  `e6d6575a571bcdb36f521a35b283711497a694c370ceabb0da1501326371b344`.
  Verify the final APK against this certificate and its version before replacing
  the download. This comparison alone does not prove an actual device upgrade.
- App Store Connect confirms Wafra's external Beta group has the enabled public
  link <https://testflight.apple.com/join/jbwzCgZ6>. Keep this link and associate
  the final processed build with that group through the applicable beta review
  process. The enabled link alone does not prove the final build is available.
- The landing-page Android button still targets release
  `android-test-9ea4cd8`, published August 21. Update the final asset URL in
  `src/marketing/content.ts` and the matching SEO checker/tests together.
- No landing deployment origin was found in the repository configuration or
  GitHub repository homepage. The live address has been requested.

## Completion evidence still required

- Integrated parser/categorization checks and independent review.
- Current native iOS and Android screenshots and interaction checks, including
  Arabic, larger text, both themes, concise copy, and motion preferences.
- Final source snapshot, build IDs, versions, artifact hashes, and signing checks.
- Final APK published and downloaded successfully through its public link.
- Matching iOS build processed and available to the intended TestFlight testers;
  distinguish internal availability from external beta review/availability.
- Landing export checks, deployment origin, and live download verification.
- Reviewed explicit-path commits and push of the completed feature branch.

Physical iPhone build 45 is an older baseline. Real history import and new bank
SMS delivery on the final candidate remain separate acceptance checks; simulator
or artifact checks must not be described as physical-device success.
