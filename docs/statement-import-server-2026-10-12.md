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
| A row printing a marked amount and a marked running balance (`01/09/2026 CARREFOUR 120.00 DR 4,880.00 CR`) | The balance was imported as the amount (a CR balance as income), and the merchant kept `120.00 DR`. | The inner figure is the amount, with its own label, only when the running balance moved from the one before it (an opening-balance line or the previous row in this shape) by exactly that amount in that direction. The same figure under the same label twice (`101.75 CR 101.75 CR`) is that one amount, but never a step and never the start of one, even from a stated zero. Any other row in this shape, including the first one when there is no opening balance, is refused and counted. Not on a card statement, and not under a table header naming an original or foreign amount column without a balance column: there the two marked figures are the original and the charged amount (`SPOTIFY 20.00 DR 73.60 DR`), read at the charge exactly as `main` reads them. |
| Rows that do not add up to the statement's own balances | Imported. | Imported, and still imported when it misses: the check is report-only (see below). It computes a verdict (`proven`, `contradicted`, `unknown`) that stays on the extraction result for diagnostics and keeps the statement's date range out of the coverage record when `contradicted`; it never refuses a statement. The check runs only on a complete read with both an opening and a closing balance stated on short label lines (`Opening`, `Previous`, `Beginning` or `Start balance`, `Brought forward`, `الرصيد الافتتاحي`; `Closing`, `New`, `Ending` or `End balance`, `Total Outstanding`, `Carried forward`, `الرصيد الختامي`), and every reading of each label agreeing (per-page carried-forward balances do not); otherwise the verdict is `unknown`. A value is read only from a line holding exactly one figure: a line naming both balances (`Opening Balance Closing Balance`, `Previous Balance Payments Purchases New Balance`, `Opening Bal 5,000.00 Closing Bal 4,100.00`, `الرصيد الافتتاحي الرصيد الختامي`) anchors neither, and in a stacked box a value counts only under its own label, with nothing but the label's Arabic twin, a bracket or a currency code between them, and not when another bare value sits straight under it. `Current Balance` is not a closing label (an account statement prints it as the balance on the day it was printed). Card or account arithmetic is the parser's own card decision; it is `unknown` where that decision does not rest on the header (a credit card number named only inside a row) or where the header names an account (an account number or IBAN, a debit or mada card, an overdraft) with no minimum payment due or "credit card statement" beside it, and a statement read as an account that prints a card marker (`Credit Limit`, `Minimum Payment Due`) is `unknown` too. On a card, a balance whose only direction is a minus sign (`New Balance -$50.00`) is no anchor unless the statement says a negative balance is a credit balance. Ported by hand from PR #94, with two fixes: the card summary (due) row is not summed, and a payment received onto a card (`cardPayment`) lowers what is owed. |
| A PDF that reads no rows | `unsupported_statement_format` only. | The same code, plus a `layout` fingerprint: row shapes as token classes (`DATE WORD+ MONEY MONEY`) and column labels from a fixed list. No merchant, amount, name or number from the file is ever in it. |
| Row dates printed without a year (US `09/01`, UK `1 Sep`, `Sep 1`) | Refused (`unsupported_statement_format`), and `1 Sep` rows were not even counted. | The year is taken only from one explicit statement-period line in the same file (`September 01, 2026 through September 30, 2026`, `1 September 2026 - 30 September 2026`, `1 Sep - 30 Sep 2026`, `Opening/Closing Date 08/28/26 - 09/27/26`, `Statement period: …`), when the period runs forward for at most 12 months and exactly one year puts the row inside it. A December-to-January period gives each side its own year. Otherwise the row is refused and counted: `ambiguous_dates` when only the day/month order is missing, `dates_without_year` when no period settles it. When the strict reader settles no year, it falls back to `main`'s own reading: the first date range the file prints (its first period line, or a range inside a longer line in its first 80 lines), forward, whatever its length, a row dated only when exactly one year puts it inside that range. |
| Opening-balance labels for the balance chain | `Opening/Previous/Beginning/Starting balance`, `Balance B/F`, `Brought forward`, `الرصيد الافتتاحي`. | Also `Start balance`, `Opening Bal`, a bare `B/F` and `الرصيد السابق`, and an opening balance of exactly `0.00`. The first row of a split debit/credit table is no longer dropped under those labels. |
| A card statement with a how-to-pay page naming the bank's own account number or IBAN | Refused as `multiple_statement_accounts`. | Pages after the last page carrying a transaction date are left out of the account checks and the statement identity. They hold no rows. Without page boundaries (one text blob) such a page cannot be set apart: two or more different account numbers on it still refuse, while a single account number printed after the last row heads no rows and is allowed, as in the next row. |
| One account number beside a single card account (one top-level card number, one summary) | Accepted whenever it was the only account number, including when rows under it belonged to another account and were filed to the card. | Accepted, as on `main`, in text, email and single-page or multi-page PDFs, when it is the card's own last four, the card account's number in the statement header (ADCB: `Account Number 0101234567890` beside `Card Number XXXXXXXXXXXX2280`), that header repeated over a later page beside the card number, or a number printed after the last row (it heads no rows). Refused (`multiple_statement_accounts`) only where a DIFFERENT account-labelled number heads its own dated money rows: printed after the first row, with rows under it before any card section. An account number whose digits equal the header's own card-account number never refuses, wherever it is printed again. Two different account numbers still refuse. |
| A foreign original inside an `Amount in AED` card table (`www*MobileRecharge.com ATLANTA USA 10.14 USD 38.79`) | Refused. | Read as the AED charge, with USD 10.14 carried as the bank-stated original. Only under a table header whose single amount column is the ledger's, and only when the original has exactly its currency's decimals. A figure on both sides of a currency code is refused. |
| A bare minus on a statement that labels `Minimum Payment Due` (with its figure) or titles itself `Credit Card Statement` but labels the card number `Account Number` (US issuers); the same words in a sentence or on a linked card's line are not labels | Read under the account convention: a `Payment Thank You -500.00` row became 500.00 spent. | Refused as an ambiguous card sign, as on any other card statement that does not say what its signs mean. |
| A card CSV row typed `Payment` (Chase: Sale / Payment / Return) | A settlement only when its description used payment wording; otherwise plain income. | Always the card settlement on a card export: the `cardPayment` kind when the export names its card, otherwise the transfer-flagged `Card payment` row the app already files outside Income and Spending. Fee, interest and refund wording keeps its own meaning. |

