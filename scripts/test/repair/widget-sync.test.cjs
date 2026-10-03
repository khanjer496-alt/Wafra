'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const path = require('node:path');
const { createWidgetSnapshotSync, prepareWidgetSnapshot, widgetHistoryBlocksUpdate } = require('./load-typescript.cjs')(path.resolve(__dirname, '../../../src/lib/widget-sync.ts'), {
  '@/lib/ledger': load('@/lib/ledger'), '@/lib/subscriptions': load('@/lib/subscriptions'), '@/lib/widget-ledger': load('@/lib/widget-ledger'),
  '../../modules/wafra-widgets': { setWidgetSnapshot() {}, clearWidgetSnapshot() {} },
});
const { widgetSnapshotForLedger } = load('@/lib/widget-ledger');
const now = new Date(2026, 8, 27, 12);
const state = { hydrated: true, onboarded: true, privateMode: false, historyImport: null,
  accounts: [{ id: 'bank', kind: 'bank', name: 'Bank', openingFils: 0 }],
  transactions: [7, 8, 9].map(month => ({ id: `all-${month}`, title: 'AllDebrid', amountFils: 1680,
    date: `2026-${String(month).padStart(2, '0')}-01`, type: 'expense', category: 'software', accountId: 'bank', source: 'manual', userEdited: true })),
  bills: [], cardDues: [], budgets: [], notSubscriptions: [], cancelledSubscriptions: {}, transferInternalIds: [] };
const input = { state, now, moneySpec: { schemaVersion: 2, currency: 'AED', exponent: 2 }, language: 'en' };
const sample = widgetSnapshotForLedger(input, []);
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));
test('cold cooperative analysis publishes inferred renewals instead of initial empty Home snapshot', async () => {
  const writes = []; let old = { ...sample, bills: [] };
  const sync = createWidgetSnapshotSync({ write: json => { old = JSON.parse(json); writes.push(old); }, clear() {} });
  const job = sync.request(input);
  assert.equal(writes.length, 0, 'no incomplete empty snapshot is emitted synchronously');
  assert.equal(await job.done, 'written');
  assert.deepEqual(old.bills.map(b => [b.title, b.dueISO, b.amountMinor, b.estimated]), [['AllDebrid', '2026-10-01', 1680, true]]);
});
test('privacy/hydration gates and incomplete import do not trigger recurrence scans', async () => {
  let scans = 0;
  const detect = async () => { scans++; return []; };
  for (const patch of [{ privateMode: true }, { hydrated: false }, { onboarded: false }]) {
    assert.equal(await prepareWidgetSnapshot({ ...input, state: { ...state, ...patch } }, () => false, detect), null);
  }
  for (const status of ['running', 'failed']) {
    assert.equal(await prepareWidgetSnapshot({ ...input, state: { ...state, historyImport: { status } } }, () => false, detect), undefined);
  }
  assert.equal(scans, 0);
});
test('an incomplete import retains the last valid native summary rather than declaring no bills', async () => {
  const operations = [];
  const sync = createWidgetSnapshotSync({ write: () => operations.push('write'), clear: () => operations.push('clear') });
  assert.equal(await sync.request({ ...input, state: { ...state, historyImport: { status: 'running' } } }).done, 'pending');
  assert.deepEqual(operations, []);
});
test('newest ledger wins even when the older recurrence job resolves last', async () => {
  const old = defer(), latest = defer(), written = [];
  let calls = 0;
  const sync = createWidgetSnapshotSync({ prepare: () => ++calls === 1 ? old.promise : latest.promise,
    write: json => written.push(JSON.parse(json).todayCount), clear() {} });
  const first = sync.request(input), second = sync.request(input);
  latest.resolve({ ...sample, todayCount: 2 });
  assert.equal(await second.done, 'written');
  old.resolve({ ...sample, todayCount: 1 });
  assert.equal(await first.done, 'cancelled');
  assert.deepEqual(written, [2]);
});
test('explicit clear invalidates pending analysis without waiting for it', async () => {
  const pending = defer(), operations = [];
  const sync = createWidgetSnapshotSync({ prepare: () => pending.promise, write: () => operations.push('write'), clear: () => operations.push('clear') });
  const job = sync.request(input);
  assert.equal(await sync.clear(), 'cleared');
  pending.resolve(sample);
  assert.equal(await job.done, 'cancelled');
  assert.deepEqual(operations, ['clear']);
});
test('privacy clear follows an already-started native write and cannot be cancelled by unmount', async () => {
  const nativeWrite = defer(), operations = [];
  const sync = createWidgetSnapshotSync({ prepare: async () => sample,
    write: async () => { operations.push('write-start'); await nativeWrite.promise; operations.push('write-end'); },
    clear: () => operations.push('clear') });
  const first = sync.request(input); await tick();
  const privacy = sync.request({ ...input, state: { ...state, privateMode: true } }, () => false);
  privacy.cancel();
  nativeWrite.resolve();
  await first.done; assert.equal(await privacy.done, 'cleared');
  assert.deepEqual(operations, ['write-start', 'write-end', 'clear']);
});
test('caller cancellation and ledger generation changes prevent writes', async () => {
  for (const cancelCaller of [true, false]) {
    const pending = defer(), writes = []; let current = true;
    const sync = createWidgetSnapshotSync({ prepare: () => pending.promise, write: json => writes.push(json), clear() {} });
    const job = sync.request(input, () => current);
    if (cancelCaller) job.cancel(); else current = false;
    pending.resolve(sample);
    assert.equal(await job.done, 'cancelled'); assert.deepEqual(writes, []);
  }
});
test('failed analysis retains prior native state; failed writes do not poison a later clear', async () => {
  const operations = [];
  const failed = createWidgetSnapshotSync({ prepare: async () => { throw Error('synthetic'); }, write: () => operations.push('write'), clear: () => operations.push('clear') });
  assert.equal(await failed.request(input).done, 'failed'); assert.deepEqual(operations, []);
  const writes = createWidgetSnapshotSync({ prepare: async () => sample, write: async () => { throw Error('synthetic'); }, clear: () => operations.push('clear') });
  assert.equal(await writes.request(input).done, 'failed'); assert.equal(await writes.clear(), 'cleared');
  assert.deepEqual(operations, ['clear']);
});

