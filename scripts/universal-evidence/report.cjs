// Regrade captured baseline outputs with the reviewed oracle; do not pretend
// that old source has been re-executed. Preserve original baseline.json intact.
const fs = require('node:fs');
const path = require('node:path');
const { assess, summarize, adjudicate } = require('./evaluate.cjs');
const destination = path.resolve(__dirname, '../../docs/test-evidence/universal-coverage-2026-09-05');
const baseline = JSON.parse(fs.readFileSync(path.join(destination, 'baseline.json')));
const current = JSON.parse(fs.readFileSync(path.join(destination, 'after-fixes.json')));
const rules = require('./adjudications.json');
const publicCases = require('./public-cases.json');
const independent = require('./independent-cases.json');
const originals = [...publicCases.parser, ...independent.parser, ...independent.categorization, ...require('./structural-cases.cjs')()];
const beforeRows = baseline.cases.map((row) => {
  const original = originals.find((item) => item.id === row.id);
  if (!original) throw Error('Missing frozen input: ' + row.id);
  const item = adjudicate(original, rules);
  const checks = assess(item.expected, row.actual);
  const safety = item.safety?.mustNotPost ? row.safety : undefined;
  return { ...row, checks, safety, adjudications: item.adjudications,
    pass: checks.every((check) => check.outcome === 'match') && (!safety || (!safety.posted && safety.importOutcome !== 'ready')) };
});
const groups = [...new Set(current.cases.map((row) => row.kind + '/' + row.surface))];
const rowsFor = (rows, group) => rows.filter((row) => row.kind + '/' + row.surface === group);
const table = groups.map((group) => {
  const before = summarize(rowsFor(beforeRows, group)), after = summarize(rowsFor(current.cases, group));
  return `| ${group} | ${after.cases} | ${before.exactCases} | ${after.exactCases} | ${after.abstainedFields} | ${after.incorrectFields} |`;
}).join('\n');
const beforeSafety = summarize(beforeRows), afterSafety = summarize(current.cases);
const failedRows = current.cases.filter((row) => !row.pass && row.kind !== 'synthetic-structural');
const failures = failedRows.map((row) => `- **${row.id}**: ${row.checks.filter((check) => check.outcome !== 'match')
  .map((check) => `${check.field} (${check.outcome})`).join(', ')}.`).join('\n');
