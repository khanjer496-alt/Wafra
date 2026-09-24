'use strict';
// A notification that matches a saved bank alert but cannot be described for
// Review must be HELD in the native queue, never thrown out of the drain. A
// throw leaves every record on that page unacknowledged and every later drain
// fails on the same record, so SMS queued behind it waits until it expires.
//
// Runs the REAL iOS drain coordinator, replay guard, parser, planner and
// Review tray against a fake native queue. The one seam is the parse result of
// the designated notification, whose currency is replaced with one no ledger
// can describe ('XXX') — the same unconvertible shape the replay unit test uses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const build = process.env.WAFRA_TEST_BUILD_DIR || path.join(root, 'scripts/test/build');
const subjects = new Set(['auto-import', 'local-message-record', 'ios-notification-replay', 'import-plan', 'ios-local-capture']);
const native = { 'react-native': 'stub-react-native', 'expo-crypto': 'stub-expo-crypto',
  'expo-secure-store': 'stub-secure-store', '../../modules/notification-reader': 'notification-reader',
  '../../modules/sms-reader': 'sms-reader' };
const cache = new Map();
function current(name, replace = {}) {
  const cacheKey = name + ':' + Object.keys(replace).join(',');
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const file = path.join(root, 'src/lib', name + '.ts');
  const emitted = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {};
  for (const match of emitted.matchAll(/require\(["']([^"']+)["']\)/g)) {
    const key = match[1];
    const dependency = key.startsWith('@/lib/') ? key.slice(6) : native[key];
    assert.ok(dependency, `explicit runtime boundary required for ${key}`);
    dependencies[key] = Object.hasOwn(replace, dependency) ? replace[dependency]
      : subjects.has(dependency) ? current(dependency) : require(path.join(build, dependency + '.js'));
  }
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-09-19T12:00:00.000Z'])); }
    static now() { return Date.parse('2026-09-19T12:00:00.000Z'); }
  }
  const result = load(file, dependencies, { setTimeout, ...(name === 'ios-local-capture' ? { Date: FixtureDate } : {}) });
  cache.set(cacheKey, result);
  return result;
}

const { setActiveMarket, setLedgerCurrency } = require(path.join(build, 'markets.js'));
setActiveMarket('AE'); setLedgerCurrency('AED', 2);
const { materializeImportBatch, applyMaterializedImportBatch } = require(path.join(build, 'ledger-import.js'));
const tray = require(path.join(build, 'alert-review-tray.js'));
const now = Date.parse('2026-09-19T12:00:00.000Z');

const badId = '77777777-7777-4777-8777-777777777777';
const carrefour = 'Your ADIB Covered Card ending with 4417 has been used for AED 250.00 at CARREFOUR on 18/09/2026.';
const record = (id, text, source, observedAt) => JSON.stringify({ v: 1, id, text,
  sender: source === 'notification' ? 'Wafra Notification' : 'ADIB', source, observedAt });
const badNotification = record(badId, carrefour, 'notification', '2026-09-18T10:30:00.000Z');
const smsCarrefour = record('a'.repeat(64), carrefour, 'message', '2026-09-18T10:30:01.000Z');
const smsCosta = record('b'.repeat(64),
  'Your ADIB Covered Card ending with 4417 has been used for AED 30.00 at COSTA COFFEE on 18/09/2026.',
  'message', '2026-09-18T11:00:00.000Z');
const smsLulu = record('c'.repeat(64),
  'Your ADIB Covered Card ending with 4417 has been used for AED 75.00 at LULU HYPERMARKET on 19/09/2026.',
  'message', '2026-09-19T09:00:00.000Z');

const realRecord = current('local-message-record');
const injectedRecord = { ...realRecord, parseLocalMessageRecord: (...args) => {
  const outcome = realRecord.parseLocalMessageRecord(...args);
  return outcome.kind === 'parsed' && outcome.row.channel === 'push' && outcome.row.notificationObservationId === badId
    ? { ...outcome, row: { ...outcome.row, currency: 'XXX' } } : outcome;
} };
const { createIosLocalCaptureCoordinator } = current('ios-local-capture', { 'local-message-record': injectedRecord });

