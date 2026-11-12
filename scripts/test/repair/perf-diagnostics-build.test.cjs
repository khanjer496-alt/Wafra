'use strict';
// Internal iOS performance-diagnostics build (TestFlight INTERNAL group only).
// The stall monitor and its timing export run on iOS only when the build sets
// EXPO_PUBLIC_WAFRA_PERF_DIAG=1, which only the isolated perf-diagnostics EAS
// profile does. Store and public builds keep the previous behaviour exactly.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const runtimeFile = path.join(root, 'src/lib/runtime-performance.ts');
const launchFile = path.join(root, 'src/lib/launch-performance.ts');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function runtime({ platform, env = {} }) {
  let now = 50_000;
  const writes = [];
  const intervals = [];
  const logs = [];
  class Clock extends Date { static now() { return now; } }
  const api = load(runtimeFile, {
    '@react-native-async-storage/async-storage': {
      getItem: async () => null,
      setItem: async (key, value) => { writes.push([key, value]); },
    },
    'react-native': {
      Platform: { OS: platform },
      AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    },
  }, {
    Date: Clock,
    process: { env },
    console: { info: (...args) => logs.push(args) },
    setInterval: (fn, ms) => { intervals.push(ms); return intervals.length; },
    clearInterval: () => {},
  });
  return { ...api, writes, intervals, logs, advance: ms => { now += ms; } };
}

function launch(env) {
  return load(launchFile, {}, { process: { env }, performance: { now: () => 0 }, console: { info() {} } });
}

const NEW_TAGS = ['store-hydrate', 'transactions-filter-index', 'transactions-projection',
  'flow-summary', 'language-remount', 'ios-capture-drain'];

test('a store iOS build records nothing and starts no sampler (unchanged behaviour)', () => {
  for (const env of [{}, { EXPO_PUBLIC_WAFRA_PERF_DIAG: '0' }, { EXPO_PUBLIC_WAFRA_PERF_DIAG: 'true' }]) {
    const h = runtime({ platform: 'ios', env });
    const stop = h.startRuntimePerformanceMonitor();
    h.recordRuntimeOperation('store-hydrate', 300);
    h.recordRuntimeInteraction('main-tab-press');
    h.beginRuntimeOperation('language-remount'); h.advance(400); h.endRuntimeOperation('language-remount');
    stop();
    assert.deepEqual(h.intervals, [], 'no 1-second sampler on a store iOS build');
    assert.deepEqual(plain(h.getRuntimePerformanceSnapshot().operations), {});
    assert.equal(h.getRuntimePerformanceSnapshot().recentMainTabPresses2s, 0);
    assert.equal(h.writes.length, 0, 'no breadcrumb writes');
  }
});

test('an internal diagnostics iOS build runs the monitor and records the new fixed tags', () => {
  const h = runtime({ platform: 'ios', env: { EXPO_PUBLIC_WAFRA_PERF_DIAG: '1' } });
  const stop = h.startRuntimePerformanceMonitor();
  assert.deepEqual(h.intervals, [1_000]);
  for (const tag of NEW_TAGS) h.recordRuntimeOperation(tag, 12.6);
  const operations = plain(h.getRuntimePerformanceSnapshot().operations);
  for (const tag of NEW_TAGS) assert.deepEqual(operations[tag], { count: 1, maxMs: 13, totalMs: 13, recentMs: [13] }, tag);
  h.recordRuntimeOperation('private merchant text', 99);
  assert.equal(Object.keys(plain(h.getRuntimePerformanceSnapshot().operations)).length, NEW_TAGS.length);
  stop();
});

