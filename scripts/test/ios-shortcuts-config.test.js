#!/usr/bin/env node

const { readFileSync } = require('node:fs');
const path = require('node:path');

const app = JSON.parse(readFileSync(path.join(__dirname, '../../app.json'), 'utf8'));
const schemes = app.expo?.ios?.infoPlist?.LSApplicationQueriesSchemes;

if (!Array.isArray(schemes) || !schemes.includes('shortcuts')) {
  throw new Error(
    'iOS Shortcut availability checks require LSApplicationQueriesSchemes to include "shortcuts"',
  );
}

const eas = JSON.parse(readFileSync(path.join(__dirname, '../../eas.json'), 'utf8'));
const historyBeta = eas.build?.['history-beta']?.env ?? {};
const expectedLive = 'https://www.icloud.com/shortcuts/822bcc1dd2964b9f887ef9b93601441d';
// The repository is private, so its release assets cannot be downloaded by
// customers. The app installs the History Shortcut bundled in the binary.
const privateRepoAsset = /github\.com\/khanjer496-alt\/Wafra|raw\.githubusercontent\.com\/khanjer496-alt\/Wafra/;
for (const [profile, build] of Object.entries(eas.build ?? {})) {
  if (privateRepoAsset.test(JSON.stringify(build?.env ?? {}))) {
    throw new Error(`${profile} must not download a Shortcut from the private repository`);
  }
}
if (historyBeta.EXPO_PUBLIC_WAFRA_SHORTCUT_URL !== expectedLive) {
  throw new Error('history-beta must keep the current Wafra Capture v2 Shortcut');
}
const production = eas.build?.production?.env ?? {};
if (production.EXPO_PUBLIC_WAFRA_SHORTCUT_URL !== expectedLive ||
    production.EXPO_PUBLIC_WAFRA_SHORTCUT_SETUP_CHECK_VERSION !== '1') {
  throw new Error('production must install the verified Capture v2 graph with its matching setup-check branch');
}
if (eas.build?.['production-candidate']?.extends !== 'production') {
  throw new Error('production-candidate must inherit the same published Shortcut configuration');
}
for (const file of ['src/lib/ios-history-setup.ts', 'src/lib/ios-paged-setup.ts', 'src/lib/relay.ts']) {
  if (privateRepoAsset.test(readFileSync(path.join(__dirname, '../..', file), 'utf8'))) {
    throw new Error(`${file} must not install a Shortcut from the private repository`);
  }
}
const resources = path.join(__dirname, '../../modules/wafra-live-capture/ios/Resources');
for (const name of ['Wafra Capture v3', 'Wafra History v8', 'Wafra Apple Pay v1', 'Wafra Notifications v1']) {
  if (readFileSync(path.join(resources, `${name}.shortcut`)).byteLength === 0) {
    throw new Error(`the app must bundle ${name}.shortcut`);
  }
}

console.log('ios-shortcuts-config.test.js: 5 passed');
