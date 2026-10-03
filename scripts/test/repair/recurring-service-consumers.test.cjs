'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const sourceLoad = require('./load-typescript.cjs');
const { createHarness, walk, text } = require('./reference-harness.cjs');
const root = path.resolve(__dirname, '../../..');
const source = (name, deps = {}) => {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, `src/lib/${name}.ts`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)(id => {
    if (Object.hasOwn(deps, id)) return deps[id];
    const compiled = path.join(__dirname, '../build', `${id.slice('@/lib/'.length)}.js`);
    return fs.existsSync(compiled) ? require(compiled) : source(id.slice('@/lib/'.length), deps);
  }, module, module.exports);
  return module.exports;
};
const subscriptions = source('subscriptions');
const dependencies = { '@/lib/subscriptions': subscriptions };
const reminders = source('reminders', dependencies);
const home = source('leaving-soon', dependencies);
const widgets = source('widget-ledger', dependencies);
const snapshot = source('widget-snapshot');
const patterns = source('assistant-patterns', dependencies);
const now = new Date(2026, 8, 6, 12);
const key1 = 'service:["e&","consumer:1111"]';
const key2 = 'service:["e&","consumer:2222"]';
const account = { id: 'bank', name: 'Bank', kind: 'bank', openingFils: 0, createdAt: 1 };
const rows = ['06', '07', '08'].flatMap(month => [
  { id: `${month}-one`, type: 'expense', title: 'Etisalat Quickpay', category: 'telecom', amountFils: 10000,
    accountId: 'bank', source: 'sms', date: `2026-${month}-10`, paymentFlowSide: 'receipt', billIdentity: 'consumer:1111' },
  { id: `${month}-two`, type: 'expense', title: 'Etisalat Digital App', category: 'telecom', amountFils: 20000,
    accountId: 'bank', source: 'sms', date: `2026-${month}-20`, paymentFlowSide: 'receipt', billIdentity: 'consumer:2222' },
]);
const detected = subscriptions.detectSubscriptions(rows, [], now);
const state = (patch = {}) => ({ accounts: [account], transactions: rows, bills: [], cardDues: [], budgets: [],
  notSubscriptions: [], cancelledSubscriptions: {}, ...patch });
const byId = (tree, id) => walk(tree).find(node => node.props?.testID === id);
function harness(patch = {}, states = {}) {
  const h = createHarness({ platform: 'web', state: state(patch), states });
  h.deps['@/hooks/use-today'] = { useToday: () => now };
  h.deps['@/lib/subscriptions'] = { ...subscriptions, peekSubscriptionDetection: () => detected };
  return h;
}
function sheet(h, subscription) {
  h.deps['@/components/ui/section-header'] = { SectionHeader: props => h.jsx('SectionHeader', props) };
  h.local('@/components/ui/layout');
  return sourceLoad(path.join(root, 'src/components/bill-detail-sheet.tsx'), h.deps).BillDetailSheet({ subscription, onClose() {} });
}

test('Home, widget, and native reminder projections preserve both service identities and dates', () => {
  const s = state();
  const outgoing = home.leavingSoon(s, now, { withinDays: 30, detectedSubscriptions: detected });
  assert.deepEqual(outgoing.map(row => [row.id, row.dateISO, row.amountFils]), [
    [`sub-${key1}`, '2026-09-10', 10000], [`sub-${key2}`, '2026-09-20', 20000],
  ]);
  const native = reminders.buildPaymentReminders(s, now, 24, detected).filter(row => row.kind === 'subscription');
  assert.deepEqual(native.map(row => [row.id, row.dateISO]), [[`sub-${key1}`, '2026-09-09'], [`sub-${key2}`, '2026-09-19']]);
  assert.match(native[0].title, /1111/);
  assert.match(native[1].title, /2222/);
  const widget = widgets.widgetUpcomingForLedger(s, now, detected);
  assert.equal(widget.length, 2);
  assert.deepEqual(widget.map(row => [row.dateISO, row.amountFils]), [['2026-09-10', 10000], ['2026-09-20', 20000]]);
  assert.equal(widget[0].title, 'E&');
  assert.equal(widget[1].title, 'E&');
  assert.match(widget[0].displayLabel, /1111/);
  assert.match(widget[1].displayLabel, /2222/);
  const output = snapshot.buildWidgetSnapshot({ now, currency: 'AED', exponent: 2, language: 'en', hideAmounts: false,
    today: { todayFils: 0, todayCount: 0, week: [], budget: null }, upcoming: widget });
  assert.deepEqual(output.bills.map(bill => [bill.title, bill.logoId]), [
    ['E& · •••• 1111', 'etisalat'], ['E& · •••• 2222', 'etisalat'],
  ]);
});

test('historical bill receipts do not make the next predicted renewal a confirmed obligation', () => {
  const tree = harness().render('bills');
  const agenda = byId(tree, 'bills-and-cards');
  const labels = walk(agenda).filter(node => node.type === 'Pressable' &&
    /1111|2222/.test(node.props?.accessibilityLabel ?? '')).map(node => node.props.accessibilityLabel);
  assert.equal(labels.length, 2);
  for (const label of labels) assert.match(label, /estimat/i);
  const upcoming = widgets.widgetUpcomingForLedger(state(), now, detected);
  assert.ok(upcoming.length >= 2);
  assert.ok(upcoming.every(item => item.estimated === true));
});

