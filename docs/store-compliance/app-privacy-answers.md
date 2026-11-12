# Wafra iOS: App Privacy answers (draft for approval)

_Draft, 13 November 2026, for the iOS build on `release/1.0.0-rc1-reconciled` (app source as of `1e5229a4`). Nothing has been entered in App Store Connect. The answers go in only after the CEO approves them, and they must be re-checked against the exact archive that is submitted._

This draft follows Apple's definitions:

- **Collected** means data leaves the device and the developer or a third-party partner can access it for longer than it takes to serve the request in real time.
- **Linked** means the data is tied to the user's identity, including through a persistent identifier.
- **Tracking** means linking the data with other companies' data for advertising, or sharing it with data brokers.

Data that stays on the iPhone is not "collected". Every claim cites the code at that commit, or the SDK source at its pinned version.

## Summary

- **Tracking: No.** There is no App Tracking Transparency prompt, no `NSUserTrackingUsageDescription`, no IDFA or AdSupport use, and no ads or analytics SDK. The lockfile has no Sentry, Firebase, Meta, AppsFlyer, Adjust, Branch, Amplitude, Mixpanel, PostHog, Segment or RevenueCat. SuperwallKit 4.16.1 declares `NSPrivacyTracking = false`.
- **Automatic collection for every user:**
  - Superwall: identifiers, purchases and device context.
  - Expo Updates: an install ID, and the previous fatal-error message after a crash.
- **Collected only when the user chooses a feature:** statement upload, feedback, trusted devices, opt-in sharing of bank-message formats, and opt-in online logos.

## Proposed answers

`DECIDE` marks the CEO's choices. Each one comes with a recommendation.

