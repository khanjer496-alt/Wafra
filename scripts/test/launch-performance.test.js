const fs = require('node:fs');
const path = require('node:path');
const load = require('./repair/load-typescript.cjs');
const launchFile = path.join(__dirname, '../../src/lib/launch-performance.ts');
const loadLaunch = (env = {}, output = [], clock = { now: 1_000 }) => load(launchFile, {}, {
  process: { env },
  performance: { now: () => clock.now },
  console: { info: (...args) => output.push(args) },
});

const {
  createLaunchTimeline,
  LAUNCH_PHASES,
  serializeLaunchMetrics,
} = loadLaunch();
const {
  buildLaunchBenchmarkBackup,
  LAUNCH_BENCHMARK_ROW_COUNTS,
} = load(path.join(__dirname, '../../src/lib/launch-benchmark.ts'), {}, { Error });

const rootSource = fs.readFileSync(path.join(__dirname, '../../src/components/app-root-layout.tsx'), 'utf8');
const homeSource = fs.readFileSync(path.join(__dirname, '../../src/screens/journal-home-screen.tsx'), 'utf8');
const lockSource = fs.readFileSync(path.join(__dirname, '../../src/components/lock-gate.tsx'), 'utf8');
// The internal metrics export moved with the other exports to Data and help.
const settingsSource = fs.readFileSync(path.join(__dirname, '../../src/app/settings-data.tsx'), 'utf8');
const benchmarkWrapper = fs.readFileSync(path.join(__dirname, '../generate-launch-benchmark-fixtures.sh'), 'utf8');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
  if (condition) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const timeline = createLaunchTimeline(1_000);
timeline.mark('fonts-ready', 1_125);
timeline.mark('ledger-load-start', 1_150);
timeline.mark('ledger-load-complete', 1_375);
timeline.mark('first-usable-home', 1_460);

ok('launch phases are a fixed privacy-safe vocabulary',
  JSON.stringify(LAUNCH_PHASES) === JSON.stringify([
    'js-instrumentation-start',
    'fonts-ready',
    'ledger-load-start',
    'ledger-read-complete',
    'ledger-metadata-complete',
    'ledger-overrides-complete',
    'ledger-row-transforms-complete',
    'ledger-reparse-complete',
    'ledger-migration-complete',
    'ledger-accounts-complete',
    'ledger-repairs-complete',
    'ledger-declines-complete',
    'ledger-finalize-complete',
    'ledger-reducer-normalize-start',
    'ledger-load-complete',
    'first-usable-home',
    'first-history-page',
  ]));

ok('launch timing records only phase and elapsed milliseconds',
  JSON.stringify(timeline.snapshot()) === JSON.stringify([
    { phase: 'js-instrumentation-start', elapsedMs: 0 },
    { phase: 'fonts-ready', elapsedMs: 125 },
    { phase: 'ledger-load-start', elapsedMs: 150 },
    { phase: 'ledger-load-complete', elapsedMs: 375 },
    { phase: 'first-usable-home', elapsedMs: 460 },
  ]), JSON.stringify(timeline.snapshot()));

timeline.mark('fonts-ready', 9_999);
ok('a repeated lifecycle mark cannot rewrite the first measurement',
  timeline.snapshot().find((row) => row.phase === 'fonts-ready')?.elapsedMs === 125);

const clockSkew = createLaunchTimeline(500);
clockSkew.mark('fonts-ready', 450);
ok('clock skew cannot produce a negative duration',
  clockSkew.snapshot()[1]?.elapsedMs === 0,
  JSON.stringify(clockSkew.snapshot()));

const encoded = JSON.stringify(timeline.snapshot());
ok('the metric shape has no open metadata field for financial or device data',
  !/merchant|amount|message|device|metadata|value/i.test(encoded), encoded);

const quiet = [];
const defaultLaunch = loadLaunch({}, quiet);
defaultLaunch.markLaunchPhase('ledger-load-start');
defaultLaunch.markLaunchPhase('ledger-load-complete');
ok('console launch timing is off by default', quiet.length === 0);
const disabled = [];
loadLaunch({ EXPO_PUBLIC_WAFRA_CAPTURE_TRACE: '0', EXPO_PUBLIC_WAFRA_INTERNAL_DIAGNOSTICS: '1' }, disabled)
  .markLaunchPhase('first-usable-home');
ok('internal export alone does not enable console timing', disabled.length === 0);

