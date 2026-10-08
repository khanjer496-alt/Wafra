# Statement-import server changes — 8 October 2026

These changes are in the import service (`server/`) only. They are not deployed;
deploying them is a separate, explicitly authorised step. There is no D1 schema
change and no migration. The new budget counters are new `scope` values in the
existing `cost_limits` table.

## Wire contract for app builds

New behaviour that a shipped build would mishandle is opt-in. A build turns
it on by sending `x-wafra-import-features` on `GET /v1/import/capabilities`,
`POST /v1/import/pdf` and `POST /v1/import/csv`. The value is a comma-separated
list of tokens:

- Matching is case-insensitive and surrounding spaces are ignored.
- Unknown tokens are ignored.
- A value longer than 200 characters is ignored as a whole.

| Token | Without it (shipped builds) | With it |
| --- | --- | --- |
| `xlsx` | `csv.accepts` and `csv.maxBytesByType` omit the spreadsheetml type. Uploading it gets 415 `csv_required`, as before. | Both list it, and the CSV route reads it. |
| `pdf-error-detail` | Damaged or unsupported-encryption PDFs get `unreadable_pdf`. A PDF with no text gets `unsupported_statement_format`. Both are the same as before. | `pdf_damaged`, `pdf_encryption_unsupported`, and `unreadable_pdf` for a PDF with no text. |

The base64 password header and `pdf_password_invalid` need no token: only a
new build can send that header.

