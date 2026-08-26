# iOS History Import Design

**Status:** Approved on 2026-08-25.

## Objective

Give an iPhone user one obvious **Import past alerts** entry point that searches
retained Messages for a chosen period, parses candidate bank activity locally,
shows a review, commits only after confirmation, and deletes staged source
text. The feature must not imply that Wafra has continuous inbox access.

This subsystem is independent from future live capture, which is specified in
`docs/superpowers/specs/2026-08-25-ios-local-capture-design.md`.

## Supported Scope

- Automatic history import requires iOS 26.0 or later, where Apple introduced
  Find Message. Wafra uses a date-only query and does not depend on the Body
  filter. The exact date-only graph is retested on every release candidate.
- The Shortcut can search only Messages retained, indexed, and downloaded on
  the iPhone. It cannot recover deleted, retention-expired, or unavailable
  iCloud content.
- Every import is explicitly started by the user and scoped to a date range.
- iOS 15.1–25.x keeps free manual paste, PDF, and other explicit import paths.
- Wafra and the history Shortcut never transmit historical raw text. Apple
  Messages may separately sync retained content through the user's iCloud
  settings.

## User Experience

The import screen shows one **Import past alerts** card on iPhone.

### iOS 26.0 or later

The card has one stateful primary button:

1. **Add History Import** when the local installation marker is absent. This
   opens the distinct published **Wafra History Import** iCloud link.
2. **Start history import** after the user returns and confirms installation.
   This runs the installed Shortcut.
3. **Continue in Shortcuts** while a run handoff is pending.
4. **Review imported alerts** when the Shortcut returns with a completed native
   session.

A pending handoff expires after 15 minutes. If no valid completed-session deep
link arrives by then, the card returns to **Start history import** and offers
**Try again** and **Reinstall Shortcut**. Cancel/reset clears the pending
timestamp immediately; the UI never remains on Continue indefinitely.

The Shortcut offers three date choices: **Last 30 days**, **This year**, and
**Choose dates**. It shows the exact number of Messages found before staging
and explains that processing stays on the iPhone. After staging, it reopens
Wafra automatically. Wafra shows progress, matched/skipped totals, ledger rows,
card dues, and reminders, followed by one **File entries** confirmation.

Installation and running remain separate Apple actions, but Wafra presents
them as successive states of one card rather than two unrelated buttons.

### Older iOS

The same card explains that automatic retained-Message search requires iOS
26. Its primary action expands the existing paste importer; PDF and other
explicit imports remain visible. It never renders a dead or hidden feature.

## Shortcut Data Flow

The separately published **Wafra History Import** Shortcut accepts no external
input and contains no relay URL, credential, bank name, phone number, analytics,
HTTP action, Files action, clipboard action, or user data.

1. Verify System Version is at least 26.0; otherwise explain the requirement
   and stop.
2. Show the local-processing disclosure and Continue/Cancel.
3. Ask for one of the three date-range choices. Normalize local start-of-day
   and use an exclusive upper bound so the complete end day is included.
4. Call **Find Messages** for the date range. Do not use a required body phrase
   or Contact sender filter because either can silently omit legitimate bank
   alerts.
5. If more than 10,000 results are found, ask for a smaller range before any
   record is staged.
6. Show the exact result count and obtain final confirmation.
7. Generate a random session ID and call **Begin Wafra history import** once.
   Apple's local-device authentication policy is required here and returns an
   opaque, single-session authorization secret. An already-unlocked device may
   satisfy the policy without displaying Face ID.
8. Preserve Find order. For each Message:
   - hash its GUID with SHA-256, normalize the digest to exactly 64 lowercase
     hexadecimal characters, and use that opaque digest as the record ID;
   - extract Content as Text;
   - coerce Sender explicitly to Text and omit unsafe/empty values;
   - extract the real Message Date and format it as UTC ISO-8601;
   - serialize the exact version-1 record contract;
   - append it to a list of at most 50 records.
   Every Find result contributes exactly one staged Text item. If a required
   GUID, Content, or Date property is unavailable, append the source-free
   sentinel `{"v":0}`; native validation counts it as skipped so attempted
   still equals found. When Find returns zero results, show **No retained
   Messages found** and stop before Begin.
9. Call **Stage Wafra message history** for each chunk using session ID,
   authorization secret, and zero-based chunk index. Every chunk persists
   attempted, accepted, and skipped counts even when it accepts zero records.
