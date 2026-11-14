# Wafra iOS: App Privacy answers (draft for approval)

_Draft, 13 November 2026, for the iOS build on `release/1.0.0-rc1-reconciled` (app source as of `1e5229a4`). Nothing has been entered in App Store Connect. The answers go in only after the CEO approves them, and they must be re-checked against the exact archive that is submitted._

**These answers are valid only for an archive built with the `production` or `production-candidate` EAS profile.** The `capture-beta` profile (store distribution) sets `EXPO_PUBLIC_WAFRA_PARSER_RESEARCH` to `"1"` in `eas.json`. With that on, the parser-research screen sends redacted bank-message shapes and counts. That can start a GitHub Actions run of Claude Code (`.github/workflows/feedback-agent.yml`) and a draft PR with an agent summary (`.github/scripts/feedback-publish.mjs`), so Emails or Text Messages, and Customer Support processed by GitHub and Anthropic, would also need declaring.

This draft follows Apple's definitions:

- **Collected** means data leaves the device and the developer or a third-party partner can access it for longer than it takes to serve the request in real time.
- **Linked** means the data is tied to the user's identity, including through a persistent identifier.
- **Tracking** means linking the data with other companies' data for advertising, or sharing it with data brokers.

Data that stays on the iPhone is not "collected". Every claim cites the code at that commit, or the SDK source at its pinned version. Line numbers can shift after #223 and #224 merge; i18n strings are cited by key.

## Summary

- **Tracking: No.** There is no App Tracking Transparency prompt, no `NSUserTrackingUsageDescription`, no IDFA or AdSupport use, and no ads or analytics SDK. The lockfile has no Sentry, Firebase, Meta, AppsFlyer, Adjust, Branch, Amplitude, Mixpanel, PostHog, Segment or RevenueCat. SuperwallKit 4.16.1 declares `NSPrivacyTracking = false`.
- **Automatic collection for every user:**
  - Superwall: identifiers, purchases and device context.
  - Expo Updates: an install ID, and the previous fatal-error message after a crash.
- **Collected only when the user chooses a feature:** statement upload, feedback, trusted devices, opt-in sharing of bank-message formats, and opt-in online logos.

## Proposed answers

**The CEO's decisions of 13 November 2026 are applied below** (see "Decisions"). The answers stay a draft until the app's privacy manifest and the privacy policy match them, and nothing goes into App Store Connect until the CEO's go.

