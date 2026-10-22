'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { createFingerprintAsync } = require('@expo/fingerprint');
const YAML = require('yaml');

const ROOT = path.resolve(__dirname, '../../..');
const GENERATOR = path.join(ROOT, 'scripts/generate-ios-background-parser.cjs');
const RESOURCE = 'modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.js';
const META = 'modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.meta.json';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const generator = () => {
  assert.ok(fs.existsSync(GENERATOR), 'the shipping direct-source generator must exist');
  return require(GENERATOR);
};

function fixture(t, adapter = `import { PARSER_VERSION } from '@/lib/sms-parser';
import { CURRENCY_MINOR_UNITS } from './currency-metadata';
import { COUNTRY_CODES } from './country';
import type { UnavailableNodeType } from 'node:fs';
export function parseIosBackgroundAlert(input: unknown) {
  return {v:1, parserVersion:PARSER_VERSION, route:'ignore', provenance:null,
    notification:null, fixture:[input, CURRENCY_MINOR_UNITS.JOD, COUNTRY_CODES[0]]};
}`) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-native-generator-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
  };
  write('package.json', '{"name":"wafra-parser-generator-fixture","version":"1.0.0"}');
  write('src/lib/ios-background-alert-parser.ts', adapter);
  write('src/lib/sms-parser.ts', 'export const PARSER_VERSION = 67;');
  write('src/lib/currency-metadata.ts', 'export const CURRENCY_MINOR_UNITS = {AED:2,JPY:0,JOD:3,CLF:4} as const;');
  write('src/lib/country.ts', "export const COUNTRY_CODES = ['JO','AE','JP'];");
  return { root, write };
}

test('shipping generation compiles normal TypeScript, erases type-only externals and produces deterministic bounded resources', (t) => {
  const { root } = fixture(t);
  const first = generator().buildParserResources(root);
  const second = generator().buildParserResources(root);
  assert.equal(first.bundle, second.bundle);
  assert.deepEqual(first.metadata, second.metadata);
  assert.equal(first.metadata.v, 1);
  assert.equal(first.metadata.moduleCount, 4);
  assert.equal(first.metadata.parserVersion, 67);
  assert.equal(first.metadata.bundleSha256, sha256(first.bundle));
  assert.deepEqual(first.metadata.currencies, { AED: 2, JOD: 3, JPY: 0 });
  assert.deepEqual(first.metadata.countries, ['AE', 'JO', 'JP', 'ZZ']);
  assert.match(first.foregroundSource, new RegExp(first.metadata.sourceHash));
  const context = vm.createContext({});
  vm.runInContext(first.bundle, context, { timeout: 1000 });
  assert.equal(typeof context.wafraNativeAlertParse, 'function');
  const result = JSON.parse(context.wafraNativeAlertParse('{"body":"synthetic"}'));
  assert.equal(result.route, 'ignore');
  assert.deepEqual(result.fixture, [{ body: 'synthetic' }, 3, 'JO']);
  assert.equal(context.process, undefined);
  assert.equal(context.require, undefined);
});

test('runtime externals, stubs, storage, outside-source paths and dynamic loaders are rejected instead of shimmed', (t) => {
  const { root, write } = fixture(t);
  for (const specifier of ['node:fs', 'react-native', 'expo-secure-store', './parser.stub', './storage', '../../scripts/test/build/parser']) {
    write('src/lib/ios-background-alert-parser.ts', `import { thing } from '${specifier}'; export const parseIosBackgroundAlert = () => thing;`);
    assert.throws(() => generator().buildParserResources(root), /forbidden|pure|source|external|stub|storage/i, specifier);
  }
  for (const expression of ["require(name)", "import('./country')", 'fetch("https://example.invalid")', 'process.env.SECRET', 'eval("1")']) {
    write('src/lib/ios-background-alert-parser.ts', `export const parseIosBackgroundAlert = () => ${expression};`);
    assert.throws(() => generator().buildParserResources(root), /forbidden|dynamic|host|external/i, expression);
  }
});

