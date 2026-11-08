const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const loadTs = require('./load-typescript.cjs');
const load = require('../../universal-test/load-ts.cjs').createLoader();

for (const os of ['ios', 'android']) {
  test(`${os}: logo networking requires explicit consent and revocation invalidates queued jobs`, () => {
    const logos = loadTs(path.resolve(__dirname, '../../../src/lib/logo-cache-lifecycle.ts'), {
      '@react-native-async-storage/async-storage': {}, 'react-native': { Platform: { OS: os } },
    });
    assert.equal(logos.logoCacheGeneration(), null, 'fresh and upgraded installs start offline');
    logos.setLogoLookupsAllowed(true);
    const generation = logos.logoCacheGeneration();
    assert.equal(typeof generation, 'number');
    assert.equal(logos.isLogoCacheGenerationCurrent(generation), true);
    logos.setLogoLookupsAllowed(false);
    assert.equal(logos.logoCacheGeneration(), null);
    assert.equal(logos.isLogoCacheGenerationCurrent(generation), false, 'queued search/cache results lose authority');
    logos.setLogoLookupsAllowed(true);
    assert.notEqual(logos.logoCacheGeneration(), generation, 'old request cannot regain authority after opt-in');
  });
}

test('App Lock hides every widget amount by default, including old preference-less installs', () => {
  const { widgetSnapshotForLedger } = load('@/lib/widget-ledger');
  const state = { hydrated: true, onboarded: true, appLock: true, privateMode: false,
    accounts: [], transactions: [], budgets: [], bills: [], cardDues: [],
    notSubscriptions: [], cancelledSubscriptions: {}, transferInternalIds: [] };
  const input = { state, now: new Date(2026, 10, 9, 12), language: 'en', moneySpec: { currency: 'AED', exponent: 2 } };
  for (const preference of [undefined, true]) {
    const snapshot = widgetSnapshotForLedger({ ...input, state: { ...state, hideWidgetAmountsWhenLocked: preference } }, []);
    assert.equal(snapshot.hidden, true);
    for (const key of ['todayMinor', 'leftInBudgetsMinor', 'budgetTotalMinor', 'perDayMinor']) {
      if (key in snapshot) assert.equal(snapshot[key], null, key);
    }
    assert.ok(snapshot.last7Minor.every(value => value === null));
    assert.ok(snapshot.bills.every(bill => bill.amountMinor === null));
    if (snapshot.spending) {
      assert.equal(snapshot.spending.totalMinor, null);
      assert.ok(snapshot.spending.categories.every(category => category.amountMinor === null));
    }
  }
  assert.equal(widgetSnapshotForLedger({ ...input, state: { ...state, hideWidgetAmountsWhenLocked: false } }, []).hidden, false);
  assert.equal(widgetSnapshotForLedger({ ...input, state: { ...state, appLock: false } }, []).hidden, false);
});

test('native privacy bridge receives independent lock and widget preferences', async () => {
  const calls = [];
  const native = { setAppPrivacy: async (...args) => calls.push(args) };
  const bridge = loadTs(path.resolve(__dirname, '../../../modules/wafra-widgets/index.ts'), {
    'react-native': { Platform: { OS: 'ios' } },
    'expo-modules-core': { requireOptionalNativeModule: () => native },
  });
  await bridge.setAppPrivacy(true, true);
  await bridge.setAppPrivacy(true, false);
  await bridge.setAppPrivacy(false, true);
  assert.deepEqual(calls.map(args => Array.from(args)), [[true, true], [true, false], [false, true]]);
});
