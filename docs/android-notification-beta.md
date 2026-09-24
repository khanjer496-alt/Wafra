# Android bank-app notifications

Normal Android builds include a local financial-notification listener. For an
eligible hydrated Pro/trial/founder user, Wafra enables its local listener
automatically while tracking is active. Android still requires the user to
grant **Notification access** once. No separate Wafra opt-in toggle is required.

This source works **without READ_SMS permission or a completed SMS inbox scan**.
Bank SMS and bank-app push alerts use separate Android permissions. Wafra still
respects the saved global tracking opt-out and existing Pro/trial entitlement.
Native admission starts closed before hydration, then the eligible app enables it automatically;
turning tracking off erases the encrypted notification queue. Android's system
access can be revoked at any time. A newly queued alert also wakes a short
background task that, while the app is not in the foreground, applies the same
import rules as the app; anything left is processed when the app opens or
refreshes.

Because Android Notification access is device-wide, intake is layered:

- Exact package identities in `TrustedBankNotificationPackages.kt` provide
  strong issuer and market evidence. They are accepted from any installer,
  because restores, OEM stores and phone-clone migrations can leave the real
  bank app with no Play installer.
- Known messaging apps are decided next, before any installer check (see
  below).
- Every other app must be installed from Google Play and carry both a
  supported money marker and financial transaction/account context. Wafra
  refuses non-Play/sideloaded apps outside the two lanes above. Android does
  not expose the Play store category, so none is inferred. When the installed
  app's own label independently identifies a bank or finance institution, its
  confident parses may auto-import; outside the launch-tested UAE and Saudi
  formats that additionally requires a certified template. Otherwise the
  source is **review-only** and its package name is not treated as issuer
  proof. If the user confirms the review item, Wafra learns that package
  locally on that phone and future high-confidence alerts may auto-import.
  Dismissing the candidate teaches nothing.

### Messaging apps

A messaging app is never a bank's own notification channel. The known
messaging apps below are never financial candidates, never learned as a
trusted package and never auto-imported.

- **Known chat apps are never read.** Notifications from the packages in
  `chatAppPackages` (WhatsApp, WhatsApp Business, Telegram, Signal, Messenger,
  Viber, LINE, WeChat, imo and BOTIM) are never queued, and a queued row from an
  older build is acknowledged as ignored. A chat or social app outside that
  list is treated like any other Play app: review-only, as above.
- **SMS apps with READ_SMS granted:** notifications from the default SMS app
  and the known SMS apps in `smsAppPackages` are not queued, and a queued one
  is acknowledged as ignored. The SMS path already reads the same message.
- **SMS apps without READ_SMS (messaging-review lane):** the notification is
  the user's only route to a bank SMS. The default SMS app or a known SMS app,
  including a preinstalled one with no Play installer (for example Samsung
  Messages), is admitted only while READ_SMS is not granted, and only when the
  text carries financial context and a money marker. A row that reads as a
  bank alert goes to **Review only**. The Review card carries no package
  identity, so approving it never teaches Wafra to trust the SMS app, and later
  alerts from it still go to Review. A row the parser cannot resolve is treated
  as a personal message and is acknowledged (deleted from the queue) in the
  same scan instead of being kept for a future parser.

The listener rejects OTP/security prompts before persistence. A bounded,
seven-day queue stores candidates under an AndroidKeyStore key and acknowledges
them only after the ledger or source-free review write is durable. A bank-app
row the parser cannot resolve yet stays queued (until retention expires) so a
parser update can retry it; an SMS-app row does not (see above). A newly
granted listener also checks notifications still posted in the shade. A
dismissed alert cannot be recovered. Uncertain transaction facts go to Review;
balance-only information and offers must never create spending.

A group summary is skipped only while a child of its group is still visible;
a summary posted alone is read like any other notification. InboxStyle lines
and MessagingStyle messages are a running history, so they are read only when
no single-posting field (BIG_TEXT, TEXT and the other standard text fields)
carries an amount. Then the one entry that is identifiably the newest is used.
When two or more entries carry an amount and nothing says which is new
(untimed lines, or a tie at the newest timestamp), the alert is not dropped:
the lines and messages become ordinary candidates, as in earlier builds, and
the longest amount-bearing one is used, which can be an older charge. The
`conversationAmbiguous` admission counter records how often that happens.

## HSBC UAE qualification

`ae.hsbc.hsbcuae` is the [official HSBC UAE Google Play app](https://play.google.com/store/apps/details?id=ae.hsbc.hsbcuae)
and is Play-installed on the test phone. HSBC's [UAE mobile FAQ](https://www.hsbc.ae/ways-to-bank/mobile/app-faqs/)
also directs customers to Google Play. The other installed HSBC package,
`com.htsu.hsbcpersonalbanking`, is listed as [HSBC EG for Egypt](https://play.google.com/store/apps/details?id=com.htsu.hsbcpersonalbanking)
and is intentionally excluded from the UAE map.

The user's HSBC UAE purchase screenshot supplied a positive grammar shape;
tests use synthetic card, merchant, amount and limit values. They cover a
completed purchase followed by available credit, a balance-only alert, an
offer, OTP and an approval request. This does **not** establish which package
posted that screenshot, negative-format completeness, or live callback and
ledger behavior on the user's phone. Keep those outcomes explicit in release
evidence after installing the new build.

## Device acceptance

1. Check build signing and install as an update without deleting app data.
2. Enable Notification access from Wafra Settings. Verify Wafra reports it on.
   With READ_SMS denied, leave a supported bank's real alert posted and return
   to Wafra; verify the correct amount, merchant, card and date in the ledger
   or Review. Refresh twice to check deduplication.
3. Receive a new real spending alert while Wafra is backgrounded, then open or
   refresh it. Check the same fields and that no duplicate appears.
4. Check real OTP, marketing, balance-only, pending and declined alerts without
   putting source text in logs. Revoke access and the app's tracking choice;
   confirm no further capture and that queued candidates are erased on opt-out.
5. With READ_SMS denied, receive a real bank SMS: its Messages notification
   must reach Review only, and approving it must not make a later bank SMS
   auto-import. A personal text with an amount must leave no Review card.
   Grant READ_SMS and confirm Messages notifications create nothing new.

This design can discover new bank/finance apps without an app update, but parser
coverage is still evidence-based. Do not claim every bank or every push format
will parse automatically. Unknown sources fail into Review rather than silently
writing money to the ledger.
