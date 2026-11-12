#!/usr/bin/env node
'use strict';
// The refund-matrix gap file may only shrink for rows the base already had (Change Reviewer, #217 Low 1).
// refund-matrix.test.cjs checks counts against CEILING, so a change that fixes row A and breaks row B in the same class
// and path keeps every count and passes there. This check compares the gap file with the base commit's file, per row:
//   - a row the base oracle had, with the same expected label, may only lose paths; a new path or a different wrong
//     outcome on a listed path fails;
//   - a row that is new to the oracle, or whose expected label changed, is listed for review (ORACLE_PIN already makes
//     that oracle change deliberate) and does not fail.
// Usage: node scripts/test/repair/refund-gaps-no-growth.cjs <base commit>
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const GAPS = 'scripts/test/repair/refund-matrix-known-gaps.json';
const ORACLE = 'scripts/test/repair/refund-matrix-oracle.cjs';
const root = path.resolve(__dirname, '../../..');
const base = process.argv[2];
if (!base) {
  console.error('usage: refund-gaps-no-growth.cjs <base commit>');
  process.exit(2);
}
const show = (file) => {
  try {
    return execFileSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  } catch {
    return null;
  }
};

const baseGapsText = show(GAPS);
const baseOracleText = show(ORACLE);
if (baseGapsText === null || baseOracleText === null) {
  console.log(`refund gaps no-growth: the base ${base} has no gap file or oracle; nothing to compare`);
  process.exit(0);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refund-base-oracle-'));
const baseOracleFile = path.join(tmp, 'refund-matrix-oracle.cjs');
fs.writeFileSync(baseOracleFile, baseOracleText);
let baseRows;
try {
  baseRows = new Map(require(baseOracleFile).buildOracleRows().map((row) => [row.id, row.expected]));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const baseGaps = JSON.parse(baseGapsText).gaps;
const headGaps = JSON.parse(fs.readFileSync(path.join(root, GAPS), 'utf8')).gaps;
const growth = [];
const forReview = [];
for (const [id, entry] of Object.entries(headGaps)) {
  if (baseRows.get(id) !== entry.expected) {
    forReview.push(`${id} ${entry.expected} (${baseRows.has(id) ? `was ${baseRows.get(id)}` : 'new oracle row'})`);
    continue;
  }
  const before = baseGaps[id] || {};
  for (const [name, got] of Object.entries(entry)) {
    if (name === 'expected') continue;
    if (!(name in before)) growth.push(`${id} NEW ${name} ${got}`);
    else if (before[name] !== got) growth.push(`${id} CHANGED ${name} ${before[name]} -> ${got}`);
  }
}
const removed = Object.keys(baseGaps).filter((id) => !(id in headGaps)).length;
console.log(`refund gaps no-growth against ${base}: ${Object.keys(headGaps).length} entries (base ${Object.keys(baseGaps).length}, ` +
  `${removed} removed), ${growth.length} growth, ${forReview.length} on new or relabelled oracle rows`);
for (const line of forReview) console.log(`  review: ${line}`);
if (growth.length) {
  console.error(`The gap file grew on rows the base already had. Fix the regression; do not list it:\n  ${growth.join('\n  ')}`);
  process.exit(1);
}
