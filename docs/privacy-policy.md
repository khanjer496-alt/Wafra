# Wafra Privacy Policy

_Last updated: 25 July 2026_

Wafra ("the app") is a personal money manager for Android and iPhone. This
policy explains what the app does with your information.

**The two platforms behave differently, and this policy says so throughout.**
On Android the app reads your SMS inbox directly and never makes a network
request. iOS gives no app access to SMS at all, so the iPhone version relies on
a Shortcut you create yourself, which sends bank messages to a relay we run.
That is a real difference in where your data goes, and it is described in full
under "The iPhone relay" below.

**Not legal advice.** Have a lawyer review this before publishing, and keep it
accurate — every claim below is a statement about how the app behaves, and
each one must stay true as the app changes.

## The short version

Wafra has no account, no analytics, no advertising and no tracking, on either
platform. Your financial data lives on your phone.

**On Android** there is no server at all. Nothing the app records leaves your
device unless you export it yourself.

**On iPhone** one narrow path exists, because it has to: a relay that receives
bank messages from a Shortcut you build, parses them, throws the message text
away, and holds the parsed result encrypted until your phone collects it —
typically seconds, never more than 72 hours. We cannot read what it holds. The
encryption keys belong to your phone.

## What the app reads

**SMS messages (`READ_SMS`, `RECEIVE_SMS`) — Android only.** Wafra reads bank alert messages
to record transactions automatically — the amount, merchant, date, card and
balance a bank quotes. It reads your inbox when you ask it to scan, and
receives new messages as they arrive.

Messages that do not name a currency amount are discarded immediately and are
never stored. Personal correspondence is not retained, not analysed, and not
transmitted.

**Notifications (optional).** If you enable notification access, Wafra reads
bank app notifications the same way and applies the same currency-amount
filter. This is off unless you turn it on.

**Biometrics (optional).** If you enable the app lock, Wafra asks the operating
system to verify your fingerprint or face — Android biometrics, or Face ID and
Touch ID on iPhone. The system performs the check; the app only receives a yes
or no. No biometric data reaches the app.

**On iPhone, the app reads no messages itself.** It cannot: iOS gives no app
access to SMS. What reaches Wafra on an iPhone is whatever your own Shortcut
sends it, and you choose which senders that Shortcut listens to.

## What the app stores, and where

Everything Wafra records — transactions, accounts, cards, budgets, bills,
goals, settings — is stored in the app's private storage on your device. It
is removed when you uninstall the app.

Wafra keeps a short excerpt of a bank message only when it could not confidently
read that message, so you can report the format and have it recognised in
future. You can see and delete these from Settings.

## What leaves your device

**On Android: nothing, unless you send it yourself.** The app makes no network
requests of its own and has no backend.

**On iPhone: the messages your Shortcut forwards, and nothing else.** See the
next section.

On both platforms there is no telemetry, no crash reporting, no advertising and
no third-party analytics.

Beyond that, two features move data, and both are actions you take
deliberately:

- **Backup and export.** You can write a JSON backup or a CSV export to a
  location you choose. That file is yours; where it then goes is up to you.
- **Reporting an unrecognised message.** If you choose to send us a sample
  message so we can support that bank's format, that message is sent by you,
  through your own email app, to an address you can see before sending.

## The iPhone relay

This section exists only for iPhone. If you use Android, nothing here applies
to you.

iOS gives no app access to SMS, so the Android design cannot exist on iPhone.
What iOS does allow is a Shortcuts personal automation that you create: "when I
get a message from my bank, send it to Wafra". A Shortcut cannot hand data to a
sleeping app — it can only make a web request. That is the only reason this
service exists.

**What the relay does with the message.** It parses it and throws the text
away. The message body is never written to the database, never logged and never
returned. There is no table for messages.

**What it keeps.** The parsed result — merchant, amount, date, category, and
optionally the bank sender label — encrypted so that only your phone can open
it. The relay discards its own half of the encryption key as it seals the data,
so it cannot read back what it stored. A complete copy of the database is
ciphertext and nothing else.

**For how long.** Until your phone collects it and confirms receipt, at which
point the row is deleted. In normal use that is the seconds between a text
arriving and your phone syncing. Anything uncollected is deleted after 72
hours, without exception.

**Who you are to it.** Nobody. There is no email, no password and no account.
Your identity is a key your phone generates and keeps. You can erase your
device and everything queued for it at any time from the app.

**Where it runs.** On Cloudflare's network, which means the data may be
processed outside your country. Because the relay holds only ciphertext it
cannot read, and holds it briefly, this is a transfer of encrypted data rather
than of readable financial records.

**Choosing not to use it.** The relay is optional. Without it the iPhone app
still works — you enter transactions yourself and import statement files. You
can also turn on private mode, which disconnects the relay entirely.

## Purchases

Paid plans are handled by the store you installed from: **Google Play** on
Android, the **App Store** on iPhone. That store processes the payment and
tells the app whether a subscription is active. Wafra never sees your card or
payment details. Each store's handling of the transaction is covered by its own
privacy policy.

## Permissions, plainly

| Permission | Why | Optional |
| --- | --- | --- |
| `READ_SMS` | Read bank alerts already in your inbox to build your history | Required for automatic tracking; the app works with manual entry without it |
| `RECEIVE_SMS` | Record a bank alert as it arrives rather than at next open | Yes |
| Notification access | Read bank app notifications where banks use push instead of SMS | Yes |
| Biometric | App lock | Yes |
| Notifications | Remind you before bills and card payments are due | Yes |

The permissions above are Android's. On iPhone the app asks only for Face ID or
Touch ID (for the app lock) and notifications (for bill reminders); there is no
SMS permission to grant, because iOS does not offer one.

You can revoke any of these in your phone's Settings at any time. The app keeps
working; it just stops recording new transactions automatically.

## Automated processing

Wafra reads your bank messages automatically and guesses a merchant and
category for each transaction. That guess is a labelling convenience shown
only to you. It is not a decision about you, it is not scored, profiled or
shared, and it has no legal or financial effect. You can correct any of it,
and your correction is what the app remembers.

## Security incidents

On Android there is no server, so there is no central store to breach.

On iPhone the relay holds a short queue, and it is built so that a breach of it
would not expose your finances: it stores no message text, and what it does
store is sealed to your device with keys it does not have. Someone who obtained
the entire database would hold ciphertext.

Beyond that, the security of your data is the security of your device: keep it
locked and up to date, and enable the in-app lock if you want a second layer.
If we become aware of a vulnerability that could expose your data, we will
publish a fix, describe the issue in the release notes, and notify affected
users where the law requires it.

## International transfers

**Android:** none. The app does not transmit your data, so it does not move it
between countries.

**iPhone:** if you use the relay, encrypted parsed rows are processed on
Cloudflare's global network and may be handled outside your country. Message
text is never stored anywhere, and what is stored cannot be read by us, by
Cloudflare, or by anyone without your device's key.

## Your rights

Privacy law generally gives you rights to access, correct, export and delete
your personal data. You exercise those rights directly in the app: everything
is visible in the app, editable in the app, exportable as JSON or CSV, and
deleted when you clear your data or uninstall.

We hold no readable copy of your data to return to you. On iPhone, anything
still queued in the relay is encrypted to your device, and unpairing from the
app erases the device and its queue immediately.

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
