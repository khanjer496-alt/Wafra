'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./merchant-spending-fixture.cjs');
const { createHarness, walk, text } = require('./reference-harness.cjs');
const accounts = [{ id: 'bank' }, { id: 'card' }, { id: 'hidden', archived: true }];
const row = (id, amountFils, extra = {}) => ({ id, amountFils, type: 'expense', title: 'Talabat',
  accountId: 'bank', category: 'dining', date: '2026-09-07', ...extra });
const month = { mode: 'month', key: '2026-09' };
function project(rows, name = 'Talabat', period = month, modules = fixture()) {
  const ledger = modules['@/lib/ledger'];
  return modules['@/lib/merchant-spending'].projectMerchantSpending(rows, name, period,
    ledger.liveAccountIds(accounts), ledger.internalTransferIds(rows, accounts));
}

test('merchant spending preserves every minor unit and matches top-merchants accounting', () => {
  const modules = fixture(); const rows = [row('a', 1), row('b', 2), row('c', 1999, { title: ' TALABAT ' })];
  const result = project(rows, 'talabat', month, modules);
  assert.equal(result.totalFils, 2002); assert.equal(result.spending.length, 3);
  assert.equal(result.averageFils, 667); assert.equal(result.averageApproximate, true);
  const top = modules['@/lib/analytics'].topMerchants(rows, month, 99, new Set(['bank']), new Set());
  assert.equal(top[0].totalFils, result.totalFils); assert.equal(top[0].count, result.spending.length);
});
test('same-name income and refunds never become spending or an inferred refund deduction', () => {
  const result = project([row('purchase', 9000), row('credit', 2000, { type: 'income' }),
    row('payout', 1800000, { title: 'Talabat Business', type: 'income', category: 'business' })]);
  assert.equal(result.totalFils, 9000); assert.equal(result.receivedFils, 2000);
  assert.equal(result.activity.length, 2); assert.equal(result.received.length, 1);
});
test('income average and conversion disclosure use only income that counts in the selected period', () => {
  const result = project([
    row('purchase', 9000, { originalCurrency: 'USD' }),
    row('first-income', 100, { type: 'income' }), row('second-income', 101, { type: 'income' }),
    row('other-source', 999999, { type: 'income', title: 'Talabat sales' }),
    row('old-income', 999999, { type: 'income', date: '2026-08-31' }),
    row('hidden-income', 999999, { type: 'income', accountId: 'hidden', originalCurrency: 'EUR' }),
    row('transfer-income', 999999, { type: 'income', isTransfer: true }),
  ]);
  assert.equal(result.receivedFils, 201);
  assert.equal(result.received.length, 2);
  assert.equal(result.averageReceivedFils, 101);
  assert.equal(result.averageReceivedApproximate, true);
  assert.equal(result.hasConvertedIncome, false, 'foreign purchases and excluded credits cannot mark ordinary income converted');
  assert.equal(result.totalFils, 9000, 'income summary must not change spending');
  const converted = project([row('foreign-income', 3673, { type: 'income', originalCurrency: 'USD' })]);
  assert.equal(converted.averageReceivedFils, 3673);
  assert.equal(converted.averageReceivedApproximate, false);
  assert.equal(converted.hasConvertedIncome, true);
  const noIncome = project([row('purchase', 100)]);
  assert.equal(noIncome.averageReceivedFils, null);
  assert.equal(noIncome.averageReceivedApproximate, false);
});
test('substring and logo matches cannot combine different financial identities', () => {
  const rows = [row('a', 500), row('b', 600, { title: 'Talabat Business' }), row('c', 700, { title: 'Not Talabat' })];
  assert.equal(project(rows, 'Talabat').totalFils, 500);
  assert.equal(project(rows, 'Tal').totalFils, 0);
  assert.equal(project(rows, '  ').activity.length, 0);
});
test('transfers, pending bank credits, card payments, hidden and unknown accounts remain excluded', () => {
  const rows = [row('spend', 2500), row('transfer', 50000, { isTransfer: true }),
    row('card-payment', 30000, { accountId: 'card', type: 'income', isTransfer: true }),
    row('hidden', 9999, { accountId: 'hidden' }), row('unknown', 9999, { accountId: 'missing' }),
    row('out', 75000, { title: 'Outgoing transfer', accountId: 'hidden', source: 'sms' }),
    row('in', 75000, { title: 'Incoming transfer', accountId: 'bank', type: 'income', source: 'sms' })];
  const result = project(rows);
  assert.equal(result.totalFils, 2500); assert.equal(result.receivedFils, 0); assert.equal(result.excludedCount, 4);
  const incoming = project(rows, 'Incoming transfer');
  assert.equal(incoming.receivedFils, 0); assert.equal(incoming.excludedCount, 1);
});
test('all-time, exact range and salary-month scopes use the real period implementation', () => {
  const modules = fixture(); const rows = [row('before', 100, { date: '2026-08-24' }),
    row('start', 200, { date: '2026-08-25' }), row('last', 300, { date: '2026-09-24' }),
    row('next', 400, { date: '2026-09-25' })];
  assert.equal(project(rows, 'Talabat', { mode: 'all' }, modules).totalFils, 1000);
  assert.equal(project(rows, 'Talabat', { mode: 'range', from: '2026-08-25', to: '2026-09-24' }, modules).totalFils, 500);
  modules['@/lib/format'].setMonthStartDay(25);
  assert.equal(project(rows, 'Talabat', { mode: 'month', key: '2026-08' }, modules).totalFils, 500);
});
test('cross-month receipts stay in the period when received, without rewriting past spend', () => {
  const rows = [row('purchase', 1999, { date: '2026-08-31' }), row('credit', 1999, { date: '2026-09-01', type: 'income' })];
  const august = project(rows, 'Talabat', { mode: 'month', key: '2026-08' });
  assert.equal(august.totalFils, 1999); assert.equal(august.receivedFils, 0);
  const september = project(rows); assert.equal(september.totalFils, 0); assert.equal(september.receivedFils, 1999);
  assert.equal(september.averageFils, null);
});
test('split purchases count their parent once and converted purchases use recorded ledger units', () => {
  const rows = [row('split', 10000, { splits: [{ category: 'dining', amountFils: 4000 }, { category: 'groceries', amountFils: 6000 }] }),
    row('fx', 3673, { originalCurrency: 'USD', originalAmountMinor: 1000, fxSource: 'bank' })];
  const result = project(rows); assert.equal(result.totalFils, 13673); assert.equal(result.spending.length, 2);
  assert.equal(result.hasConvertedAmounts, true);
});
test('sorting, edits, deletion and account visibility never rely on a stale global cache', () => {
  const rows = Object.freeze([Object.freeze(row('old', 100, { date: '2026-09-01' })),
    Object.freeze(row('late', 300, { ts: 300 })), Object.freeze(row('early', 200, { ts: 200 }))]);
  assert.deepEqual(Array.from(project(rows).spending, tx => tx.id), ['late', 'early', 'old']);
  assert.equal(project(rows.slice(1)).totalFils, 500);
  assert.equal(project(rows.map(tx => tx.id === 'late' ? { ...tx, amountFils: 350 } : tx)).totalFils, 650);
  assert.equal(project(rows.map(tx => ({ ...tx, accountId: 'hidden' }))).totalFils, 0);
});
test('Arabic, punctuation and reserved URL characters round-trip exactly', () => {
  const module = fixture()['@/lib/merchant-spending'];
  for (const name of ['مطعم عربي', 'R&D / Cafe? #2 + 20%', 'Talabat Business']) {
    const href = module.merchantSpendingHref(name);
    const url = new URL(href, 'https://example.test');
    assert.equal(url.pathname, '/merchant'); assert.equal(url.searchParams.get('name'), name);
    assert.equal([...url.searchParams.keys()].length, 1);
    assert.equal(project([row('x', 1, { title: name })], name).totalFils, 1);
  }
});
test('income source URLs preserve the exact identity and explicitly carry direction', () => {
  const module = fixture()['@/lib/merchant-spending'];
  for (const name of ['مطعم عربي', 'R&D / Cafe? #2 + 20%', 'Talabat sales']) {
    const url = new URL(module.merchantSpendingHref(name, 'income'), 'https://example.test');
    assert.equal(url.pathname, '/merchant'); assert.equal(url.searchParams.get('name'), name);
    assert.equal(url.searchParams.get('type'), 'income');
    assert.equal(module.merchantSpendingHref(name, 'expense'), module.merchantSpendingHref(name));
  }
});
test('large histories have exact totals and bounded matching results', () => {
  const rows = Array.from({ length: 50000 }, (_, i) => row(String(i), i + 1, { title: i % 10 ? 'Other merchant' : 'Talabat' }));
  const result = project(rows); assert.equal(result.spending.length, 5000);
  assert.equal(result.totalFils, 124980000);
});
test('unsafe sums fail rather than silently displaying rounded financial totals', () => {
  assert.throws(() => project([row('a', Number.MAX_SAFE_INTEGER), row('b', 1)]), /safe integer/);
});
for (const language of ['en', 'ar']) test(`${language}: entry details expose a labelled merchant action that closes before navigation`, () => {
  const h = createHarness({ language });
  const link = walk(h.renderDetail()).find(n => n.props?.testID === 'view-merchant-spending');
  assert.ok(link); assert.equal(link.props.accessibilityRole, 'button');
  assert.ok(text(link)); link.props.onPress();
  assert.deepEqual(h.events, [['close'], ['route', '/merchant?name=Talabat']]);
});
for (const language of ['en', 'ar']) test(`${language}: income entry details close before opening that income source`, () => {
  const h = createHarness({ language });
  const transaction = { ...h.state.transactions[1], title: 'Talabat sales', type: 'income', category: 'business' };
  const link = walk(h.renderDetail(transaction)).find(n => n.props?.testID === 'view-merchant-spending');
  assert.ok(link); assert.equal(link.props.accessibilityRole, 'button');
  assert.match(link.props.accessibilityLabel, language === 'ar' ? /الدخل/ : /income/);
  assert.equal(/merchant|التاجر/i.test(link.props.accessibilityLabel), false);
  link.props.onPress();
  assert.deepEqual(h.events, [['close'], ['route', '/merchant?name=Talabat%20sales&type=income']]);
});
test('Spending exposes the merchant directory without adding a fifth main tab', () => {
  const h = createHarness(); const link = walk(h.render('flow')).find(n => n.props?.testID === 'browse-merchant-spending');
  assert.ok(link); link.props.onPress(); assert.deepEqual(h.events, [['route', '/merchants']]);
  assert.equal(walk(h.tabTree('flow')).filter(n => n.props?.accessibilityRole === 'tab').length, 4);
});
