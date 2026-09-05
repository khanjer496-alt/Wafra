const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { createLoader } = require('../universal-test/load-ts.cjs');
const { assess, summarize, adjudicate } = require('../universal-evidence/evaluate.cjs');
const root = path.resolve(__dirname, '../..');
const destination = path.join(root, 'docs/test-evidence/universal-coverage-round2-2026-09-05');
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const sourceSnapshot = () => Object.fromEntries(fs.readdirSync(path.join(root, 'src/lib')).filter((file) => /\.tsx?$/.test(file)).sort()
  .map((file) => ['src/lib/' + file, digest(fs.readFileSync(path.join(root, 'src/lib', file)))]));
const phase = process.argv[2] ?? 'first';
if (!['first', 'after'].includes(phase)) throw Error('Use first or after.');
const output = path.join(destination, 'holdout-' + phase + '.json');
if (phase === 'first' && fs.existsSync(output)) throw Error('First-run evidence is immutable; use after for subsequent runs.');
const freeze = JSON.parse(fs.readFileSync(path.join(destination, 'pre-holdout-freeze.json')));
const corpusBytes = fs.readFileSync(path.join(__dirname, 'holdout.json'));
if (digest(corpusBytes) !== freeze.holdoutSha256) throw Error('Frozen holdout was modified.');
const sources = sourceSnapshot();
if (phase === 'first') for (const [file, hash] of Object.entries(freeze.sourceHashes)) {
  if (sources[file] !== hash) throw Error('Implementation changed after pre-holdout freeze: ' + file);
}
const load = createLoader();
const inspect = load('@/lib/universal-parser').inspectUniversalBankEvent;
const categorize = load('@/lib/universal-categorization').categorizeMerchant;
const planner = load('@/lib/universal-import').planConfirmedUniversalImport;
const { ledgerMoneySpec } = load('@/lib/ledger-money');
const corpus = JSON.parse(corpusBytes);
const adjudications = phase === 'after' ? require('./adjudications.json') : [];
const rows = [], ids = new Set();
for (const surface of ['parser', 'categorization']) for (const original of corpus[surface]) {
  const item = adjudicate(original, adjudications);
  if (ids.has(item.id) || !item.id || !Object.keys(item.expected).length) throw Error('Invalid case: ' + item.id);
  ids.add(item.id);
  const actual = surface === 'parser' ? inspect(item.body, item.context ?? {}) : categorize(item.input);
  const checks = assess(item.expected, actual);
  let safety;
  if (item.safety?.mustNotPost) {
    const amount = actual.amount.value ?? actual.amount.alternatives[0];
    const instrument = actual.instrument.value;
    const state = { hydrated: true, ledgerMoney: amount ? ledgerMoneySpec(amount.currency) : null,
      transactions: [], accounts: [{ id: 'heldout-account', name: 'Explicit selection',
        kind: instrument?.kind === 'card' ? 'card' : 'bank', last4: instrument?.last4, openingFils: 0 }] };
    const plan = planner(state, actual, { confirmed: true, postingStatus: 'posted', amount,
      direction: actual.direction === 'credit' ? 'credit' : 'debit', accountId: 'heldout-account',
      title: 'Explicit user supplied title', category: 'other', date: '2026-09-05',
      sourceKey: 'round2_holdout_' + digest(item.id), observedAt: 1788602400000 });
    const recognized = ['failed', 'future', 'informational'].includes(actual.status);
    safety = { posted: actual.status === 'posted', importOutcome: plan.outcome,
      refusal: plan.reason ?? null, hasGroundedAmount: Boolean(amount),
      recognized, refusalClass: plan.outcome === 'refused' && recognized &&
        ['ignored-event', 'unsupported-event', 'not-posted'].includes(plan.reason) ? 'source-status' : 'incidental' };
  }
  rows.push({ id: item.id, surface, language: item.language, country: item.country, kind: item.kind,
    checks, safety, adjudications: item.adjudications,
    pass: checks.every((check) => check.outcome === 'match') && (!safety || (!safety.posted && safety.importOutcome !== 'ready')), actual });
}
if (!isDeepStrictEqual(sources, sourceSnapshot())) throw Error('Source changed during evaluation.');
const result = { evaluatedAt: new Date().toISOString(), phase, sourceHashes: sources,
  corpusSha256: digest(corpusBytes), evaluatorSha256: digest(fs.readFileSync(__filename)),
  adjudicationsSha256: phase === 'after' ? digest(fs.readFileSync(path.join(__dirname, 'adjudications.json'))) : null,
  summary: summarize(rows), grouped: Object.fromEntries(['parser', 'categorization'].map((surface) => [surface, summarize(rows.filter((row) => row.surface === surface))])),
  cases: rows };
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: phase === 'first' ? 'wx' : 'w' });
console.log(JSON.stringify(result.grouped, null, 2));
for (const row of rows.filter((row) => !row.pass)) console.log('GAP ' + row.id + ': ' + JSON.stringify(row.checks.filter((check) => check.outcome !== 'match')) + (row.safety ? ' safety=' + JSON.stringify(row.safety) : ''));
process.exitCode = rows.every((row) => row.pass) ? 0 : 1;
