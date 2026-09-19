# Receipt dates from iPhone message history

Validated locally on 2026-09-19 against base `7bc59f475d9d19f85e266e787359d5b89498c2b6`.

## Problem and scope

The successful iPhone history Shortcut supplies the original message timestamp.
Wafra previously did not pass that timestamp to the regional parser. The existing
ADIB subject-first receipt template uses month/day dates, while the generic parser
prefers day/month dates. An ambiguous receipt date could therefore land in the
wrong month even though extraction succeeded.

The follow-up platform comparison identified that completed Shortcut history
uses `historical-import.ts`, while `local-message-record.ts` handles live capture.
Both now pass the original timestamp. Regression coverage includes the actual
paged-history loader through the planner and reducer, not only live capture.

Parser 51 recognizes that specific receipt template in the UAE market. It uses
ADIB sender evidence, or requires the month/day interpretation to match the
original received day in UTC+4 when the sender is absent or unrecognized. Known
competing issuers, including mixed issuer sender strings, block the correction.
Ordinary transaction dates and obligation deadlines retain their existing rules.
Parser backfill remains 49; this does not trigger a full Android history reread.
Parser 50's foreign refund metadata behavior is preserved.

## Existing rows and repeat import

A repeat import can repair only an exact, unique Apple message source match whose
original timestamp, amount, instrument, receipt role and old transposed date
still agree. Application rechecks those facts, account identity, source uniqueness
and user edits. The patch changes the date alone. It does not infer duplicate
transactions, change transfer ownership, or reconstruct raw text from diagnostics.
The admitted date repair runs before account discovery and snapshots, so learning
an issuer during that repair cannot create an unused account as a side effect.
The import reducer restores date order only when an admitted correction changes a
date; ordinary history pages retain the linear merge path.

The existing iPhone save flow persists the import before discarding its temporary
native session. A successfully cleaned session allows a fresh Shortcut extraction.
A completed session awaiting review or cleanup is retained by the native store;
rerunning the Shortcut alone does not reset it. The existing temporary-import
discard action removes staging and its checkpoint, not saved transactions.
No Shortcut, native extraction, or session lifecycle code changes in this patch.

## Validation

- Fresh test compilation and app/server TypeScript checks passed.
- 25 focused receipt/local/reconciliation tests passed: receipt template boundaries, original timestamp
  propagation, raw-text stripping, exact-source correction guards, application
  races, ordering, and an idempotent local-message-to-reducer replay.
- Existing parser, bank corpus, invariants, unit, import planning, accounting,
  semantics matrix, adversarial, Arabic, performance configuration, historical
  import, history import, source identity, review binding and ledger money suites
  passed (16 suites).
- 16 existing iPhone paging loader, setup, metadata and interaction tests passed,
  including loading 10,001 records through the current history coordinator.
- Independent read-only review found no remaining blocking issues after checking
  competing issuers and application-time instrument/account changes.
- Targeted lint passed with no errors. Three existing import-plan warnings and
  two warnings for the test's temporary sort instrumentation remain.

Fixtures are synthetic versions of the existing supported template. The private
diagnostic export and its transaction rows are not included in the repository.

This is local source validation. It does not establish an installed iPhone build,
physical Shortcut replay, correction of the user's saved ledger, or measured
device performance. An updated iPhone build and original-message reimport are
needed to verify repair on the device. Ambiguous rows without the required source
evidence remain unchanged.
