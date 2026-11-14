'use strict';
// build-apk.yml must never upload a plaintext APK or AAB (the repository is
// public), and a Play build must fail if the Founder Pro unlock, automatic
// tester Pro or the full-inbox SMS exporter is compiled in.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const yaml = require('yaml');

const root = path.resolve(__dirname, '../../..');
const workflowSource = fs.readFileSync(path.join(root, '.github/workflows/build-apk.yml'), 'utf8');
const steps = yaml.parse(workflowSource).jobs.build.steps;
const stepIndex = (name) => steps.findIndex((step) => step.name === name);
const flags = require(path.join(root, 'scripts/android-build-flags.cjs'));
const sealer = require(path.join(root, 'scripts/android-artifact-seal.cjs'));
const PLAY_BUILD = "github.event.inputs.bundle == 'true' && github.event.inputs.corpus != 'true'";

const marker = (flag, state) => `wafra-build-flag:${flag}=${state}`;
const bundleWith = (states) => Buffer.from(`\0hbc\0${Object.entries(states).map(([f, s]) => marker(f, s)).join('\0')}\0`, 'latin1');
const allOff = Object.fromEntries(flags.FLAGS.map((flag) => [flag, 'off']));

test('the only artifact upload is the sealed directory, kept for one day', () => {
  const uploads = steps.filter((step) => /actions\/upload-artifact@/.test(step.uses || ''));
  assert.equal(uploads.length, 1);
  const [upload] = uploads;
  assert.equal(upload.with['retention-days'], 1);
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.deepEqual(String(upload.with.path).trim().split('\n').map((line) => line.trim()),
    ['sealed/*.enc', 'sealed/verification.json']);
  assert.doesNotMatch(workflowSource, /path:\s*wafra\.(apk|aab)\b/);
  const seal = stepIndex('Seal outputs for the public artifact store');
  assert.ok(seal > stepIndex('Rename outputs') && seal < steps.indexOf(upload));
  assert.match(steps[seal].run, /--recipient \.github\/android-artifact-recipient\.pem --out sealed/);
  assert.match(steps[seal].run, /rm -f wafra\.apk wafra\.aab/);
  // sms-corpus.test.js still finds the corpus label in the sealed file name.
  assert.equal(steps[seal].env.APK_LABEL, "${{ github.event.inputs.corpus == 'true' && 'wafra-sms-corpus-apk' || 'wafra-apk' }}");
});

test('a Play build verifies the compiled flags in the AAB and APK before sealing', () => {
  const verify = stepIndex('Verify production build flags in the packaged Play bundle and APK');
  assert.ok(verify > stepIndex('Rename outputs') && verify < stepIndex('Seal outputs for the public artifact store'));
  const step = steps[verify];
  assert.equal(step.if, PLAY_BUILD);
  assert.equal(steps[stepIndex('Build Play Store bundle (AAB)')].if, PLAY_BUILD, 'same condition as the AAB build');
  assert.match(step.run, /verify-production wafra\.aab/);
  assert.match(step.run, /verify-production wafra\.apk/);
  const native = spawnSync('bash', ['-c', step.run], { encoding: 'utf8', env: { ...process.env, WAFRA_SMS_CORPUS_EXPORT: '1' } });
  assert.equal(native.status, 1);
  assert.match(native.stdout + native.stderr, /native exporter must be compiled closed/);
});

