# iOS history import v4: typed dates (19 September 2026)

Base: `origin/main` `abb50ee4`. Phone: iPhone 16 Pro, iOS 26.6.2, Wafra build 150
(production profile, record `bc30c7ae…`, installed as
`Wafra-History-v2-typed-date.signed`).

## What the phone showed on build 150

Running the installed v2 History Shortcut ends in the alert

> Wafra could not start or resume this history import (reason). Open Wafra to
> check saved progress.

with the literal word `(reason)`. That text is thrown by
`BeginWafraPagedImportIntent`. Its Swift source is generated from a JavaScript
template literal in `modules/wafra-message-history/plugin/paged.js`, where
`\(reason)` is consumed by JavaScript before Swift sees it, so the store's
failure code was never interpolated. The same bug hid every Begin failure since
the paged graph shipped; the sibling generator (`plugin/index.js`) already used
`\\(`.

## Why v2 could not be made reliable

Every v2 date left Shortcuts through Format Date. On this phone iOS 26
materialized the Message `date` property as the localized display string
(`12 Sep 2026 at 9:22 PM`) wherever the graph formatted it as text (native
tolerance commits `42109327`, `45c89604`). A display string has no seconds. The
paged cursor withholds the last whole second of a full page as overlap and
requires the next page to return exactly those rows; with minute-precision rows
the overlap check (`missing-overlap`) or the strict range check fails as soon as
a page boundary falls inside a busy minute, and the Sep 17 "Baseline 200" fell
back to the legacy graph for that reason. Parsing display strings natively
cannot recover the lost seconds.

The only date binding with physical evidence on this device is a `Date` App
Intent parameter fed the Message `date` property directly: the legacy
per-message graph (builds 39/44) imported real history that way, and Apple's
`LNPrimitiveValueType` 8 (`Date`) is what the metadata gate now pins.

## What changed

- `plugin/paged.js`: `\\(reason)` so the alert names the failing check; new
  `BeginWafraPagedImportV2Intent` (`oldestDate`/`newestDate: Date`),
  `StageWafraPagedRowIntent` (`request, guid, body, sender, date: Date`) and
  `CommitWafraPagedPageIntent` (`request, found: Int`). The v2/v3 intents are
  unchanged so existing installs keep their behavior.
- `WafraPagedHistoryStore.swift`: `begin(…Instant:)`, `stageRow`, `commitRows`.
  Rows are buffered in the exact framed form `stage` already validates, so the
  commit reuses every cursor, size, journal and replay rule. A re-staged GUID is
  ignored; a commit whose Shortcuts count disagrees with the staged rows is
  refused (`invalid-input-rows staged=N found=M`) without touching the cursor;
  a lost commit acknowledgement is answered with the current cursor; a new run
  always starts from an empty row buffer.
- `scripts/build-ios-paged-history-shortcut.mjs --rows`: **Wafra History v4**,
  86 actions. No Format Date, Detect Date, Base64 or Combine Text. One typed
  native call per Message inside the page loop, one commit per page. The v2 and
  v3 graphs are byte-identical to before (public record check passes).
- App: the v4 record is the Apple-signed release asset
  `ios-history-v4-20260919/Wafra-History-v4.signed.shortcut`, installed by
  Apple as `Wafra-History-v4.signed`; `ios-history-setup.ts` and
  `ios-paged-setup.ts` run that name for that URL; every iOS EAS profile
  installs it; the release check pins its SHA-256
  `740e24e6a001718ebcf9fc06f0d88a29a10718c85350582acb30c54e4d9f5fad`.

## Independent review findings applied

- A blank Message GUID (Apple returns one for some real-device rows) is
  staged under the same derived local identity `preparedRow` uses instead of
  being dropped, which would have refused every commit of that page.
- Row buffers are named by revision and cleared on Begin and after commit, so
  an interrupted commit cannot leak rows into the next page; the buffer is
  bounded at 6 MiB with a named refusal.
- The Shortcut discards per-row results, so the store remembers the last row
  refusal and the commit refusal names it (`… last-row=<reason>`).
- Install-confirmed markers moved to new keys so a build 150 user who confirmed
  the v2 record is asked to add the v4 record rather than running a missing
  name.
