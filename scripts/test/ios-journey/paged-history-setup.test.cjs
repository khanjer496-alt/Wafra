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
test('status revision, source-changed refusal and expiry are parsed conservatively', () => {
  const withRevision = api.parsePagedHistoryProgress(JSON.stringify({ ...progress, revision: 4 }), now);
  assert.equal(withRevision.revision, 4);
  assert.equal(withRevision.sourceChanged, undefined);
  assert.equal(api.parsePagedHistoryProgress(JSON.stringify({ ...progress, refusal: 'source-changed' }), now).sourceChanged, true);
  assert.equal(api.parsePagedHistoryProgress(JSON.stringify({ ...progress, status: 'complete', refusal: 'source-changed' }), now).sourceChanged, undefined);
  for (const extra of [{ revision: -1 }, { revision: 1.5 }, { revision: '4' }, { refusal: 'unauthorized' }, { refusal: true }]) {
    assert.throws(() => api.parsePagedHistoryProgress(JSON.stringify({ ...progress, ...extra }), now), JSON.stringify(extra));
  }
  // A consistent session past its lifetime is no session, not an error.
  assert.equal(api.parsePagedHistoryProgress(JSON.stringify(progress), progress.expiresAtMs), null);
  assert.equal(api.parsePagedHistoryProgress(JSON.stringify(progress), progress.expiresAtMs + 1), null);
});
test('the page block key follows the saved revision, not only the checked count', () => {
  const at = revision => api.parsePagedHistoryProgress(JSON.stringify({ ...progress, revision }), now);
  assert.notEqual(api.historyPageKey(at(5)), api.historyPageKey(at(6)));
  assert.equal(api.isHistoryPageBlocked(api.historyPageKey(at(5)), at(6)), false);
  assert.equal(api.isHistoryPageBlocked(api.historyPageKey(at(5)), at(5)), true);
  assert.equal(api.historyPageKey(api.parsePagedHistoryProgress(JSON.stringify(progress), now)), `${progress.sessionId}:${progress.checked}`);
});
test('run link contains only the matching Shortcut name and local return routes', () => {
  const url = new URL(api.pagedHistoryRunUrl());
  assert.equal(url.protocol, 'shortcuts:');
  assert.equal(url.searchParams.get('name'), 'Wafra-History-v2-typed-date.signed');
  assert.equal(url.searchParams.get('x-error'), 'wafra://ios-paging-beta?blocked=1');
  assert.equal(url.searchParams.get('x-cancel'), 'wafra://ios-paging-beta');
  assert.equal([...url.searchParams].length, 3);
  assert.equal(api.pagedHistoryEnabled(), false);
  assert.equal(api.PAGED_HISTORY_INSTALL_URL, null);
  const beta = load(path.join(root, 'src/lib/ios-paged-setup.ts'), {}, { process: { env: {
    EXPO_PUBLIC_WAFRA_PAGED_HISTORY_BETA: '1',
    EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL: 'https://www.icloud.com/shortcuts/bc30c7ae89d6494c9ef0aea1a666d72d',
  } } });
  assert.equal(beta.pagedHistoryEnabled(), true);
  assert.equal(beta.PAGED_HISTORY_INSTALL_URL, 'https://www.icloud.com/shortcuts/bc30c7ae89d6494c9ef0aea1a666d72d');
  // Production installs the verified paged record without the beta flag. The
  // paged surfaces (progress, resume, review) must follow the record the build
  // actually installs, or users run a paged Shortcut against the legacy UI.
  const production = load(path.join(root, 'src/lib/ios-paged-setup.ts'), {}, { process: { env: {
    EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL: 'https://www.icloud.com/shortcuts/bc30c7ae89d6494c9ef0aea1a666d72d',
  } } });
  assert.equal(production.pagedHistoryEnabled(), true);
  assert.equal(production.PAGED_HISTORY_INSTALL_URL, 'https://www.icloud.com/shortcuts/bc30c7ae89d6494c9ef0aea1a666d72d');
  const unverified = load(path.join(root, 'src/lib/ios-paged-setup.ts'), {}, { process: { env: {
    EXPO_PUBLIC_WAFRA_PAGED_HISTORY_BETA: '1',
    EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL: 'https://www.icloud.com/shortcuts/abcdef0123456789abcdef0123456789',
  } } });
  assert.equal(unverified.pagedHistoryEnabled(), true);
  assert.equal(unverified.PAGED_HISTORY_INSTALL_URL, null);
});
test('every iOS profile installs the windowed v6 record and retains the native paging intents', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'eas.json')));
  const v4 = 'https://github.com/khanjer496-alt/Wafra/releases/download/ios-history-v6-20260919/Wafra-History-v6.signed.shortcut';
  for (const profile of ['history-beta', 'production', 'ios-parity-device']) {
    assert.equal(config.build[profile].env.EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL, v4, profile);
  }
  // The paged surfaces follow the installed record, so the beta flag stays off.
  for (const key of ['WAFRA_PAGED_HISTORY_BETA', 'EXPO_PUBLIC_WAFRA_PAGED_HISTORY_BETA']) {
    assert.equal(config.build['history-beta'].env[key], '0');
  }
  const v4Setup = load(path.join(root, 'src/lib/ios-paged-setup.ts'), {}, { process: { env: { EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL: v4 } } });
  assert.equal(v4Setup.PAGED_HISTORY_SHORTCUT_NAME, 'Wafra-History-v6.signed');
  assert.equal(v4Setup.PAGED_HISTORY_INSTALL_URL, v4);
  assert.equal(v4Setup.pagedHistoryEnabled(), true);
  assert.equal(new URL(v4Setup.pagedHistoryRunUrl()).searchParams.get('name'), 'Wafra-History-v6.signed');
  const base = { name: 'Wafra', plugins: ['original'] };
  const factory = require(path.join(root, 'app.config.js'));
  assert.deepEqual(factory({ config: base }).plugins,
    ['original', './modules/wafra-message-history/plugin/paged', './modules/wafra-high-refresh/plugin']);
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
