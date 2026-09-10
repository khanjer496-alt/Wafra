# Wafra — store listing editorial guide

`docs/store-metadata.json` is the **canonical, machine-validated upload source**.
Do not paste older copy from git history or from this file into a store console.

## Launch position

Wafra launches as a **worldwide personal money tracker**, with English as the
required default listing. Arabic is supported in the app and is an optional
store localization. UAE/Saudi bank-alert listings are optional market-specific
custom listings; they are not the definition of the product or a prerequisite
for global distribution.

The default story is universal:

- track expenses, income, budgets, bills, recurring charges and savings goals;
- choose a supported ISO 4217 ledger currency before recording money;
- use manual entry without a bank login or message permission;
- optionally use an import method when the country, bank and exact format are
  supported;
- keep the main ledger encrypted on the device; and
- buy Wafra Pro through Apple/Google using the storefront-formatted price, not
  the ledger currency.

Never claim “every bank”, “all currencies”, “worldwide parsing”, guaranteed
background capture, or direct iPhone Messages-inbox access. The money engine
currently supports ISO currencies with 0, 2 or 3 minor-unit decimal places;
automatic launch-tested posting packs remain AE/SA and unfamiliar formats are
review/manual rather than guessed.

## Android-sensitive permission copy

The Google Play default listing must explain that `READ_SMS` is optional and is
used for a user-requested retained bank-alert scan processed on-device.
`RECEIVE_SMS` is a separate optional permission requested only for delivery-time
transaction alerts. Declining either permission leaves manual entry usable.

Use `docs/store-compliance/google-play.md` for the Permissions Declaration,
Financial Features and Data Safety preparation notes.

## iPhone copy

Do not say that Wafra reads the iPhone SMS/Messages inbox. Current automatic
capture is a user-configured Apple Message automation invoking Wafra's local App
Intent on the same iPhone. Optional network-backed email/statement/trusted-device
features are separate choices described in the Privacy Policy.

Use `docs/store-compliance/apple-app-store.md` for App Privacy, review notes and
export-compliance preparation.

## Required publisher fields before public submission

- **Contact/support:** [[PUBLIC SUPPORT CONTACT — required before publishing]]
- **Privacy URL:** configured public HTTPS URL required
- **Terms URL:** configured public HTTPS URL required
- **Support URL:** configured public HTTPS URL required
- **Governing law/counsel approval:** required; do not infer from company
  formation state or a user's residence

## Assets

Required launch assets are global/default assets, not Gulf-branded artwork:

- App Store: eight English 6.9-inch portrait captures at 1320×2868 in the
  repository's current target set.
- Google Play: eight global-English 1080×1920 phone captures plus a neutral
  1024×500 opaque feature graphic.

Real release-like captures are required. Do not manufacture screenshots that do
not match a shipping screen. `npm run check:store-assets` stays red until the
global asset set exists and passes its mechanical checks.
