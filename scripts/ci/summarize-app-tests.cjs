'use strict';

// A bounded semantic report for CI readers that refuse terminal control bytes.
// Preserve the real test exit code; this is evidence, never a replacement gate.
function summarize(log, exitCode) {
  const lines = log.replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, '').split(/\r?\n/);
  const failures = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
    if (!/not ok \d+|[✗✘]|AssertionError|ERR_ASSERTION|^Error:|^TypeError:|^ReferenceError:|^SyntaxError:|^\s*error:|^\s*failureType:|^\s*code: 'ERR_/.test(line)) continue;
    failures.push({ line: index + 1, text: line.slice(0, 800) });
    if (failures.length === 100) break;
  }
  return { exitCode, passed: exitCode === 0, logLineCount: lines.length, failures,
    truncated: failures.length === 100 };
}

module.exports = { summarize };
if (require.main === module) {
  const fs = require('node:fs');
  const exitCode = Number(process.env.TEST_EXIT);
  if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) throw new Error('TEST_EXIT is required');
  process.stdout.write(JSON.stringify(summarize(fs.readFileSync(process.argv[2], 'utf8'), exitCode), null, 2) + '\n');
}