- Install copy describes the Safari download step for the release asset.
- Release readiness accepts exactly the v4 asset URL for every iOS profile
  (the first TestFlight dispatch, run 35440140874, was refused by that rule).

## Verification performed

| Check | Result |
| --- | --- |
| `bash scripts/test/ios-history-paging.sh` | 264 passed (13 new typed-row checks: ordering refusal, exact first cursor, empty-commit refusal, duplicate row ignored, count mismatch refused with cursor untouched, replay acknowledgement, stale row, oversized body staged as skipped, resume, full 120-row completion, body round trip) |
| `node --test scripts/test/ios-paging-shortcut.test.mjs` | 19 passed, including the v4 binding test |
| `scripts/test/ios-journey/paged-metadata.test.cjs`, `paged-history-setup.test.cjs`, `paged-history-interactions.test.cjs` | 11 passed |
| `scripts/test/ios-shortcuts-config.test.js`, `scripts/test/ios-setup-ux.test.js` | 5 / 274 passed |
| `node scripts/release/ios-public-shortcut-check.mjs` | v2 record, capture record and the v4 asset all `passed` |
| Mac Shortcuts engine | The previous owner's status probes reproduce the old `Please choose a value for each parameter` error and its coercion fix; the v2 graph with Messages and Wafra intents stubbed runs its whole loop to the completion branch (`sim2-listpages`). |

## First device run of v4 (build 152) and the loop-variable finding

The first v4 run on build 152 passed Begin silently (both typed boundary
dates resolved) and then prompted **"Message date"** with a date picker for
every row: Shortcuts treated the row intent's `Date` parameter as unfilled
when it was bound to the loop variable `Repeat Item`. Two diagnostic
Shortcuts (`ios-date-probe-20260919`, no Wafra intents) then showed on the
same phone that Format Date returns the exact instant with milliseconds
(`2026-09-19T13:51:17.905+04:00`) for every binding tried, including
`Repeat Item`, Detect Dates, a named variable, an explicit Date coercion and
Get Item from List by `Repeat Index`, and that the GUID is a 36-character
value. Apple's own parameter metadata on macOS 26.1 confirms a Date App
Intent parameter is a `WFDateFieldParameter` that accepts only the scalar
token wrapper the graph uses.

The failure is therefore specific to a Wafra `Date` parameter fed the loop
variable. The v4 graph now re-fetches each row with Get Item from List
(`Item At Index` = `Repeat Index`) and binds GUID/Body/Sender/date from that
action output, the same shape as the Begin boundaries that resolved
silently. 87 actions; the release asset at the unchanged URL was replaced
(SHA-256 `d0a4073435cb5541557ad4c2dba9a7b53465cdff3df98342002484ff8b069fc9`,
31,839 bytes). No app rebuild is needed for this change. Re-adding a
shortcut with an existing name creates a duplicate ("… 1"), so the earlier
`Wafra-History-v4.signed` must be deleted from Shortcuts before the file is
added again.

## Root cause found on the phone: nested loop variables

Three further diagnostics on the same phone (no Wafra intents except where
stated) pinned it down:

- A loop probe over five Messages printed `i=1 … i=5` with distinct GUIDs
  for `Repeat Item`, for Get Item from List bound to `Repeat Index` as an
  attachment, and for the same bound as a scalar. The loop and both index
  wrappers work in a **top-level** Repeat With Each.
- A diagnostic copy of the real v4 graph that logged each
  `StageWafraPagedRowIntent` reply printed `i=1` and the **same** GUID for
  every row (`{"rows":1,"status":"staged"}` each time).

The difference is nesting. The page loop sits inside the outer work-budget
`Repeat` (count). Shortcuts names a nested loop's variables `Repeat Item 2`
and `Repeat Index 2`; a bare `Repeat Item` / `Repeat Index` inside the inner
loop refers to the **outer** Repeat, whose item is the number 1. That single
fact explains every symptom since the paged graph shipped: v2 formatted the
outer loop's item as a date (the "display string" dates), the first v4 run
prompted "Message date" because the Date parameter received a number, and
the by-index rows staged the first Message 51 times. The v2/v3 generators
carry the same latent defect; their published records are unchanged and
retired by the app in favor of v4.