test('reviewed dormant FX exports have no host bindings and cannot execute at module admission', (t) => {
  const { root, write } = fixture(t);
  write('src/lib/currency-metadata.ts', `export const CURRENCY_MINOR_UNITS = {AED:2,JPY:0,JOD:3};
export async function fetchUnusedRate() { return fetch('https://example.invalid'); }`);
  const output = generator().buildParserResources(root);
  const context = vm.createContext({});
  vm.runInContext(output.bundle, context, { timeout: 1000 });
  assert.equal(context.fetch, undefined);
  assert.equal(context.setTimeout, undefined);
  assert.equal(JSON.parse(context.wafraNativeAlertParse('{}')).route, 'ignore');
  write('src/lib/currency-metadata.ts', `export const CURRENCY_MINOR_UNITS = {AED:2};
export function fetchUnusedRate() { return fetch('https://example.invalid'); }
fetchUnusedRate();`);
  assert.throws(() => generator().buildParserResources(root), /forbidden.*top-level/i);
  write('src/lib/currency-metadata.ts', `export const CURRENCY_MINOR_UNITS = {AED:2};
fetch('https://example.invalid');`);
  assert.throws(() => generator().buildParserResources(root), /forbidden.*host/i);
});

test('cross-module top-level execution cannot invoke a dormant network export during bundle admission', (t) => {
  const { root, write } = fixture(t);
  const source = fs.readFileSync(path.join(root, 'src/lib/ios-background-alert-parser.ts'), 'utf8');
  write('src/lib/ios-background-alert-parser.ts', `import './admission';\n${source}`);
  write('src/lib/admission.ts', `import { fetchUnusedRate } from './currency-metadata'; fetchUnusedRate();`);
  write('src/lib/currency-metadata.ts', `export const CURRENCY_MINOR_UNITS = {AED:2,JPY:0,JOD:3};
export async function fetchUnusedRate() { return fetch('https://example.invalid'); }`);
  assert.throws(() => generator().buildParserResources(root), /host|admission|fetch is not defined/i);
});

test('a top-level local alias cannot invoke an imported async network function', (t) => {
  const { root, write } = fixture(t);
  const source = fs.readFileSync(path.join(root, 'src/lib/ios-background-alert-parser.ts'), 'utf8');
  write('src/lib/ios-background-alert-parser.ts', `import './admission';\n${source}`);
  write('src/lib/admission.ts', `import { fetchUnusedRate } from './currency-metadata';
const alias = fetchUnusedRate; alias();`);
  write('src/lib/currency-metadata.ts', `export const CURRENCY_MINOR_UNITS = {AED:2,JPY:0,JOD:3};
export async function fetchUnusedRate() { return fetch('https://example.invalid'); }`);
  // Exit immediately if generation accepts the module. This exposes acceptance
  // directly without allowing the existing bug's rejected Promise to fail an
  // unrelated test after this test has already ended.
  const result = spawnSync(process.execPath, ['-e', `
try { require(process.argv[1]).buildParserResources(process.argv[2]); process.stdout.write('accepted'); process.exit(0); }
catch (error) { process.stderr.write(error.message); process.exit(2); }
`, GENERATOR, root], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'async host-function aliases must fail before bundle admission');
  assert.match(result.stderr, /forbidden.*host.*admission/i);
});

