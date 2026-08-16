import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  ASC_CLI_VERSION,
  buildAppStoreConnectPlan,
} from './lib/app-store-connect-cli.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => readFile(path.join(root, file), 'utf8').then(JSON.parse);
const [appConfig, easConfig] = await Promise.all([readJson('app.json'), readJson('eas.json')]);
const context = {
  appId: easConfig.submit?.production?.ios?.ascAppId,
  version: appConfig.expo?.version,
  metadataDir: path.join(root, 'artifacts', 'store-package', 'apple', 'asc-metadata'),
  screenshotsDir: path.join(root, 'artifacts', 'store-package', 'apple', 'screenshots'),
};

const fail = (message) => {
  console.error(`App Store Connect workflow failed: ${message}`);
  process.exit(1);
};

if (!context.appId || !context.version) {
  fail('eas.json must define submit.production.ios.ascAppId and app.json must define expo.version.');
}

const ascEnv = {
  ...process.env,
  ASC_APP_ID: context.appId,
  ASC_STRICT_AUTH: 'true',
  ASC_TELEMETRY_DISABLED: process.env.ASC_TELEMETRY_DISABLED ?? '1',
};
if (ascEnv.ASC_KEY_FILE && !ascEnv.ASC_PRIVATE_KEY_PATH) {
  ascEnv.ASC_PRIVATE_KEY_PATH = ascEnv.ASC_KEY_FILE;
}

const run = (args, options = {}) => spawnSync('asc', args, {
  cwd: root,
  env: ascEnv,
  encoding: options.encoding,
  stdio: options.encoding ? 'pipe' : 'inherit',
});

const versionResult = run(['version'], { encoding: 'utf8' });
if (versionResult.error?.code === 'ENOENT') {
  fail(`asc is not installed. Install version ${ASC_CLI_VERSION} with: brew install asc`);
}
if (versionResult.status !== 0) {
  fail(versionResult.stderr?.trim() || 'asc version could not be read.');
}
const installedVersion = versionResult.stdout.trim().match(/^\d+\.\d+\.\d+/)?.[0];
if (installedVersion !== ASC_CLI_VERSION) {
  fail(`asc ${ASC_CLI_VERSION} is required; found ${installedVersion ?? 'an unknown version'}.`);
}

const task = process.argv[2] ?? 'help';
if (task === 'check') {
  console.log(`asc ${installedVersion} is installed. Wafra app ${context.appId}, version ${context.version}.`);
  process.exit(0);
}

const plan = buildAppStoreConnectPlan(task, context);
if (!plan) {
  fail('unknown task. Use check, auth, auth-doctor, diagnose, feedback, subscriptions-audit, metadata-validate, metadata-preview, metadata-apply, screenshots-preview, or screenshots-apply.');
}

for (const requiredPath of plan.requiredPaths ?? []) {
  try {
    await access(requiredPath);
  } catch {
    fail(`required generated path is missing: ${requiredPath}`);
  }
}

if (plan.confirmation && process.env.WAFRA_ASC_CONFIRM !== plan.confirmation) {
  fail(`live writes are blocked. Set WAFRA_ASC_CONFIRM=${plan.confirmation} for this command only.`);
}

for (const step of plan.commands) {
  console.log(`\n${step.label}`);
  const result = run(step.args);
  if (result.error) fail(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
