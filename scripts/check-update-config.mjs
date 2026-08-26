import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const environmentIndex = process.argv.indexOf('--environment');
const environment = environmentIndex >= 0 ? process.argv[environmentIndex + 1] : null;
const failures = [];

const readJson = async (relative) => JSON.parse(
  await readFile(path.join(root, relative), 'utf8'),
);

const [app, eas, pkg] = await Promise.all([
  readJson('app.json'),
  readJson('eas.json'),
  readJson('package.json'),
]);

const expo = app.expo ?? {};
const projectId = expo.extra?.eas?.projectId;
const expectedUrl = `https://u.expo.dev/${projectId}`;
const fail = (message) => failures.push(message);

if (!pkg.dependencies?.['expo-updates']?.startsWith('~55.')) {
  fail('expo-updates must be installed at the Expo SDK 55-compatible version.');
}
if (expo.runtimeVersion?.policy !== 'fingerprint') {
  fail('expo.runtimeVersion.policy must be "fingerprint" for Wafra\'s custom native modules.');
}
if (expo.updates?.url !== expectedUrl) {
  fail(`expo.updates.url must be ${expectedUrl}.`);
}
if (expo.updates?.enabled !== true || expo.updates?.checkAutomatically !== 'ON_LOAD') {
  fail('EAS Update must be enabled and configured to check ON_LOAD.');
}
if (!Number.isInteger(expo.updates?.fallbackToCacheTimeout) ||
    expo.updates.fallbackToCacheTimeout < 0 ||
    expo.updates.fallbackToCacheTimeout > 2000) {
  fail('fallbackToCacheTimeout must be between 0 and 2000ms; never block ledger startup for 10 seconds.');
}

for (const [profile, channel, easEnvironment] of [
  ['preview', 'preview', 'preview'],
  ['corpus-preview', 'corpus-preview', 'preview'],
  ['capture-beta', 'capture-beta', 'preview'],
  ['production-candidate', 'production-candidate', 'production'],
  ['production', 'production', 'production'],
]) {
  const config = eas.build?.[profile];
  if (!config || config.channel !== channel || config.environment !== easEnvironment) {
    fail(`eas.json build.${profile} must use channel "${channel}" and environment "${easEnvironment}".`);
  }
}

if (eas.build?.['production-candidate']?.extends !== 'production') {
  fail('production-candidate must extend production so both builds have the same native runtime.');
}

if (environment) {
  if (environment !== 'production') fail('OTA release checks only accept the production EAS environment.');

  for (const [name, expected] of [
    ['EXPO_PUBLIC_WAFRA_FOUNDER_UNLOCK', '0'],
    ['EXPO_PUBLIC_WAFRA_PARSER_RESEARCH', '0'],
    ['EXPO_PUBLIC_WAFRA_SMS_CORPUS_EXPORT', '0'],
    ['WAFRA_SMS_CORPUS_EXPORT', '0'],
  ]) {
    if (process.env[name] !== expected) {
      fail(`${name} must exist in the EAS production environment and equal "${expected}".`);
    }
  }

  const requireHttps = (name, host, pathPattern) => {
    try {
      const url = new URL(process.env[name]);
      if (url.protocol !== 'https:' ||
          (host && url.hostname !== host) ||
          (pathPattern && !pathPattern.test(url.pathname)) ||
          url.search || url.hash || url.username || url.password) throw new Error();
    } catch {
      fail(`${name} must be a valid${host ? ` ${host}` : ''} HTTPS URL in the EAS production environment.`);
    }
  };
  requireHttps('EXPO_PUBLIC_WAFRA_RELAY_URL');
  const shortcutPath = /^\/shortcuts\/[0-9a-f]{32}$/i;
  requireHttps('EXPO_PUBLIC_WAFRA_SHORTCUT_URL', 'www.icloud.com', shortcutPath);
  requireHttps('EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL', 'www.icloud.com', shortcutPath);
  let captureId;
  try {
    captureId = new URL(process.env.EXPO_PUBLIC_WAFRA_SHORTCUT_URL).pathname
      .match(shortcutPath)?.[0]?.split('/').pop()?.toLowerCase();
  } catch {
    // The URL-shape finding above is the actionable error.
  }
  if (new Set([
    '03d2ab22a33f4fef9d503142575a70fb',
    '85bd1e080e5849b591049eccffb9a3a1',
  ]).has(captureId)) {
    fail('EXPO_PUBLIC_WAFRA_SHORTCUT_URL points to a retired Capture artifact.');
  }
  if (process.env.EXPO_PUBLIC_WAFRA_SHORTCUT_URL === process.env.EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL) {
    fail('Capture and History must use distinct published Shortcut artifacts.');
  }
}

if (failures.length) {
  console.error('Wafra OTA configuration is not safe to publish:\n');
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

console.log(`Wafra OTA configuration is valid${environment ? ` for the ${environment} environment` : ''}.`);
