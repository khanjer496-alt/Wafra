# Simple iOS History Import Design Amendment

> **Superseded setup correction (2026-09-04):** This historical design's
> future-alert reference to `Any Sender` plus empty `Message Contains` is not
> active. On iOS 26.6.1 that configuration did not enable **Next**. Apple
> requires an explicitly selected sender or phrase; Wafra now limits future
> automatic capture to bank senders the user selects. History import and manual
> entry remain available.

**Status:** Superseded after the 2026-08-31 physical-iPhone gate by
[`2026-08-31-ios-prepared-history-import-design.md`](./2026-08-31-ios-prepared-history-import-design.md).
The array-bulk design remains here as the decision record; it must not be used
for the published Shortcut.

## Objective

An iOS 26+ user installs one signed **Wafra History Import** Shortcut, starts it
from Wafra, chooses a date range, authenticates once, and returns directly to a
local review. The user never builds, edits, or wires Begin/Stage/Finish actions.

iOS still does not expose the Messages database to Wafra. Apple Shortcuts owns
the explicit, user-started `Find Message` query. Manual paste/PDF imports remain
available when the Shortcut cannot inspect a retained Message.

## User Flow

1. Wafra shows one **Import past alerts** card.
2. **Add History Import** opens the exact signed Shortcut. The user taps Apple's
   **Add Shortcut** once.
3. Back in Wafra, **Start history import** runs that installed Shortcut.
4. The Shortcut offers **Last 30 days**, **This year**, or **Choose dates**.
5. It searches retained Messages using only two date filters: `date is after`
   the selected local start-of-day minus one second, plus `date is before` the
   exclusive next-day start. This includes an alert stamped exactly at the
   selected midnight without depending on an unverified private inclusive
   operator. It does not filter by body, sender,
   contact, conversation, or recipient.
6. Zero results stop before native staging. More than 10,000 results request a
   smaller range. Otherwise, the user confirms the exact result count.
7. The Shortcut prepares every result locally, calls one authenticated bulk
   Wafra import, and opens the completed review route.
8. Wafra parses locally, shows review totals and ledger changes, saves only
   after confirmation, then deletes the protected staged source session.

The future-alert flow remains separate: install **Wafra Local Capture** and
create one Apple personal automation using **Message**, **Any Sender**, empty
**Message Contains**, **Run Immediately**, and **Run Shortcut**. Apple does not
permit Wafra to create or distribute that personal automation programmatically.

## Native Boundary

The existing authorized Begin/Stage/Finish storage protocol remains the source
of truth. One higher-level App Intent makes its complexity invisible to users.

### Import Wafra message history

`ImportWafraMessageHistoryIntent` is background-only and
`.requiresLocalDeviceAuthentication`. It accepts:

- `sessionId: String`
- `found: Int`
- `messageGUIDs: [String]`
- `bodies: [String]`
- `dates: [Date]`

The Shortcut builds the three arrays in one simple Repeat loop. Every Message
appends exactly one value to every array. Missing GUID or Body appends an empty
String; missing Date appends a fixed harmless epoch placeholder. This explicit
loop preserves positional alignment where direct vectorized extraction of an
optional Apple property has no documented cardinality guarantee.

Sender is deliberately omitted from the first bulk version. Apple exposes it
as an `IntentPerson`, and its optional conversion has no documented positional
guarantee. Wafra's parser continues to use the Message Body; Sender may be
added only after physical evidence proves safe one-to-one alignment.

The intent delegates to a testable module importer. It validates before Begin
that `found` is 1...10,000 and all three array counts equal `found`. The
existing strict Begin validation rejects an invalid session ID before creating
state. For each aligned index, the importer emits exactly `{"v":0}` when GUID,
nonempty Body, or Date is unavailable or invalid. Otherwise it:

- hashes the raw GUID with SHA-256 and emits exactly 64 lowercase hexadecimal
  characters;
- preserves Body as plain Text without manual JSON interpolation;
- formats Date as a real UTC ISO-8601 instant with milliseconds;
- serializes the exact version-1 record with Foundation JSON serialization.

It then:

1. calls the existing `beginSession` and keeps the returned authorization
   secret only on the native stack;
2. preserves record order and calls `stageChunk` in exact 50-attempted-record
   chunks, except the final 1...49 remainder;
3. accumulates the returned attempted/accepted/skipped counts;
4. requires attempted equals found and accepted plus skipped equals attempted;
5. calls `finishSession` once with the exact accumulated totals;
6. returns no source data.

Any stage or finish failure uses the existing invalidation/tombstone behavior.
The higher-level importer also best-effort discards after any unexpected error.
No raw GUID, Body, Date, record, or authorization secret appears in an
error, dialog, URL, log, notification, or analytics field.

The existing low-level Begin/Stage/Finish intents remain for compatibility and
for direct protocol testing, but the published Shortcut does not use them.

## Shortcut Graph

The published graph is materially smaller than the prior proposal:

1. Require iOS 26 or later.
2. Show the local-processing disclosure and Continue/Cancel.
3. Resolve one of the three date ranges as `startBoundary` (local start-of-day
   minus one second) and `exclusiveEnd` (local start-of-day after the selected
   end date).
4. `Find Message` with `date is after startBoundary` and
   `date is before exclusiveEnd` only.
5. Count; stop on zero or over 10,000; confirm the exact count.
6. Generate a random session UUID.
7. Repeat each Message and append exactly one GUID String, Body String, and
   Date to three aligned variables, using the documented placeholders when a
   required property is unavailable.
8. Pass those arrays and the exact count to **Import Wafra message history**.
9. Open `wafra://import-sms?history=<percent-encoded-session-id>` only after the
   authenticated import succeeds, then stop without output.

The graph has no external input, import questions, relay/network action, Files,
clipboard, notification, logging, analytics, Quick Look, Speak, nested Shortcut,
or source-data output action.

## Failure Handling

- Unsupported iOS: explain the requirement and keep manual imports available.
- Empty range: stop before native Begin.
- Over 10,000: request a smaller range before native Begin.
- Missing Message property: produce one sentinel, preserving found/attempted
  reconciliation.
- Invalid count or session ID: fail before Begin with a source-free error.
- Stage/finish/storage failure: hide and invalidate the partial session, show a
  source-free retry message, and never open Wafra review.
- App review/save failure: retain the protected completed session for retry.
- Cancel: discard the session. Abandoned sessions still expire after one hour.

## Testing and Release Gate

Implementation is test-driven and requires:

- pure Swift encoder tests for GUID hashing, UTC dates, JSON escaping, Unicode,
  oversized/empty Body, invalid/future dates, and exact sentinel output;
- bulk importer tests for pre-Begin validation, exact 50-item packing,
  all-skipped chunks, totals, order, rollback, tombstone cleanup, and limits;
- generated App Intent metadata/localization tests for the new bulk action and
  its single authentication boundary;
- semantic Shortcut mutation tests for the exact date filters, count gates,
  one result per Message, no low-level intent wiring, and no forbidden actions;
- simulator export only for private serialization discovery;
- the exact signed artifact installed and run on the connected physical iPhone
  with carrier SMS as well as iMessage results, offline/no-network inspection,
  one authentication boundary, Wafra deep-link return, review, save, and source
  deletion;
- a newly incremented iOS/TestFlight build. Public TestFlight build 38 is the
  older setup-only artifact and must not be described as this implementation.

If physical iOS proves that the Repeat loop cannot preserve one aligned
GUID/Body/Date item for every Find result, the release is blocked and the graph
is corrected from a fresh physical export. It is not replaced by a guessed
plist or a misleading success claim.