for (const [name, body] of [
  ['assigned alias', 'let alias; alias = fetchUnusedRate; alias();'],
  ['object member', 'const handlers = {run: fetchUnusedRate}; handlers.run();'],
  ['destructured array', 'const [alias] = [fetchUnusedRate]; alias();'],
  ['bound function', 'const alias = fetchUnusedRate.bind(null); alias();'],
  ['helper callback', 'function invoke(fn) {fn();} invoke(fetchUnusedRate);'],
  ['array callback', '[1].forEach(fetchUnusedRate);'],
  ['function factory', 'function factory() {return fetchUnusedRate;} const alias = factory(); alias();'],
  ['shadowed factory', 'function factory() {return fetchUnusedRate;} function unused() {function factory() {return null;}} const alias = factory(); alias();'],
]) test(`top-level ${name} cannot indirectly execute a dormant async host function`, (t) => {
  const { root, write } = fixture(t);
  const source = fs.readFileSync(path.join(root, 'src/lib/ios-background-alert-parser.ts'), 'utf8');
  write('src/lib/ios-background-alert-parser.ts', `import './admission';\n${source}`);
  write('src/lib/admission.ts', `import { fetchUnusedRate } from './currency-metadata';\n${body}`);
  write('src/lib/currency-metadata.ts', `export const CURRENCY_MINOR_UNITS = {AED:2,JPY:0,JOD:3};
export async function fetchUnusedRate() { return fetch('https://example.invalid'); }`);
  const result = spawnSync(process.execPath, ['-e', `
try { require(process.argv[1]).buildParserResources(process.argv[2]); process.stdout.write('accepted'); process.exit(0); }
catch (error) { process.stderr.write(error.message); process.exit(2); }
`, GENERATOR, root], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, `${name} must fail before bundle admission`);
  assert.match(result.stderr, /forbidden.*host.*admission/i);
});

test('module and UTF-8 bundle limits fail before emitting partial resources', (t) => {
  const { root, write } = fixture(t);
  write('src/lib/ios-background-alert-parser.ts', "export { parseIosBackgroundAlert } from './part0';");
  for (let index = 0; index < 65; index++) {
    write(`src/lib/part${index}.ts`, index === 64
      ? 'export const parseIosBackgroundAlert = () => null;'
      : `export { parseIosBackgroundAlert } from './part${index + 1}';`);
  }
  assert.throws(() => generator().buildParserResources(root), /64|module.*limit/i);
  write('src/lib/ios-background-alert-parser.ts', `export const parseIosBackgroundAlert = () => '${'x'.repeat(2 * 1024 * 1024)}';`);
  assert.throws(() => generator().buildParserResources(root), /2 MiB|bundle.*limit/i);
  assert.equal(fs.existsSync(path.join(root, RESOURCE)), false);
});

test('freshness detects source, bundle, metadata and foreground-hash drift without rewriting any file', (t) => {
  const { root, write } = fixture(t);
  const { generateParserResources } = generator();
  generateParserResources(root);
  assert.doesNotThrow(() => generateParserResources(root, { check: true }));
  for (const file of [RESOURCE, META, 'src/lib/ios-background-parser-source.generated.ts']) {
    const before = fs.readFileSync(path.join(root, file), 'utf8');
    write(file, before + '\n');
    assert.throws(() => generateParserResources(root, { check: true }), /stale|fresh/i);
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), before + '\n');
    write(file, before);
  }
  write('src/lib/sms-parser.ts', 'export const PARSER_VERSION = 68;');
  assert.throws(() => generateParserResources(root, { check: true }), /stale|fresh/i);
});

test('artifact verification requires exact packaged resource bytes, metadata, parser version and source hash', (t) => {
  const { root, write } = fixture(t);
  const { generateParserResources, verifyResourceDirectory } = generator();
  const expected = generateParserResources(root);
  const directory = path.join(root, 'packaged/WafraLiveCaptureResources.bundle');
  write('packaged/WafraLiveCaptureResources.bundle/WafraBackgroundParser.js', expected.bundle);
  write('packaged/WafraLiveCaptureResources.bundle/WafraBackgroundParser.meta.json', `${JSON.stringify(expected.metadata, null, 2)}\n`);
  assert.deepEqual(verifyResourceDirectory(directory, root), expected.metadata);
  write('packaged/WafraLiveCaptureResources.bundle/WafraBackgroundParser.js', expected.bundle + '\n');
  assert.throws(() => verifyResourceDirectory(directory, root), /packaged.*resource\/hash\/version/i);
  write('packaged/WafraLiveCaptureResources.bundle/WafraBackgroundParser.js', expected.bundle);
  write('packaged/WafraLiveCaptureResources.bundle/WafraBackgroundParser.meta.json', `${JSON.stringify({ ...expected.metadata, parserVersion: 1 }, null, 2)}\n`);
  assert.throws(() => verifyResourceDirectory(directory, root), /packaged.*resource\/hash\/version/i);
});

