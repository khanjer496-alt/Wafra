'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader } = require('../../universal-test/load-ts.cjs');
const load = createLoader();
const { projectCardActivity } = load('@/lib/card-activity');
const { setMonthStartDay } = load('@/lib/format');
const period = { mode: 'month', key: '2026-09' };
const card = { id: 'credit', kind: 'card', cardType: 'credit', name: 'Credit', bankName: 'Bank', last4: '1234', openingFils: 0 };
const tx = (id, amountFils, extra = {}) => ({ id, amountFils, title: id, accountId: card.id, type: 'expense', category: 'shopping', date: '2026-09-10', source: 'manual', ...extra });
const state = (transactions = [], extra = {}) => ({ accounts: [card], transactions, cardDues: [], ...extra });

test('purchases, credits and canonical repayments stay separate with all activity retained', () => {
  setMonthStartDay(1);
  const s = state([tx('Purchase', 10000), tx('Refund', 2000, { type: 'income' }),
    tx('Card payment', 8000, { type: 'income', isTransfer: true, cardPaymentSide: 'receipt' })]);
  const view = projectCardActivity(s, card, period);
  assert.equal(view.spendingFils, 10000); assert.equal(view.creditsFils, 2000); assert.equal(view.paymentsFils, 8000);
  assert.equal(view.rows.length, 3); assert.equal(view.figure, null);
});
test('same-bank same-last-four sibling never leaks its purchases, payment or statements', () => {
  const other = { ...card, id: 'another' };
  const s = state([tx('Own', 1500), tx('Other', 2000, { accountId: other.id }),
    tx('Card payment', 9000, { accountId: other.id, type: 'income', isTransfer: true })], {
      accounts: [card, other], cardDues: [{ id: 'other-due', accountId: other.id, dueDate: '2026-09-20', totalDueFils: 9000, minDueFils: 500, paidFils: 0 }],
    });
  const view = projectCardActivity(s, card, period);
  assert.deepEqual(view.rows.map(r => r.id), ['Own']); assert.equal(view.paymentsFils, 0); assert.equal(view.figure, null);
});
test('payment debit and receipt corroborate one canonical payment without counting as purchases or credits', () => {
  const s = state([
    tx('Debit', 8000, { title: 'Card payment', isTransfer: true, cardPaymentSide: 'debit' }),
    tx('Receipt', 8000, { title: 'Card payment', type: 'income', isTransfer: true, cardPaymentSide: 'receipt' }),
  ]);
  const view = projectCardActivity(s, card, period);
  assert.equal(view.rows.length, 1); assert.equal(view.rows[0].id, load('@/lib/cards').cardStatementView(s, card.id).payments[0].id);
  assert.equal(view.paymentsFils, 8000); assert.equal(view.spendingFils, 0); assert.equal(view.creditsFils, 0);
});
test('cash movements and outgoing transfers are browsable but not purchase or repayment totals', () => {
  const view = projectCardActivity(state([tx('ATM', 10000, { category: 'cash-withdrawal' }),
    tx('Outgoing cash transfer', 5000, { isTransfer: true }),
    tx('Cashback', 555, { type: 'income' })]), card, period);
  assert.equal(view.rows.length, 3); assert.equal(view.spendingFils, 0); assert.equal(view.paymentsFils, 0); assert.equal(view.creditsFils, 555);
});
test('selected period obeys salary-day boundaries and explicit inclusive ranges', () => {
  setMonthStartDay(25);
  try {
    const s = state([tx('before', 100, { date: '2026-09-24' }), tx('first', 200, { date: '2026-09-25' }),
      tx('last', 300, { date: '2026-10-24' }), tx('after', 400, { date: '2026-10-25' })]);
    assert.deepEqual(projectCardActivity(s, card, period).rows.map(r => r.id), ['last', 'first']);
    assert.equal(projectCardActivity(s, card, period).spendingFils, 500);
    assert.deepEqual(projectCardActivity(s, card, { mode: 'range', from: '2026-09-24', to: '2026-09-25' }).rows.map(r => r.id), ['first', 'before']);
  } finally { setMonthStartDay(1); }
});
test('paid statements do not hide later purchases or call card debt-free', () => {
  const s = state([tx('New purchase', 3000, { date: '2026-09-22' })], {
    cardDues: [{ id: 'settled', accountId: card.id, dueDate: '2026-09-20', totalDueFils: 10000, minDueFils: 500, paidFils: 10000, paidAt: 1789905600000 }],
  });
  const view = projectCardActivity(s, card, period);
  assert.equal(view.spendingFils, 3000); assert.equal(view.rows[0].id, 'New purchase');
  assert.deepEqual(view.figure, { label: 'statementRemaining', fils: 0 });
});
test('available headroom never becomes a limit or outstanding figure; archived card retains its activity', () => {
  const a = { ...card, archived: true, snapshotKind: 'limit', snapshotFils: 80000 };
  const view = projectCardActivity(state([tx('Old purchase', 1200)], { accounts: [a] }), a, period);
  assert.equal(view.figure, null); assert.equal(view.spendingFils, 1200);
  const quoted = { ...a, snapshotKind: 'outstanding', snapshotFils: -3400 };
  assert.deepEqual(projectCardActivity(state([], { accounts: [quoted] }), quoted, period).figure, { label: 'reportedOutstanding', fils: 3400 });
});

