'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHarness } = require('./reference-harness.cjs');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const selection = load(path.join(root, 'src/lib/store-selection.ts'));

test('a selection keeps its identity while the selected fields are unchanged', () => {
  const select = selection.createSelection();
  const transactions = [];
  const pick = ({ state }) => ({ transactions: state.transactions });
  const first = select({ state: { transactions, lastScanTs: 1 } }, pick);
  assert.equal(select({ state: { transactions, lastScanTs: 2 } }, pick), first);
  assert.notEqual(select({ state: { transactions: [], lastScanTs: 2 } }, pick), first);
});

test('the handle notifies subscribers only on notify, with the latest value', () => {
  const handle = selection.createStoreHandle(1);
  const seen = [];
  const unsubscribe = handle.subscribe(() => seen.push(handle.get()));
  handle.set(2);
  assert.deepEqual(seen, []);
  handle.notify();
  unsubscribe();
  handle.set(3);
  handle.notify();
  assert.deepEqual(seen, [2]);
});

test('import progress reduces to one shared object per status', () => {
  const running = selection.historyStatusOnly({ status: 'running', scanned: 100 });
  assert.equal(selection.historyStatusOnly({ status: 'running', scanned: 200 }), running);
  assert.notEqual(selection.historyStatusOnly({ status: 'complete', scanned: 200 }), running);
  assert.equal(selection.historyStatusOnly(null), null);
});

function ledger(size, base) {
  const categories = ['dining', 'transport', 'shopping', 'utilities', 'entertainment', 'other'];
  const rows = [...base];
  for (let i = 0; i < size; i += 1) {
    rows.push({ id: `g${i}`, title: `Merchant ${i % 300}`, amountFils: 1000 + (i * 37) % 90000,
      category: categories[i % categories.length], date: `2026-0${1 + (i % 9)}-${String(1 + (i % 27)).padStart(2, '0')}`,
      type: i % 17 === 0 ? 'income' : 'expense', accountId: ['credit', 'enbd', 'adcb'][i % 3], source: 'sms' });
  }
  return rows;
}

/**
 * Render the real screen once, record the selectors it subscribes with, then
 * replay store updates the way useSyncExternalStore would: a screen re-renders
 * only when one of its selections changes. With useStore() every update was a
 * re-render.
 */
function subscriptions(screen, size) {
  const h = createHarness();
  h.deps['@/lib/period'].periodRange = () => '';
  const store = h.deps['@/lib/store'].useStore();
  let state = { ...h.state, transactions: ledger(size, h.state.transactions), lastScanTs: 0 };
  const selectors = [];
  let wholeStoreReads = 0;
  h.deps['@/lib/store'] = {
    useStore: () => { wholeStoreReads += 1; return { ...store, state }; },
    useStoreSelector: (selector, equal) => { selectors.push({ selector, equal }); return selector({ ...store, state }); },
    useStoreActions: () => store,
  };
  const file = screen === 'transactions' ? 'src/app/transactions.tsx'
    : screen === 'home' ? 'src/screens/journal-home-screen.tsx' : `src/app/(tabs)/${screen}.tsx`;
  load(path.join(root, file), h.deps, {}).default();
  const selects = selectors.map(({ equal }) => selection.createSelection(equal));
  const snapshot = () => selectors.map(({ selector }, i) => selects[i]({ ...store, state }, selector));
  let previous = snapshot();
  return {
    wholeStoreReads,
    selectorCount: selectors.length,
    get state() { return state; },
    /** Apply an update; true when the screen would re-render. */
    update(patch) {
      state = { ...state, ...patch };
      const next = snapshot();
      const changed = next.some((value, i) => value !== previous[i]);
      previous = next;
      return changed;
    },
  };
}

const statusUpdate = (i) => ({ historyImport: { status: 'running', scanned: i * 100, found: i },
  reviewTray: { pending: [] }, dailySummary: i % 2 === 0, lastScanTs: i });

for (const size of [5000, 20000]) {
  for (const screen of ['flow', 'bills', 'transactions', 'wallet']) {
    test(`${screen} (${size} rows): import progress and status updates do not re-render the screen`, () => {
      const s = subscriptions(screen, size);
      assert.equal(s.wholeStoreReads, 0, `${screen} must not subscribe to the whole store`);
      assert.ok(s.selectorCount > 0);
      let renders = 0;
      const updates = 200;
      for (let i = 1; i <= updates; i += 1) {
        // Accounts shows the last scan time, so it alone follows lastScanTs.
        const patch = statusUpdate(i);
        if (screen === 'wallet') delete patch.lastScanTs;
        if (s.update(patch)) renders += 1;
      }
      // One render when the import first appears (null -> running status).
      assert.ok(renders <= 1, `${screen}: ${renders} re-renders for ${updates} status-only updates (was ${updates})`);
    });
  }
}

