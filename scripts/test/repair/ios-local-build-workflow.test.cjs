'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const file = path.resolve(__dirname, '../../../.github/workflows/ios-testflight.yml');
const source = fs.readFileSync(file, 'utf8');
const workflow = YAML.parse(source);
const job = workflow.jobs['local-build'];
const steps = job.steps;

test('local build is an explicit beta-only alternative, not a hosted quota or billing change', () => {
  assert.equal(workflow.on.workflow_dispatch.inputs.build_host.default, 'eas');
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.build_host.options, ['eas', 'github-macos']);
  assert.match(job.if, /build_host == 'github-macos'/);
  assert.match(workflow.jobs.build.if, /build_host != 'github-macos'/);
  assert.equal(job['runs-on'], 'macos-26');
  const guard = steps.find(s => s.name === 'Validate the local build request').run;
  const run = (profile, commit) => spawnSync('bash', ['-eu', '-o', 'pipefail', '-c', guard], {
    encoding: 'utf8', env: { ...process.env, PROFILE: profile, SOURCE_COMMIT: commit, EXPO_TOKEN: 'synthetic-not-a-token' },
  }).status;
  assert.equal(run('history-beta', 'a'.repeat(40)), 0);
  assert.equal(run('history-beta', ''), 0);
  assert.notEqual(run('production', 'a'.repeat(40)), 0);
  for (const bad of ['main', '../main', 'a'.repeat(39), 'a'.repeat(40) + '; echo unsafe']) {
    assert.notEqual(run('history-beta', bad), 0);
  }
  assert.ok(!/billing:subscribe|credentials:update|create.*certificate/.test(job.steps.map(s => s.run || '').join('\n')));
});

test('source and signing are pinned, and only a verified exact-source build may reach TestFlight', () => {
  const checkout = steps.find(s => s.uses === 'actions/checkout@v4');
  assert.equal(checkout.with.ref, '${{ inputs.source_commit || github.sha }}');
  assert.equal(checkout.with['fetch-depth'], 0);
  assert.ok(steps.some(s => /merge-base --is-ancestor.*origin\/main/.test(s.run || '')));
  const build = steps.find(s => s.name === 'Build signed iOS archive on this macOS runner').run;
  assert.match(build, /--local --non-interactive/);
  assert.match(build, /--freeze-credentials/);
  const verify = steps.findIndex(s => s.name === 'Verify the actual signed IPA and App Intent resources');
  const preserve = steps.findIndex(s => s.name === 'Preserve verified installer before submission');
  const gate = steps.findIndex(s => s.name === 'Require successful exact-source CI before TestFlight submission');
  const submit = steps.findIndex(s => s.name === 'Submit the verified existing IPA to TestFlight');
  assert.ok(verify < preserve && preserve < gate && gate < submit);
  assert.match(steps[verify].run, /codesign --verify --deep --strict/);
  assert.match(steps[verify].run, /--verify-app-intents-metadata/);
  assert.match(steps[verify].run, /--verify-history-resources/);
  assert.match(steps[verify].run, /ProbeWafraAutomationInputIntent.*not in/);
  assert.match(steps[gate].run, /--commit "\$SOURCE_COMMIT"/);
  assert.equal(steps[submit].if, 'inputs.submit');
  assert.match(steps[submit].run, /--path "\$IPA_PATH" --non-interactive/);
});

test('Apple secrets stay in temporary owner-only files and out of uploaded artifacts', () => {
  const prepare = steps.find(s => s.name === 'Prepare existing Apple credentials without printing them').run;
  assert.match(prepare, /RUNNER_TEMP/);
  assert.match(prepare, /0o600/);
  assert.ok(!/print\(|console\.log|echo .*ASC_KEY/.test(prepare));
  const upload = steps.find(s => s.uses === 'actions/upload-artifact@v4');
  assert.equal(upload.with.path, 'artifacts/ios-local/');
  const cleanup = steps.find(s => s.name === 'Remove temporary Apple API key');
  assert.equal(cleanup.if, 'always()');
  assert.match(cleanup.run, /RUNNER_TEMP.*wafra-local-asc\.p8/);
});

test('all local workflow shell and embedded Python blocks parse before CI dispatch', () => {
  for (const step of steps.filter(s => s.run)) {
    const shell = spawnSync('bash', ['-n'], { input: step.run, encoding: 'utf8' });
    assert.equal(shell.status, 0, `${step.name}: ${shell.stderr}`);
    for (const match of step.run.matchAll(/python3 <<'PY'\n([\s\S]*?)\nPY(?:\n|$)/g)) {
      const python = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], { input: match[1], encoding: 'utf8' });
      assert.equal(python.status, 0, `${step.name}: ${python.stderr}`);
    }
  }
});
