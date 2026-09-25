'use strict';
// Accounts and the account detail screen, rendered from the shipping source
// through the reference harness. Synthetic ledger only.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { createHarness, walk, text } = require('./reference-harness.cjs');

const root = path.resolve(__dirname, '../../..');
const byId = (tree, id) => walk(tree).find((node) => node.props?.testID === id);
const press = (node) => node.props.onPress();
const QUIET_TS = Date.parse('2026-08-20T09:00:00Z');

test('Accounts keeps the Available balances headline and never merges a net figure', () => {
  const tree = createHarness().render('wallet');
  const all = text(tree);
  // The i18n key is `availableBalances`; its words are "Recorded balances".
  assert.ok(byId(tree, 'reference-account-balance'));
  assert.match(all, /Recorded balances/);
  assert.doesNotMatch(all, /after card balances|Left after that|net worth/i);
});

test('a bank account row opens its detail screen, and a card keeps its statement sheet', () => {
  const h = createHarness();
  const tree = h.render('wallet');
  const rows = walk(tree).filter((node) => node.type === 'Pressable' && /^Emirates NBD\./.test(node.props?.accessibilityLabel ?? ''));
  press(rows[0]);
  const card = walk(tree).find((node) => node.type === 'Pressable' && /^NBD credit card\./.test(node.props?.accessibilityLabel ?? ''));
  press(card);
  assert.deepEqual(h.events.filter((e) => e[0] === 'route').map((e) => e[1]), ['/account?id=enbd', '/cards?card=credit']);
});

test('a card with an open statement says Mark paid, offers the stated minimum, and labels captured spending', () => {
  const h = createHarness();
  const tree = h.render('wallet');
  assert.match(text(byId(tree, 'wallet-card-statement')), /Statement AED 2,800/);
  assert.match(text(byId(tree, 'wallet-mark-paid-credit')), /^Mark paid$/);
  assert.match(text(byId(tree, 'wallet-mark-minimum-credit')), /^Mark minimum paid$/);
  assert.doesNotMatch(text(tree), /Pay in full|Pay minimum/);
  // No limit entered: no usage bar, whatever the bank quoted.
  assert.equal(byId(tree, 'wallet-card-usage'), undefined);
  // Mark paid opens the payment sheet (with its own confirmation), never commits from the row.
  press(byId(tree, 'wallet-mark-paid-credit'));
  assert.deepEqual(h.events.filter((e) => e[0] === 'payCardDue'), []);
  assert.ok(h.events.some((e) => e[0] === 'state' && e[2]?.choice === 'full' && e[2]?.due?.id === 'statement'));
});

test('an estimated minimum is never offered on the card row', () => {
  const h = createHarness({ state: { cardDues: [{ id: 'statement', accountId: 'credit', dueDate: '2026-09-10',
    totalDueFils: 280000, minDueFils: 14000, minDueEstimated: true, paidFils: 0 }] } });
  const tree = h.render('wallet');
  assert.ok(byId(tree, 'wallet-mark-paid-credit'));
  assert.equal(byId(tree, 'wallet-mark-minimum-credit'), undefined);
});

test('a usage bar appears only with a limit the user entered', () => {
  const h = createHarness();
  h.state.accounts = h.state.accounts.map((a) => a.id === 'credit' ? { ...a, creditLimitFils: 1000000 } : a);
  const tree = h.render('wallet');
  assert.match(text(byId(tree, 'wallet-card-usage')), /AED 2,800 used of your AED 10,000 limit/);
});

test('a quiet account offers Update balance and Hide inline', () => {
  const h = createHarness();
  h.state.accounts = h.state.accounts.map((a) => a.id === 'adcb' ? { ...a, snapshotTs: QUIET_TS } : a);
  const tree = h.render('wallet');
  assert.ok(byId(tree, 'wallet-quiet-actions'));
  press(byId(tree, 'wallet-update-balance-adcb'));
  press(byId(tree, 'wallet-hide-adcb'));
  assert.deepEqual(h.events.filter((e) => e[0] === 'route').map((e) => e[1]), ['/account?id=adcb&set=balance']);
  assert.deepEqual(JSON.parse(JSON.stringify(h.events.filter((e) => e[0] === 'editAccount'))), [['editAccount', 'adcb', { archived: true }]]);
  // A fresh account has no such actions.
  assert.equal(byId(tree, 'wallet-update-balance-enbd'), undefined);
});

