'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const load = require('../repair/load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const api = load(path.join(root, 'src/lib/ios-paged-setup.ts'), {}, { process: { env: {} } });
const now = Date.parse('2026-09-09T13:00:00Z');
const progress = { sessionId: 'PAGED-11111111-2222-4333-8444-555555555555', status: 'continue',
  checked: 100, accepted: 75, skipped: 25, createdAtMs: now - 1000, expiresAtMs: now - 1000 + 86400000 };
test('only authoritative bounded native progress can render; no raw text/capability passes through', () => {
  const actual = api.parsePagedHistoryProgress(JSON.stringify({ ...progress, authorizationSecret: 'must-not-leave-parser', raw: 'not-a-display-field' }), now);
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), progress);
  assert.equal(api.parsePagedHistoryProgress(null), null);
  for (const extra of [{ sessionId: 'PAGED../../wrong' }, { checked: -1 }, { skipped: 24 }, { status: 'success' },
    { accepted: true }, { expiresAtMs: now - 1 }, { checked: 1000001 }, { createdAtMs: now + 120000 }, { expiresAtMs: 0 }]) {
    assert.throws(() => api.parsePagedHistoryProgress(JSON.stringify({ ...progress, ...extra }), now));
  }
});
test('run link contains only the matching Shortcut name and local return routes', () => {
  const url = new URL(api.pagedHistoryRunUrl());
  assert.equal(url.protocol, 'shortcuts:');
  assert.equal(url.searchParams.get('name'), 'Wafra History v2');
  assert.equal(url.searchParams.get('x-error'), 'wafra://ios-paging-beta');
  assert.equal(url.searchParams.get('x-cancel'), 'wafra://ios-paging-beta');
  assert.equal([...url.searchParams].length, 3);
  assert.equal(api.pagedHistoryEnabled(), false);
  assert.equal(api.PAGED_HISTORY_INSTALL_URL, null);
  const beta = load(path.join(root, 'src/lib/ios-paged-setup.ts'), {}, { process: { env: {
    EXPO_PUBLIC_WAFRA_PAGED_HISTORY_BETA: '1',
    EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL: 'https://www.icloud.com/shortcuts/5bd032fe9a464af390ac1aae22af2f08',
  } } });
  assert.equal(beta.pagedHistoryEnabled(), true);
  assert.equal(beta.PAGED_HISTORY_INSTALL_URL, 'https://www.icloud.com/shortcuts/5bd032fe9a464af390ac1aae22af2f08');
});
test('production keeps paging UI off while every iOS binary retains the native paging intents', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'eas.json')));
  for (const key of ['WAFRA_PAGED_HISTORY_BETA', 'EXPO_PUBLIC_WAFRA_PAGED_HISTORY_BETA']) {
    assert.equal(config.build['history-beta'].env[key], '1');
    assert.equal(config.build.production.env[key], undefined);
  }
  const base = { name: 'Wafra', plugins: ['original'] };
  const factory = require(path.join(root, 'app.config.js'));
  assert.deepEqual(factory({ config: base }).plugins,
    ['original', './modules/wafra-message-history/plugin/paged']);
});
test('normal setup routes to bounded history without retiring the published original', () => {
  const screen = fs.readFileSync(path.join(root, 'src/app/ios-setup.tsx'), 'utf8');
  const paging = fs.readFileSync(path.join(root, 'src/app/ios-paging-beta.tsx'), 'utf8');
  assert.match(screen, /if \(pagedEnabled\).*pathname: '\/ios-paging-beta'/);
  assert.match(paging, /latest = parsePagedHistoryProgress\(await native.getPagedStatus\(\)\)/);
  assert.match(paging, /latest\.sessionId !== progress\?\.sessionId/);
  assert.match(paging, /ledger !== getStateGeneration\(\)/);
  assert.match(paging, /native.discardSession\(latest.sessionId\)/);
  assert.doesNotMatch(paging, /setOnboarded\(|importParsed\(|clearAll\(/);
  assert.ok(Object.keys(api.pagedHistoryCopy.en).every(key => api.pagedHistoryCopy.ar[key]));
});
