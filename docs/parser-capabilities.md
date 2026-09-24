# Bank-alert parser capability evidence

Manual tracking is available regardless of country or ledger currency. Automatic bank-alert import is not worldwide bank coverage: it varies by country, institution, alert language, and exact message format.

This matrix reports only public-redacted or repository-redacted acceptance fixtures that are exercised by the automated parser suite. Synthetic and reconstructed grammar probes are excluded. A row means the listed format specimens pass; it does not claim every alert from that institution works. There is deliberately no single parser coverage percentage.

| Market | Institution | Alert language evidence | Event-family evidence | Passing redacted formats | Evidence source |
| --- | --- | --- | --- | ---: | --- |
| AE | ADCB | English | expense transaction | 1 | repository redacted |
| AE | ADIB | English | expense transaction | 1 | public redacted |
| AE | ENBD | English | expense transaction | 1 | repository redacted |
| AE | FAB | English | expense transaction, income transaction | 2 | repository redacted |
| AE | Liv | English | expense transaction | 1 | repository redacted |
| AE | Mashreq | English | expense transaction | 1 | public redacted |
| AE | Wio | English | expense transaction | 1 | public redacted |
| SA | Bank Albilad | Arabic | expense transaction | 2 | public redacted |

## Country conventions

The user's country (any ISO 3166-1 country, defaulting from the device Region and changeable in onboarding and Settings) is separate from the parser market pack. Only AE and SA have launch-tested packs with bank registries; every other country uses the neutral pack and the review-first worldwide parser. Choosing a country never adds institution coverage.

- Numeric dates: an ambiguous date such as 03/04/2026 is read month-first for the United States, its territories and the Philippines, year-first countries are left undecided, Canada and countries whose banks print local-calendar dates are left undecided, and every other country reads day-first. An unknown country (`ZZ`) refuses ambiguous dates rather than guessing. A file's own evidence (a field above 12) always wins over the country.
- Statements (PDF, CSV, forwarded email): amounts are parsed in decimal-comma form (`1.234,56`, `1 234,56` in a CSV cell or with a no-break space in a PDF) only when the file's own figures prove that convention and none contradicts it; apostrophe grouping (`1'234.56`) is read in decimal-point files. Named-month dates are read in English, French, German, Spanish, Portuguese, Italian, Dutch, Turkish, Indonesian and Arabic. Column headers are still recognised in English and Arabic only.
- Forwarded statement emails are read in the ledger currency recorded when the forwarding address was created; an address created by an older build keeps the launch AED/SAR reading.

## How new evidence enters the matrix

Wafra’s parser-sample screen prepares a local, redacted JSON file. Wafra uploads nothing; the user chooses Save/Share and can attach that file to a Codex task. A new format is added only with a failing positive test, a conservative parser change, and a paired non-posting or adversarial negative. After the reviewed fixture lands, regenerate this document with `npm run report:parser-capabilities`.

_Generated from `scripts/test/fixtures/uae-bank-formats.js` and `scripts/test/fixtures/saudi-bank-formats.js`._