| App Store category: type | Source (evidence) | Purpose | Linked | Tracking | Optional? |
|---|---|---|---|---|---|
| **Purchases: Purchase History** | Superwall: StoreKit transaction JWS and `appTransactionId` in the redeem request (SuperwallKit 4.16.1 `Models/Web2App/RedeemRequest.swift:9-15`, `ReceiptManager.swift:114-133`), and entitlements in the `X-Entitlements` header (`Dependencies/DependencyContainer.swift:415-454`). Manifest: `Sources/SuperwallKit/Resources/PrivacyInfo.xcprivacy` @4.16.1 (Purchase History, App Functionality, not linked, no tracking). | App Functionality, Analytics (Superwall's labelling guide adds Analytics) | **Linked** (decision 1). It is sent with an install-persistent alias ID and Apple's per-account `appTransactionId`. | No | No |
| **Identifiers: Device ID** | Superwall `X-Vendor-ID` (IDFV) and `$SuperwallDevice:<IDFV>` (`DependencyContainer.swift:430, 651-653`); Expo `EAS-Client-ID`, a random per-install UUID (expo-updates 55.0.33 `ios/EXUpdates/AppLoader/FileDownloader.swift:464`, expo-eas-client 55.0.5 `EASClientID.swift:9-11`); the relay device ID and tokens created at pairing (`server/src/index.ts:1921-1949`); on a paired relay setup, the Expo push token, which goes to Expo's push service and is registered with the relay (`src/lib/background-relay.ts:283-299`; stored encrypted for 180 days, `server/src/push.ts:17`). | App Functionality | **Linked** (decision 1) | No | Superwall and Expo: no. Relay: created when the user uses statement import, trusted devices or opt-in format sharing, which pairs on its own (`src/lib/shared-alert-format-identity.ts:77`). Push token: relay setups only. |
| **Identifiers: User ID** | Superwall alias ID and `appTransactionId` (`RedeemRequest.swift:10-15`). The app never calls `identify` or `setUserAttributes`. | App Functionality | **Linked** (decision 1) | No | No |
| **Diagnostics: Crash Data** | expo-updates sends the `Expo-Fatal-Error` header, the previous fatal error message (up to 1024 characters), on the next launch (`FileDownloader.swift:468-473`). Wafra has no crash SDK. | App Functionality | **Linked** (decision 1). It is sent with `EAS-Client-ID`. | No | No |
| **Diagnostics: Other Diagnostic Data** | Superwall sends device model, OS version, radio type, low-power mode, interface style and SDK version on every request (`X-Device-Model`, `X-OS-Version`, `X-Radio-Type`, `X-Low-Power-Mode` etc., `Dependencies/DependencyContainer.swift:415-454`), plus the `/enrich` device template, `getTemplateDevice()` (`Network/Device Helper/DeviceHelper.swift:583-677`, with the properties it reads at `:304-424`). | App Functionality, Analytics | **Linked** (decisions 1 and 5) | No | No |
| **Usage Data: Product Interaction** | Superwall's `/enrich` template carries `appInstallDate`, `daysSinceInstall`, `totalPaywallViews`, `daysSinceLastPaywallView` and `isFirstAppOpen` (`getTemplateDevice()`, `DeviceHelper.swift:583-677`; properties at `:164, 304-424`). It isn't gated by `eventTrackingBehavior`. | App Functionality, Analytics | **Linked** (decisions 1 and 5) | No | No |
| **Location: Coarse Location** | Superwall's labelling guide lists IP-derived `ipCountry`, `ipCity`, `ipRegion` and `ipTimezone`, which its server derives from `/enrich` (`Network/Device Helper/DeviceHelper.swift:554-568`, not gated by `eventTrackingBehavior`). Server-side use can't be verified from code. | App Functionality, Analytics | **Linked** (decision 3: declared, and linked because it travels with the alias ID and IDFV) | No | No |
| **Financial Info: Other Financial Info** | Statement import uploads the file the user picks (PDF, CSV/TSV, XLSX, OFX/QFX, QIF, camt XML, MT940) to the Wafra relay (`src/lib/cloud-import.ts:268-280, 331-342`; `server/src/index.ts:2484, 2647, 2820`). A password-protected PDF's password is sent too, in the `x-wafra-pdf-password-b64` header (`src/lib/cloud-import.ts:267`; `server/src/index.ts:567`); no storage of it was found. Parsed rows are sealed for the device and deleted after acknowledgement, or after 30 days (`server/src/index.ts:3007-3041, 3592`). | App Functionality | **Linked** (decision 1; stored per paired device) | No | Yes. It is user-initiated and blocked in Private Mode (`src/components/supplement-imports.tsx:626`). |
| **User Content: Customer Support** | Feedback: typed text, an optional topic, app version, platform, locale, market and currency (`src/lib/feedback-transport.ts:91, 150-151`). No device ID, token or IP is stored (`server/schema.sql:164-202`), and it is kept 14 days (`server/src/feedback.ts:73`). | App Functionality | Not linked | No | Yes, with a preview and confirmation (`src/app/settings-data.tsx:624-628`) |
| **User Content: Other User Content** | Opt-in shared bank-message formats: sender code, direction, currency and generic wording with placeholders (`src/lib/shared-alert-format-sync.ts:63-80`), stored under an HMAC of the vault ID (`server/src/shared-formats.ts:182`). Trusted-device labels (`src/app/trusted-devices.tsx:79-82`). | App Functionality | **Linked** (decision 1; vault-keyed) | No | Yes. Formats are sent only when `shareAlertFormatsV1 === true`, after a consent prompt (`src/lib/shared-alert-format-share.ts:7-9`, `shared-alert-format-submit.ts:38-56`). |
| **User Content: Emails or Text Messages** | The legacy relay Shortcut posts message text and sender to `POST /v1/ingest` (`server/src/index.ts:2246-2481`). It is parsed in memory and the raw text is not stored (`server/schema.sql:1-6`). The release app can't create this setup (`shortcutSetupCode` has no callers), but an older TestFlight setup can keep uploading until it is retired (`src/hooks/use-auto-import.ts:128-136`). | App Functionality | Not declared once ingest is switched off (decision 2). If submission happens before that, declare it as **Linked** (decision 1: ingest is tied to the relay device and its token) | No | Yes, legacy only |

**Online logos (Brandfetch), declared (CEO, 13 Nov 2026):**
- **What leaves the device:** for a merchant or bank without a bundled logo, the cleaned merchant or bank name taken from the user's transactions and accounts, at most 80 characters and never amounts, account tails or raw bank text (`brandfetchSearchUrl`, `src/lib/verified-logo-identities.ts:35-39`; called from `src/lib/merchant-logo-resolver.ts:275-298` and `src/lib/bank-logo-resolver.ts:161-167`). Or a validated brand domain for the logo image (`verifiedLogoUrl`, `verified-logo-identities.ts:29-32`). Each request carries Wafra's app-wide Brandfetch client ID (`c=`, `:24-26`), which is the same for every user, and Brandfetch sees the request's IP address.
- **Category: both Purchases, Purchase History (the merchant names are the user's purchases) and Financial Info, Other Financial Info (the bank names).** Both types are already declared and Linked, so adding this flow to both costs nothing and avoids under-declaring.
- **Purpose:** App Functionality.
- **Optional:** yes. It's off by default and runs only after the user turns online logos on, never in Private Mode (`src/lib/store.tsx:316, 2636, 4222`; `src/lib/logo-cache-lifecycle.ts:31-34`; toggle `src/app/settings.tsx:1238-1241`).
- **Linked: No for this flow.** No device, install, account or user ID goes with the request, only the name or domain, the shared client ID, the IP and the User-Agent (app name and version, CFNetwork, Darwin). The requests don't strip cookies yet: React Native's `fetch` and expo-image use the system cookie store. A header-only check on 13 Nov 2026 found that `api.brandfetch.io` and `cdn.brandfetch.io` set no cookie. A follow-up code PR passes `credentials: 'omit'`, so this answer can't change silently. App Store Connect records linkage per data type, though, and Other Financial Info is already Linked for statement uploads, so the type stays Linked overall.
- **Tracking:** No.

**FX reference rates (Frankfurter):** only two currency codes and a date are sent (`src/lib/fx.ts:27, 68`). There is no identifier or user content. Recommend: not collected.

## Not collected: stays on the iPhone

- **Bank messages, notifications and Apple Pay purchases** captured by the current local Shortcuts. They sit in a backup-excluded queue for at most 30 days (`modules/wafra-live-capture/ios/WafraLiveCaptureStore.swift:93, 1104-1127`). No network action is allowed (`scripts/build-ios-local-capture-shortcut.mjs:586-598`).
- **The ledger**, including Apple Pay card links. It is stored in SQLCipher with a this-device-only Keychain key (`src/lib/state-storage.native.ts:3-5, 211-220`).
- **Widget data**, in the App Group's UserDefaults. There is no networking in `targets/` or `modules/` Swift (`modules/wafra-widgets/ios/WafraWidgetsModule.swift:13, 39`).
- **On-device AI**, onboarding answers, and stability and growth-funnel logs. These logs make no network calls (`src/lib/growth-funnel.ts:48`).
- **Diagnostic export:** there is none in release builds; it is development-only (`__DEV__`).
- **Backups and exports:** these go only where the user sends them through the share sheet.

## Decisions (CEO, 13 November 2026)

1. **Pseudonymous IDs are Linked.** Every type sent with a Superwall, Expo or relay identifier is marked Linked.
2. **Legacy `/v1/ingest` is switched off before submission**, on the CEO's go, right before submitting. A server-side global switch is preferred over a per-row `UPDATE devices SET shortcut_ingest_enabled = 0`. If only the `UPDATE` is used: export the `devices` table first, record the affected device IDs for rollback, and get the script reviewed by Reviewer and Security Reviewer. Android doesn't use `/v1/ingest`: only the retired iOS relay Shortcut posts to it (`scripts/build-ios-capture-shortcut.mjs:245`); the app only stores the URL in its relay config (`src/lib/relay.ts:359, 883, 950`). The in-app legacy-retirement copy must say the old Shortcut stops. Once ingest is off, Emails or Text Messages is not declared.
3. **Superwall coarse location: declared, Linked.**
4. **Apple Search Ads attribution: OFF**, so nothing was changed. The live iOS config that SuperwallKit downloads (`GET api.superwall.me/api/v1/static_config`, production iOS public key, 13 Nov 2026) has `attribution_options = {"apple_search_ads":{"enabled":false},"mmp":{"enabled":false}}`. SuperwallKit 4.16.1 decodes it as `Config.attribution` (`Config/Models/Config.swift:84`) and posts the token only when `appleSearchAds.enabled == true` (`AttributionPoster.swift`, around line 222). The dashboard's Integrations page lists no Apple Search Ads integration. Evidence: `Shared/launch-review/superwall-asa-attribution-2026-11-13.md` and `superwall-integrations-2026-11-13.png` (OpenBot shared folder, outside the repo).
5. **Superwall device context and usage counters: both declared** (Other Diagnostic Data, Product Interaction), Linked.

6. **Online logos (Brandfetch): declared** under Purchase History and Other Financial Info, App Functionality, optional, not linked for this flow (see above).

7. **Product Personalization: not a purpose (finding of 14 Nov 2026, awaiting the CEO's approval).** Android's Data safety form declares Personalization on User IDs, Approximate location and User interaction, because Superwall *can* target paywalls by user attributes. Wafra's Superwall setup doesn't:
   - **Every audience rule is an entitlement check.** In the live `static_config` (fetched 2026-11-14T00:14Z with the production iOS and Android keys), the only rules are on `pro_upgrade`, plus iOS `campaign_trigger`, which is a 0% holdout with no paywall. Each is `expression_cel = "size(device.activeEntitlements) == 0"`, so it only skips users who already have Pro, and each has empty `computed_properties` and `referenced_properties`. No rule reads location, an ID, user attributes, locale, install age or usage counters. Android's `onboarding` has no rules.
   - **The rule runs on the iPhone.** SuperwallKit 4.16.1 evaluates it locally, so nothing is sent for targeting (`Paywall/Presentation/Audience Logic/Expression Evaluator/CELEvaluator.swift:35-100`).
   - **The release app never registers a placement.** `presentProPaywall` and `presentOnboardingFlow`, the only `registerPlacement` calls, have no callers (`src/components/superwall-billing-provider.native.tsx:379-400`). `/pro` is Wafra's own purchase screen (`:584-588`). The app sets no user attributes and never calls `identify`.
   - **Superwall's own labelling guide** lists only App Functionality and Analytics as purposes.

   So no collected type is used to customise what the user sees, and Product Personalization is not declared. Android's Personalization entries are broader than this setup needs; that is the Android owner's call. Evidence: `Shared/launch-review/superwall-targeting-2026-11-14/` (OpenBot shared folder, outside the repo; trigger rules saved with the keys removed). Campaigns are dashboard settings: see the submission-day re-check under "Not verified". **If any audience ever filters on a non-entitlement property, add Product Personalization to the types it reads before submitting.**

## Mismatches found (to fix separately)

1. **`app.json` iOS privacy manifest (`:150-195`)** declares OtherFinancialInfo, PurchaseHistory, DeviceID, CustomerSupport and OtherUserContent, all `Linked: false`. It lacks User ID, Crash Data, Coarse Location (Linked), Other Diagnostic Data and Product Interaction, and Device ID must also cover the Expo push token. Every entry must be `Linked: true` per decision 1. It also has no `NSPrivacyAccessedAPITypes` entries for Wafra's own required-reason API use: UserDefaults for the App Group (reason 1C8F.1) and `ProcessInfo.systemUptime` in `WafraBackgroundAlertParser.swift` (`NSPrivacyAccessedAPICategorySystemBootTime`, reason 35F9.1). It should match the final answers. Open PR #194 ("align privacy manifest with the audited data flows") proposes a nine-type manifest; it is not on this base and must be reconciled with these answers before either merges.
2. **`docs/store-compliance/apple-app-store.md:7-8`** says Superwall collects "product events". Events are off: `eventTrackingBehavior: 'none'` and `isExternalDataCollectionEnabled: false` (`src/components/superwall-billing-provider.native.tsx:621-622, 368-371`). The doc also never mentions Expo.
3. **`docs/privacy-policy.md`:**
   - It doesn't mention the Expo Updates install ID, fatal-error reporting or Expo's push service (legacy).
   - `:391-397` lists only PDF and CSV/TSV, but XLSX, OFX/QFX, QIF, camt and MT940 are uploaded too. It also doesn't say that a PDF's password is sent to the relay to open the file.
   - `:377-380` says the language is sent "with a paywall request", but the app registers no placement; the locale goes to Superwall at configure time (`superwall-billing-provider.native.tsx:620`).
4. **In-app copy:** the `onboardHistoryGapBody` and `onboardHistoryGapManualBody` strings in `src/lib/i18n.ts` say statement import means "nothing leaves your phone". The onboarding import button (`src/components/onboarding-gate.tsx:1039, 1605`) opens `SupplementImports`, which uploads the file to the relay.
5. **Push registration TTL:** the client comment says 30 days (`src/lib/background-relay.ts:280-281`); the server uses 180 days (`server/src/push.ts:17`).

## Not verified

- Superwall's server-side retention and its use of IP-derived location.
- Superwall dashboard settings other than Apple Search Ads attribution. That one was verified off in the live `static_config` on 13 Nov 2026, but it's a server-side value the dashboard can change without a new build: **on submission day, re-fetch `static_config` and confirm `attribution_options.apple_search_ads.enabled` is `false`.** In the same fetch, confirm that every `trigger_options[].rules[]` entry is still `size(device.activeEntitlements) == 0`, with empty `computed_properties` and `referenced_properties` (decision 7).
- Whether EAS "production" environment variables override `eas.json`, for example `EXPO_PUBLIC_WAFRA_PARSER_RESEARCH` or the Brandfetch client ID.
- Whether the deployed relay Worker matches `server/`.
- Brandfetch's and Expo's own retention.
