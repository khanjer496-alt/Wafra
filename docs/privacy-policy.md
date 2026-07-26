# Wafra Privacy Policy

_Last updated: 25 July 2026_

Wafra ("the app") is a personal money manager for Android. This policy
explains what the app does with your information. It is short because the app
does very little with it.

**Not legal advice.** Have a lawyer review this before publishing, and keep it
accurate — every claim below is a statement about how the app behaves, and
each one must stay true as the app changes.

## The short version

Wafra has no server, no account, and no analytics. Your financial data is
created on your phone, stored on your phone, and never sent anywhere by the
app. We cannot see it, because there is nowhere for it to go.

## What the app reads

**SMS messages (`READ_SMS`, `RECEIVE_SMS`).** Wafra reads bank alert messages
to record transactions automatically — the amount, merchant, date, card and
balance a bank quotes. It reads your inbox when you ask it to scan, and
receives new messages as they arrive.

Messages that do not name a currency amount are discarded immediately and are
never stored. Personal correspondence is not retained, not analysed, and not
transmitted.

**Notifications (optional).** If you enable notification access, Wafra reads
bank app notifications the same way and applies the same currency-amount
filter. This is off unless you turn it on.

**Biometrics (optional).** If you enable the app lock, Wafra asks Android to
verify your fingerprint or face. Android performs the check; the app only
receives a yes or no. No biometric data reaches the app.

## What the app stores, and where

Everything Wafra records — transactions, accounts, cards, budgets, bills,
goals, settings — is stored in the app's private storage on your device. It
is removed when you uninstall the app.

Wafra keeps a short excerpt of a bank message only when it could not confidently
read that message, so you can report the format and have it recognised in
future. You can see and delete these from Settings.

## What leaves your device

Nothing, unless you send it yourself.

The app makes no network requests of its own. It has no backend, no telemetry,
no crash reporting, no advertising and no third-party analytics.

Two features move data, and both are actions you take deliberately:

- **Backup and export.** You can write a JSON backup or a CSV export to a
  location you choose. That file is yours; where it then goes is up to you.
- **Reporting an unrecognised message.** If you choose to send us a sample
  message so we can support that bank's format, that message is sent by you,
  through your own email app, to an address you can see before sending.

## Purchases

Paid plans are handled by Google Play billing. Google processes the payment
and tells the app whether a subscription is active. Wafra never sees your card
or payment details. Google's handling of that transaction is covered by
Google's own privacy policy.

## Permissions, plainly

| Permission | Why | Optional |
| --- | --- | --- |
| `READ_SMS` | Read bank alerts already in your inbox to build your history | Required for automatic tracking; the app works with manual entry without it |
| `RECEIVE_SMS` | Record a bank alert as it arrives rather than at next open | Yes |
| Notification access | Read bank app notifications where banks use push instead of SMS | Yes |
| Biometric | App lock | Yes |
| Notifications | Remind you before bills and card payments are due | Yes |

You can revoke any of these in Android Settings at any time. The app keeps
working; it just stops recording new transactions automatically.

## Automated processing

Wafra reads your bank messages automatically and guesses a merchant and
category for each transaction. That guess is a labelling convenience shown
only to you. It is not a decision about you, it is not scored, profiled or
shared, and it has no legal or financial effect. You can correct any of it,
and your correction is what the app remembers.

## Security incidents

Wafra holds no user data on any server, so there is no central store to
breach. The security of your data is the security of your device: keep it
locked and up to date, and enable the in-app lock if you want a second layer.
If we ever become aware of a vulnerability in the app itself that could expose
your data, we will publish a fix and describe the issue in the release notes.

## International transfers

None. The app does not transmit your data, so it does not move it between
countries.

## Your rights

Privacy law generally gives you rights to access, correct, export and delete
your personal data. Because we hold none of it, you exercise those rights
directly in the app: everything is visible in the app, editable in the app,
exportable as JSON or CSV, and deleted when you clear your data or uninstall.
There is no request to make of us and no copy of your data for us to return.

## If the app changes hands

If the app is ever sold or transferred, the data on your device stays on your
device. It is not part of any such transfer, because we do not hold it. Any
change to this policy under new ownership would be surfaced in the app before
it took effect.

## Children

Wafra is not directed at children and is not intended for anyone under 13.

## Your control over your data

There is no account to close and no server-side copy to request. To delete
everything Wafra holds, uninstall the app, or use Settings to clear your data.
Any backup file you exported remains wherever you put it — delete it yourself.

## Changes

If this policy changes, the date at the top changes with it. Material changes
will be surfaced in the app.

## Contact

<!-- Replace with the real support address before publishing. -->
support@example.com
