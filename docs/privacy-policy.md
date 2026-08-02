# Wafra Privacy Policy

_Last updated: 2 August 2026_

Wafra ("the app") is a personal money manager for Android and iOS.

**Not legal advice.** Have a lawyer review this before publishing. The relay
hosting entity, processing region and support address must also be filled in
before release.

## The short version

- **Android:** bank SMS and optional bank-app notifications are parsed on the
  device. They are not sent to Wafra's relay.
- **iPhone with automatic capture enabled:** a personal Apple Shortcut sends
  alerts only from bank senders the user selects to Wafra's relay. The relay
  parses the raw body in memory and discards it immediately. It persists only
  a structured transaction sealed to that iPhone, until the phone acknowledges
  it or for at most 30 days.
- **Private Mode:** automatic iPhone relay capture is off. Imports and parsing
  stay on the device, and raw text is dropped immediately after processing.
- The ledger, accounts, budgets, bills, goals and settings live in encrypted
  app storage on the device. Wafra has no advertising or third-party analytics.

## Android bank-alert access

**SMS (`READ_SMS`, `RECEIVE_SMS`).** If permission is granted, Wafra reads bank
transaction alerts to extract an amount, merchant, date, card or account tail,
direction and any quoted balance. Inbox scanning and parsing happen on the
Android device.

Messages that do not look financial are ignored. When the parser cannot
confidently understand a bank format, Android may keep a short local excerpt so
the user can review or report it. That excerpt is not uploaded automatically
and can be deleted in Settings.

**Bank-app notifications (optional).** If notification access is enabled,
Wafra applies the same local processing to bank-app notifications. This is off
until the user enables it.

## iPhone automatic capture

Apple does not give third-party apps access to the SMS inbox. Wafra therefore
uses a personal automation that the user creates in Apple's Shortcuts app:

1. The user selects the bank message senders that may trigger the automation.
2. The automation sends that alert's raw text over HTTPS to the Wafra relay
   using a device-specific bearer token.
3. The relay parses the body in memory. It does not write, log or return the raw
   message text.
4. If the body is a supported financial alert, the relay keeps only the parsed
   fields, encrypted to a public key whose private half stays on that iPhone.
5. Wafra deletes the queued row after the app acknowledges it. Unacknowledged
   rows expire after 30 days.

The relay also stores a random device identifier, the device's public key and a
SHA-256 hash of the bearer token. It stores no name, email address, phone
number, bank login or raw message archive. An inactive device registration is
deleted after one year.

Shortcuts can send an alert while Wafra is closed. After the first unlock
following a restart, iOS may wake Wafra silently and stage the sealed,
structured transaction in a separate encrypted inbox. The protected main
ledger incorporates it on foreground. APNs background delivery is best-effort,
and Apple pauses silent wakes after the user force-quits Wafra until the next
open, so Wafra does not promise a background update at an exact time.

Private Mode disables this relay path. Because iOS has no local SMS-inbox API,
automatic SMS capture is unavailable on iPhone while Private Mode is on.

## What is stored on the device

Transactions, accounts, cards, budgets, bills, goals and settings are stored in
the app's private encrypted storage. The iPhone relay private key and
foreground credentials are stored with iOS Keychain through Expo SecureStore.
A least-privilege sync credential and separate SQLCipher inbox key are
available only after the first unlock; neither contains the Shortcut ingest
token or email-forwarding token.

iOS Keychain items can survive an uninstall. To erase the relay registration
and its local key deterministically, use **Settings → Erase all data** while
online before uninstalling. If the relay cannot be reached, Wafra keeps the key
so the user can retry deleting the remote registration.

## Biometrics

If app lock is enabled, Wafra asks the operating system to authenticate with
the enrolled face, fingerprint or device credential. The operating system
performs that check and returns success or failure. Wafra does not receive or
store biometric templates.

## Other network activity

- **Purchases:** when store billing is configured, Apple or Google processes
  the payment and RevenueCat manages an anonymous subscription entitlement.
  RevenueCat does not receive bank messages, ledger transactions or balances
  from Wafra.
- **Forwarded bank email:** if the user creates a private forwarding address,
  the relay parses the forwarded MIME, text, HTML and supported PDF attachments
  in memory. Raw email and attachments are not stored. Only structured rows,
  sealed independently to the user's devices, can enter the delivery queue.
- **PDF statement import:** a user-selected PDF of up to 5 MiB and 100 pages is
  sent to the relay. PDF bytes and extracted text are discarded after parsing;
  only conservative, structured debit or credit rows are sealed and queued.
- **Trusted devices and family:** an owner may invite up to eight devices to
  receive future captures. Each device has its own public key and credentials;
  the relay stores device labels and roles but cannot decrypt sealed rows.
  Revoking a device deletes its queued rows and credentials. Deleting the
  vault removes every device and queue.
- **Backup and export:** the user can create a backup or export and choose where
  to send it. The resulting file is controlled by the user.
- **Reporting an unrecognised format:** if the user deliberately shares a
  sample through their own email app, they can review it before sending.

Wafra does not include advertising, third-party analytics or crash reporting.

## Automated processing

Wafra extracts transaction fields and suggests a merchant and category. These
labels are visible only to the user, have no legal or financial effect and can
be corrected. Wafra does not use bank alerts for advertising, credit decisions
or training a server-side model.

## Security and retention

Network traffic to the iPhone relay uses HTTPS. Queued structured rows use
X25519, HKDF-SHA-256 and AES-256-GCM so the relay cannot decrypt them after
sealing. Bearer tokens are stored by the relay only as SHA-256 hashes.

No system is risk-free. A relay security incident could expose transient raw
text while a request is being processed, sealed queue data, public keys and
token hashes. It should not expose a stored raw-message archive because no such
archive exists.

## Processing location

The iPhone relay is hosted using Cloudflare Workers and D1. Its production
jurisdiction and the legal entity responsible for that processing are
**[pending before release]**. Depending on that configuration, processing may
occur outside the user's country. This section must be completed before the
iOS build is published.

## Your choices and deletion

The user can:

- decline Android SMS or notification access;
- leave iPhone automatic capture unconfigured;
- decline or revoke bank-email forwarding and trusted-device sharing;
- enable Private Mode to keep new processing local;
- edit, export or delete local financial records; and
- erase the iPhone relay device and queue through **Erase all data** while
  online.

Acknowledged relay rows are deleted immediately. Unacknowledged structured rows
expire within 30 days. A disconnected device registration is deleted
immediately; an abandoned one expires after one year.

Exported files remain wherever the user saved or shared them and must be
deleted there separately.

## Children

Wafra is not directed at children and is not intended for anyone under 13.

## Changes

If this policy changes, the date at the top changes with it. Material changes
will be surfaced in the app.

## Contact

<!-- Replace with the real support address before publishing. -->
support@example.com
