# Wafra store launch package

This package is ready for account setup and device capture, not yet for public
submission. The canonical, length-checked copy and screenshot order live in
[`store-metadata.json`](./store-metadata.json). Run `npm run check:store` after
every change.

## Positioning by storefront

- **Initial distribution:** UAE and Saudi Arabia only. The shipping onboarding
  and ledger are AED/SAR; localized subscription billing does not make a
  USD/EUR/GBP/INR ledger appear. Broader storefront distribution waits for
  selectable ledger currencies and product QA in those markets.
- **Google Play default listing during restricted-permission review:** explain
  optional SMS-based money management prominently, including why `READ_SMS`
  imports retained supported alerts and `RECEIVE_SMS` keeps automatic tracking
  current. Do not rely on a country-specific listing that may not yet be live
  to justify the requested core permission.
- **Future global draft:** lead with private manual money tracking only after
  arbitrary ledger currencies ship. Do not imply universal bank parsing.
- **iPhone:** never say the app reads the Messages inbox. The current live path
  is a user-owned Message automation. Past-message import is a separate,
  user-run iOS 26.5+ Shortcut and stays out of acquisition copy until its exact
  published link passes the physical-device checklist.

RevenueCat and both stores may be configured for additional territories in
advance, but public app distribution remains AE/SA until the product currency
matches those users. The paywall must always show the storefront's localized
price string. Ledger currency and purchase currency are separate concepts.

## Screenshot production

Capture real native builds, not the Playwright web export. The existing App
Store set has duplicated Stats/Bills/Wallet frames and the old promotional
composites contain obsolete navigation and overly broad claims.

Run `npm run check:store-assets` before uploading anything. It rejects missing
frames, wrong dimensions, alpha channels and byte-identical screenshots. The
current repository intentionally fails this gate until new Release-native sets
replace the invalid assets.

Required launch sets:

| Store | Listing | Size | Locales | Frames |
| --- | --- | --- | --- | --- |
| App Store | Default | 1320×2868 (6.9-inch) | en-US, ar-SA | 8 each |
| Google Play | Gulf custom | 1080×1920 | English, Arabic | 8 each |
| Google Play | Gulf feature graphic | 1024×500 | English, Arabic | 2 total |

The Global Play screenshots and graphics in the metadata are future drafts,
not launch requirements. Produce them only after arbitrary ledger currencies
and their market QA ship.

The first three images must communicate the product without reading the long
description. Use one short benefit headline, one genuine app screen, large
legible figures, and no paragraph text. Include at least one dark-mode image
only if the submitted build's dark mode has passed contrast review.

Do not put real bank messages, names, card digits, setup tokens, relay URLs,
notification identifiers or live financial data in any asset. Seed synthetic
but internally consistent data and visibly mark App Review demo instructions as
synthetic outside the customer-facing screenshots.

## RevenueCat and stores

External configuration required before the paywall can sell:

1. Create `wafra_pro_monthly` and `wafra_pro_yearly` in both stores.
2. Put the Apple products in one subscription group. Configure Android base
   plans and territory pricing.
3. Create RevenueCat entitlement `pro`, attach both platform products to the
   matching monthly/yearly packages, and set a current Offering.
4. Add only the public `appl_…` and `goog_…` SDK keys to the evaluated app
   configuration. Never commit App Store Connect keys or Google service-account
   JSON.
5. Do not add a store introductory trial while Wafra grants its own local
   three-day trial.
6. Test new purchase, restore, renewal, cancellation, expiry, refund, Apple
   billing retry/grace, and Google grace/account hold from store-installed
   builds in at least 0-decimal, 2-decimal and 3-decimal price locales.

Before submission, add clickable Privacy Policy and Terms links beside the
paywall renewal copy. Complete and host the legal documents, then make the App
Store privacy and Play Data Safety answers match the exact shipped RevenueCat
SDK and optional import paths.

The included three days are granted by Wafra itself; they are not an Apple or
Google introductory trial, do not start a subscription, and do not charge the
user automatically. State that distinction in App Review notes and Play copy.

## Store-console package

- Apple: copyright, version notes, App Review contact and notes, demo path,
  Privacy Policy URL, Terms URL, support URL, App Privacy answers, encryption
  declaration, subscription localizations, and IAP review screenshots.
- Google Play: Financial Features declaration, SMS Permissions Declaration,
  Data Safety, app access, ads, content rating, target audience, 512×512 icon,
  feature graphic, localized screenshot alt text, tags, subscription/base-plan
  localizations, and cancellation link.
- Re-check Android target-SDK policy immediately before submission; the dated
  Play requirement changes independently of Expo SDK compatibility.

Run `npm run check:launch` to see metadata, screenshot and configuration gates
in one pass. It deliberately reports all groups even when more than one fails.

## Gates that still need external proof

- Xcode 26.2+ signed build for the current commit.
- A distinct, credential-free published history Shortcut link.
- Real iPhone validation of Find Messages, App Intent authentication, carrier
  SMS fields, large histories, lock/reboot, cleanup and offline behavior.
- TestFlight and Play closed-test purchase/restore evidence.
- Google approval for `READ_SMS` and `RECEIVE_SMS` under SMS-based money
  management.
- Export-compliance classification for the app's cryptography.
- Legal entity, jurisdiction, support address and hosted HTTPS policy URLs.
