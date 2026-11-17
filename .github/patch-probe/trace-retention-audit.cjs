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
const promotion = load('@/lib/review-promotion'), universal = load('@/lib/universal-parser');
const ledgerMoneySpec = load('@/lib/ledger-money').ledgerMoneySpec;
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
// Keep current money/FX/instrument/transfer facts. Raw synthetic input is
// already stored once on the row; avoid duplicating it in every projection.
const compact = p => !p ? null : Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'raw'));
function completeConfirmation(item, context) {
  const event = item.event;
  const amounts = [event.amount?.value, ...(event.amount?.alternatives || [])].filter(Boolean);
  const instruments = event.instrument?.evidence === 'ambiguous' ? event.instrument.alternatives : [event.instrument?.value || null];
  const directions = ['credit', 'debit'].includes(event.direction) ? [event.direction] : ['debit', 'credit'];
  const attempts = [];
  for (const amount of amounts) {
    const modes = [{ mode: 'declared-context-ledger', spec: ledgerMoneySpec(context.currency) }];
    if (amount.currency !== context.currency) modes.push({ mode: 'source-currency-ledger-semantic-isolation', spec: ledgerMoneySpec(amount.currency) });
    for (const ledger of modes) for (const instrument of instruments) for (const direction of directions) {
      const state = { hydrated: true, marketId: context.country, ledgerMoney: ledger.spec,
        reviewTray: { ...tray.emptyAlertReviewTray(), pending: [item] },
        accounts: [{ id: 'synthetic-confirmed-account', name: 'Synthetic chosen account', kind: instrument?.kind === 'card' ? 'card' : 'bank', last4: instrument?.last4 || undefined, openingFils: 0, color: '#111' }],
        transactions: [], budgets: [], bills: [], cardDues: [], goals: [], accountHints: {}, merchantOverrides: {}, lastScanTs: 0 };
      const choice = { confirmed: true, postingStatus: 'posted', amount, direction,
        accountId: 'synthetic-confirmed-account', title: 'Synthetic reviewed source', category: 'other',
        date: event.transactionDate?.value || '2026-11-14', sourceKey: item.sourceKey, observedAt: item.observedAt,
        ...(instrument ? { instrument } : {}) };
      const command = { reviewId: item.id, type: direction === 'credit' ? 'income' : 'expense',
        title: choice.title, category: choice.category, accountId: choice.accountId, date: choice.date,
        betweenOwnAccounts: false, universal: { confirmed: true, postingStatus: 'posted', amount,
          expectedSourceKey: item.sourceKey, expectedObservedAt: item.observedAt, ...(instrument ? { instrument } : {}) } };
      const before = JSON.stringify({ state, event });
      const original = importer.planConfirmedUniversalImport(state, event, choice);
      const forcedStatusOnly = importer.planConfirmedUniversalImport(state, { ...event, status: 'posted' }, choice);
      const host = promotion.planReviewPromotion(state, command, 'synthetic-confirmed-row', at + 1);
      const forcedHost = promotion.planReviewPromotion({ ...state, reviewTray: { ...state.reviewTray,
        pending: [{ ...item, event: { ...event, status: 'posted' } }] } }, command, 'synthetic-confirmed-forced-row', at + 1);
      if (before !== JSON.stringify({ state, event })) throw new Error('Confirmation planners mutated synthetic state/event');
      attempts.push({ ledgerMode: ledger.mode, ledgerMoney: ledger.spec, choice, original, host, forcedStatusOnly, forcedHost });
    }
  }
  return { mode: 'full-bound-synthetic-planning-only', attempts, noGroundedMoneyChoice: amounts.length === 0,
    limits: ['No real ledger write or user UI action', 'Source-currency ledger isolates semantic authority; it is not the historical declared ledger or a conversion quote'] };
}
const review = (item, context) => {
  const eligibilityOnly = tray.isMoneyMovementReview(item);
  if (item.kind !== 'universal') return { ...item, eligibilityOnly, confirmationNotExercised: 'registered-review adapter is a different contract' };
  const event = item.event;
  return { kind: item.kind, id: item.id, sourceKey: item.sourceKey, observedAt: item.observedAt,
    status: event.status, direction: event.direction, amount: event.amount.value || null,
    alternatives: event.amount.alternatives, issues: event.issues, eligibilityOnly,
    eligibilityDefinition: 'money-family/status eligibility only, not completed confirmation authority',
    event, fullConfirmation: completeConfirmation(item, context) };
};
const positiveConfirmations = ['AE', 'SA'].map(country => {
  const currency = country === 'AE' ? 'AED' : 'SAR';
  load('@/lib/country').setActiveCountry(country); load('@/lib/markets').setActiveMarket(country); load('@/lib/markets').setLedgerCurrency(currency, 2);
  const body = `Purchase of ${currency} 50.00 with card 1234 at NOON.`;
  const event = universal.inspectUniversalBankEvent(body, { sender: country === 'AE' ? 'ENBD' : 'AlRajhiBank' });
  const item = { kind: 'universal', id: 'confirmation-positive-' + country,
    sourceKey: 'apple_message_review_source_' + crypto.createHash('sha256').update(body).digest('hex'),
    observedAt: at, expiresAt: at + 86400000, channel: 'inbox', parserVersion: 1, event };
  return { country, currency, body, event, result: completeConfirmation(item, { country, currency, exponent: 2 }) };
});
fs.writeFileSync(path.join(out, 'confirmation-positive-controls.json'), JSON.stringify(positiveConfirmations, null, 2));
if (!positiveConfirmations.every(p => p.result.attempts.some(a => a.original.outcome === 'ready' && a.host.outcome === 'added'))) {
  throw new Error('Complete confirmation positive fixture failed; no semantic refusal claim is valid');
}

