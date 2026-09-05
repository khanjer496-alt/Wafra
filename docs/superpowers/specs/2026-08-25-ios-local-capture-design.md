# iOS Local Capture Design

> **Superseded setup correction (2026-09-04):** This historical design's
> `Any Sender` plus empty `Message Contains` instructions are not active. On
> iOS 26.6.1 that configuration did not enable **Next**. Apple requires an
> explicitly selected sender or phrase; Wafra now limits future automatic
> capture to bank senders the user selects. History import and manual entry
> remain available.

**Status:** Approved on 2026-08-25.

## Objective

Replace Wafra's four-step, relay-backed iPhone setup with the smallest flow
Apple permits: install one ordinary Shortcut and create one device-local
Message automation. Each newly arriving Message delivered by that automation
is staged on the iPhone, filtered and parsed by Wafra, then deleted after a
durable local outcome. The live capture path does not upload raw Message text.

This specification covers future alerts. Historical import is a separate
subsystem described in
`docs/superpowers/specs/2026-08-25-ios-history-import-design.md`.

## Platform Boundary

Apple personal automations are device-specific and cannot be installed by an
app or an iCloud Shortcut link. Wafra can install the ordinary **Wafra Local
Capture** Shortcut and open Shortcuts, but the user must create and authorize
the Message trigger once. This is the only unavoidable manual setup step.

The local automatic-capture path requires iOS 16.0 or later because it uses
App Intents. Wafra continues to run on its Expo SDK 55 deployment floor of iOS
15.1, but iOS 15.x users retain manual, PDF, and other explicit import paths
instead of seeing a nonfunctional automation offer.

The target automation is:

1. Trigger: **Message**.
2. Sender: **Any Sender**. Do not select Contacts or type bank names.
3. Message Contains: leave empty on iOS versions that permit it.
4. Execution: **Run Immediately**.
5. Action: run **Wafra Local Capture** with the complete **Received Message** as its
   input.

Whether the current iOS release accepts Any Sender with no phrase, preserves a
rich Message input, exposes Sender correctly, and executes while locked is a
physical-device release gate. If an iOS release requires a phrase, Wafra must
not silently substitute a partial-coverage keyword. The release remains gated
until a complete, privacy-safe trigger is demonstrated on that release.

## User Experience

The existing four-step Connect / Shortcut / Test / Automation wizard becomes
two short stages on one screen:

### 1. Add Wafra Local Capture

- The primary button opens the published, credential-free iCloud Shortcut.
- There is no relay pairing, setup JSON, clipboard secret, token preview,
  notification permission, background push registration, or server test.
- Returning to Wafra advances to the automation instructions. A user can also
  choose “I already added it.”

### 2. Turn on automatic capture

- Wafra shows the five exact choices above, one annotated screenshot, and a
  single **Open Automation** button.
- Returning users tap **I added the automation**. Wafra runs the installed
  Shortcut with no input, which selects its setup-proof branch. Immediately
  before that explicit confirmation, Wafra enables native capture admission;
  a fresh install keeps admission disabled by default.
- The test writes only an opaque setup proof through Wafra's native action. It
  contains no fake purchase and cannot prove that Apple's Message trigger is
  working.
- Success changes the card to **Ready — waiting for the first bank alert**.
- The first accepted, locally parsed alert delivered through the Message branch
  changes the card to **First bank alert captured locally**. A public App
  Intent cannot prove that a personal automation invoked it; only the external
  physical-device test may claim that automation itself is verified.

The setup screen always keeps **Manual tracking** and **Import past alerts**
available. Failure to configure automation never blocks the rest of Wafra.
Choosing manual-only setup, turning capture off, or using Erase Everything
disables native admission before changing app state, so an automation that the
user has not yet deleted cannot recreate staged data.

## Components and Boundaries

### Credential-free Capture Shortcut

The published **Wafra Local Capture** Shortcut accepts only Messages:

- A run with no input invokes the native setup-proof action and stops.
- Message input is explicitly coerced into Sender, Content and GUID text. The
  Shortcut hashes the GUID with SHA-256, normalizes the full digest to lowercase
  and passes that stable 64-hex identity plus the Message's actual lower-case
  `date` property to the native live-message action.
- It has no URL, bearer token, device ID, file action, clipboard action,
  analytics, logging, notification, or HTTP action.
