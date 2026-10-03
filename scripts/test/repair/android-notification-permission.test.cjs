'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');

function harness({ platform = 'android', current = { granted: false }, channelReady } = {}) {
  const events = [];
  let hasChannel = false;
  const api = load(path.join(root, 'src/lib/notifications.ts'), {
    'expo-notifications': {
      setNotificationHandler() {},
      AndroidImportance: { DEFAULT: 3 },
      IosAuthorizationStatus: { AUTHORIZED: 2, DENIED: 1, PROVISIONAL: 3 },
      setNotificationChannelAsync: async (id, options) => {
        events.push('channel-start');
        assert.equal(id, 'payment-reminders');
        assert.equal(options.importance, 3);
        await channelReady;
        hasChannel = true;
        events.push('channel-ready');
      },
      getPermissionsAsync: async () => { events.push('permission-read'); return current; },
      // Android 13 cannot present the permission prompt before a channel exists.
      requestPermissionsAsync: async () => {
        events.push('permission-request');
        return { granted: platform !== 'android' || hasChannel };
      },
    },
    'react-native': { Platform: { OS: platform } },
    '@/lib/daily-summary': {}, '@/lib/format': {}, '@/lib/i18n': { t: key => key },
    '@/lib/history-import': {}, '@/lib/ledger': {}, '@/lib/reminders': {},
    '@/lib/reminder-schedule': load(path.join(root, 'src/lib/reminder-schedule.ts')),
    '@/lib/runtime-performance': {}, '@/lib/subscriptions': {},
  });
  return { ...api, events };
}

test('Android permission request waits for a notification channel before consulting permissions', async () => {
  let ready;
  const channelReady = new Promise(resolve => { ready = resolve; });
  const h = harness({ channelReady });
  const pending = h.requestNotificationPermission();
  await new Promise(resolve => setImmediate(resolve));
  const eventsBeforeChannelReady = [...h.events];
  ready();
  const granted = await pending;
  assert.deepEqual(eventsBeforeChannelReady, ['channel-start']);
  assert.equal(granted, true);
  assert.deepEqual(h.events, ['channel-start', 'channel-ready', 'permission-read', 'permission-request']);
});

test('Android already-granted permission still ensures the reminder channel without prompting', async () => {
  const h = harness({ current: { granted: true } });
  assert.equal(await h.requestNotificationPermission(), true);
  assert.deepEqual(h.events, ['channel-start', 'channel-ready', 'permission-read']);
});

test('iOS provisional permission stays usable without a channel or permission prompt', async () => {
  const h = harness({ platform: 'ios', current: { granted: false, ios: { status: 3 } } });
  assert.equal(await h.requestNotificationPermission(), true);
  assert.deepEqual(h.events, ['permission-read']);
});

test('iOS undetermined permission requests authorization without creating an Android channel', async () => {
  const h = harness({ platform: 'ios' });
  assert.equal(await h.requestNotificationPermission(), true);
  assert.deepEqual(h.events, ['permission-read', 'permission-request']);
});

test('web permission requests avoid native APIs', async () => {
  const h = harness({ platform: 'web' });
  assert.equal(await h.requestNotificationPermission(), false);
  assert.deepEqual(h.events, []);
});
