# Statement export formats: evidence and scoring — 11 October 2026

This records which real bank export layouts the statement importer
(`server/src/imports.ts`) reads, how that was measured, and what changed. It
is not certification of any bank: each layout was scored with a few fictional
rows in that bank's published layout, not with a customer's real statement.
Nothing here was deployed.

## Evidence

142 export layouts were recorded: 21 countries plus 9 accounting-tool import
or export formats (YNAB, Mint, Actual Budget, QuickBooks, FreeAgent, Monefy).
They come from about 83 banks and apps: 102 CSV, 17 Excel and 23 PDF layouts.

| Region | Institutions recorded |
| --- | --- |
| UAE | Emirates NBD, ADCB, Mashreq, RAKBANK, Emirates Islamic, FAB |
| Saudi Arabia | Al Rajhi, Bank AlJazira, STC Bank, Riyad Bank, SNB |
| UK / Ireland | Monzo, Starling, Revolut, Wise, Barclays, HSBC UK, Lloyds/Halifax, Nationwide, NatWest/RBS/Ulster, Amex UK, Chase UK, Bank of Ireland |
| US | Chase, Bank of America, Wells Fargo, Amex, Capital One, Citi, Discover, Apple Card |
| Germany | N26, ING, DKB, Sparkasse (CAMT and MT940 CSV, card), comdirect, Commerzbank, Postbank, Deutsche Bank |
| Netherlands | ING, Rabobank, bunq, ABN AMRO |
| France / Spain / Italy | Société Générale, Crédit Agricole, Boursorama, La Banque Postale, N26 FR/ES, BBVA, CaixaBank, Intesa Sanpaolo, Fineco, BancoPosta |
| India | HDFC, ICICI, SBI, Axis, Kotak |
| Elsewhere | Akbank (TR), OCBC, UOB, POSB (SG), Nubank, Inter, Itaú (BR), RBC, TD, Scotiabank, Simplii (CA), CommBank, NAB, ING (AU), Westpac, ANZ (NZ), FNB, Investec (ZA), Banco Nación (AR), Bancolombia (CO), HSBC México |

Sources were open-source importer fixtures and configurations (beancount,
hledger, Firefly III import-configurations, bank2ynab, ofxstatement plugins
and similar), plus accounting-tool help pages. No bank help page gave exact
column text. Each record keeps its source URL and licence. GPL, AGPL and
unlicensed sources were used for layout facts only; no code or data was
copied. 73 records are high confidence, meaning the exact header text was seen
in the source. 49 are medium and 20 are low (reconstructed from a parser's
column roles).

The research files are kept outside the repository, in
`.worktrees/statement-research/`:

- `formats.jsonl`: the records.
- `SCHEMA.md`: the record format.
- `score-statements.cjs`: the harness.
- `score-before.txt` and `score-after.txt`: the scores.

## How layouts were scored

`score-statements.cjs` turns each record into a file and runs the shipping code
in-process:

- **CSV:** bytes in the record's encoding and delimiter, through `decodeCsv`
  and `parseStatementCsv`.
- **Excel:** a real `.xlsx`, through `parseStatementXlsx`.
- **PDF:** the record's flattened text lines, through `parseStatementLines`.
  This approximates pdf.js extraction; it is not the same thing.

The ledger currency and the `x-wafra-date-order` hint are what a user in that
country sends. Every accepted row is compared with the record's labels (date,
amount, direction). A row that has the right amount and direction but uses
another date column of the same source row counts as correct, and is reported
separately.

### Results by country

