const fs = require('node:fs');
const path = require('node:path');

const {
  createLaunchTimeline,
  LAUNCH_PHASES,
  serializeLaunchMetrics,
} = require('./build/launch-performance.js');
const {
  buildLaunchBenchmarkBackup,
  LAUNCH_BENCHMARK_ROW_COUNTS,
} = require('./build/launch-benchmark.js');

const rootSource = fs.readFileSync(path.join(__dirname, '../../src/components/app-root-layout.tsx'), 'utf8');
const homeSource = fs.readFileSync(path.join(__dirname, '../../src/screens/ledger-home-screen.tsx'), 'utf8');
const lockSource = fs.readFileSync(path.join(__dirname, '../../src/components/lock-gate.tsx'), 'utf8');
const settingsSource = fs.readFileSync(path.join(__dirname, '../../src/app/settings.tsx'), 'utf8');
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
    /PrivacyGateContext\.Provider value=\{false\}/.test(lockSource));
ok('internal Release metrics have a guarded local file export surface',
  /isInternalLaunchDiagnosticsEnabled\(\)/.test(settingsSource) &&
    /shareTextFile\('wafra-launch-metrics\.json'/.test(settingsSource));
ok('the benchmark builder takes the shared test-build lock on Linux and macOS',
  /flock/.test(benchmarkWrapper) && /lockf/.test(benchmarkWrapper) &&
    /WAFRA_TEST_LOCKED/.test(benchmarkWrapper));

console.log(`\nlaunch-performance: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
