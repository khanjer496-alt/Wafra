const assert = require('node:assert/strict');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const load = () => import(pathToFileURL(path.resolve(__dirname, '../../release/iphone-test-readiness.mjs')).href);
const id = '11111111-1111-1111-1111-111111111111';
const secondId = '22222222-2222-2222-2222-222222222222';
const device = (overrides = {}) => ({
  identifier: id,
  hardwareProperties: { marketingName: 'iPhone 15', productType: 'iPhone15,4', platform: 'iOS', reality: 'physical' },
  deviceProperties: { osVersionNumber: '26.2', developerModeStatus: 'enabled' },
  connectionProperties: { pairingState: 'paired', tunnelState: 'connected', transportType: 'usb' },
  ...overrides,
});
const inventory = (devices) => ({ info: { outcome: 'success', commandType: 'devicectl.list.devices' }, result: { devices } });
const apps = (entries = [{ bundleIdentifier: 'app.wafra.ios', version: '1.0.0', bundleVersion: '188' }]) => ({
  info: { outcome: 'success', commandType: 'devicectl.device.info.apps' }, result: { apps: entries },
});

test('selects the only paired connected physical iPhone 15', async () => {
  const { selectIphone15 } = await load();
  const selected = selectIphone15(inventory([device()]));
  assert.equal(selected.state, 'selected');
  assert.equal(selected.device.identifier, id);
});

test('recognizes exact iPhone 15 product types when CoreDevice omits rich hardware metadata', async () => {
  const { selectIphone15, inspectIphoneReadiness } = await load();
  for (const [productType, model] of [
    ['iPhone15,4', 'iPhone 15'], ['iPhone15,5', 'iPhone 15 Plus'],
    ['iPhone16,1', 'iPhone 15 Pro'], ['iPhone16,2', 'iPhone 15 Pro Max'],
  ]) {
    const data = inventory([device({ hardwareProperties: { deviceType: 'iPhone', productType, platform: 'iOS' } })]);
    assert.equal(selectIphone15(data).state, 'selected');
    const { report } = await inspectIphoneReadiness({}, { readCommand: async (args) => args[0] === 'list' ? data : apps() });
    assert.equal(report.device.model, model);
    assert.equal(report.proof.physicalTests, 'unverified');
    assert.equal(report.launchReady, false);
  }
});

test('the observed unpaired iPhone 15 inventory shape identifies the family without bypassing connection gates', async () => {
  const { selectIphone15, inspectIphoneReadiness } = await load();
  const data = inventory([device({
    hardwareProperties: { deviceType: 'iPhone', productType: 'iPhone15,4', platform: 'iOS' },
    deviceProperties: { osVersionNumber: '26.6.2' },
    connectionProperties: { pairingState: 'unpaired', tunnelState: 'disconnected', transportType: 'wired' },
  })]);
  assert.equal(selectIphone15(data, { deviceId: id }).state, 'device_unavailable');
  let calls = 0;
  const { report, exitCode } = await inspectIphoneReadiness({ deviceId: id }, { readCommand: async () => { calls++; return data; } });
  assert.equal(exitCode, 2);
  assert.equal(calls, 1);
  assert.deepEqual(report.device, { model: 'iPhone 15', osVersion: '26.6.2', developerMode: 'unknown', pairing: 'not_paired', tunnel: 'disconnected', transport: 'wired' });
  assert.equal(report.installedWafra, null);
  assert.equal(report.proof.appMetadata, 'unverified');
  assert.equal(report.proof.physicalTests, 'unverified');
});

test('sparse hardware metadata rejects iPhone 14 Pro and iPhone 16 product types', async () => {
  const { selectIphone15 } = await load();
  for (const productType of ['iPhone15,2', 'iPhone15,3', 'iPhone17,1', 'iPhone17,2', 'iPhone17,3', 'iPhone17,4']) {
    const data = inventory([device({ hardwareProperties: { deviceType: 'iPhone', productType, platform: 'iOS' } })]);
    assert.equal(selectIphone15(data).state, 'no_iphone15');
    assert.equal(selectIphone15(data, { deviceId: id }).state, 'wrong_device_family');
  }
});