- It never displays, copies, speaks, or returns Message content.

The Shortcut remains an ordinary shareable iCloud Shortcut. It does not and
cannot contain the personal automation. The distinct name avoids ambiguous
replacement behavior for users who still have the relay-backed **Wafra
Capture** Shortcut.

### Native App Intents

The iOS app target exposes two background-capable App Intents:

1. `RecordWafraCaptureSetupProofIntent`
   - no parameters;
   - writes the current proof version and timestamp;
   - never marks real-message automation as verified.
2. `StageWafraLiveMessageIntent`
   - parameters: `sender: String`, `body: String`, `eventId: String`, and
     `observedAt: Date`; `eventId` is the full lowercase SHA-256 of Apple's
     Message GUID and `observedAt` is the triggered Message's Date;
   - validates all fields before persistence;
   - validates all bounded fields without treating a sender allowlist as the
     financial parser;
   - returns one of `accepted`, `ignored`, `invalid`, `capacityReached`, or
     `disabled`
     without echoing the input.

Both intents use the default `alwaysAllowed` authentication policy so a user
who explicitly chose Run Immediately is not prompted for device authentication
on every SMS.
They must not open Wafra. On iOS 16–25 they use App Intents' background default
(`openAppWhenRun` remains false); an iOS 26 availability extension declares
`supportedModes = .background`. This keeps one compiled intent compatible with
the iOS 16 floor without referencing the iOS 26-only `supportedModes` API on
older systems.

### Native admission and parser routing

Sender labels vary by carrier, so a production-empty alias registry cannot be
an admission gate. Native code accepts any nonempty, bounded, control-free
Sender and bounded Content delivered by the user's Any Sender automation. This
means an ordinary new Message can remain briefly in the protected local queue
until Wafra classifies it. There is no native body-phrase fallback and no native
financial parser.

The TypeScript launch parser remains authoritative. A physically evidenced
exact sender attribution wins. Otherwise existing sender/body/currency routing
selects a UAE or Saudi market only when evidence is unambiguous; the current
ledger market must not relabel an explicit SAR alert as AED or vice versa.
Transactions, payments, statements, dues, declines, ignored messages and
source-free review items use the same policy as Android. OTPs, promotions,
balance-only notices and unsupported messages are deleted on the next drain
without ledger mutation.

### Protected Live Queue

Accepted records are staged in a dedicated native queue, separate from history
sessions and the relay inbox. Each record has this exact logical shape:

```json
{
  "v": 1,
  "id": "<lowercase SHA-256 of Apple Message GUID, or legacy UUID>",
  "text": "<Message Content>",
  "sender": "<plain sender label>",
  "observedAt": "<UTC ISO-8601 instant>",
  "source": "message"
}
```

Queue invariants:

- admission is disabled by default and stored inside the same protected,
  locked native manifest; a disabled stage call returns `disabled` before any
  record write;
- maximum 16 KiB UTF-8 per body and 80 characters per sender;
- controls and bidi overrides are rejected from Sender;
- maximum 2,000 records and 8 MiB of serialized record data;
- idempotent when the same Shortcut invocation retries with the same event ID
  and bytes; conflicting reuse is rejected;
- atomic manifest and record writes;
- Application Support storage excluded from backups;
- `completeUntilFirstUserAuthentication` data protection so capture can work
  while locked after the first unlock following a reboot;
- records older than 30 days are expired on the next stage or drain;
- capacity failure increments a source-free dropped count and never evicts an
  unprocessed financial alert silently.

No live Message content is placed in UserDefaults, Keychain, URLs, the
clipboard, logs, analytics, notifications, crash metadata, D1, or the relay.

The SHA-256 identity is stable for one Apple Message and is shared with history
import. An exact retry is therefore idempotent and a later history run can match
the same new Message by identity, while two distinct Message GUIDs remain two
events even when their text and timestamp are identical. Legacy UUID records
remain readable only for migration.

### Native Bridge and Concurrency

The Expo module exposes this bounded interface:

- `listPendingRecords(limit: number): Promise<string[]>` returns at most 50
  serialized records ordered by `observedAt`, then `id`;
- `acknowledgeRecords(ids: string[]): Promise<void>` atomically removes at most
  50 IDs and is idempotent for an already-removed ID;
