'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {withPlugins} = require('@expo/config-plugins');
const root = path.resolve(__dirname, '../../..');
const cleanup = './modules/wafra-release-metadata/plugin';
const pluginName = value => Array.isArray(value) ? value[0] : value;

function withEnv(profile, nodeEnv, fn) {
  const before = {...process.env};
  if (profile) process.env.EAS_BUILD_PROFILE = profile; else delete process.env.EAS_BUILD_PROFILE;
  if (nodeEnv) process.env.NODE_ENV = nodeEnv; else delete process.env.NODE_ENV;
  const restore = () => {
    for (const key of ['EAS_BUILD_PROFILE', 'NODE_ENV']) {
      if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
    }
  };
  let result;
  try { result = fn(); } catch (error) { restore(); throw error; }
  if (result && typeof result.then === 'function') return result.finally(restore);
  restore();
  return result;
}

function configure(profile, nodeEnv) {
  return withEnv(profile, nodeEnv, () => require(path.join(root, 'app.config.js'))({config: {
    name: 'Wafra', slug: 'wafra', ios: {buildNumber: '192', bundleIdentifier: 'app.wafra.ios'},
    plugins: [['expo-dev-client', {addGeneratedScheme: false}]],
  }}));
}

// The plugin reads the env when prebuild applies it, so keep the env set for
// the whole mod run, as EAS does inside the build.
function product(profile, fixture, nodeEnv) {
  return withEnv(profile, nodeEnv, async () => {
    const configured = configure(profile, nodeEnv);
    const dev = configured.plugins.findIndex(p => pluginName(p) === 'expo-dev-client');
    const last = configured.plugins.findIndex(p => pluginName(p) === cleanup);
    assert.ok(dev >= 0 && last > dev, 'cleanup must follow explicit dev-client registration');
    let config = withPlugins({...configured, _internal: {projectRoot: root, autolinkedModules: []}},
      configured.plugins.filter(p => ['expo-dev-client', cleanup].includes(pluginName(p))));
    // Reproduce Expo's later automatic legacy pass: run-once history must keep
    // the launcher from reintroducing its keys after our explicit registration.
    config = require('@expo/prebuild-config/build/plugins/withDefaultPlugins').withLegacyExpoPlugins(config);
    const result = await config.mods.ios.infoPlist({...config, modResults: structuredClone(fixture),
      modRequest: {projectRoot: root, platformProjectRoot: path.join(root, 'ios'), platform: 'ios', modName: 'infoPlist', introspect: true}});
    return result.modResults;
  });
}

test('the configured plugin list is identical in every build environment (stable expo-updates fingerprint)', () => {
  const lists = [['production', 'production'], [undefined, 'production'], [undefined, undefined],
    ['development', 'development'], ['preview', 'production']]
    .map(([profile, nodeEnv]) => JSON.stringify(configure(profile, nodeEnv).plugins));
  for (const list of lists) assert.equal(list, lists[0]);
  assert.ok(configure('production', 'production').plugins.includes(cleanup), 'cleanup is registered without options');
});

test('Release mod chain removes only exact Expo artifacts and preserves legitimate permissions', async () => {
  for (const profile of ['production', 'production-candidate', 'history-beta', 'preview']) {
    const fixture = {NSBonjourServices: ['_printer._tcp', '_expo._tcp', '_expo._tcp.custom'],
      NSLocalNetworkUsageDescription: 'Expo Dev Launcher uses the local network.',
      NSFaceIDUsageDescription: 'Unlock your ledger.', NSCameraUsageDescription: 'Scan a receipt.',
      NSAppTransportSecurity: {NSAllowsLocalNetworking: true}};
    const result = await product(profile, fixture);
    assert.deepEqual(result.NSBonjourServices, ['_printer._tcp', '_expo._tcp.custom']);
    assert.equal(result.NSLocalNetworkUsageDescription, undefined);
    for (const key of ['NSFaceIDUsageDescription', 'NSCameraUsageDescription', 'NSAppTransportSecurity'])
      assert.deepEqual(result[key], fixture[key], key);
  }
});