test('the console trace stays Android-only; iOS diagnostics are export-only', () => {
  const ios = runtime({ platform: 'ios', env: { EXPO_PUBLIC_WAFRA_PERF_DIAG: '1', EXPO_PUBLIC_WAFRA_CAPTURE_TRACE: '1' } });
  ios.recordRuntimeOperation('capture-plan', 900);
  assert.equal(ios.logs.length, 0);
  const android = runtime({ platform: 'android', env: { EXPO_PUBLIC_WAFRA_CAPTURE_TRACE: '1' } });
  android.recordRuntimeOperation('capture-plan', 900);
  assert.equal(android.logs.length, 1);
});

test('Android keeps its monitor without the diagnostics flag', () => {
  const h = runtime({ platform: 'android' });
  const stop = h.startRuntimePerformanceMonitor();
  h.recordRuntimeOperation('ios-capture-drain', 40);
  assert.deepEqual(h.intervals, [1_000]);
  assert.equal(plain(h.getRuntimePerformanceSnapshot().operations)['ios-capture-drain'].count, 1);
  stop();
});

test('the language-remount span is opened once, closed once, and never reported when stale', () => {
  const h = runtime({ platform: 'ios', env: { EXPO_PUBLIC_WAFRA_PERF_DIAG: '1' } });
  h.endRuntimeOperation('language-remount');
  assert.equal(plain(h.getRuntimePerformanceSnapshot().operations)['language-remount'], undefined, 'first mount is not a switch');
  h.beginRuntimeOperation('language-remount'); h.advance(420); h.endRuntimeOperation('language-remount');
  h.endRuntimeOperation('language-remount');
  assert.deepEqual(plain(h.getRuntimePerformanceSnapshot().operations)['language-remount'],
    { count: 1, maxMs: 420, totalMs: 420, recentMs: [420] });
  h.beginRuntimeOperation('language-remount'); h.advance(61_000); h.endRuntimeOperation('language-remount');
  assert.equal(plain(h.getRuntimePerformanceSnapshot().operations)['language-remount'].count, 1, 'stale span dropped');
  h.beginRuntimeOperation('not a tag');
  h.endRuntimeOperation('not a tag');
  assert.equal(Object.keys(plain(h.getRuntimePerformanceSnapshot().operations)).length, 1);
});

test('the export is source-free: fixed phases, fixed tags, counts and milliseconds only', () => {
  const h = runtime({ platform: 'ios', env: { EXPO_PUBLIC_WAFRA_PERF_DIAG: '1' } });
  h.recordRuntimeOperation('transactions-projection', 210);
  const encoded = launch({ EXPO_PUBLIC_WAFRA_PERF_DIAG: '1' }).serializeLaunchMetrics(h.getRuntimePerformanceSnapshot());
  const parsed = JSON.parse(encoded);
  assert.equal(parsed.schemaVersion, 1);
  assert.ok(Array.isArray(parsed.metrics));
  assert.deepEqual(Object.keys(parsed.runtime).sort(), ['activeSamples', 'lagOver100Ms', 'lagOver250Ms', 'lagOver500Ms',
    'maxLagMs', 'operations', 'previousProcess', 'recentMainTabPresses2s', 'recentStallsMs', 'sampleIntervalMs']);
  const strings = [];
  JSON.parse(encoded, (key, value) => { if (typeof value === 'string') strings.push(value); return value; });
  const phases = launch({}).LAUNCH_PHASES;
  assert.ok(strings.every(value => phases.includes(value)), `only fixed phase names are strings: ${strings}`);
  assert.ok(!/merchant|amount|message|device|metadata|value|account|title|text/i.test(encoded), encoded);
  assert.equal(JSON.parse(launch({}).serializeLaunchMetrics()).runtime, undefined, 'the old shape is unchanged without a snapshot');
});

