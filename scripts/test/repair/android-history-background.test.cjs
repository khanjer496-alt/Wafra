'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const { createHistoryBackgroundRunner } = load(path.join(root, 'src/lib/android-history-background.ts'), {
  'react-native': { Platform: { OS: 'web' }, AppState: { currentState: 'active' } },
  '../../modules/sms-reader': { __esModule: true, default: null },
});
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
// The source is executed in a VM realm; settle both realms' promise assimilation.
const settle = () => new Promise(resolve => setImmediate(resolve));
function setup(overrides = {}) {
  let foreground = true, active = null;
  const events = [];
  const native = {
    startHistoryImport: async id => { events.push(['start', id]); active = id; return true; },
    isHistoryImportRunning: id => active === id,
    stopHistoryImport: async id => { events.push(['stop', id]); if (active === id) active = null; },
    ...overrides,
  };
  const runner = createHistoryBackgroundRunner(native, () => foreground);
  return { runner, events, native, background: () => { foreground = false; }, foreground: () => { foreground = true; },
    stopNative: () => { active = null; } };
}
test('one foreground service protects one coordinator across concurrent callers', async () => {
  const h = setup(); const finish = deferred(); let jobs = 0;
  const first = h.runner.run(async () => { jobs++; await finish.promise; }, () => true);
  const second = h.runner.run(async () => { jobs++; }, () => true);
  assert.equal(first, second);
  await settle();
  assert.equal(jobs, 1); assert.equal(h.events.filter(e => e[0] === 'start').length, 1);
  h.background(); assert.equal(h.runner.canContinue(), true);
  finish.resolve(); await first;
  assert.equal(h.runner.canContinue(), false);
  assert.equal(h.events.filter(e => e[0] === 'stop').length, 1);
});
test('headless task joins only the matching lease and ends when that job ends', async () => {
  const h = setup(), finish = deferred();
  const running = h.runner.run(() => finish.promise, () => true);
  await settle();
  let done = false;
  const task = h.runner.waitForTask(h.events[0][1]).then(() => { done = true; });
  await h.runner.waitForTask('stale-or-cold-start');
  assert.equal(done, false);
  finish.resolve(); await running; await task;
  assert.equal(done, true);
});
test('native pause/timeout blocks further work even while the UI is still foregrounded', async () => {
  const h = setup(), finish = deferred();
  const running = h.runner.run(() => finish.promise, () => true);
  await settle();
  assert.equal(h.runner.canContinue(), true);
  h.stopNative(); assert.equal(h.runner.canContinue(), false);
  finish.resolve(); await running;
});
test('older binaries and rejected starts fall back to foreground-only operation', async () => {
  for (const supported of [false, true]) {
    let active = true; const finish = deferred(); let ran = false;
    const native = supported ? { startHistoryImport: async () => false, isHistoryImportRunning: () => false, stopHistoryImport: async () => {} } : null;
    const runner = createHistoryBackgroundRunner(native, () => active);
    const running = runner.run(async () => { ran = true; await finish.promise; }, () => true);
    await settle();
    assert.equal(ran, true); assert.equal(runner.canContinue(), true);
    active = false; assert.equal(runner.canContinue(), false);
    finish.resolve(); await running;
  }
});
test('no service or parser starts from the background or without eligible consent/state', async () => {
  const h = setup(); let jobs = 0;
  await h.runner.run(async () => { jobs++; }, () => false);
  h.background(); await h.runner.run(async () => { jobs++; }, () => true);
  assert.equal(jobs, 0); assert.equal(h.events.length, 0);
});
test('revocation during native startup prevents parsing and releases the service', async () => {
  const start = deferred(); const h = setup({ startHistoryImport: () => start.promise });
  let consent = true, jobs = 0;
  const running = h.runner.run(async () => { jobs++; }, () => consent);
  await Promise.resolve(); consent = false; start.resolve(true); await running;
  assert.equal(jobs, 0); assert.equal(h.events[0][0], 'stop');
});
test('unmount/cancellation during startup cannot run the old coordinator', async () => {
  const start = deferred(); const h = setup({ startHistoryImport: () => start.promise });
  let jobs = 0;
  const running = h.runner.run(async () => { jobs++; }, () => true);
  await Promise.resolve(); h.runner.cancel(); start.resolve(true); await running;
  assert.equal(jobs, 0); assert.equal(h.runner.canContinue(), false);
});
test('failed page persistence still tears down the headless lease and propagates failure', async () => {
  const h = setup();
  await assert.rejects(h.runner.run(async () => { throw new Error('durability failed'); }, () => true), /durability failed/);
  assert.equal(h.events.at(-1)[0], 'stop'); assert.equal(h.runner.canContinue(), false);
});
test('explicit Resume signal is delivered even without a status transition', () => {
  const history = load(path.join(root, 'src/lib/history-import.ts'));
  let requests = 0;
  const unsubscribe = history.subscribeHistoryImportRequest(() => { requests++; });
  history.requestHistoryImportRun(); history.requestHistoryImportRun();
  assert.equal(requests, 2); unsubscribe(); history.requestHistoryImportRun(); assert.equal(requests, 2);
});
test('native lease is private, bounded, not sticky, and carries no financial payload', () => {
  const source = fs.readFileSync(path.join(root, 'modules/sms-reader/android/src/main/java/expo/modules/smsreader/SmsHistoryImportService.kt'), 'utf8');
  const manifest = fs.readFileSync(path.join(root, 'modules/sms-reader/android/src/main/AndroidManifest.xml'), 'utf8');
  assert.match(source, /MAX_RUN_MS = 20 \* 60 \* 1000L/);
  assert.match(source, /override fun onTimeout/); assert.match(source, /return START_NOT_STICKY/);
  assert.match(manifest, /android:exported="false" android:foregroundServiceType="dataSync"/);
  assert.match(source, /putString\("sessionId", id\)/);
  const gradle = fs.readFileSync(path.join(root, 'modules/sms-reader/android/build.gradle'), 'utf8');
  assert.match(gradle, /implementation 'com.facebook.react:react-android'/);
  assert.match(source, /Build.VERSION.SDK_INT >= Build.VERSION_CODES.O/);
  assert.doesNotMatch(source, /SharedPreferences|Telephony|SMS_RECEIVED|BOOT_COMPLETED|Log\./);
});