| Country | Layouts (csv/xlsx/pdf) | Pass before → after | Wrong direction before → after | Rows correct before → after |
| --- | --- | --- | --- | --- |
| DE | 18 (18/0/0) | 0 → 10 | 0 → 0 | 0/49 → 39/49 |
| AE | 16 (2/6/8) | 2 → 4 | 3 → 0 | 11/47 → 17/47 |
| GB | 13 (13/0/0) | 6 → 10 | 0 → 0 | 20/38 → 31/38 |
| US | 13 (13/0/0) | 6 → 8 | 1 → 0 | 19/38 → 26/38 |
| IN | 13 (3/2/8) | 1 → 3 | 0 → 0 | 3/36 → 9/36 |
| NL | 12 (12/0/0) | 0 → 9 | 0 → 0 | 3/34 → 28/34 |
| Accounting tools | 9 (9/0/0) | 3 → 5 | 0 → 0 | 9/27 → 19/27 |
| SA | 8 (1/1/6) | 2 → 2 | 0 → 0 | 8/24 → 8/24 |
| IE, NZ, ZA (2 each) | 6 (6/0/0) | 2 → 6 | 0 → 0 | 6/18 → 18/18 |
| FR | 6 (6/0/0) | 0 → 5 | 0 → 0 | 0/18 → 17/18 |
| SG | 5 (3/2/0) | 0 → 2 | 0 → 0 | 0/14 → 5/14 |
| ES | 4 (1/3/0) | 0 → 2 | 0 → 0 | 0/12 → 6/12 |
| IT | 4 (1/3/0) | 0 → 1 | 0 → 0 | 0/11 → 5/11 |
| BR | 4 (4/0/0) | 0 → 2 | 0 → 0 | 0/12 → 6/12 |
| CA | 4 (4/0/0) | 0 → 0 | 0 → 0 | 0/12 → 0/12 |
| TR, AR, CO, MX (1 each) | 4 (3/0/1) | 0 → 1 | 0 → 0 | 0/12 → 5/12 |
| AU | 3 (3/0/0) | 0 → 0 | 0 → 0 | 1/9 → 1/9 |
| **All** | 142 | **22 → 70** | **4 → 0** | **80/411 → 240/411** |

Each record holds two or three sample rows, which understates a few
layouts:

- **Debit/credit columns with their own sign** (Mashreq, Postbank, Deutsche
  Bank, ING Australia, Fineco). The sign is read only once a column shows it
  on at least three clean figures, and the samples hold fewer. Tests with
  full-month files read these layouts.
- **Short PDF records** (Bank AlJazira). The running-balance chain needs four
  reconciling steps.

The remaining 72 layouts break down as follows:

- **24 partial.** The unread rows are deliberate refusals:
  - plain credits the file never proves (no balance column, own-account
    column or income wording);
  - pending or unposted rows;
  - foreign-currency rows;
  - a negative figure in a credit column;
  - the sample-size effect described above.
- **25 refused.** 20 are PDF layouts (see below). The other 5 are:
  - Discover and the American Express detail export, refused deliberately
    for their ambiguous signs;
  - Mashreq's account Excel layout, whose 2-row sample is below the
    three-figure sign rule;
  - Simplii, whose numeric dates are ambiguous for Canada;
  - the YNAB 4 export, whose amounts carry a dinar symbol.
- **14 unrecognised:**
  - headerless CSVs: HSBC UK, Wells Fargo, CommBank, NAB, TD, Scotiabank,
    Itaú, HSBC México, ABN AMRO TXT, FreeAgent, POSB;
  - Wise, which has two amount columns;
  - RBC, which has per-currency amount columns;
  - the Nubank card export (`date,title,amount`), which has no recognised
    description column.
- **9 unreadable file type:** the bank's own file is a legacy `.xls` (UOB,
  HDFC, ICICI, CaixaBank, Fineco card) or SpreadsheetML 2003 (Emirates NBD).
  The service opens CSV/TSV and `.xlsx` only, and the app uploads only those.

## Changes (server/src/imports.ts)

Each change has a test in `server/test/statement-formats.test.cjs` that uses
the exact header layout and fictional values. Against the original code, 49 of
its 61 checks fail (the other 12 guard behaviour that must not change).

