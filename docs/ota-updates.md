# Mobile over-the-air updates

Wafra uses EAS Update for reviewed JavaScript, TypeScript, copy, layout, and
bundled-asset fixes. The app does not use OTA delivery to introduce native
capabilities or features that were absent from the store-reviewed binary.

The installed binary selects updates using two independent boundaries:

- `runtimeVersion: fingerprint` prevents a bundle from running against a
  different native dependency, custom module, config plugin, or native config.
- The EAS channel keeps preview, corpus research, capture beta, production
  candidate, and production users isolated from one another.

The launch wait is capped at 1.5 seconds. If an update cannot be fetched inside
that window, Wafra opens its cached ledger immediately, finishes downloading in
the background, and applies the update on the next cold start.

## One-time activation

`expo-updates` and its native configuration only exist in binaries built after
this setup landed. Produce and install a `production-candidate` build on both
platforms, verify update delivery, and then ship new `production` binaries.
Older installations cannot receive OTA updates retroactively.

The EAS `production` environment must define these exact public build values:

- `EXPO_PUBLIC_WAFRA_FOUNDER_UNLOCK=0`
- `EXPO_PUBLIC_WAFRA_PARSER_RESEARCH=0`
- `EXPO_PUBLIC_WAFRA_SMS_CORPUS_EXPORT=0`
- `WAFRA_SMS_CORPUS_EXPORT=0`
- `EXPO_PUBLIC_WAFRA_RELAY_URL`
- `EXPO_PUBLIC_WAFRA_SHORTCUT_URL`
- `EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL`

SDK 55 publishing always names an EAS environment explicitly. The candidate and
public build profiles also select that same `production` environment. Their
committed `env` blocks pin only closed safety gates to `0`; relay and Shortcut
URLs have one source of truth on EAS, so build-profile values cannot override
them and make the embedded and OTA bundles disagree.

## Standard release path

1. Merge, commit, and review every intended file on `main`. OTA publishing from
   another branch, a dirty tree, or a local revision that differs from fetched
   `origin/main` is rejected.
2. Publish a candidate from GitHub Actions → **Mobile OTA update** →
   `publish-candidate`, or locally:

   ```bash
   npm run update:candidate -- --message "Fix duplicate card payment display"
   ```

3. Copy the update group UUID from EAS. Verify that update on an iOS TestFlight
   build and an Android internal-track build using the `production-candidate`
   channel. Exercise cold start, unlock, capture/import, ledger totals, and the
   changed behavior on both platforms.
4. Run **Mobile OTA update** from `main`, select `promote-candidate`, paste the
   verified group UUID, and begin at 5–10%. Promotion republishes the already
   tested bundle; it does not generate a new one. The workflow verifies that
   the group came from `production-candidate`, contains both platform bundles,
   and records a source commit already merged into the checked-out `main`.
   Configure the workflow's `production-ota` GitHub environment with required
   reviewers and keep `EXPO_TOKEN` scoped there before enabling production use.
5. Review EAS Update insights, then use `expand-rollout` with the production
   update group UUID to move through 25%, 50%, and 100%.
6. If a staged rollout regresses, use `revert-rollout`; Expo must end an active
   rollout with `update:revert-update-rollout` before another update can publish.
   After an update is fully released, use `rollback-production` instead. Both
   require a verified group from the production branch. Neither operation can
   undo persistent data changes, so migrations must remain backward-compatible
   with the previous bundle.

## Eligibility gate

Appropriate OTA changes include copy, translations, styling, navigation fixes,
bundled images, and fixes implemented entirely against native APIs already in
the reviewed binary.

A new store build is mandatory for changes to either Wafra native capture
module, permissions, entitlements, background modes, Expo config plugins,
SQLCipher/native database settings, native dependencies, Expo/React Native,
icons, or the splash screen.

Parser, money, date, billing, encryption, privacy, and database-migration code
may be technically compatible with OTA delivery, but it still requires focused
tests, both-platform candidate evidence, a small rollout, and explicit review.

## Code signing

End-to-end EAS Update signing is intentionally not enabled by repository config
alone. Expo currently restricts it to Production and Enterprise plans, and its
private key needs an agreed password-manager/KMS backup plus a GitHub secret
restoration procedure. Enable it before the first OTA-enabled public binary if
the Expo account has that plan and the signing key has durable custody; adding
or rotating the certificate creates a new native runtime and requires another
store build.

References: [Expo SDK 55 Updates](https://docs.expo.dev/versions/v55.0.0/sdk/updates/),
[deployment](https://docs.expo.dev/eas-update/deployment/),
[code signing](https://docs.expo.dev/eas-update/code-signing/), and
[Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).
