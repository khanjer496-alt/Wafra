#!/usr/bin/env node
// Read-only CoreDevice inspection. Enumeration is not native-build or QA proof.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const BUNDLE_ID = 'app.wafra.ios';
const MAX_JSON_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;
const MODELS = new Map([
  ['iPhone15,4', 'iPhone 15'], ['iPhone15,5', 'iPhone 15 Plus'],
  ['iPhone16,1', 'iPhone 15 Pro'], ['iPhone16,2', 'iPhone 15 Pro Max'],
]);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function validEnvelope(value, commandType) {
  return record(value) && record(value.info) && value.info.outcome === 'success'
    && value.info.commandType === commandType && record(value.result);
}

export function parseDevicectlJson(raw, commandType) {
  try {
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_JSON_BYTES) throw new Error();
    const parsed = JSON.parse(raw);
    if (!validEnvelope(parsed, commandType)) throw new Error();
    return parsed;
  } catch {
    throw new Error('invalid_device_json');
  }
}

function iphone15Model(device) {
  const hardware = device?.hardwareProperties;
  if (!record(hardware) || hardware.platform !== 'iOS' || hardware.reality !== 'physical') return null;
  const productModel = MODELS.get(hardware.productType);
  const name = hardware.marketingName;
  const namedModel = typeof name === 'string' && /^iPhone 15(?: Plus| Pro| Pro Max)?$/.test(name) ? name : null;
  // A conflicting product/name pair must not silently select another phone.
  if (productModel && namedModel && productModel !== namedModel) return null;
  if (name != null && !namedModel) return null;
  if (hardware.productType != null && !productModel) return null;
  return namedModel || productModel || null;
}

export function selectIphone15(inventory, { deviceId = null } = {}) {
  if (!validEnvelope(inventory, 'devicectl.list.devices') || !Array.isArray(inventory.result.devices)) {
    return { state: 'invalid_inventory', device: null };
  }
  const devices = inventory.result.devices;
  const ids = devices.map((device) => device?.identifier);
  if (ids.some((identifier) => typeof identifier !== 'string' || !UUID.test(identifier)) || new Set(ids).size !== ids.length) {
    return { state: 'invalid_inventory', device: null };
  }
  let candidates;
  if (deviceId !== null) {
    const exact = devices.find((device) => device.identifier === deviceId);
    if (!exact) return { state: 'device_not_found', device: null };
    if (!iphone15Model(exact)) return { state: 'wrong_device_family', device: null };
    candidates = [exact];
  } else {
    candidates = devices.filter((device) => iphone15Model(device));
  }
  if (candidates.length === 0) return { state: 'no_iphone15', device: null };
  const connected = candidates.filter((device) => device.connectionProperties?.pairingState === 'paired'
    && device.connectionProperties?.tunnelState === 'connected');
  if (connected.length > 1) return { state: 'ambiguous_device', device: null };
  if (connected.length === 0) {
    return { state: 'device_unavailable', device: candidates.length === 1 ? candidates[0] : null };
  }
  return { state: 'selected', device: connected[0] };
}

function safeDevice(device) {
  if (!device) return null;
  const properties = device.deviceProperties || {};
  const connection = device.connectionProperties || {};
  return {
    model: iphone15Model(device),
    osVersion: typeof properties.osVersionNumber === 'string' && /^\d+(?:\.\d+){0,3}$/.test(properties.osVersionNumber)
      ? properties.osVersionNumber : null,
    developerMode: ['enabled', 'disabled'].includes(properties.developerModeStatus) ? properties.developerModeStatus : 'unknown',
    pairing: connection.pairingState === 'paired' ? 'paired' : 'not_paired',
    tunnel: ['connected', 'disconnected', 'unavailable'].includes(connection.tunnelState) ? connection.tunnelState : 'unknown',
    transport: ['usb', 'wired', 'localNetwork'].includes(connection.transportType) ? connection.transportType : 'unknown',
  };
}

function installedWafra(appData, options) {
  if (!validEnvelope(appData, 'devicectl.device.info.apps') || !Array.isArray(appData.result.apps)) {
    return { state: 'invalid_app_metadata', app: null };
  }
  const targets = appData.result.apps.filter((app) => app?.bundleIdentifier === BUNDLE_ID);
  if (targets.length === 0) return { state: 'wafra_not_installed', app: null };
  if (targets.length !== 1) return { state: 'invalid_app_metadata', app: null };
  const { version, bundleVersion } = targets[0];
  if (typeof version !== 'string' || !VERSION.test(version) || typeof bundleVersion !== 'string' || !VERSION.test(bundleVersion)) {
    return { state: 'invalid_app_metadata', app: null };
  }
  const checked = options.expectedVersion !== undefined || options.expectedBuild !== undefined;
  const matches = (options.expectedVersion === undefined || options.expectedVersion === version)
    && (options.expectedBuild === undefined || options.expectedBuild === bundleVersion);
  return {
    state: checked && !matches ? 'installed_build_mismatch' : 'inspection_complete',
    app: { version, build: bundleVersion, expectedMatch: !checked ? 'not_checked' : matches ? 'matched' : 'mismatch' },
  };
}

