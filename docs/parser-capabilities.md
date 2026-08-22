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

## How new evidence enters the matrix

Wafra’s parser-sample screen prepares a local, redacted JSON file. Wafra uploads nothing; the user chooses Save/Share and can attach that file to a Codex task. A new format is added only with a failing positive test, a conservative parser change, and a paired non-posting or adversarial negative. After the reviewed fixture lands, regenerate this document with `npm run report:parser-capabilities`.

_Generated from `scripts/test/fixtures/uae-bank-formats.js` and `scripts/test/fixtures/saudi-bank-formats.js`._
