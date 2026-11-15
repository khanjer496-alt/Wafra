'use strict';
// Join actual disjoint exits. No single repair process or timed-out run is relabelled.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = (ok, message) => { if (!ok) throw Error(message); };
const json = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const rows = f => fs.readFileSync(f, 'utf8').trim().split('\n').map(JSON.parse);
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const complete = r => r.passed === true && r.exitCode === 0 && r.signal === null && r.error === null &&
  r.truncated === false && r.notOk.every(line => line.includes('# TODO '));
const otherDir = path.join('parts', `validation-nonrepair-${process.env.GITHUB_SHA}`);
const binding = json(path.join(otherDir, 'validation-binding.json'));
assert(binding.head === process.env.GITHUB_SHA, 'non-repair revision mismatch');
const other = rows(path.join(otherDir, 'complete-results.jsonl'));
assert(other.length === 97 && new Set(other.map(r => r.suite)).size === 97 &&
  other.every(r => r.suite !== 'repair' && complete(r)), '97 actual complete non-repair groups required');
const all = fs.readdirSync('scripts/test/repair').filter(n => n.endsWith('.test.cjs')).sort().map(n => 'repair/' + n);
const records = [], manifests = [];
fs.mkdirSync('out/repair-parts', { recursive: true });
for (const index of [0, 1]) {
  const folder = path.join('parts', `repair-completion-${index}-${process.env.GITHUB_SHA}`);
  const b = json(path.join(folder, 'validation-binding.json'));
  assert(b.head === binding.head && b.meta.sourceHash === binding.meta.sourceHash &&
    b.meta.bundleSha256 === binding.meta.bundleSha256, 'generated source binding mismatch');
  const manifest = json(path.join(folder, 'repair-manifest.json'));
  assert(manifest.head === process.env.GITHUB_SHA && manifest.partition === index && manifest.partitions === 2 &&
    manifest.timeoutMs === 1320000 && manifest.testConcurrency === 2, 'repair limits or revision mismatch');
  assert(JSON.stringify(manifest.allFiles) === JSON.stringify(all) &&
    JSON.stringify(manifest.selectedFiles) === JSON.stringify(all.filter((_, i) => i % 2 === index)), 'repair coverage mismatch');
  for (const name of all) assert(manifest.sha256[name] === hash(fs.readFileSync(path.join('scripts/test', name))), 'changed repair file: ' + name);
  const actual = rows(path.join(folder, 'repair-results.jsonl'));
  assert(actual.length === 1 && complete(actual[0]) && !actual[0].notOk.length && !actual[0].failures.length &&
    actual[0].tapReports.length === 1, 'repair part incomplete or failed');
  const tap = actual[0].tapReports[0];
  assert(tap.tests > 0 && tap.pass + tap.skipped === tap.tests && !tap.fail && !tap.cancelled && !tap.todo, 'repair TAP counts incomplete');
  records.push(actual[0]); manifests.push(manifest);
  fs.cpSync(folder, `out/repair-parts/${index}`, { recursive: true });
}
const totals = Object.fromEntries(['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo', 'duration_ms']
  .map(k => [k, records.reduce((n, r) => n + r.tapReports[0][k], 0)]));
assert(totals.skipped === 1, 'existing skip count changed');
const repair = { suite: 'repair', execution: 'composite of two disjoint actual processes', actualParts: records,
  passed: true, exitCode: 0, signal: null, error: null, truncated: false, notOk: [], failures: [], tapReports: [totals] };
const suites = [repair, ...other];
assert(suites.length === 98 && suites.every(complete), '98 complete groups required');
fs.writeFileSync('out/complete-results.jsonl', suites.map(r => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync('out/repair-coverage.json', JSON.stringify({ files: all.length, manifests, actualParts: records, totals,
  disjointAndExhaustive: true, timeoutMsEach: 1320000, workersEach: 2 }, null, 2));
fs.writeFileSync('out/validation-binding.json', JSON.stringify(binding, null, 2));
console.log(JSON.stringify({ groups: suites.length, repairFiles: all.length, repairTotals: totals, sourceHash: binding.meta.sourceHash }));
