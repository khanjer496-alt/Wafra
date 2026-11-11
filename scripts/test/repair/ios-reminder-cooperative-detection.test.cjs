'use strict';
// Re-arming the payment reminders (about 8 s after a ledger change on iOS) used to
// let buildPaymentReminders run the SYNCHRONOUS subscription detector on the JS
// thread on iOS; only Android used the cooperative one that yields between slices.
// The real notifications.ts runs here with a stubbed OS and detector.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const now = new Date(2026, 8, 27, 12);

function harness({ platform, detect, history = false } = {}) {
  const calls = { detect: [], build: [], plan: [] };
  const api = load(path.join(root, 'src/lib/notifications.ts'), {
    'expo-notifications': {
      getPermissionsAsync: async () => ({ granted: true }),
      setNotificationHandler() {}, AndroidImportance: { DEFAULT: 3 },
      setNotificationChannelAsync: async () => {},
      cancelScheduledNotificationAsync: async () => {},
      scheduleNotificationAsync: async (request) => { calls.plan.push(request.identifier); },
      getAllScheduledNotificationsAsync: async () => [],
      SchedulableTriggerInputTypes: { DATE: 'date' },
    },
    'react-native': { Platform: { OS: platform } },
    '@/lib/daily-summary': { buildDailySummary: () => null },
    '@/lib/format': { toISODate: () => '2026-09-27' }, '@/lib/i18n': { t: (key) => key },
    '@/lib/history-import': { historyImportIncomplete: () => history },
    '@/lib/ledger': { liveAccountIds: () => new Set(['live']), internalTransferIdsForState: () => new Set(['internal']) },
    '@/lib/reminders': {
      MAX_REMINDERS: 24,
      buildPaymentReminders: (...args) => { calls.build.push(args); return [{ id: 'sub-netflix', kind: 'subscription', date: new Date(2026, 9, 1), title: 'Renews', body: 'Soon' }]; },
    },
    '@/lib/reminder-schedule': load(path.join(root, 'src/lib/reminder-schedule.ts')),
    '@/lib/runtime-performance': { recordRuntimeOperation() {} },
    '@/lib/subscriptions': { detectSubscriptionsCooperatively: async (...args) => { calls.detect.push(args); return detect ? detect(args) : [{ name: 'Netflix' }]; } },
  });
  return { api, calls };
}
const state = (extra = {}) => ({ hydrated: true, onboarded: true, transactions: [{ id: 'a' }], notSubscriptions: ['x'], accounts: [{ id: 'live' }],
  bills: [], cardDues: [], historyImport: null, dailySummary: false, ...extra });

for (const platform of ['ios', 'android']) {
  test(`${platform}: automatic reminder setup detects subscriptions cooperatively and hands the list to the plan`, async () => {
    const { api, calls } = harness({ platform });
    const s = state();
    await api.syncPaymentReminders(s, now);
    assert.equal(calls.detect.length, 1, 'the cooperative detector ran once');
    const [transactions, notSubscriptions, at, liveAccounts, internal] = calls.detect[0];
    assert.equal(transactions, s.transactions);
    assert.equal(notSubscriptions, s.notSubscriptions);
    assert.equal(at, now);
    assert.deepEqual([...liveAccounts], ['live']);
    assert.deepEqual([...internal], ['internal']);
    assert.equal(calls.build.length, 1);
    assert.deepEqual(calls.build[0][3], [{ name: 'Netflix' }], 'the plan receives the detected list, so it never runs the synchronous detector');
    assert.deepEqual(calls.plan, ['wafra-reminder-sub-netflix'], 'the reminders are still scheduled');
  });

  test(`${platform}: headless obligations-only updates skip recurrence detection entirely`, async () => {
    const { api, calls } = harness({ platform });
    await api.syncPaymentReminders(state(), now, { obligationsOnly: true });
    assert.equal(calls.detect.length, 0);
    assert.equal(JSON.stringify(calls.build[0][3]), '[]', 'known obligations only, no recurrence scan and no synchronous fallback');
  });

  test(`${platform}: a cancelled analysis (null) schedules nothing`, async () => {
    const { api, calls } = harness({ platform, detect: () => null });
    await api.syncPaymentReminders(state(), now);
    assert.equal(calls.detect.length, 1);
    assert.equal(calls.build.length, 0, 'no plan is built from a cancelled analysis');
    assert.deepEqual(calls.plan, []);
  });
}

test('Android keeps skipping detection while a history import is busy; web does nothing', async () => {
  const busy = harness({ platform: 'android', history: true });
  await busy.api.syncPaymentReminders(state({ historyImport: { status: 'running' } }), now);
  assert.equal(busy.calls.detect.length, 0);
  assert.equal(JSON.stringify(busy.calls.build[0][3]), '[]');
  const web = harness({ platform: 'web' });
  await web.api.syncPaymentReminders(state(), now);
  assert.deepEqual([web.calls.detect.length, web.calls.build.length], [0, 0]);
});

test('iOS has no history-busy shortcut: its imports never made the ledger incomplete for reminders', async () => {
  const { api, calls } = harness({ platform: 'ios', history: true });
  await api.syncPaymentReminders(state({ historyImport: { status: 'running' } }), now);
  assert.equal(calls.detect.length, 1, 'iOS behaves as before apart from yielding between slices');
});
