'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const SUMMARY = 'wafra-daily-summary';
const now = new Date(2026, 8, 27, 12);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));
function harness({ platform = 'ios', permission, channel, schedule, getAll } = {}) {
  const events = [], pending = new Map([[SUMMARY, { title: 'Previous synthetic summary' }]]);
  let permissionCalls = 0;
  const api = load(path.join(root, 'src/lib/notifications.ts'), {
    'expo-notifications': {
      getPermissionsAsync: () => permission?.(++permissionCalls) ?? Promise.resolve({ granted: true }),
      setNotificationHandler() {}, AndroidImportance: { LOW: 1, DEFAULT: 3 },
      setNotificationChannelAsync: async id => { events.push(['channel', id]); await channel?.(id); },
      cancelScheduledNotificationAsync: async id => { events.push(['cancel', id]); pending.delete(id); },
      scheduleNotificationAsync: async request => {
        events.push(['schedule-start', request.identifier]);
        await schedule?.(request);
        pending.set(request.identifier, request.content);
        events.push(['schedule-end', request.identifier]);
      },
      getAllScheduledNotificationsAsync: async () => { await getAll?.(); return [...pending.keys()].map(identifier => ({identifier})); },
      SchedulableTriggerInputTypes: { DATE: 'date' },
    },
    'react-native': { Platform: { OS: platform } },
    '@/lib/daily-summary': { buildDailySummary: state => state.empty ? null : { title: state.title ?? 'Synthetic', body: 'Synthetic' } },
    '@/lib/format': { toISODate: () => '2026-09-27' }, '@/lib/i18n': { t: key => key },
    '@/lib/history-import': { historyImportIncomplete: () => false },
    '@/lib/ledger': { liveAccountIds: () => new Set(), internalTransferIdsForState: () => new Set() },
    '@/lib/reminders': { buildPaymentReminders: () => [], MAX_REMINDERS: 24 },
    '@/lib/reminder-schedule': load(path.join(root, 'src/lib/reminder-schedule.ts')),
    '@/lib/runtime-performance': { recordRuntimeOperation() {} },
    '@/lib/subscriptions': { detectSubscriptionsCooperatively: async () => [] },
  });
  return { ...api, events, pending };
}
test('disabling immediately cancels while an older summary waits for permission', async () => {
  const wait = deferred();
  const h = harness({ permission: () => wait.promise });
  const old = h.syncDailySummary({ dailySummary: true }, now);
  await h.cancelDailySummary();
  assert.equal(h.pending.has(SUMMARY), false);
  wait.resolve({ granted: true }); await old;
  assert.equal(h.pending.has(SUMMARY), false);
  assert.deepEqual(h.events, [['cancel', SUMMARY]]);
});
test('Android channel setup cannot resurrect a summary after opt-out', async () => {
  const wait = deferred();
  const h = harness({ platform: 'android', channel: () => wait.promise });
  const old = h.syncDailySummary({ dailySummary: true }, now); await tick();
  await h.cancelDailySummary();
  wait.resolve(); await old;
  assert.equal(h.pending.has(SUMMARY), false);
  assert.equal(h.events.some(e => e[0] === 'schedule-start'), false);
});
test('cancellation follows an already-dispatched native write before reporting completion', async () => {
  const wait = deferred();
  const h = harness({ schedule: () => wait.promise });
  const old = h.syncDailySummary({ dailySummary: true }, now); await tick();
  let cancelled = false;
  const cancel = h.cancelDailySummary().then(() => { cancelled = true; }); await tick();
  assert.equal(cancelled, false);
  wait.resolve(); await Promise.all([old, cancel]);
  assert.equal(cancelled, true);
  assert.equal(h.pending.has(SUMMARY), false);
  assert.deepEqual(h.events.map(e => e[0]), ['schedule-start', 'schedule-end', 'cancel']);
});
test('the newest summary or empty-day request wins over a stale permission response', async () => {
  for (const empty of [false, true]) {
    const wait = deferred();
    const h = harness({ permission: call => call === 1 ? wait.promise : Promise.resolve({ granted: true }) });
    const old = h.syncDailySummary({ dailySummary: true, title: 'Old' }, now);
    await h.syncDailySummary({ dailySummary: true, title: 'New', empty }, now);
    wait.resolve({ granted: true }); await old;
    assert.equal(h.pending.get(SUMMARY)?.title, empty ? undefined : 'New');
  }
});
test('an explicit later opt-in can schedule after cancellation', async () => {
  const wait = deferred();
  const h = harness({ permission: call => call === 1 ? wait.promise : Promise.resolve({ granted: true }) });
  const old = h.syncDailySummary({ dailySummary: true, title: 'Old' }, now);
  await h.cancelDailySummary();
  await h.syncDailySummary({ dailySummary: true, title: 'New opt-in' }, now);
  wait.resolve({ granted: true }); await old;
  assert.equal(h.pending.get(SUMMARY)?.title, 'New opt-in');
});
test('active and queued reminder rebuilds cannot undo a direct Settings opt-out', async () => {
  const wait = deferred(); let reads = 0;
  const h = harness({ getAll: () => ++reads === 1 ? wait.promise : Promise.resolve() });
  const first = h.syncPaymentReminders({ dailySummary: true }, now); await tick();
  const queued = h.syncPaymentReminders({ dailySummary: true }, now);
  await h.cancelDailySummary();
  wait.resolve(); await Promise.all([first, queued]);
  assert.equal(h.pending.has(SUMMARY), false);
  assert.equal(h.events.some(e => e[0] === 'schedule-start'), false);
});
test('a failed native schedule does not poison later cancellation', async () => {
  const h = harness({ schedule: async () => { throw new Error('synthetic scheduling failure'); } });
  await assert.rejects(h.syncDailySummary({ dailySummary: true }, now), /synthetic/);
  await h.cancelDailySummary();
  assert.equal(h.pending.has(SUMMARY), false);
});

test('an older reminder request with summary off cannot cancel a later explicit opt-in', async () => {
  const wait = deferred();
  const h = harness({ getAll: () => wait.promise });
  const old = h.syncPaymentReminders({ dailySummary: false }, now); await tick();
  await h.syncDailySummary({ dailySummary: true, title: 'Later opt-in' }, now);
  wait.resolve(); await old;
  assert.equal(h.pending.get(SUMMARY)?.title, 'Later opt-in');
});