const logged = [];
const clock = { now: 1_000 };
const traced = loadLaunch({ EXPO_PUBLIC_WAFRA_CAPTURE_TRACE: '1' }, logged, clock);
clock.now = 1_250;
traced.markLaunchPhase('ledger-read-complete');
clock.now = 1_500;
traced.markLaunchPhase('first-usable-home', { merchant: 'DO_NOT_LOG', amount: 12345 });
traced.markLaunchPhase('first-usable-home');
traced.markLaunchPhase('DO_NOT_LOG');
traced.markLaunchPhase({ merchant: 'DO_NOT_LOG' });
ok('opt-in console timing emits only closed phases with monotonic elapsed milliseconds',
  JSON.stringify(logged) === JSON.stringify([
    ['WAFRA_LAUNCH_TIMING', JSON.stringify({ phase: 'js-instrumentation-start', elapsedMs: 0 })],
    ['WAFRA_LAUNCH_TIMING', JSON.stringify({ phase: 'ledger-read-complete', elapsedMs: 250 })],
    ['WAFRA_LAUNCH_TIMING', JSON.stringify({ phase: 'first-usable-home', elapsedMs: 500 })],
  ]), JSON.stringify(logged));
ok('console timing never serializes arbitrary caller arguments or unrecognized phases',
  !JSON.stringify(logged).includes('DO_NOT_LOG'));

const invalid = createLaunchTimeline(1_000);
invalid.mark('DO_NOT_LOG', 1_010);
invalid.mark('fonts-ready', Number.NaN);
invalid.mark('ledger-load-start', Number.POSITIVE_INFINITY);
ok('runtime phase and clock validation reject arbitrary metadata and nonfinite durations',
  JSON.stringify(invalid.snapshot()) === JSON.stringify([{ phase: 'js-instrumentation-start', elapsedMs: 0 }]));
let wallClockReads = 0;
const missingMonotonicClock = load(launchFile, {}, {
  process: { env: {} }, performance: undefined,
  Date: { now: () => { wallClockReads += 1; return 99; } },
});
missingMonotonicClock.markLaunchPhase('fonts-ready');
ok('missing monotonic clock never falls back to wall-clock dates',
  wallClockReads === 0 && missingMonotonicClock.getLaunchMetrics().every((metric) => metric.elapsedMs === 0));
let survivedLoggingFailure = false;
try {
  load(launchFile, {}, { process: { env: { EXPO_PUBLIC_WAFRA_CAPTURE_TRACE: '1' } },
    console: { info: () => { throw new Error('diagnostic sink unavailable'); } },
  }).markLaunchPhase('ledger-load-start');
  survivedLoggingFailure = true;
} catch {}
ok('a failing console sink cannot interrupt app startup', survivedLoggingFailure);

ok('release benchmark fixtures cover empty, 1k, 5k and 10k ledgers',
  JSON.stringify(LAUNCH_BENCHMARK_ROW_COUNTS) === JSON.stringify([0, 1_000, 5_000, 10_000]));

const fixture = buildLaunchBenchmarkBackup(1_000, Date.UTC(2026, 0, 15));
ok('a benchmark backup has the requested restore envelope and row count',
  fixture.app === 'wafra' && fixture.version === 1 &&
    fixture.data.onboarded === true && fixture.data.transactions.length === 1_000);
ok('benchmark rows are deterministic, generic and contain no raw alert text',
  fixture.data.transactions[0]?.id === 'launch-benchmark-000000' &&
    fixture.data.transactions[999]?.id === 'launch-benchmark-000999' &&
    fixture.data.transactions.every((tx) =>
      tx.source === 'manual' && tx.title === 'Sample expense' && !('raw' in tx)));

let rejectedUnsupportedSize = false;
try {
  buildLaunchBenchmarkBackup(999, 0);
} catch (error) {
  rejectedUnsupportedSize = error instanceof Error && error.message === 'unsupported_launch_benchmark_size';
}
ok('only the four reviewed benchmark sizes can be generated', rejectedUnsupportedSize);

ok('the internal export keeps the closed metric shape',
  JSON.parse(serializeLaunchMetrics()).schemaVersion === 1 &&
    Array.isArray(JSON.parse(serializeLaunchMetrics()).metrics));
ok('usable Home is marked by the focused Home behind a cleared privacy gate',
  !/first-usable-home/.test(rootSource) &&
    /focused && privacyGateCleared && state\.hydrated && state\.onboarded/.test(homeSource) &&
    /const privacyHidden = lockRequired \|\| backgroundCovered/.test(lockSource) &&
    /PrivacyGateContext\.Provider value=\{!privacyHidden\}/.test(lockSource));