test('Add activity lists statement import, add by hand and paste, each to an existing screen', () => {
  const h = createHarness({ platform: 'ios' });
  const tree = h.render('wallet');
  for (const key of ['statement', 'manual', 'paste']) press(byId(tree, `wallet-add-${key}`));
  assert.deepEqual(h.events.filter((e) => e[0] === 'route').map((e) => e[1]),
    ['/statement-import', '/add-transaction', '/import-sms']);
  assert.doesNotMatch(text(byId(tree, 'wallet-add-activity')), /read on this phone|encrypted/i);
});

function renderAccount(h, params) {
  h.deps['expo-router'].useLocalSearchParams = () => params;
  return load(path.join(root, 'src/app/account.tsx'), h.deps).default();
}

test('account detail shows the reported balance, who reported it, and recorded in/out — no chart', () => {
  const h = createHarness();
  const tree = renderAccount(h, { id: 'enbd' });
  assert.match(text(byId(tree, 'account-detail-balance')), /Latest balance[\s\S]*25,000[\s\S]*Bank alert/);
  const flow = text(byId(tree, 'account-detail-flow'));
  assert.match(flow, /Recorded in this month/);
  assert.match(flow, /Recorded out this month/);
  assert.match(text(tree), /Not a bank statement/);
  assert.equal(walk(tree).some((n) => /Chart|Curve|PairedBars/.test(String(n.type)) || /history/i.test(n.props?.testID ?? '')), false);
  press(byId(tree, 'account-see-all'));
  assert.deepEqual(h.events.filter((e) => e[0] === 'route').map((e) => e[1]), ['/transactions?account=enbd']);
});

test('a balance the user set reads "Set by you", never "Bank alert"', () => {
  const h = createHarness();
  const ts = Date.parse('2026-09-15T08:00:00Z');
  h.state.accounts = h.state.accounts.map((a) => a.id === 'enbd' ? { ...a, snapshotTs: ts, manualSnapshotTs: ts } : a);
  const tree = renderAccount(h, { id: 'enbd' });
  const balance = text(byId(tree, 'account-detail-balance'));
  assert.match(balance, /Set by you/);
  assert.doesNotMatch(balance, /Bank alert/);
});

test('Set today\'s balance is offered, and the quiet-row shortcut opens it straight away', () => {
  const h = createHarness();
  const tree = renderAccount(h, { id: 'cash', set: 'balance' });
  assert.ok(byId(tree, 'account-set-balance'));
  const sheet = walk(tree).find((n) => n.type === 'Sheet' && n.props?.title === 'Set today’s balance');
  assert.ok(sheet, 'the quiet-row shortcut opens the sheet straight away');
});

const goals = [{ id: 'umrah', title: 'Umrah trip', emoji: 'plane', targetFils: 500000, savedFils: 320000 }];

test('a goal row on Accounts opens the goal screen', () => {
  const h = createHarness({ state: { goals } });
  press(byId(h.render('wallet'), 'wallet-goal-umrah'));
  assert.deepEqual(h.events.filter((e) => e[0] === 'route').map((e) => e[1]), ['/goal?id=umrah']);
});

test('the goal screen shows saved against target, says no money moves, and invents no pace', () => {
  const h = createHarness({ state: { goals } });
  h.deps['expo-router'].useLocalSearchParams = () => ({ id: 'umrah' });
  const tree = load(path.join(root, 'src/app/goal.tsx'), h.deps).default();
  const hero = text(byId(tree, 'goal-progress'));
  assert.match(hero, /64%/);
  assert.match(hero, /AED 3,200.00 of AED 5,000.00/);
  assert.match(hero, /AED 1,800.00 to go/);
  assert.match(text(byId(tree, 'goal-no-money-moves')), /No money moves between your accounts/);
  assert.doesNotMatch(text(tree), /reaches it by|behind|a month|on track|Contributions/i);
  assert.match(text(tree), /Add money[\s\S]*Edit goal/);
});

test('Arabic account detail is Arabic', () => {
  const h = createHarness({ language: 'ar' });
  const tree = renderAccount(h, { id: 'enbd' });
  assert.match(text(byId(tree, 'account-detail-flow')), /المسجّل وارداً هذا الشهر/);
});