| Surface | Value |
| --- | --- |
| Password header | `x-wafra-pdf-password-b64`: standard, padded base64 of the password's UTF-8 bytes. Takes precedence over `x-wafra-pdf-password`. At most 256 UTF-8 bytes. Spaces are kept exactly. |
| Capabilities | `pdf.passwordEncoding: ["b64"]`, `pdf.maxPasswordBytes: 256`, `csv.accepts` includes `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `csv.maxBytesByType` (type → bytes: 1,048,576 for text types, 2,097,152 for .xlsx). `csv.maxBytes` stays 1,048,576. |
| New error codes | `pdf_password_invalid` (400), `invalid_xlsx` (400, only with `xlsx`), `pdf_damaged` (422) and `pdf_encryption_unsupported` (422), both only with `pdf-error-detail`. |
| Changed outcome | With `pdf-error-detail`, a PDF that opens but has no text on any page answers `unreadable_pdf` (422) instead of `unsupported_statement_format`. |

The legacy `x-wafra-pdf-password` header still behaves as before: it drops a
value over 128 characters or containing CR, LF or NUL, and the PDF then
answers `pdf_password_required`.

## Hourly statement budget

`/v1/import/pdf` and `/v1/import/csv` still reserve their units before
parsing, with the same atomic `cost_limits` UPSERT. Some outcomes now give the
person's import unit back with a conditional `UPDATE`. That `UPDATE` only
changes the same hour window the unit was charged to.

| Counter (`scope`) | Per | Ceiling/hour | Refunded? |
| --- | --- | --- | --- |
| `statement_requests` | device | 12 | Yes, for `pdf_password_required`, `pdf_password_incorrect` and `alreadyProcessed` replays |
| `statement_attempts` | device | 48 | Never. This bounds the refunded outcomes. |
| `pdf_password_attempts` | device | 20 | Never. A request counts when it carries any password. This bounds password guessing. |
| `statement_requests` | `global` | 1,000 | Never. This bounds total parsing work. |

The device's import unit is reserved first. When it is exhausted, the request
is refused before any other counter is written. A refusal at a later step
hands that unit back.

Because the unit is reserved first, a device that has spent all 12 imports
gets `rate_limited` even for a password retry or a re-upload. Those requests
just no longer spend the unit.

Replays still reserve `supplemental_deliveries` (rows × phones), because
they still seal a copy for every phone.

## PDF failures

`pdfOpenFailure` (in `imports.ts`) gives a specific code only for cases pdf.js
identifies precisely:

- **`pdf_damaged`:** `InvalidPDFException`, or a wrapped `ParserEOFException`,
  `XRefParseException`, `XRefEntryException` or `InvalidPDFException`.
- **`pdf_encryption_unsupported`:** a wrapped `FormatError` saying
  `unknown encryption method` (for example certificate security),
  `unsupported encryption algorithm` or `Unknown crypto method`.

Every other failure is still `unreadable_pdf`. This includes `invalid key
length`, `Invalid crypt filter name.` and anything unexpected.

Non-ASCII passwords: AES-256 (revision 6) PDFs take the Unicode password.
RC4 and AES-128 (revisions 2–4) and revision 5 PDFs read one byte per
character. When a non-ASCII password is rejected as incorrect, it is tried
once more as its UTF-8 bytes.

## Excel `.xlsx`

`.xlsx` uploads use `/v1/import/csv` with the spreadsheetml content type, up
to 2 MB. `xlsx-records.ts` reads the first visible worksheet without any
dependency. It parses the ZIP central directory and inflates entries with
`DecompressionStream('deflate-raw')`. The rows then go through
`parseStatementRecords`, which is the CSV parser's own column detection and
refusal logic.

Limits:

- Only stored and deflate entries are read.
- Encrypted entries, ZIP64 and multi-disk archives are refused.
- At most 2,000 entries.
- At most 16 MB of declared output across the whole archive. This only checks
  the directory; entries the reader never opens are never inflated.
- At most 4 MB of XML inflated in total, covering the workbook, relationships,
  styles, shared strings and the sheet.
  - Why 4 MB: a statement has at most about 211 non-empty rows (200 data
    rows, a 10-row preamble and the header) of at most 8,192 characters each.
    That is about 1.7 M characters in the most extreme legal case. A real
    bank export is well under 500 KB of XML.
- Each entry's output is capped at its declared size while it inflates, and
  its size and CRC-32 must match.
- XML parts may not contain a DTD. Only the five predefined entities and
  numeric character references are expanded, in one linear `replace` pass.

Memory is bounded while scanning, not after. The first limit crossed refuses
the file:

| What | Limit |
| --- | --- |
| Elements per XML part | 300,000 |
| Attributes per element | 64 |
| Raw attribute value | 2,048 characters |
| Element or attribute name | 128 characters |
| Raw text node | 49,152 characters |
| Decoded text node, cell or shared string | 8,192 characters |
| Shared strings | 50,000 entries, 2,000,000 characters in total |

Two reported workbooks used to exhaust the heap: about 20 KB of `&amp;`
entities, and 4,800 shared strings of entities. Both are now refused as
`invalid_xlsx` within milliseconds. `test/statement-files.test.cjs` reruns
them, and 12 other hostile shapes, in a child process limited to a 96 MB heap.

How cells are read:

- Cells formatted as dates become ISO `YYYY-MM-DD`, using the workbook's 1900
  or 1904 date system.
- Other numbers keep their stored decimal text. An exponent is expanded by
  moving digits, never through a float.
- Rows are padded to the widest non-empty column. Empty rows are skipped.

Legacy `.xls` and password-protected workbooks are refused. A password-protected
workbook is an encrypted OLE container, not a ZIP, so it gets `invalid_xlsx`.

## Row ceiling (not raised)

`MAX_IMPORT_ROWS` stays at 200. The delivery budget would allow 500:

- 500 rows × 8 phones = 4,000 deliveries.
- That fits under 25,000 per device and 100,000 globally.
- Each route reserves the whole amount before it seals or queues anything.

Shipped app builds are what block the change:

- `src/lib/relay.ts` (`isParsedRelayRow`) treats `statementRowIndex >= 200`
  as unreadable, and the sync loop acknowledges and deletes those rows.
- `src/lib/backup-validation.ts` and `src/lib/dedupe.ts` also assume indices
  below 200.

So rows 200–499 would be lost on any phone in the vault that runs an existing
build. The server cannot see which builds are in a vault. Raising the ceiling
needs those app checks widened first, and then a way to know that every target
phone runs a build with the wider checks.

## Verification

- `npm --prefix server test` runs the existing suites plus
  `test/statement-files.test.cjs` and `test/import-routes.test.cjs`. The new
  suites build synthetic workbooks (stored and deflated) and RC4-encrypted
  PDFs in-process. The route suite drives the bundled Worker against SQLite.
- `npx --prefix server tsc --noEmit -p server/tsconfig.json`
- `bash scripts/test/worker-gate.sh`
