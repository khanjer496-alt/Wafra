// Evidence evaluator: never changes production code or rewrites expectations.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { createLoader } = require('../universal-test/load-ts.cjs');
const root = path.resolve(__dirname, '../..');
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const get = (value, field) => field.split('.').reduce((item, key) => item?.[key], value);

function assess(expected, actual) {
  return Object.entries(expected).map(([field, wanted]) => {
    const found = get(actual, field);
    const match = isDeepStrictEqual(found, wanted);
    const abstained = !match && (found == null || found === 'unknown' ||
      (field.endsWith('.evidence') && found === 'missing') ||
      (field.endsWith('.alternatives') && Array.isArray(found) && found.length === 0) ||
      (field === 'category' && found === 'other' && actual.needsReview) ||
      (field === 'needsReview' && found === true && actual.category === 'other'));
    return { field, expected: wanted, actual: found === undefined ? null : found,
      outcome: match ? 'match' : abstained ? 'abstention' : 'incorrect' };
  });
}

function adjudicate(item, rules) {
  const result = { ...item, expected: { ...item.expected }, adjudications: [] };
  for (const rule of rules.filter((rule) => rule.id === item.id || (rule.idPrefix && item.id.startsWith(rule.idPrefix)))) {
    for (const field of rule.omitExpected ?? []) delete result.expected[field];
    Object.assign(result.expected, rule.expected ?? {});
    if (rule.removeNonPostingSafety) result.safety = undefined;
    result.adjudications.push(rule.reason);
  }
  return result;
}

function snapshot() {
  return Object.fromEntries(fs.readdirSync(path.join(root, 'src/lib')).filter((file) => /\.tsx?$/.test(file)).sort()
    .map((file) => ['src/lib/' + file, digest(fs.readFileSync(path.join(root, 'src/lib', file)))]));
}

function summarize(rows) {
  const fields = rows.flatMap((row) => row.checks);
  return { cases: rows.length, exactCases: rows.filter((row) => row.pass).length,
    assertedFields: fields.length, matchedFields: fields.filter((field) => field.outcome === 'match').length,
    abstainedFields: fields.filter((field) => field.outcome === 'abstention').length,
    incorrectFields: fields.filter((field) => field.outcome === 'incorrect').length,
    nonPostingChallenges: rows.filter((row) => row.safety).length,
    falsePostedStatus: rows.filter((row) => row.safety?.posted).length,
    nonPostingConfirmable: rows.filter((row) => row.safety?.importOutcome === 'ready').length,
    nonPostingRecognized: rows.filter((row) => row.safety?.recognized).length,
    sourceGuardRefusals: rows.filter((row) => row.safety?.refusalClass === 'source-status').length,
    safetyWithoutGroundedAmount: rows.filter((row) => row.safety && !row.safety.hasGroundedAmount).length,
    categoryAbstentions: rows.filter((row) => row.surface === 'categorization' && row.actual?.needsReview).length,
    incorrectResolvedCategories: rows.filter((row) => row.surface === 'categorization' && !row.actual?.needsReview &&
      row.checks.some((check) => check.field === 'category' && check.outcome !== 'match')).length };
}