test('tracking or dismissing one service never suppresses the sibling across projections', () => {
  const bill = { id: 'tracked', title: 'E&', category: 'telecom', amountFils: 10000, dueDay: 10,
    importIdentity: 'consumer:1111', paidMonths: [] };
  for (const patch of [{ bills: [bill] }, { cancelledSubscriptions: { [key1]: '2026-09-06' } }, { notSubscriptions: [key1] }]) {
    const s = state(patch);
    const native = reminders.buildPaymentReminders(s, now, 24, detected).filter(row => row.kind === 'subscription');
    assert.deepEqual(native.map(row => row.id), [`sub-${key2}`]);
    const outgoing = home.leavingSoon(s, now, { withinDays: 30, detectedSubscriptions: detected }).filter(row => row.kind === 'subscription');
    assert.deepEqual(outgoing.map(row => row.id), [`sub-${key2}`]);
    const widget = widgets.widgetUpcomingForLedger(s, now, detected);
    assert.ok(widget.some(row => row.amountFils === 20000 && row.dateISO === '2026-09-20'));
    if (!patch.bills) assert.equal(widget.length, 1);
  }
  const manual = state({ bills: [{ ...bill, importIdentity: undefined }] });
  assert.equal(reminders.buildPaymentReminders(manual, now, 24, detected).filter(row => row.kind === 'subscription').length, 0);
});

test('the second Bills row opens its own history and creates only its scoped reminder', () => {
  const states = {};
  const h = harness({}, states);
  const tree = h.render('bills');
  const timeline = byId(tree, 'bills-timeline');
  // The band shows the next payment; it speaks every one in the window.
  assert.match(timeline.props.accessibilityLabel, /1111/);
  assert.match(timeline.props.accessibilityLabel, /2222/);
  const row = walk(tree).find(node => node.type === 'Pressable' && /2222/.test(node.props?.accessibilityLabel ?? ''));
  assert.ok(row, 'second service must have a separately labelled row');
  row.props.onPress();
  const selection = h.events.find(event => event[0] === 'state' && event[2]?.billIdentity === 'consumer:2222');
  assert.ok(selection);
  states[selection[1]] = selection[2];
  const opened = h.render('bills');
  byId(opened, 'bill-detail-remind').props.onPress();
  const added = h.events.find(event => event[0] === 'addBill');
  assert.equal(added[1].title, 'E&');
  assert.equal(added[1].importIdentity, 'consumer:2222');
  assert.equal(added[1].amountFils, 20000);
  const detail = sheet(harness(), selection[2]);
  assert.match(text(detail), /2222/);
  const history = text(byId(detail, 'subscription-history-scroll'));
  assert.match(history, /2026-08-20/);
  assert.doesNotMatch(history, /2026-08-10|AED 100/);
  assert.match(history, /AED 200/);
});

test('drawer cancellation and undo use the scoped service key', () => {
  const scoped = { ...detected.find(sub => sub.billIdentity === 'consumer:2222'), group: 'subscription' };
  const h = harness({}, { 0: 'cancelled' });
  const detail = sheet(h, scoped);
  const confirm = walk(detail).find(node => node.props?.name === 'ConfirmSheet');
  assert.ok(confirm);
  confirm.props.onConfirm();
  assert.deepEqual(h.events.find(event => event[0] === 'setSubscriptionCancelled'), ['setSubscriptionCancelled', key2, '2026-09-06']);
  const undo = harness({ cancelledSubscriptions: { 'e&': '2026-09-06' } });
  const cancelled = sheet(undo, scoped);
  const stillPaying = walk(byId(cancelled, 'bill-detail-cancelled')).find(node => typeof node.props?.onPress === 'function');
  stillPaying.props.onPress();
  assert.deepEqual(undo.events.find(event => event[0] === 'setSubscriptionCancelled'), ['setSubscriptionCancelled', key2, null]);
});

test('assistant recurring changes use each service baseline and scoped dismissal', () => {
  const history = ['06', '07', '08', '09'].flatMap(month => ['1111', '2222'].map(tail => ({
    id: `${month}-${tail}`, title: 'E&', category: 'telecom', type: 'expense', accountId: 'bank', source: 'sms',
    date: `2026-${month}-01`, amountFils: month === '09' && tail === '1111' ? 15000 : 10000,
    billIdentity: `consumer:${tail}`,
  })));
  const found = patterns.findRecurringChanges(history, history.slice(-2), now);
  assert.equal(found.length, 1);
  assert.equal(found[0].baselineFils, 10000);
  assert.deepEqual(found[0].transactionIds, ['09-1111']);
  assert.deepEqual(patterns.findRecurringChanges(history, history.slice(-2), now, [key1]), []);
  assert.equal(patterns.findRecurringChanges(history, history.slice(-2), now, [key2]).length, 1);
});