| App Store category: type | Source (evidence) | Purpose | Linked | Tracking | Optional? |
|---|---|---|---|---|---|
| **Purchases: Purchase History** | Superwall: StoreKit transaction JWS and `appTransactionId` in the redeem request (SuperwallKit 4.16.1 `Models/Web2App/RedeemRequest.swift:9-15`, `ReceiptManager.swift:114-133`), and entitlements in the `X-Entitlements` header (`Dependencies/DependencyContainer.swift:415-454`). Manifest: `Sources/SuperwallKit/Resources/PrivacyInfo.xcprivacy` @4.16.1 (Purchase History, App Functionality, not linked, no tracking). | App Functionality, Analytics (Superwall's labelling guide adds Analytics) | **DECIDE. Recommend: Linked.** It is sent with an install-persistent alias ID and Apple's per-account `appTransactionId`. | No | No |
| **Identifiers: Device ID** | Superwall `X-Vendor-ID` (IDFV) and `$SuperwallDevice:<IDFV>` (`DependencyContainer.swift:430, 651-653`); Expo `EAS-Client-ID`, a random per-install UUID (expo-updates 55.0.33 `ios/EXUpdates/AppLoader/FileDownloader.swift:464`, expo-eas-client 55.0.5 `EASClientID.swift:9-11`); the relay device ID and tokens created at pairing (`server/src/index.ts:1921-1949`). | App Functionality | **DECIDE. Recommend: Linked**, because these are persistent identifiers. | No | Superwall and Expo: no. Relay: only when the user pairs. |
| **Identifiers: User ID** | Superwall alias ID and `appTransactionId` (`RedeemRequest.swift:10-15`). The app never calls `identify` or `setUserAttributes`. | App Functionality | **DECIDE. Recommend: Linked.** | No | No |
| **Diagnostics: Crash Data** | expo-updates sends the `Expo-Fatal-Error` header, the previous fatal error message (up to 1024 characters), on the next launch (`FileDownloader.swift:468-473`). Wafra has no crash SDK. | App Functionality | **DECIDE. Recommend: Linked.** It is sent with `EAS-Client-ID`. | No | No |
| **Location: Coarse Location** | Superwall's labelling guide lists IP-derived `ipCountry`, `ipCity`, `ipRegion` and `ipTimezone`, which its server derives from `/enrich` (`Network/Device Helper/DeviceHelper.swift:554-568`, not gated by `eventTrackingBehavior`). Server-side use can't be verified from code. | App Functionality, Analytics | **DECIDE. Recommend: declare it, Not linked**, unless Superwall confirms in writing that it keeps no IP-derived location. | No | No |
| **Financial Info: Other Financial Info** | Statement import uploads the file the user picks (PDF, CSV/TSV, XLSX, OFX/QFX, QIF, camt XML, MT940) to the Wafra relay (`src/lib/cloud-import.ts:268-280, 331-342`; `server/src/index.ts:2484, 2647, 2820`). Parsed rows are sealed for the device and deleted after acknowledgement, or after 30 days (`server/src/index.ts:3007-3041, 3592`). | App Functionality | **DECIDE. Recommend: Linked** (stored per paired device). | No | Yes. It is user-initiated and blocked in Private Mode (`src/components/supplement-imports.tsx:626`). |
| **User Content: Customer Support** | Feedback: typed text, an optional topic, app version, platform, locale, market and currency (`src/lib/feedback-transport.ts:91, 150-151`). No device ID, token or IP is stored (`server/schema.sql:164-202`), and it is kept 14 days (`server/src/feedback.ts:73`). | App Functionality | Not linked | No | Yes, with a preview and confirmation (`src/app/settings-data.tsx:624-628`) |
| **User Content: Other User Content** | Opt-in shared bank-message formats: sender code, direction, currency and generic wording with placeholders (`src/lib/shared-alert-format-sync.ts:63-80`), stored under an HMAC of the vault ID (`server/src/shared-formats.ts:182`). Trusted-device labels (`src/app/trusted-devices.tsx:79-82`). | App Functionality | **DECIDE. Recommend: Linked** (vault-keyed). | No | Yes. Formats are sent only when `shareAlertFormatsV1 === true`, after a consent prompt (`src/lib/shared-alert-format-share.ts:7-9`, `shared-alert-format-submit.ts:38-56`). |
| **User Content: Emails or Text Messages** | The legacy relay Shortcut posts message text and sender to `POST /v1/ingest` (`server/src/index.ts:2246-2481`). It is parsed in memory and the raw text is not stored (`server/schema.sql:1-6`). The release app can't create this setup (`shortcutSetupCode` has no callers), but an older TestFlight setup can keep uploading until it is retired (`src/hooks/use-auto-import.ts:128-136`). | App Functionality | **DECIDE.** See decision 2. | No | Yes, legacy only |

**Online logos (Brandfetch):** a cleaned merchant or bank name plus an app-wide client ID go to Brandfetch (`src/lib/verified-logo-identities.ts:24-39`, `merchant-logo-resolver.ts:275-298`). The feature is off by default and needs opt-in (`src/lib/store.tsx:316`; toggle `src/app/settings.tsx:1238-1241`). **DECIDE. Recommend:** declare it as Other Data, not linked, optional. Alternatively, treat it as real-time serving with no retention by Wafra; Brandfetch's own retention is not verified.

**FX reference rates (Frankfurter):** only two currency codes and a date are sent (`src/lib/fx.ts:27, 68`). There is no identifier or user content. Recommend: not collected.

## Not collected: stays on the iPhone

- **Bank messages, notifications and Apple Pay purchases** captured by the current local Shortcuts. They sit in a backup-excluded queue for at most 30 days (`modules/wafra-live-capture/ios/WafraLiveCaptureStore.swift:93, 1104-1127`). No network action is allowed (`scripts/build-ios-local-capture-shortcut.mjs:586-598`).
- **The ledger**, including Apple Pay card links. It is stored in SQLCipher with a this-device-only Keychain key (`src/lib/state-storage.native.ts:3-5, 211-220`).
- **Widget data**, in the App Group's UserDefaults. There is no networking in `targets/` or `modules/` Swift (`modules/wafra-widgets/ios/WafraWidgetsModule.swift:13, 39`).
- **On-device AI**, onboarding answers, and stability and growth-funnel logs. These logs make no network calls (`src/lib/growth-funnel.ts:48`).
- **Diagnostic export:** it exists only in development builds (`src/components/diagnostic-export-control.tsx:24-26`).
- **Backups and exports:** these go only where the user sends them through the share sheet.

## Decisions for the CEO

1. **Linked or not linked for pseudonymous IDs.** Wafra has no account, but Superwall, Expo and the relay all use persistent install or device IDs. Recommendation: mark every type sent with one of these IDs as **Linked**. Over-declaring is safe; under-declaring is a review and legal risk.
2. **Legacy `/v1/ingest`.** Option A: switch shortcut ingest off server-side before submission (`shortcut_ingest_enabled` defaults to 1 per `server/migrations/2026-08-25-shortcut-ingest-retirement.sql`), then don't declare Emails or Text Messages. Option B: declare Emails or Text Messages (optional, App Functionality). Recommendation: **A**. It also closes the off-device path the in-app disclosures warn about.
3. **Coarse Location from Superwall.** Declare it, or get written confirmation from Superwall. Recommendation: declare it, not linked.
4. **Apple Search Ads attribution in the Superwall dashboard.** SuperwallKit posts the attribution token when `attribution.appleSearchAds.enabled` is on (`Analytics/Attribution/AttributionPoster.swift:223`). This is not verified. If it is on, either turn it off or add advertising-data handling to the answers.

## Mismatches found (to fix separately)

1. **`app.json` iOS privacy manifest (`:150-195`)** declares OtherFinancialInfo, PurchaseHistory, DeviceID, CustomerSupport and OtherUserContent, all `Linked: false`. It lacks User ID, Crash Data and Coarse Location, and has no `NSPrivacyAccessedAPITypes` entry for Wafra's own UserDefaults App Group use. It should match the final answers.
2. **`docs/store-compliance/apple-app-store.md:7-8`** says Superwall collects "product events". Events are off: `eventTrackingBehavior: 'none'` and `isExternalDataCollectionEnabled: false` (`src/components/superwall-billing-provider.native.tsx:621-622, 368-371`). The doc also never mentions Expo.
3. **`docs/privacy-policy.md`:**
   - It doesn't mention the Expo Updates install ID, fatal-error reporting or Expo's push service (legacy).
   - `:391-397` lists only PDF and CSV/TSV, but XLSX, OFX/QFX, QIF, camt and MT940 are uploaded too.
   - `:377-380` says the language is sent "with a paywall request", but the app registers no placement; the locale goes to Superwall at configure time (`superwall-billing-provider.native.tsx:620`).
4. **In-app copy:** `src/lib/i18n.ts:2026, 2028` says statement import means "nothing leaves your phone". The onboarding import button (`src/components/onboarding-gate.tsx:1039, 1605`) opens `SupplementImports`, which uploads the file to the relay.
5. **Push registration TTL:** the client comment says 30 days (`src/lib/background-relay.ts:280-281`); the server uses 180 days (`server/src/push.ts:17`).

## Not verified

- Superwall's server-side retention and its use of IP-derived location.
- Superwall dashboard settings, including Apple Search Ads attribution.
- Whether EAS "production" environment variables override `eas.json`, for example `EXPO_PUBLIC_WAFRA_PARSER_RESEARCH` or the Brandfetch client ID.
- Whether the deployed relay Worker matches `server/`.
- Brandfetch's and Expo's own retention.