test('history guard allows only an untouched paused import, keeping active, failed and partial jobs blocked', async () => {
  const untouched = { status: 'paused', scanned: 0, found: 0, cursor: null, error: null };
  const allowed = [null, { ...untouched, status: 'complete' }, untouched];
  const blocked = [{ ...untouched, status: 'running' }, { ...untouched, status: 'failed' },
    { ...untouched, scanned: 1 }, { ...untouched, found: 1 },
    { ...untouched, cursor: { beforeDateMs: 1, beforeId: 1 } },
    { status: 'paused' }, { ...untouched, scanned: '0' }, { ...untouched, cursor: undefined }];
  for (const progress of allowed) {
    assert.equal(widgetHistoryBlocksUpdate(progress), false, JSON.stringify(progress));
    let scanned = false;
    const snapshot = await prepareWidgetSnapshot({ ...input, state: { ...state, historyImport: progress } }, () => false,
      async () => { scanned = true; return []; });
    assert.equal(scanned, true); assert.ok(snapshot);
  }
  for (const progress of blocked) {
    assert.equal(widgetHistoryBlocksUpdate(progress), true, JSON.stringify(progress));
    let scanned = false;
    assert.equal(await prepareWidgetSnapshot({ ...input, state: { ...state, historyImport: progress } }, () => false,
      async () => { scanned = true; return []; }), undefined);
    assert.equal(scanned, false);
  }
});
test('untouched paused native fixture publishes Spotify renewal and manual Netflix with exact USD values', async () => {
  const fixture = { ...state, marketId: 'AE', ledgerMoney: { schemaVersion: 2, currency: 'USD', exponent: 2 },
    accounts: [{ id: 'qa-cash', name: 'QACash', kind: 'cash', openingFils: 0 }],
    transactions: [
      { id: 'groceries', title: 'Groceries', date: '2026-09-27', amountFils: 1234, category: 'groceries' },
      { id: 'spotify-sep', title: 'Spotify', date: '2026-09-26', amountFils: 999, category: 'entertainment' },
      { id: 'spotify-aug', title: 'Spotify', date: '2026-08-27', amountFils: 999, category: 'entertainment' },
    ].map(row => ({ ...row, accountId: 'qa-cash', type: 'expense', source: 'manual', userEdited: true, titleEdited: true })),
    bills: [{ id: 'netflix', title: 'Netflix', amountFils: 999, category: 'entertainment', dueDay: 28, paidMonths: [] }],
    historyImport: { status: 'paused', scanned: 0, found: 0, cursor: null, error: null },
  };
  const writes = [];
  const sync = createWidgetSnapshotSync({ write: json => writes.push(JSON.parse(json)), clear() {} });
  assert.equal(await sync.request({ ...input, state: fixture, moneySpec: fixture.ledgerMoney }).done, 'written');
  assert.equal(writes.length, 1); assert.equal(writes[0].currency, 'USD');
  assert.equal(writes[0].todayMinor, 1234);
  assert.deepEqual(writes[0].bills.map(b => [b.title, b.dueISO, b.amountMinor, b.estimated]), [
    ['Netflix', '2026-09-28', 999, false], ['Spotify', '2026-10-26', 999, true],
  ]);
});