## Reconciliation is report-only

A statement is never refused because its rows miss its stated balances. A
wrong refusal costs the user a statement `main` imports right, while a wrong
read that slips through is what the verdict is for.

- `/v1/import/pdf`, the forwarded email body and each email PDF attachment:
  the verdict is computed (`extracted.reconciliation`) and reported, never
  acted on. The one effect of `contradicted` is that `/v1/import/pdf` records
  no coverage (`coverage: null`) for that statement: its date range is not
  vouched for.
- CSV and XLSX: no check. Those rows come from named columns, so the
  flattened-PDF failure this guards against (a balance taken for the amount)
  cannot happen, and exports rarely state an opening and closing balance.
- The `statement_does_not_reconcile` code is gone from the relay and from the
  app (contract, copy in both languages, the statement screen).

## Wire contract

A build turns the new refusals on with a new token in
`x-wafra-import-features` (see `statement-import-server-2026-10-08.md` for the
header rules). This build sends `xlsx,pdf-error-detail,structured,statement-checks`
(`structured` is the OFX/QIF/camt/MT940 token `main` added since).

| Token | Without it (shipped builds) | With it |
| --- | --- | --- |
| `statement-checks` | Rows with no year that no period settles answer `unsupported_statement_format` (422). | `dates_without_year` (422). |

The `layout` field rides on `unsupported_statement_format` from
`/v1/import/pdf` whenever the PDF read no rows; older builds ignore it.

App copy (English and Arabic, `src/lib/supplement-copy.ts`):

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
  (`Statement period 09/01/2026 - 09/30/2026 Page 1 of 2`) is read as `main`
  reads it, as the first range of the first 80 lines, but never from a row's
  own text.
- A Hijri statement period dates no yearless row.
- On a card statement a row printing an amount and a marked running balance
  (`AMAZON 50.00 DR 1,050.00 DR`) is read as `main` reads it, at its last
  figure, because a card table's two marked figures are far more often the
  original and the charged amount. Its stated balances then report that read
  as `contradicted`; the statement is imported either way, as `main` does.
- On an account statement whose two marked figures are an original and a
  charged amount but whose header does not say so, a row is refused and
  counted wherever the chain cannot prove its second figure a balance.
- Beside a single card account, only a different account-labelled number that
  heads dated money rows of its own refuses (`multiple_statement_accounts`);
  the number the header prints, repeated anywhere, never does.
