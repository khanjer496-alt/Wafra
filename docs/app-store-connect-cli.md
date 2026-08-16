# App Store Connect CLI workflow

Wafra uses `asc` 4.4.2 for Apple-side release operations. EAS Build still
creates signed binaries, EAS Submit still uploads those binaries, and Fastlane
still owns Google Play listing uploads. Wafra's checked-in metadata and pricing
files remain the source of truth.

The repository commands disable `asc` telemetry by default, require strict
authentication-source resolution, and reject any installed CLI version other
than 4.4.2. They never delete remote locales or replace existing screenshots.

## 1. Install and authenticate

Install the pinned CLI on macOS and verify the repository contract:

```bash
brew install asc
npm run check:asc
```

Create an App Store Connect Team API key under **Users and Access →
Integrations → App Store Connect API**. Keep the `.p8` outside the repository.
The normal local setup stores the profile in the macOS Keychain:

```bash
asc auth login \
  --name Wafra \
  --key-id "$ASC_KEY_ID" \
  --issuer-id "$ASC_ISSUER_ID" \
  --private-key "$ASC_KEY_FILE" \
  --network

npm run asc:auth
```

`asc:auth` validates the active credential source against Wafra specifically.
Run `npm run asc:auth:doctor` separately when you want to audit every stored
profile and local key file; stale credentials for another app can make that
broader health check fail without affecting Wafra access.

The Wafra wrapper also accepts Fastlane's existing `ASC_KEY_FILE` variable and
maps it to `ASC_PRIVATE_KEY_PATH`. In CI, use `ASC_PRIVATE_KEY_B64` or a
temporary file outside the checkout. Never commit a key or `.asc/config.json`.

## 2. Generate and validate metadata

`docs/store-metadata.json` generates both the existing Fastlane layout and
`asc`'s canonical JSON layout beneath the ignored artifact directory:

```text
artifacts/store-package/apple/asc-metadata/
├── app-info/{en-US,ar-SA}.json
└── version/1.0.0/{en-US,ar-SA}.json
```

Generate the package and perform local validation without contacting Apple:

```bash
npm run asc:metadata:validate
```

Only fields present in Wafra's source data are emitted. Omitted remote fields,
including legal URLs and release notes, remain unchanged.

## 3. Preview and apply metadata

Always inspect Apple's current state and the dry-run diff first:

```bash
npm run asc:diagnose
npm run asc:metadata:preview
```

After the generated JSON and dry-run output have been reviewed, authorize one
live write:

```bash
WAFRA_ASC_CONFIRM=APPLY_REVIEWED_APPLE_METADATA npm run asc:metadata:apply
```

The apply command does not pass `--allow-deletes`; a missing local locale never
means that a remote locale should be deleted.

## 4. Preview and upload screenshots

The screenshot workflow first runs Wafra's count, dimensions, opacity,
uniqueness, and localization checks. It targets the 6.9-inch iPhone set
(`IPHONE_69`) and fans out across `en-US` and `ar-SA`.

```bash
npm run asc:screenshots:preview
```

After reviewing the dry-run output, authorize the additive upload:

```bash
WAFRA_ASC_CONFIRM=UPLOAD_REVIEWED_APPLE_SCREENSHOTS npm run asc:screenshots:apply
```

Existing matching files are skipped. The wrapper intentionally provides no
`--replace` path because replacement deletes the current remote screenshot set
before uploading. If replacement is ever needed, treat it as a separate,
manually reviewed migration.

## 5. TestFlight and review operations

These commands are read-only:

```bash
# Latest builds plus App Review status and API-visible blockers
npm run asc:diagnose

# Recent tester feedback
npm run asc:feedback
```

`asc review doctor` cannot inspect Apple's web-only declarations, agreements,
tax state, export-compliance answers, or the quality of review notes. Continue
using `docs/launch-readiness.md` for those gates. No Wafra command submits an
app for review or changes release mode.

## 6. Subscription inventory

Inspect the Apple subscription groups and their review versions before creating
or changing products:

```bash
npm run asc:subscriptions:audit
```

Creation, pricing, localization, and review submission remain blocked until the
Account Holder approves the UAE and Saudi commercial values in
`docs/store-pricing.json`. Apple product configuration and RevenueCat offering
configuration are separate steps; completing one does not complete the other.

## 7. Upgrade procedure

Do not use an unpinned `asc` version in release automation. To upgrade:

1. Review the upstream release notes and command help.
2. Change `ASC_CLI_VERSION` in `scripts/lib/app-store-connect-cli.mjs`.
3. Run `npm run check:asc`, the store-package test, and every preview command.
4. Review the command-plan diff for newly destructive or renamed flags.
5. Update the pinned CI download in `.github/workflows/ios-testflight.yml`.

The CLI is an independent project and is not endorsed by Apple. The App Store
Connect web interface remains the final authority for live account state.