for (const screen of ['flow', 'bills', 'transactions', 'wallet']) {
  test(`${screen}: ledger and status changes still re-render it`, () => {
    const s = subscriptions(screen, 50);
    assert.ok(s.update({ transactions: [...s.state.transactions] }), 'new transactions');
    assert.ok(s.update({ accounts: [...s.state.accounts] }), 'account edits');
    s.update({ historyImport: { status: 'running', scanned: 1 } });
    if (screen !== 'wallet') {
      assert.ok(s.update({ historyImport: { status: 'complete', scanned: 2 } }),
        'finishing an import changes transfer scope');
    }
  });
}

test('Accounts follows the last scan time it displays', () => {
  const s = subscriptions('wallet', 50);
  assert.ok(s.update({ lastScanTs: 1234 }));
});

// Home's own selection. Its useAutoImport(false, true) call selects only
// capture flags, entitlement and the import STATUS (scan time, daily summary
// and transactions are selected only for watchForeground callers), so none
// of the churn below reaches Home through the hook either.
test('Home ignores status churn it does not draw, but still follows import progress and the ledger', () => {
  for (const size of [5000, 20000]) {
    const s = subscriptions('home', size);
    assert.equal(s.wholeStoreReads, 0, 'Home must not subscribe to the whole store');
    let renders = 0;
    for (let i = 1; i <= 200; i += 1) {
      if (s.update({ lastScanTs: i, reviewTray: { pending: [] }, dailySummary: i % 2 === 0,
        iosCaptureWarning: i % 3 === 0 ? null : { id: `w${i}` } })) renders += 1;
    }
    assert.equal(renders, 0, `Home: ${renders} re-renders for 200 status-only updates (was 200)`);
    // Home draws import progress, so every page it reads is a render.
    assert.ok(s.update({ historyImport: { status: 'running', scanned: 1 } }));
    assert.ok(s.update({ historyImport: { status: 'running', scanned: 2 } }));
    assert.ok(s.update({ transactions: [...s.state.transactions] }));
    assert.ok(s.update({ merchantOverrides: {} }));
  }
});

test('every state field the Home projections read is in HOME_STATE_FIELDS', () => {
  const h = createHarness();
  const fs = require('node:fs');
  const source = fs.readFileSync(path.join(root, 'src/screens/journal-home-screen.tsx'), 'utf8');
  const listed = new Set(source.match(/HOME_STATE_FIELDS = \[([\s\S]*?)\]/)[1].match(/'[a-zA-Z]+'/g).map(key => key.slice(1, -1)));
  const built = (name) => require(`../build/${name}.js`);
  const dashboard = load(path.join(root, 'src/lib/dashboard-projection.ts'), {
    '@/lib/accuracy': built('accuracy'), '@/lib/analytics': built('analytics'), '@/lib/cash-flow': built('cash-flow'),
    '@/lib/fx-summary': built('fx-summary'), '@/lib/insights': built('insights'), '@/lib/leaving-soon': built('leaving-soon'),
    '@/lib/ledger': built('ledger'), '@/lib/period': built('period'), '@/lib/uncategorised': built('uncategorised'),
  });
  const read = new Set();
  const base = { ...h.state, billAliases: {}, transferInternalIds: undefined, transferNormalizationVersion: undefined,
    historyImport: { status: 'complete' }, pro: true, founderPro: false, trialStartTs: 0 };
  const state = new Proxy(base, { get(target, key) { if (typeof key === 'string') read.add(key); return target[key]; } });
  const period = { mode: 'month', key: '2026-09' };
  const now = new Date('2026-09-15T09:00:00Z');
  for (const surface of ['home', 'dashboard']) dashboard.projectDashboard({ state, period, now, surface });
  dashboard.projectDashboardInsight(state, period, now);
  assert.ok(read.has('transactions') && read.has('accounts'), 'the projections actually ran');
  const missing = [...read].filter(key => !listed.has(key));
  assert.deepEqual(missing, [], 'Home would keep a stale state for these fields');
});