test('actual generated shipping resource preserves domestic, foreign and zero/three-decimal principals and refuses personal text', () => {
  const output = generator().generateParserResources(ROOT, { check: true });
  const context = vm.createContext({});
  vm.runInContext(output.bundle, context, { timeout: 2000 });
  const parse = (body, sender = 'ENBD') => JSON.parse(context.wafraNativeAlertParse(JSON.stringify({
    v: 1, context: { v: 1, country: 'AE', parserMarket: 'AE', ledgerMoney: { currency: 'AED', exponent: 2 },
      sourceHash: output.metadata.sourceHash }, sender, body, observedAt: Date.parse('2026-10-13T12:00:00Z'),
  })));
  for (const [currency, literal, minorUnits, exponent] of [
    ['AED', '187.50', '18750', 2], ['USD', '24.86', '2486', 2],
    ['JOD', '24.501', '24501', 3], ['JPY', '2400', '2400', 0],
  ]) {
    const result = parse(`Purchase of ${currency} ${literal} with Debit Card ending 1234 at SAMPLE STORE.`);
    assert.deepEqual(result.notification.amount, { currency, minorUnits, exponent });
  }
  const review = parse('Chase Bank alert: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET.', 'CHASE');
  assert.equal(review.route, 'review');
  assert.deepEqual(review.notification.amount, { currency: 'USD', minorUnits: '2486', exponent: 2 });
  assert.equal(parse('Hi Ann, I have just spent USD 50.00 at Example Market.', '+12025550190').notification, null);
});

test('the actual OTA checker refuses stale parser sources and leaves packaged bytes unchanged', (t) => {
  const { root, write } = fixture(t);
  for (const file of ['scripts/check-update-config.mjs', 'scripts/generate-ios-background-parser.cjs', 'app.json', 'eas.json', 'package.json']) {
    write(file, fs.readFileSync(path.join(ROOT, file), 'utf8'));
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  generator().generateParserResources(root);
  const run = () => spawnSync(process.execPath, [path.join(root, 'scripts/check-update-config.mjs')], { encoding: 'utf8' });
  assert.equal(run().status, 0);
  const before = fs.readFileSync(path.join(root, RESOURCE), 'utf8');
  write('src/lib/sms-parser.ts', 'export const PARSER_VERSION = 68;');
  const stale = run();
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /native parser resources are stale/i);
  assert.equal(fs.readFileSync(path.join(root, RESOURCE), 'utf8'), before);
});

test('the installed Expo fingerprint hashes both resources and changes after only parser source changes', async (t) => {
  const { root, write } = fixture(t);
  generator().generateParserResources(root);
  const config = path.join(ROOT, 'fingerprint.config.js');
  assert.ok(fs.existsSync(config), 'explicit native parser fingerprint sources are required');
  write('fingerprint.config.js', fs.readFileSync(config, 'utf8'));
  const before = await createFingerprintAsync(root, { platforms: ['ios'], silent: true });
  for (const filePath of [RESOURCE, META]) {
    const source = before.sources.find((item) => item.type === 'file' && item.filePath === filePath);
    assert.ok(source?.hash, `${filePath} must participate in the actual Expo fingerprint`);
  }
  const oldMetadata = JSON.parse(fs.readFileSync(path.join(root, META), 'utf8'));
  write('src/lib/sms-parser.ts', 'export const PARSER_VERSION = 68;');
  generator().generateParserResources(root);
  const after = await createFingerprintAsync(root, { platforms: ['ios'], silent: true });
  assert.notEqual(after.hash, before.hash);
  const newMetadata = JSON.parse(fs.readFileSync(path.join(root, META), 'utf8'));
  assert.notEqual(newMetadata.sourceHash, oldMetadata.sourceHash);
  assert.notEqual(newMetadata.bundleSha256, oldMetadata.bundleSha256);
});