test('Release retains custom local-network purpose and removes an empty Expo-only service array', async () => {
  const result = await product('production', {NSBonjourServices: ['_expo._tcp'],
    NSLocalNetworkUsageDescription: 'Find my local receipt printer.'});
  assert.equal(result.NSBonjourServices, undefined);
  assert.equal(result.NSLocalNetworkUsageDescription, 'Find my local receipt printer.');
  const generated = await product('production', {});
  assert.equal(generated.NSBonjourServices, undefined);
  assert.equal(generated.NSLocalNetworkUsageDescription, undefined);
});

test('development profiles and local Debug retain discovery; local production removes it', async () => {
  for (const [profile, environment] of [['development', 'production'], ['development-simulator', 'production'],
    [undefined, 'development'], [undefined, undefined]]) {
    const result = await product(profile, {}, environment);
    assert.deepEqual(result.NSBonjourServices, ['_expo._tcp']);
    assert.match(result.NSLocalNetworkUsageDescription, /Expo Dev Launcher/);
  }
  const release = await product(undefined, {}, 'production');
  assert.equal(release.NSBonjourServices, undefined);
  assert.equal(release.NSLocalNetworkUsageDescription, undefined);
});

test('development-client inheritance and plugin options survive configuration', () => {
  const pluginFile = path.join(root, cleanup, 'index.js');
  assert.ok(fs.existsSync(pluginFile));
  const {isDevelopmentBuild} = require(pluginFile);
  const profiles = {dev: {developmentClient: true}, alias: {extends: 'dev'},
    store: {extends: 'alias', developmentClient: false}};
  assert.equal(isDevelopmentBuild('alias', 'production', profiles), true);
  assert.equal(isDevelopmentBuild('store', 'development', profiles), false);
  const configurations = {debug: {developmentClient: false, ios: {buildConfiguration: 'Debug'}},
    release: {extends: 'debug', developmentClient: true, ios: {buildConfiguration: 'Release'}}};
  assert.equal(isDevelopmentBuild('debug', 'production', configurations), true);
  assert.equal(isDevelopmentBuild('release', 'development', configurations), false);
  assert.throws(() => isDevelopmentBuild('unknown', 'production', profiles), /Invalid EAS/);
  assert.throws(() => isDevelopmentBuild('loop', 'production', {loop: {extends: 'loop'}}), /Invalid EAS/);
  const first = configure('production', 'production');
  const second = require(path.join(root, 'app.config.js'))({config: first});
  assert.equal(second.plugins.filter(p => pluginName(p) === 'expo-dev-client').length, 1);
  assert.equal(second.plugins.filter(p => pluginName(p) === cleanup).length, 1);
  assert.equal(second.plugins.find(p => pluginName(p) === 'expo-dev-client')[1].addGeneratedScheme, false);
});

test('final product checker rejects either exact leftover, including extensions, and accepts custom networking', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-release-metadata-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const app = path.join(dir, 'Wafra.app');
  const python = process.platform === 'darwin' ? '/usr/bin/python3' : 'python3';
  const versions = {CFBundleVersion: '192', CFBundleShortVersionString: '1.0.0'};
  const write = (host, widget = {}) => {
    const result = spawnSync(python, ['-c', `import pathlib,plistlib,json,sys
app=pathlib.Path(sys.argv[1]); widget=app/'PlugIns'/'Widget.appex'; widget.mkdir(parents=True,exist_ok=True)
for target,info in [(app,json.loads(sys.argv[2])),(widget,json.loads(sys.argv[3]))]:
 (target/'Info.plist').write_bytes(plistlib.dumps(info,fmt=plistlib.FMT_BINARY))
`, app, JSON.stringify({...versions, ...host}), JSON.stringify({...versions, ...widget})], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
  };
  const run = () => spawnSync(python, ['scripts/check-ios-product-versions.py', app], {cwd: root, encoding: 'utf8'});
  for (const leftover of [{NSBonjourServices: ['_printer._tcp', '_expo._tcp']},
    {NSLocalNetworkUsageDescription: 'Before Expo Dev Launcher after'}]) {
    write(leftover); assert.notEqual(run().status, 0, 'host leftover must fail despite matching versions');
    write({}, leftover); assert.notEqual(run().status, 0, 'extension leftover must fail');
  }
  write({NSBonjourServices: ['_printer._tcp', '_expo._tcp.custom'],
    NSLocalNetworkUsageDescription: 'Find my local receipt printer.', NSAppTransportSecurity: {NSAllowsLocalNetworking: true}});
  const accepted = run(); assert.equal(accepted.status, 0, accepted.stderr);
});
