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

test('local build accepts only the explicit supported store profiles without changing billing', () => {
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
  assert.equal(run('production', 'a'.repeat(40)), 0);
  assert.equal(run('production-candidate', 'a'.repeat(40)), 0);
  for (const profile of ['preview', 'development', 'unknown']) assert.notEqual(run(profile, 'a'.repeat(40)), 0);
  for (const bad of ['main', '../main', 'a'.repeat(39), 'a'.repeat(40) + '; echo unsafe']) {
    assert.notEqual(run('history-beta', bad), 0);
  }
  assert.ok(!/billing:subscribe|credentials:update|create.*certificate/.test(job.steps.map(s => s.run || '').join('\n')));
});

test('source and signing are pinned, and only a verified exact-source build may reach TestFlight', () => {
  const checkout = steps.find(s => s.uses === 'actions/checkout@v4');
  // 7faf341 pinned mobile release builds to main: a manual dispatch without an
  // explicit source_commit builds main itself, never whichever ref the
  // dispatcher happened to be on. The exact-source and ancestry gates below
  // still apply to whatever that resolves to.
  assert.equal(checkout.with.ref, "${{ inputs.source_commit || 'main' }}");
  assert.equal(checkout.with['fetch-depth'], 0);
  // The source pin accepts exactly two reviewed lines, joined by one `||`.
  // Any widening (a third branch, `|| true`, `set +e`, `;`) must fail here.
  const pin = steps.find(s => s.name === 'Pin and verify reviewed-line build source').run;
  const pinCode = pin.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  assert.deepEqual(pinCode.slice(0, 3), [
    'SHA=$(git rev-parse HEAD)',
    'git merge-base --is-ancestor "$SHA" origin/main \\',
    '|| git merge-base --is-ancestor "$SHA" origin/release/1.0.0-rc1-reconciled',
  ]);
  assert.equal((pin.match(/merge-base --is-ancestor/g) || []).length, 2);
  assert.equal((pin.match(/\|\|/g) || []).length, 1);
  assert.ok(!/\|\|\s*true|set \+e|\bexit 0\b/.test(pin));
  const build = steps.find(s => s.name === 'Build signed iOS archive on this macOS runner').run;
  assert.match(build, /--local --non-interactive/);
  assert.match(build, /--freeze-credentials/);
  // A failed archive leaves a redacted summary; the build's own exit code still decides.
  assert.match(build, /BUILD_STATUS=\$\{PIPESTATUS\[0\]\}/);
  assert.match(build, /exit "\$BUILD_STATUS"\s*$/);
  assert.match(build, /node scripts\/ci\/summarize-ios-build\.cjs/);
  const failureUpload = steps.find(s => s.name === 'Preserve iOS archive failure summary');
  assert.equal(failureUpload.if, 'failure()');
  assert.equal(failureUpload.with.path, 'artifacts/ios-build-failure/summary.txt');
  assert.ok(steps.indexOf(failureUpload) > steps.findIndex(s => s.name === 'Remove temporary Apple API key'));
  const verify = steps.findIndex(s => s.name === 'Verify the actual signed IPA and App Intent resources');
  const preserve = steps.findIndex(s => s.name === 'Preserve verified installer before submission');
  const gate = steps.findIndex(s => s.name === 'Require successful exact-source CI before TestFlight submission');
  const submit = steps.findIndex(s => s.name === 'Submit the verified existing IPA to TestFlight');
  assert.ok(verify < preserve && preserve < gate && gate < submit);
  assert.match(steps[verify].run, /codesign --verify --deep --strict/);
  assert.match(steps[verify].run, /python3 scripts\/check-ios-product-versions\.py "\$APP"/);
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

test('every dispatch refuses unverified submission routes before either build job starts', () => {
  const validation = workflow.jobs['validate-request'];
  assert.ok(validation, 'all routes need the shared submission guard');
  assert.equal(workflow.jobs.build.needs, 'validate-request');
  assert.equal(job.needs, 'validate-request');
  const guard = validation.steps[0].run;
  for (const host of ['eas', 'github-macos']) for (const submit of ['true', 'false']) {
    for (const id of ['', '12345678-1234-1234-1234-123456789abc']) {
      const r = spawnSync('bash', ['-eu', '-o', 'pipefail', '-c', guard], {
        encoding: 'utf8', env: { ...process.env, BUILD_HOST: host, WANT_SUBMIT: submit, SUBMIT_BUILD_ID: id },
      });
      const allowed = id === '' && (submit !== 'true' || host === 'github-macos');
      assert.equal(r.status === 0, allowed, JSON.stringify({host,submit,id,stderr:r.stderr}));
    }
  }
  assert.notEqual(spawnSync('bash', ['-eu', '-c', guard], {env: {...process.env,
    BUILD_HOST:'unknown', WANT_SUBMIT:'false', SUBMIT_BUILD_ID:''}}).status, 0);
  const hostedBuild = workflow.jobs.build.steps.find(s => s.name === 'Start the iOS build').run;
  assert.doesNotMatch(hostedBuild, /args\+=\(--auto-submit/);
  const oldIdRoute = workflow.jobs.build.steps.find(s => s.id === 'submit_only').run;
  assert.doesNotMatch(oldIdRoute, /eas submit/);
  assert.match(oldIdRoute, /exit 1/);
});

test('artifact resubmission checks the downloaded product, including old self-consistent reports', () => {
  const artifact = YAML.parse(fs.readFileSync(path.join(path.dirname(file), 'ios-submit-verified-artifact.yml'), 'utf8'));
  const list = artifact.jobs.submit.steps;
  const gate = list.findIndex(s => s.name === 'Verify downloaded product versions');
  const downloadCheck = list.findIndex(s => s.name === 'Verify downloaded artifact');
  const submit = list.findIndex(s => /eas submit/.test(s.run || ''));
  assert.ok(gate > downloadCheck && gate < submit, 'downloaded IPA needs a product gate before submission');
  assert.equal(list[gate].if, undefined, 'a failed product gate must stop submission');
  assert.equal(list[submit].if, undefined, 'submission must retain implicit success()');
  const os = require('node:os');
  const python = process.platform === 'darwin' ? '/usr/bin/python3' : 'python3';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-artifact-version-test-'));
  try {
    for (const [host, widget, short, expected, appCount = 1] of [
      ['192', '192', '1.0.0', true],
      ['191', '1', '1.0.0', false],
      ['192', '$(CURRENT_PROJECT_VERSION)', '1.0.0', false],
      ['192', '192', '1.0', false],
      ['192', '192', '1.0.0', false, 2],
      ['192', '192', '1.0.0', false, 0],
    ]) {
      const ipa = path.join(dir, 'downloaded artifact.ipa');
      const fixture = spawnSync(python, ['-c', `import plistlib,sys,zipfile
with zipfile.ZipFile(sys.argv[1], 'w') as z:
 z.writestr('Payload/readme.txt','synthetic test fixture')
 for index in range(int(sys.argv[5])):
  app='Wafra' if index == 0 else 'Other'
  for name,build,short in [(f'Payload/{app}.app/Info.plist',sys.argv[2],'1.0.0'),(f'Payload/{app}.app/PlugIns/Widget.appex/Info.plist',sys.argv[3],sys.argv[4])]:
   z.writestr(name,plistlib.dumps({'CFBundleVersion':build,'CFBundleShortVersionString':short}))
`, ipa, host, widget, short, String(appCount)], {encoding: 'utf8'});
      assert.equal(fixture.status, 0, fixture.stderr);
      const result = spawnSync('bash', ['-eu', '-o', 'pipefail', '-c', list[gate].run], {
        cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8',
        env: {...process.env, IPA_PATH: ipa, RUNNER_TEMP: dir,
          PATH: process.platform === 'darwin' ? `/usr/bin:/bin:${process.env.PATH}` : process.env.PATH},
      });
      assert.equal(result.status === 0, expected, JSON.stringify({host,widget,short,appCount,stdout:result.stdout,stderr:result.stderr}));
      assert.deepEqual(fs.readdirSync(dir), ['downloaded artifact.ipa'], 'extracted product is cleaned up');
    }
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
