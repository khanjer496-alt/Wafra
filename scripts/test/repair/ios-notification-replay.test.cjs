'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const build = process.env.WAFRA_TEST_BUILD_DIR || path.join(root, 'scripts/test/build');
const subjects = new Set(['auto-import', 'local-message-record', 'ios-notification-replay', 'import-plan', 'ios-local-capture']);
const cache = new Map();
const native = { 'react-native': 'stub-react-native', 'expo-crypto': 'stub-expo-crypto',
  'expo-secure-store': 'stub-secure-store', '../../modules/notification-reader': 'notification-reader',
  '../../modules/sms-reader': 'sms-reader' };
function current(name) {
  if (cache.has(name)) return cache.get(name);
  const file = path.join(root, 'src/lib', name + '.ts');
  const emitted = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {};
  for (const match of emitted.matchAll(/require\(["']([^"']+)["']\)/g)) {
    const key = match[1];
    const dependency = key.startsWith('@/lib/') ? key.slice(6) : native[key];
    assert.ok(dependency, `explicit runtime boundary required for ${key}`);
    dependencies[key] = subjects.has(dependency) ? current(dependency) : require(path.join(build, dependency + '.js'));
  }
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-09-19T12:00:00.000Z'])); }
    static now() { return Date.parse('2026-09-19T12:00:00.000Z'); }
  }
  const result = load(file, dependencies, { setTimeout, ...(name === 'ios-local-capture' ? { Date: FixtureDate } : {}) });
  cache.set(name, result);
  return result;
}
const { createIosNotificationReplayGuard } = current('ios-notification-replay');
const { parseLocalMessageRecord, preflightLocalMessageRecord } = current('local-message-record');
const { createLaunchAlertSession } = require(path.join(build, 'launch-alert-parser.js'));
const { bankIdentityForName, setActiveMarket, setLedgerCurrency } = require(path.join(build, 'markets.js'));
setActiveMarket('AE'); setLedgerCurrency('AED', 2);
const uuid = '55555555-5555-4555-8555-555555555555';
const nextUuid = '66666666-6666-4666-8666-666666666666';
const observedAt = '2026-09-18T10:30:00.000Z';
const now = new Date('2026-09-19T12:00:00.000Z');
const body = 'Your ADIB Covered Card ending with 4417 has been used for AED 250.00 at CARREFOUR on 18/09/2026.';
function parsed(text = body, at = observedAt) {
  const serialized = JSON.stringify({ v: 1, id: uuid, text, sender: 'Wafra Notification', source: 'notification', observedAt: at });
  return parseLocalMessageRecord(serialized, now, preflightLocalMessageRecord(serialized, now).market,
    createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED', activeMarket: 'AE' }));
}
function ledger(outcome = parsed()) {
  assert.equal(outcome.kind, 'parsed');
  const row = outcome.row;
  return { id: 'existing-push', source: 'sms', viaPush: true, amountFils: row.amountFils,
    type: row.type, title: row.merchant, date: row.date, ts: row.smsTs, smsKey: `s${row.smsTs}-${row.amountFils}`,
    accountId: 'card', category: row.categoryGuess,
    captureInstrument: { ...row.card, bankIdentity: bankIdentityForName(row.bankHint) } };
}
function assertReview(outcome, identity = nextUuid) {
  assert.equal(outcome.kind, 'review');
  assert.equal(outcome.milestone, 'none');
  assert.equal(outcome.item.attentionReason, 'possible-notification-replay');
  assert.equal(outcome.item.channel, 'push');
  assert.equal(outcome.item.id, 'local_review_id_' + identity.replace(/-/g, ''));
  assert.equal(outcome.item.sourceKey, 'local_review_source_' + identity.replace(/-/g, ''));
  assert.equal(JSON.stringify(outcome).includes(body), false);
  assert.equal(JSON.stringify(outcome).includes('Wafra Notification'), false);
  assert.equal(Object.hasOwn(outcome.item, 'raw'), false);
  assert.equal(Object.hasOwn(outcome.item, 'sender'), false);
}

test('existing push plus another observation at one second becomes possible-replay review', () => {
  const guard = createIosNotificationReplayGuard([ledger()]);
  const outcome = parsed(body, '2026-09-18T10:30:01.000Z');
  assertReview(guard(outcome, nextUuid));
  assert.equal(outcome.kind, 'parsed', 'the input outcome is not mutated');
});

test('same-page repeats and original queue retry review instead of posting more money', () => {
  const guard = createIosNotificationReplayGuard([]);
  const first = parsed();
  assert.equal(guard(first, uuid), first);
  assertReview(guard(parsed(body, '2026-09-18T10:30:01.000Z'), nextUuid));
  assertReview(guard(first, uuid), uuid);
});
test('UUID casing in a restored receipt cannot repost a handled observation', () => {
  const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const stored = { ...ledger(), notificationObservationId: id.toUpperCase() };
  assert.equal(createIosNotificationReplayGuard([stored])(parsed(), id).kind, 'ignored');
});

test('different merchant, instrument, issuer and events beyond 120 seconds remain parsed', () => {
  for (const candidate of [parsed(body.replace('CARREFOUR', 'COSTA COFFEE')),
    parsed(body.replace('4417', '5528')),
    parsed(body.replace('ADIB Covered', 'Emirates NBD Credit')),
    parsed(body, '2026-09-18T10:32:01.000Z')]) {
    assert.equal(candidate.kind, 'parsed');
    assert.equal(createIosNotificationReplayGuard([ledger()])(candidate, nextUuid), candidate);
  }
});

test('the helper touches only parsed notification transactions and compares every saved bank-alert row', () => {
  const first = parsed();
  const guard = createIosNotificationReplayGuard([{ ...ledger(), viaPush: false }]);
  assertReview(guard(first, uuid), uuid);
  for (const outcome of [{ kind: 'ignored', market: null, milestone: 'none' },
    { ...first, row: { ...first.row, channel: 'inbox' } },
    { ...first, row: { ...first.row, kind: 'cardStatement' } }]) {
    assert.equal(createIosNotificationReplayGuard([ledger()])(outcome, nextUuid), outcome);
  }
});

test('an unsafe replay identity fails closed with a bounded source-free error', () => {
  const guard = createIosNotificationReplayGuard([ledger()]);
  assert.throws(() => guard(parsed(), 'BANK: ' + body), error => {
    assert.equal(error.message, 'Notification replay review unavailable');
    assert.equal(error.message.includes(body), false);
    return true;
  });
});

test('replay review retains structured money and cannot silently fall back to automatic posting', () => {
  const first = parsed();
  const guard = createIosNotificationReplayGuard([ledger(first)]);
  const review = guard(first, nextUuid);
  assertReview(review);
  assert.equal(review.item.event.amount.value.currency, 'AED');
  assert.equal(review.item.event.amount.value.minorUnits, '25000');
  assert.equal(review.item.event.merchant.value, first.row.merchant);
  assert.equal(review.item.event.instrument.value.last4, '4417');
  const cannotRepresent = { ...first, row: { ...first.row, currency: 'XXX' } };
  assert.throws(() => createIosNotificationReplayGuard([ledger(first)])(cannotRepresent, nextUuid),
    { message: 'Notification replay review unavailable' });
});


test('durable observation receipt survives JSON storage and avoids review on failed-ACK retry', async () => {
  const { buildImportPlan } = current('import-plan');
  const { materializeImportBatch, applyMaterializedImportBatch } = require(path.join(build, 'ledger-import.js'));
  const { createLedgerPersistence } = load(path.join(root, 'src/lib/ledger-persistence.ts'));
  const { reconcileCaptureDuplicates } = require(path.join(build, 'dedupe.js'));
  const blank = { hydrated: true, accounts: [], transactions: [], budgets: [], bills: [], goals: [],
    cardDues: [], accountHints: {}, merchantOverrides: {}, lastScanTs: 0, parserVersion: 0 };
  const first = parsed();
  assert.equal(first.row.notificationObservationId, uuid);
  assert.equal(first.row.sourceEventId, undefined);
  let sequence = 0;
  const apply = (before, rows) => applyMaterializedImportBatch(before,
    materializeImportBatch(buildImportPlan(rows, before, 0, now).batch, before, prefix => prefix + (++sequence)));
  const saved = apply(blank, [first.row]);
  assert.equal(saved.transactions[0].notificationObservationId, uuid);
  const disk = new Map();
  const persistence = () => createLedgerPersistence({ prefix: 'notification-receipt-test', chunkSize: 50,
    currentChunkOrder: 'oldest-first', chunkTransactions: rows => [JSON.stringify(rows)], migrateLegacyState: async () => false,
    storage: { getItem: async key => disk.get(key) ?? null,
      multiGet: async keys => keys.map(key => [key, disk.get(key) ?? null]),
      multiSet: async entries => { for (const [key, value] of entries) disk.set(key, value); },
      multiRemove: async keys => { for (const key of keys) disk.delete(key); },
      destroy: async () => disk.clear() } });
  const writer = persistence(); await writer.load(); assert.equal(await writer.save(saved), true);
  const loaded = { ...await persistence().load(), hydrated: true };
  loaded.transactions = reconcileCaptureDuplicates(loaded.transactions);
  assert.equal(loaded.transactions[0].notificationObservationId, uuid);
  const retryGuard = createIosNotificationReplayGuard(loaded.transactions);
  const retry = retryGuard(first, uuid);
  assert.equal(retry.kind, 'ignored', 'known durable queue observation is ACK-only');
  assert.equal(retry.market, first.market);
  assert.equal(retry.milestone, 'none');
  assert.equal(buildImportPlan(retry.kind === 'parsed' ? [retry.row] : [], loaded, 0, now).txCount, 0);
  assertReview(retryGuard({ ...first, row: { ...first.row, notificationObservationId: nextUuid } }, nextUuid));
  const smsRow = { ...first.row, channel: 'inbox', sourceEventId: 'a'.repeat(64), notificationObservationId: undefined,
    smsTs: first.row.smsTs + 5000 };
  const healed = apply(loaded, [smsRow]);
  assert.equal(healed.transactions.length, 1);
  assert.equal(healed.transactions[0].smsKey, 'h' + 'a'.repeat(64));
  assert.equal(healed.transactions[0].notificationObservationId, uuid);
  assert.equal(createIosNotificationReplayGuard(healed.transactions)(first, uuid).kind, 'ignored');
  assertReview(createIosNotificationReplayGuard(healed.transactions)(
    parsed(body, '2026-09-18T10:30:10.000Z'), nextUuid));
  const edited = { ...healed, transactions: healed.transactions.map(row => ({ ...row, userEdited: true,
    amountFils: 24000, title: 'Corrected grocery purchase' })) };
  const before = JSON.stringify(edited.transactions);
  const editedRetry = createIosNotificationReplayGuard(edited.transactions)(first, uuid);
  assert.equal(editedRetry.kind, 'ignored');
  assert.equal(editedRetry.milestone, 'none');
  assert.equal(editedRetry.market, first.market);
  const plan = buildImportPlan(editedRetry.kind === 'parsed' ? [editedRetry.row] : [], edited, 0, now);
  assert.equal(plan.txCount, 0);
  assert.equal(plan.batch.updates.length, 0);
  assert.equal(JSON.stringify(edited.transactions), before);
});

test('only local push rows with validated UUIDs persist observation receipts', () => {
  const { buildImportPlan } = current('import-plan');
  const blank = { hydrated: true, accounts: [], transactions: [], budgets: [], bills: [], goals: [],
    cardDues: [], accountHints: {}, merchantOverrides: {}, lastScanTs: 0, parserVersion: 0 };
  for (const patch of [{ channel: 'inbox' }, { channel: undefined }, { captureSource: 'pdf' },
    { sourceEventId: 'a'.repeat(64) }, { notificationObservationId: 'not-a-uuid' }]) {
    const plan = buildImportPlan([{ ...parsed().row, notificationObservationId: uuid, ...patch }], blank, 0, now);
    assert.equal(plan.batch.transactions.length, 1);
    assert.equal(plan.batch.transactions[0].notificationObservationId, undefined);
  }
});

 test('SMS-first observations enter Review before reconciliation and remain review-only after retries', () => {
  const first = parsed();
  const sms = { ...ledger(first), viaPush: undefined, smsKey: 'h' + 'a'.repeat(64) };
  const observation = createIosNotificationReplayGuard([sms])(first, uuid);
  assertReview(observation, uuid);
  const { buildImportPlan } = current('import-plan');
  const state = { hydrated: true, accounts: [], transactions: [sms], budgets: [], bills: [], goals: [],
    cardDues: [], accountHints: {}, merchantOverrides: {}, lastScanTs: 0, parserVersion: 0 };
  assert.equal(buildImportPlan(observation.kind === 'parsed' ? [observation.row] : [], state, 0, now).txCount, 0);
  assertReview(createIosNotificationReplayGuard([sms])(first, uuid), uuid);
 });

test('retained or resolved Review identity makes failed-ACK retry inert after a user correction', () => {
  const first = parsed();
  const review = createIosNotificationReplayGuard([{ ...ledger(), viaPush: false }])(first, uuid);
  assertReview(review, uuid);
  const edited = { ...ledger(), viaPush: false, amountFils: 24000, title: 'Corrected purchase', userEdited: true };
  const retry = createIosNotificationReplayGuard([edited], [review.item.sourceKey])(first, uuid);
  assert.equal(retry.kind, 'ignored');
  assert.equal(retry.milestone, 'none');
  const payment = parsed('ADIB: Payment of AED 100.00 received towards your Covered Card ending 4417. Thank you.');
  assert.equal(payment.kind, 'review');
  assert.equal(createIosNotificationReplayGuard([], [payment.item.sourceKey])(payment, uuid).kind, 'ignored');
});

test('SMS earlier on the same drain page protects the matching notification', () => {
  const notification = parsed();
  const sms = { ...notification, row: { ...notification.row, channel: 'inbox',
    sourceEventId: 'a'.repeat(64), notificationObservationId: undefined } };
  const guard = createIosNotificationReplayGuard([]);
  assert.equal(guard(sms, 'a'.repeat(64)), sms);
  assertReview(guard(notification, uuid), uuid);
});

test('seeding the page SMS before notification comparison preserves SMS identity in either native order', () => {
  const { buildImportPlan } = current('import-plan');
  const { materializeImportBatch, applyMaterializedImportBatch } = require(path.join(build, 'ledger-import.js'));
  const first = parsed();
  const sms = { ...first, row: { ...first.row, channel: 'inbox', sourceEventId: 'a'.repeat(64),
    notificationObservationId: undefined, smsTs: first.row.smsTs + 5000 } };
  for (const page of [[first, sms], [sms, first]]) {
    const guard = createIosNotificationReplayGuard([]);
    for (const outcome of page) if (outcome.row.channel !== 'push') guard(outcome, 'a'.repeat(64));
    const outcomes = page.map(item => item.row.channel === 'push' ? guard(item, uuid) : item);
    const review = outcomes.find(item => item.kind === 'review');
    assertReview(review, uuid);
    const blank = { hydrated: true, accounts: [], transactions: [], budgets: [], bills: [], goals: [],
      cardDues: [], accountHints: {}, merchantOverrides: {}, lastScanTs: 0, parserVersion: 0 };
    let sequence = 0;
    const rows = outcomes.filter(item => item.kind === 'parsed').map(item => item.row);
    const saved = applyMaterializedImportBatch(blank, materializeImportBatch(
      buildImportPlan(rows, blank, 0, now).batch, blank, prefix => prefix + (++sequence)));
    assert.equal(saved.transactions.length, 1);
    assert.equal(saved.transactions[0].smsKey, 'h' + 'a'.repeat(64));
    const edited = saved.transactions.map(row => ({ ...row, userEdited: true, amountFils: 24000, title: 'Corrected' }));
    assert.equal(createIosNotificationReplayGuard(edited, [review.item.sourceKey])(first, uuid).kind, 'ignored');
  }
});

test('actual coordinator handles both mixed page orders and failed ACK after user correction', async () => {
  const { createIosLocalCaptureCoordinator } = current('ios-local-capture');
  const { materializeImportBatch, applyMaterializedImportBatch } = require(path.join(build, 'ledger-import.js'));
  const tray = require(path.join(build, 'alert-review-tray.js'));
  for (const notificationFirst of [true, false]) {
    let state = { hydrated: true, marketId: 'AE', captureOptOut: false, accounts: [], transactions: [], budgets: [], bills: [], goals: [],
      cardDues: [], accountHints: {}, merchantOverrides: {}, lastScanTs: 0, parserVersion: 0, reviewTray: tray.emptyAlertReviewTray() };
    const notification = JSON.stringify({ v: 1, id: uuid, text: body, sender: 'Wafra Notification', source: 'notification', observedAt });
    const sms = JSON.stringify({ v: 1, id: 'a'.repeat(64), text: body, sender: 'ADIB', source: 'message', observedAt: '2026-09-18T10:30:01.000Z' });
    let queue = notificationFirst ? [notification, sms] : [sms, notification], failAck = true, sequence = 0;
    const native = { notificationCaptureSupported: true, purgeExpired: async () => 0,
      getCaptureStatus: async () => ({ firstCapturedAt: null }), recordFirstCapturedAt: async () => {},
      listPendingRecords: async () => [], listPendingRecordsIncludingNotifications: async () => [...queue],
      acknowledgeRecords: async () => { if (failAck) { failAck = false; throw Error('synthetic ACK failure'); } queue = []; } };
    const coordinator = createIosLocalCaptureCoordinator({ native, ledger: { getState: () => state, getStateGeneration: () => 1,
      ensureDurable: async () => {},
      stageReviewAlerts: items => {
        let admitted = 0;
        for (const item of items) { const result = tray.admitPreparedReviewAlert(state.reviewTray, item, now.getTime());
          state.reviewTray = result.state; admitted += result.outcome === 'admitted' ? 1 : 0; }
        return { admitted, durable: Promise.resolve() };
      },
      importBatch: batch => { const materialized = materializeImportBatch(batch, state, prefix => prefix + (++sequence));
        state = applyMaterializedImportBatch(state, materialized);
        return { ids: materialized.transactions.map(row => row.id), durable: Promise.resolve() }; },
    }, retireShortcutCapture: async () => 'complete' });
    await assert.rejects(coordinator.drain(), /synthetic ACK failure/);
    assert.equal(state.transactions.length, 1);
    assert.equal(state.transactions[0].smsKey, 'h' + 'a'.repeat(64));
    assert.equal(state.reviewTray.pending.length, 1);
    state.transactions = state.transactions.map(row => ({ ...row, userEdited: true, amountFils: 24000, title: 'Corrected' }));
    await coordinator.drain();
    assert.equal(state.transactions.length, 1);
    assert.equal(state.transactions[0].amountFils, 24000);
    assert.equal(state.transactions[0].title, 'Corrected');
    assert.equal(queue.length, 0);
    assert.equal(state.reviewTray.pending.length, 1);
  }
});
