# Bank notification capture

Status: proposed design; platform qualification and real bank fixtures required before activation.

## Intended behavior

Capture new financial alerts from selected bank apps when their notifications arrive. Process them locally through Wafra's existing ledger and review paths. Cover purchases, refunds, incoming money, transfers, fees, card payments, and statement/due notices when the alert provides sufficient evidence. Classify balance updates, declined transactions, and pending authorizations separately; they must not create completed spending. Ignore OTPs, login/security alerts, and marketing.

Notification capture cannot recover dismissed notification history or reconstruct details the bank omitted. Android may expose notifications still present when access is enabled; treat that as an optional bounded recovery source, not historical coverage.

## Verified platform evidence

- Android provides `NotificationListenerService` callbacks for posted notifications with user-granted notification access. Work profiles and some older low-memory devices have restrictions. Source: https://developer.android.com/reference/android/service/notification/NotificationListenerService
- Apple demonstrated a Shortcuts automation triggered by notifications from a selected app, including text filters, at WWDC26. This provides a candidate integration route through a Wafra App Intent. The demonstration does not establish that Wafra receives all required alert fields reliably in the background or while locked. Source: https://developer.apple.com/videos/play/wwdc2026/310/
- Do not infer a supported minimum iOS version from the WWDC page: its chapter summary references iOS 26, while the session is WWDC26 and the current iOS 27 release notes are beta notes. Qualify the actual Shortcuts build and input behavior on a device before setting a version gate. Source: https://developer.apple.com/documentation/ios-ipados-release-notes/ios-ipados-27-release-notes
- Apple's Accessory Notifications framework is for accessory companion apps and customer use is limited to iPhones located in the EU with EU Apple Accounts. It is not an appropriate general-purpose Wafra capture solution. Source: https://developer.apple.com/documentation/accessorynotifications
- Expo work remains pinned to SDK 55: https://docs.expo.dev/versions/v55.0.0/

## Existing implementation

Android already has an encrypted notification queue, a listener, a curated bank package map, a Settings entry, and an import path with acknowledgement after durable writes. `TrustedBankNotificationPackages.CAPTURE_ENABLED` is explicitly false. The code requires held-out positive and negative real notification templates before enabling a package. Existing mocked tests do not satisfy that device/format requirement.

Relevant paths:

- `modules/notification-reader/android/src/main/java/expo/modules/notificationreader/`
- `src/lib/trusted-bank-notification-packages.ts`
- `src/lib/auto-import.ts`
- `src/lib/dedupe.ts`
- `src/app/settings.tsx`
- `scripts/test/android-review-capture.test.js`
- `scripts/test/contracts.test.js`

iOS currently provides a Message-based capture setup and generated App Intents. Message automation setup proof must not be reused as proof that notification capture works.

- `modules/wafra-live-capture/plugin/index.js`
- `modules/wafra-live-capture/ios/WafraLiveCaptureStore.swift`
- `src/lib/ios-capture-setup.ts`
- `src/lib/ios-local-capture.ts`
- `src/app/ios-setup.tsx`

## Proposed implementation

### Android

Enable only individually qualified bank packages. Retain explicit consent, encrypted bounded retention, and source filtering before persistence. Separate notification draining from SMS inbox permission and completion so a notification-only customer can use the feature without granting SMS access. Inspect and test those dependencies before activation.

Qualify notification title, normal text, expanded text, updates, and grouped summaries. Summary notifications must not generate duplicate transactions. A replacement notification identifier is not sufficient evidence that the underlying financial event is identical.

Persist incoming candidates when the UI is closed. Distinguish capture time from ledger processing time; do not advertise immediate background ledger updates until they have been implemented and verified. Preserve durable acknowledgement, retries, expiry, erase behavior, and permission-revocation behavior.

### iOS

First prove a selected bank's notification automation can pass title/body and useful source/time information into a minimal Wafra capture action. Check locked-screen operation, hidden previews, repeated alerts, Wafra closed, and failure/retry behavior. Record the exact iOS build and any required confirmation.

If qualified, introduce a notification-specific input adapter and setup guidance that reuses the encrypted local capture pipeline. Keep SMS and notification setup/proof independent. User-provided Shortcut text is not equivalent to Android's OS-provided package identity; never manufacture trusted sender provenance from a bank name typed into a Shortcut.

On iOS versions without a qualified notification trigger, automatic bank-app notification capture remains unavailable. Existing message capture and manual import remain available. Email or direct bank integrations would be separately scoped alternatives, dependent on the bank; they cannot be presented as notification capture.

### Shared processing

- Preserve the notification source channel for deduplication and diagnostics.
- Match SMS and notification representations of one transaction without collapsing two distinct purchases with equal amounts.
- Route incomplete or unfamiliar financial events to review with source-free structured fields. Do not guess amount, currency, account, direction, or completion state.
- Distinguish incoming transfers from income and card repayments from purchases through the existing accounting rules.
- Keep source bodies out of logs, analytics, and server calls; preserve existing local encrypted retention/deletion contracts.
- Validate both English and Arabic formats for any claimed UAE/Saudi package support.

## Acceptance evidence required

1. Real, redacted notification fixtures for each first bank: completed events plus OTP, marketing, balance-only, declined, pending, and incomplete examples. Keep a held-out set.
2. Android notification-only setup with SMS permission denied, app backgrounded, process restarted, and access revoked/restored.
3. iOS notification trigger qualification on the exact target build, including full alert content and capture while locked. No notification support claim based solely on a manual Shortcut run.
4. SMS/push duplicates, notification replacements/group summaries, two equal-value purchases, and retry after a failed durable write.
5. Erase, queue expiry, encrypted persistence, and absence of source bodies in network/log output.
6. Focused parser/accounting/native tests and independent review; then device validation of setup and recovery in both languages.

## Decisions needed to proceed

Identify the first bank apps and target iPhone iOS version. These determine the available capture route and the fixtures needed to safely enable it. No production behavior has been changed by this design.
