# Wafra two-store ASO automation

This workflow adapts the useful parts of the Vibe ASO approach to Wafra's Expo
SDK 55 application and to both stores. It automates repeatable repository work;
it does not invent keyword volume, approve pricing, create legal facts, or
bypass store review.

## Source of truth

- `store-metadata.json` contains launch listings, subscription localizations,
  screenshot stories and the AE/SA product boundary.
- `store-pricing.json` contains product identifiers and pricing policy. The
  reference USD values are not live storefront prices.
- `src/lib/i18n.ts` remains the in-app English/Arabic copy source.
- `app.json` declares English and Arabic through the Expo SDK 55
  `expo-localization` config plugin so both operating systems can expose
  per-app language selection.

Do not enable the future global listings until arbitrary ledger currencies and
their market QA ship. Storefront purchase currency remains independent of the
ledger currency.

## Local workflow

```bash
npm run store:plan
npm run check:store-assets
npm run store:prepare:assets
```

`store:plan` validates metadata and pricing policy, then generates Fastlane
layouts under the ignored `artifacts/store-package/` directory. It intentionally
omits screenshots so copy can be reviewed before native captures exist.

`store:prepare:assets` is stricter: it first requires all native assets to pass
the dimensions, count, opacity, uniqueness and localization gate, then copies
them into the generated Apple and Google layouts.

Required native assets remain:

- App Store: eight 1320×2868 iPhone screenshots for `en-US` and `ar-SA`.
- Google Play: eight 1080×1920 phone screenshots for English and Arabic.
- Google Play: one 1024×500 feature graphic per launch language.

Use synthetic, internally consistent financial data. Never place a real bank
message, name, card digits, device token, relay URL or account balance in store
art.

## Upload reviewed listings

Install a current Ruby and run `bundle install`. The system Ruby bundled with
macOS may be too old for current Fastlane releases.

For Apple, the preferred workflow is the pinned App Store Connect CLI described
in [`app-store-connect-cli.md`](./app-store-connect-cli.md). It provides local
validation, remote dry runs, TestFlight diagnostics, subscription inventory,
and guarded metadata/screenshot uploads. The Fastlane Apple lane remains a
transition fallback until the first authenticated `asc` dry run and live
read-back have both succeeded. Fastlane remains the Google Play uploader.

Apple requires `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_FILE`. Google requires
`GOOGLE_PLAY_JSON_KEY`, pointing to a least-privilege service-account JSON file.
Do not commit either credential.

After reviewing the generated files and screenshot contact sheet, authorize
one live command at a time:

```bash
WAFRA_STORE_UPLOAD_CONFIRM=UPLOAD_REVIEWED_ASSETS npm run store:upload:apple
WAFRA_STORE_UPLOAD_CONFIRM=UPLOAD_REVIEWED_ASSETS npm run store:upload:google
```

The lanes upload metadata and images only. They do not upload binaries, submit
for review, automatically release the app, or promote Android beyond the
internal track. EAS handles binaries through the production submit profile.

## Pricing and subscriptions

`store-pricing.json` stays `pending-commercial-approval` until the Account
Holder approves UAE and Saudi monthly/yearly prices. Approval requires, for
each product and storefront:

- an Apple subscription price-point identifier;
- a Google Play regional amount in the storefront currency;
- a successful Apple and Google read-back record in each storefront entry;
- confirmation that no store introductory trial was added while Wafra's local
  three-day access period ships.

Subscription localizations generated in the package manifest must be entered
or synchronized when the store products are created. RevenueCat then maps both
platform products to entitlement `pro`; Wafra continues displaying only the
store-formatted price returned by RevenueCat.

## Work that remains external

- Real keyword popularity/difficulty data and final human keyword selection.
- Native Release captures on the target simulator/device sizes.
- App Store Connect and Play Console app/product creation.
- Commercial pricing, agreements, tax and territory approval.
- Hosted legal/support URLs and privacy/data-safety questionnaires.
- TestFlight and Play-installed purchase, restore, renewal and cancellation
  evidence.
- Google approval for Wafra's requested SMS permissions.
