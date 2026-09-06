# Global parsing and categorization — round 2

Implemented 5 September 2026. This batch fixes the observed amount, statement,
date, merchant, language and categorization gaps. The core remains independent
of an AE/SA selection. Currency, date-order and missing-year ambiguity are
preserved; no automatic-import eligibility or public event shape was broadened.

## Results that can be claimed

| Evidence group | Before this batch | Final exact cases |
| --- | ---: | ---: |
| Existing independent parser corpus | 10/36 | 36/36 |
| Existing independent category corpus | 13/15 | 15/15 |
| Public provider examples/excerpts | 4/8 | 8/8 |
| Related currency/format variants | 180/180 | 180/180 |
| New synthetic parser set, first unseen execution | 2/24 | 24/24 after exposure and fixes |
| New synthetic category set, first unseen execution | 4/8 | 8/8 after exposure and fixes |

The final 24/24 and 8/8 are **regression results after using the cases to improve
the implementation**. They are not held-out accuracy results. The poor first
unseen result remains important evidence that additional unfamiliar wording
will need work. Do not describe these numbers as worldwide accuracy or claim
every language/bank is supported.

Each exact case matches all asserted fields, not every possible field. The
180 variants share one English purchase/balance structure and are reported
separately. The public group includes seven directly inspected provider
templates/excerpts and one lower-confidence official search-index excerpt;
none is a collected customer inbox. The new set is independently authored
synthetic text across 12 languages, without native-speaker validation.

## What changed

- **Monetary roles:** exact numbers already recognized in Turkish, Hindi,
  Japanese and Chinese are now assigned to purchases or balances instead of
  becoming competing unknown amounts. French, Spanish, Hindi and Arabic
  statements distinguish totals from minimum payments. Three-digit decimal
  versus grouping ambiguity remains visible. Aggregated monthly spending
  cannot replace a purchase amount.
- **Token boundaries:** documented KSh/Ksh spelling is recognized through the
  existing unique currency mapping. A bounded Japanese ISO-money/particle
  form reuses the exact money parser and preserves source spans; embedded IDs
  and malformed numeric tails remain excluded. The field prepass and monetary
  extractor now use the same candidate helper.
- **Merchants and dates:** more source-language seller/supplier forms and
  deadline labels work. Account footers, rejection words, unpaid/future
  qualifiers, support instructions, numeric IDs, generic document descriptions
  and overlong partial names do not become sellers. Missing, invalid,
  conflicting, yearless and ambiguous-order dates remain unresolved.
- **Meaning and direction:** completed purchases, refunds and transfers use
  source predicates with negation, future, conditional and question checks.
  Opposing debit/credit evidence stays unresolved. Missing money is not
  invented even when a completed event is clearly described.
- **Multiple movements:** more than one independently owned principal amount
  requires a split adapter and cannot be confirmed as one transaction. A
  single amount with alternative currency/decimal interpretations remains
  explicitly selectable. Statements and balances retain their own roles.
- **Categorization:** additional Hindi grocery, Turkish pharmacy/telecom,
  Portuguese salon and Dutch water-provider words work globally. No category
  IDs changed. Manual choices and directional merchant rules keep priority;
  known refunds remain deliberately neutral rather than becoming income
  categories based on the merchant name.

## Posting safety

The existing 17 non-posting challenges remain recognized and refused. The new
set initially had five cases that could reach a ready plan after an explicit
but mistaken completed-transaction confirmation. All ten non-posting cases in
that set now refuse promotion. Seven retain selectable source money; three
have no ordinary transaction amount, so those three do not establish a tested
amount-confirmation path.

These checks exercise source extraction and the real confirmed-import planner.
They did not observe automatic postings or commit those negative examples.
The 21 pipeline checks separately verify positive text-to-confirmed-ledger
materialization, serialization, category persistence, duplicate refusal and
currency mismatch. Simulated user entries for otherwise missing dates or titles
are explicitly labelled in the tests, never described as extraction successes.

## Validation

The subsequent [app review-flow verification](app-verification.md) records
**14/14 browser acceptance scenarios** on a fresh export, with exact parser
source hashes rechecked. Native behavioral checks were reported separately;
browser results are not represented as physical-device results.

- Round-2 focused suites: **424 checks, 7/7 suites passed**.
- Existing universal suites: **323 checks, 6/6 suites passed**.
- Prior evidence/evaluator regressions: **72/72 passed**.
- Strict no-emit TypeScript across the five changed modules: **0 diagnostics**.
- Scoped ESLint and whitespace checks passed.
- Independent reviewers reproduced and cleared the reported field and semantic
  defects. Writing workers reviewed different modules from those they edited.

The numerical sums count assertions/cases in overlapping regression suites;
they are not independent samples of bank coverage. Native app flow validation
is coordinated with the integration task, which owns capture, review UI,
store, device QA and release builds. This document does not claim an unobserved
device result. Final source hashes and check counts are in final-freeze.json.

## Reproduce

Run from the repository root:

```sh
node scripts/universal-evidence-round2/run.cjs
node scripts/universal-test/run.cjs
node --test scripts/universal-evidence/evaluator.test.cjs scripts/universal-evidence/nonposting-regressions.test.cjs scripts/universal-evidence/money-regressions.test.cjs
node scripts/universal-evidence/evaluate.cjs --output /tmp/wafra-known-evidence.json
node scripts/universal-evidence-round2/evaluate-holdout.cjs after
```

The first unseen execution is immutable; running the evaluator with `first`
again deliberately refuses to overwrite it. The `after` command records a
new execution against the now-exposed cases. Both evaluators exit nonzero if
an asserted expectation or safety check fails.

## Provenance and oracle changes

- Initial old-corpus output: baseline.json.
- Implementation hashes frozen **before** reading/running new cases:
  pre-holdout-freeze.json.
- Original first unseen outputs and source hashes: holdout-first.json.
- Final outputs: known-after.json and holdout-after.json.
- Original new-corpus SHA256:
  `8ea029e618d67596370076a89c677300a587ec8b259df6d2867a3e0988b82539`.
- Frozen original inputs: scripts/universal-evidence-round2/holdout.json.

The independent corpus author reviewed four contract-level expectations without
reading parser output or production code. Explicit temporary authorization,
an unexecuted request, and a multi-event aggregate are informational rather
than unknown; a known refund is confidently neutral Other under the existing
category contract. These changes are separate in adjudications.json and do
not modify the original corpus or first-run output. All other expectations
remain unchanged. Regrading the first category outputs under that contract
gives 5/8, not the original raw 4/8; neither is the final 8/8 regression result.

Public source provenance remains in the preceding round's
[report](../universal-coverage-2026-09-05/README.md) and
scripts/universal-evidence/public-cases.json. No private SMS data, credentials,
analytics upload, cloud model or bank connection was introduced.

## Remaining limits

This remains a deterministic, evidence-based parser with finite language
coverage. Many untested phrasings, real bank delivery formats, mixed documents,
reference systems, language variants and ambiguous merchant activities remain
outside this sample. New independently collected, consented and redacted
examples are needed before broader coverage claims. Keep a genuinely unseen
evaluation set for each future release; once an example drives a fix, move it
to regression evidence and retain its original first-run result.
