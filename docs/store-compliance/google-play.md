# Google Play compliance package

_Prepared 10 September 2026. Complete against the exact AAB uploaded to Play._

## Financial features declaration

Wafra is a **personal budgeting / expense-tracking app**. It is not a bank,
payment processor, lender, broker, crypto exchange, remittance service, wallet
that holds funds, or financial-advice service. It cannot initiate, approve or
move money. Users record or import information about activity that already
happened.

## SMS permissions declaration

Permitted-use category: **SMS-based money management / budgeting**, subject to
Google Play review.

- `READ_SMS`: requested only after the user chooses Android automatic tracking.
  Wafra scans retained SMS locally for supported financial alerts so it can build
  the user's private ledger. Non-financial messages are ignored and SMS text is
  not uploaded to Wafra's relay.
- `RECEIVE_SMS`: requested separately only when the user enables instant
  transaction alerts. Wafra inspects a newly delivered SMS locally for supported
  financial activity and can show the optional alert. It does not maintain a
  second raw-SMS archive.
- Both permissions are optional. Manual entry, pasted alerts and backup/restore
  remain usable when either permission is declined.

Reviewer evidence to attach: release-build screen recording showing the in-app
prominent disclosure immediately before each Android permission prompt, a deny
path that leaves manual entry usable, an approved historical scan, and a live
supported bank alert creating one ledger entry.

## Data Safety draft

Do **not** submit “No data collected” without reviewing the exact enabled SDKs
and optional network features in the submitted AAB.

- Android SMS/bank-notification content used for automatic tracking is processed
  on-device and is not uploaded to the relay.
- Main ledger records are stored in encrypted app storage on the device.
- RevenueCat, when production billing is configured, processes an anonymous app
  user identifier and purchase/subscription information for entitlement
  functionality. Use RevenueCat's current Play Data Safety guidance for the
  exact SDK version before submitting the form.
- Optional feedback deliberately sends the exact previewed, redacted report to
  Wafra's relay and retains it for at most 14 days.
- Optional statement/email/trusted-device features can send user-selected data
  to Wafra's relay as described in the Privacy Policy; raw statement/email data
  is processed transiently and structured results are device-sealed.
- Wafra has no ads or third-party analytics in the current repository.

## Remaining Play Console blockers

- Sensitive SMS permission declaration approval.
- Final Data Safety answers checked against the uploaded AAB and RevenueCat SDK.
- Financial features declaration, content rating, target audience and app-access
  tasks in the publisher's Play Console.
- Production RevenueCat products/key and store-formatted pricing verification.
- Global English Play screenshots and 1024×500 feature graphic captured from a
  release-like build.
- Public Privacy/Terms/Support URLs and monitored support contact.

