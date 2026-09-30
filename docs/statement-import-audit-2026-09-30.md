# Statement-import accuracy audit — 30 September 2026

This continues the full-app audit in the canonical checkout, based on upstream
`566a9243d35ae19e51d149e6e2965daf92a3c66b`. Work remains local and unpublished.
It preserves the previous audit, performance and iPhone setup changes.

This is an evidence-led repair pass, not certification of every bank or every
statement format. A successful text extraction is not proof that a PDF's entire
transaction table was read. Uploaded files are processed by the import service;
this is not local-only PDF extraction or an OCR feature.

## Reproduced failures and repairs

- **Incorrect money direction or currency:** malformed opposite debit/credit
  cells could count as blank; a balance's CR suffix could make purchases income;
  joined foreign currency markers or statement-wide currency metadata could be
  ignored. These contradictions now cause refusal or counted rejection instead
  of an invented ledger amount/direction.
- **Rows mistaken for transactions or silently omitted:** dated opening balances,
  repeated headings, reordered financial columns, Arabic-digit dates, overlong
  rows, unsupported date spellings and explicitly pending/declined CSV statuses
  exposed gaps. Regression fixtures now
  exercise those cases. Blank text layers disable coverage metadata.
- **Wrong ownership:** multiple labelled accounts in a flattened PDF could all
  inherit the first account. Such files now need separate exports. Statement
  issuer evidence is retained in the ledger and backup rather than lost after
  first import. New range identifiers include the issuer when it is known.
- **Statement/live-alert collisions:** synthetic PDF/CSV times could collide with
  live SMS keys, match an edited notification or heal an unrelated purchase.
  File rows now avoid those live-clock shortcuts. New encrypted file rows carry
  their validated position within the file, so retries do not depend on a clock
  while genuine identical purchases on separate queue pages remain distinct.
  Matches to live transactions retain bounded, durable occurrence claims with
  the original statement facts, so one live row cannot be reused for another
  purchase on a later page. User corrections remain pinned.
- **Partial queue acceptance:** a nearly full device queue could accept one row
  and return success for the entire file; delivery to a peer could hide failure
  on the requesting device. Delivery accounting now verifies each requested row
  and target before returning complete success or a range.
- **False completion and lost progress:** retained Review rows or reserved full
  queue pages could look complete; post-commit ACK failure and later-page errors
  could lose the displayed saved-row count. Filing now reports pending status,
  retains committed counts, and keeps pending batch metadata across retries and
  sequential password-protected files.
- **Conflicting replay interpretations:** the service now binds the ordered parsed
  facts before queueing. A retry that changes dates, currency or accepted row
  indices during the receipt window is refused, and concurrent requests cannot
  both establish different interpretations. Legacy receipts are not backfilled
  with guessed facts. Re-upload ranges are also withheld when that file already
  appears in the ledger.
  A settlement-parser revision no longer bypasses a still-live older delivery
  receipt without a verifiable interpretation: it returns
  `statement_options_conflict` and queues no correction. After the old receipts
  expire, a fresh bound reading may be delivered using the unchanged file ID;
  existing ledger matching and user-edit protections still apply.
- **False history coverage:** transaction min/max dates were shown as complete
  months. The UI now shows observed transaction ranges, explicitly says they do
  not establish completeness, and records ranges only after durable filing.
  Partial CSV responses, impossible calendar dates and replay-only uploads cannot
  create a new complete-range claim.
- **Picker and privacy boundaries:** browser picks use their actual File object;
  protected-file retries read current ledger/privacy state. Cache cleanup retains
  a native file while its upload is reading it and removes the copy afterward.
- **Ambiguous numeric dates:** the file picker defaults to detecting evidence in
  the statement. Residence country no longer silently chooses the meaning of
  `04/09`. The user can explicitly select day/month or month/day; contradictory
  file evidence still cannot justify guessing an ambiguous row.

## Qualification limits

- File import primarily reads transaction history. It does not establish universal
  extraction or reconciliation of closing balances, credit limits, minimum
  payments and due dates from statement headers. The separately tested SMS
  statement/reminder path is not proof of those PDF capabilities.