function harness({ excluding }) {
  let queue = [];
  const acknowledged = [];
  const calls = [];
  const id = serialized => JSON.parse(serialized).id;
  const isNotification = serialized => JSON.parse(serialized).source === 'notification';
  const nativeQueue = { notificationCaptureSupported: true, purgeExpired: async () => 0,
    getCaptureStatus: async () => ({ firstCapturedAt: null }), recordFirstCapturedAt: async () => {},
    listPendingRecords: async limit => { calls.push('messages'); return queue.filter(s => !isNotification(s)).slice(0, limit); },
    listPendingRecordsIncludingNotifications: async limit => { calls.push('all'); return queue.slice(0, limit); },
    acknowledgeRecords: async ids => { acknowledged.push(...ids); queue = queue.filter(s => !ids.includes(id(s))); },
    ...(excluding ? { listPendingRecordsExcluding: async (limit, excludeIds) => {
      calls.push('excluding:' + excludeIds.join(','));
      return queue.filter(s => !excludeIds.includes(id(s))).slice(0, limit);
    } } : {}),
  };
  let state = { hydrated: true, marketId: 'AE', captureOptOut: false, accounts: [], transactions: [], budgets: [], bills: [],
    goals: [], cardDues: [], accountHints: {}, merchantOverrides: {}, lastScanTs: 0, parserVersion: 0,
    reviewTray: tray.emptyAlertReviewTray() };
  let sequence = 0;
  const coordinator = createIosLocalCaptureCoordinator({ native: nativeQueue, ledger: {
    getState: () => state, getStateGeneration: () => 1, ensureDurable: async () => {},
    stageReviewAlerts: items => {
      let admitted = 0;
      for (const item of items) {
        const result = tray.admitPreparedReviewAlert(state.reviewTray, item, now);
        state.reviewTray = result.state; admitted += result.outcome === 'admitted' ? 1 : 0;
      }
      return { admitted, durable: Promise.resolve() };
    },
    importBatch: batch => {
      const materialized = materializeImportBatch(batch, state, prefix => prefix + (++sequence));
      state = applyMaterializedImportBatch(state, materialized);
      return { ids: materialized.transactions.map(row => row.id), durable: Promise.resolve() };
    },
  }, retireShortcutCapture: async () => 'complete' });
  return { coordinator, calls, acknowledged, state: () => state,
    enqueue: (...records) => { queue.push(...records); }, pending: () => queue.map(id) };
}

function assertHeld(h) {
  assert.ok(h.pending().includes(badId), 'the unconvertible notification stays queued natively');
  assert.equal(h.acknowledged.includes(badId), false, 'the unconvertible notification is never acknowledged');
  assert.equal(h.state().transactions.some(row => row.notificationObservationId === badId || row.channel === 'push'), false,
    'the unconvertible notification never posts money');
  assert.equal(h.state().reviewTray.pending.length, 0, 'nothing indescribable reaches Review');
}

for (const excluding of [true, false]) {
  const reader = excluding ? 'exclusion-list reader' : 'older binary reader';
  test(`unconvertible replay match of a saved SMS is held and later SMS keep importing (${reader})`, async () => {
    const h = harness({ excluding });
    h.enqueue(smsCarrefour);
    assert.equal((await h.coordinator.drain()).imported, 1);
    assert.equal(h.state().transactions.length, 1);

    h.enqueue(badNotification, smsCosta);
    const second = await h.coordinator.drain();
    assert.equal(second.imported, 1, 'the SMS behind the held notification imports on the same drain');
    assert.ok(h.acknowledged.includes('b'.repeat(64)));
    assert.equal(h.state().transactions.length, 2);
    assertHeld(h);
    if (excluding) assert.ok(h.calls.includes('excluding:' + badId), 'the reader pages past the held record');

    h.enqueue(smsLulu);
    const third = await h.coordinator.drain();
    assert.equal(third.imported, 1, 'later drains keep importing SMS');
    assert.ok(h.acknowledged.includes('c'.repeat(64)));
    assert.equal(h.state().transactions.length, 3);
    assertHeld(h);
    assert.deepEqual(h.pending(), [badId]);
  });

  test(`unconvertible replay match of a same-page SMS is held without blocking that page (${reader})`, async () => {
    const h = harness({ excluding });
    h.enqueue(badNotification, smsCarrefour, smsCosta);
    const first = await h.coordinator.drain();
    assert.equal(first.imported, 2, 'both SMS on the page import');
    assert.equal(h.state().transactions.length, 2);
    assertHeld(h);

    h.enqueue(smsLulu);
    assert.equal((await h.coordinator.drain()).imported, 1);
    assert.equal(h.state().transactions.length, 3);
    assertHeld(h);
    assert.deepEqual(h.pending(), [badId]);
  });
}