ok('internal Release metrics have a guarded local file export surface',
  /isInternalLaunchDiagnosticsEnabled\(\)/.test(settingsSource) &&
    /shareTextFile\('wafra-launch-metrics\.json'/.test(settingsSource));
ok('the benchmark builder takes the shared test-build lock on Linux and macOS',
  /flock/.test(benchmarkWrapper) && /lockf/.test(benchmarkWrapper) &&
    /WAFRA_TEST_LOCKED/.test(benchmarkWrapper));

// iOS has no Android live capture. Index.js, the root layout, the store and the
// auto-import hook used to import android-live-background directly, so the
// iPhone evaluated that whole module before its first screen just to call two
// functions that returned immediately on iOS. A platform split now keeps it out
// of the iOS startup graph and leaves Android's untouched.
{
  const { reachableFiles } = require('./repair/import-graph.cjs');
  const repo = path.join(__dirname, '../..');
  const ios = reachableFiles(repo, 'ios');
  const android = reachableFiles(repo, 'android');
  const ANDROID_CAPTURE = 'src/lib/android-live-background.ts';
  ok('the iOS startup graph does not evaluate the Android live-capture module',
    !ios.has(ANDROID_CAPTURE) && !ios.has('src/lib/native-background-tasks.ts'));
  ok('iOS still registers the wake-only relay task at startup',
    ios.has('src/lib/background-relay.ts') && ios.has('src/lib/native-background-tasks.ios.ts') &&
      ios.has('src/lib/android-live-background-api.ios.ts'));
  ok('the Android startup graph still evaluates the live-capture module through both entry paths',
    android.has(ANDROID_CAPTURE) && android.has('src/lib/native-background-tasks.ts') &&
      android.has('src/lib/android-live-background-api.ts') && android.has('src/lib/background-relay.ts'));
  const iosEntry = fs.readFileSync(path.join(repo, 'src/lib/native-background-tasks.ios.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  ok('the iOS native-background-tasks entry imports only the relay',
    iosEntry.trim() === "import '@/lib/background-relay';");
  const apiDefault = fs.readFileSync(path.join(repo, 'src/lib/android-live-background-api.ts'), 'utf8');
  const apiIos = load(path.join(repo, 'src/lib/android-live-background-api.ios.ts'), {});
  const names = (source) => [...source.matchAll(/\b(installAndroidLiveCaptureLedger|waitForAndroidBackgroundCaptureIdle)\b/g)]
    .map((m) => m[1]).filter((n, i, all) => all.indexOf(n) === i).sort();
  ok('the iOS shim exports exactly the functions the Android build re-exports',
    JSON.stringify(Object.keys(apiIos).sort()) === JSON.stringify(names(apiDefault)));
  const realSource = fs.readFileSync(path.join(repo, ANDROID_CAPTURE), 'utf8');
  ok('the real functions were already no-ops on iOS, which is all the shim does',
    /export function installAndroidLiveCaptureLedger[\s\S]*?\{\s*if \(Platform\.OS !== 'android'\) return \(\) => \{\};/.test(realSource) &&
      /export async function waitForAndroidBackgroundCaptureIdle\(\)[\s\S]*?\{\s*if \(Platform\.OS !== 'android'\) return;/.test(realSource));
  const uninstall = apiIos.installAndroidLiveCaptureLedger({});
  ok('the iOS shim installs nothing and returns a harmless cleanup',
    typeof uninstall === 'function' && uninstall() === undefined);
  const idle = apiIos.waitForAndroidBackgroundCaptureIdle();
  ok('the iOS shim never waits',
    typeof idle?.then === 'function' &&
      /export async function waitForAndroidBackgroundCaptureIdle\(\): Promise<void> \{\}/.test(
        fs.readFileSync(path.join(repo, 'src/lib/android-live-background-api.ios.ts'), 'utf8')));
  for (const [name, file] of [['store', 'src/lib/store.tsx'], ['auto-import hook', 'src/hooks/use-auto-import.ts'],
    ['root layout', 'src/components/app-root-layout.tsx']]) {
    const source = fs.readFileSync(path.join(repo, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    ok(`the ${name} reaches Android live capture only through the platform split`,
      !/from '@\/lib\/android-live-background'|import '@\/lib\/android-live-background'/.test(source));
  }
}

console.log(`\nlaunch-performance: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
