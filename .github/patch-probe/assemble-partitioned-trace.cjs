'use strict';
// Preserve actual exits and counts from every disjoint repair file, then union
// tuples with the other 97 complete groups. No timeout or test is waived.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const rows = file => fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const assert = (value, reason) => { if (!value) throw Error(reason); };
const binding = json('out/binding.json');
const other = rows('out/suite-results.jsonl');
assert(other.length === 97 && new Set(other.map(r => r.suite)).size === 97 && other.every(r => r.suite !== 'repair'), '97 unique non-repair groups required');
const complete = r => r.passed && r.exitCode === 0 && !r.signal && !r.error && !r.truncated &&
  r.notOk.every(line => line.includes('# TODO '));
assert(other.every(complete), 'failed or incomplete non-repair group');
const manifests = [], records = [];
fs.mkdirSync('out/repair-parts', { recursive: true });
fs.mkdirSync('out/trace-parts', { recursive: true });
fs.copyFileSync('out/trace.jsonl', 'out/trace-parts/nonrepair.jsonl');
fs.copyFileSync('out/summary.txt', 'out/nonrepair-summary.txt');
for (const index of [0, 1]) {
  const folder = path.join('repair-parts', `trace-repair-${index}-${process.env.GITHUB_SHA}`);
  const b = json(path.join(folder, 'binding.json'));
  assert(b.shippingHead === binding.shippingHead && b.traceSide === binding.traceSide &&
    b.meta.sourceHash === binding.meta.sourceHash && b.meta.bundleSha256 === binding.meta.bundleSha256, 'partition binding mismatch');
  const m = json(path.join(folder, 'repair-manifest.json'));
  assert(m.partition === index && m.partitions === 2 && m.head === process.env.GITHUB_SHA &&
    m.timeoutMs === 22 * 60 * 1000 && m.testConcurrency === 2, 'partition limits or revision mismatch');
  const actual = rows(path.join(folder, 'repair-results.jsonl'));
  assert(actual.length === 1, 'one actual repair exit per partition required');
  const r = actual[0];
  assert(complete(r) && r.notOk.length === 0 && r.failures.length === 0 && r.tapReports.length === 1, 'incomplete repair exit');
  const tap = r.tapReports[0];
  assert(tap.tests > 0 && tap.pass + tap.skipped === tap.tests && !tap.fail && !tap.cancelled && !tap.todo, 'incomplete repair TAP counts');
  records.push(r); manifests.push(m);
  fs.cpSync(folder, path.join('out/repair-parts', String(index)), { recursive: true });
  fs.copyFileSync(path.join(folder, 'trace.jsonl'), path.join('out/trace-parts', `repair-${index}.jsonl`));
}
const all = fs.readdirSync('scripts/test/repair').filter(n => n.endsWith('.test.cjs')).sort().map(n => 'repair/' + n);
assert(manifests.every(m => JSON.stringify(m.allFiles) === JSON.stringify(all)), 'repair file coverage mismatch');
for (const index of [0, 1]) {
  assert(JSON.stringify(manifests[index].selectedFiles) === JSON.stringify(all.filter((_, i) => i % 2 === index)), 'partition assignment mismatch');
  for (const name of all) assert(manifests[index].sha256[name] === hash(fs.readFileSync(path.join('scripts/test', name))), 'repair test bytes changed: ' + name);
}
const total = Object.fromEntries(['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo', 'duration_ms']
  .map(key => [key, records.reduce((sum, r) => sum + r.tapReports[0][key], 0)]));
assert(total.skipped === 1, 'repair skip count changed');
const repair = { suite: 'repair', execution: 'composite of two disjoint actual repair processes; no single-process pass claimed',
  actualParts: records, manifestPaths: ['repair-parts/0/repair-manifest.json', 'repair-parts/1/repair-manifest.json'],
  exitCode: 0, passed: true, signal: null, error: null, truncated: false, notOk: [], failures: [], tapReports: [total] };
fs.writeFileSync('out/suite-results.jsonl', [repair, ...other].map(r => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync('out/repair-coverage.json', JSON.stringify({ files: all.length, partitions: manifests,
  actualParts: records, totals: total, disjointAndExhaustive: true, unchangedCollectorTimeoutMs: 22 * 60 * 1000 }, null, 2));
const summary = cp.execFileSync(process.execPath, ['.github/patch-probe/merge-trace.cjs', 'out/trace-parts', 'out/trace.jsonl']);
fs.writeFileSync('out/summary.txt', summary);
console.log(summary.toString().trim());
