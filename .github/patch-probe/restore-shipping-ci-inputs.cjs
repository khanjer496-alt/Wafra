'use strict';
// Match the proposed feature's automation surface for the unchanged contract tests.
// The one-time transport workflow remains immutable in the side commit/artifact.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const target = '17a788edda298cede6673b4911da5d029f47cd8f';
cp.execFileSync('git', ['cat-file', '-e', target + '^{commit}']);
const dir = '.github/workflows';
const names = cp.execFileSync('git', ['ls-tree', '-r', '--name-only', target, '--', dir], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const allowed = new Set(names);
const transport = path.join(dir, 'patch-port190-check.yml');
if (fs.existsSync(transport)) fs.copyFileSync(transport, 'transport-workflow.yml');
for (const name of fs.readdirSync(dir)) {
  const file = path.posix.join(dir, name);
  if (!allowed.has(file)) {
    if (file !== transport) throw new Error('Unexpected nonshipping automation file: ' + file);
    fs.unlinkSync(file);
  }
}
for (const file of names) fs.writeFileSync(file, cp.execFileSync('git', ['show', target + ':' + file]));
cp.execFileSync('git', ['diff', '--exit-code', target, '--', dir]);
fs.writeFileSync('shipping-ci-inputs.json', JSON.stringify({ target, workflowFiles: names, transportRemoved: !allowed.has(transport), skippedAssertions: false }, null, 2));