test('sparse hardware recognition rejects explicit simulated or conflicting physical metadata', async () => {
  const { selectIphone15 } = await load();
  for (const hardwareProperties of [
    { deviceType: 'iPhone', productType: 'iPhone15,4', platform: 'iOS', reality: 'simulated' },
    { deviceType: 'iPhone', productType: 'iPhone15,4', platform: 'iOS', reality: null },
    { deviceType: 'iPad', productType: 'iPhone15,4', platform: 'iOS' },
    { productType: 'iPhone15,4', platform: 'iOS' },
    { deviceType: 'iPhone', productType: 'iPhone15,4', platform: 'iOS', marketingName: 'iPhone 15 Plus' },
    { deviceType: 'iPhone', productType: 'iPhone15,2', platform: 'iOS', marketingName: 'iPhone 15' },
  ]) {
    assert.equal(selectIphone15(inventory([device({ hardwareProperties })])).state, 'no_iphone15');
  }
});

test('sparse hardware recognition still requires pairing and exact disambiguation', async () => {
  const { selectIphone15 } = await load();
  const hardwareProperties = { deviceType: 'iPhone', productType: 'iPhone15,4', platform: 'iOS' };
  const unpaired = device({ hardwareProperties, connectionProperties: { pairingState: 'unpaired', tunnelState: 'connected' } });
  assert.equal(selectIphone15(inventory([unpaired]), { deviceId: id }).state, 'device_unavailable');
  const data = inventory([device({ hardwareProperties }), device({ hardwareProperties, identifier: secondId })]);
  assert.equal(selectIphone15(data).state, 'ambiguous_device');
  assert.equal(selectIphone15(data, { deviceId: secondId }).device.identifier, secondId);
  assert.equal(selectIphone15(inventory([unpaired, device({ identifier: secondId })]), { deviceId: id }).state, 'device_unavailable');
});

test('never falls back to a different iPhone family or simulator', async () => {
  const { selectIphone15 } = await load();
  for (const hardwareProperties of [
    { marketingName: 'iPhone 16 Pro', productType: 'iPhone17,1', platform: 'iOS', reality: 'physical' },
    { marketingName: 'iPhone 15', productType: 'iPhone15,4', platform: 'iOS', reality: 'simulated' },
  ]) {
    assert.equal(selectIphone15(inventory([device({ hardwareProperties })])).state, 'no_iphone15');
  }
});

test('disconnected and unavailable cached devices are not available proof', async () => {
  const { selectIphone15 } = await load();
  for (const tunnelState of ['disconnected', 'unavailable', undefined]) {
    assert.equal(selectIphone15(inventory([device({ connectionProperties: { pairingState: 'paired', tunnelState } })])).state, 'device_unavailable');
  }
});

test('requires exact identifier when multiple eligible iPhone 15 devices are present', async () => {
  const { selectIphone15 } = await load();
  const data = inventory([device(), device({ identifier: secondId })]);
  assert.equal(selectIphone15(data).state, 'ambiguous_device');
  assert.equal(selectIphone15(data, { deviceId: secondId }).device.identifier, secondId);
  assert.equal(selectIphone15(data, { deviceId: 'iPhone' }).state, 'device_not_found');
});

test('an explicit identifier still cannot select an unrelated phone', async () => {
  const { selectIphone15 } = await load();
  const other = device({ hardwareProperties: { marketingName: 'iPhone 16 Pro', productType: 'iPhone17,1', platform: 'iOS', reality: 'physical' } });
  assert.equal(selectIphone15(inventory([other]), { deviceId: id }).state, 'wrong_device_family');
});

test('malformed envelopes and duplicate identifiers fail closed', async () => {
  const { selectIphone15, parseDevicectlJson } = await load();
  for (const data of [null, {}, { result: { devices: [] } }, inventory('not an array'), inventory([device(), device()])]) {
    assert.equal(selectIphone15(data).state, 'invalid_inventory');
  }
  assert.throws(() => parseDevicectlJson('{private malformed text', 'devicectl.list.devices'), /invalid_device_json/);
  assert.throws(() => parseDevicectlJson(JSON.stringify({ info: { outcome: 'failure' }, result: {} }), 'devicectl.list.devices'), /invalid_device_json/);
});

test('absent or unusable target never probes a different device', async () => {
  const { inspectIphoneReadiness } = await load();
  for (const data of [inventory([]), inventory([device({ connectionProperties: { pairingState: 'paired', tunnelState: 'unavailable' } })])]) {
    const calls = [];
    const { report, exitCode } = await inspectIphoneReadiness({}, { readCommand: async (args) => { calls.push(args); return data; }, now: () => '2026-10-14T00:00:00.000Z' });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ['list', 'devices']);
    assert.equal(exitCode, 2);
    assert.equal(report.proof.physicalTests, 'unverified');
  }
});

