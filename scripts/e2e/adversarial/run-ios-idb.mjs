#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const deviceId = process.env.DEVICE_ID;
const appPath = process.env.APP_PATH;
const bundleId = process.env.APP_ID ?? 'app.wafra.ios';
const screenshotPath = resolve(
  process.env.SCREENSHOT_PATH ?? 'artifacts/adversarial-ios-signed-manual-home.png',
);

if (!deviceId || !appPath) {
  throw new Error('DEVICE_ID and APP_PATH are required');
}

const run = (command, args, options = {}) => execFileSync(command, args, {
  encoding: 'utf8',
  stdio: options.quiet ? 'ignore' : ['ignore', 'pipe', 'pipe'],
});

const sleep = (milliseconds) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

const elements = () => JSON.parse(run('idb', [
  'ui',
  'describe-all',
  '--udid',
  deviceId,
  '--json',
]));

const findExact = (label) => elements().find((element) => element.AXLabel === label);

const waitFor = (label, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const element = findExact(label);
    if (element) return element;
    sleep(250);
  }
  throw new Error(`Timed out waiting for ${JSON.stringify(label)}`);
};

const tap = (label) => {
  const element = waitFor(label);
  if (!element.enabled) throw new Error(`${JSON.stringify(label)} is disabled`);
  const x = Math.round(element.frame.x + element.frame.width / 2);
  const y = Math.round(element.frame.y + element.frame.height / 2);
  run('idb', ['ui', 'tap', String(x), String(y), '--udid', deviceId]);
};

const assertAbsent = (label) => {
  if (findExact(label)) throw new Error(`Unexpectedly found ${JSON.stringify(label)}`);
};

try {
  run('xcrun', ['simctl', 'boot', deviceId], { quiet: true });
} catch {
  // `simctl boot` returns non-zero when the selected simulator is already up.
}
run('xcrun', ['simctl', 'bootstatus', deviceId, '-b'], { quiet: true });
try {
  run('xcrun', ['simctl', 'uninstall', deviceId, bundleId], { quiet: true });
} catch {
  // A clean simulator may not have Wafra installed yet.
}
run('xcrun', ['simctl', 'install', deviceId, appPath], { quiet: true });
run('xcrun', ['simctl', 'launch', deviceId, bundleId], { quiet: true });

waitFor('Set up Wafra');
tap('Set up Wafra');
waitFor('Choose your message access.');
tap('Maximum privacy · no Messages access');
waitFor('Ready when you are.');
tap('Open Wafra');
waitFor('Automatic capture. Connect your Shortcut once. One-time setup in Apple Shortcuts');
waitFor('Check alerts');
waitFor('Add manually');
assertAbsent('Watching bank alerts');

mkdirSync(dirname(screenshotPath), { recursive: true });
run('xcrun', ['simctl', 'io', deviceId, 'screenshot', screenshotPath]);
console.log(`iOS signed startup + semantic onboarding passed: ${screenshotPath}`);
