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

test('a cold Set balance link opens the sheet once the account loads, and only once', () => {
  const h = createHarness();
  // Hooks that persist across renders, like a mounted component's.
  const slots = [];
  let slot = 0;
  let effects = [];
  Object.assign(h.deps.react, {
    useState: (initial) => {
      const at = slot++;
      if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial;
      return [slots[at], (value) => { slots[at] = value; }];
    },
    useRef: (value) => {
      const at = slot++;
      if (!(at in slots)) slots[at] = { current: value };
      return slots[at];
    },
    useEffect: (effect) => { effects.push(effect); },
  });
  const accounts = h.state.accounts;
  const render = () => {
    slot = 0;
    effects = [];
    const tree = renderAccount(h, { id: 'cash', set: 'balance' });
    for (const effect of effects) effect();
    return tree;
  };
  const sheetOpen = (tree) => walk(tree).some((n) => n.type === 'Sheet' && n.props?.title === 'Set today’s balance');
  h.state.accounts = [];
  assert.equal(sheetOpen(render()), false, 'no account yet');
  h.state.accounts = accounts;
  render();
  assert.equal(sheetOpen(render()), true, 'opens when the account arrives');
  const open = walk(render()).find((n) => n.type === 'Sheet' && n.props?.title === 'Set today’s balance');
  open.props.onClose();
  assert.equal(sheetOpen(render()), false, 'closed by the user');
  assert.equal(sheetOpen(render()), false, 'and it stays closed');
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

/* ── Bills ─────────────────────────────────────────────────────────── */

const gym = { title: 'City Gym', category: 'entertainment', lastAmountFils: 3900, avgAmountFils: 3900, monthlyEquivalentFils: 3900,
  priorTypicalFils: 3900, cadence: 'monthly', status: 'stopped', group: 'subscription', nextExpectedISO: '2026-07-20',
  lastChargedISO: '2026-06-20', chargeCount: 5, paymentHistory: false, priceIncreased: false };
const spotifyUp = { title: 'Spotify', category: 'entertainment', lastAmountFils: 1199, avgAmountFils: 1199, monthlyEquivalentFils: 1199,
  priorTypicalFils: 1099, cadence: 'monthly', status: 'active', group: 'subscription', nextExpectedISO: '2026-09-18',
  lastChargedISO: '2026-08-18', chargeCount: 6, paymentHistory: false, priceIncreased: true };
const netflix = { title: 'Netflix', category: 'entertainment', lastAmountFils: 1549, avgAmountFils: 1549, monthlyEquivalentFils: 1549,
  priorTypicalFils: 1549, cadence: 'monthly', status: 'active', group: 'subscription', nextExpectedISO: '2026-09-12',
  lastChargedISO: '2026-08-12', chargeCount: 6, paymentHistory: false, priceIncreased: false };

function billsWith(detected, options = {}) {
  const h = createHarness({ platform: 'ios', ...options });
  const real = h.deps['@/lib/subscriptions'];
  h.deps['@/lib/subscriptions'] = { ...real, detectSubscriptions: () => detected,
    activeSubscriptions: (s) => s.filter((x) => x.status === 'active'),
    stoppedSubscriptions: (s) => s.filter((x) => x.status === 'stopped'),
    trueSubscriptions: (s) => s.filter((x) => x.group === 'subscription') };
  return h;
}

test('a price rise says what it was, from the prior price, never the average', () => {
  const tree = billsWith([netflix, spotifyUp]).render('bills');
  assert.match(text(byId(tree, 'bills-price-up-sub-spotify')), /was AED 10.99 · Price went up/);
  assert.equal(byId(tree, 'bills-price-up-sub-netflix'), undefined);
});

test('the subscriptions heading carries the monthly-equivalent total, without cancelled ones', () => {
  const tree = billsWith([netflix, spotifyUp, gym]).render('bills');
  assert.match(text(byId(tree, 'bills-subscriptions')), /AED 27.48 \/ month/);
  const cancelled = billsWith([netflix, spotifyUp], { state: { cancelledSubscriptions: { spotify: '2026-09-01' } } }).render('bills');
  assert.match(text(byId(cancelled, 'bills-subscriptions')), /AED 15.49 \/ month/);
  assert.doesNotMatch(text(byId(cancelled, 'bills-subscriptions')), /Spotify/);
});

test('a likely-stopped subscription offers Mark as cancelled behind a confirmation', () => {
  const h = billsWith([netflix, gym]);
  const tree = h.render('bills');
  assert.match(text(byId(tree, 'bills-stopped-city gym')), /Likely stopped/);
  press(byId(tree, 'bills-mark-cancelled-city gym'));
  assert.equal(h.events.some((e) => e[0] === 'setSubscriptionCancelled'), false, 'nothing commits before confirming');
  const confirmation = h.events.find((e) => e[0] === 'state' && typeof e[2]?.onConfirm === 'function')[2];
  assert.match(confirmation.question, /Mark City Gym as cancelled\?/);
  confirmation.onConfirm();
  assert.deepEqual(h.events.filter((e) => e[0] === 'setSubscriptionCancelled').map((e) => e.slice(1)), [['City Gym', '2026-09-15']]);
  assert.equal(h.events.some((e) => e[0] === 'setNotSubscription'), false, 'cancelled is not Not-a-subscription');
});

test('All lists what the user cancelled, with a Still paying undo', () => {
  const h = billsWith([netflix, gym], { states: { 0: 'all' }, state: { cancelledSubscriptions: { 'city gym': '2026-09-01' } } });
  const tree = h.render('bills');
  assert.match(text(byId(tree, 'bills-cancelled')), /Cancelled by you[\s\S]*City Gym/);
  press(byId(tree, 'bills-still-paying-city gym'));
  assert.deepEqual(h.events.filter((e) => e[0] === 'setSubscriptionCancelled').map((e) => e.slice(1)), [['City Gym', null]]);
});

test('the 30-day timeline speaks its pins and leaves out anything beyond the window', () => {
  // The harness's today is 15 Sep 2026.
  const tree = billsWith([{ ...netflix, nextExpectedISO: '2026-09-20' }, { ...spotifyUp, nextExpectedISO: '2026-11-30' }]).render('bills');
  const label = byId(tree, 'bills-timeline').props.accessibilityLabel;
  // The harness's monthly bills fell due on 7 and 8 Sep; their next due dates
  // (7 and 8 Oct) are inside the window, so they are pinned too.
  assert.match(label, /^3 payments in the next 30 days: Netflix, 20 Sept; Etisalat, 7 Oct; DEWA, 8 Oct$/);
  assert.match(label, /Netflix/);
  assert.doesNotMatch(label, /Spotify/);
  // DEWA on day 23 of 30 is centred; nothing is anchored past an edge.
  const anchors = walk(byId(tree, 'bills-timeline')).map((n) => n.props?.testID).filter((id) => /^bills-timeline-pin-/.test(id ?? ''));
  assert.deepEqual(anchors, ['bills-timeline-pin-center', 'bills-timeline-pin-center', 'bills-timeline-pin-center']);
  const today = billsWith([{ ...netflix, nextExpectedISO: '2026-09-15' }]).render('bills');
  const first = walk(byId(today, 'bills-timeline')).find((n) => n.props?.testID === 'bills-timeline-pin-start');
  assert.ok(first, 'a pin due today hangs its label inward from the start edge');
  assert.equal(first.props.style.find((part) => part && 'marginStart' in part).marginStart, -5, 'its dot still sits on today');
});

function renderBillSheet(h, props) {
  if (!h.deps['@/components/ui/layout']) {
    h.deps['@/components/ui/section-header'] = { SectionHeader: (p) => h.jsx('SectionHeader', p) };
    h.local('@/components/ui/layout');
  }
  return load(path.join(root, 'src/components/bill-detail-sheet.tsx'), h.deps).BillDetailSheet({ onClose() {}, ...props });
}

test('the bill sheet says an estimate is an estimate, and its reminder copy matches the scheduler', () => {
  const h = createHarness();
  const sheet = renderBillSheet(h, { subscription: spotifyUp });
  const amount = text(byId(sheet, 'bill-detail-amount'));
  assert.match(amount, /≈[\s\S]*Estimate from your last 3 charges/);
  assert.match(amount, /was AED 10.99 · Price went up/);
  assert.match(text(sheet), /reminds you the day before it renews/);
  assert.doesNotMatch(text(sheet), /3 days before|three days/i);
  const bill = renderBillSheet(h, { bill: { bill: h.state.bills[0], status: 'upcoming', daysLeft: 2, dueISO: '2026-09-08' } });
  assert.match(text(bill), /the day before and on the day/);
  assert.doesNotMatch(text(bill), /Mark paid|Record as paid/, 'the screen owns mark-paid, through its confirmation');
});

test('a detected reminder cannot be edited; a hand-made one saves through editBill', () => {
  const h = createHarness();
  const detected = renderBillSheet(h, { bill: { bill: { ...h.state.bills[0], autoDetected: true }, status: 'upcoming', daysLeft: 2, dueISO: '2026-09-08' } });
  assert.match(text(detected), /cannot be edited here/);
  const editing = createHarness({ states: { 1: true, 2: 'DEWA home', 3: '350', 4: '9' } });
  const form = renderBillSheet(editing, { bill: { bill: editing.state.bills[0], status: 'upcoming', daysLeft: 2, dueISO: '2026-09-08' } });
  assert.ok(byId(form, 'bill-detail-edit'));
  walk(form).find((n) => n.props?.accessibilityLabel === 'Save bill').props.onPress();
  assert.deepEqual(JSON.parse(JSON.stringify(editing.events.filter((e) => e[0] === 'editBill'))),
    [['editBill', 'dewa', { title: 'DEWA home', amountFils: 35000, dueDay: 9 }]]);
});

test('a stopped or cancelled charge gets no "nothing to watch" verdict, and a cancelled one offers Still paying', () => {
  const stoppedSheet = renderBillSheet(createHarness(), { subscription: gym });
  assert.doesNotMatch(text(stoppedSheet), /nothing to watch/);
  const cancelledSheet = renderBillSheet(createHarness({ state: { cancelledSubscriptions: { netflix: '2026-09-01' } } }),
    { subscription: netflix });
  assert.doesNotMatch(text(cancelledSheet), /nothing to watch|reminds you the day before it renews/);
  assert.match(text(byId(cancelledSheet, 'bill-detail-cancelled')), /Still paying/);
  assert.match(text(renderBillSheet(createHarness(), { subscription: netflix })), /nothing to watch/);
});

test('a yearly bill edit to a day its month lacks is refused before Save, not dropped after it', () => {
  const yearly = { id: 'insurance', title: 'Insurance', category: 'other', amountFils: 120000, dueDay: 10, yearlyOnISO: '2026-02-10', paidMonths: [] };
  const h = createHarness({ states: { 1: true, 2: 'Insurance', 3: '1200', 4: '30' } });
  const form = renderBillSheet(h, { bill: { bill: yearly, status: 'upcoming', daysLeft: 20, dueISO: '2027-02-10' } });
  assert.equal(walk(form).find((n) => n.props?.accessibilityLabel === 'Save bill').props.disabled, true);
  assert.match(text(byId(form, 'bill-detail-edit')), /does not exist in the month/);
});

test('Arabic Bills speaks Arabic in the new sections', () => {
  const tree = billsWith([netflix, spotifyUp], { language: 'ar' }).render('bills');
  assert.match(text(byId(tree, 'bills-subscriptions')), /الاشتراكات/);
  assert.match(text(byId(tree, 'bills-price-up-sub-spotify')), /ارتفع السعر/);
});
