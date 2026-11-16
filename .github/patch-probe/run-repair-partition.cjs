'use strict';
// Re-run only the timed-out repair group. Every original file is assigned once;
// the existing collector's 22-minute timeout and both test workers are unchanged.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const root = process.env.WAFRA_TRACE_ROOT;
const index = Number(process.argv[2]);
if (!root || ![0, 1].includes(index)) throw Error('root and partition 0 or 1 required');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const files = fs.readdirSync(path.join(root, 'scripts/test/repair'))
  .filter(name => name.endsWith('.test.cjs')).sort().map(name => 'repair/' + name);
const selected = files.filter((_, i) => i % 2 === index);
const bytes = Object.fromEntries(files.map(name => [name, hash(fs.readFileSync(path.join(root, 'scripts/test', name)))]));
const manifest = { partition: index, partitions: 2, head: process.env.GITHUB_SHA,
  featureParent: '45496a7c9653c4238b45e3a582e8cf642aebb312', validationSide: process.env.GITHUB_SHA,
  selection: 'sorted repair/*.test.cjs, index modulo 2', timeoutMs: 22 * 60 * 1000,
  testConcurrency: 2, allFiles: files, selectedFiles: selected, sha256: bytes };
fs.writeFileSync(path.join(root, 'out/repair-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
if (!selected.length) throw Error('empty repair partition');
cp.execFileSync(process.execPath, [path.join(root, '.github/patch-probe/run-traced-suite.cjs'),
  path.join(root, 'out/repair-results.jsonl'), 'repair-partition-' + index,
  '--test', '--test-concurrency=2', ...selected], { cwd: path.join(root, 'scripts/test'), stdio: 'inherit' });
const records = fs.readFileSync(path.join(root, 'out/repair-results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
if (records.length !== 1) throw Error('one actual repair record required');
const r = records[0];
if (!r.passed || r.exitCode !== 0 || r.signal || r.error || r.truncated ||
    r.notOk.length || r.failures.length || r.tapReports.length !== 1) throw Error('failed or incomplete repair partition');
const tap = r.tapReports[0];
if (!(tap.tests > 0) || tap.fail || tap.cancelled || tap.todo ||
    tap.pass + tap.skipped !== tap.tests) throw Error('missing or incomplete repair TAP counts');
