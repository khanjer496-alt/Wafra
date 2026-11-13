const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { summarize, collect } = require('../../ci/summarize-ios-build.cjs');

const script = path.resolve(__dirname, '../../ci/summarize-ios-build.cjs');

test('keeps error lines with their EAS phase and strips control bytes', () => {
  const log = [
    '[PREBUILD] Running prebuild',
    '[INSTALL_PODS] Installing pods',
    '\u001b[31m[!] CocoaPods could not find compatible versions for pod "ExpoModulesCore"\u001b[0m',
    'Pod installation complete',
    '[RUN_FASTLANE] Building',
    '/tmp/x/WafraPrivacyCover.swift:83:14: error: cannot find type \'ExpoAppDelegateSubscriber\' in scope\u0007',
    '** ARCHIVE FAILED **',
  ].join('\n');
  const out = summarize([{ name: 'wafra-ios-build.log', text: log }], 1);
  assert.match(out, /^exit code: 1$/m);
  assert.match(out, /^phase of first error: INSTALL_PODS$/m);
  assert.match(out, /^INSTALL_PODS \| wafra-ios-build\.log:3 \| \[!\] CocoaPods could not find/m);
  assert.match(out, /^RUN_FASTLANE \| wafra-ios-build\.log:6 \| .*error: cannot find type/m);
  assert.match(out, /ARCHIVE FAILED/);
  assert.doesNotMatch(out, /Pod installation complete|Running prebuild/);
  assert.doesNotMatch(out, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
});

test('redacts the job secret values, long tokens and emails, and drops credential lines', () => {
  const token = 'expo_tok_ABC123def456';
  const log = [
    `Error: request failed for token ${token}`,
    'error: key id ABCDE12345 issuer 69a6de70-1234-47e3-e053-5b8c7c11a4d1 rejected',
    'error: signature eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9eyJpc3MiOiJ4In0 invalid',
    'error: account someone@example.com has no team',
    'error: -----BEGIN PRIVATE KEY----- MIGTAgEAMBMG',
    'Error: EXPO_TOKEN=whatever failed',
    'error: Authorization: Bearer abc',
  ].join('\n');
  const out = summarize([{ name: 'b.log', text: log }], 1,
    [token, 'ABCDE12345', '69a6de70-1234-47e3-e053-5b8c7c11a4d1', 'MIGTAgEAMBMG', '', undefined]);
  for (const secret of [token, 'ABCDE12345', '69a6de70-1234-47e3-e053-5b8c7c11a4d1', 'MIGTAgEAMBMG',
    'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9', 'someone@example.com', 'whatever', 'Bearer abc']) {
    assert.ok(!out.includes(secret), `leaked ${secret}`);
  }
  assert.match(out, /request failed for token \[redacted\]/);
  assert.match(out, /\[redacted-long-token\]/);
  assert.match(out, /\[email\]/);
  assert.match(out, /^error lines: 4$/m);
});

test('caps entries and line length, and dedupes repeats', () => {
  const lines = Array.from({ length: 200 }, (_, i) => `error: failure number ${i} ${'x'.repeat(600)}`);
  lines.push(lines[0]);
  const out = summarize([{ name: 'big.log', text: lines.join('\n') }], 65);
  const entries = out.split('\n').filter(l => / \| big\.log:\d+ \| /.test(l));
  assert.equal(entries.length, 120);
  assert.match(out, /error lines: 120 \(capped at 120\)/);
  assert.ok(entries.every(l => l.split(' | ')[2].length <= 400));
});

test('a failure with no recognised error line still reports the exit and sources', () => {
  const out = summarize([{ name: 'a.log', text: 'something went wrong quietly' }], 1);
  assert.match(out, /phase of first error: none found/);
  assert.match(out, /sources: a\.log \(1 lines\)/);
  assert.match(out, /error lines: 0/);
});

test('collects the given log plus nested .log files, skipping Pods and node_modules', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-ios-summary-'));
  try {
    fs.writeFileSync(path.join(dir, 'top.txt'), 'error: top\n');
    fs.mkdirSync(path.join(dir, 'work/logs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'work/logs/xcodebuild.log'), 'error: nested\n');
    fs.writeFileSync(path.join(dir, 'work/logs/notes.txt'), 'error: ignored, not a .log\n');
    fs.mkdirSync(path.join(dir, 'work/Pods'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'work/Pods/pod.log'), 'error: inside Pods\n');
    const names = collect([path.join(dir, 'top.txt'), path.join(dir, 'work'), path.join(dir, 'missing')], fs, path)
      .map(s => s.name);
    assert.deepEqual(names, ['top.txt', 'xcodebuild.log']);

    const keyFile = path.join(dir, 'key.p8');
    fs.writeFileSync(keyFile, '-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49AgEGCCqG\n-----END PRIVATE KEY-----\n');
    fs.writeFileSync(path.join(dir, 'work/logs/xcodebuild.log'), 'error: bad key MIGTAgEAMBMGByqGSM49AgEGCCqG here\nerror: token tok_secret_value\n');
    const run = spawnSync(process.execPath, [script, path.join(dir, 'work')], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, BUILD_EXIT: '1', EXPO_TOKEN: 'tok_secret_value', EXPO_ASC_API_KEY_PATH: keyFile },
    });
    assert.equal(run.status, 0, run.stderr);
    assert.ok(!run.stdout.includes('MIGTAgEAMBMGByqGSM49AgEGCCqG'));
    assert.ok(!run.stdout.includes('tok_secret_value'));
    assert.match(run.stdout, /error: token \[redacted\]/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the CLI refuses to run without a real exit code', () => {
  const run = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.notEqual(run.status, 0);
});
