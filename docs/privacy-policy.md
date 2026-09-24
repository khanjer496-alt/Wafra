# Wafra Privacy Policy

_Last updated: 24 September 2026_

Wafra ("the app") is a personal money manager for Android and iOS published by
**Nasidaapps LLC** ("Wafra", "we", "us").

**Launch draft.** Have counsel review this before publishing. Any jurisdiction-specific transfer language required for the final distribution
territories must still be confirmed before release.

## The short version

- **Android:** bank SMS and optional bank-app notifications are parsed on the
  device. They are not sent to Wafra's relay.
- **iPhone with automatic capture enabled:** Apple's Sender picker lists only
  Contacts, so Wafra's setup guide leaves Sender empty. The personal Apple
  automation therefore passes every new Message that contains a space, from
  any sender, to Wafra on that iPhone, not only bank alerts. A protected local
  queue holds each one only until Wafra can run the same financial parser used
  by the Android app. Wafra keeps only structured results from supported bank
  alerts and discards everything else on the iPhone; processed raw text and
  sender are deleted after durable local processing. Pending records expire
  after 30 days. This local path uploads no Message content. Optional bank-app
  notification (iOS 27) and Apple Pay automations use the same protected queue.
- **Privacy is built in:** local capture and encrypted native ledger storage
  do not require a separate mode. A local-only preference saved in an older
  version remains in effect until explicitly reviewed in Settings → Privacy
  and data; it pauses cloud imports, reference FX and online logos and removes
  retained diagnostic message text. Local capture and history import still work.
- **iPhone history import:** on iOS 26 or later, a user-run Apple Shortcut can
  check up to 1,500 newest and 1,500 oldest retained Messages. It continues only
  if a stable overlap proves that the two bounded results cover the retained
  history. It stops and erases partial staging when coverage cannot be proven,
  including when the phone retains 3,000 or more Messages. The protected import
  also has a 24 MiB safety limit. Nothing from this history import is sent to
  Wafra's relay.
- The ledger, accounts, budgets, bills, goals and settings live in encrypted
  app storage on the device. Wafra has no advertising or third-party analytics.
- **Zero message access is always available:** leave Android SMS permission off
  or leave iPhone automatic capture unconfigured and use manual entry/imports.
- Wafra cannot sign in to a bank, reply to a message, approve a transaction or
  move money. Automatic capture may hold raw Message content in the protected
  local queue described below until it is processed (at most 30 days); only
  supported structured financial activity can enter the ledger, and no Message
  content is uploaded.

## Message-access choices

Android SMS access is optional. If the user keeps it off, Wafra cannot scan the
SMS inbox at all; manual entry and user-initiated imports remain available. If
the user enables automatic SMS history, Android necessarily gives the app
permission to read message text on that phone. Wafra checks the text locally
to decide whether it is supported financial activity. Other content is
discarded before app storage and is never uploaded. The no-permission option
remains available for users who prefer manual entry.

On iPhone, leaving automatic capture unconfigured gives Wafra no Messages
access. If the user enables Wafra Local Capture, Apple's personal automation
passes each newly received Message that contains a space to Wafra on that
iPhone, whoever sent it, including personal conversations. The raw body and
sender therefore remain in Wafra's protected local queue until the app next
runs and classifies the record. They are not uploaded, logged, used for
analytics or written to the ledger. Content that is not a supported bank alert
is discarded after classification. A record the app has not yet processed
expires 30 days after the Message's date (or after it arrived, when Apple
supplies no date) and is physically removed on the next queue access; iOS does
not promise an exact background cleanup time.

## Android bank-alert access

**SMS (`READ_SMS`, `RECEIVE_SMS`).** If permission is granted, Wafra reads bank
transaction alerts to extract an amount, merchant, date, card or account tail,
direction and any quoted balance. Inbox scanning and parsing happen on the
Android device. Wafra does not maintain a second raw-SMS delivery archive; the
Android system inbox remains the source read during import.

Messages that do not look financial are ignored. When the parser cannot
confidently understand a bank format, Android may keep a short local excerpt so
the user can review or report it. That excerpt is not uploaded automatically
and can be deleted in Settings.

Wafra does not request Android Accessibility access and does not use SMS to
reply, enter codes, approve prompts or control another app.

**Bank-app notifications (optional).** If notification access is enabled,
Wafra places candidate bank-app alerts in a bounded, short-lived queue encrypted
with Android Keystore. The app deletes each queued alert after durable local
classification. This is off until the user enables it.

