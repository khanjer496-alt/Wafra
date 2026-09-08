# Android bank notification test builds

Bank-app notification capture is experimental and disabled in normal builds.
The owner can request an APK with the `notification_capture_beta` input enabled
in **Build Android APK** on canonical `main`. Keep `bundle=false`; the workflow
refuses to combine this test feature with a Play bundle.

The workflow supplies both `WAFRA_ANDROID_NOTIFICATION_CAPTURE_BETA=1` and
`EXPO_PUBLIC_WAFRA_ANDROID_NOTIFICATION_CAPTURE_BETA=1`. Native compilation
requires both values. The JavaScript drain and Settings also require the public
flag and native availability. An OTA cannot activate a normally compiled
binary. EAS/production profiles remain unchanged and default to capture off.

## On the test phone

1. Install the new test APK without uninstalling the existing app. Confirm its
   signing certificate matches the installed build before updating.
2. In Settings → Imports, enable bank SMS reading and finish the initial inbox
   scan. The current import coordinator requires this permission and enabled
   tracking before it can drain bank-app notifications too.
3. Open **Bank app notifications · Test**, read the experimental disclosure,
   then grant Wafra notification access in Android Settings. Return to Wafra;
   the access status should refresh.
4. Receive a real spending notification from a supported bank app installed
   through Google Play. Open or refresh Wafra and check the amount, currency,
   merchant, account/card and date in the ledger or review tray.
5. Reopen/refresh again and verify the same notification is not added twice.
   Check a balance-only update, marketing message and OTP separately: they
   must not become spending. Revoke notification access and confirm the UI
   reports that it is off.

Permission is device-wide, but Wafra's capture filter accepts only the exact
bank package identities in
`modules/notification-reader/android/src/main/java/expo/modules/notificationreader/TrustedBankNotificationPackages.kt`,
with Google Play recorded as installer. Unknown apps and sideloaded lookalikes
remain excluded. Do not forge installer identity or widen the package list to
make a test pass. A synthetic untrusted notification is a useful rejection
control, not evidence of successful bank-app capture.

The money marker, sensitive-message filter, encrypted queue and durable
acknowledgement remain active. A notification becomes a candidate; uncertain
facts must still go through financial review rather than being guessed into
the ledger. Notification access alone is not proof of compatibility with a
particular bank's templates.

## SMS, notifications and banners are separate

- **Read bank SMS** imports supported messages from Android's Messages inbox.
- **Bank app notifications · Test** reads eligible bank-app push alerts via
  Android's notification listener, then imports when Wafra runs.
- **Alert me on every charge** displays Wafra's own optional banner when a
  supported spending SMS arrives. It does not grant access to other apps'
  notifications.

Do not describe a passing SMS test, a Wafra charge banner, or an untrusted
notification rejection as a positive bank-app notification test. Keep the
installed build, source revision, permissions, producer app/provenance and
actual outcome in the test record. Real bank-package positive and negative
templates remain required before considering production enablement.