test('the Play bundle builds ARM only and fails over 100,000,000 bytes or with x86 libraries', (t) => {
  const build = steps[stepIndex('Build Play Store bundle (AAB)')];
  assert.match(build.run, /bundleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a /);
  const index = stepIndex('Verify the Play bundle is ARM only and under the upload limit');
  assert.ok(index > stepIndex('Build Play Store bundle (AAB)') && index < stepIndex('Rename outputs'));
  const check = steps[index];
  // The boolean-input form of PLAY_BUILD, as the update-channel steps use.
  assert.equal(check.if, 'inputs.bundle && !inputs.corpus');
  assert.equal(check.if, steps[stepIndex('Verify update channel in the packaged Play bundle')].if);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-aab-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const aab = (name, entries) => {
    const tree = path.join(dir, name);
    for (const entry of entries) {
      fs.mkdirSync(path.dirname(path.join(tree, entry)), { recursive: true });
      fs.writeFileSync(path.join(tree, entry), 'x');
    }
    const file = path.join(dir, `${name}.aab`);
    assert.equal(spawnSync('zip', ['-qr', file, '.'], { cwd: tree }).status, 0);
    return file;
  };
  const run = (file) => spawnSync('bash', ['-c', check.run], { encoding: 'utf8', env: { ...process.env, WAFRA_AAB: file } });
  const arm = ['base/lib/arm64-v8a/libhermes.so', 'base/lib/armeabi-v7a/libhermes.so', 'base/manifest/AndroidManifest.xml'];
  assert.equal(run(aab('arm', arm)).status, 0);
  const x86 = run(aab('x86', [...arm, 'base/lib/x86_64/libhermes.so']));
  assert.equal(x86.status, 1);
  assert.match(x86.stdout + x86.stderr, /native code or symbols for x86_64/);
  const symbols = run(aab('x86-symbols', [...arm, 'BUNDLE-METADATA/com.android.tools.build.debugsymbols/x86/libhermes.so.sym']));
  assert.equal(symbols.status, 1);
  assert.match(symbols.stdout + symbols.stderr, /native code or symbols for x86/);
  const riscv = run(aab('riscv', [...arm, 'feature/lib/riscv64/libextra.so']));
  assert.equal(riscv.status, 1);
  assert.match(riscv.stdout + riscv.stderr, /native code or symbols for riscv64/);
  const armSymbols = run(aab('arm-symbols', [...arm,
    'BUNDLE-METADATA/com.android.tools.build.debugsymbols/arm64-v8a/libhermes.so.sym',
    'BUNDLE-METADATA/com.android.tools.build.debugsymbols/armeabi-v7a/libhermes.so.dbg']));
  assert.equal(armSymbols.status, 0, armSymbols.stdout + armSymbols.stderr);
  // A lib/ folder inside assets or Java resources is not an ABI directory.
  const assetsLib = run(aab('assets-lib', [...arm, 'base/assets/lib/fonts/inter.ttf', 'base/root/META-INF/lib/x/y.properties']));
  assert.equal(assetsLib.status, 0, assetsLib.stdout + assetsLib.stderr);
  // root/lib/ lands at the APK root, so it is checked like base/lib/.
  const rootX86 = run(aab('root-x86', [...arm, 'base/root/lib/x86/libextra.so']));
  assert.equal(rootX86.status, 1);
  assert.match(rootX86.stdout + rootX86.stderr, /native code or symbols for x86/);
  const noV7 = run(aab('no-v7', [arm[0], arm[2]]));
  assert.equal(noV7.status, 1);
  assert.match(noV7.stdout + noV7.stderr, /no base\/lib\/armeabi-v7a libraries/);
  const big = path.join(dir, 'big.aab');
  fs.closeSync(fs.openSync(big, 'w'));
  fs.truncateSync(big, 100_000_001);
  const oversize = run(big);
  assert.equal(oversize.status, 1);
  assert.match(oversize.stdout + oversize.stderr, /over 100,000,000/);
});

