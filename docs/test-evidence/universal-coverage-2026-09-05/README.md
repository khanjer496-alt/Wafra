# Global parser evidence — 5 September 2026

The architecture accepts bank-independent review, but this evaluation does **not** establish universal automatic accuracy. It found a wrong transaction amount in an official published example and confirmation paths that accepted explicit non-posting messages. The bounded fixes address those errors. Substantial extraction gaps remain.

## Evidence and sampling

- 8 public templates/excerpts from 8 providers across 6 countries/territories. Seven were inspected directly by the author/researcher as a page, PDF, or image; the Kenyan excerpt is search-index-only and is reported separately.
- 36 independently authored synthetic parser challenges and 15 category challenges, written without reading implementation or prior tests, spanning 12 languages. These are not customer messages and have not been validated by native speakers or the named banks.
- 180 related format tests: one English purchase/balance structure × 30 currencies × 6 formatting variants. These measure numerical/normalization behavior. They do not count as 180 independent bank formats. Six KWD cases test preservation of decimal/grouping ambiguity.
- No production inbox was accessed, no real-customer messages were collected, and no bank delivery/import/device flow was exercised in this workstream. Public publication does not establish current bank delivery wording. This convenience/adversarial sample is not statistically representative, so no worldwide accuracy percentage or confidence interval is justified.

## Results

Baseline source execution: 2026-09-05T13:36:32.099Z. Final source execution: 2026-09-05T13:55:58.408Z. Both capture source hashes. Baseline outputs were regraded with the same reviewed expectations as the final run; old source was not re-executed. The initial unreviewed baseline and original expectations remain intact.

“Exact” means every asserted field and applicable safety check matched; fields not asserted are not validated. Abstentions are missing/unknown facts, including missing alternatives; incorrect fields are non-abstaining mismatches. A correct field elsewhere does not erase an error. Category review flags accompany category outcomes and are not independent examples.

| Group | Cases | Baseline exact | After fixes exact | After abstained fields | After incorrect fields |
| --- | ---: | ---: | ---: | ---: | ---: |
| public-template/parser | 6 | 2 | 3 | 5 | 0 |
| public-template-excerpt/parser | 1 | 1 | 1 | 0 | 0 |
| public-indexed-excerpt/parser | 1 | 0 | 0 | 2 | 0 |
| synthetic-independent/parser | 36 | 8 | 10 | 61 | 3 |
| synthetic-independent/categorization | 15 | 13 | 13 | 4 | 0 |
| synthetic-structural/parser | 180 | 180 | 180 | 0 | 0 |

Do not combine these groups into a headline success rate: the closely related format variants dominate the denominator.

## Posting safety

Of 17 actual non-posting challenges, 11 previously reached a ready import plan after an adversarial explicit “posted” confirmation; now 0 do. These were **explicit-confirmation paths, not observed automatic imports**.

The final parser recognizes all 17 as non-posting and all 17 plans refuse on a source-status/family guard. 6 sources have no selectable transaction amount (including statements/balances); their refusal is not evidence of a successfully exercised amount-confirmation path. 11 still have grounded transaction money and are refused despite otherwise supplied confirmation choices. No record was committed during this evaluation.

## What was fixed

- The official CommBank example contains a purchase of 15 and a month-to-date category total of 40. The transaction amount is now 15; the aggregate remains an observation and cannot displace it. The remaining unknown posting status is honestly counted as a coverage abstention.
- Source-level numeric authorization, direct declines, renewal notices, bill obligations, and a Spanish statement header now restrict posting even when a local amount clause is unfamiliar. Complete predicates and conditional/advice checks avoid interpreting merchant names or help footers as failures.
- Independent review added regressions for a decline before/after the purchase sentence, German decimal points, bare “Total spent” transactions, conditional renewal advice, and numeric password advice after a completed purchase.

Only universal-money.ts and universal-parser.ts were changed in production by this workstream. The confirmed-import adapter and shared app integration remain owned by the integration task. Fixes do not broaden automatic import eligibility or infer unknown posting status.

## Remaining failures

These stay visible and keep the evaluation command nonzero. Examples include Thai merchant/status extraction, the Kenyan attached currency spelling, multilingual paid/refund wording and balances, bill dates, statement total/minimum roles, and merchant text contaminated by an account footer or rejection word. Turkish pharmacy and Hindi grocery category descriptions currently abstain. The broader same-format test success does not cancel these gaps.

