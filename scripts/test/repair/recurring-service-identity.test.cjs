'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// Execute current source without rebuilding another worker's shared dependencies.
const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../../src/lib/subscriptions.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
Function('require', 'module', 'exports', output)(id => {
  assert.ok(id.startsWith('@/lib/'), `unexpected dependency ${id}`);
  return require(path.join(__dirname, '../build', id.slice('@/lib/'.length)));
}, loaded, loaded.exports);
const lib = loaded.exports;
const today = new Date(2026, 8, 20, 12);
const receipt = (date, billIdentity, patch = {}) => ({
  id: `${date}-${billIdentity}`, type: 'expense', title: 'Etisalat Quickpay', category: 'telecom',
  accountId: 'bank', amountFils: 10000, source: 'sms', paymentFlowSide: 'receipt', date,
  ...(billIdentity === undefined ? {} : { billIdentity }), ...patch,
});
const series = (identity, day, patch = {}) => ['07', '08', '09'].map(month =>
  receipt(`2026-${month}-${day}`, identity, patch));
const fixture = () => [...series('consumer:1111', '01'), ...series('consumer:2222', '15')];
const detect = (rows = fixture(), dismissed = []) => lib.detectSubscriptions(rows, dismissed, today);
const subscription = (billIdentity, patch = {}) => ({ title: 'E&', billIdentity,
  lastChargedISO: '2026-09-01', ...patch });
const firstKey = 'service:["e&","consumer:1111"]';
const secondKey = 'service:["e&","consumer:2222"]';

test('literal provider names cannot collide with encoded service identifiers or preferences', () => {
  const service = subscription('consumer:1111');
  const literal = { title: firstKey, lastChargedISO: '2026-09-01' };
  const nested = { title: `provider:${JSON.stringify(firstKey)}` };
  assert.notEqual(lib.subscriptionKey(literal), lib.subscriptionKey(service));
  assert.notEqual(lib.subscriptionKey(literal), lib.subscriptionKey(nested));
  assert.equal(lib.isSubscriptionDismissed(literal, [firstKey]), false);
  assert.equal(lib.isCancelledByUser(literal, { [firstKey]: '2026-09-20' }), false);
  assert.equal(lib.isSubscriptionDismissed(literal, [lib.subscriptionKey(literal)]), true);
});

test('two accounts at one provider retain separate monthly amounts and dates', () => {
  const subs = detect().sort((a, b) => a.lastChargedISO.localeCompare(b.lastChargedISO));
  assert.equal(subs.length, 2);
  assert.deepEqual(subs.map(sub => [sub.title, sub.billIdentity, sub.cadence, sub.monthlyEquivalentFils,
    sub.lastChargedISO, sub.nextExpectedISO, sub.chargeCount]), [
    ['E&', 'consumer:1111', 'monthly', 10000, '2026-09-01', '2026-10-01', 3],
    ['E&', 'consumer:2222', 'monthly', 10000, '2026-09-15', '2026-10-15', 3],
  ]);
  assert.equal(lib.subscriptionsMonthlyTotal(subs), 20000);
  assert.deepEqual(subs.map(lib.subscriptionKey), [firstKey, secondKey]);
});

test('service identity partitions same-day folding and price-change history', () => {
  const rows = [...series('consumer:1111', '01'), ...series('consumer:2222', '01')];
  rows[2].amountFils = 15000;
  rows.push(receipt('2026-09-01', 'consumer:1111', { id: 'split', amountFils: 5000 }));
  const subs = detect(rows);
  assert.equal(subs.length, 2);
  const first = subs.find(sub => sub.billIdentity === 'consumer:1111');
  const second = subs.find(sub => sub.billIdentity === 'consumer:2222');
  assert.equal(first.chargeCount, 3);
  assert.equal(first.lastAmountFils, 20000);
  assert.equal(first.priorTypicalFils, 10000);
  assert.equal(first.priceIncreased, true);
  assert.equal(second.lastAmountFils, 10000);
  assert.equal(second.priceIncreased, false);
  assert.equal(rows[2].amountFils, 15000, 'projection must not mutate ledger rows');
});

