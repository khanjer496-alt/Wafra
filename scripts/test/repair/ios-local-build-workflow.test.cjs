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
  const preserve = steps.findIndex(s => s.name === 'Preserve verification report before submission');
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
  assert.equal(upload.with.path, 'artifacts/ios-local/verification.json');
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

test('the public repo never receives the signed IPA, and the old resubmission route is retired', () => {
  const upload = steps.find(s => s.name === 'Preserve verification report before submission');
  assert.equal(upload.with.path, 'artifacts/ios-local/verification.json');
  assert.ok(upload.with['retention-days'] <= 3);
  const ipa = steps.find(s => s.id === 'ipa').run;
  assert.match(ipa, /target=temp\/f'Wafra-\{version\}-\{number\}\.ipa'/);
  assert.doesNotMatch(ipa, /artifacts\/ios-local'\)\/f'Wafra-/);
  assert.ok(!fs.existsSync(path.join(path.dirname(file), 'ios-submit-verified-artifact.yml')),
    'resubmitting a downloaded IPA needs the IPA artifact, which is no longer uploaded');
});

test('public-repo artifact policy: no app binaries, short retention everywhere', () => {
  const dir = path.dirname(file);
  // build-apk.yml (Android) is handled with the Android owner separately.
  let checked = 0;
  for (const name of fs.readdirSync(dir).filter(n => /\.ya?ml$/.test(n) && n !== 'build-apk.yml')) {
    const wf = YAML.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    for (const [jobName, job] of Object.entries(wf.jobs || {})) for (const step of job.steps || []) {
      if (!/actions\/upload-artifact@/.test(step.uses || '')) continue;
      checked++;
      const where = `${name}:${jobName}:${step.name || step.with?.name}`;
      const days = step.with?.['retention-days'];
      assert.ok(Number.isInteger(days) && days >= 1 && days <= 7, `${where} needs retention-days 1-7, has ${days}`);
      const paths = String(step.with?.path || '');
      assert.doesNotMatch(paths, /\.(?:ipa|aab|apk|xcarchive|p12|p8|mobileprovision)\b/i, `${where} uploads a signed binary or credential`);
    }
  }
  // Guard against a vacuous pass (a parser or layout change that finds no steps).
  assert.ok(checked >= 15, `expected at least 15 upload steps outside build-apk.yml, checked ${checked}`);
});