function run() {
  const before = snapshot();
  const load = createLoader();
  const { inspectUniversalBankEvent } = load('@/lib/universal-parser');
  const { categorizeMerchant } = load('@/lib/universal-categorization');
  const { planConfirmedUniversalImport } = load('@/lib/universal-import');
  const { ledgerMoneySpec } = load('@/lib/ledger-money');
  const rows = [], corpusHashes = {}, ids = new Set();
  const adjudicationBytes = fs.readFileSync(path.join(__dirname, 'adjudications.json'));
  corpusHashes['adjudications.json'] = digest(adjudicationBytes);
  const adjudications = JSON.parse(adjudicationBytes);
  for (const file of ['public-cases.json', 'independent-cases.json']) {
    const bytes = fs.readFileSync(path.join(__dirname, file));
    corpusHashes[file] = digest(bytes);
    const corpus = JSON.parse(bytes);
    for (const surface of ['parser', 'categorization']) for (const original of corpus[surface]) {
      const item = adjudicate(original, adjudications);
      if (!item.id || ids.has(item.id) || !Object.keys(item.expected).length) throw Error('Invalid/duplicate case: ' + item.id);
      ids.add(item.id);
      if (item.kind.startsWith('public-') && !item.source?.url?.startsWith('https://')) throw Error('Missing public provenance: ' + item.id);
      const actual = surface === 'parser' ? inspectUniversalBankEvent(item.body, item.context ?? {}) : categorizeMerchant(item.input);
      const checks = assess(item.expected, actual);
      let safety;
      if (item.safety?.mustNotPost) {
        // Adversarial confirmation supplies otherwise valid user choices. A
        // known non-posting source must remain refused even after this action.
        const amount = actual.amount.value ?? actual.amount.alternatives[0];
        const instrument = actual.instrument.value;
        const state = { hydrated: true, marketId: 'AE', ledgerMoney: amount ? ledgerMoneySpec(amount.currency) : null,
          accounts: [{ id: 'evidence-account', name: 'Evidence account', kind: instrument?.kind === 'card' ? 'card' : 'bank',
            last4: instrument?.last4 ?? undefined, openingFils: 0, color: '#111' }],
          transactions: [], budgets: [], bills: [], cardDues: [], goals: [], accountHints: {}, merchantOverrides: {}, lastScanTs: 0, parserVersion: 0 };
        const plan = planConfirmedUniversalImport(state, actual, { confirmed: true, postingStatus: 'posted', amount,
          direction: actual.direction === 'credit' ? 'credit' : 'debit', accountId: 'evidence-account',
          title: 'Evidence transaction', category: 'other', date: '2026-09-05',
          sourceKey: 'evidence_' + digest(item.id), observedAt: 1788602400000 });
        const recognized = ['failed', 'future', 'informational'].includes(actual.status);
        safety = { posted: actual.status === 'posted', importOutcome: plan.outcome, refusal: plan.reason ?? null,
          recognized, hasGroundedAmount: Boolean(amount),
          refusalClass: plan.outcome !== 'refused' ? null : recognized &&
            ['ignored-event', 'unsupported-event', 'not-posted'].includes(plan.reason) ? 'source-status' : 'incidental' };
      }
      rows.push({ id: item.id, surface, kind: item.kind, country: item.country, language: item.language,
        checks, safety, pass: checks.every((check) => check.outcome === 'match') && (!safety || (!safety.posted && safety.importOutcome !== 'ready')),
        adjudications: item.adjudications, actual });
    }
  }
  const structural = require('./structural-cases.cjs');
  corpusHashes['structural-cases.cjs'] = digest(fs.readFileSync(path.join(__dirname, 'structural-cases.cjs')));
  for (const original of structural()) {
    const item = adjudicate(original, adjudications);
    if (ids.has(item.id)) throw Error('Duplicate structural case');
    ids.add(item.id);
    const actual = inspectUniversalBankEvent(item.body, item.context ?? {});
    const checks = assess(item.expected, actual);
    rows.push({ id: item.id, surface: 'parser', kind: 'synthetic-structural', currency: item.currency,
      checks, pass: checks.every((check) => check.outcome === 'match'), adjudications: item.adjudications, actual });
  }
  const grouped = {};
  for (const key of [...new Set(rows.map((row) => row.kind + '/' + row.surface))]) {
    grouped[key] = summarize(rows.filter((row) => row.kind + '/' + row.surface === key));
  }
  const report = { schemaVersion: 1, evaluatedAt: new Date().toISOString(), sourceStableDuringRun: isDeepStrictEqual(before, snapshot()),
    evaluatorSha256: digest(fs.readFileSync(__filename)), corpusHashes, sourceHashes: before,
    countriesOrTerritoriesRepresented: [...new Set(rows.map((row) => row.country).filter((country) => country && country !== 'unknown'))].sort(),
    languagesRepresented: [...new Set(rows.map((row) => row.language).filter(Boolean))].sort(),
    structuralCurrencies: [...new Set(rows.map((row) => row.currency).filter(Boolean))].sort(),
    summary: summarize(rows), grouped, cases: rows };
  if (!report.sourceStableDuringRun) throw Error('Source changed during evaluation; rerun against stable source.');
  const outputArg = process.argv.indexOf('--output');
  if (outputArg !== -1) {
    if (!process.argv[outputArg + 1]) throw Error('--output requires a path');
    const output = path.resolve(process.argv[outputArg + 1]);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ summary: report.summary, grouped, countries: report.countriesOrTerritoriesRepresented,
    languages: report.languagesRepresented, structuralCurrencies: report.structuralCurrencies.length }, null, 2));
  for (const row of rows.filter((item) => !item.pass && item.kind !== 'synthetic-structural')) {
    console.log('GAP ' + row.id + ': ' + JSON.stringify(row.checks.filter((check) => check.outcome !== 'match')) +
      (row.safety ? ' safety=' + JSON.stringify(row.safety) : ''));
  }
  if (report.summary.exactCases !== report.summary.cases) process.exitCode = 1;
  return report;
}
module.exports = { assess, summarize, adjudicate };
if (require.main === module) run();
