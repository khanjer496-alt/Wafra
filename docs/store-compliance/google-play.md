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
- Superwall, when production billing is configured, processes purchase/
  subscription state plus paywall/onboarding interaction data according to its
  shipping SDK behavior. Wafra supplies only non-financial targeting metadata
  and never sends Android bank-alert content to Superwall.
- Optional feedback deliberately sends the exact previewed, redacted report to
  Wafra's relay and retains it for at most 14 days.
- Optional statement/email/trusted-device features can send user-selected data
  to Wafra's relay as described in the Privacy Policy; raw statement/email data
  is processed transiently and structured results are device-sealed.
- Wafra has no ads or third-party analytics in the current repository.
- ML Kit GenAI Prompt API (`com.google.mlkit:genai-prompt`, Gemini Nano via
  AICore) runs inference on the device; Wafra sends it only an Ask question or
  an unclassified merchant name and makes no network request of its own for
  it. Google's ML Kit Android data disclosure
  (https://developers.google.com/ml-kit/android-data-disclosure) states that ML
  Kit SDKs collect device information, app information and performance/usage
  metrics for diagnostics and analytics. Declare that SDK collection in the
  Data Safety form after checking the disclosure for the exact shipped
  version.

## Remaining Play Console blockers

- Sensitive SMS permission declaration approval.
- Final Data Safety answers checked against the uploaded AAB and Superwall SDK.
- Financial features declaration, content rating, target audience and app-access
  tasks in the publisher's Play Console.
- Production Superwall public key, products, `pro` entitlement, `pro_upgrade`
  campaign and store-formatted pricing verification.
- Global English Play screenshots and 1024×500 feature graphic captured from a
  release-like build.
- Public Privacy/Terms/Support URLs and monitored support contact.