test('verify-production fails closed on any flag that is on, missing or in both states', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-flags-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = (buffer) => {
    const file = path.join(dir, 'index.android.bundle');
    fs.writeFileSync(file, buffer);
    return spawnSync(process.execPath, [path.join(root, 'scripts/android-build-flags.cjs'), 'verify-production', file], { encoding: 'utf8' });
  };
  assert.equal(run(bundleWith(allOff)).status, 0);
  for (const flag of flags.FLAGS) {
    assert.equal(run(bundleWith({ ...allOff, [flag]: 'on' })).status, 1, `${flag}=on`);
    const { [flag]: _, ...rest } = allOff;
    assert.equal(run(bundleWith(rest)).status, 1, `${flag} missing`);
    const both = Buffer.concat([bundleWith(allOff), Buffer.from(marker(flag, 'on'), 'latin1')]);
    assert.equal(run(both).status, 1, `${flag} in both states`);
  }
  assert.deepEqual(flags.report(bundleWith({ ...allOff, 'founder-unlock': 'on' })),
    { ...allOff, 'founder-unlock': 'on' });
});

test('the source markers fold to exactly one string under Metro release constant folding, and drive the gates', () => {
  const babel = require('@babel/core');
  const { constantFoldingPlugin } = require('metro-transform-plugins');
  const cases = [
    ['src/lib/founder-pro.ts', 'FOUNDER_UNLOCK_BUILD_FLAG', 'EXPO_PUBLIC_WAFRA_FOUNDER_UNLOCK', 'founder-unlock'],
    ['src/lib/founder-pro.ts', 'AUTO_FOUNDER_PRO_BUILD_FLAG', 'EXPO_PUBLIC_WAFRA_AUTO_FOUNDER_PRO', 'auto-founder-pro'],
    ['src/lib/sms-corpus-export.ts', 'SMS_CORPUS_EXPORT_BUILD_FLAG', 'EXPO_PUBLIC_WAFRA_SMS_CORPUS_EXPORT', 'sms-corpus-export'],
    ['src/lib/parser-research-flag.ts', 'PARSER_RESEARCH_BUILD_FLAG', 'EXPO_PUBLIC_WAFRA_PARSER_RESEARCH', 'parser-research'],
  ];
  for (const [file, name, env, flag] of cases) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const declaration = source.match(new RegExp(`export const ${name} =[\\s\\S]*?;`))?.[0];
    assert.ok(declaration, `${file} exports ${name}`);
    for (const [value, expected] of [['"1"', 'on'], ['"0"', 'off'], ['undefined', 'off']]) {
      // Expo replaces process.env.EXPO_PUBLIC_* with its literal before Metro folds constants.
      const inlined = declaration.replace(`process.env.${env}`, value);
      assert.notEqual(inlined, declaration, `${name} reads process.env.${env}`);
      const code = babel.transformSync(inlined, { babelrc: false, configFile: false, plugins: [constantFoldingPlugin] }).code;
      const markers = code.match(/wafra-build-flag:[a-z-]+=(on|off)/g) || [];
      assert.deepEqual(markers, [marker(flag, expected)], `${name} with ${value}`);
    }
  }
  const founder = fs.readFileSync(path.join(root, 'src/lib/founder-pro.ts'), 'utf8');
  assert.match(founder, /const FOUNDER_UNLOCK_ENABLED = FOUNDER_UNLOCK_BUILD_FLAG\.endsWith\('=on'\);/);
  assert.match(founder, /const AUTOMATIC_FOUNDER_PRO_ENABLED = AUTO_FOUNDER_PRO_BUILD_FLAG\.endsWith\('=on'\);/);
  assert.match(fs.readFileSync(path.join(root, 'src/lib/sms-corpus-export.ts'), 'utf8'),
    /const JS_CORPUS_EXPORT_ENABLED = SMS_CORPUS_EXPORT_BUILD_FLAG\.endsWith\('=on'\);/);
  assert.match(fs.readFileSync(path.join(root, 'src/lib/parser-research-source.ts'), 'utf8'),
    /const RESEARCH_BUILD_ENABLED = PARSER_RESEARCH_BUILD_FLAG\.endsWith\('=on'\);/);
  assert.match(fs.readFileSync(path.join(root, 'src/lib/feedback-transport.ts'), 'utf8'),
    /if \(!PARSER_RESEARCH_BUILD_FLAG\.endsWith\('=on'\)\)/);
  // Every reader of these build switches goes through the marker-derived gates.
  // A plain file scan (no git, no platform regex dialect), which must first
  // find the four allowed readers so it cannot pass vacuously.
  const reader = /process\.env\.EXPO_PUBLIC_WAFRA_(FOUNDER_UNLOCK|AUTO_FOUNDER_PRO|SMS_CORPUS_EXPORT|PARSER_RESEARCH)(?![A-Za-z0-9_])/;
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'build', '.gradle'].includes(entry.name)) walk(full);
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
        fs.readFileSync(full, 'utf8').split('\n').forEach((line, index) => {
          if (reader.test(line)) hits.push(`${path.relative(root, full)}:${index + 1}`);
        });
      }
    }
  };
  walk(path.join(root, 'src'));
  walk(path.join(root, 'modules'));
  const allowed = /^src\/lib\/(founder-pro|sms-corpus-export|parser-research-flag)\.ts:/;
  assert.equal(hits.filter((hit) => allowed.test(hit)).length, 4, `the four marker declarations: ${hits.join(', ')}`);
  assert.deepEqual(hits.filter((hit) => !allowed.test(hit)), [], 'read the flag through its marker module, not process.env');
  assert.match(fs.readFileSync(path.join(root, 'src/screens/journal-home-screen.tsx'), 'utf8'),
    /const founderUnlockEnabled = isFounderUnlockBuild\(\);/);
});