test('the export entry exists only in a diagnostics build, never in a store build', () => {
  const eas = JSON.parse(read('eas.json'));
  const effective = name => ({ ...(eas.build[name].extends ? effective(eas.build[name].extends) : {}), ...eas.build[name].env });
  const enabled = Object.keys(eas.build).filter(name => effective(name).EXPO_PUBLIC_WAFRA_PERF_DIAG === '1');
  assert.deepEqual(enabled, ['perf-diagnostics'], 'exactly one profile enables the diagnostics flag');
  for (const name of Object.keys(eas.build)) {
    assert.equal(launch(effective(name)).isInternalLaunchDiagnosticsEnabled(), name === 'perf-diagnostics', name);
  }
  for (const store of ['production', 'production-candidate', 'history-beta', 'capture-beta']) {
    assert.notEqual(effective(store).EXPO_PUBLIC_WAFRA_PERF_DIAG, '1', store);
  }
  const perf = eas.build['perf-diagnostics'];
  assert.equal(perf.distribution, 'store');
  assert.equal(perf.channel, 'perf-diagnostics', 'an isolated OTA channel: no store update carries the flag');
  assert.notEqual(perf.channel, eas.build.production.channel);
  assert.equal(perf.environment, 'preview');
  assert.equal(perf.env.EXPO_PUBLIC_WAFRA_AUTO_FOUNDER_PRO, '0', 'no automatic tester Pro outside history-beta');
  assert.ok(eas.submit['perf-diagnostics'], 'TestFlight submission profile');
  const settingsData = read('src/app/settings-data.tsx');
  assert.match(settingsData, /\{isInternalLaunchDiagnosticsEnabled\(\) &&\s*linkRow\(t\('launchMetricsInternal'\)/);
  assert.match(settingsData, /serializeLaunchMetrics\(getRuntimePerformanceSnapshot\(\)\)/);
  assert.equal(launch({}).isInternalLaunchDiagnosticsEnabled(), false, 'release build without any flag');
});

test('the release gate refuses the diagnostics flag outside its isolated iOS profile', async () => {
  const { assessReleaseReadiness } = await import(path.join(root, 'scripts/lib/release-readiness.mjs'));
  const perfFindings = report => report.findings.filter(item => item.code === 'perf-diagnostics-build');
  const build = (profile, platform = 'ios', publicEnv = {}) => assessReleaseReadiness({ root, publicEnv,
    intent: { kind: 'build', platform, profile, submit: false } });
  assert.equal(perfFindings(await build('perf-diagnostics')).length, 0);
  assert.equal(perfFindings(await build('perf-diagnostics', 'android')).length, 1);
  for (const profile of ['production', 'production-candidate', 'history-beta']) {
    assert.equal(perfFindings(await build(profile)).length, 0, profile);
    assert.equal(perfFindings(await build(profile, 'ios', { EXPO_PUBLIC_WAFRA_PERF_DIAG: '1' })).length, 1, profile);
  }
});

test('every new tag is wired at its call site and iOS tabs are still not frozen', () => {
  assert.match(read('src/lib/store.tsx'), /recordRuntimeOperation\('store-hydrate', Date\.now\(\) - hydrateStartedAt\)/);
  assert.match(read('src/app/transactions.tsx'), /measureRuntimeOperation\('transactions-filter-index'/);
  assert.match(read('src/app/transactions.tsx'), /measureRuntimeOperation\('transactions-projection'/);
  assert.match(read('src/app/(tabs)/flow.tsx'), /measureRuntimeOperation\('flow-summary'/);
  assert.match(read('src/app/settings.tsx'), /beginRuntimeOperation\('language-remount'\)/);
  assert.match(read('src/components/app-root-layout.tsx'), /endRuntimeOperation\('language-remount'\)/);
  assert.equal((read('src/hooks/use-auto-import.ts').match(/recordRuntimeOperation\('ios-capture-drain'/g) ?? []).length, 2);
  assert.match(read('src/app/(tabs)/bills.tsx'), /'bills-projection'/, 'Bills projection already tagged');
  assert.match(read('src/app/(tabs)/wallet.tsx'), /'wallet-balances'/, 'Wallet projections already tagged');
  assert.match(read('src/components/app-tabs-layout.tsx'), /freezeOnBlur: Platform\.OS === 'android'/);
});