- `purgeExpired(): Promise<number>` removes only records older than 30 days;
- `getCaptureStatus(): Promise<{ enabled: boolean; pending: number; dropped: number; corrupt: boolean; warningId: string | null; setupProofVersion: number | null; setupProofAt: number | null; firstCapturedAt: number | null }>`
  returns source-free counts and setup milestones only; timestamps are Unix
  epoch milliseconds;
- `setCaptureEnabled(enabled: boolean): Promise<void>` atomically changes the
  protected admission flag. Disabling prevents every later App Intent stage
  from writing, including calls from an automation that still exists;
- `acknowledgeCaptureWarning(warningId: string): Promise<boolean>` clears the
  dropped/corrupt warning only after bounded recovery, and only when the opaque
  ID still matches so a racing native warning cannot be erased;
- `recordFirstCapturedAt(observedAt: number): Promise<void>` accepts Unix epoch
  milliseconds and records the first
  qualifying alert milestone idempotently only after the ledger/review receipt
  is durable;
- `eraseAll(): Promise<void>` atomically disables admission, tombstones and
  removes all queued records, and removes proof state, milestones, and
  source-free counters for Wafra's existing Erase Everything flow. It leaves
  admission disabled.

All native mutations run through one serial coordinator and an interprocess
file lock shared with the App Intent. A list call observes a stable snapshot;
an intent may append after that snapshot without being removed by its later
acknowledgement. JavaScript permits one drain at a time. Corruption atomically
tombstones the affected record or manifest, hides it from future reads, and
sets the source-free `corrupt` status before best-effort deletion.

### JavaScript Drain Coordinator

Wafra drains the queue after ledger hydration on launch and whenever the app
becomes active:

1. Purge expired data and read at most 50 records per native call.
2. Validate the record contract again.
3. Re-resolve the exact sender registry identity, pass its `AE` or `SA` market
   to the existing launch parser as `forcedMarket`, and reject a page before
   mutation if it contains more than one market. Before a single-market page
   mutates the ledger, align it through the ledger adapter's `setMarket`; if
   the ledger cannot change to that market, leave the entire page queued.
4. Drop raw Message Content immediately after parsing. Keep bounded Sender only
   in memory through the import planner so bank/card attribution remains
   correct, then drop it before durable ledger or review persistence.
5. Build the import plan against the latest ledger state.
6. Durably save transactions, card dues, reviews, healing records, and the
   first-local-bank-alert timestamp.
7. Acknowledge native record IDs only after the durable receipt resolves.
8. Leave source records in place after storage failure so the next drain can
   retry.

An ignored known-bank message is acknowledged after parsing. An invalid native
record is acknowledged and counted without retaining its source. A full or
corrupt queue produces a visible, source-free recovery notice in Wafra.

A parsed transaction, card payment, card statement, or card due qualifies for
the first-local-bank-alert milestone after the import plan is durably ensured,
including when semantic deduplication correctly produces no new row during
dual-run. A decline qualifies only when the plan actually reconciles a prior
posting. A review candidate qualifies only when the review admission receipt
reports at least one admitted item. OTPs, promotions, balance-only notices,
parser misses, no-op declines, and rejected review candidates do not qualify.
Wafra calls `recordFirstCapturedAt` only after that exact qualifying durable
receipt resolves.

## Privacy Model

The personal automation lets Shortcuts pass an arriving Message to a Wafra
action. Wafra's action may inspect Sender and Content on-device, but only a
bank-alert candidate is written to protected storage. The TypeScript parser
removes raw text before ledger persistence. The live path makes no network
request.

Privacy, terms, store listing, onboarding, and landing-page copy must all say:

- the user creates one Apple Message automation;
- Wafra filters and parses candidates on the iPhone;
- raw Message text is deleted after local processing;
- after a user completes migration, the new local automatic-capture path does
  not upload iPhone Message text;
- an accepted raw bank message may remain in protected local queue storage
  until Wafra processes it, for no longer than 30 days;
- Apple does not give Wafra general background inbox access.

Copy must not claim that users select bank conversations or that adding a
branded sender to Contacts fixes Apple's picker.

## Migration from Relay Capture

Existing TestFlight users may have a paired relay device and an older Wafra
Capture Shortcut.

