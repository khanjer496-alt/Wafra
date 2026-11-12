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

// ── The quiet period: a burst of edits writes only the latest figures ─────
const manualClock = () => {
  const timers = [];
  return {
    schedule: (run, ms) => {
      const timer = { run, ms, cancelled: false };
      timers.push(timer);
      return { cancel() { timer.cancelled = true; } };
    },
    fire() { for (const timer of timers.splice(0)) if (!timer.cancelled) timer.run(); },
    active: () => timers.filter(timer => !timer.cancelled).length,
    delays: () => timers.map(timer => timer.ms),
  };
};

test('a debounced request prepares and writes nothing until its quiet period ends', async () => {
  const clock = manualClock(), prepared = [], written = [];
  const sync = createWidgetSnapshotSync({ schedule: clock.schedule,
    prepare: async () => { prepared.push(1); return { ...sample, todayCount: 7 }; },
    write: json => { written.push(JSON.parse(json).todayCount); }, clear() {} });
  const job = sync.request(input, () => true, { debounceMs: 2000 });
  await tick(); await tick();
  assert.deepEqual([prepared.length, written.length], [0, 0], 'no ledger walk and no native write while waiting');
  assert.deepEqual(clock.delays(), [2000]);
  clock.fire();
  assert.equal(await job.done, 'written');
  assert.deepEqual(written, [7]);
});

test('latest wins: each newer request (and the cancel Home does on cleanup) leaves exactly one write', async () => {
  const clock = manualClock(), written = [];
  let calls = 0;
  const sync = createWidgetSnapshotSync({ schedule: clock.schedule,
    prepare: async () => ({ ...sample, todayCount: ++calls }), write: json => { written.push(JSON.parse(json).todayCount); }, clear() {} });
  const first = sync.request(input, () => true, { debounceMs: 2000 });
  first.cancel();                       // Home's cleanup before the next ledger change
  const second = sync.request(input, () => true, { debounceMs: 2000 });
  second.cancel();
  const third = sync.request(input, () => true, { debounceMs: 2000 });
  assert.equal(clock.active(), 1, 'cancelled requests release their timers');
  clock.fire();
  assert.equal(await third.done, 'written');
  assert.equal(await first.done, 'cancelled');
  assert.equal(await second.done, 'cancelled');
  assert.deepEqual(written, [1], 'only the latest request prepared and wrote');
});

test('a superseded request that was not cancelled still writes nothing', async () => {
  const clock = manualClock(), written = [];
  const sync = createWidgetSnapshotSync({ schedule: clock.schedule,
    prepare: async () => ({ ...sample, todayCount: 3 }), write: json => { written.push(JSON.parse(json).todayCount); }, clear() {} });
  const older = sync.request(input, () => true, { debounceMs: 2000 });
  const newer = sync.request(input, () => true, { debounceMs: 2000 });
  clock.fire();
  assert.equal(await older.done, 'cancelled');
  assert.equal(await newer.done, 'written');
  assert.deepEqual(written, [3]);
});

test('flush ends the quiet period at once, so leaving the app still writes the last edit', async () => {
  const clock = manualClock(), written = [];
  const sync = createWidgetSnapshotSync({ schedule: clock.schedule,
    prepare: async () => ({ ...sample, todayCount: 9 }), write: json => { written.push(JSON.parse(json).todayCount); }, clear() {} });
  const job = sync.request(input, () => true, { debounceMs: 2000 });
  job.flush();
  assert.equal(await job.done, 'written');
  assert.deepEqual(written, [9]);
  assert.equal(clock.active(), 0, 'the pending timer was released');
});

test('a clear while waiting wins: nothing is written afterwards', async () => {
  const clock = manualClock(), operations = [];
  const sync = createWidgetSnapshotSync({ schedule: clock.schedule,
    prepare: async () => ({ ...sample }), write: () => operations.push('write'), clear: () => operations.push('clear') });
  const waiting = sync.request(input, () => true, { debounceMs: 2000 });
  assert.equal(await sync.clear(), 'cleared');
  clock.fire();
  assert.equal(await waiting.done, 'cancelled');
  assert.deepEqual(operations, ['clear']);
});

test('the privacy clear is never delayed, and no debounce means the old behaviour', async () => {
  const clock = manualClock(), operations = [];
  const sync = createWidgetSnapshotSync({ schedule: clock.schedule,
    prepare: async () => ({ ...sample }), write: () => operations.push('write'), clear: () => operations.push('clear') });
  const hidden = sync.request({ ...input, state: { ...state, privateMode: true } }, () => true, { debounceMs: 2000 });
  assert.equal(await hidden.done, 'cleared');
  assert.equal(clock.active(), 0, 'no timer was started for a clear');
  const immediate = sync.request(input);
  assert.equal(await immediate.done, 'written');
  assert.equal(clock.active(), 0);
  assert.deepEqual(operations, ['clear', 'write']);
});

test('the default quiet period is two seconds and the widget owner asks for it', () => {
  const fs = require('node:fs');
  const loaded = require('./load-typescript.cjs')(path.resolve(__dirname, '../../../src/lib/widget-sync.ts'), {
    '@/lib/ledger': load('@/lib/ledger'), '@/lib/subscriptions': load('@/lib/subscriptions'), '@/lib/widget-ledger': load('@/lib/widget-ledger'),
    '../../modules/wafra-widgets': { setWidgetSnapshot() {}, clearWidgetSnapshot() {} },
  });
  assert.equal(loaded.WIDGET_SYNC_DEBOUNCE_MS, 2000);
  const hook = fs.readFileSync(path.resolve(__dirname, '../../../src/hooks/use-widget-snapshot-sync.ts'), 'utf8');
  assert.match(hook, /requestWidgetSnapshotSync\(\{ state: source[\s\S]*?\}, current, \{ debounceMs: WIDGET_SYNC_DEBOUNCE_MS \}\)/);
  assert.match(hook, /AppLifecycle\.addEventListener\('change', \(next\) => \{\s*if \(next !== 'active'\) request\?\.flush\?\.\(\);\s*\}\);/);
  assert.match(hook, /return \(\) => \{ cancelled = true; task\.cancel\(\); leaving\.remove\(\); request\?\.cancel\(\); \};/);
});
