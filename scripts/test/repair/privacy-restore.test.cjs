const test = require('node:test');
const assert = require('node:assert/strict');
const { loadStore } = require('../../perf/load-store.cjs');
const { reducer, store, build } = loadStore();
const hydrate = patch => reducer({ hydrated: false, transactions: [], accounts: [] }, {
  type: 'hydrate', state: { onboarded: true, language: 'en', marketId: 'AE', transactions: [], accounts: [], ...patch },
});

test('restoring a backup cannot grant logo sharing or turn off this device widget privacy choice', () => {
  const device = hydrate({ onlineLogosEnabled: false, hideWidgetAmountsWhenLocked: true });
  const data = { ...device, onlineLogosEnabled: true, hideWidgetAmountsWhenLocked: false };
  const parsed = store.parseBackupForRestore(JSON.stringify({ app: 'wafra', version: 1, exportedAt: new Date().toISOString(), data }));
  const restored = reducer(device, { type: 'restore', state: parsed });
  assert.equal(restored.onlineLogosEnabled, false);
  assert.equal(restored.hideWidgetAmountsWhenLocked, true);
});

test('local hydration retains the explicit device preferences', () => {
  const state = hydrate({ onlineLogosEnabled: true, hideWidgetAmountsWhenLocked: false });
  assert.equal(state.onlineLogosEnabled, true);
  assert.equal(state.hideWidgetAmountsWhenLocked, false);
});

test('backup validation accepts old omitted preferences but rejects malformed known preferences', () => {
  const valid = build('backup-validation').isValidBackupState;
  const state = hydrate({});
  delete state.onlineLogosEnabled;
  delete state.hideWidgetAmountsWhenLocked;
  assert.equal(valid(state), true);
  assert.equal(valid({ ...state, onlineLogosEnabled: 'yes' }), false);
  assert.equal(valid({ ...state, hideWidgetAmountsWhenLocked: 0 }), false);
});
