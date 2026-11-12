# Billing data minimization

The provider initializes iOS and Android Superwall with event collection `none`,
external collection disabled and experimental device variables disabled. Leaving
Private Mode does not re-enable events. Wafra does not call `identify`, write
custom user attributes, fetch user attributes during entitlement refresh, or
attach demographic/onboarding/caller parameters to placement requests. The only placement
parameter is `language` (`"en"` or `"ar"`, the saved app display language), pinned by tests.
Store products, purchase, restore and verified entitlement refresh remain active.

## Pinned SDK limit

The installed Expo bridge pins SuperwallKit 4.16.1. Its public options expose no
separate Apple Search Ads, enrichment or IDFV/alias suppression switch.
`eventTrackingBehavior = none` suppresses SDK events and MMP install matching;
it must not be represented as a proven stop for every network request:

- `AttributionPoster.swift` checks remote `attribution.appleSearchAds.enabled`
  before obtaining/sending AdServices tokens. Its separate token path does not
  test `eventTrackingBehavior`.
- `ConfigManager.swift` calls `DeviceHelper.getEnrichment`; `Network.getEnrichment`
  still makes the request after its optional event is suppressed.
- `DeviceHelper.getTemplateDevice` includes SDK alias, vendor ID and device data
  in core requests. Wafra adds no identifier or alias of its own.

These facts were read from the upstream **4.16.1 tag**, not inferred from a newer
documentation example. The `none` option alone cannot certify that ASA is off,
that coarse location is absent, or that SDK identifiers serve only entitlements.
Do not add unsupported boolean properties and claim they reached the SDK.

## Remaining release evidence

After the Wafra dashboard sign-in, verify ASA/Attribution, Integrations, data
forwarding and Campaigns. Wafra runs no ads. The intended final answer is Tracking
No and no Advertising Data only after the effective configuration supports it.
Keep Coarse Location if enrichment still collects it. Confirm the actual
production-equivalent candidate's network behavior and embedded manifests, then
reconcile app configuration, policy and App Store answers. SDK/generated IDs and
purchase processing still need correct linkage disclosures.

Run native purchase/restore/entitlement tests and remote onboarding after these
changes: collection reduction can change audience targeting/analytics, even when
billing still works. Local callback tests do not establish StoreKit behavior.

Primary sources:
- https://github.com/superwall/Superwall-iOS/tree/4.16.1/Sources/SuperwallKit
- https://superwall.com/docs/ios/sdk-reference/SuperwallOptions

The after-launch scheduled pending-format purge is tracked in
https://github.com/khanjer496-alt/Wafra/issues/178. Current policy must describe
the actual opportunistic cleanup and retained published/blocked shapes and votes.
