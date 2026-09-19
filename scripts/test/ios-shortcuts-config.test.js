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
// The typed-date v4 graph: Apple-signed on a Mac, published as a release asset,
// installed by Apple under the file basename `Wafra-History-v4.signed`.
const expectedHistory = 'https://github.com/khanjer496-alt/Wafra/releases/download/ios-history-v6-20260919/Wafra-History-v6.signed.shortcut';
const expectedLive = 'https://www.icloud.com/shortcuts/822bcc1dd2964b9f887ef9b93601441d';
for (const profile of ['history-beta', 'production', 'ios-parity-device']) {
  if (eas.build?.[profile]?.env?.EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL !== expectedHistory) {
    throw new Error(`${profile} must install the windowed v6 signed History Shortcut`);
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
const historySetup = readFileSync(path.join(__dirname, '../../src/lib/ios-history-setup.ts'), 'utf8');
if (!historySetup.includes('IOS_HISTORY_V6_URL') || !historySetup.includes(expectedHistory)) {
  throw new Error('the app must explicitly whitelist the exact signed v6 release asset');
}
const pagedSetup = readFileSync(path.join(__dirname, '../../src/lib/ios-paged-setup.ts'), 'utf8');
if (!pagedSetup.includes(expectedHistory) || !pagedSetup.includes("'Wafra-History-v6.signed'")) {
  throw new Error('the paged module must run the name Apple installs for the v4 asset');
}

console.log('ios-shortcuts-config.test.js: 7 passed');