test('only filtered read-only apps command is issued for the selected identifier', async () => {
  const { inspectIphoneReadiness } = await load();
  const calls = [];
  const { report, exitCode } = await inspectIphoneReadiness({}, { readCommand: async (args) => { calls.push(args); return calls.length === 1 ? inventory([device()]) : apps(); } });
  assert.equal(exitCode, 0);
  assert.equal(report.state, 'inspection_complete');
  assert.deepEqual(calls, [['list', 'devices'], ['device', 'info', 'apps', '--device', id, '--bundle-id', 'app.wafra.ios', '--include-default-apps']]);
  assert.deepEqual(report.installedWafra, { version: '1.0.0', build: '188', expectedMatch: 'not_checked' });
  assert.equal(report.proof.freshNativeArtifact, 'unverified');
  assert.equal(report.proof.installedSourceMatch, 'unverified');
  assert.equal(report.proof.physicalTests, 'unverified');
  assert.equal(report.launchReady, false);
});

test('old build is a mismatch when the intended build is supplied', async () => {
  const { inspectIphoneReadiness } = await load();
  const result = await inspectIphoneReadiness({ expectedBuild: '189' }, { readCommand: async (args) => args[0] === 'list' ? inventory([device()]) : apps() });
  assert.equal(result.exitCode, 2);
  assert.equal(result.report.state, 'installed_build_mismatch');
  assert.equal(result.report.installedWafra.expectedMatch, 'mismatch');
  assert.equal(result.report.proof.installedSourceMatch, 'unverified');
});

test('even an expected version/build match cannot establish native provenance', async () => {
  const { inspectIphoneReadiness } = await load();
  const { report } = await inspectIphoneReadiness({ expectedVersion: '1.0.0', expectedBuild: '188' }, { readCommand: async (args) => args[0] === 'list' ? inventory([device()]) : apps() });
  assert.equal(report.installedWafra.expectedMatch, 'matched');
  assert.equal(report.proof.installedSourceMatch, 'unverified');
  assert.equal(report.launchReady, false);
});

test('missing, malformed or nonstring app version/build cannot be complete', async () => {
  const { inspectIphoneReadiness } = await load();
  for (const entries of [[], [{ bundleIdentifier: 'another.app', version: 'secret', bundleVersion: '1' }], [{ bundleIdentifier: 'app.wafra.ios', version: 1, bundleVersion: '188' }], [{ bundleIdentifier: 'app.wafra.ios', version: '1.0.0', bundleVersion: 188 }]]) {
    const { report, exitCode } = await inspectIphoneReadiness({}, { readCommand: async (args) => args[0] === 'list' ? inventory([device()]) : apps(entries) });
    assert.equal(exitCode, 2);
    assert.notEqual(report.state, 'inspection_complete');
  }
});

test('raw inventory, personal names, identifiers, serials and command errors are absent from receipts', async () => {
  const { inspectIphoneReadiness } = await load();
  const secret = 'PRIVATE_PHONE_OWNER_AND_SERIAL';
  const data = inventory([device({ deviceProperties: { osVersionNumber: '26.2', developerModeStatus: 'enabled', name: secret }, hardwareProperties: { marketingName: 'iPhone 15', productType: 'iPhone15,4', platform: 'iOS', reality: 'physical', serialNumber: secret } })]);
  for (const fail of [false, true]) {
    const { report } = await inspectIphoneReadiness({}, { readCommand: async (args) => {
      if (args[0] === 'list') return data;
      if (fail) throw new Error(`stdout ${secret} ${id}`);
      return apps();
    } });
    const serialized = JSON.stringify(report);
    assert.ok(!serialized.includes(secret));
    assert.ok(!serialized.includes(id));
    assert.equal(report.launchReady, false);
  }
});

test('disabled developer mode or incomplete OS metadata prevents app probing', async () => {
  const { inspectIphoneReadiness } = await load();
  for (const deviceProperties of [{ osVersionNumber: '26.2', developerModeStatus: 'disabled' }, { developerModeStatus: 'enabled' }, { osVersionNumber: '26.6.2' }]) {
    let calls = 0;
    const result = await inspectIphoneReadiness({}, { readCommand: async () => { calls++; return inventory([device({ deviceProperties })]); } });
    assert.equal(calls, 1);
    assert.equal(result.exitCode, 2);
  }
});

