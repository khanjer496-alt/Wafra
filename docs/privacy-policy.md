# Wafra Privacy Policy

_Last updated: 9 November 2026_

Wafra ("the app") is a personal money manager for Android and iOS published by
**Nasida Apps LLC** ("Wafra", "we", "us").

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
  sender are deleted after durable local processing. Pending records become eligible for deletion
  after 30 days and are removed the next time the capture bridge runs. This local path uploads no Message content. Optional bank-app
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
  app storage on the device. Wafra has no ads. Superwall provides purchase and
  entitlement services; optional in-app event collection is disabled. Google's ML Kit SDK can collect diagnostic and
  usage data. See the SDK disclosures below.
- **Manual entry is always available:** turn off Android SMS tracking and
  bank-app notification access, or leave iPhone automatic capture unconfigured.
- Wafra cannot sign in to a bank, reply to a message, approve a transaction or
  move money. Automatic capture may hold raw Message content in the protected
  local queue described below until processing or expiry cleanup; only
  supported structured financial activity can enter the ledger, and this local capture path does not upload raw message bodies. Separate optional
  reporting and bank-format sharing are described below.

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

**Inbox history (`READ_SMS`).** When you choose a history scan, Wafra asks to
read the Android inbox and identifies supported financial alerts on your phone.
It can extract an amount, merchant, date, card or account tail, direction and
quoted balance. The Android inbox holds the original messages. Automatically
scanning the inbox does not send raw messages to the relay.

**Live SMS tracking (`RECEIVE_SMS`).** This is a separate choice. If you enable
it, Android can deliver a new SMS to Wafra while the app is in the background.
Wafra checks it on the device for financial activity and can update the ledger
or the Review list. If you've enabled Wafra's transaction notifications, it
can also show an alert. Wafra does not keep a second raw-SMS delivery archive.
You can use inbox history without live tracking and manual entry without either
permission.

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

Android grants notification access at the device level. Wafra checks the
posting app before examining an alert for financial activity. It excludes the
default SMS app and recognized messaging apps, including WhatsApp, Telegram
and Signal, whether or not SMS access is enabled. Bank-app notification access
does not provide an alternative way to import SMS. You can revoke notification
access in Android settings.

Earlier Android test builds could show a financial-looking SMS-app notification
in Review when inbox access was off. On those builds, turning off notification
access in Android settings also stops that behavior.

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
**Amount** (a decimal amount with its currency code), **Merchant** name and,
optionally, the **Card or Pass** name Wallet shows for the card used.

- Wafra stores the amount, currency and merchant name (up to 96 characters)
  with a random identifier and the time it arrived in the same protected
  queue. It does not receive the card number, Wallet history or payment
  status. Refunds and other non-positive amounts are not captured.
- The optional Card or Pass name (up to 80 characters) is kept separately from
  the purchase, on the device only, for the five most recent purchases and at
  most 30 days. It is shown only on Wafra's Apple Pay setup screen and is not
  added to the ledger, Review items or diagnostic exports. Erasing Wafra's data
  removes it.
- If the amount or currency is missing or invalid, nothing is queued; Wafra
  records only the time an incomplete event arrived. A missing or unusable
  Card or Pass name never stops a purchase from being queued.
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

Native capture expiry is checked when the capture bridge stages, reads or
reports queue status. An expired record is removed on that access; iOS does
not guarantee deletion exactly at the expiry time. A phone that does not run
the bridge can retain expired protected files until its next access.

## What is stored on the device

Transactions, accounts, cards, budgets, bills, goals and settings are stored in
the app's private encrypted storage. The iPhone relay private key and
foreground credentials are stored with iOS Keychain through Expo SecureStore.
A least-privilege sync credential and separate SQLCipher inbox key are
available only after the first unlock; neither contains the Shortcut ingest
token or email-forwarding token.

iOS Keychain items can survive an uninstall. To erase the relay registration
and its local key deterministically, use **Settings → Data and help → Erase all data** while
online before uninstalling. If the relay cannot be reached, Wafra keeps the key
so the user can retry deleting the remote registration.

## Biometrics

If app lock is enabled, Wafra asks the operating system to authenticate with
the enrolled face, fingerprint or device credential. The operating system
performs that check and returns success or failure. Wafra does not receive or
store biometric templates.

With App Lock on, Wafra covers app content in the iOS app switcher. On Android,
it protects recent-apps previews and also blocks screenshots and screen recordings.
Home Screen widget amounts are hidden by default while App Lock is on, even
when Wafra is unlocked; you can change this in Settings. Names, counts and dates
can remain visible. The operating system controls when an existing widget image
refreshes.

## Other network activity

