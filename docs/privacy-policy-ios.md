# Wafra for iPhone — Privacy Policy

_Last updated: 7 August 2026_

Wafra ("the app") is a personal money manager for iPhone, published by Naser
Khanjar ("we", "us"). This policy explains what the app does with your
information.

**Not legal advice.** Have a lawyer review this before publishing, and keep it
accurate — every claim below is a statement about how the app behaves, and each
one must stay true as the app changes.

**Using Android?** The Android version works differently — it reads your SMS
inbox on the device and has no server at all. It has its own policy at
<https://wafra-legal.pages.dev/android/privacy>. This one does not describe it.

## The short version

Wafra has no account, no analytics, no advertising and no tracking. Your
financial data lives on your phone.

One narrow path off the device exists, because on iPhone it has to. iOS gives
no app any access to SMS, so if you want your bank messages recorded
automatically, you build a Shortcut that forwards them to a relay we run. The
relay parses each message, **throws the message text away**, and holds only the
parsed result — encrypted so that only your phone can open it — until your
phone collects it. That is typically a few seconds, and never more than 72
hours.

We cannot read what the relay holds. The keys belong to your phone.

The relay is optional. Refuse it and the app still works.

## What the app reads

**The app reads no messages itself.** It cannot. iOS gives apps no access to
SMS, which is the entire reason the relay exists.

What reaches Wafra is whatever your own Shortcut sends it, and you choose which
senders that Shortcut listens to. Set it to your banks and it sees your banks.

**Face ID or Touch ID (optional).** If you enable the app lock, Wafra asks iOS
to verify your face or fingerprint. iOS performs the check; the app receives
only a yes or no. No biometric data reaches the app.

**Notifications (optional).** Used to remind you before bills and card payments
are due. Nothing is sent anywhere to produce them.

## What the app stores, and where

Everything Wafra records — transactions, accounts, cards, budgets, bills,
goals, settings — is stored in the app's private storage on your device, in an
encrypted database. It is removed when you delete the app.

## The relay, in full

### What it does with the message

It parses it and discards it. The message body is never written to the
database, never logged, and never returned. There is no table for messages.

### What it keeps

The parsed result only: merchant, amount, date, category, card ending, and
optionally the bank's sender label. That row is sealed to your device using
X25519 key exchange and AES-256-GCM encryption, and the relay destroys its own
half of the key as it seals. It cannot read back what it stored. A complete
copy of the database would be ciphertext and nothing else.

### For how long

Until your phone collects the row and confirms receipt, at which point it is
deleted. In normal use that is the seconds between a text arriving and your
phone syncing. Anything uncollected is deleted after 72 hours, without
exception.

### Who you are to it

Nobody. There is no email, no password, no username and no account. Your
identity is a key your phone generated and keeps. We cannot connect a queued
row to a person, because we never learn who the person is.

### Where it runs

On Cloudflare's network, which means data may be processed outside your
country. Because the relay holds only ciphertext it cannot read, and holds it
briefly, this is a transfer of encrypted data rather than of readable financial
records.

### Declining it

The relay is optional in the real sense: never create the Shortcut and nothing
is ever sent. You can enter transactions by hand and import statement files
instead. Turning on **private mode** in Settings disconnects the relay and
erases your device and its queue immediately.

## What leaves your device

The bank messages your Shortcut forwards, and nothing else.

There is no telemetry, no crash reporting, no advertising and no third-party
analytics. The app makes no other network requests of its own.

Two further features move data, and both are actions you take deliberately:

- **Backup and export.** You can write a JSON backup or a CSV export to a
  location you choose. That file is yours; where it then goes is up to you.
- **Reporting an unrecognised message.** If you choose to send us a sample
  message so we can support that bank's format, that message is sent by you,
  through your own mail app, to an address you can see before sending.

## Purchases

Paid plans are handled by Apple's App Store billing. Apple processes the
payment and tells the app whether a subscription is active. Wafra never sees
your card or payment details. Apple's handling of that transaction is covered
by Apple's own privacy policy.

## Automated processing

Wafra guesses a merchant and category for each transaction. That guess is a
labelling convenience shown only to you. It is not a decision about you, it is
not scored, profiled or shared, and it has no legal or financial effect. You
can correct any of it, and your correction is what the app remembers.

## Security incidents

The relay is built so that breaching it would not expose your finances: it
stores no message text, and what it does store is sealed to your device with
keys it does not have. Someone who obtained the entire database would hold
ciphertext.

Beyond that, the security of your data is the security of your device: keep it
locked and up to date, and enable the in-app lock if you want a second layer.
If we become aware of a vulnerability that could expose your data, we will
publish a fix, describe the issue in the release notes, and notify affected
users where the law requires it.

## International transfers

Encrypted parsed rows are processed on Cloudflare's global network and may be
handled outside your country. Message text is never stored anywhere, and what
is stored cannot be read by us, by Cloudflare, or by anyone without your
device's key.

## Your rights

Privacy law generally gives you rights to access, correct, export and delete
your personal data. You exercise those rights directly in the app: everything
is visible in the app, editable in the app, exportable as JSON or CSV, and
deleted when you clear your data or delete the app.

We hold no readable copy of your data to return to you. Anything still queued
in the relay is encrypted to your device, and unpairing erases the device and
its queue immediately.

## If the app changes hands

If the app is ever sold or transferred, the data on your device stays on your
device. It is not part of any such transfer, because we do not hold it. Any
change to this policy under new ownership would be surfaced in the app before
it took effect.

## Children

Wafra is not directed at children and is not intended for anyone under 13.

## Changes

If this policy changes, the date at the top changes with it. Material changes
will be surfaced in the app.

## Contact

khanjer496@gmail.com