- PDF support requires extractable text. Image-only/scanned transactions are not
  OCRed; a page mixing readable text with an image table may still omit content.
- Current limits are 200 rows per file, PDF 5 MiB / 100 pages, and CSV/TSV
  1 MiB. Larger files are refused rather than truncated.
- Arbitrary bank layouts, languages, financial symbols, multi-account structures,
  and unusual accounting conventions are not universally certified. New real
  format fixtures are needed to extend support with evidence.
- A file that lists no instrument cannot establish account ownership by bank
  name alone. Legacy rows without retained issuer evidence cannot be reliably
  reconstructed after the fact. Separate files or live alerts without proven
  matching account ownership remain separate rather than being silently erased.
  Legacy rows without a file-row position keep conservative replay behavior.
  Re-importing those older files can still require manual duplicate checking if
  synthetic clocks changed; financial rows are not removed by a guess.
- Server interpretation bindings have bounded retention: 72 hours for file
  uploads and attachments, and the existing 15-minute replay window for email
  bodies. They are not a permanent edit history. Re-uploading a statement does
  not authorize silently changing transactions already saved under a previous
  interpretation. Older unbound receipts temporarily prevent automatic parser-
  upgrade re-delivery because the earlier interpretation cannot be proved.
  Tests verify refusal while those receipts remain live and fresh bound delivery
  after expiry, including legacy settlement repair.
- Host/parser tests and mocked authenticated Worker routes do not prove a live
  deployment, native document-provider round trip, or background phone delivery.

## Verification

| Check | Final result |
|---|---|
| Focused statement, client, queue, ledger, capture and reminder regressions | 205/205 |
| Server extraction | 210/210, including generated multipage PDF fixtures |
| Full server package | 299 assertions across push, extraction, schema and deployment-configuration tests |
| Authenticated Worker / SQLite / encryption integration | 412/412 |
| Relay decoding and capture executor | 311/311, including new ordinal validation |
| Cloud import and observed-range contract | 46/46 |
| Import planner | 351/351 |
| Unit / accounting / persistence | 833/833, 62/62 and 267/267 |
| Cash flow / payment reminders | 56/56 and 35/35 |
| Source contracts | 300/300 |
| Import and ledger performance guards | 15/15, no thresholds relaxed |
| App/server typecheck, pure module build, diff check | Passed |
| Changed app-source lint | No errors; one existing import-plan array-type warning |
| Fresh browser acceptance | 4/4, light/dark and normal/private states |

The initial integrated Worker run had eight legacy-upgrade assertion failures.
Those assertions required automatic reinterpretation without retained proof.
They were replaced with stricter refusal/expiry/retry tests, and the synthetic
legacy fixture was corrected not to claim a newly introduced row identity.
The final full Worker rerun passed all 412 assertions. Source-spelling assertions
for queue draining were also replaced with actual callback/executor behavior
tests; no timing threshold or monetary tolerance was loosened.

Independent reviews found and drove additional fixes: lost counts after ACK
failure, pending-context replacement, protected-file queue recovery, repeated
purchases across pages, preservation of user edits, posting-date/minor-unit
replay differences, and claim-only patches overwriting other changes. The
independent-review blockers in the new import paths were resolved; the legacy
limits above remain. This does not establish
that the entire app or every possible statement format is defect-free.

The browser suite reproduced a missing checked-state accessibility attribute
before the fix, then passed after a fresh warm export. It verifies real controls,
privacy visibility and honest range wording; screenshots were inspected. It
uses synthetic ledgers with outbound network blocked. Browser SecureStore
pairing is unavailable, so actual encrypted upload/picker delivery was not
claimed from that suite. Transport and completion callbacks have separate
source tests.

Selected logs and source hashes: `artifacts/statement-import-audit-20260930/`.
Browser evidence: `artifacts/statement-import-browser/`. Complete local logs:
`/tmp/wafra-statement-audit/`.

## Release requirement

The additive `server/migrations/2026-09-30-statement-import-bindings.sql` migration
must be applied before deploying the updated Worker. The schema health gate
checks for it. No migration, deployment, native installation, commit or push was
performed by this audit.