test('unknown identities stay separate while funding account changes do not split a service', () => {
  const rows = [...fixture(), ...series(undefined, '20')];
  rows[1].accountId = 'other-bank';
  rows[2].billIdentity = 'CONSUMER:1111';
  const subs = detect(rows);
  assert.equal(subs.length, 3);
  assert.deepEqual(subs.map(lib.subscriptionKey).sort(), ['e&', firstKey, secondKey].sort());
  assert.ok(subs.every(sub => sub.monthlyEquivalentFils === 10000 && sub.chargeCount === 3));
  assert.equal(detect(series(undefined, '01'))[0].billIdentity, undefined);
});

test('different identity kinds do not merge and malformed identities cannot escape into the projection', () => {
  const subs = detect([...series('consumer:1111', '01'), ...series('account:1111', '01'),
    ...series('consumer:123456789', '01')]);
  assert.equal(subs.length, 3);
  assert.deepEqual(subs.map(lib.subscriptionKey).sort(), [
    'e&', 'service:["e&","account:1111"]', firstKey,
  ].sort());
  assert.equal(JSON.stringify(subs).includes('123456789'), false);
  assert.ok(subs.every(sub => sub.monthlyEquivalentFils === 10000 && sub.chargeCount === 3));
});

test('cooperative detection and legacy unidentified recurring histories keep their existing results', async () => {
  const rows = fixture();
  const cooperative = await lib.detectSubscriptionsCooperatively(rows, [], today);
  assert.deepEqual(cooperative.map(lib.subscriptionKey).sort(), [firstKey, secondKey]);
  const legacy = detect(series(undefined, '01', { title: 'Netflix', category: 'entertainment', paymentFlowSide: undefined }));
  assert.equal(legacy.length, 1);
  assert.equal(lib.subscriptionKey(legacy[0]), 'netflix');
  assert.equal(legacy[0].cadence, 'monthly');
  assert.equal(legacy[0].nextExpectedISO, '2026-10-01');
  assert.equal(legacy[0].monthlyEquivalentFils, 10000);
  assert.equal(legacy[0].paymentHistory, false);
  assert.equal(legacy[0].billIdentity, undefined);
});

test('keys validate the complete kind and masked tail while labels preserve canonical titles', () => {
  assert.equal(lib.subscriptionKey({ title: ' E& ' }), 'e&');
  assert.equal(lib.subscriptionKey(subscription('CONSUMER:Ab12')), 'service:["e&","consumer:ab12"]');
  assert.notEqual(lib.subscriptionKey(subscription('consumer:1111')), lib.subscriptionKey(subscription('account:1111')));
  for (const identity of ['consumer:12345', 'consumer:123', 'reference:1234', 'consumer:12-4', ' consumer:1111', '']) {
    assert.equal(lib.subscriptionKey(subscription(identity)), 'e&', identity);
  }
  const sub = subscription('consumer:1111');
  assert.match(lib.subscriptionLabel(sub), /E&.*[•*]{2,}.*1111/);
  assert.equal(sub.title, 'E&');
  assert.equal(lib.subscriptionLabel({ title: 'Netflix' }), 'Netflix');
});

test('scoped undo accepts only canonical complete service keys', () => {
  assert.equal(lib.isScopedSubscriptionKey(firstKey), true);
  for (const key of ['e&', 'service:', 'service:null', 'service:["e&"]',
    'service:["e&","reference:1111"]', 'service:["E&","consumer:1111"]',
    'service:["e&","CONSUMER:1111"]', 'service:["e&","consumer:1111","extra"]',
    'service:["","consumer:1111"]', 'service:["e&",1234]']) {
    assert.equal(lib.isScopedSubscriptionKey(key), false, key);
  }
});

test('a merchant named like a scoped key cannot merge with that service during detection', () => {
  const subs = detect([...series('consumer:1111', '01'),
    ...series(undefined, '01', { title: firstKey, category: 'software', amountFils: 2500 })]);
  assert.equal(subs.length, 2);
  assert.deepEqual(subs.map(sub => sub.lastAmountFils).sort((a, b) => a - b), [2500, 10000]);
});

