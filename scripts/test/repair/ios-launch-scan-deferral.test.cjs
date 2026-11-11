'use strict';
// iPhone launch and resume scans wait for real frames and the foreground lease,
// instead of running at once on top of Home's first frames, and they never lose
// a request. The scheduling is executed for real (deferred-scan.ts driving
// after-first-frames.ts on a fake clock); the hook wiring is read from source.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { createDeferredScan } = load(path.join(root, 'src/lib/deferred-scan.ts'));

/** A manual clock: frames and timers fire only when the test says so. */
function fakeEnvironment() {
  const frames = [];
  const timers = [];
  const idle = { resolvers: [] };
  const globals = {
    requestAnimationFrame: (cb) => { frames.push(cb); return frames.length; },
    cancelAnimationFrame: () => {},
    setTimeout: (cb) => { timers.push(cb); return timers.length; },
    clearTimeout: () => {},
  };
  const dependencies = {
    '@/lib/foreground-history-priority': {
      // The foreground lease: resolves only when the test releases it.
      waitForForegroundHistoryIdle: () => new Promise((resolve) => idle.resolvers.push(resolve)),
    },
  };
  const { runAfterFirstFrames } = load(path.join(root, 'src/lib/after-first-frames.ts'), dependencies, globals);
  const drain = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };
  return {
    schedule: (run) => runAfterFirstFrames(run),
    frame: () => { const cb = frames.shift(); assert.ok(cb, 'a frame was requested'); cb(); },
    pendingFrames: () => frames.length,
    settle: () => { const cb = timers.shift(); assert.ok(cb, 'the settle timer was set'); cb(); },
    releaseLease: async () => { idle.resolvers.splice(0).forEach((resolve) => resolve()); await drain(); },
    drain,
  };
}

test('a scan request waits for two frames, the settle and the foreground lease', async () => {
  const env = fakeEnvironment();
  const scans = [];
  const deferred = createDeferredScan(env.schedule, () => scans.push('scan'));
  deferred.request();
  assert.equal(scans.length, 0, 'nothing scans at request time (the old iOS launch behaviour)');
  assert.equal(deferred.pending(), true);
  env.frame();
  assert.equal(scans.length, 0, 'the first frame is the commit');
  env.frame();
  assert.equal(scans.length, 0, 'the second frame has been drawn, but the settle has not elapsed');
  env.settle();
  await env.drain();
  assert.equal(scans.length, 0, 'a held foreground lease (a tap, a tab switch) still blocks the scan');
  await env.releaseLease();
  assert.deepEqual(scans, ['scan']);
  assert.equal(deferred.pending(), false);
});

test('requests while one is pending join it, and the scan runs once after the last request', async () => {
  const env = fakeEnvironment();
  let scans = 0;
  const deferred = createDeferredScan(env.schedule, () => { scans += 1; });
  deferred.request();
  deferred.request();
  deferred.request();
  assert.equal(env.pendingFrames(), 1, 'one deferred task, not three');
  env.frame(); env.frame(); env.settle();
  await env.releaseLease();
  assert.equal(scans, 1);
});

test('a request after the scan started schedules another one (no wake-up is swallowed)', async () => {
  const env = fakeEnvironment();
  let scans = 0;
  const deferred = createDeferredScan(env.schedule, () => { scans += 1; });
  deferred.request();
  env.frame(); env.frame(); env.settle();
  await env.releaseLease();
  assert.equal(scans, 1);
  deferred.request(); // e.g. the next return to `active`
  assert.equal(deferred.pending(), true);
  env.frame(); env.frame(); env.settle();
  await env.releaseLease();
  assert.equal(scans, 2);
});

test('cancel (unmount) drops only the pending request, and asking again works', async () => {
  const env = fakeEnvironment();
  let scans = 0;
  const deferred = createDeferredScan(env.schedule, () => { scans += 1; });
  deferred.request();
  deferred.cancel();
  assert.equal(deferred.pending(), false);
  env.frame(); // a frame already queued may still fire; it must not scan or set the settle timer
  env.frame();
  await env.releaseLease();
  assert.equal(scans, 0, 'a cancelled request never scans');
  deferred.request();
  env.frame(); env.frame(); env.settle();
  await env.releaseLease();
  assert.equal(scans, 1, 'the next mount or active event asks again and is served');
});

test('a scheduler that runs the task before returning its handle still scans once', () => {
  let scans = 0;
  const deferred = createDeferredScan((run) => { run(); return { cancel() {} }; }, () => { scans += 1; });
  deferred.request();
  assert.equal(scans, 1);
  assert.equal(deferred.pending(), false);
  deferred.request();
  assert.equal(scans, 2);
});

test('use-auto-import defers only the iPhone launch and active scans; live capture and Android are unchanged', () => {
  const hook = read('src/hooks/use-auto-import.ts');
  assert.match(hook, /import \{ runAfterFirstFrames \} from '@\/lib\/after-first-frames';/);
  assert.match(hook, /import \{ createDeferredScan \} from '@\/lib\/deferred-scan';/);
  assert.match(hook, /const iosScan = Platform\.OS === 'ios'\s*\? createDeferredScan\(\(run\) => runAfterFirstFrames\(run\), \(\) => scan\(\)\)\s*: null;/);
  // Launch: Android keeps its grace timer, iOS requests a deferred scan, nothing else scans at once on iOS.
  assert.match(hook, /initialScanTimer = setTimeout\([\s\S]*?ANDROID_INITIAL_SCAN_GRACE_MS\);\s*\} else if \(iosScan\) \{\s*iosScan\.request\(\);\s*\} else \{\s*scan\(force\);/);
  // Every return to `active` still requests a scan, now deferred on iOS; Android still has its own scheduler.
  assert.match(hook, /if \(next !== 'active'\) return;\s*if \(iosScan\) iosScan\.request\(\);\s*else if \(Platform\.OS !== 'android'\) scan\(\);/);
  // Leaving the screen cancels the pending request.
  assert.match(hook, /initialScanCancelled = true;[\s\S]*?iosScan\?\.cancel\(\);\s*sub\.remove\(\);/);
  // Live capture (the native queue signal) is NOT deferred.
  assert.match(hook, /iosNative\.addListener\('onQueueChanged', \(\) => scheduler\.request\(\)\)/);
  assert.match(hook, /createInboxRefreshScheduler\(async \(\) => \{[\s\S]*?if \(canScan\(\)\) await latestScan\.current\(false\);/);
  // No other synchronous iOS scan call remains in the launch/active effect.
  const effect = hook.slice(hook.indexOf('let initialScanTimer'), hook.indexOf('// Session setup cannot cover'));
  assert.equal((effect.match(/\bscan\(force\)/g) ?? []).length, 2,
    'only Android\'s timer (after its grace and the lease) and the non-iOS, non-Android fallback scan directly');
  assert.match(effect, /if \(!initialScanCancelled && RNAppState\.currentState === 'active'\) scan\(force\);/);
});