- **Logo consent (iPhone only):** Android does not request online logos in this version. On iPhone, online logo lookups are off by default, including after upgrading a build without this preference. Bundled images and local fallback icons work without sharing names. You may opt in using Settings → Online merchant logos. Turning it off stops new name searches and artwork downloads; requests already sent cannot be recalled. Your saved local-only preference also blocks online logos. Restoring a backup keeps this device’s logo-sharing and widget-amount privacy choices; the file cannot enable logo sharing or change that widget preference.

- **Optional online logos:** 112 merchant logos are bundled with the app and supported
  launch-market banks are matched locally to fixed bank domains. For other
  merchant or bank identities, only after you opt in to Online merchant logos and local-only mode is off, Wafra may use
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

- **Exchange rates for foreign-currency spending:** when a purchase is in a
  currency other than the ledger's (travel, online shopping) and the bank alert
  does not state the charged amount in the ledger currency, Wafra requests one
  dated public reference rate from Frankfurter (api.frankfurter.dev), which
  republishes official central-bank rates. The request contains only the two
  ISO currency codes and one date (for example EUR, INR, 2026-09-20) plus the
  device's network address. It never contains the amount, merchant, account or
  card identifier, message text, ledger contents or any device or user
  identifier. Frankfurter states that it does not log request URLs or IP
  addresses. The rate, its effective date and its source are stored with the
  converted transaction inside the encrypted ledger; fetched rates are
  otherwise kept only in memory and are never written to unencrypted storage.
  No rate is ever invented: without one the purchase keeps its original amount
  in Review and nothing is posted. When the saved local-only preference is
  active, no rate request is made.

- **Shared bank-format shapes (optional):** Wafra can learn an alert layout on
  your phone when you teach it or confirm its unchanged reading of an unfamiliar
  alert in Review. The first time a layout is eligible to share, you can choose
  **Keep private** or **Share bank wording**. Either choice saves your work on
  the phone. Choosing to share also permits future eligible layouts to be sent
  until you turn sharing off in Settings. An older default-on setting by itself
  does not grant this permission in the updated app. Earlier test versions
  could contribute an eligible layout when it was saved with sharing switched on.
  The shared layout contains the bank sender code, direction, currency code
  and generic words with placeholders for details such as amounts, merchants
  and dates. It excludes the original message and identified transaction values.
  Wafra refuses layouts with digits, addresses, links or unusual words that may
  identify someone. This screening cannot recognize every possible name.
  The relay only publishes a layout after at least three different paired
  vaults send an identical shape. Shared wording and pseudonymous votes are
  retained until removed. Pending items older than 30 days are currently
  removed only when a later submission triggers cleanup; there is no scheduled
  purge or guaranteed 30-day deletion. Published and blocked wording and their
  votes have no automatic expiry.
  An iPhone can use its existing capture pairing. Other phones create a
  pseudonymous pairing when they first share. The relay sees the network address
  and counts one vote per vault. **Erase all data** deletes the pairing, not
  wording or votes already contributed. Wording already sent cannot be
  withdrawn individually. Public layouts may
  be downloaded at most once a day, independently of the sharing preference,
  and can be cleared in Settings. Matching runs on the phone and can suggest
  fields for you to confirm in Review. Private Mode prevents both contributions
  and downloads.