const { createHarness, walk, text } = require('./reference-harness.cjs');
const source = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
function screen(options = {}) {
  const h = createHarness({ params: { id: 'credit' }, ...options });
  h.deps['react-native'].FlatList = 'FlatList';
  h.deps['@/lib/card-activity'] = { projectCardActivity };
  h.local('@/lib/card-activity-copy', 'src/lib/card-activity-copy.ts');
  return { h, tree: source(path.join(root, 'src/app/card.tsx'), h.deps).default() };
}
const byID = (tree, id) => walk(tree).find(n => n.props?.testID === id);
for (const language of ['en', 'ar']) test(`card route preserves entry, period, all-transactions and statements controls in ${language}`, () => {
  const { h, tree } = screen({ language, largeText: true, state: { accounts: [card], transactions: [tx('Netflix', 4000)] } });
  assert.ok(byID(tree, 'card-screen')); assert.ok(byID(tree, 'card-spending'));
  byID(tree, 'card-all-transactions').props.onPress();
  byID(tree, 'card-statements').props.onPress();
  assert.deepEqual(h.events.filter(e => e[0] === 'route'), [['route', '/card?id=credit&all=1'], ['route', '/cards?card=credit']]);
  const row = walk(tree).find(n => n.type === 'Pressable' && n.props?.onPress && String(n.props.accessibilityLabel).includes('Netflix'));
  assert.ok(row, 'card activity has an entry detail action'); row.props.onPress();
  assert.ok(h.events.some(e => e[0] === 'state' && e[2]?.title === 'Netflix'));
  const nav = byID(tree, 'card-screen').props.nav.actions.find(a => a.testID === 'card-period'); assert.ok(nav); nav.onPress();
  assert.ok(h.events.some(e => e[0] === 'state' && e[2] === true));
  assert.ok(text(tree).includes(language === 'ar' ? 'نشاط' : 'activity'));
});
test('card route rejects bank ids and shows empty-period state without losing navigation', () => {
  const missing = screen({ params: { id: 'enbd' } });
  assert.ok(text(missing.tree).includes('no longer available'));
  const empty = screen({ state: { transactions: [] } });
  assert.ok(text(empty.tree).includes('No transactions recorded')); assert.ok(byID(empty.tree, 'card-all-transactions'));
});
test('Wallet opens a card activity route while the dedicated card statements entry stays available', () => {
  const h = createHarness(); const tree = h.render('wallet');
  const row = walk(tree).find(n => n.props?.testID === 'wallet-card-credit');
  assert.ok(row, 'wallet account card is rendered');
  const open = walk(row).find(n => n.type === 'Pressable' && n.props?.onPress); assert.ok(open); open.props.onPress();
  assert.deepEqual(h.events.find(e => e[0] === 'route'), ['route', '/card?id=credit']);
});

test('full card history is virtualized with the identical account and period projection', () => {
  const rows = Array.from({ length: 80 }, (_, i) => tx(`purchase-${i}`, 123, { date: '2026-09-10' }));
  rows.push(tx('old', 999, { date: '2026-08-10' }), tx('other', 999, { accountId: 'enbd' }));
  const { h, tree } = screen({ params: { id: 'credit', all: '1' }, state: { accounts: [card], transactions: rows } });
  const list = byID(tree, 'card-all-list'); assert.ok(list);
  assert.equal(list.props.data.length, 80); assert.equal(list.props.initialNumToRender, 12);
  assert.equal(byID(tree, 'card-all-screen').props.scroll, false);
  const rendered = list.props.renderItem({ item: list.props.data[79] });
  const row = walk(rendered).find(n => n.type === 'Pressable' && n.props?.onPress);
  assert.ok(row); row.props.onPress();
  assert.ok(h.events.some(e => e[0] === 'state' && e[2]?.id === 'purchase-79'));
});
test('debit card shows neutral balance and activity without credit statements actions', () => {
  const debit = { ...card, cardType: 'debit', openingFils: 10000 };
  const { tree } = screen({ state: { accounts: [debit], transactions: [tx('Purchase', 1200)] } });
  assert.equal(byID(tree, 'card-statements'), undefined);
  assert.equal(byID(tree, 'card-payments'), undefined);
  assert.ok(byID(tree, 'card-known-figure'));
  assert.ok(text(tree).includes('Balance')); assert.ok(!text(tree).includes('Reported balance'));
});
test('provisional import receipt keeps confirmed internal movement out of captured spending', () => {
  const s = state([tx('Own movement', 5000)], {
    transferInternalIds: ['Own movement'], transferNormalizationVersion: 0,
    historyImport: { status: 'running' },
  });
  const view = projectCardActivity(s, card, period);
  assert.equal(view.rows.length, 1); assert.equal(view.spendingFils, 0);
  assert.ok(view.internal.has('Own movement'));
});