Android's notification access is device-wide, so Wafra sees each posted
notification and classifies it in memory before storing anything.
Notifications from chat apps such as WhatsApp, Telegram or Signal are never
stored or used. Notifications from SMS apps, including the default SMS app,
are ignored while Wafra has SMS permission, because the SMS path already reads
the same messages. Without SMS permission, an SMS app's notification that looks
financial may enter the encrypted queue and is shown only in Review. It is
never imported automatically, and approving it does not make Wafra trust that
app.

## iPhone automatic capture

Apple does not give third-party apps access to the SMS inbox. Wafra therefore
uses a personal automation that the user creates in Apple's Shortcuts app:

1. The user chooses **Message**, leaves **Sender** empty, types a single space
   in **Message Contains**, selects **Run Immediately**, and runs Wafra's
   capture Shortcut with the **Received Message**. Apple requires a sender or
   a phrase, its Sender picker lists only Contacts, and bank SMS IDs are not
   Contacts. The automation therefore runs for every new Message that contains
   a space, whoever sent it: in effect an **Any Sender** trigger.
2. The Shortcut passes the Message's sender and text to Wafra's background App
   Intent on the same iPhone. When Apple provides them, it also passes the
   Message's date and a SHA-256 hash of Apple's Message identifier, computed
   inside the Shortcut. Otherwise Wafra assigns a random identifier and uses
   the time the Message arrived. If Apple provides no sender, Wafra records a
   fixed placeholder instead.
3. Wafra writes each record to an app-private, backup-excluded queue protected
   by iOS complete-until-first-authentication file protection before it decides
   whether the Message is a bank alert. Text over 16 KiB (UTF-8) is refused
   rather than shortened, Messages dated more than 30 days before they arrive
   are not stored, and the queue holds at most 2,000 records and 8 MiB in
   total. No network action exists in this Shortcut.
4. When iOS next permits Wafra to run, the app uses its local financial parser.
   Supported transactions enter the encrypted ledger or Review; promotions,
   OTPs, personal messages and other unsupported content do not.
5. After the result is durably handled, Wafra deletes the raw queued record.
   The queue's index then keeps only that record's opaque identifier and a
   SHA-256 digest of the deleted record, so the same record delivered again is
   recognised instead of queued twice. Each entry is removed on a queue access
   more than 30 days after processing, and the index holds at most 10,000.
   Records not yet handled expire 30 days after their date and are removed on
   a later queue access.

The automation can stage a new Message while Wafra is closed, but Apple controls
when personal automations and background App Intents run. Wafra therefore does
not promise that the ledger updates at an exact time. Opening Wafra drains any
available protected queue.

Older TestFlight builds used a separately paired relay-backed Shortcut. During
migration, that old automation can continue sending previously selected alerts
until it is deleted or its token is retired. The current local Shortcut contains
no relay URL or credential. A saved local-only preference blocks relay
processing in the app but does not disable local automatic capture. An old
automation must still be removed or have its token retired.

### Bank-app notifications (iOS 27 or later)

The user can separately create an Apple **Notification** automation in
Shortcuts that selects a bank or payment app and runs Wafra's notification
Shortcut or its **Capture bank notification** action. Wafra cannot inspect
other apps' notifications, read old notifications or create the automation;
it receives only the text the user's automation passes.

- Wafra stores that text verbatim in the same protected, backup-excluded queue
  with a random identifier and the time it arrived. It is not told which app
  posted the notification. Text over 16 KiB (UTF-8) is refused rather than
  shortened.
- The app processes the text locally with the same parser. A supported
  transaction from an identifiable bank can enter the encrypted ledger; an
  alert Wafra cannot confirm may go to Review; other text is discarded.
- The raw text is deleted after durable processing, and unprocessed text
  expires 30 days after it arrived. The queue's index keeps the identifier and
  digest as described above, and a saved transaction keeps the opaque
  identifier so the same queued notification is not added twice.
- Running the Shortcut with Wafra's setup-check phrase records only the time of
  the check.
- Nothing from this capture path is uploaded.

### Apple Pay purchases (iOS 17 or later)

The user can separately create an Apple Wallet **Transaction** automation for
the cards they choose and run Wafra's Apple Pay Shortcut or its **Capture Apple
Pay purchase** action. Wafra's action accepts only the transaction's
**Amount** (a decimal amount with its currency code) and **Merchant** name.

- Wafra stores the amount, currency and merchant name (up to 96 characters)
  with a random identifier and the time it arrived in the same protected
  queue. It does not receive the card number, card name, Wallet history or
  payment status. Refunds and other non-positive amounts are not captured.
- If the amount or currency is missing or any field is invalid, nothing is
  queued; Wafra records only the time an incomplete event arrived.
- Each captured purchase goes to Review. Nothing enters the ledger until the
  user chooses an account and adds it.