test('the actual iOS project fingerprint retains resource hashes when autolinking deduplicates their containing folder', async () => {
  const fingerprint = await createFingerprintAsync(ROOT, { platforms: ['ios'], silent: true, debug: true });
  const findPath = (info, file) => {
    if (!info) return null;
    if (info.path === file) return info;
    for (const child of info.children || []) {
      const found = findPath(child, file);
      if (found) return found;
    }
    return null;
  };
  for (const file of [RESOURCE, META]) {
    const source = fingerprint.sources.find((item) => item.reasons.includes('wafraIosBackgroundParser') &&
      findPath(item.debugInfo, file));
    assert.ok(source?.hash, `${file} must remain part of the actual native fingerprint`);
    const hashedFile = findPath(source.debugInfo, file);
    const expected = crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
    assert.equal(hashedFile.hash, expected, `${file} exact bytes must participate`);
  }
});

test('current workflows generate and check before native prebuild or build and verify exact packaged parser hashes', () => {
  for (const relative of ['.github/workflows/ci.yml', '.github/workflows/ios-testflight.yml']) {
    const workflow = YAML.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
    const jobs = relative.endsWith('ci.yml') ? ['check', 'native-ios'] : ['build', 'local-build'];
    for (const name of jobs) {
      const steps = workflow.jobs[name].steps;
      const generate = steps.findIndex((step) => /node scripts\/generate-ios-background-parser\.cjs\n/.test(step.run || ''));
      const build = steps.findIndex((step) => /expo prebuild|eas build --platform ios|args=\(build --platform ios/.test(step.run || ''));
      assert.ok(generate >= 0 && build > generate, `${relative} ${name}: generate before native build`);
      assert.match(steps[generate].run, /generate-ios-background-parser\.cjs --check/);
    }
  }
  const ios = YAML.parse(fs.readFileSync(path.join(ROOT, '.github/workflows/ios-testflight.yml'), 'utf8'));
  const verify = ios.jobs['local-build'].steps.find((step) => step.name === 'Verify the actual signed IPA and App Intent resources').run;
  assert.match(verify, /generate-ios-background-parser\.cjs --verify-resource-directory/);
});

test('macOS CI runs the actual context and JavaScriptCore suites and watches their sources', () => {
  const workflow = YAML.parse(fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8'));
  const nativeCommands = workflow.jobs['native-ios'].steps.map(step => step.run || '').join('\n');
  for (const suite of ['native-parser-context', 'native-background-alert-parser']) {
    assert.ok(nativeCommands.includes(`bash scripts/test/${suite}.sh`), `${suite} must run on Apple CI`);
    const filterStep = Object.values(workflow.jobs).flatMap(job => job.steps || []).find(step => step.with?.filters);
    const paths = YAML.parse(filterStep.with.filters).ios;
    assert.ok(paths.includes(`scripts/test/${suite}.*`), `${suite} test edits must trigger native CI`);
  }
});

test('OTA configuration checks call the read-only resource freshness gate', () => {
  const checker = fs.readFileSync(path.join(ROOT, 'scripts/check-update-config.mjs'), 'utf8');
  assert.match(checker, /generate-ios-background-parser\.cjs/);
  assert.match(checker, /--check/);
  if (fs.existsSync(path.join(ROOT, RESOURCE))) {
    const result = spawnSync(process.execPath, [GENERATOR, '--check'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});