test('the native full-inbox gate leaves a compiled marker in the dex, from the same Gradle condition', () => {
  const gradle = fs.readFileSync(path.join(root, 'modules/sms-reader/android/build.gradle'), 'utf8');
  assert.match(gradle, /def smsCorpusExportEnabled = System\.getenv\('WAFRA_SMS_CORPUS_EXPORT'\) == '1'/);
  assert.match(gradle, /buildConfigField 'boolean', 'WAFRA_SMS_CORPUS_EXPORT', smsCorpusExportEnabled\.toString\(\)/);
  assert.match(gradle, /buildConfigField 'String', 'WAFRA_BUILD_FLAG_SMS_CORPUS_NATIVE',\s*smsCorpusExportEnabled \? '"wafra-build-flag:sms-corpus-native=on"' : '"wafra-build-flag:sms-corpus-native=off"'/);
  const kotlin = fs.readFileSync(path.join(root, 'modules/sms-reader/android/src/main/java/expo/modules/smsreader/SmsReaderModule.kt'), 'utf8');
  assert.match(kotlin, /Function\("buildFlags"\) \{\s*mapOf\("smsCorpusNative" to BuildConfig\.WAFRA_BUILD_FLAG_SMS_CORPUS_NATIVE\)\s*\}/);
  assert.doesNotMatch(kotlin, /WAFRA_BUILD_FLAG_SMS_CORPUS_NATIVE\.(endsWith|contains|equals|startsWith)/, 'no gate derived from the native marker');
});

test('readBundle scans the JS bundle and every dex of an APK and an AAB', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-zip-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { 'sms-corpus-native': _, ...js } = allOff;
  for (const [name, bundle, dex] of [['app.apk', 'assets/index.android.bundle', 'classes2.dex'],
    ['app.aab', 'base/assets/index.android.bundle', 'base/dex/classes3.dex']]) {
    const tree = path.join(dir, name + '.d');
    fs.mkdirSync(path.join(tree, path.dirname(bundle)), { recursive: true });
    fs.mkdirSync(path.join(tree, path.dirname(dex)), { recursive: true });
    fs.writeFileSync(path.join(tree, bundle), bundleWith(js));
    fs.writeFileSync(path.join(tree, dex), bundleWith({ 'sms-corpus-native': 'off' }));
    const zip = spawnSync('zip', ['-qr', path.join(dir, name), '.'], { cwd: tree });
    assert.equal(zip.status, 0);
    assert.deepEqual(flags.report(flags.readBundle(path.join(dir, name))), allOff, name);
    fs.writeFileSync(path.join(tree, dex), bundleWith({ 'sms-corpus-native': 'on' }));
    fs.rmSync(path.join(dir, name));
    spawnSync('zip', ['-qr', path.join(dir, name), '.'], { cwd: tree });
    assert.equal(flags.report(flags.readBundle(path.join(dir, name)))['sms-corpus-native'], 'on', `${name} native on`);
  }
});