const sources = publicCases.parser.map((item) => `- [${item.source.title}](${item.source.url}) — ${item.country}; ${item.source.verification}. ${item.source.notes}`).join('\n');
const fence = '```';
const report = `# Global parser evidence — 5 September 2026

The architecture accepts bank-independent review, but this evaluation does **not** establish universal automatic accuracy. It found a wrong transaction amount in an official published example and confirmation paths that accepted explicit non-posting messages. The bounded fixes address those errors. Substantial extraction gaps remain.

## Evidence and sampling

- 8 public templates/excerpts from 8 providers across 6 countries/territories. Seven were inspected directly by the author/researcher as a page, PDF, or image; the Kenyan excerpt is search-index-only and is reported separately.
- 36 independently authored synthetic parser challenges and 15 category challenges, written without reading implementation or prior tests, spanning 12 languages. These are not customer messages and have not been validated by native speakers or the named banks.
- 180 related format tests: one English purchase/balance structure × 30 currencies × 6 formatting variants. These measure numerical/normalization behavior. They do not count as 180 independent bank formats. Six KWD cases test preservation of decimal/grouping ambiguity.
- No production inbox was accessed, no real-customer messages were collected, and no bank delivery/import/device flow was exercised in this workstream. Public publication does not establish current bank delivery wording. This convenience/adversarial sample is not statistically representative, so no worldwide accuracy percentage or confidence interval is justified.

## Results

Baseline source execution: ${baseline.evaluatedAt}. Final source execution: ${current.evaluatedAt}. Both capture source hashes. Baseline outputs were regraded with the same reviewed expectations as the final run; old source was not re-executed. The initial unreviewed baseline and original expectations remain intact.

“Exact” means every asserted field and applicable safety check matched; fields not asserted are not validated. Abstentions are missing/unknown facts, including missing alternatives; incorrect fields are non-abstaining mismatches. A correct field elsewhere does not erase an error. Category review flags accompany category outcomes and are not independent examples.

| Group | Cases | Baseline exact | After fixes exact | After abstained fields | After incorrect fields |
| --- | ---: | ---: | ---: | ---: | ---: |
${table}

Do not combine these groups into a headline success rate: the closely related format variants dominate the denominator.

## Posting safety

Of ${afterSafety.nonPostingChallenges} actual non-posting challenges, ${beforeSafety.nonPostingConfirmable} previously reached a ready import plan after an adversarial explicit “posted” confirmation; now ${afterSafety.nonPostingConfirmable} do. These were **explicit-confirmation paths, not observed automatic imports**.

The final parser recognizes all ${afterSafety.nonPostingRecognized} as non-posting and all ${afterSafety.sourceGuardRefusals} plans refuse on a source-status/family guard. ${afterSafety.safetyWithoutGroundedAmount} sources have no selectable transaction amount (including statements/balances); their refusal is not evidence of a successfully exercised amount-confirmation path. ${afterSafety.nonPostingChallenges - afterSafety.safetyWithoutGroundedAmount} still have grounded transaction money and are refused despite otherwise supplied confirmation choices. No record was committed during this evaluation.

## What was fixed

- The official CommBank example contains a purchase of 15 and a month-to-date category total of 40. The transaction amount is now 15; the aggregate remains an observation and cannot displace it. The remaining unknown posting status is honestly counted as a coverage abstention.
- Source-level numeric authorization, direct declines, renewal notices, bill obligations, and a Spanish statement header now restrict posting even when a local amount clause is unfamiliar. Complete predicates and conditional/advice checks avoid interpreting merchant names or help footers as failures.
- Independent review added regressions for a decline before/after the purchase sentence, German decimal points, bare “Total spent” transactions, conditional renewal advice, and numeric password advice after a completed purchase.

Only universal-money.ts and universal-parser.ts were changed in production by this workstream. The confirmed-import adapter and shared app integration remain owned by the integration task. Fixes do not broaden automatic import eligibility or infer unknown posting status.

## Remaining failures

These stay visible and keep the evaluation command nonzero. Examples include Thai merchant/status extraction, the Kenyan attached currency spelling, multilingual paid/refund wording and balances, bill dates, statement total/minimum roles, and merchant text contaminated by an account footer or rejection word. Turkish pharmacy and Hindi grocery category descriptions currently abstain. The broader same-format test success does not cancel these gaps.

${failures}

## Oracle review and reproducibility

Original independent corpus SHA256: 38c58e07045b72658baaf8f49fb496e535814d4e526859f7ac62b3310ddb4991. Original JSON files are frozen. Every reviewed expectation correction is in scripts/universal-evidence/adjudications.json: ambiguous dollars can be selected explicitly; three-digit periods preserve both numerical interpretations; non-posting direction does not represent an attempted debit; harmless terminal company punctuation is omitted from strict scoring. No failing body was rewritten to fit the implementation.

${fence}sh
node --test scripts/universal-evidence/evaluator.test.cjs scripts/universal-evidence/nonposting-regressions.test.cjs scripts/universal-evidence/money-regressions.test.cjs
node scripts/universal-evidence/evaluate.cjs --output /tmp/wafra-coverage.json
node scripts/universal-test/run.cjs
${fence}

The coverage evaluator intentionally exits with code 1 while any declared expectation remains unmet. That is an evidence result, not a reason to delete a fixture. The first command is the bounded regression/evaluator gate; the last is the existing universal suite. Full app/native/release verification belongs to the integration task.

Machine results in this directory retain evaluated source hashes, corpus/evaluator hashes, field-level expected/actual outputs, adjudications, and refusal reasons. The generated after-fixes.json is a point-in-time snapshot; rerun after further source edits.

## Public provenance

All sources were accessed on 2026-09-05. No full webpages or customer inboxes were copied. Short published bodies/excerpts and exact retrieval limitations are recorded in public-cases.json.

${sources}
`;
fs.writeFileSync(path.join(destination, 'README.md'), report);
fs.writeFileSync(path.join(destination, 'baseline-regraded.json'), JSON.stringify({
  note: 'Captured baseline actual outputs regraded under current reviewed expectations; not a new execution of old source.',
  baselineEvaluatedAt: baseline.evaluatedAt, baselineSourceHashes: baseline.sourceHashes,
  gradingEvaluatorSha256: current.evaluatorSha256, adjudicationsSha256: current.corpusHashes['adjudications.json'],
  summary: summarize(beforeRows), cases: beforeRows,
}, null, 2) + '\n');
console.log(table);
console.log(`Non-posting confirmation gaps: ${beforeSafety.nonPostingConfirmable} -> ${afterSafety.nonPostingConfirmable}; grounded final challenges: ${afterSafety.nonPostingChallenges - afterSafety.safetyWithoutGroundedAmount}`);