- They see **Update automatic capture** rather than a fresh setup.
- Wafra installs **Wafra Local Capture** and asks them to create the one new
  automation. It does not rely on replacing a same-named Shortcut object.
- The old relay Shortcut, automation, credential, and background sync remain
  active after the synthetic setup proof. During this dual-run period, the
  import planner deduplicates relay and local copies of the same alert.
- Only after Wafra durably processes the first qualifying bank alert from the
  local Message branch does it retire that device's **Shortcut ingest scope**
  on the relay. The scoped server operation rejects later `/v1/ingest` calls
  from the old Shortcut and clears its automation generation, while preserving
  the device, encrypted queue/sync credentials, forwarded-email address, PDF
  and CSV imports, trusted-device membership, and source-free background wakes.
  A failed scoped retirement remains visibly retryable; Wafra never disables
  or deletes those separate import products as a migration side effect.
- Retirement and `/v1/ingest` admission use one atomic D1 boundary. An ingest
  request that authenticated before retirement cannot enqueue a Shortcut row
  after retirement commits.
- Wafra then tells the user to delete the old relay automation. A still-present
  old Shortcut receives 401 after revocation and cannot create ledger rows.
- Privacy copy says plainly that the already-authorized relay automation may
  continue its previously disclosed upload behavior during this transition.
- Server ingestion remains available for forwarded email and other explicit
  import products, but it is no longer the iPhone Message automation path.

## Error Handling

- Missing Shortcuts app: offer Apple's Shortcuts App Store page.
- Missing/unpublished Capture link: keep manual/history routes enabled and show
  a release-configuration error.
- Native action unavailable: instruct the user to update Wafra, not reinstall
  repeatedly.
- Synthetic proof timeout: return to the two-stage setup with one retry button.
- Capture disabled: do not stage the Message; show setup only after the user
  opens Wafra, without exposing Message data.
- Unknown sender: let the shared parser route from available sender/body/
  currency evidence; fail closed on ambiguous market evidence.
- Nonfinancial content: delete it silently on-device after classification.
- Queue full: preserve existing records, increment a dropped count, and show a
  recovery notice on next app open.
- Locked before first unlock after reboot: do not weaken file protection. The
  physical release notes must state observed system behavior; the feature is
  not released if iOS drops rather than defers the test alert.

## Verification and Release Gates

Automated verification must cover:

- generated Shortcut contains no network/file/clipboard action or literal
  financial data;
- no-input setup executes only the setup-proof branch;
- Message input supplies bounded Sender and Content, full lowercase
  SHA-256(GUID), and the actual Message Date to the native action;
- sender registry normalization, exact aliases including exact shortcodes and
  business IDs, controls, bidi, lookalikes, and false-positive personal
  messages;
- native queue validation, file protection, no-backup flag, idempotency,
  conflicts, bounds, expiry, corruption, capacity count, acknowledge-after-
  durable semantics, disabled-by-default admission, opt-out/erase races, and
  crash recovery;
- parser integration for transaction, card payment, statement, due, decline,
  OTP, promotion, unreadable, review, and duplicates with distinct event IDs;
- migration preserves relay capture until the first durable local bank alert
  and then retires only the old Shortcut-ingest scope, including a deliberately
  interleaved retirement/ingest race;
- privacy/schema/log scans prove no live raw-text network or durable ledger
  surface remains.

The physical-iPhone gate must demonstrate on the current stable iOS version:

1. prove that the current iOS version accepts Any Sender with an empty Message
   Contains field; if it does not, stop the release because there is no
   complete-coverage one-automation fallback;
2. install the exact signed shared Shortcut;
3. create one Any Sender, Run Immediately Message automation;
4. receive a real alphanumeric UAE bank alert while Wafra is closed and the
   phone is locked;
5. open Wafra and verify the correct locally parsed ledger row;
6. send an unrelated personal SMS and prove it creates no ledger/review row,
   leaves no raw record after the next drain, and causes no network request;
7. repeat after force quit and after reboot plus first unlock;
8. verify Arabic/RTL, shortcode, dual-SIM, offline, low-storage, retry, and
   queue-capacity behavior;
9. publish the exact tested Shortcut and embed its iCloud URL in every iOS EAS
   profile before building TestFlight.

Simulator, source inspection, a synthetic test, or a successful EAS build does
not satisfy this gate.