- The reconciliation is `unknown`, not proven, for summaries that pair labels
  and values by position, `Current Balance` headers, card minus balances with
  no legend, and statements whose header names both a card and an account.
  It never refuses anything; it proves less.
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
| Yearless row dates | Filled from the first date range anywhere in the first 80 lines, only with a known day/month order, with no limit on the period's length and no check for a second period. | Filled only from exactly one explicit period line (the line is nothing but the label and the two dates) spanning at most 12 months, with the order from the file's own dates when it settles it; `main`'s slashed, dashed and dotted forms are kept (a dotted pair needs words after it, and no day or month is zero), and only lines carrying money are dated, as before. Only in a file that prints no full-dated money row: in a full-dated statement a yearless-led line (`12/09 004512 9.99 940.01`) is a wrapped description's continuation and is read exactly as `main` reads it, where `main` would have dated it 12 September as a row of its own. The superseded `datedYearlessRows` reader is removed, and its reading survives as the fallback: when the strict reader settles no year, the first date range the file prints (first 80 lines, forward, any length) dates a row that exactly one year puts inside it. Only a full-dated line that looks like a transaction (a description under its date, money on it, inside the period when one is stated) counts as the file printing full dates; a payment coupon's `10/25/26 $1,234.56 $35.00` does not. Rows no period settles are counted as `dates_without_year` (with `statement-checks`) or `ambiguous_dates`. |
| A date-led period line (`September 01, 2026 through September 30, 2026`) | Rejoined as a wrapped row with the lines below it: with a yearless row outside the period (`08/31 EARLY 5.00 DR`) it became one row dated the period's first day, merchant `through September 30, 2026 … EARLY`; with an opening-balance line it became a refused row that broke the balance chain. | Never the start of a wrapped row, and in a file of yearless rows a yearless row is never another row's continuation. A period line is also not counted as a lost row by the reconciliation. |
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

### Review fixes — 23 October 2026

An independent review of the port against `main` found five places where it
refused, or misread, a statement `main` reads correctly. Each is fixed and has
its own fictional tests (section 8 of `server/test/statement-checks.test.cjs`):

1. A short line naming both an opening and a closing label anchored both to
   its last figure, so every such statement with any movement was refused as
   not reconciling. It now anchors neither (see the reconciliation row
   above), and the stacked-down-the-page form of the same summary is held to
   the same rule. For the same reason a header `Current Balance` (the balance
   on the day the statement was printed) is no longer a closing label.
2. The card-or-account arithmetic was a second opinion (`isCardStatement`)
   that could disagree with how the rows were read: a card proven by its
   `Credit Card Number` alone was checked as an account, and an account with
   a `Debit Card Number` beside a `Statement Date` (or an overdraft `Credit
   Limit` beside a `Statement Period`) as a card. It is now the parser's own
   decision, `unknown` where the statement says both, and `unknown` for a
   statement read as an account that prints a single card marker.
3. A card's minus balance (`New Balance -$50.00`, an overpaid card) was read
   as money owed. It is no anchor unless the statement's own legend says a
   negative balance is a credit balance.
4. A single card account with the card account's number in its header was
   refused as `multiple_statement_accounts`, in text, email and single-page
   PDFs. It imports as on `main`; only an account number heading rows of its
   own refuses (see the table above).
5. On card tables printing a marked original and a marked charged amount, the
   marked-balance reader refused every FX or VAT row, and a same-figure row
   could start a chain that filed a later charge at its original figure
   (Spotify 20.00 instead of 73.60). That reader is now off on card
   statements and under a header naming an original amount column, and a
   same-figure row never starts or continues a chain.

The scout's sample set gives the same result with these fixes as with the port
before them (all 138 file and date-order runs unchanged).

### Simplification — 23 October 2026

A second review found the port still refused, or misread, statements `main`
reads right. Four changes make it refuse less (`server/test/statement-checks.test.cjs`
sections 8.6 and 8.7, `server/test/import-routes.test.cjs`):

1. **Reconciliation is report-only.** The 422 `statement_does_not_reconcile`
   is removed from `/v1/import/pdf`, the email body path and the email
   attachment path, and from the app contract and copy. The verdict stays on
   the extraction result; a `contradicted` one only withholds coverage.
2. **Yearless dates fall back to `main`'s reading** when the strict reader
   (one explicit period line, no full-dated money line) settles no year: the
   first date range in the first 80 lines, with a known day/month order, a row
   inside the period. Only full-dated lines that look like transactions count
   as the file printing full dates. A Hijri range still dates nothing.
3. **`multiple_statement_accounts`**: an account number equal to the header's
   own card-account number never refuses; only a different account-labelled
   number heading its own dated money rows does.
4. **The card-only marker is a label**: a short line led by `Minimum Payment
   Due`/`Minimum Amount Due` with a figure, or a title line `Credit Card
   Statement`, never a sentence mentioning them or a linked card's line.
   Together with the page-break rule (a balance printed between two rows is a
   running balance at the break, never an anchor) and card or account
   arithmetic needing positive evidence of its own, the verdict is `unknown`
   wherever it is not certain.

Checked against `main` (80 fictional cases in the review harness): rows are
identical to `main` in all but three. `newest-first marked` and `S2 ADCB FX
figure-first` are layouts `main` misreads (a balance taken for the amount;
two FX rows lost), and a card CSV row typed `Payment` is the card settlement
here (`ACH PMT`, not income). The running-balance fix still nets +8,104.50.