let replayed = 0, errors = [], matched = 0, losses = [], unretainedReviews = [];
const file = path.join(out, 'money-retention-replay.jsonl'); fs.writeFileSync(file, '');
for (const row of rows.values()) {
  row.fixtureExpectations = fixtures.filter(f => f.body === row.body && (f.sender || '') === (row.sender || '')).map(({ body, ...contract }) => ({ ...contract, market: contract.market || 'AE', currency: contract.currency || 'AED' }));
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
      return { context, source: compact(source), session: compact(parsed), native, history: { parsed: records.parsed.map(compact), reviews: records.reviewCandidates.map(item => review(item, context)) } };
    } catch (e) { const error = String(e.stack || e); errors.push({ id: row.id, context, error }); return { context, error }; }
  });
  const lost = row.trace.some(t => (t.income === 'removed' && t.expense !== 'added') ||
    (t.set === 'only_before' && income(t.before)));
  if (lost && row.replays.every(p => !p.error && !p.source && !p.session && !p.history.parsed.length && !p.history.reviews.length)) losses.push({ id: row.id, body: row.body, sender: row.sender, trace: row.trace });
  if (row.trace.some(t => t.before.some(shape => /^review(?: |$)/u.test(shape))) && row.replays.every(p => !p.error && !p.source && !p.session && !p.history.parsed.length && !p.history.reviews.length)) unretainedReviews.push({ id: row.id, body: row.body, sender: row.sender, trace: row.trace });
  fs.appendFileSync(file, JSON.stringify(row, (_, value) => typeof value === 'bigint' ? value.toString() : value) + '\n');
}
const summary = { head: process.env.GITHUB_SHA || null, shippingHead: cp.execFileSync('git', ['rev-parse', 'HEAD^'], { encoding: 'utf8' }).trim(), sourceHash: meta.sourceHash,
  confirmationProjectionVersion: 2, positiveConfirmationFixturePassed: true, confirmationPositiveControlFile: 'confirmation-positive-controls.json',
  inputSummary: delta.summary, affectedUniqueKeys: rows.size, affectedUniqueMoneyKeys: [...rows.values()].filter(row => row.trace.some(t => money(t.before) || money(t.after))).length, replays: replayed, exactFixtureMatchedKeys: matched, errors, silentRemovedIncomeCandidates: losses, unretainedPriorReviewCandidates: unretainedReviews,
  coverageOnlyMoneyKeys: [...rows.values()].filter(row => row.trace.some(t => t.set !== 'changed') && row.trace.some(t => money(t.before) || money(t.after))).length,
  baselineOnlyIncomeKeys: [...rows.values()].filter(row => row.trace.some(t => t.set === 'only_before' && income(t.before))).map(row => row.id),
  unclassifiedMoneyKeys: [...rows.values()].filter(row => !row.fixtureExpectations.length && row.trace.some(t => money(t.before) || money(t.after))).map(row => row.id),
  unclassifiedPriorReviewKeys: [...rows.values()].filter(row => !row.fixtureExpectations.length && row.trace.some(t => t.before.some(shape => /^review(?: |$)/u.test(shape)))).map(row => row.id),
  limits: ['Historical keys unite calls by function/body/sender; original observation/country/ledger contexts were not recorded.', 'Replays use explicit AE/AED and additional SA/SAR contexts when named. They are new evidence, not recovered original calls.', 'Coverage-only money needs independent fixture/caller review; no expected outcomes are invented from current outputs.', 'Native is committed JavaScript executed in a Node VM, not a device engine.'] };
fs.writeFileSync(path.join(out, 'money-retention-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ affectedUniqueKeys: rows.size, affectedUniqueMoneyKeys: summary.affectedUniqueMoneyKeys, replays: replayed, exactFixtureMatchedKeys: matched, errors: errors.length, silentRemovedIncomeCandidates: losses.length, unretainedPriorReviewCandidates: unretainedReviews.length }));
if (errors.length) process.exitCode = 1;
