# iOS 27 notification capture — local implementation evidence

Date: 2026-09-23. Canonical checkout: `/Users/naserkhanjar/Wafra`, branch `main`.
No commit, push, release, TestFlight upload, or physical iOS 27 capture claim is made.

## Implemented flow

- iOS 27 plus native capability exposes notification setup before the SMS bank picker. Notification users skip Wafra's upfront bank-name question; they select their bank app in Apple's Notification automation. SMS setup retains its bank selection.
- Explicit consent and active entitlement are required before enabling capture. The bundled, signed **Wafra Notifications v1** Shortcut can be shared to Shortcuts from the app. Manual action setup remains a fallback.
- Running the Shortcut without input sends only `Wafra notification setup check` to the native action. This establishes a permission/setup proof without inserting a queue record or financial transaction. Actual notification receipt is shown separately and is not described as a posted transaction.
- The AppIntent **Capture bank notification** accepts text from Shortcuts into Wafra's protected native queue without opening the app. It does not directly read other apps' notifications. User-owned Notification automation is still required.
- Native reading is additive: old JavaScript receives SMS records only; updated JavaScript opts into notification records through a separate method. Old updates cannot ACK unread notification records.

## Financial and privacy boundaries

Notification text has no trusted bank-app identity. A bank named in the body can guide parsing; missing issuer evidence cannot inherit an unrelated onboarding bank answer. OTP and promotional alerts are not posted. Supported distinct ordinary transactions can import automatically. Non-transaction financial events, including card payments and statements, use existing source-free Review conversion instead of automatic accounting mutations; unrepresentable alerts remain unposted.

An observation UUID is a local queue receipt, never an Apple Message hash or bank transaction identity. New automatically posted transaction rows retain a validated UUID receipt. A retry of that saved observation is ACK-only, including after authoritative SMS healing and user corrections.

Fresh matching observations are ambiguous and require Review. The guard compares saved SMS/push rows and every SMS transaction on the same drain page, seeded before notification comparison regardless of queue order. This includes SMS-first and SMS-healed matches. Pending and resolved Review identities also make retries inert after user edits. Incoming SMS retains its existing reconciliation behavior.

The Review tray protects up to 50 local notification reviews without eviction; other sources retain their existing newest-50 quota. The same schema can therefore contain up to 100 source-free entries. A notification exceeding its quota remains in the native queue until a slot is available; the drain stops rather than repeatedly spinning. ACK follows durable ledger/review persistence. This is a bounded queue, not indefinite archival storage: native records expire after 30 days.

## Shipping asset

Normal shipping resource: `modules/wafra-live-capture/ios/Resources/Wafra Notifications v1.shortcut`.

- 22,747 bytes; signed AEA1 container.
- SHA-256: `93e9c6e120a6a7bedeb95a3b4b952c7a57cbad9622ba269562de1413e6608fcc`.
- Fixed native resource lookup; no caller-provided file path.
- Existing podspec resource glob includes the asset. Incremental CocoaPods installation registered it in the resource build phase. Host resource tests resolve the actual bundle asset and verify container signature header/size.
- Builder/signing evidence and its 55 tests are documented separately in `2026-09-23-ios-notification-shortcut.md` by the coordinating task.

## Validation

- Fresh real-source test compilation and app TypeScript typecheck pass.
- Combined iOS journey, notification parser/replay, sender/date/decline regression, and Shortcut builder checks pass: **281 tests, 281 passed**. The actual coordinator regression exercises both mixed native page orders, durable save, failed ACK, user correction, and retry without reposting.
- Native host tests: 156 store, 71 bridge, 94 actual resource-bundle checks; zero failures. Debug and Release AppIntent typechecks pass.
- Existing local-capture Shortcut contract suite passes.
- Focused lint and `git diff --check` pass.
- Earlier integration runs: capture contracts 400, setup 281, tray 82, import planner 296, persistence 250 checks passed. These are scoped checks, not a full repository CI or physical-device result.

Logs are retained under `/tmp/wafra-ios27-*`; executable regression tests are in normal `scripts/test/ios-journey` and `scripts/test/repair` paths.

## Independent review

The coordinating task completed a final read-only money/replay/capacity review with no remaining actionable findings in its agreed scope. Its fresh five-file run passed **39/39** checks, including the actual coordinator regression in both native page orders. The reviewer confirmed source text is cleared before replay comparison, all inbox outcomes seed the guard before notifications, and generation/durability boundaries remain intact. Earlier UI/native packaging review also reported no blocking findings. These are scoped source reviews, not release approval.

## Remaining device/release evidence

The available physical iPhone runs iOS 26.6.2. No iOS 27 device run was possible. Apple's documentation describes the Notification automation trigger, but does not establish the precise runtime text representation delivered by that trigger. Real installation, exact installed Shortcut name, notification-to-text conversion, closed/locked/background delivery, reboot behavior, and actual bank notification posting still need iOS 27 device verification.

A full app build was not rerun with only roughly 3–4 GiB free disk space after an earlier no-space build failure. Host Swift tests and AppIntent typechecks do not replace a signed app build. This work is locally implemented and tested; it is not published or verified as live iOS 27 capture.

Platform references: [Apple event triggers](https://support.apple.com/guide/shortcuts/event-triggers-apd932ff833f/ios), [Expo SDK 55](https://docs.expo.dev/versions/v55.0.0/), [Expo SDK 55 Sharing](https://docs.expo.dev/versions/v55.0.0/sdk/sharing/).