test('detail matching shares canonicalization and never mixes service or identity kinds', () => {
  const sub = subscription('consumer:1111');
  for (const title of ['Etisalat Quickpay', 'Etisalat Digital App', 'Utility payment-Etisalat', 'E&']) {
    assert.equal(lib.matchesRecurringTransaction(sub, receipt('2026-09-01', 'CONSUMER:1111', { title })), true);
  }
  for (const identity of [undefined, 'consumer:2222', 'account:1111']) {
    assert.equal(lib.matchesRecurringTransaction(sub, receipt('2026-09-01', identity)), false);
  }
  assert.equal(lib.matchesRecurringTransaction(sub, receipt('2026-09-01', 'consumer:1111', { title: 'du' })), false);
  assert.equal(lib.matchesRecurringTransaction(sub, receipt('2026-09-01', 'consumer:1111', { userEdited: true })), false);
  assert.equal(lib.matchesRecurringTransaction({ title: 'E&' }, receipt('2026-09-01', undefined)), true);
  assert.equal(lib.matchesRecurringTransaction({ title: 'E&' }, receipt('2026-09-01', 'consumer:1111')), false);
});

test('identified bills suppress only the matching service; legacy manual bills remain provider-wide', () => {
  const bill = { title: 'Etisalat', category: 'telecom', importIdentity: 'consumer:1111' };
  assert.equal(lib.subscriptionMatchesBill(subscription('consumer:1111'), bill), true);
  assert.equal(lib.subscriptionMatchesBill(subscription('consumer:2222'), bill), false);
  assert.equal(lib.subscriptionMatchesBill(subscription('account:1111'), bill), false);
  assert.equal(lib.subscriptionMatchesBill({ title: 'E&' }, bill), false);
  assert.equal(lib.subscriptionMatchesBill(subscription('consumer:1111'), { ...bill, title: 'du' }), false);
  assert.equal(lib.subscriptionMatchesBill(subscription('consumer:1111'), { ...bill, importIdentity: 'reference:1111' }), false);
  for (const sub of [subscription('consumer:1111'), subscription('consumer:2222'), { title: 'E&' }]) {
    assert.equal(lib.subscriptionMatchesBill(sub, { ...bill, importIdentity: undefined }), true);
  }
});

test('scoped dismissals hide one service while legacy provider dismissals hide all services', () => {
  assert.deepEqual(detect(fixture(), [firstKey]).map(lib.subscriptionKey), [secondKey]);
  assert.deepEqual(detect(fixture(), [' E& ']), []);
  for (const values of [[firstKey], new Set([firstKey])]) {
    assert.equal(lib.isSubscriptionDismissed(subscription('consumer:1111'), values), true);
    assert.equal(lib.isSubscriptionDismissed(subscription('consumer:2222'), values), false);
  }
  assert.equal(lib.isSubscriptionDismissed(subscription('consumer:1111'), [' E& ']), true);
});

test('scoped cancellations and later charges affect only that service', () => {
  const subs = detect();
  const cancelled = { [firstKey]: '2026-09-10' };
  assert.deepEqual(lib.withoutCancelled(subs, cancelled).map(lib.subscriptionKey), [secondKey]);
  assert.deepEqual(lib.cancelledByUser(subs, cancelled).map(lib.subscriptionKey), [firstKey]);
  assert.equal(lib.isCancelledByUser(subscription('consumer:1111', { lastChargedISO: '2026-09-11' }), cancelled), false);
  assert.equal(lib.isCancelledByUser(subscription('consumer:1111', { lastChargedISO: '2026-09-10' }), cancelled), true);
  assert.equal(lib.isCancelledByUser(subscription('consumer:2222'), cancelled), false);
  assert.equal(lib.isCancelledByUser({ title: 'constructor', lastChargedISO: '2026-01-01' }, {}), false);
});

test('scoped null undo overrides a legacy provider cancellation without undoing the sibling', () => {
  const first = subscription('consumer:1111');
  const second = subscription('consumer:2222');
  const cancelled = { 'e&': '2026-09-20', [firstKey]: null };
  assert.equal(lib.subscriptionCancellationDate(first, cancelled), null);
  assert.equal(lib.subscriptionCancellationDate(second, cancelled), '2026-09-20');
  assert.equal(lib.isCancelledByUser(first, cancelled), false);
  assert.equal(lib.isCancelledByUser(second, cancelled), true);
  assert.equal(lib.subscriptionCancellationDate(first, { 'e&': '2026-09-20', [firstKey]: '2026-09-10' }), '2026-09-10');
  assert.equal(lib.isCancelledByUser({ title: 'Netflix', lastChargedISO: '2026-09-01' }, { netflix: '2026-09-01' }), true);
});
