'use strict';
// Workflow-owned structured diagnostics, never a read of GitHub job logs.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = process.env.WAFRA_TRACE_ROOT;
const { summarize } = require(path.join(root, 'scripts/ci/summarize-app-tests.cjs'));
const [destination, label, ...args] = process.argv.slice(2);
const started = Date.now();
const result = spawnSync(process.execPath, args, { env: process.env, encoding: 'utf8', timeout: 22 * 60 * 1000, maxBuffer: 48 * 1024 * 1024 });
const output = (result.stdout ?? '') + '\n' + (result.stderr ?? '');
const notOk = output.split(/\r?\n/).filter(line => /^not ok \d+/.test(line));
const failureDetails = [...output.matchAll(/^not ok \d+[^\n]*\n(?:[ \t]+[^\n]*\n)*/gmu)].map(match => match[0].slice(0, 6000));
const tapReports = [];
let currentTap = null;
for (const line of output.split(/\r?\n/u)) {
  const match = /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) ([0-9.]+)$/u.exec(line);
  if (!match) continue;
  if (match[1] === 'tests') { currentTap = {}; tapReports.push(currentTap); }
  if (currentTap) currentTap[match[1]] = Number(match[2]);
}
const resultSummaryLines = output.split(/\r?\n/u).filter(line => /\b\d+ passed, \d+ failed\b|^Universal suites: \d+\/\d+ passed/u.test(line));
const report = { suite: label, milliseconds: Date.now() - started, signal: result.signal,
  error: result.error?.message ?? null, notOk, failureDetails, tapReports, resultSummaryLines, diagnosticTail: result.status === 0 ? null : output.slice(-2400), ...summarize(output, result.status ?? 255) };
fs.appendFileSync(destination, JSON.stringify(report) + '\n');
console.log(label + ' ' + report.exitCode);
// Continue collection. Every suite's real status remains in the artifact.
