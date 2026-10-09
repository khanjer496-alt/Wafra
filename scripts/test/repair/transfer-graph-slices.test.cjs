'use strict';
/**
 * `transferReconciliationForStateInSlices`: the graph Home's transfer queue
 * and Transactions' separation wait for, built in short slices instead of one
 * long task. Same answer and same receipt cache as the synchronous call; one
 * shared build per ledger; a build nobody waits for any more is abandoned and
 * caches nothing.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transferHeavyLedger } = require('../fixtures/transfer-heavy-ledger.cjs');

const BUILD = process.env.WAFRA_HOT_PATH_BUILD ?? path.resolve(__dirname, '../build');
const lib = (name) => require(path.join(BUILD, name));
const markets = lib('markets');
const tr = lib('transfer-reconciliation');
const ledger = lib('ledger');
markets.setActiveMarket('AE');

/** A stored ledger as hydration leaves it: normalized rows and a final receipt, under new identities. */
function stored(count = 15000, candidates = 3000) {
  const base = transferHeavyLedger(count, candidates);
  const rows = tr.normalizeTransferLinks(base.transactions, base.accounts);
  const receipt = [...tr.reconciliationInternalIds(tr.reconcileTransfers(rows, base.accounts))];
  return { ...base, transactions: JSON.parse(JSON.stringify(rows)), transferInternalIds: receipt,
    transferNormalizationVersion: tr.TRANSFER_NORMALIZATION_VERSION };
}
const settled = (state) => new Promise((resolve) => ledger.transferReconciliationForStateInSlices(state, resolve));

test('a large ledger answers later, with the synchronous answer, and fills the receipt cache', async () => {
  const state = stored();
  let answered = false;
  const promise = new Promise((resolve) => ledger.transferReconciliationForStateInSlices(state, (value) => {
    answered = true; resolve(value);
  }));
  assert.equal(answered, false, '15k rows do not fit in the first slice');
  assert.equal(ledger.cachedTransferReconciliationForState(state), null);
  const result = await promise;
  assert.equal(ledger.cachedTransferReconciliationForState(state), result, 'the receipt cache now holds it');
  assert.equal(ledger.transferReconciliationForState(state), result, 'the synchronous call reads the same result');
  const copy = { ...state, transactions: JSON.parse(JSON.stringify(state.transactions)), transferInternalIds: [...state.transferInternalIds] };
  const fresh = ledger.transferReconciliationForState(copy);
  assert.deepEqual([...fresh.byId], [...result.byId]);
  assert.deepEqual([...fresh.pendingIds], [...result.pendingIds]);
});

test('a cached receipt and a small ledger answer synchronously', () => {
  const state = stored();
  const cached = ledger.transferReconciliationForState(state);
  let value;
  ledger.transferReconciliationForStateInSlices(state, (result) => { value = result; });
  assert.equal(value, cached);
  const small = stored(300, 60);
  let smallValue;
  ledger.transferReconciliationForStateInSlices(small, (result) => { smallValue = result; });
  assert.ok(smallValue && smallValue.byId.size > 0, 'a small ledger finishes inside its first slice');
});

test('a provisional history receipt answers null, as the synchronous call does', () => {
  const state = { ...stored(300, 60), transferNormalizationVersion: undefined,
    historyImport: { status: 'running', scanned: 1, found: 1, cursor: null, startedAt: 1, updatedAt: 1, error: null } };
  assert.equal(ledger.transferReconciliationForState(state), null);
  let value = 'unset';
  ledger.transferReconciliationForStateInSlices(state, (result) => { value = result; });
  assert.equal(value, null);
});

test('callers asking about one ledger share one build', async () => {
  const state = stored();
  const first = settled(state);
  const second = settled({ ...state });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
});

test('a build every caller cancelled stops and caches nothing; the next request starts over', async () => {
  const state = stored();
  let called = false;
  const handle = ledger.transferReconciliationForStateInSlices(state, () => { called = true; });
  handle.cancel();
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(called, false);
  assert.equal(ledger.cachedTransferReconciliationForState(state), null, 'an abandoned build fills no cache');
  const result = await settled(state);
  assert.ok(result.byId.size > 0);
});

test('one caller leaving does not stop the build for another', async () => {
  const state = stored();
  const leaving = ledger.transferReconciliationForStateInSlices(state, () => assert.fail('cancelled caller was answered'));
  const staying = settled(state);
  leaving.cancel();
  assert.ok((await staying).byId.size > 0);
});