- **On-device AI (platform models):** on iPhones with Apple Intelligence
  (iOS 26 or later) Wafra can use Apple's Foundation Models, and on supported
  Android phones it can use Google's Gemini Nano through ML Kit GenAI and
  Android AICore. Both models are part of the operating system and run on the
  phone; Wafra itself makes no network request for this feature and downloads
  no model. Wafra uses them for two advisory jobs only: choosing which built-in
  question tool answers an Ask Wafra question it could not otherwise
  interpret (the model receives the question text and the list of tools, never
  ledger rows, amounts, balances or account/card identifiers), and suggesting a
  category for an unclassified merchant (the model receives the merchant name,
  with long digit runs masked). Wafra validates every reply against a fixed
  list of allowed choices; every amount is still calculated by Wafra, and a
  suggested category is applied only when you tap it. On iOS, Apple manages
  the model through Apple Intelligence settings. On Android, Gemini Nano is
  managed by Google's AICore service; Wafra asks AICore to download it only
  when you tap "Download on-device model". Separately, Google's ML Kit
  Android data disclosure
  (https://developers.google.com/ml-kit/android-data-disclosure) states that ML
  Kit SDKs collect device information, app information and performance/usage
  metrics for diagnostics and analytics; that collection is governed by
  Google's disclosure and terms.

- **Legacy on-device text encoder (off by default):** earlier builds could
  download a multilingual text encoder (about 35 MB) from Wafra's GitHub
  release. Current builds do not download or start it; it exists only in
  explicitly configured research builds. When it is enabled, the download
  carries no bank message, transaction, identifier or question, every file is
  checked against a fixed size and SHA-256 hash, and inference runs locally.

- **Complimentary access codes:** When you enter a complimentary access code, Wafra sends the code over HTTPS to its dedicated access service on Cloudflare to verify access to Pro. The app stores the code in Android secure storage and checks it again on app use while enrolled. The service stores a hash of the publisher-issued code and returns a short-lived entitlement. It receives no ledger, SMS, transaction, account, or device identifiers from the app. Cloudflare handles the connection, including the network address, to deliver the service. Private Mode pauses verification. Removing the code or erasing the app’s data clears the local credential. No account or purchase is created.

- **Purchases and paywalls:** when store billing is configured, Apple or Google
  processes payment and Superwall provides paywalls and subscription entitlement
  state. Wafra configures optional SDK event collection off and sends only the
  app's display language (English or Arabic) with a paywall request so the right
  language is shown; it does not send market, onboarding, capture-choice or
  free-capture day-count targeting attributes. This does not remove the SDK's own billing identifiers: Superwall
  can receive purchase/subscription details, SDK-generated user/device identifiers
  including the vendor identifier, device/locale information and the network
  address. Its service may derive approximate location or process install
  attribution according to the SDK and service configuration. Wafra runs no ads
  and sends no bank messages, ledger rows, balances, bank-transaction amounts,
  account/card identifiers or locally stored first name to Superwall. Store
  purchase, renewal, cancellation and refund reporting can continue independently
  of optional in-app event collection so entitlements remain accurate.
- **Forwarded bank email:** not available in this version; the app does not
  create a forwarding address, so no bank email is forwarded to or processed by the relay.
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
  is stored in Cloudflare D1 with a 14-day expiry and can be read by Wafra
  maintainers; expired reports are removed by the next scheduled cleanup; ordinary feedback is not sent to third-party AI. Internal test
  builds also offer a separate parser-research tool. It keeps only likely
  financial-alert templates, masks every digit, removes timestamps, masks
  recipient and merchant spans, replaces words outside a strict financial
  grammar, and aliases unknown senders. It shows the complete result before a
  second confirmation that explicitly permits GitHub Actions and Anthropic
  Claude to process it. Wafra gives its Cloudflare D1 copy a 14-day expiry and removes it during scheduled cleanup;
  GitHub and Anthropic apply their own retention policies. Code and synthetic
  tests may be published in a public draft pull request, but the workflow is
  required not to copy the report itself into that pull request and never
  merges a change automatically. Raw message bodies are not uploaded. Reports
  contain no device, advertising, installation or push identifier.

Wafra does not use financial records for advertising. Superwall and ML Kit
processing is described above.

## Website

Wafra's public website is hosted on Cloudflare Pages. The server counts
landing-page views and download-button clicks. It records the time, page or
button, visitor country, referring hostname, campaign tag (if present) and
whether the request appears automated. These aggregate counts are kept for
three months and are separate from app data. Cloudflare also processes
connection data, including the IP address, to deliver the site.

The website also uses Minilytics, hosted in our Cloudflare account. Its
browser script measures page visits, visit duration, location, browser and
referring websites. It uses a first-party visitor cookie (up to one year) and
a session cookie (30 minutes). Raw analytics events are retained for 90 days.
[Opt this browser out of website analytics](https://wafra-app-azg.pages.dev/?ml_ignore=true). This tracking
applies to the website. The sections above cover the Android and iPhone apps.

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

Nasida Apps LLC uses Cloudflare Workers and D1 for Wafra's optional relay-backed
features. Internet routing and infrastructure may process data outside the
user's country. The main Android and iPhone local-capture paths described above
do not upload bank-message text to this relay.

## Your choices and deletion

The user can:

- decline Android inbox access, live SMS tracking or bank-app notification access separately;
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

Acknowledged relay rows are deleted by the acknowledgement operation.
Unacknowledged structured rows become eligible for deletion after 30 days; the
relay's half-hour cleanup job removes expired rows. Feedback has a 14-day expiry
and is removed by the same scheduled cleanup. A failed or delayed cleanup can
postpone physical deletion. A disconnected device registration is deleted by
the revoke/erase operation; an inactive registration is eligible after one year
only when it has no queued rows, and empty vaults are then removed.

Shared-format wording and pseudonymous votes follow the separate retention
rules above. Deleting a device or vault does not withdraw already shared
wording or votes. Provider backups and copies deliberately sent to external
research services have their own retention rules; deleting a live D1 row does
not establish that every provider-held copy has been erased.

Exported files remain wherever the user saved or shared them and must be
deleted there separately.

## Children

Wafra is not directed at children and is intended for users aged 18 or older.

## Changes

If this policy changes, the date at the top changes with it. Material changes
will be surfaced in the app.

## Contact

Email: [naser@nasidaapps.com](mailto:naser@nasidaapps.com)
