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
const expectedHistory = 'https://github.com/khanjer496-alt/Wafra/releases/download/ios-history-v4-20260919/Wafra-History-v4.signed.shortcut';
const expectedLive = 'https://www.icloud.com/shortcuts/822bcc1dd2964b9f887ef9b93601441d';
for (const profile of ['history-beta', 'production', 'ios-parity-device']) {
  if (eas.build?.[profile]?.env?.EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL !== expectedHistory) {
    throw new Error(`${profile} must install the typed-date v4 signed History Shortcut`);
  }
}
if (historyBeta.EXPO_PUBLIC_WAFRA_SHORTCUT_URL !== expectedLive) {
  throw new Error('history-beta must keep the current Wafra Capture v2 Shortcut');
}
const historySetup = readFileSync(path.join(__dirname, '../../src/lib/ios-history-setup.ts'), 'utf8');
if (!historySetup.includes('IOS_HISTORY_V4_URL') || !historySetup.includes(expectedHistory)) {
  throw new Error('the app must explicitly whitelist the exact signed v4 release asset');
}
const pagedSetup = readFileSync(path.join(__dirname, '../../src/lib/ios-paged-setup.ts'), 'utf8');
if (!pagedSetup.includes(expectedHistory) || !pagedSetup.includes("'Wafra-History-v4.signed'")) {
  throw new Error('the paged module must run the name Apple installs for the v4 asset');
}

console.log('ios-shortcuts-config.test.js: 5 passed');
