# Personal Android review export

In the dedicated personal testing APK, open **Accounts → Settings → Privacy & data → Data → Export my data for review**. Read the disclosure, tap **Prepare my file**, grant SMS access if needed, then save the JSON through Android's share sheet. Attach the file to Codex manually when ready for review.

The unencrypted `wafra-personal-review-YYYY-MM-DD.json` contains:

- `sms.messages`: the full sender, text and timestamp of every received SMS still available in the Android inbox, including personal messages and verification codes. Sent and deleted messages, attachments and other apps' inboxes are not included.
- `backup`: Wafra's normal JSON backup, including recorded transactions, accounts, saved merchant/category corrections and preferences. It excludes purchase entitlements, trial state and the transient review tray. It is not a dump of credential stores.

Nothing is redacted or uploaded automatically. This combined review file is not itself a restore backup; its nested `backup` object uses the normal Wafra backup format. The ordinary diagnostic report and redacted parser report remain available separately.

Private Mode blocks this export. Closing Settings, switching its panel, backgrounding Wafra, changing Private Mode, or replacing/erasing the ledger cancels pending work. Permission loss or a failed inbox page fails the whole export. Sharing uses the existing app-owned file lifecycle: failed exports are removed; Android attachments remain available to receiving apps for a 24-hour grace period and are cleaned on the next app startup/foreground after expiry. Explicit data erase removes generated exports immediately.

## Build restriction

The control requires Android plus both `EXPO_PUBLIC_WAFRA_SMS_CORPUS_EXPORT=1` in JavaScript and `WAFRA_SMS_CORPUS_EXPORT=1` in the native binary. This is a build restriction, not an account or device identity lock. Keep the APK for personal testing. Production profiles and ordinary GitHub builds keep both flags disabled.

To preserve build 139's notification beta while adding this export, dispatch the existing `build-apk.yml` workflow against the reviewed source with `architecture=arm64`, `corpus=true`, `bundle=false`, and `notification_capture_beta=true`. The corpus workflow also enables the separate redacted parser-samples screen. Verify the output version is greater than 139 and the signing certificate matches the installed APK before offering it as an update. Do not publish this APK to the public download page or Play Store.