test('the committed recipient is a public certificate only', () => {
  const pem = fs.readFileSync(path.join(root, '.github/android-artifact-recipient.pem'), 'utf8');
  assert.doesNotMatch(pem, /PRIVATE KEY/);
  assert.match(pem, /^-----BEGIN CERTIFICATE-----\n[\s\S]+\n-----END CERTIFICATE-----\n$/);
  const out = spawnSync('openssl', ['x509', '-noout', '-checkend', String(365 * 24 * 3600)], { input: pem, encoding: 'utf8' });
  assert.equal(out.status, 0, 'valid for at least another year');
});

test('seal and open round-trip, and open refuses a tampered file or hash', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-seal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  const made = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '2', '-subj', '/CN=wafra-test'], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  const plain = path.join(dir, 'wafra.apk.bundle');
  fs.writeFileSync(plain, Buffer.concat([bundleWith(allOff), Buffer.alloc(300_000, 7)]));
  const sealedDir = path.join(dir, 'sealed');
  const verification = sealer.seal({ recipient: cert, out: sealedDir, meta: { sourceCommit: 'abc', versionCode: '400' },
    inputs: [`wafra-apk=${plain}`] });
  assert.equal(verification.versionCode, '400');
  assert.deepEqual(verification.files[0].buildFlags, allOff);
  assert.deepEqual(fs.readdirSync(sealedDir).sort(), ['verification.json', 'wafra-apk.enc']);
  const sealedBytes = fs.readFileSync(path.join(sealedDir, 'wafra-apk.enc'));
  assert.equal(sealedBytes.includes(Buffer.from(marker('founder-unlock', 'off'))), false, 'ciphertext hides the content');

  const [opened] = sealer.open({ key, in: sealedDir, out: path.join(dir, 'open') });
  assert.deepEqual(fs.readFileSync(opened.file), fs.readFileSync(plain));

  const json = path.join(sealedDir, 'verification.json');
  const record = JSON.parse(fs.readFileSync(json, 'utf8'));
  fs.writeFileSync(json, JSON.stringify({ ...record, files: [{ ...record.files[0], sha256: '0'.repeat(64) }] }));
  assert.throws(() => sealer.open({ key, in: sealedDir, out: path.join(dir, 'open2') }), /does not match verification\.json/);
  assert.equal(fs.existsSync(path.join(dir, 'open2', 'wafra.apk.bundle')), false, 'a mismatching plaintext is removed');

  for (const bad of [{ source: '../../escaped.txt' }, { source: '/tmp/abs.apk' }, { sealed: '../wafra-apk.enc' }, { source: 'a/b.apk' }]) {
    fs.writeFileSync(json, JSON.stringify({ ...record, files: [{ ...record.files[0], ...bad }] }));
    assert.throws(() => sealer.open({ key, in: sealedDir, out: path.join(dir, 'open-bad') }), /refusing/, JSON.stringify(bad));
  }
  assert.equal(fs.existsSync(path.join(dir, 'escaped.txt')), false);

  fs.writeFileSync(json, JSON.stringify(record));
  sealedBytes[sealedBytes.length - 1] ^= 1;
  fs.writeFileSync(path.join(sealedDir, 'wafra-apk.enc'), sealedBytes);
  assert.throws(() => sealer.open({ key, in: sealedDir, out: path.join(dir, 'open3') }), /sealed SHA-256 mismatch/);
});
