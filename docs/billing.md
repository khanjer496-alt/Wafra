# Wafra billing and Superwall setup

Wafra uses Apple/Google for payment and **Superwall** for native paywalls,
campaigns, restore, subscription status and remote onboarding/value flows.

## Product contract

Create these subscriptions in both stores:

| plan | product id | reference price |
| --- | --- | --- |
| monthly | `wafra_pro_monthly` | US$9.99 |
| yearly | `wafra_pro_yearly` | US$74.99 |

The reference prices are documentation only. The shipped paywall must use the
storefront-formatted prices supplied by Apple/Google through Superwall.

Wafra currently grants its own local three-day Pro access period. **Do not add a
store introductory trial while that local clock ships**, or the two trials will
stack. Move the trial to the stores only in a release that removes the local
clock and updates every paywall/listing claim together.

## Superwall dashboard

1. Add the Wafra iOS and Android apps and connect their store products.
2. Use the entitlement named exactly `pro`.
3. Attach both monthly and yearly products to `pro` on both platforms.
4. Create placement `pro_upgrade` and publish its campaign/paywall.
5. Create placement `onboarding` using `docs/superwall-flow-spec.md`.
6. Keep `post_import_pro` reserved until its experiment is intentionally enabled.

A product purchase that is not attached to `pro` is misconfigured: the store
may charge successfully while Wafra correctly remains non-Pro.

## Public SDK keys

Wafra reads Superwall's public client keys from the EAS production environment:

```text
EXPO_PUBLIC_SUPERWALL_IOS_API_KEY
EXPO_PUBLIC_SUPERWALL_ANDROID_API_KEY
```

They are public SDK keys intended to ship in the app. Never place Superwall
secret/server credentials in an `EXPO_PUBLIC_*` value. The production release
gate blocks either platform when its public key is missing or placeholder-like.

Because `expo-superwall` contains native code, a new native build is required;
an OTA update cannot add the SDK to an older binary.

## Localization and privacy

Publish English and Arabic variants in Superwall. Wafra passes its saved app
language and market to each placement so the campaign can deterministically
select EN/AR even after an in-session language change. Manually QA Arabic RTL.

Wafra supplies only product/onboarding metadata: language, market, onboarding
focus/tracking/intention, capture choice and local trial days remaining. It does
**not** send ledger rows, balances, transaction amounts, SMS bodies, card/account
identifiers or the locally stored first name to Superwall.

When Wafra's saved local-only preference is active, optional Superwall event
tracking is set to `none` and Wafra-supplied targeting attributes are withheld.
Store purchase/restore remains usable.

## Entitlement behavior

`state.pro` is a local cache of the most recent confirmed store-backed Superwall
answer. Superwall's `UNKNOWN` status is intentionally **not** treated as inactive:
offline or temporarily unresolved billing must not revoke a previously confirmed
subscriber. Confirmed `INACTIVE` revokes Pro; confirmed `ACTIVE` grants it.

For iPhone automatic capture, a confirmed active subscription is mirrored into
the native App Intent gate. When exact transaction expiration is not yet
available, Wafra uses only a short bounded lease and replaces it when customer
information arrives.

## Existing RevenueCat subscribers

RevenueCat is no longer required in the Wafra binary. Existing subscriptions are
owned by Apple/Google, not by RevenueCat. On the Superwall build, verify old test
subscriptions using **Restore purchase** and confirm entitlement `pro` becomes
active. Keep the old RevenueCat dashboard only as long as needed for historical
reporting/audit; it is not the new runtime source.

## Physical-store QA

- Test monthly and yearly purchase on TestFlight and a Play-installed internal build.
- Test Restore for subscriptions created before the Superwall migration.
- Test cancel/refund/expiry and verify revocation occurs only on confirmed inactive state.
- Launch offline after a confirmed subscription and verify cached access is preserved.
- Check EN/AR and RTL on onboarding and every paywall variant.
- Verify Privacy, Terms, Restore and renewal wording on each published paywall.
- Verify iOS native capture entitlement stops after the real subscription expires.
- Never use a side-loaded Android APK as final Play Billing evidence.