10. Call **Finish Wafra history import** with total chunk, found, attempted,
    accepted, and skipped counts.
    Only a finished session may be opened by the app.
11. Open `wafra://import-sms?history=<sessionId>` and stop without returning
    source data.

If a stage or finish action fails, the native layer atomically invalidates the
session and begins best-effort deletion. The Shortcut shows a smaller-range
retry message and never opens an incomplete review; a tombstone keeps failed
cleanup hidden and retryable.

## Record Contract

Each Message is serialized as one JSON Text value:

```json
{
  "v": 1,
  "id": "<SHA-256 of Message GUID, exactly 64 lowercase hexadecimal characters>",
  "text": "<Message Content>",
  "sender": "<plain sender label, omitted when unavailable>",
  "receivedAt": "2026-08-25T10:30:00.000Z"
}
```

Rules enforced by both Shortcut verification and Wafra:

- exactly the keys above; `sender` is the only optional key;
- `id` matches exactly `[0-9a-f]{64}`. UUID-shaped/raw Message GUIDs and every
  other digest encoding are prohibited;
- nonempty valid-Unicode text, maximum 16 KiB UTF-8;
- sender maximum 80 characters, with controls and bidi overrides removed by
  omitting the field rather than losing the Message;
- a valid UTC instant no more than five minutes in the future;
- at most 50 input records per native stage call;
- at most 10,000 accepted records and 8 MiB serialized data per session.

The native action rejects an input list over 50 before filtering oversized
individual records. This closes the current gap where an oversized input list
can be reduced below the limit after filtering.

## Native Session Authorization and Storage

History uses three native App Intents:

1. `BeginWafraHistoryImportIntent`
   - requires local-device authentication;
   - accepts the random session ID;
   - creates an empty protected manifest;
   - returns a random authorization secret that is not embedded in the shared
     Shortcut artifact and is invalidated on finish, failure, discard, or
     expiry.
2. `StageWafraMessageHistoryIntent`
   - default `alwaysAllowed` policy to avoid one device-authentication boundary
     per chunk;
   - accepts session ID, secret, chunk index, and `[String]` records;
   - requires the live manifest and exact secret;
   - makes identical chunk retries idempotent and rejects conflicts;
   - rejects more than 50 inputs before per-record validation;
   - persists a chunk manifest with `attempted`, `accepted`, and `skipped`
     counts even if all records are skipped.
3. `FinishWafraHistoryImportIntent`
   - accepts session ID, secret, total chunks, `found`, `attempted`, `accepted`,
     and `skipped` counts;
   - verifies indices are exactly `0...(totalChunks - 1)`, attempted equals
     found, accepted plus skipped equals attempted, and every supplied total
     equals the sum of persisted chunk metadata;
   - marks the manifest complete and clears its authorization secret;
   - returns no Message data.

Storage remains in Application Support, excluded from backups, with complete
file protection. Writes are atomic. Every public store operation runs through
one serial coordinator and a Darwin `flock` shared by the App Intents and Expo
bridge, so two processes cannot race manifests, chunks, finish, or deletion.
Limits remain four sessions and 24 MiB globally. A failed native validation,
conflict, disk write, or finish first
atomically marks the manifest invalid so the bridge hides it, then attempts
recursive deletion. Failed deletion stays tombstoned and is retried by every
begin, stage, list, read, discard, and expiry pass. Abandoned unfinished,
completed, or tombstoned sessions expire after one hour.

Only completed manifests are visible through the Expo bridge. The JavaScript
API never receives the authorization secret.

The Expo bridge exposes this bounded interface:

- `getCompletedSession(sessionId: string): Promise<{ chunkIndices: number[]; found: number; attempted: number; accepted: number; skipped: number } | null>`;
- `readChunk(sessionId: string, chunkIndex: number): Promise<string[]>` reads
  at most 50 accepted records and refuses open, invalid, expired, or unlisted
  chunks;
- `discardSession(sessionId: string): Promise<void>` is idempotent and keeps a
  failed deletion tombstoned;
- `purgeExpired(): Promise<number>` returns only the number of sessions hidden
  and removed by that call;
- `eraseAll(): Promise<void>` atomically tombstones and removes every history
  session for Wafra's existing Erase Everything flow.

