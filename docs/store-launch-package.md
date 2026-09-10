# Wafra — global store launch package

_Updated 10 September 2026. `docs/store-metadata.json` is the machine-checked
source for listing copy; this document explains how to use it._

## Product position

Wafra is a **global personal money tracker**, not a Gulf-only product.

- The default store listing is English and can be distributed worldwide where
  the publisher's store agreements, tax, sanctions/export, privacy and local
  legal requirements allow it.
- A manual-only user chooses a supported ISO 4217 ledger currency before the
  first transaction. The phone's region may suggest a currency but never fixes
  it silently.
- The ledger currently represents currencies whose ISO minor-unit exponent is
  0, 2 or 3. It must not claim every ISO currency until exponent-4 currencies
  are supported too.
- Storefront billing currency is independent of ledger currency. Apple/Google
  supply the localized subscription price string; Wafra never converts a price
  from AED, USD or another ledger/reference currency.
- Automatic bank-alert posting is **not worldwide coverage**. UAE and Saudi
  market packs remain the launch-tested automatic packs. The worldwide parser
  may surface other strongly grounded alerts for user review, but it does not
  silently auto-post an unverified bank format.
- Localizations are added per market based on product/support readiness. Arabic
  remains supported in-app and may be published as an optional localization;
  it is not a prerequisite or the definition of the global launch.

## Default store story

The first product-page frames should explain the universal value before any
bank-specific capability:

1. Know your spending and money left.
2. Start manually without a bank login.
3. Bills and recurring charges in one place.
4. Card statement due dates without double-counting repayments as spending.
5. Category budgets and spending composition.
6. Accounts, cash out and transfers.
7. Private encrypted ledger and backup/export.
8. Optional supported imports, with coverage limitations visible.

Do not put a UAE flag, Saudi flag, “dirham”, a named local utility, or a local
bank in the default headline/feature graphic. A screenshot may contain a
synthetic example currency, but the surrounding store copy must make clear that
the ledger currency is user-selected.

## Google Play restricted SMS permissions

Google Play's current SMS/Call Log policy lists **SMS-based money management**
(for example budget tracking) as an exception eligible for `READ_SMS` and
`RECEIVE_SMS`, subject to review and approval:

https://support.google.com/googleplay/android-developer/answer/10208820

Wafra uses the permissions separately:

- `READ_SMS` — after the user chooses automatic Android tracking and sees the
  in-app disclosure, Wafra reads the Android inbox locally to find supported
  financial alerts. Non-financial messages are ignored; SMS text is not
  uploaded to Wafra's relay.
- `RECEIVE_SMS` — requested later, separately, only if the user enables the
  optional delivery-time transaction alert. A dedicated disclosure is shown
  immediately before this runtime request. The receiver checks the delivered
  SMS locally for financial activity and does not maintain a second raw-message
  archive.

Both uses must be described in the Play listing and Permissions Declaration.
Declining either permission must remain a real choice. Manual entry and explicit
imports must continue to work.

Google's prominent-disclosure policy requires the disclosure inside the app,
in normal usage, immediately before consent/permission, and to say what data is
accessed and how it is used/shared:

https://support.google.com/googleplay/android-developer/answer/10144311

The declaration package lives in `docs/store-compliance/google-play.md`.

## App Store privacy and iPhone capture

Never say that Wafra reads the iPhone Messages inbox. Apple provides no direct
third-party SMS inbox API.

The current primary iPhone automatic-capture path is a user-configured Message
automation that invokes Wafra's local App Intent on the same iPhone. Optional
email/PDF/trusted-device features use the relay separately when chosen.

App Store privacy answers must describe the union of Wafra and embedded SDK
behavior, including RevenueCat when production billing is enabled. Apple
requires a public privacy-policy URL and disclosure of third-party SDK data
practices:

https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy

The draft answers live in `docs/store-compliance/apple-app-store.md`.

## Subscriptions

Products remain:

- `wafra_pro_monthly`
- `wafra_pro_yearly`
- RevenueCat entitlement: `pro`

The commercial price is **not approved yet**. Reference values in repository
docs are planning values, not a promise to users.

Wafra currently grants three local app days. Do not also configure a storefront
free trial unless the local period is removed in the same release; otherwise
the two clocks stack.

Before production, test a store-installed build for purchase, restore, renewal,
cancellation, billing retry/grace, account hold where applicable, refund,
expiry and offline cached entitlement. Verify the exact store-formatted price
in representative 0-, 2- and 3-decimal storefront currencies (the current
read-back sample is JPY / USD / KWD).

## Asset rules

### Apple

Use a final release-like iPhone build. The preferred repository target is the
accepted 6.9-inch portrait size **1320×2868**, with no alpha channel. Apple
accepts one to ten screenshots and currently accepts several 6.9-inch sizes:

https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications

English is the required launch set. Additional localized sets are optional and
must be genuinely localized rather than byte-identical copies.

### Google Play

- Listing icon: 512×512 32-bit PNG with alpha, maximum 1 MiB.
- Feature graphic: 1024×500 JPEG or 24-bit PNG without alpha.
- At least two phone screenshots; the launch plan uses eight 1080×1920 frames
  for a strong 9:16 presentation.

Current specification:

https://support.google.com/googleplay/android-developer/answer/9866151

Do not ship the legacy Gulf feature graphic whose headline says “dirham” or
promotes a local SMS story as the whole product.

## Legal/support requirements

Publisher: **Nasida Apps LLC**.

Still requires publisher/counsel input before public submission:

- governing law in Terms;
- monitored public support contact;
- counsel review of Privacy Policy and Terms;
- any country-specific privacy/data-transfer, consumer, financial-app, tax or
  sanctions/export restrictions that affect worldwide availability.

The final support URL must lead to real contact information. Apple explicitly
requires the Support URL to let users reach the publisher:

https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/

## Release order

1. Freeze a candidate commit.
2. Run typecheck, lint, tests, browser E2E, store metadata/pricing/assets checks,
   release configuration check and dependency/security review.
3. Build signed App Store and Play candidates from that exact commit.
4. Verify bundle/package IDs, version/build numbers, Android target API, SQLCipher,
   production flags, SDK keys, signing identities and artifact hashes.
5. Install from TestFlight / Play internal testing, not only side-loaded builds.
6. Complete the physical-device matrix in `docs/store-compliance/global-launch-board.md`.
7. Complete store privacy/policy forms from the exact submitted artifact.
8. Run closed/external beta as required.
9. Obtain explicit publisher sign-off before public production submission.
10. Use staged/phased release where available and follow the rollback/monitoring
    plan in `docs/store-compliance/monitoring-and-rollback.md`.

Public production submission is never an automatic side effect of a commit,
build or metadata preparation task.