1. **Column headers:**
   - Recognised in German, Dutch, French, Spanish, Catalan, Portuguese and
     Italian, from the exact export text listed above.
   - Turkish and Indonesian standard statement words are also recognised.
     No bank CSV backs them yet.
   - More English variants: Payee, Outflow/Inflow, Funds Out/In, Counter
     Party, Trans. Date, Tran Date, Post Date, Completed Date, Cr/Dr,
     Withdrawal/Deposit Amt., Transaction Remarks, DR/CR columns.
   - NatWest's `Value` is an amount only when no other column is one.
   - `State` is a status column only when its cells are status words
     (Revolut). A US address `State` column is left alone.
   - CamelCase names are split.
2. **Currency in a header:** `Amount (GBP)`, `Betrag (€)`, `Paid in (£)`,
   `Amount in AED`, `Withdrawal Amount (INR )` and `Débit euros` are read as
   the plain column.
   - The named currency is checked on money columns. A code, or a money
     symbol that cannot name the ledger's currency, refuses the file with
     `statement_currency_mismatch`.
   - Examples: `Debit ($)` on a EUR ledger, `Amount (₹)` on an AED ledger.
3. **Direction and type columns:**
   - A column whose cells are directions (Dr/Cr, Af/Bij, Debit/credit) is
     preferred over a transaction-type column.
   - If the type cell also names a direction and disagrees, the row is
     refused.
   - Two type columns, or two direction columns, still refuse the file.
4. **Several currency columns** (ING Germany, BBVA): each row must name one
   currency in all of them. Otherwise the row is refused.
5. **Signs inside debit/credit columns:**
   - A sign is read as the column's own convention only when every figure
     in that column carries it: a minus throughout Soll (Postbank, Deutsche
     Bank, Mashreq, Fineco), or a plus throughout Credit (Mashreq).
   - The column must also show it on at least three figures, none of them
     described as a reversal (storno, reversal, refund, Rückbuchung …).
   - The mirrored column then needs only one figure, so a single + salary
     credit beside the - debits reads.
   - A minus on only some debit rows is a reversal, and is refused.
   - A minus in a credit column (Citi) contradicts the column, and is
     refused.
6. **Plain credits in signed files:**
   - New proof that plain figures are credits:
     - an own-account column filled on every row. Only the German and Dutch
       own-account names count (Sparkasse Auftragskonto, Rabobank IBAN/BBAN,
       Rekening), because card exports print an English `Account Number`
       too;
     - multilingual balance
       headers (Saldo, Solde, Kontostand, Bakiye, Disponible);
     - money-in wording in the description or type cell (Gehalt,
       Gutschrift, VIR RECU, nómina, recebido, stipendio, salaris …).
   - A signed file with no plus anywhere, where every minus row is a
     payment, return or credit (Discover, Apple Card), fits both an account
     and a card reading. Its bare signs are now refused (`ambiguous_card_signs`)
     instead of being filed as spending.
   - A `Card Member` or `Card Holder Name` column marks a card export
     (American Express).
7. **Dates:**
   - A clock time after the date is ignored (ADCB, Revolut, comdirect).
   - Year-first dates with slashes or dots (`2026/09/01`) are read.
   - Compact `20260901` dates are read (ING NL, Rabobank card); impossible
     dates are refused.
   - Value-date columns rank below every booking-date name. Dutch and
     Italian `Valuta` is a currency column.
8. **File layout:**
   - Up to 20 rows may precede the header; this was 10. ING Germany prints
     14 and Mashreq 11.
   - Blank padding cells past the header width are ignored (ADCB).
   - Tabs and line breaks inside a quoted description are whitespace
     (Barclays, Crédit Agricole).
   - A trailing currency symbol is read (`-10,80 €`, DKB).
   - Status words Gebucht, Contabilizzato, Liquidat, Booked and similar
     establish a posted row.
   - Opening and closing balance rows are not transactions in Italian,
     Spanish, Portuguese, French, German, Dutch, Turkish and Indonesian
     (SALDO INIZIALE/FINALE, ancien/nouveau solde, Anfangssaldo, beginsaldo,
     devir bakiye, saldo awal …).