- The queued record is deleted once its Review item is saved; until then it
  expires 30 days after it arrived. The queue's index keeps the identifier and
  digest as described above.
- Nothing from this capture path is uploaded.

### When Review is full

Review holds a limited number of items. If Review has no room for a possible
money movement captured on iPhone by any of these paths, Wafra leaves that
record in the protected queue instead of discarding it and can process it once
Review has room. Held records still count toward the queue's 2,000-record and
8 MiB limits and still expire 30 days after their date. A record that arrives
while the queue is full is refused, and an expired record is deleted; in both
cases Wafra keeps only a count, not the content, so the app can show a capture
warning.

## iPhone message-history import

On iOS 26 or later, the user can separately run Wafra's message-history
Shortcut. It uses Apple's **Find Messages** action to request at most 1,500
newest and 1,500 oldest retained Messages. It verifies both sort extremes and
requires at least one stable Message-identifier overlap before continuing. If
the results do not overlap—including when the phone retains 3,000 or more
Messages—it erases partial staging instead of presenting a knowingly incomplete
history. It also enforces a 24 MiB protected-import safety limit. Apple does not
provide Wafra with a direct SMS-inbox permission or API. Large histories can
take 20–25 minutes or more depending on the phone and retained history, and the
iPhone must remain unlocked with Shortcuts open until Wafra opens.

The Shortcut passes Message text, sender, date and Apple's Message identifier to
Wafra one record at a time from each bounded result. The identifier is hashed
before the first protected disk write. Prepared records stay on the device, use
iOS complete file protection, are excluded from device backups and are not sent
to the relay, analytics or an AI service. Wafra parses them locally and shows a
preview before changing the ledger. Raw Message text and sender are not written
to the ledger.

When the user confirms, Wafra first saves the structured results to its
encrypted database and then deletes the staged batches. Cancelling also deletes
them. If deletion is interrupted, staged batches become eligible for local
cleanup after one hour and Wafra removes them the next time the history bridge
runs. An unfinished per-Message preparation remains recoverable for up to three
hours so large runs can finish, then becomes eligible for the same opportunistic
cleanup. iOS does not guarantee that fallback cleanup happens at an exact
wall-clock time. Messages already deleted by the user, removed by Messages
retention settings or unavailable to Apple's search cannot be recovered or
imported.

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

- **Automatic logos:** 112 merchant logos are bundled with the app and supported
  launch-market banks are matched locally to fixed bank domains. For other
  merchant or bank identities, when online features are enabled, Wafra may use
  Brandfetch's Brand Search API. Merchant lookup first removes payment prefixes,
  amounts, account/card tails, URLs and common terminal/location suffixes. Bank
  lookup uses the institution name and rejects labels containing account/card
  tails. Wafra accepts only a high-confidence name match and then loads artwork
  from Brandfetch's image CDN. Brandfetch therefore receives the cleaned merchant
  or institution name for those searches, the requested brand domain and the
  device's network address. Wafra does not send the transaction amount,
  account/card number or bank Message text as part of logo lookup. Searches and
  misses are cached to reduce repeated requests. Older local-only opt-outs block
  both name searches and image requests. Logo caches are removed by Erase all
  data; image bitmap caching remains managed by the platform image library.

- **On-device language model:** Wafra can download a small multilingual text
  encoder (about 35 MB, plus its tokenizer) once from Wafra's own GitHub release
  so that bank-alert families and Ask Wafra questions can be understood on the
  device. The request carries no bank message, transaction, account/card
  identifier or question; GitHub receives only the ordinary download request
  and the device's network address. Every file is checked against a fixed
  size and SHA-256 hash and is discarded on mismatch. All inference then runs
  locally: message text, amounts and questions never leave the phone for this
  feature, and the model never decides an amount, currency or whether a
  transaction is imported.

- **Purchases and paywalls:** when store billing is configured, Apple or Google
  processes payment and Superwall provides paywall/onboarding presentation,
  subscription entitlement state and related product-flow analytics. Wafra may
  send language, market and non-financial onboarding choices for targeting, but
  does not send bank messages, ledger transactions, balances, transaction
  amounts, account/card identifiers or the locally stored first name to
  Superwall. When the saved local-only preference is active, Wafra disables
  optional Superwall event tracking and withholds those targeting attributes.
- **Forwarded bank email:** if the user creates a private forwarding address,
  the relay parses the forwarded MIME, text, HTML and supported PDF, CSV, or TSV attachments
  in memory. Raw email and attachments are not stored. Only structured rows,
  sealed independently to the user's devices, can enter the delivery queue.