- **public-au-commbank-spend**: status (abstention), direction (abstention).
- **public-th-kbank-purchase**: merchant.value (abstention).
- **public-th-bangkok-credit**: status (abstention), direction (abstention).
- **public-ke-safaricom-bundle**: amount.value (abstention), direction (abstention).
- **ind-en-ca-refund**: merchant.value (incorrect).
- **ind-fr-fr-purchase**: direction (abstention).
- **ind-fr-be-utility-bill**: dueDate.value (abstention).
- **ind-fr-ch-refund**: status (abstention), direction (abstention), merchant.value (abstention).
- **ind-de-de-purchase**: status (abstention), direction (abstention).
- **ind-de-at-decline**: merchant.value (incorrect).
- **ind-de-de-subscription-paid**: status (abstention), direction (abstention), merchant.value (abstention).
- **ind-es-es-purchase**: status (abstention), direction (abstention).
- **ind-es-mx-statement**: statementTotal.value (abstention), minimumDue.value (abstention), dueDate.value (abstention).
- **ind-es-cl-refund-zero-decimal**: status (abstention), direction (abstention), merchant.value (abstention).
- **ind-pt-br-purchase**: status (abstention), direction (abstention), merchant.value (abstention).
- **ind-it-it-purchase**: status (abstention), direction (abstention).
- **ind-it-it-water-bill**: dueDate.value (abstention).
- **ind-nl-nl-purchase**: status (abstention), direction (abstention).
- **ind-nl-be-decline**: merchant.value (incorrect).
- **ind-tr-tr-purchase**: amount.value (abstention), status (abstention), direction (abstention), merchant.value (abstention), balance.value (abstention).
- **ind-tr-tr-decline**: merchant.value (abstention).
- **ind-hi-in-purchase**: amount.value (abstention), status (abstention), direction (abstention), merchant.value (abstention), balance.value (abstention).
- **ind-hi-in-refund**: status (abstention), direction (abstention), merchant.value (abstention).
- **ind-hi-in-electricity**: dueDate.value (abstention).
- **ind-ar-jo-statement**: dueDate.value (abstention), statementTotal.evidence (abstention), statementTotal.alternatives (abstention), minimumDue.evidence (abstention), minimumDue.alternatives (abstention).
- **ind-ja-jp-purchase**: amount.value (abstention), status (abstention), direction (abstention), merchant.value (abstention), balance.value (abstention).
- **ind-ja-jp-decline**: merchant.value (abstention).
- **ind-ja-jp-renewal**: amount.value (abstention).
- **ind-zh-cn-purchase**: amount.value (abstention), status (abstention), direction (abstention), merchant.value (abstention), balance.value (abstention).
- **ind-zh-cn-refund**: status (abstention), direction (abstention), merchant.value (abstention).
- **ind-cat-tr-pharmacy**: category (abstention), needsReview (abstention).
- **ind-cat-hi-grocery**: category (abstention), needsReview (abstention).

## Oracle review and reproducibility

Original independent corpus SHA256: 38c58e07045b72658baaf8f49fb496e535814d4e526859f7ac62b3310ddb4991. Original JSON files are frozen. Every reviewed expectation correction is in scripts/universal-evidence/adjudications.json: ambiguous dollars can be selected explicitly; three-digit periods preserve both numerical interpretations; non-posting direction does not represent an attempted debit; harmless terminal company punctuation is omitted from strict scoring. No failing body was rewritten to fit the implementation.

```sh
node --test scripts/universal-evidence/evaluator.test.cjs scripts/universal-evidence/nonposting-regressions.test.cjs scripts/universal-evidence/money-regressions.test.cjs
node scripts/universal-evidence/evaluate.cjs --output /tmp/wafra-coverage.json
node scripts/universal-test/run.cjs
```

The coverage evaluator intentionally exits with code 1 while any declared expectation remains unmet. That is an evidence result, not a reason to delete a fixture. The first command is the bounded regression/evaluator gate; the last is the existing universal suite. Full app/native/release verification belongs to the integration task.

Machine results in this directory retain evaluated source hashes, corpus/evaluator hashes, field-level expected/actual outputs, adjudications, and refusal reasons. The generated after-fixes.json is a point-in-time snapshot; rerun after further source edits.

## Public provenance

All sources were accessed on 2026-09-05. No full webpages or customer inboxes were copied. Short published bodies/excerpts and exact retrieval limitations are recorded in public-cases.json.

- [ICICI Hong Kong: sample debit alert](https://www.icicibank.hk/en/personal_banking/sms-alerts-learn-more) — HK; direct-page. Published body, transport From telephone omitted. Yearless date must remain unresolved. No merchant expectation from opaque Info reference.
- [Bank Millennium: sample SMS authorization](https://www.bankmillennium.pl/en/corporate/e-banking/internet-banking/smspasswords) — PL; direct-page. Bank explicitly states this message authorizes a future operation. Numbers and password are the bank's published dummy example, never user credentials.
- [CommBank: transaction notification screenshot](https://www.commbank.com.au/digital-banking/transaction-notifications.html) — AU; direct-image-transcription. Verified official screen6_transaction-notifications.png. Benchmark supplies AUD alias from this identified Australian-bank example; does not test automatic source identification. Monthly spend40 is not the transaction15.
- [KASIKORNBANK: debit card SMS alert](https://www.kasikornbank.com/en/personal/digital-banking/sms/pages/k-malert-debit.aspx) — TH; researcher-direct-page. Full published purchase example. A time without a date cannot supply a calendar date.
- [Bangkok Bank: incoming funds example](https://www.bangkokbank.com/en/Personal/Digital-Banking/SMS-Services/SMS-Account-Alert) — TH; direct-page. Benchmark supplies documented Bt=THB alias; this is not automatic issuer detection. Incoming deposit/transfer, not cash withdrawal just because ATM appears.
- [UCB Upay customer manual, page 8](https://www.ucb.com.bd/reports/downloads/Upay/UPay_Customer_User_Manual.pdf) — BD; researcher-direct-pdf. Explicitly labelled Sample SMS. Merchant not supplied; invoice identifier is not money.
- [DBS IDEAL eReports samples, page 2](https://www.dbs.com.hk/documents/1023593/15361763/ideal-ereport-maintenance-form.pdf/b735d026-b24b-b1c9-93cb-8cfc0f14885c?t=1587442364567) — HK; direct-pdf-indexed-image-text. Published SMS excerpt. Mask ends with X, so no last-four assertion; historical template is not proof of current delivery wording.
- [Safaricom: data bundle terms](https://www.safaricom.co.ke/media-center-landing/terms-and-conditions/terms-and-conditions-for-safaricom-prepay-and-postpay-data-bundles?tmpl=component) — KE; official-search-index-only. Lower-confidence retrieval: direct fetch failed. Historical excerpt, not full SMS; no balance or complete date expected. Must stay separate from directly verified templates.
