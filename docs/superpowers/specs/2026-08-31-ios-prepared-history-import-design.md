# Two-ended prepared iOS history import design

**Status:** Physically proven beta design, 2026-09-02. This supersedes the
one-shot, fixed-window and adaptive date-window candidates.

## Platform boundary

iOS gives Wafra no Messages inbox permission. Apple Shortcuts owns the explicit
**Find Messages** queries and the user starts every history run. This is not the
same permission model as Android. Parity means that every Message Apple passes
to Wafra reaches the same financial parser, market routing, review policy and
import planner as Android.

Future automatic capture is a separate Apple personal Message automation using
**Wafra Local Capture**. Wafra cannot create that automation for the user. A
future alert is staged automatically when Apple runs the automation, then
parsed and filed when Wafra next enters the foreground.

## Why the production Shortcut reads both ends

A one-shot query returned 2,392 Message entities on an iPhone 16 Pro running
iOS 26.6.1. Apple retained the array while a Repeat action ran and killed
`BackgroundShortcutRunner` at its 240 MiB high-water limit before preparation
finished. Date-window replacements avoided that allocation but produced
unreliable Date bindings in the Wafra App Intent sheet on the same phone.

The release candidate therefore makes two independent bounded queries:

- the latest 1,500 retained Messages, in latest-first order;
- the oldest 1,500 retained Messages, in oldest-first order.

It then proves the two halves overlap by stable Message GUID. Histories with at
most 2,999 retained Messages have at least one overlapping row. If there is no
overlap, Wafra erases the partial session and explains that the phone may retain
3,000 or more Messages. It never presents a knowingly partial history as
complete.

This is a beta coverage bound, not an unlimited inbox claim.

## User flow

1. Install **Wafra History Import** from Wafra's exact public iCloud link.
2. Return to Wafra and start the import. Wafra records a one-hour, device-local
   handoff marker and opens the Shortcut with source-free cancel/error callback
   URLs.
3. Read the disclosure and keep Shortcuts open. On the first run, choose
   **Always Allow** when Apple asks whether the Shortcut may share Messages with
   Wafra.
4. The Shortcut creates an opaque random session ID and prepares the latest
   1,500 Messages one by one through `PrepareWafraHistoryMessageV3Intent`.
5. It releases the first query result, queries the oldest 1,500, verifies the
   newest and oldest sort extremes did not change, reverses the oldest result
   into latest-first order, and prepares it.
6. It requires equal query counts and at least one GUID overlap. Any failed
   invariant erases the partial prepared session and stops.
7. `ImportWafraPreparedHistoryV2Intent` authenticates the completed manifest,
   reconciles duplicate overlap records and commits protected chunks.
8. The Shortcut opens `wafra://import-sms?history=<session-id>`. Wafra parses the
   chunks locally, shows only financial candidates for review, and saves only
   after the user presses **File**.
9. A successful save erases the raw source session and replaces the import
   route with Home.

A large retained history took about 23 active minutes in the physical run, so
the app discloses an observed 20–25 minute estimate with device/history
variability. Apple does not expose live Shortcut progress to Wafra while
Shortcuts is foreground; the app must not show a fake percentage.

## Missed-return recovery

The final Open URL can be interrupted by a lock, app switch or another system
handoff. While the one-hour marker is pending, Wafra checks on mount and on
foreground for exactly one protected completed session created at or after the
recorded start time.

- no matching session: keep waiting;
- exactly one valid matching session: validate its ID and replace the current
  route with its review URL;
- multiple matches or corrupt data: fail closed without guessing;
- an explicit Shortcut cancel/error callback: return to Wafra without carrying
  Message data in the URL.

Recovery never returns Message bodies or senders through the JavaScript bridge;
it returns only the session ID, chunk indices and aggregate counts.

## Native intent contract

`PrepareWafraHistoryMessageV3Intent` is iOS 26+, background-only and
`.alwaysAllowed`. It accepts:

- `sessionId: String`
- `position: Int`
- `messageGUID: String?`
- `body: String?`
- `sender: String?`
- `date: Date?`

There are deliberately no Date-range parameters. The physical device resolved
all seven V3 fields without the red repair sheet produced by the retired V2
range binding. Positions are globally contiguous; exact retries are idempotent
and conflicting retries fail closed. Native code hashes the validated GUID
before the first protected write. Invalid required source values become the
exact skipped sentinel.

`ImportWafraPreparedHistoryV2Intent` is background-only and
`.requiresLocalDeviceAuthentication`. It accepts only `sessionId`, derives the
final count from the protected manifest, streams records into completed chunks,
reconciles counts and deletes preparation data on success or failure.

`DiscardWafraPreparedHistoryV2Intent` is background-only and `.alwaysAllowed`.
It accepts only `sessionId` and erases a partial preparation on every explicit
safety failure. Earlier Begin/Stage/Finish and V1/V2 prepare intents remain only
for compatibility and direct tests; the published production Shortcut must not
use them.

## Storage and privacy

Preparation and completed chunks are app-private, backup-excluded, owner-only
and protected with complete iOS file protection. The prepared store accepts at
most 10,000 references and 24 MiB per session, with aggregate quotas. The
production graph intentionally has the lower 3,000-reference bound described
above. Raw Body and Sender exist only in temporary protected source staging;
they never enter the ledger or source-free review-candidate storage and are
removed after save, cancel or expiry.

Prepared interruptions expire after three hours. Completed sessions and the
Wafra handoff marker use a one-hour recovery window.

## Physical evidence

The exact published V3 graph completed on the physical iPhone with standalone
build 44:

- 3,000 prepared references;
- 2,374 distinct readable Messages after overlap reconciliation;
- 638 financial alerts understood;
- 1,736 non-financial or unread Messages;
- 194 ledger entries presented and filed;
- 60 protected source chunks erased after the durable save;
- no jetsam event.

Public artifact:
`https://www.icloud.com/shortcuts/2869584d40ed454691cf3f916cbee158`.

## Release gates

- The generated 111-action graph must match the downloadable public iCloud
  graph after normalizing only Apple's share-time metadata changes.
- Extracted App Intent metadata must contain V3 with the exact parameter types,
  iOS 26 availability, background mode, policy, no output and complete English
  and Arabic resources.
- Native warning-as-error tests cover recovery ambiguity/corruption, file
  protection, manifest integrity, duplicate normalization, rollback, quotas and
  erasure.
- JS tests cover one-hour handoff expiry, source-free callbacks, foreground
  recovery, session-ID validation, durable-save-before-delete and Home route
  replacement.
- Before expanding the external TestFlight group, install the corrected store
  build and run one short missed-return/navigation smoke plus one real future
  bank-alert automation check.