- **PDF statement import:** a user-selected PDF of up to 5 MiB and 100 pages is
  sent to the relay. PDF bytes and extracted text are discarded after parsing;
  only conservative, structured debit or credit rows are sealed and queued.
- **CSV or TSV statement import:** a user-selected UTF-8 export of up to 1 MiB
  and 200 rows is sent to the relay. The bytes are discarded after parsing;
  only rows with supported named fields and explicit debit or credit direction
  are sealed and queued. Rejected-row counts contain no statement text.
- **Trusted devices and family:** an owner may invite up to eight devices to
  receive future captures. Each device has its own public key and credentials;
  the relay stores device labels and roles but cannot decrypt sealed rows.
  Revoking a device deletes its queued rows and credentials. Deleting the
  vault removes every device and queue.
- **Backup and export:** the user can create a backup or export and choose where
  to send it. The resulting file is controlled by the user.
- **Feedback and parser research:** if the user deliberately sends an ordinary
  report in Wafra, the exact redacted report is shown before confirmation. It
  is stored in Cloudflare D1 for at most 14 days and can be read by Wafra
  maintainers; ordinary feedback is not sent to third-party AI. Internal test
  builds also offer a separate parser-research tool. It keeps only likely
  financial-alert templates, masks every digit, removes timestamps, masks
  recipient and merchant spans, replaces words outside a strict financial
  grammar, and aliases unknown senders. It shows the complete result before a
  second confirmation that explicitly permits GitHub Actions and Anthropic
  Claude to process it. Wafra deletes its Cloudflare D1 copy within 14 days;
  GitHub and Anthropic apply their own retention policies. Code and synthetic
  tests may be published in a public draft pull request, but the workflow is
  required not to copy the report itself into that pull request and never
  merges a change automatically. Raw message bodies are not uploaded. Reports
  contain no device, advertising, installation or push identifier.

Wafra does not include advertising, third-party analytics or crash reporting.

## Automated processing

Wafra extracts transaction fields and suggests a merchant and category. These
labels are visible only to the user, have no legal or financial effect and can
be corrected. Wafra does not use bank alerts for advertising, credit decisions
or training a server-side model. Ordinary user feedback is not sent to a
third-party AI. A tester may separately and explicitly authorize GitHub Actions
and Anthropic Claude to process the redacted parser templates described above.

Buy-now-pay-later providers restate instalments that the paying bank has
already alerted on. Wafra therefore ignores, on the device, SMS and iPhone
Messages whose sender ID it recognises as Tabby, Tamara, Postpay or Cashew,
and Android notifications from the Tabby and Tamara consumer apps. They are
not stored as transactions or sent to Review; the paying bank's own alert is
the record Wafra uses. Bank alerts that merely mention a provider are
processed normally.

## Security and retention

Network traffic to the iPhone relay uses HTTPS. Queued structured rows use
X25519, HKDF-SHA-256 and AES-256-GCM so the relay cannot decrypt them after
sealing. Bearer tokens are stored by the relay only as SHA-256 hashes.

No system is risk-free. A relay security incident could expose transient raw
text while a request is being processed, sealed queue data, public keys and
token hashes. It should not expose a stored raw-message archive because no such
archive exists.

## Processing location

Nasidaapps LLC uses Cloudflare Workers and D1 for Wafra's optional relay-backed
features. Internet routing and infrastructure may process data outside the
user's country. The main Android and iPhone local-capture paths described above
do not upload bank-message text to this relay. Where local law requires more
specific international-transfer or data-location disclosure, that disclosure
must be added for the affected storefront before distribution there.

## Your choices and deletion

The user can:

- decline Android SMS or notification access;
- leave iPhone automatic capture (Messages, bank-app notifications and Apple
  Pay) unconfigured, or delete those automations in Shortcuts;
- choose whether to install or run the iPhone history Shortcut, choose its date
  range, review the results and cancel before saving;
- decline or revoke bank-email forwarding and trusted-device sharing;
- review a previously saved local-only preference in Settings → Privacy and
  data before resuming optional online features;
- edit, export or delete local financial records; and
- erase the iPhone relay device and queue through **Erase all data** while
  online.

Acknowledged relay rows are deleted immediately. Unacknowledged structured rows
expire within 30 days. A disconnected device registration is deleted
immediately; an abandoned one expires after one year.

Exported files remain wherever the user saved or shared them and must be
deleted there separately.

## Children

Wafra is not directed at children and is intended for users aged 18 or older.

## Changes

If this policy changes, the date at the top changes with it. Material changes
will be surfaced in the app.

## Contact

Email: [support@nasidaapps.com](mailto:support@nasidaapps.com)
