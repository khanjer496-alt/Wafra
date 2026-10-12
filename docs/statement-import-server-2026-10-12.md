# Statement-import parser checks — 12 October 2026

These changes are in the import service's statement parser
(`server/src/imports.ts`), its routes (`server/src/index.ts`) and the app's
import contract. They were written on 12 October against an older `main` and
ported onto current `main` on 22 October 2026; see
[Port onto current main](#port-onto-current-main--22-october-2026) for what
the port changes relative to `main` as it stood (`cd95a2ba`). They are not
deployed: the relay must be redeployed before any of this reaches users, and
deploying it is a separate, explicitly authorised step. There is no D1 schema
change and no migration. Every sample used to build and test them is
fictional.

## What the parser now does

| Change | Before | Now |
| --- | --- | --- |
| A row printing a marked amount and a marked running balance (`01/09/2026 CARREFOUR 120.00 DR 4,880.00 CR`) | The balance was imported as the amount (a CR balance as income), and the merchant kept `120.00 DR`. | The inner figure is the amount, with its own label, only when the running balance moved from the one before it (an opening-balance line or the previous row in this shape) by exactly that amount in that direction. The same figure under the same label twice (`101.75 CR 101.75 CR`) is that one amount. Any other row in this shape, including the first one when there is no opening balance, is refused and counted. |
| Rows that do not add up to the statement's own balances | Imported. | A PDF upload whose rows provably miss its stated closing balance is refused with `statement_does_not_reconcile` (see below). The check runs only on a complete read with both an opening and a closing balance stated on short label lines (`Opening`, `Previous`, `Beginning` or `Start balance`, `Brought forward`, `الرصيد الافتتاحي`; `Closing`, `New`, `Ending` or `End balance`, `Total Outstanding`, `Carried forward`, `الرصيد الختامي`), and every reading of each label agreeing (per-page carried-forward balances do not); otherwise the verdict is `unknown` and the import goes ahead as before. Ported by hand from PR #94, with two fixes: the card summary (due) row is not summed, and a payment received onto a card (`cardPayment`) lowers what is owed. |
| A PDF that reads no rows | `unsupported_statement_format` only. | The same code, plus a `layout` fingerprint: row shapes as token classes (`DATE WORD+ MONEY MONEY`) and column labels from a fixed list. No merchant, amount, name or number from the file is ever in it. |
| Row dates printed without a year (US `09/01`, UK `1 Sep`, `Sep 1`) | Refused (`unsupported_statement_format`), and `1 Sep` rows were not even counted. | The year is taken only from one explicit statement-period line in the same file (`September 01, 2026 through September 30, 2026`, `1 September 2026 - 30 September 2026`, `1 Sep - 30 Sep 2026`, `Opening/Closing Date 08/28/26 - 09/27/26`, `Statement period: …`), when the period runs forward for at most 12 months and exactly one year puts the row inside it. A December-to-January period gives each side its own year. Otherwise the row is refused and counted: `ambiguous_dates` when only the day/month order is missing, `dates_without_year` when no period settles it. |
| Opening-balance labels for the balance chain | `Opening/Previous/Beginning/Starting balance`, `Balance B/F`, `Brought forward`, `الرصيد الافتتاحي`. | Also `Start balance`, `Opening Bal`, a bare `B/F` and `الرصيد السابق`, and an opening balance of exactly `0.00`. The first row of a split debit/credit table is no longer dropped under those labels. |
| A card statement with a how-to-pay page naming the bank's own account number or IBAN | Refused as `multiple_statement_accounts`. | Pages after the last page carrying a transaction date are left out of the account checks and the statement identity. They hold no rows. Without page boundaries (one text blob) the refusal stands. |
| A second account number on a page that holds rows of a single-card statement | Accepted when it was the only account number, and its rows were filed to the card. | Refused. Only the card's own last four may appear under an account label. |
| A foreign original inside an `Amount in AED` card table (`www*MobileRecharge.com ATLANTA USA 10.14 USD 38.79`) | Refused. | Read as the AED charge, with USD 10.14 carried as the bank-stated original. Only under a table header whose single amount column is the ledger's, and only when the original has exactly its currency's decimals. A figure on both sides of a currency code is refused. |
| A bare minus on a statement that says `Minimum Payment Due` or `Credit Card Statement` but labels the card number `Account Number` (US issuers) | Read under the account convention: a `Payment Thank You -500.00` row became 500.00 spent. | Refused as an ambiguous card sign, as on any other card statement that does not say what its signs mean. |
| A card CSV row typed `Payment` (Chase: Sale / Payment / Return) | A settlement only when its description used payment wording; otherwise plain income. | Always the card settlement on a card export: the `cardPayment` kind when the export names its card, otherwise the transfer-flagged `Card payment` row the app already files outside Income and Spending. Fee, interest and refund wording keeps its own meaning. |

## Where the reconciliation refusal applies

- `/v1/import/pdf`: yes.
- Forwarded email (the `email()` handler and `/v1/email/ingest`): yes, for a
  statement read from the email body and for each PDF attachment. Email
  forwarding is not enabled in production (`EMAIL_DOMAIN` is unset).
- CSV and XLSX: no. Those rows come from named columns, so the flattened-PDF
  failure this guards against (a balance taken for the amount) cannot happen,
  and exports rarely state an opening and closing balance to check against.

## Wire contract

A build turns the new refusals on with a new token in
`x-wafra-import-features` (see `statement-import-server-2026-10-08.md` for the
header rules). This build sends `xlsx,pdf-error-detail,structured,statement-checks`
(`structured` is the OFX/QIF/camt/MT940 token `main` added since).

| Token | Without it (shipped builds) | With it |
| --- | --- | --- |
| `statement-checks` | A statement that does not reconcile, and rows with no year, answer `unsupported_statement_format` (422). The non-reconciling statement is still refused, never imported. | `statement_does_not_reconcile` (422, with `openingMinor`, `closingMinor` and `differenceMinor`) and `dates_without_year` (422). |

The `layout` field rides on `unsupported_statement_format` from
`/v1/import/pdf` whenever the PDF read no rows; older builds ignore it.

App copy (English and Arabic, `src/lib/supplement-copy.ts`):

- `errReconcile`: "This statement’s rows don’t add up to the balances it states, so Wafra won’t import it. Download the CSV export from your bank instead."
- `errDatesNoYear`: "This PDF prints its dates without a year, so Wafra won’t guess it. Download the CSV export from your bank instead."

## Known limits

- A yearless row dated outside the stated period is refused, even when it is
  a card transaction a day or two before the period opened.
- US card PDFs whose payments carry a bare minus and which print no sign
  legend are refused (`ambiguous_card_signs`), not inferred.
- A statement that prints a dated balance line inside its table (ADCB's
  `NEW BALANCE OUTSTANDING`) stays `unknown` rather than proven.
- Yearless lines that carry money but are not transactions (a US daily
  ending-balance table) are still counted as refused rows, so such an import
  reports skipped rows and records no coverage.
- A statement period printed inside a longer line
  (`Statement period 09/01/2026 - 09/30/2026 Page 1 of 2`) is not a period
  line, so its yearless rows are refused (`dates_without_year`).
- A Hijri statement period dates no yearless row.
- Verified with the server suites and fictional PDFs built in the tests. Not
  verified against real customer statements, the live relay or a device.

## Port onto current main — 22 October 2026

The two commits above (`c9609b4d`, `4bd3c11a` on `wip/statement`) were
cherry-picked onto `main` at `cd95a2ba`. Between them `main` had gained OFX/
QIF/camt/MT940 files, PDF column geometry, rejoined wrapped rows, closing
balance snapshots and its own yearless-date reader. Relative to that `main`:

| Area | `main` (`cd95a2ba`) | With this port |
| --- | --- | --- |
| `01/09/2026 CARREFOUR DUBAI 120.00 DR 4,880.00 CR` | Still imported the balance: the six-row fictional PDF in the tests read six income rows, net +67,598.50. | Reads the amounts: net +8,104.50 (120.00 out, 8,000.00 in, 450.00, 230.50 and 95.00 out, 1,000.00 in), merchants without the figure or label. A row whose balance does not step by its amount is refused and counted, and so is the one after it. The proven closing balance is the last row's balance snapshot, as `main` already sends for other balance chains; the same figure twice (`101.75 CR 101.75 CR`) never is. |
| Yearless row dates | Filled from the first date range anywhere in the first 80 lines, only with a known day/month order, with no limit on the period's length and no check for a second period. | Filled only from exactly one explicit period line (the line is nothing but the label and the two dates) spanning at most 12 months, with the order from the file's own dates when it settles it; `main`'s slashed, dashed and dotted forms are kept (a dotted pair needs words after it, and no day or month is zero), and only lines carrying money are dated, as before. The superseded `datedYearlessRows` reader is removed. Rows no period settles are counted as `dates_without_year` (with `statement-checks`) or `ambiguous_dates`. |
| A date-led period line (`September 01, 2026 through September 30, 2026`) | Rejoined as a wrapped row with the lines below it: with a yearless row outside the period (`08/31 EARLY 5.00 DR`) it became one row dated the period's first day, merchant `through September 30, 2026 … EARLY`; with an opening-balance line it became a refused row that broke the balance chain. | Never the start of a wrapped row, and a yearless row is never another row's continuation. A period line is also not counted as a lost row by the reconciliation. |
| Reconciliation, layout fingerprint, opening labels, information pages, `Amount in AED` originals, card-sign markers, card CSV `Payment` rows | Not in `main`. | As described in the tables above, gated by `statement-checks` where they add a refusal code. `parseStatementLines` takes the per-page text as a new sixth argument, after `main`'s PDF layout. |

The scout's fictional sample set (138 file and date-order runs) was re-run
against both builds. 96 runs are unchanged. The others: the UK and US yearless
PDFs (`uk-account`, `uk-long-noyear`, `us-checking`, `us-long-noyear` and two
scratch copies) now import every row with the period's year instead of being
refused, including with no date order chosen when the rows themselves settle
it; full-date UK and US PDFs no longer count the period line as a refused
row, and `uk-account-fulldate` and `us-checking-fulldate` now also read the
row the broken balance chain had dropped (each now 4 of 4); the US card PDF
whose payment carries a bare minus under "Minimum Payment Due" is refused as
`ambiguous_card_signs` rather than `unsupported_statement_format`. No CSV or
Excel sample changed.
