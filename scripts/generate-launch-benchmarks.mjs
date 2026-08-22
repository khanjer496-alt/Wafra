import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildLaunchBenchmarkBackup,
  LAUNCH_BENCHMARK_ROW_COUNTS,
} = require('./test/build/launch-benchmark.js');

const outputDir = path.resolve(process.argv[2] ?? 'artifacts/launch-benchmarks');
await mkdir(outputDir, { recursive: true });

const fixedNow = Date.UTC(2026, 0, 15, 12);
for (const rowCount of LAUNCH_BENCHMARK_ROW_COUNTS) {
  const backup = buildLaunchBenchmarkBackup(rowCount, fixedNow);
  const file = path.join(outputDir, `wafra-launch-${rowCount}-rows.json`);
  await writeFile(file, `${JSON.stringify(backup)}\n`, { mode: 0o600 });
  console.log(`${rowCount} rows -> ${file}`);
}

console.log('\nRestore one file in an internal Release build, return to Home, fully close Wafra, then cold-launch it.');
console.log('Build with EXPO_PUBLIC_WAFRA_INTERNAL_DIAGNOSTICS=1. After launch, open Settings > Data > Launch metrics (internal), export the local JSON file, and record p50/p90 for JS-instrumentation-start to first-usable-home outside the app.');
console.log('These files exclude native startup before JS evaluation. Measure icon-tap to usable Home separately with an external device harness.');
