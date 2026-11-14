'use strict';
// "Erase all data" on the iOS simulator ends in the cleanup recovery state
// with only "[wafra:storage] destroy failed: Error (ERR_UNEXPECTED) — unknown"
// to go on: every erase step logged as plain 'destroy'. Each step now records
// its own closed-vocabulary op (destroy:capture, destroy:history,
// destroy:sqlite, ...), so one run names the failing store. Only the op label
// changes: the error is rethrown unchanged and no user data is logged.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('iOS post-erase cleanup names the failing step, rethrows it unchanged and stops there', async () => {
  const { createIosHistoryPostEraseCleanup } = load(path.join(root, 'src/lib/ios-history-setup.ts'), {
    '@react-native-async-storage/async-storage': { __esModule: true, default: {} },
  });
  for (const failing of ['capture', 'history', 'message-setup', 'background']) {
    const ran = [], told = [], boom = new Error(`${failing} failed`);
    const stepFn = name => async () => { ran.push(name); if (name === failing) throw boom; };
    const cleanup = createIosHistoryPostEraseCleanup({
      eraseCapture: stepFn('capture'), eraseHistory: stepFn('history'),
      clearMessageSetup: stepFn('message-setup'), clearBackground: stepFn('background'),
      onStepFailure: (step, error) => told.push([step, error]),
    });
    await assert.rejects(cleanup(), error => error === boom);
    assert.deepEqual(told, [[failing, boom]]);
    assert.equal(ran.at(-1), failing, 'no later step runs after a failure');
  }
  // Without a listener, the order and the rethrow are as before.
  const ran = [];
  const ok = name => async () => { ran.push(name); };
  await createIosHistoryPostEraseCleanup({ eraseCapture: ok('capture'), eraseHistory: ok('history'),
    clearMessageSetup: ok('message-setup'), clearBackground: ok('background') })();
  assert.deepEqual(ran, ['capture', 'history', 'message-setup', 'background']);
});

function ledgerStorage({ sqliteFails = false, keyFails = false } = {}) {
  const ops = [];
  const api = load(path.join(root, 'src/lib/state-storage.native.ts'), {
    '@react-native-async-storage/async-storage': { __esModule: true, default: {
      getAllKeys: async () => [], multiRemove: async () => {},
    } },
    'expo-crypto': {},
    'expo-secure-store': { deleteItemAsync: async () => { if (keyFails) throw new Error('key'); } },
    'expo-sqlite': { deleteDatabaseAsync: async () => { if (sqliteFails) throw new Error('file'); } },
    '@/lib/storage-diagnostics': { recordStorageFailure: (op, error) => { ops.push(op); return { op, error }; } },
    '@/lib/logo-cache-lifecycle': { withLogoCacheErase: run => run() },
  });
  return { storage: api.stateStorage, ops };
}

test('ledger reset names the failing half: SQLCipher file, then its key', async () => {
  for (const [options, op] of [[{ sqliteFails: true }, 'destroy:sqlite'], [{ keyFails: true }, 'destroy:securestore'],
    [{ sqliteFails: true, keyFails: true }, 'destroy:sqlite']]) {
    const { storage, ops } = ledgerStorage(options);
    await assert.rejects(storage.destroy('wafra/state'));
    assert.deepEqual(ops, [op], JSON.stringify(options));
  }
  const { storage, ops } = ledgerStorage();
  await storage.destroy('wafra/state');
  assert.deepEqual(ops, [], 'a clean erase records nothing');
});

test('every erase cleanup step in the store and both erase screens records its own op', () => {
  const store = read('src/lib/store.tsx');
  const start = store.indexOf('const afterErase = async () => {');
  assert.ok(start > 0, 'afterErase not found');
  const afterErase = store.slice(start, store.indexOf('};', store.indexOf('clearWidgetSnapshot();', start)));
  for (const op of ['destroy:complimentary', 'destroy:private-format-key', 'destroy:sharing-credential',
    'destroy:capture-queue', 'destroy:exports']) assert.match(afterErase, new RegExp(`step\\('${op}'`), op);
  assert.match(store, /recordStorageFailure\(op, error\);\s*throw error;/);
  for (const screen of ['src/app/settings-data.tsx', 'src/components/storage-recovery.tsx']) {
    const source = read(screen);
    assert.match(source, /onStepFailure: \(step, error\) => \{\s*recordStorageFailure\(`destroy:\$\{step\}`, error\);/, screen);
    assert.match(source, /recordStorageFailure\('destroy:sms', error\);\s*throw error;/, screen);
    assert.match(source, /recordStorageFailure\('destroy:notifications', error\);\s*throw error;/, screen);
  }
  const vocabulary = read('src/lib/storage-diagnostics.ts');
  for (const step of ['capture', 'history', 'message-setup', 'background']) {
    assert.match(vocabulary, new RegExp(`\\| 'destroy:${step}'`), `StorageOp lacks destroy:${step}`);
  }
});
