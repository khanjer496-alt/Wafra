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
access can be revoked at any time. Wafra processes eligible alerts when the
app opens or refreshes, not as an immediate background ledger write.

Because Android Notification access is device-wide, intake is layered. Wafra
refuses non-Play/sideloaded apps. Exact package identities in
`TrustedBankNotificationPackages.kt` provide strong issuer and market evidence.
Other Google Play apps in Android's Finance category may use the universal
parser. An otherwise unknown Play app must carry both a supported money marker
and financial transaction/account context; that source is **review-only**.
Its package name is not treated as issuer proof. If the user confirms the review
item, Wafra learns that package locally on that phone and future high-confidence
alerts may auto-import. Dismissing the candidate teaches nothing.

The listener rejects OTP/security prompts before persistence. A bounded,
seven-day queue stores candidates under an AndroidKeyStore key and acknowledges
them only after the ledger or source-free review write is durable. A newly
granted listener also checks notifications still posted in the shade. A
dismissed alert cannot be recovered. Uncertain transaction facts go to Review;
balance-only information and offers must never create spending.

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

This design can discover new bank/finance apps without an app update, but parser
coverage is still evidence-based. Do not claim every bank or every push format
will parse automatically. Unknown sources fail into Review rather than silently
writing money to the ledger.
