'use strict';
// Read-only replay of every changed/coverage-only money tuple. Inputs are
// synthetic repository traces; no inbox/device/account is accessed.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), vm = require('node:vm');
const cp = require('node:child_process');
const delta = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = process.argv[3]; fs.mkdirSync(out, { recursive: true });
const root = process.cwd();
const load = require(path.join(root, 'scripts/universal-test/load-ts.cjs')).createLoader();
const sms = load('@/lib/sms-parser'), launch = load('@/lib/launch-alert-parser');
const history = load('@/lib/historical-import'), tray = load('@/lib/alert-review-tray'), importer = load('@/lib/universal-import');
const meta = JSON.parse(fs.readFileSync('modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.meta.json'));
const sandbox = vm.createContext({}); vm.runInContext(fs.readFileSync('modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.js', 'utf8'), sandbox);
const at = Date.parse('2026-11-14T10:00:00Z');
const fixtures = [...require(path.join(root, 'scripts/test/repair/credit-settlement-sweep.json')), ...require(path.join(root, 'scripts/test/repair/credit-settlement-review-probes.json'))];
const money = shapes => shapes.some(x => /^(?:(?:parsed )?(?:income|expense)) /u.test(x));
const income = shapes => shapes.some(x => /^(?:parsed )?income /u.test(x));
const rows = new Map();
for (const set of ['changed', 'only_before', 'only_after']) for (const r of delta[set]) {
  const key = JSON.stringify([r.body, r.sender]);
  if (!rows.has(key)) rows.set(key, { id: crypto.createHash('sha256').update(key).digest('hex'), body: r.body, sender: r.sender, trace: [] });
  rows.get(key).trace.push({ set, fn: r.fn, before: r.before || [], after: r.after || [], income: r.income, expense: r.expense });
}
const compact = p => !p ? null : { kind: p.kind, type: p.type || null, amountFils: p.amountFils, currency: p.currency || null, merchant: p.merchant || null };
const review = item => {
  if (item.kind !== 'universal') return { kind: item.kind, confirmable: tray.isMoneyMovementReview(item) };
  const event = item.event;
  const forced = importer.planConfirmedUniversalImport({ hydrated: true }, { ...event, status: 'posted' }, { confirmed: true, postingStatus: 'posted' });
  return { kind: item.kind, status: event.status, direction: event.direction, amount: event.amount.value || null,
    alternatives: event.amount.alternatives, issues: event.issues, confirmable: tray.isMoneyMovementReview(item), forcedConfirmation: forced };
};
let replayed = 0, errors = [], matched = 0, losses = [], unretainedReviews = [];
const file = path.join(out, 'money-retention-replay.jsonl'); fs.writeFileSync(file, '');
for (const row of rows.values()) {
  row.fixtureExpectations = fixtures.filter(f => f.body === row.body && (f.sender || '') === (row.sender || '')).map(f => ({ id: f.id, expected: f.expected, minorUnits: f.minorUnits, market: f.market || 'AE', currency: f.currency || 'AED', requireDebitParity: f.requireDebitParity, requireReview: f.requireReview, reviewMinorUnits: f.reviewMinorUnits, incompleteExpense: f.incompleteExpense, rejectBorrowedReview: f.rejectBorrowedReview, requireSupplementaryNote: f.requireSupplementaryNote, noteMinorUnits: f.noteMinorUnits, nativeKnownBoundary: f.nativeKnownBoundary }));
  if (row.fixtureExpectations.length) matched++;
  const contexts = [{ country: 'AE', currency: 'AED', exponent: 2 }];
  if (/\bSAR\b|ر[. ]?س|ريال/iu.test(row.body) || row.trace.some(t => [...t.before, ...t.after].some(s => / SAR$/u.test(s)))) contexts.push({ country: 'SA', currency: 'SAR', exponent: 2 });
  row.replays = contexts.map(context => {
    try {
      load('@/lib/country').setActiveCountry(context.country); load('@/lib/markets').setActiveMarket(context.country); load('@/lib/markets').setLedgerCurrency(context.currency, context.exponent);
      const session = launch.createLaunchAlertSession({ overrides: {}, activeMarket: context.country, pinnedCurrency: context.currency, bestEffort: { enabled: true, country: context.country } });
      const source = sms.parseSms(row.body, {}, { sender: row.sender, observedAt: at });
      const parsed = session.parse(row.body, row.sender, session.inspect(row.body, row.sender), undefined, at);
      const native = JSON.parse(sandbox.wafraNativeAlertParse(JSON.stringify({ v: 1, body: row.body, sender: row.sender, observedAt: at,
        context: { v: 1, country: context.country, parserMarket: context.country, ledgerMoney: { currency: context.currency, exponent: context.exponent }, sourceHash: meta.sourceHash } })));
      const records = history.parseHistoricalMessageRecords([JSON.stringify({ v: 1, id: row.id, text: row.body, sender: row.sender || '', receivedAt: new Date(at).toISOString() })], {}, new Date(at), new Set(), session);
      replayed++;
      return { context, source: compact(source), session: compact(parsed), native, history: { parsed: records.parsed.map(compact), reviews: records.reviewCandidates.map(review) } };
    } catch (e) { const error = String(e.stack || e); errors.push({ id: row.id, context, error }); return { context, error }; }
  });
  const lost = row.trace.some(t => (t.income === 'removed' && t.expense !== 'added') ||
    (t.set === 'only_before' && income(t.before)));
  if (lost && row.replays.every(p => !p.error && !p.source && !p.session && !p.history.parsed.length && !p.history.reviews.length)) losses.push({ id: row.id, body: row.body, sender: row.sender, trace: row.trace });
  if (row.trace.some(t => t.before.some(shape => /^review(?: |$)/u.test(shape))) && row.replays.every(p => !p.error && !p.source && !p.session && !p.history.parsed.length && !p.history.reviews.length)) unretainedReviews.push({ id: row.id, body: row.body, sender: row.sender, trace: row.trace });
  fs.appendFileSync(file, JSON.stringify(row, (_, value) => typeof value === 'bigint' ? value.toString() : value) + '\n');
}
const summary = { head: process.env.GITHUB_SHA || null, shippingHead: cp.execFileSync('git', ['rev-parse', 'HEAD^'], { encoding: 'utf8' }).trim(), sourceHash: meta.sourceHash,
  inputSummary: delta.summary, affectedUniqueKeys: rows.size, affectedUniqueMoneyKeys: [...rows.values()].filter(row => row.trace.some(t => money(t.before) || money(t.after))).length, replays: replayed, exactFixtureMatchedKeys: matched, errors, silentRemovedIncomeCandidates: losses, unretainedPriorReviewCandidates: unretainedReviews,
  coverageOnlyMoneyKeys: [...rows.values()].filter(row => row.trace.some(t => t.set !== 'changed') && row.trace.some(t => money(t.before) || money(t.after))).length,
  baselineOnlyIncomeKeys: [...rows.values()].filter(row => row.trace.some(t => t.set === 'only_before' && income(t.before))).map(row => row.id),
  unclassifiedMoneyKeys: [...rows.values()].filter(row => !row.fixtureExpectations.length && row.trace.some(t => money(t.before) || money(t.after))).map(row => row.id),
  unclassifiedPriorReviewKeys: [...rows.values()].filter(row => !row.fixtureExpectations.length && row.trace.some(t => t.before.some(shape => /^review(?: |$)/u.test(shape)))).map(row => row.id),
  limits: ['Historical keys unite calls by function/body/sender; original observation/country/ledger contexts were not recorded.', 'Replays use explicit AE/AED and additional SA/SAR contexts when named. They are new evidence, not recovered original calls.', 'Coverage-only money needs independent fixture/caller review; no expected outcomes are invented from current outputs.', 'Native is committed JavaScript executed in a Node VM, not a device engine.'] };
fs.writeFileSync(path.join(out, 'money-retention-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ affectedUniqueKeys: rows.size, affectedUniqueMoneyKeys: summary.affectedUniqueMoneyKeys, replays: replayed, exactFixtureMatchedKeys: matched, errors: errors.length, silentRemovedIncomeCandidates: losses.length, unretainedPriorReviewCandidates: unretainedReviews.length }));
if (errors.length) process.exitCode = 1;