/** A ledger with one row whose evidence cannot be read: every graph build over it throws. */
function poisoned(count, candidates) {
  const state = stored(count, candidates);
  const rows = [...state.transactions];
  const bad = { ...rows[rows.length - 1] };
  Object.defineProperty(bad, 'transferEvidence', { enumerable: true, get() { throw new Error('unreadable synthetic row'); } });
  rows[rows.length - 1] = bad;
  return { ...state, transactions: rows };
}
const quietly = async (work) => {
  const original = console.error;
  const reported = [];
  console.error = (...args) => reported.push(args);
  try { return { value: await work(), reported }; } finally { console.error = original; }
};

test('a build that throws answers every caller through failed, reports, and the next request starts over', async () => {
  const { reported } = await quietly(async () => {
    // Small: throws inside the first, synchronous slice; the call itself does not throw.
    const small = poisoned(300, 60);
    const failures = [];
    ledger.transferReconciliationForStateInSlices(small, () => assert.fail('no answer from a failed build'),
      (error) => failures.push(error.message));
    assert.deepEqual(failures, ['unreadable synthetic row']);
    ledger.transferReconciliationForStateInSlices(small, () => assert.fail('no answer'), (error) => failures.push(error.message));
    assert.equal(failures.length, 2, 'a second request runs again rather than joining the dead build');
    // Large: throws in a later slice; a caller arriving afterwards is not left waiting.
    const big = poisoned(15000, 3000);
    const first = await new Promise((resolve) => ledger.transferReconciliationForStateInSlices(big,
      () => resolve('answered'), (error) => resolve(error.message)));
    assert.equal(first, 'unreadable synthetic row');
    const later = await new Promise((resolve) => ledger.transferReconciliationForStateInSlices(big,
      () => resolve('answered'), (error) => resolve(error.message)));
    assert.equal(later, 'unreadable synthetic row');
    assert.equal(ledger.cachedTransferReconciliationForState(big), null);
  });
  assert.ok(reported.length >= 3 && reported.every(([label]) => label === '[WafraTransferGraph] sliced build failed'));
});

test('a failed sliced build keeps failing and never memoises an empty answer', () => {
  const state = poisoned(3000, 600);
  const build = tr.beginTransferReconciliation(state.transactions, state.accounts);
  let thrown = 0;
  for (let i = 0; i < 400 && thrown < 2; i += 1) {
    try { if (build.step(0)) assert.fail('a poisoned build cannot finish'); } catch (error) {
      assert.equal(error.message, 'unreadable synthetic row'); thrown += 1;
    }
  }
  assert.equal(thrown, 2, 'the step after a failure throws the same error again');
  assert.throws(() => tr.reconcileTransfers(state.transactions, state.accounts), /unreadable synthetic row/,
    'no undefined result was memoised for these arrays');
});

test('a ledger change mid-build: the new ledger gets its own graph and the cache is keyed to it', async () => {
  const a = stored();
  const b = stored(14000, 2800);
  const first = ledger.transferReconciliationForStateInSlices(a, () => assert.fail('the cancelled build answered'));
  first.cancel();
  const result = await settled(b);
  assert.equal(ledger.cachedTransferReconciliationForState(b), result);
  assert.equal(ledger.cachedTransferReconciliationForState(a), null);
  const copy = { ...b, transactions: JSON.parse(JSON.stringify(b.transactions)), transferInternalIds: [...b.transferInternalIds] };
  assert.equal(JSON.stringify([...ledger.transferReconciliationForState(copy).byId]), JSON.stringify([...result.byId]));
});

test('a build finishing after a synchronous caller filled the cache answers with that same graph', async () => {
  const state = stored();
  const pending = settled(state);
  const sync = ledger.transferReconciliationForState(state);
  assert.equal(await pending, sync);
  assert.equal(ledger.cachedTransferReconciliationForState(state), sync);
});

test('an edit that keeps the receipt joins the paused build instead of starting over', async () => {
  const state = stored();
  const first = ledger.transferReconciliationForStateInSlices(state, () => assert.fail('cancelled'));
  first.cancel();
  // A non-transfer edit: new transactions array, same final receipt.
  const edited = { ...state, transactions: [...state.transactions] };
  const result = await settled(edited);
  assert.equal(ledger.cachedTransferReconciliationForState(edited), result);
  assert.equal(ledger.cachedTransferReconciliationForState(state), result, 'the receipt, not the array, keys it');
});

test('a late build of an older ledger does not replace the memoised graph of a newer one', () => {
  const older = stored(3000, 600);
  const newer = stored(2500, 500);
  const build = tr.beginTransferReconciliation(older.transactions, older.accounts);
  assert.equal(build.step(0), undefined);
  const current = tr.reconcileTransfers(newer.transactions, newer.accounts);
  let late;
  while (!(late = build.step(1000))) { /* finish the older build */ }
  assert.ok(late.byId.size > 0);
  assert.equal(tr.reconcileTransfers(newer.transactions, newer.accounts), current, 'the newer memo is intact');
});
