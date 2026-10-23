'use strict';
// Child process for the long-input timing check: a catastrophic regex cannot
// be interrupted in-process, so the parent runs the adversarial bodies here
// and kills this process when one case exceeds its time budget.
// argv: <repo> <startCaseIndex> <paths comma-separated>
const path = require('path');
const { createDriver } = require(path.join(__dirname, '..', 'lab-eval.cjs'));
const { adversarialRows } = require('./adversarial.cjs');

const [repo, start, pathList] = process.argv.slice(2);
const driver = createDriver(repo);
const paths = pathList.split(',');
const cases = adversarialRows().flatMap((row) => paths.map((p) => ({ row, p })));
process.stdout.write(`${JSON.stringify({ ready: true })}\n`);
for (let i = Number(start); i < cases.length; i += 1) {
  const { row, p } = cases[i];
  process.stdout.write(`${JSON.stringify({ start: i })}\n`);
  const t0 = process.hrtime.bigint();
  let error = null;
  try { driver.run(row, p); } catch (e) { error = String(e && e.message || e).slice(0, 100); }
  process.stdout.write(`${JSON.stringify({ i, id: row.id, path: p, bytes: Buffer.byteLength(row.body), ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10, error })}\n`);
}