The completed descriptor is the only source of chunk indices and summary
totals; JavaScript never infers completeness from directory filenames.

## Wafra Review and Commit

On a valid history deep link, after ledger hydration:

1. purge expired sessions;
2. read the completed descriptor and its contiguous chunk indices;
3. read and parse one chunk of at most 50 records at a time;
4. validate every record and deduplicate record IDs across chunks;
5. parse locally with the same launch parser and import planner as Android;
6. drop raw text immediately after parsing; convert bounded raw Sender into
   the parser's normalized `bankHint`/bank-card identity, then drop Sender
   before storing the in-memory review model or any durable ledger/review
   state. Confirmation-time replanning uses only that structured identity;
7. yield between chunks and update scanned/matched progress;
8. rebuild the plan against the latest ledger state at confirmation time so a
   concurrent live capture does not duplicate history;
9. durably save the confirmed plan;
10. delete the native session only after the durable receipt resolves.

Cancel explicitly deletes the session. A ledger-write failure retains the
protected session for retry. A deletion failure shows **Delete staged
messages** and also permits leaving the screen; the one-hour expiry remains the
last-resort cleanup.

History import does not advance Android's inbox cursor.

## Privacy and Copy

The app, Shortcut, privacy policy, store listing, and review notes must agree:

- Apple Shortcuts searches the selected retained date range only after the user
  starts it;
- Wafra and its Shortcut do not transmit Message text; Apple Messages may
  separately download retained content through the user's iCloud settings;
- protected staging exists only to bridge Shortcuts into Wafra's local parser;
- Wafra shows a review before ledger mutation;
- staged text is deleted after confirm/cancel and expires after one hour if
  abandoned;
- deleted or unavailable history cannot be recovered;
- the feature does not grant continuing inbox access.

The App Intent dialogs and errors are localized in English and Arabic. No raw
record, sender, GUID, authorization secret, or session content may appear in a
URL, UI error, log, notification, analytics event, or crash field. The shared
Shortcut never embeds an authorization secret. Wafra never persists or logs
it; Shortcuts may retain it only in the current execution state, and the
native store invalidates it on finish, failure, discard, or expiry.

## Artifact and Release Requirements

The repository must contain:

- an auditable source artifact or deterministic builder for the exact Shortcut
  action graph;
- a verifier that rejects missing version/date/count/auth/chunk/finish/deep-link
  actions, any network/file/clipboard action, record leakage, a chunk size over
  50, non-UTC formatting, or an incomplete-session open;
- contract tests for the distinct public history URL;
- native tests for begin/stage/finish authorization, input-count-before-filter,
  contiguous chunks, counts, limits, rollback, expiry, protection, backup
  exclusion, bridge visibility, cross-process contention, exact lowercase
  SHA-256 IDs/raw-GUID rejection, and cleanup;
- JavaScript integration tests for deep links, progress, validation, review,
  durable commit, concurrent live dedupe, retry, cancel, and cleanup failure;
- `EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL` in every shipping iOS EAS profile,
  distinct from `EXPO_PUBLIC_WAFRA_SHORTCUT_URL`.

The generated App Intent titles, parameters, and source-free errors must load
from the module's English and Arabic resource bundle in an actual app build;
source files that are not copied into the pod/app resources do not satisfy the
localization requirement.

## Physical-iPhone Gate

On the current stable iOS release, the exact signed artifact must prove:

1. Find Messages returns carrier SMS as well as iMessage;
2. Content, Sender, Date, and GUID are available and coerce exactly as the
   contract requires;
3. one local-device-authentication boundary authorizes all chunks in one run
   without a repeated prompt per chunk;
4. `[String]` chunk input, 50-record boundaries, finish, and Wafra deep-link
   return work;
5. alphanumeric sender IDs, shortcodes, Arabic/RTL, non-Latin digits, dual SIM,
   and partially downloaded iCloud Messages behave honestly;
6. near/over 10,000 records, near/over 8 MiB, low storage, interruption, retry,
   cancel, lock/reboot, and expiry preserve the stated invariants;
7. airplane-mode import succeeds and network inspection sees no historical
   Message text;
8. overlap with one live alert produces one ledger transaction;
9. the exact tested Shortcut is published to iCloud, its URL is embedded in a
   new TestFlight build, and App Review receives a synthetic demonstration.

No simulator, generated plist, source review, or build metadata substitutes
for this gate.
