// Public regressions preserve the reported bank wording with synthetic card/amount values.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const built = name => require(`../build/${name}.js`);
const now = new Date(2026, 8, 29, 12);
const state = () => ({ hydrated: true, onboarded: true, accounts: [
  { id: 'card', name: 'Test credit card', kind: 'card', cardType: 'credit', openingFils: 0 },
], transactions: [], bills: [], cardDues: [
  { id: 'due', accountId: 'card', totalDueFils: 924964, minDueFils: 46248,
    dueDate: '2026-09-30', paidFils: 0 },
], notSubscriptions: [], dailySummary: true });

function harness(permission, detect = async () => []) {
  const pending = new Map([
    ['wafra-reminder-sub-example', {}], ['wafra-daily-summary', {}],
  ]);
  let recurrenceCalls = 0;
  const notifications = load(path.join(root, 'src/lib/notifications.ts'), {
    'expo-notifications': {
      setNotificationHandler() {},
      getPermissionsAsync: permission ?? (async () => ({ granted: true })),
      IosAuthorizationStatus: { AUTHORIZED: 2, PROVISIONAL: 3 },
      AndroidImportance: { DEFAULT: 3, LOW: 2 },
      SchedulableTriggerInputTypes: { DATE: 'date' },
      setNotificationChannelAsync: async () => {},
      getAllScheduledNotificationsAsync: async () => [...pending.keys()].map(identifier => ({ identifier })),
      cancelScheduledNotificationAsync: async id => { pending.delete(id); },
      scheduleNotificationAsync: async request => { pending.set(request.identifier, request); },
    },
    'react-native': { Platform: { OS: 'android' } },
    '@/lib/daily-summary': built('daily-summary'),
    '@/lib/format': built('format'),
    '@/lib/i18n': built('i18n'),
    '@/lib/ledger': built('ledger'),
    '@/lib/reminders': built('reminders'),
    '@/lib/reminder-schedule': load(path.join(root, 'src/lib/reminder-schedule.ts')),
    '@/lib/subscriptions': { detectSubscriptionsCooperatively: async () => { recurrenceCalls++; return detect(); } },
  });
  return { ...notifications, pending, recurrenceCalls: () => recurrenceCalls };
}

test('background card sync schedules the due without recurrence or cancelling other reminders', async () => {
  const h = harness();
  const s = state();
  await h.syncPaymentReminders(s, now, { obligationsOnly: true });
  assert.equal(h.recurrenceCalls(), 0);
  assert.ok(h.pending.has('wafra-reminder-sub-example'));
  assert.ok(h.pending.has('wafra-daily-summary'));
  assert.equal(h.pending.get('wafra-reminder-card-due-0').trigger.date.getDate(), 30);
  const paid = { ...s, cardDues: [{ ...s.cardDues[0], paidFils: 924964 }] };
  await h.syncPaymentReminders(paid, now, { obligationsOnly: true });
  assert.ok(!h.pending.has('wafra-reminder-card-due-0'));
  assert.ok(h.pending.has('wafra-reminder-sub-example'));
});

test('coalescing a background request never downgrades a queued full refresh', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const h = harness(async () => { if (++calls === 1) await gate; return { granted: true }; });
  const s = { ...state(), dailySummary: false };
  const first = h.syncPaymentReminders(s, now, { obligationsOnly: true });
  await new Promise(resolve => setImmediate(resolve));
  const full = h.syncPaymentReminders(s, now);
  const latest = h.syncPaymentReminders(s, now, { obligationsOnly: true });
  release();
  await Promise.all([first, full, latest]);
  assert.equal(h.recurrenceCalls(), 1, 'the queued full request still computes recurrence');
  assert.ok(!h.pending.has('wafra-reminder-sub-example'), 'the full refresh removes stale subscriptions');
  assert.ok(!h.pending.has('wafra-daily-summary'), 'the full refresh applies summary opt-out');
});

test('denied notification permission leaves the native schedule untouched', async () => {
  const h = harness(async () => ({ granted: false }));
  await h.syncPaymentReminders(state(), now, { obligationsOnly: true });
  assert.equal(h.recurrenceCalls(), 0);
  assert.deepEqual([...h.pending.keys()], ['wafra-reminder-sub-example', 'wafra-daily-summary']);
});

test('launch during incomplete history preserves subscriptions until recurrence can be rebuilt', async () => {
  const h = harness();
  await h.syncPaymentReminders({ ...state(), historyImport: { status: 'running' } }, now);
  assert.equal(h.recurrenceCalls(), 0);
  assert.ok(h.pending.has('wafra-reminder-card-due-0'));
  assert.ok(h.pending.has('wafra-reminder-sub-example'));
  assert.ok(h.pending.has('wafra-daily-summary'));
});

test('a failed foreground sync does not turn a later background wake into a full scan', async () => {
  const h = harness(undefined, async () => { throw new Error('recurrence failed'); });
  await assert.rejects(h.syncPaymentReminders(state(), now), /recurrence failed/);
  await h.syncPaymentReminders(state(), now, { obligationsOnly: true });
  assert.equal(h.recurrenceCalls(), 1);
  assert.ok(h.pending.has('wafra-reminder-card-due-0'));
  assert.ok(h.pending.has('wafra-reminder-sub-example'));
});
