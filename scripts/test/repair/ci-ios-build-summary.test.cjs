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
  assert.match(out, /\[redacted-token\]/);
  assert.match(out, /\[email\]/);
  assert.match(out, /^error lines: 4$/m);
});

test('redacts fragments, credential-named values and passwords that are not in the job env (public artifact)', () => {
  const token = 'xA9kQ2mZ7vB4nL8pR1tY6uW3sE5dF0gH';
  const keyLine = 'MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg';
  const log = [
    `Error: partial ${token.slice(0, 25)} rejected`,
    `error: key fragment ${keyLine.slice(0, 20)} bad`,
    'Error: `fastlane run import_certificate certificate_path:/tmp/a.p12 certificate_password:Wafra2026! keychain_path:/tmp/k` exited with non-zero code: 1',
    'error: login failed password=hunter2hunter',
    'error: request token=abcdEFGH1234 refused',
    'error: secret: s3cr3tValue99',
    'error: p12 password "Kq9#x2!aP" wrong',
    'error: security import /tmp/c.p12 -P Kq9x2aP -k /tmp/k',
    'error: api_key: sk_live_abc123 denied',
    'error: No signing certificate "Apple Distribution: Jane Q Developer (UV7YN4GQ66)" found',
    'error: unrecognised gh token ghs_16C7e42F292c6912E7710c838347Ae178B4a here',
  ].join('\n');
  const out = summarize([{ name: 'f.log', text: log }], 1, [token, keyLine, 'ghs_16C7e42F292c6912E7710c838347Ae178B4a']);
  for (const leak of [token.slice(0, 25), keyLine.slice(0, 20), 'Wafra2026!', 'hunter2hunter', 'abcdEFGH1234',
    's3cr3tValue99', 'Kq9#x2!aP', 'Kq9x2aP', 'sk_live_abc123', 'Jane Q Developer', 'ghs_16C7e42F292c6912E7710c838347Ae178B4a']) {
    assert.ok(!out.includes(leak), `leaked ${leak}`);
  }
  assert.match(out, /error: request token=\[redacted\] refused/);
  assert.match(out, /error lines withheld because they name credential material: [1-9]/);
  assert.match(out, /Apple Distribution: \[identity\] \(UV7YN4GQ66\)/);
});

test('masks slash-split unknown blobs and other legal-name forms', () => {
  const log = [
    'Error: unknown p12 blob MIIKTQIBAzCC/ChcGCSqGSIb3/DQEHAaCCCggE/ggoEMIIKADCC/BL8GCSqG',
    'error: iOS Distribution: Jane Q Developer (UV7YN4GQ66) has expired',
    'error: profile not associated with team "Jane Q Developer (Individual)"',
    'error: Developer ID Application: Jane Q Developer (UV7YN4GQ66) invalid',
  ].join('\n');
  const out = summarize([{ name: 'g.log', text: log }], 1);
  for (const leak of ['MIIKTQIBAzCC', 'ChcGCSqGSIb3', 'Jane Q Developer']) assert.ok(!out.includes(leak), `leaked ${leak}`);
  assert.match(out, /\[redacted-blob\]/);
  assert.match(out, /iOS Distribution: \[identity\] \(UV7YN4GQ66\)/);
  assert.match(out, /team "\[team\]"/);
});

test('keeps file paths and long target names readable', () => {
  const log = [
    "/Users/runner/work/Wafra/Wafra/modules/wafra-widgets/ios/WafraPrivacyCover.swift:83:14: error: cannot find type 'ExpoAppDelegateSubscriber' in scope",
    "error: Build input file cannot be found: '/Users/runner/Library/Developer/Xcode/DerivedData/ExpoModulesCore-ExpoModulesCore_privacy/Info.plist'",
  ].join('\n');
  const out = summarize([{ name: 'x.log', text: log }], 65);
  assert.match(out, /modules\/wafra-widgets\/ios\/WafraPrivacyCover\.swift:83:14: error: cannot find type/);
  assert.match(out, /ExpoModulesCore-ExpoModulesCore_privacy/);
  const relative = summarize([{ name: 'r.log', text: [
    "error: Build input file cannot be found: 'ios/Pods/Target Support Files/ExpoModulesCore/ExpoModulesCore2Info.plist'",
    'error: cannot open Pods/Headers/Public/React2Core/RCTBridgeModule.h',
  ].join('\n') }], 65);
  assert.match(relative, /Files\/ExpoModulesCore\/ExpoModulesCore2Info\.plist/);
  assert.match(relative, /Pods\/Headers\/Public\/React2Core\/RCTBridgeModule\.h/);
  assert.doesNotMatch(relative, /redacted-blob/);
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
    fs.writeFileSync(path.join(dir, 'work/logs/xcodebuild.log'), 'error: bad key MIGTAgEAMBMGByqGSM49AgEGCCqG here\nerror: token tok_secret_value\nerror: gh ghs_fakeGithubToken000 used\n');
    const run = spawnSync(process.execPath, [script, path.join(dir, 'work')], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, BUILD_EXIT: '1', EXPO_TOKEN: 'tok_secret_value', GH_TOKEN: 'ghs_fakeGithubToken000', EXPO_ASC_API_KEY_PATH: keyFile },
    });
    assert.equal(run.status, 0, run.stderr);
    assert.ok(!run.stdout.includes('MIGTAgEAMBMGByqGSM49AgEGCCqG'));
    assert.ok(!run.stdout.includes('tok_secret_value'));
    assert.ok(!run.stdout.includes('ghs_fakeGithubToken000'));
    assert.match(run.stdout, /error: token \[redacted\]/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the CLI refuses to run without a real exit code', () => {
  const run = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.notEqual(run.status, 0);
});
