'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fixture = require('../fixtures/qa001-card-repayments.json');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const markets = load('@/lib/markets');
const country = load('@/lib/country');
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { parseSms } = load('@/lib/sms-parser');
const { isUnqualifiedCardRepayment } = load('@/lib/principal-posting-guards');
const { inspectSourceFreeRefusedAlert } = load('@/lib/auto-import');
const { parseHistoricalMessageRecords } = load('@/lib/historical-import');
const { buildImportPlan } = load('@/lib/import-plan');
const { materializeImportBatch, applyMaterializedImportBatch } = load('@/lib/ledger-import');
const at = Date.parse('2026-11-05T10:00:00Z');
const now = new Date(at);
function session(row) {
  country.setActiveCountry(row.market);
  markets.setActiveMarket(row.market);
  markets.setLedgerCurrency(row.currency, 2);
  return createLaunchAlertSession({ overrides: {}, activeMarket: row.market, pinnedCurrency: row.currency,
    bestEffort: { enabled: true, country: row.market } });
}
function moneyInReview(candidate, row) {
  const money = candidate?.event?.amount.value ?? candidate?.amount;
  assert.equal(money?.minorUnits, String(row.minorUnits));
  assert.equal(money.currency, row.currency);
  assert.equal(money.exponent, 2);
}
function repayment(parsed, row) {
  assert.equal(parsed?.kind, 'cardPayment', JSON.stringify(parsed));
  assert.equal(parsed.amountFils, row.minorUnits);
  assert.equal(parsed.currency, row.currency);
  assert.equal(parsed.transferHint, true);
}
test('QA-001 pins all 90 synthetic App QA Lead repayment variants', () => {
  assert.equal(fixture.cases.length, 90);
  assert.equal(new Set(fixture.cases.map(row => row.id)).size, 90);
  assert.ok(fixture.cases.some(row => /[ء-ي]/u.test(row.body)));
  assert.ok(fixture.cases.some(row => row.market === 'SA'));
});
test('a separate card sentence cannot turn the principal into a repayment', () => {
  assert.equal(isUnqualifiedCardRepayment('Thank you for your payment of AED 37.00. On your credit card ending 1234, the available limit is AED 500.'), false);
});
for (const row of fixture.cases) test(`QA-001 ${row.id}: core never returns ordinary spending/income`, () => {
  session(row);
  const parsed = parseSms(row.body, {}, { sender: row.sender, observedAt: at });
  if (parsed) repayment(parsed, row);
});
for (const body of [
  'Thank you for your payment of AED 500 on your credit card',
  'MASHREQ: Thank you for your payment of AED 500 on your credit card',
  'AED 500 credited to your credit card',
  'تم ايداع مبلغ 500 درهم في بطاقتك الائتمانية',
]) for (const sender of ['ENBD', '']) test(`QA-001 no-tail receipt remains grounded Review: ${sender || 'blank'}/${body}`, () => {
  const row = { market: 'AE', currency: 'AED', minorUnits: 50000 };
  const reader = session(row);
  const inspection = reader.inspect(body, sender);
  assert.equal(reader.parse(body, sender, inspection, undefined, at), null);
  const refusal = inspectSourceFreeRefusedAlert({ source: body, sender, observedAt: at,
    channel: 'inbox', session: reader, existingInspection: inspection });
  assert.equal(refusal.kind, 'review');
  moneyInReview(refusal.candidate, row);
});
for (const body of [
  'Thank you for your payment of AED 37.00 to NOON using your credit card ending 1234.',
  'Your payment of AED 37.00 to NOON was successful using credit card ending 1234.',
  'Purchase of AED 37.00 at NOON with credit card ending 1234. Thank you for your payment.',
  'AED 37.00 spent on credit card 1234 at NOON and 10 points credited.',
]) test(`QA-001 positive expense control: ${body}`, () => {
  const reader = session({ market: 'AE', currency: 'AED' });
  const parsed = reader.parse(body, 'ENBD', reader.inspect(body, 'ENBD'), undefined, at);
  assert.equal(parsed?.kind, 'transaction');
  assert.equal(parsed.type, 'expense');
  assert.equal(parsed.amountFils, 3700);
  assert.equal(parsed.currency, 'AED');
});
for (const row of fixture.cases) for (const sender of [row.sender, '']) {
  const mode = sender ? 'named' : 'blank';
  test(`QA-001 ${row.id}/${mode}: capture is repayment or grounded Review`, () => {
    const reader = session(row);
    const inspection = reader.inspect(row.body, sender);
    const parsed = reader.parse(row.body, sender, inspection, undefined, at);
    if (parsed) repayment(parsed, row);
    else {
      const refusal = inspectSourceFreeRefusedAlert({ source: row.body, sender, observedAt: at,
        channel: 'inbox', session: reader, existingInspection: inspection });
      assert.equal(refusal.kind, 'review', JSON.stringify(refusal));
      moneyInReview(refusal.candidate, row);
    }
  });
  test(`QA-001 ${row.id}/${mode}: History retains transfer or Review, never spending`, () => {
    const reader = session(row);
    const id = crypto.createHash('sha256').update(`qa001:${row.id}:${mode}`).digest('hex');
    const input = JSON.stringify({ v: 1, id, text: row.body, sender, receivedAt: now.toISOString() });
    const result = parseHistoricalMessageRecords([input], {}, now, new Set(), reader);
    assert.equal(result.parsed.length + result.reviewCandidates.length, 1, JSON.stringify(result));
    for (const parsed of result.parsed) repayment(parsed, row);
    for (const review of result.reviewCandidates) moneyInReview(review, row);
    assert.equal(result.ignoredCount, 0);
  });
}
test('all 90 repayment imports leave one 500-unit purchase counted once and no income', () => {
  const base = marketId => ({ hydrated: true, onboarded: true, accounts: [], transactions: [], budgets: [], bills: [],
    goals: [], cardDues: [], accountHints: {}, merchantOverrides: {}, reviewTray: { schemaVersion: 1,
      pending: [], tombstones: [] }, lastScanTs: 0, parserVersion: 0, marketId, monthStartDay: 1,
    privateMode: false, captureOptOut: false });
  for (const row of fixture.cases) {
    const initial = base(row.market);
    const reader = session(row);
    const tail = row.body.match(/(?:ending|بـ)\s+(\d{4})/iu)?.[1] ?? '1234';
    const sender = row.market === 'SA' ? 'SNB' : 'ENBD';
    const purchase = `Purchase of ${row.currency} 500.00 with Credit Card ending ${tail} at CARREFOUR.`;
    const p = reader.parse(purchase, sender, reader.inspect(purchase, sender), undefined, at);
    assert.equal(p?.amountFils, 50000);
    const r = reader.parse(row.body, row.sender, reader.inspect(row.body, row.sender), undefined, at);
    const parsed = [p, r].filter(Boolean).map((item, index) => ({ ...item, date: '2026-11-05',
      smsTs: at + index, channel: 'inbox', sourceEventId: `${row.id}-${index}` }));
    const plan = buildImportPlan(parsed, initial, at, now);
    let next = 0;
    const state = applyMaterializedImportBatch(initial,
      materializeImportBatch(plan.batch, initial, prefix => `${prefix}-${++next}`));
    const spending = state.transactions.filter(tx => tx.type === 'expense' && !tx.isTransfer)
      .reduce((total, tx) => total + tx.amountFils, 0);
    const income = state.transactions.filter(tx => tx.type === 'income' && !tx.isTransfer)
      .reduce((total, tx) => total + tx.amountFils, 0);
    assert.equal(spending, 50000, row.id);
    assert.equal(income, 0, row.id);
  }
});
test('bundled native preview never presents the 90 repayments as posted spending or income', () => {
  const directory = path.resolve(__dirname, '../../../modules/wafra-live-capture/ios/Resources');
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'WafraBackgroundParser.meta.json')));
  const sandbox = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(directory, 'WafraBackgroundParser.js'), 'utf8'), sandbox);
  for (const row of fixture.cases) for (const sender of [row.sender, '']) {
    const result = JSON.parse(sandbox.wafraNativeAlertParse(JSON.stringify({ v: 1, body: row.body,
      sender, observedAt: at, context: { v: 1, country: row.market, parserMarket: row.market,
        ledgerMoney: { currency: row.currency, exponent: 2 }, sourceHash: metadata.sourceHash } })));
    assert.notEqual(result.route, 'parsed', row.id);
  }
});
