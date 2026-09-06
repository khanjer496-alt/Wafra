# Wafra History Import — iOS 26+ Shortcut specification

This is the source of truth for the separate **Wafra History Import**
Shortcut. It imports retained historical Messages without uploading their text.
It does not replace **Wafra Local Capture**, the separate personal automation
for newly arriving Messages.

## Supported scope and honest boundary

- Require iOS 26 or later. The production artifact was exercised on iOS 26.6.1.
- “Past messages” means Messages still retained, indexed and downloaded on the
  iPhone. Deleted or unavailable Messages cannot be recovered.
- The user explicitly starts each history import. Wafra never receives direct
  or continuing inbox access.
- The Shortcut requests up to 1,500 newest and 1,500 oldest retained Messages.
  It proceeds only when a stable GUID overlap proves complete coverage. A phone
  retaining 3,000 or more Messages therefore stops safely instead of importing
  a knowingly incomplete history.
- Raw text never uses the relay, clipboard, URL query, Files, Notes, analytics,
  logs or AI. It exists only in Wafra's temporary protected staging and is
  removed after durable save, cancel or expiry.

## Published artifact

- Exact name: **Wafra History Import**.
- Public URL:
  `https://www.icloud.com/shortcuts/2869584d40ed454691cf3f916cbee158`.
- The public downloadable graph matches the generated 111-action production
  graph after normalizing only Apple's share-time name, Watch surface and
  minimum-client metadata.
- It accepts no input and contains no network, relay, credential, Files,
  clipboard, logging, notification, nested Shortcut or source-output action.

## Shortcut action graph

1. Explain the two bounded 1,500-Message queries, local processing, 2,999-row
   coverage boundary and expected duration. Ask the user to continue.
2. Generate an opaque random `WAFRA-…` session ID and set the global prepared
   position to zero.
3. Find the latest 1,500 Messages in latest-first order. Stop if none exist.
   Extract and require the first/newest GUID and the last/boundary GUID.
4. Repeat the latest result. Increment the position, extract GUID, Body, Sender
   and Date as scalar values, and call
   `PrepareWafraHistoryMessageV3Intent`.
5. Release the latest result with **Nothing** before querying again.
6. Find the oldest 1,500 Messages in oldest-first order. Require its first/oldest
   GUID.
7. Re-query one latest and one oldest Message. Their GUIDs must match the
   previously observed extremes; otherwise erase the partial session and stop.
   The two bounded queries must also have equal counts.
8. Iterate the oldest result in reverse index order so preparation remains
   globally latest-first. Mark coverage when a GUID equals the latest query's
   boundary GUID. Prepare each row through the same V3 intent.
9. If no overlap was observed, call `DiscardWafraPreparedHistoryV2Intent`,
   explain the 3,000-or-more boundary and stop.
10. Call authenticated `ImportWafraPreparedHistoryV2Intent` with only the
    session ID. Duplicate overlap records are reconciled by the native store.
11. Open only `wafra://import-sms?history=<URL-encoded-session-id>` and stop.

Every explicit error path is source-free and erases partial preparation when a
session may contain Message source.

## V3 per-Message contract

`PrepareWafraHistoryMessageV3Intent` is available on iOS 26+, runs in the
background and uses `.alwaysAllowed`. Its exact parameters are:

- required `sessionId: String`;
- required `position: Int`;
- optional `messageGUID: String`;
- optional `body: String`;
- optional `sender: String`;
- optional `date: Date`.

There is no declared count or Date range. Native code validates the values,
hashes the GUID before the first protected disk write, canonicalizes Date to a
UTC millisecond instant, omits unsafe optional Sender values and writes an exact
skipped sentinel for an invalid required source value. Positions are contiguous
and exact retries are idempotent; conflicting retries invalidate the session.

## Wafra-side behavior

- Prepared source is app-private, backup-excluded, owner-only and protected by
  iOS complete file protection. Prepared interruptions expire after three
  hours. Native storage enforces 10,000-reference and 24 MiB per-session defense
  limits even though this graph has a lower 3,000-reference bound.
- Final import authenticates and closes the prepared manifest, writes completed
  chunks of at most 50 records, reconciles totals, and deletes prepared source.
- The JavaScript bridge exposes only a session descriptor and one chunk at a
  time. Raw bodies and senders are dropped at the parser boundary and never
  enter the ledger.
- The review uses the same parser and import planner as Android. It changes
  nothing until the user confirms.
- Wafra waits for durable SQLCipher storage before deleting the completed source
  session. Successful File or Cancel replaces the cold-open route with Home.
- If the final Open URL is missed, a one-hour source-free handoff marker lets
  Wafra recover exactly one fully verified completed native session on mount,
  foreground or expiry. Missing returns `null`; ambiguity or corruption fails
  closed.

## Physical evidence and remaining gate

The published artifact completed a full run on an iPhone 16 Pro with iOS 26.6.1
and standalone build 44: 3,000 prepared references became 2,374 distinct
readable Messages, 638 understood financial alerts and 194 filed ledger entries.
The completed 60-chunk source session was removed after the durable save. The
active run took about 23 minutes and Apple's first-run prompt required **Always
Allow**.

Build 44 predates missed-return and post-save navigation corrections. Before
external TestFlight distribution, install the corrected store build and run one
short recovery/navigation smoke. This does not require repeating the full
2,374-Message import unless the signed Shortcut graph changes.