v4 now fetches each row with Get Item from List at `Repeat Index 2` and binds
GUID/Body/Sender/date from that output. A test refuses any outer-loop
variable inside the nested page loop. The release asset at the unchanged
URL was replaced (SHA-256
`6b34bc3563ec86e228db32cd7d0fdb443f6e7e9c074fe55e3ec0c84deef909b6`,
31,795 bytes). On the first run of that file the import ran page after page with no
alert and completed: **1,694 Messages read, 262 bank alerts matched**, in
about 17 minutes (roughly 0.6 s per Message, the cost of one App Intent
call per row), ending on Wafra's "Import past alerts" review screen. This
is the first completed paged history import on this device.

Follow-up worth measuring: with the nested-loop variables fixed, the v2
text-frame shape (no per-Message intent call) may now also work and would be
several times faster; it should be tried as a v5 candidate on the same phone
before replacing v4.

## A second phone: Apple's query fails on a large inbox (v6)

A public tester's iPhone (iOS 26) ran v4 and stopped at the very first
action with Apple's own alert: *The action "Find Message" could not run
because an unknown error occurred.* Wafra was never called. On the same
phone a plain Find Messages (no sort, limit 2) works. Find Messages loads
every matching Message before sorting, so an unbounded "oldest first" query
over a large inbox fails inside Apple's action; the owner's 1,694-message
inbox never reached that limit.

v6 bounds every query:

- The two boundary probes become ladders of age bands (older than 10 years;
  10 to 3 years; 3 years to 1; newer than 1 year for the oldest anchor; the
  last 90 days, 1 year, 3 years, then unbounded for the newest), each run only
  while the previous band was empty.
- The store issues a window with every cursor (`after`, 90 days behind
  `before`, never past the oldest anchor), returned as a typed Date by the new
  `WafraPagedWindowStartDateIntent`; every page query carries both bounds.
- An empty window is committed as a page of zero rows (`found = 0`) and the
  cursor moves to the window edge, whose second is withheld as overlap so a
  row on the exact boundary instant cannot be skipped. Only a window that
  reaches the anchor can complete. Native harness: 306 checks, including a
  windowed run across a 400-day silence that commits every row exactly once.
- `Wafra-History-v6.signed` (167 actions, release asset
  `ios-history-v6-20260919`) is the record every iOS profile installs from
  build 155; v4 stays recognized for phones that already added it.

The support diagnostic `Wafra Messages Check` (`scripts/build-ios-messages-check.mjs`,
release `ios-messages-check-20260919`) runs the six query shapes one at a
time behind "Step N" alerts so a tester's screenshot identifies the failing
shape without relaying steps.

## New-transaction capture: automation trigger verified on the phone

On the owner's iPhone (iOS 26.6.2) the Message automation's Next button stays
disabled with Sender and "Message Contains" both empty, so the 13 September
guidance ("leave both empty") could not be followed. With Sender empty and a
**single space** in "Message Contains", Next enables and the automation can be
attached to the capture shortcut with Run Immediately. Every SMS contains a
space, so this is an unfiltered trigger in practice; Wafra keeps only bank
alerts on-device. The guide copy, the help sheet copy and
`isSupportedIosMessageAutomationTrigger` now describe and accept exactly this
configuration (whitespace-only filter), while keyword filters are still
refused. The capture shortcut was not installed on the owner's phone (only the
history one was); it was installed from the production record `9a85d5f8…`
(`WafraLocalCapture`) and the automation was created against it. Live arrival
of a real bank SMS through that automation has not yet been observed in this
session.

## Not verified here

- No iPhone run of v4: build 150 does not contain the v4 intents, so the
  signed v4 record cannot execute until the next TestFlight build. The first
  device run must confirm that `StageWafraPagedRowIntent` receives exact
  instants (seconds present in the saved cursor) and record the page timing.
- Per-message native calls are slower than a text frame; the legacy graph
  measured about 0.6 s per Message. v4 is built for correctness first.
- The Apple Messages query and the Message automation for new transactions are
  unchanged by this work.