test('inventory errors do not expose raw stdout or run subsequent commands', async () => {
  const { inspectIphoneReadiness } = await load();
  let calls = 0;
  const { report, exitCode } = await inspectIphoneReadiness({}, { readCommand: async () => { calls++; throw new Error('secret stdout'); } });
  assert.equal(calls, 1);
  assert.equal(exitCode, 2);
  assert.equal(report.state, 'inventory_read_failed');
  assert.ok(!JSON.stringify(report).includes('secret stdout'));
});

function fakeHost() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-readiness-test-'));
  const commandLog = path.join(directory, 'commands.jsonl');
  const fixture = path.join(directory, 'inventory.json');
  fs.writeFileSync(fixture, JSON.stringify(inventory([])));
  const executable = path.join(directory, 'xcrun');
  fs.writeFileSync(executable, `#!${process.execPath}\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nfs.appendFileSync(process.env.WAFRA_READINESS_COMMAND_LOG, JSON.stringify(args) + '\\n');\nif (process.env.WAFRA_READINESS_FAIL_COMMAND === 'yes') { console.error('PRIVATE_DEVICE_ERROR'); process.exit(1); }\nconst destination = args[args.indexOf('--json-output') + 1];\nfs.copyFileSync(process.env.WAFRA_READINESS_INVENTORY, destination);\nconsole.log('PRIVATE_DEVICE_STDOUT_IS_NOT_JSON');\n`, { mode: 0o700 });
  const env = {
    ...process.env,
    PATH: `${directory}${path.delimiter}${process.env.PATH || ''}`,
    WAFRA_READINESS_COMMAND_LOG: commandLog,
    WAFRA_READINESS_INVENTORY: fixture,
  };
  const run = (args, extraEnvironment = {}) => spawnSync(process.execPath, [path.resolve(__dirname, '../../release/iphone-test-readiness.mjs'), ...args], {
    encoding: 'utf8', env: { ...env, ...extraEnvironment }, timeout: 5000,
  });
  return { directory, commandLog, run, dispose: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test('CLI consumes supported private JSON files and never command stdout', () => {
  const host = fakeHost();
  try {
    const receipt = path.join(host.directory, 'receipt.json');
    const result = host.run(['--output', receipt]);
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).state, 'no_iphone15');
    assert.ok(!result.stdout.includes('PRIVATE_DEVICE_STDOUT_IS_NOT_JSON'));
    assert.equal(fs.readFileSync(receipt, 'utf8'), result.stdout);
    assert.equal(fs.statSync(receipt).mode & 0o777, 0o600);
    const calls = fs.readFileSync(host.commandLog, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, 5), ['devicectl', 'list', 'devices', '--timeout', '15']);
    assert.equal(calls[0][5], '--json-output');
    assert.ok(!fs.existsSync(path.dirname(calls[0][6])), 'private raw CoreDevice JSON was removed');
  } finally { host.dispose(); }
});

test('CLI refuses existing receipts and invalid arguments before inspecting devices', () => {
  const host = fakeHost();
  try {
    const receipt = path.join(host.directory, 'existing.json');
    fs.writeFileSync(receipt, 'KEEP THIS EXISTING RECEIPT');
    for (const args of [['--output', receipt], ['--device', 'iPhone'], ['--unknown', 'private'], ['--expected-build', '188; private-command']]) {
      const result = host.run(args);
      assert.equal(result.status, 2);
      assert.equal(result.stdout, '');
      assert.ok(!result.stderr.includes('private-command'));
      assert.ok(!fs.existsSync(host.commandLog));
    }
    assert.equal(fs.readFileSync(receipt, 'utf8'), 'KEEP THIS EXISTING RECEIPT');
  } finally { host.dispose(); }
});

test('CLI read failure redacts raw command stderr and writes only safe failure receipt', () => {
  const host = fakeHost();
  try {
    const result = host.run([], { WAFRA_READINESS_FAIL_COMMAND: 'yes' });
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).state, 'inventory_read_failed');
    assert.ok(!result.stdout.includes('PRIVATE_DEVICE_ERROR'));
    assert.ok(!result.stderr.includes('PRIVATE_DEVICE_ERROR'));
  } finally { host.dispose(); }
});
