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
const expectedBaseline = 'https://github.com/khanjer496-alt/Wafra/releases/download/ios-history-baseline-200-20260917/Wafra-History-Baseline-200.signed.shortcut';
const expectedLive = 'https://www.icloud.com/shortcuts/822bcc1dd2964b9f887ef9b93601441d';
if (historyBeta.EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL !== expectedBaseline) {
  throw new Error('history-beta must install the physically proven Baseline-200 signed Shortcut');
}
if (historyBeta.EXPO_PUBLIC_WAFRA_SHORTCUT_URL !== expectedLive) {
  throw new Error('history-beta must keep the current Wafra Capture v2 Shortcut');
}
if (historyBeta.WAFRA_PAGED_HISTORY_BETA !== '0' || historyBeta.EXPO_PUBLIC_WAFRA_PAGED_HISTORY_BETA !== '0') {
  throw new Error('Baseline-200 testing must keep paged history disabled');
}
const historySetup = readFileSync(path.join(__dirname, '../../src/lib/ios-history-setup.ts'), 'utf8');
if (!historySetup.includes('IOS_HISTORY_BASELINE_200_URL') || !historySetup.includes(expectedBaseline)) {
  throw new Error('the app must explicitly whitelist the exact signed Baseline-200 release asset');
}

console.log('ios-shortcuts-config.test.js: 5 passed');
