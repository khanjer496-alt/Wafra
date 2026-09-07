'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { createHarness, walk, text } = require('./reference-harness.cjs');
const projection = load(path.resolve(__dirname, '../../../src/lib/reference-presentation.ts'));
const nodeById = (tree, id) => walk(tree).find(n => n.props?.testID === id);

test('category share uses period spending, independently of its budget', () => {
  assert.equal(projection.spendingShare(25000, 100000), .25);
  assert.equal(projection.spendingShareLabel(.25, 'en'), '25%');
  const rows = projection.spendingCategoryRows({ byCategory: [{ category: 'dining', totalFils: 25000 }] },
    [{ category: 'dining', limitFils: 10000 }], true);
  assert.equal(rows[0].ratio, 2.5);
  assert.equal(projection.spendingShare(rows[0].spentFils, 100000), .25);
});
test('zero, nonfinite and tiny shares remain truthful and readable', () => {
  for (const [spent, total] of [[0, 0], [12, 0], [Infinity, 100], [20, NaN], [-1, 100]]) {
    assert.equal(projection.spendingShare(spent, total), 0);
  }
  assert.equal(projection.spendingShareLabel(.00001, 'en'), '<0.1%');
  assert.equal(projection.spendingShareLabel(0, 'en'), '0%');
  assert.match(projection.spendingShareLabel(.00001, 'ar'), /أقل من/);
});
test('every visible category has an explicit spending share, including categories without limits', () => {
  const tree = createHarness().render('flow');
  assert.match(text(nodeById(tree, 'spending-share-dining')), /11.6%\s+of spending/);
  assert.match(text(nodeById(tree, 'spending-share-other')), /27.8%\s+of spending/);
  assert.match(text(nodeById(tree, 'spending-category-dining')), /41\s*%\s+of limit used/);
});
test('filtering budgets does not relabel the remaining category as 100% of spending', () => {
  const tree = createHarness({ states: { 1: 'unlimited' } }).render('flow');
  assert.match(text(nodeById(tree, 'spending-share-other')), /27.8%/);
  assert.equal(nodeById(tree, 'spending-share-dining'), undefined);
});
test('zero-spend budget categories render 0% rather than NaN or an invented expense', () => {
  const h = createHarness({ state: { transactions: [] } });
  const tree = h.render('flow');
  assert.match(text(nodeById(tree, 'spending-share-dining')), /0%\s+of spending/);
  assert.doesNotMatch(text(tree), /NaN|Infinity/);
});
test('Home keeps accounts out of its hero and exposes one Add and one Settings action', () => {
  const h = createHarness(); const tree = h.render('home');
  assert.ok(nodeById(tree, 'home-spending-total'));
  assert.ok(nodeById(tree, 'home-income-summary'));
  assert.equal(nodeById(tree, 'reference-quick-actions'), undefined);
  assert.doesNotMatch(text(tree), /Recorded balances|Net after spending/);
  for (const label of ['Add', 'Settings']) {
    assert.equal(walk(tree).filter(n => n.props?.accessibilityLabel === label && n.props.onPress).length, 1);
  }
});
test('Home renders at most five recent transactions without losing the full activity route', () => {
  const h = createHarness();
  const project = h.deps['@/lib/dashboard-projection'].projectDashboard;
  h.deps['@/lib/dashboard-projection'].projectDashboard = () => ({ ...project(),
    activityRows: Array.from({ length: 20 }, (_, i) => ({ ...h.state.transactions[0], id: `fixture-${i}`, title: `Fixture ${i}` })),
  });
  const activity = nodeById(h.render('home'), 'journal-activity');
  assert.equal(walk(activity).filter(n => n.props?.onPress && n.props?.accessibilityLabel?.includes('Fixture')).length, 5);
  const all = walk(activity).find(n => n.props?.onPress && text(n).includes(h.deps['@/lib/i18n'].t('allActivity')));
  assert.ok(all); all.props.onPress(); assert.deepEqual(h.events.at(-1), ['route', '/transactions']);
});
test('Bills separates detected subscriptions, utility/telecom reminders and card payments', () => {
  const tree = createHarness().render('bills');
  const subscriptions = text(nodeById(tree, 'bills-subscriptions'));
  const utilities = text(nodeById(tree, 'bills-utilities'));
  const cards = text(nodeById(tree, 'bills-cards'));
  assert.match(subscriptions, /Netflix/); assert.match(subscriptions, /Spotify/);
  assert.doesNotMatch(subscriptions, /DEWA|Etisalat|NBD credit/);
  assert.match(utilities, /DEWA/); assert.match(utilities, /Etisalat/);
  assert.doesNotMatch(utilities, /Netflix|Spotify/);
  assert.match(cards, /NBD credit card/);
});
test('a manually tracked detected subscription is shown once, in subscriptions', () => {
  const h = createHarness();
  h.state.bills.push({ id: 'netflix', title: 'Netflix', category: 'entertainment', amountFils: 4900, dueDay: 9, paidMonths: [] });
  const tree = h.render('bills');
  const rows = walk(nodeById(tree, 'bills-subscriptions')).filter(n => n.props?.accessibilityLabel?.startsWith('Netflix.') && n.props.onPress);
  assert.equal(rows.length, 1);
  assert.match(rows[0].props.accessibilityLabel, /49.00/);
  assert.doesNotMatch(rows[0].props.accessibilityLabel, /Estimated/);
});
test('entertainment/software expenses are not automatically presented as subscriptions', () => {
  for (const category of ['entertainment', 'software', 'rent']) {
    assert.equal(projection.paymentGroupFor({ kind: 'bill', category }), 'other');
  }
  assert.equal(projection.paymentGroupFor({ kind: 'bill', category: 'telecom' }), 'utilities');
  assert.equal(projection.paymentGroupFor({ kind: 'recurring', category: 'loan' }), 'loans');
});
test('estimated, confirmed overdue and paid semantics survive payment-type grouping', () => {
  const make = (id, extra) => ({ id, title: id, category: 'utilities', kind: 'bill', dateISO: '2026-09-01',
    daysLeft: -1, amountFils: 100, paid: false, estimated: false, ...extra });
  const items = [make('debt'), make('prediction', { estimated: true }), make('paid', { paid: true })];
  const before = JSON.stringify(items);
  const utilities = projection.groupPaymentKinds(items, true).find(g => g.key === 'utilities');
  assert.deepEqual(Array.from(utilities.sections, s => s.key), ['overdue', 'expected-earlier', 'paid']);
  assert.equal(projection.groupPaymentKinds(items, false).find(g => g.key === 'utilities').sections.length, 2);
  assert.equal(JSON.stringify(items), before);
});
test('empty Bills retains clearly separated sections without inventing reminders', () => {
  const tree = createHarness({ empty: true }).render('bills');
  assert.match(text(nodeById(tree, 'bills-subscriptions')), /No subscription renewals/);
  assert.match(text(nodeById(tree, 'bills-utilities')), /No utility bills/);
});
