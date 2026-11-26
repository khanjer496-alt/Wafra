const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Execute the shipping callback with controlled persistence/native boundaries.
// The reducer's privacy semantics have separate restore/validation coverage.
function fixture(persist, os = 'ios') {
  const authoritativeState = { current: { appLock: true, onlineLogosEnabled: false,
    hideWidgetAmountsWhenLocked: true, transactions: [] } };
  const stateGeneration = { current: 0 };
  const native = [];
  const dispatch = ({ patch }) => (authoritativeState.current = { ...authoritativeState.current, ...patch });
  const source = fs.readFileSync(path.resolve(__dirname, '../../../src/lib/store.tsx'), 'utf8');
  const callback = source.slice(source.indexOf('  const setPrivacyPreferences ='), source.indexOf('  const setDailySummary ='));
  const js = ts.transpileModule(`${callback}\nreturn setPrivacyPreferences;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const save = Function('useCallback', 'authoritativeState', 'stateGeneration', 'privacyPreferenceWriteTail',
    'Platform', 'setAppPrivacy', 'dispatch', 'persist', js)(fn => fn, authoritativeState, stateGeneration,
    { current: Promise.resolve() }, { OS: os }, async (...args) => native.push(args), dispatch,
    snapshot => persist(snapshot, authoritativeState, stateGeneration));
  return { save, authoritativeState, native };
}

for (const os of ['ios', 'android', 'web']) {
  test(`${os}: failed consent save restores the off choice without losing a concurrent ledger edit`, async () => {
    const f = fixture(async (_snapshot, state) => {
      state.current = { ...state.current, transactions: ['new-entry'] };
      return false;
    }, os);
    await assert.rejects(f.save({ onlineLogosEnabled: true }), /could not be saved/);
    assert.equal(f.authoritativeState.current.onlineLogosEnabled, false);
    assert.deepEqual(f.authoritativeState.current.transactions, ['new-entry']);
  });
}

test('failed widget-privacy save restores the native hide guard and current choice', async () => {
  const f = fixture(async () => false);
  await assert.rejects(f.save({ hideWidgetAmountsWhenLocked: false }), /could not be saved/);
  assert.equal(f.authoritativeState.current.hideWidgetAmountsWhenLocked, true);
  assert.deepEqual(f.native, [[true, false], [true, true]]);
});

test('a failed save does not poison the next queued privacy choice', async () => {
  let release;
  let calls = 0;
  const f = fixture(async () => {
    if (++calls === 1) return await new Promise(resolve => { release = resolve; });
    return true;
  });
  const first = f.save({ onlineLogosEnabled: true });
  const failed = assert.rejects(first, /could not be saved/);
  const second = f.save({ onlineLogosEnabled: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1, 'writes are serialized');
  release(false);
  await failed;
  await second;
  assert.equal(calls, 2);
  assert.equal(f.authoritativeState.current.onlineLogosEnabled, true);
});

test('a replaced ledger is not patched by an older failed privacy save', async () => {
  const f = fixture(async (_snapshot, state, generation) => {
    generation.current += 1;
    state.current = { ...state.current, onlineLogosEnabled: true, transactions: ['replacement'] };
    return false;
  });
  await assert.rejects(f.save({ onlineLogosEnabled: true }), /could not be saved/);
  assert.equal(f.authoritativeState.current.onlineLogosEnabled, true);
  assert.deepEqual(f.authoritativeState.current.transactions, ['replacement']);
});