9. **Rupee lakh grouping** (`1,85,000.00`) is read only in an INR ledger.
10. **PDF safety:**
    - **Signed figure before a labelled balance.** ENBD prints
      `-1250.00 3341.06 Cr`. This used to import the balance as a 3,341.06
      credit; it now goes through the balance chain or is refused.
    - **Direction label inside the description.** RAKBANK prints
      `AED 1,000.00 CR - 125.50`, which used to import the 125.50 balance as
      a credit. The row is now refused.
    - **Running balance contradicts a debit/credit/balance row.**
      - This happens when a headerless table is read with the Debit-first
        default but prints Credit first (Emirates Islamic layout).
      - The contradicted row is refused.
      - If no step confirms the assumed order, every row read through it is
        refused, including a first row that had nothing to check against.
      - A table whose header names the order is not affected. A newest-first
        headerless table can be refused this way by coincidence, which is
        the safe side.
    - **Signed figure that contradicts its own DR/CR label.** It is no longer
      filed by the label.
    - **Short card reference under a payment row.** Bank AlJazira prints
      `Card 123456789` there. It is no longer a second statement account,
      which used to refuse the whole statement. A second labelled account
      number still refuses it.

The deep-preamble test in `server/test/imports.test.cjs` moved from 11 to 21
leading rows to follow the new limit.

An independent review of the change found several problems. Each is fixed and
has a regression test (`review 1` to `review 9`):

- **Wrong direction:**
  - an English account column on a card export made its charges income;
  - a debit column holding only reversals was read as a sign convention.
- **Over-refusal:**
  - `Paid in (£)` was not recognised;
  - descriptions ending in CREDIT or DEBIT were refused.
- **Gaps:**
  - currency symbols other than € and £ were unchecked;
  - a first row in a swapped table was still read;
  - a sign contradicting its label was ignored;
  - a type column contradicting Dr/Cr was ignored;
  - `State` and `Value` columns collided with other columns.

## What still fails, and what is needed

- **Saudi PDFs:**
  - Al Rajhi's e-statement puts the description on the line before the
    dated amounts.
  - STC Bank's grid flattens right-to-left, with the date last.
  - The long-form Al Rajhi statement carries Hijri and YYMMDD dates.
  - These layouts are reconstructed from third-party parsers, not from
    pdf.js output. Changing the parser to fit them without a real file would
    be guessing.
  - No public evidence at all was found for SAB, Alinma, ANB, Banque Saudi
    Fransi, Bank Albilad or D360.
- **UAE:**
  - No export evidence was found for ADIB, DIB, Wio, Liv, CBD, HSBC UAE or
    Citi UAE.
  - The FAB and Emirates Islamic account layouts are low confidence.
  - Emirates NBD's Excel download is SpreadsheetML 2003 and cannot be read.
- **Rest of the GCC, Egypt and Jordan** (NBK, KFH, QNB, CBQ, Bank Muscat,
  NBB, BBK, Arab Bank, CIB, NBE, Banque Misr): no export evidence was found.
- **Legacy `.xls` and SpreadsheetML:**
  - Reading these needs a new server reader and an app picker change behind
    an import-features token.
  - This affects Emirates NBD, HDFC, ICICI, UOB and CaixaBank.
- **Known residuals (from the re-review):**
  - A Discover-style card file with one negative return that has no wording
    is still read as an account, so its "PAYMENT - THANK YOU -300" row is
    filed as spending. The original code does the same.
  - A file with both `Status` and `State` columns is refused.
  - A headerless newest-first PDF table with two equal consecutive amounts
    is refused.
- **Headerless CSVs** stay refused. Reading them would mean assigning columns
  by position.
- **Not covered by these scores:** a row's account ownership. N26's
  `Account number` is the counterparty's IBAN but matches the English
  own-account alias. It is not used when it varies from row to row, but a
  file with only one counterparty IBAN would be attributed to it. This was
  not changed here.

Real, redacted exports from the owner's own accounts are needed to go further.
The most valuable are UAE and Saudi PDFs (Al Rajhi, SNB, Riyad, Alinma, STC
Bank, FAB, ADIB, DIB, Wio, Liv), plus an Emirates NBD Excel download.