const ACTIONS = {
  inventory_read_failed: 'Check Xcode command-line tools, then retry while the intended iPhone 15 is connected and unlocked.',
  invalid_inventory: 'Retry with supported devicectl JSON output; do not use a table or cached status as device proof.',
  no_iphone15: 'Connect the intended iPhone 15, unlock it, and accept Trust on that phone.',
  device_not_found: 'Use the exact CoreDevice identifier from the current devicectl device inventory.',
  wrong_device_family: 'Choose the intended physical iPhone 15 family device.',
  device_unavailable: 'Connect and unlock the intended iPhone 15, accept Trust, and retry when its tunnel is connected.',
  ambiguous_device: 'Choose one intended phone using --device with its exact CoreDevice identifier.',
  developer_mode_required: 'Enable Developer Mode on the intended test phone and reconnect it.',
  invalid_device_metadata: 'Retry after reconnecting; a fresh OS version and developer status are required.',
  app_read_failed: 'Keep the intended phone unlocked and trusted, then retry the read-only app lookup.',
  invalid_app_metadata: 'Obtain complete supported Wafra app version/build metadata before testing.',
  wafra_not_installed: 'Install the separately verified test build on the intended phone through the authorized build workflow.',
  installed_build_mismatch: 'Use the intended verified build; the installed version/build does not match the supplied expectation.',
  inspection_complete: 'Verify the native artifact and its provenance separately, then run and record physical-device tests.',
};

async function readCommand(args) {
  const directory = await mkdtemp(path.join(tmpdir(), 'wafra-iphone-readiness-'));
  const output = path.join(directory, 'device.json');
  try {
    // No shell, no install/launch/pair/unpair command, and no consumption of stdout.
    await execFileAsync('xcrun', ['devicectl', ...args, '--timeout', '15', '--json-output', output], {
      timeout: 20000, maxBuffer: 512 * 1024,
    });
    const stat = await lstat(output);
    if (!stat.isFile() || stat.size > MAX_JSON_BYTES) throw new Error('invalid_device_json');
    const raw = await readFile(output, 'utf8');
    return parseDevicectlJson(raw, args[0] === 'list' ? 'devicectl.list.devices' : 'devicectl.device.info.apps');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function inspectIphoneReadiness(options = {}, dependencies = {}) {
  const query = dependencies.readCommand || readCommand;
  const report = {
    schemaVersion: 1,
    observedAt: (dependencies.now || (() => new Date().toISOString()))(),
    state: 'inventory_read_failed',
    device: null,
    installedWafra: null,
    proof: { deviceEnumeration: 'unverified', appMetadata: 'unverified', freshNativeArtifact: 'unverified', installedSourceMatch: 'unverified', physicalTests: 'unverified' },
    launchReady: false,
    nextAction: ACTIONS.inventory_read_failed,
  };
  const finish = (state) => {
    report.state = state;
    report.nextAction = ACTIONS[state];
    return { report, exitCode: state === 'inspection_complete' ? 0 : 2 };
  };
  let data;
  try { data = await query(['list', 'devices']); } catch { return finish('inventory_read_failed'); }
  const selection = selectIphone15(data, options);
  if (selection.state !== 'invalid_inventory') report.proof.deviceEnumeration = 'observed';
  report.device = safeDevice(selection.device);
  if (selection.state !== 'selected') return finish(selection.state);
  if (report.device.osVersion === null) return finish('invalid_device_metadata');
  if (report.device.developerMode !== 'enabled') return finish('developer_mode_required');
  let appData;
  try {
    appData = await query(['device', 'info', 'apps', '--device', selection.device.identifier, '--bundle-id', BUNDLE_ID, '--include-default-apps']);
  } catch { return finish('app_read_failed'); }
  const installed = installedWafra(appData, options);
  report.installedWafra = installed.app;
  if (installed.app !== null) report.proof.appMetadata = 'observed';
  return finish(installed.state);
}

function parseArgs(args) {
  const options = {};
  const names = new Map([['--device', 'deviceId'], ['--expected-version', 'expectedVersion'], ['--expected-build', 'expectedBuild'], ['--output', 'output']]);
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === '--help' && args.length === 1) return { help: true };
    const name = names.get(option);
    const value = args[++index];
    if (!name || typeof value !== 'string' || value.length === 0 || value.startsWith('--') || options[name] !== undefined) throw new Error('invalid_arguments');
    options[name] = value;
  }
  if (options.deviceId !== undefined && !UUID.test(options.deviceId)) throw new Error('invalid_device_identifier');
  for (const name of ['expectedVersion', 'expectedBuild']) {
    if (options[name] !== undefined && !VERSION.test(options[name])) throw new Error('invalid_expected_version');
  }
  return options;
}

async function main(args) {
  try {
    const options = parseArgs(args);
    if (options.help) {
      process.stdout.write('Read-only iPhone 15 inspection. No installation, launch, trust or pairing changes.\nUsage: node scripts/release/iphone-test-readiness.mjs [--device COREDEVICE_UUID] [--expected-version VERSION] [--expected-build BUILD] [--output NEW_SAFE_RECEIPT.json]\nExit 0 means inspection completed; it does not establish native-build provenance or physical-test success. Incomplete inspection exits 2.\n');
      return;
    }
    if (options.output) {
      try { await lstat(options.output); throw new Error('output_exists'); } catch (error) {
        if (error.code !== 'ENOENT') throw new Error('output_unavailable');
      }
    }
    const { report, exitCode } = await inspectIphoneReadiness(options);
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (options.output) await writeFile(options.output, serialized, { flag: 'wx', mode: 0o600 });
    process.stdout.write(serialized);
    process.exitCode = exitCode;
  } catch {
    // Neither device-tool stderr nor caller input may expose private device data.
    process.stderr.write('Readiness check could not run. Check arguments and choose a new writable output file; existing files are never overwritten.\n');
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
