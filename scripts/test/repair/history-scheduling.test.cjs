'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');

// Isolate scheduling from parser speed with an explicit deterministic grammar
// stub. The real scanner must still preserve every ordered result and count.
async function scan(initialState, returnToForegroundAt = Infinity) {
  const appState = { currentState: initialState };
  let parsed = 0, yields = 0;
  const sliceEnds = [];
  class Clock extends Date { static now() { return 2000000; } }
  const batch = Array.from({ length: 950 }, (_, i) => ({ id: 950 - i, date: 1000000 - i,
    address: 'SYNTHETIC', body: `Synthetic record ${i}` }));
  const scanner = load(path.join(root, 'src/lib/auto-import.ts'), {
    '@/lib/capture-trace': load(path.join(root, 'src/lib/capture-trace.ts')),
    'react-native': { Platform: { OS: 'android' }, AppState: appState },
    'expo-crypto': {}, 'expo-secure-store': {},
    '../../modules/notification-reader': { __esModule: true, default: null },
    '../../modules/sms-reader': { __esModule: true, default: { getInboxSms: async () => batch } },
    '@/lib/alert-review-tray': {}, '@/lib/format': { toISODate: () => '2026-09-01' },
    '@/lib/dedupe': { bodyPrint: value => value }, '@/lib/sms-parser': {},
    '@/lib/launch-alert-parser': { createLaunchAlertSession: () => ({
      inspect: () => null, detectedMarket: () => null,
      parse: body => {
        parsed++;
        if (parsed === returnToForegroundAt) appState.currentState = 'active';
        return { kind: 'transaction', type: 'expense', categoryGuess: 'dining', title: body, amountFils: 12345 };
      },
    }) },
    '@/lib/unparsed-launch-alert': {}, '@/lib/trusted-bank-notification-packages': {}, '@/lib/import-plan': {},
  }, { Date: Clock, setTimeout: callback => { yields++; sliceEnds.push(parsed); callback(); return yields; } });
  const result = await scanner.scanInbox(0, {}, undefined, null, { maxInboxPages: 1 });
  return { rows: JSON.parse(JSON.stringify(result.parsed)), scanned: result.scannedCount,
    complete: result.inboxHistoryComplete, yields, sliceEnds };
}
test('off-screen parsing uses fewer scheduler turns without changing any result', async () => {
  const foreground = await scan('active'), background = await scan('background');
  assert.deepEqual(foreground.rows, background.rows);
  assert.equal(foreground.rows.length, 950); assert.equal(background.scanned, 950);
  assert.equal(foreground.complete, true); assert.equal(background.complete, true);
  assert.equal(foreground.yields, 14); assert.equal(background.yields, 3);
});
test('returning to the foreground immediately restores the interactive slice budget', async () => {
  const result = await scan('background', 100);
  assert.equal(result.sliceEnds[0], 100);
  assert.equal(result.sliceEnds[1] - result.sliceEnds[0], 64);
  assert.deepEqual(result.rows, (await scan('active')).rows);
});
