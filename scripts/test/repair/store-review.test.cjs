'use strict';
// The OS rating prompt (Google Play In-App Review, the App Store review
// request) through expo-store-review. Asked only after a good moment, from
// someone who has used the app on three separate days and has ten rows;
// at most once per app version, once every 120 days and three times in all;
// never behind App Lock, in the background, without the native prompt, or from
// onboarding, the paywall, Review, an error or a purchase.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const SOURCE = path.join(root, 'src/lib/store-review.ts');
const DAY = 86_400_000;
// Values built inside the module's VM context compare by shape, not realm.
const plain = (value) => JSON.parse(JSON.stringify(value));
const KEY = 'wafra/ui/store-review/v1';
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function harness({ platform = 'android', appState = 'active', version = '1.0.1', available = true, stored = null,
  getFails = false, setFails = false, importFails = false, requestFails = false } = {}) {
  const storage = new Map(stored === null ? [] : [[KEY, JSON.stringify(stored)]]);
  const calls = { requestReview: 0, isAvailable: 0, hasAction: 0, listeners: [] };
  const appStateModule = {
    currentState: appState,
    addEventListener(event, listener) { calls.listeners.push(listener); return { remove() {} }; },
  };
  const storeReview = {
    isAvailableAsync: async () => { calls.isAvailable += 1; return available; },
    hasAction: async () => { calls.hasAction += 1; return true; },
    requestReview: async () => { calls.requestReview += 1; if (requestFails) throw new Error('ReviewManager task failed'); },
  };
  const mod = load(SOURCE, {
    '@react-native-async-storage/async-storage': { __esModule: true, default: {
      getItem: async (key) => { if (getFails) throw new Error('read'); return storage.has(key) ? storage.get(key) : null; },
      setItem: async (key, value) => { if (setFails) throw new Error('write'); storage.set(key, value); },
    } },
    'expo-constants': { __esModule: true, default: { expoConfig: { version } } },
    'react-native': { AppState: appStateModule, Platform: { OS: platform } },
    '@/lib/format': { toISODate: isoDate },
    get 'expo-store-review'() {
      if (importFails) throw new Error("Cannot find native module 'ExpoStoreReview'");
      return storeReview;
    },
  });
  const memory = () => (storage.has(KEY) ? JSON.parse(storage.get(KEY)) : null);
  return { mod, calls, storage, memory, appState: appStateModule };
}

const pure = harness().mod;
const ready = { useDays: ['2026-11-01', '2026-11-05', '2026-11-09'], requests: [] };
const okInput = { onboarded: true, ledgerRows: 40, privacyGateCleared: true };

// ── Throttle ──────────────────────────────────────────────────────────────
test('the throttle allows a first request and then at most one per app version', () => {
  const now = Date.UTC(2026, 10, 27);
  assert.equal(pure.storeReviewThrottleAllows({ useDays: [], requests: [] }, '1.0.1', now), true);
  const once = { useDays: [], requests: [{ at: now - 400 * DAY, version: '1.0.1' }] };
  assert.equal(pure.storeReviewThrottleAllows(once, '1.0.1', now), false, 'never twice from one version, however long ago');
  assert.equal(pure.storeReviewThrottleAllows(once, '1.0.2', now), true);
});

test('the throttle keeps 120 days between requests, across versions', () => {
  const at = Date.UTC(2026, 0, 1);
  const memory = { useDays: [], requests: [{ at, version: '1.0.1' }] };
  assert.equal(pure.STORE_REVIEW_MIN_GAP_DAYS, 120);
  assert.equal(pure.storeReviewThrottleAllows(memory, '1.0.2', at + 119 * DAY), false);
  assert.equal(pure.storeReviewThrottleAllows(memory, '1.0.2', at + 120 * DAY - 1), false);
  assert.equal(pure.storeReviewThrottleAllows(memory, '1.0.2', at + 120 * DAY), true);
  // The newest request is the one measured from, whatever the stored order.
  const two = { useDays: [], requests: [{ at: at + 200 * DAY, version: '1.0.2' }, { at, version: '1.0.1' }] };
  assert.equal(pure.storeReviewThrottleAllows(two, '1.0.3', at + 250 * DAY), false);
});

test('the throttle never allows a fourth request, and fails closed when the clock went back', () => {
  const at = Date.UTC(2026, 0, 1);
  const three = { useDays: [], requests: [
    { at, version: '1.0.1' }, { at: at + 130 * DAY, version: '1.0.2' }, { at: at + 260 * DAY, version: '1.0.3' }] };
  assert.equal(pure.STORE_REVIEW_MAX_REQUESTS, 3);
  assert.equal(pure.storeReviewThrottleAllows(three, '9.9.9', at + 5000 * DAY), false);
  const one = { useDays: [], requests: [{ at, version: '1.0.1' }] };
  assert.equal(pure.storeReviewThrottleAllows(one, '1.0.2', at - DAY), false, 'a clock set back cannot prove the gap');
});

test('a stored memory is cleaned, and days of use are distinct and capped at the minimum', () => {
  assert.deepEqual(plain(pure.readStoreReviewMemory(null)), { useDays: [], requests: [] });
  assert.deepEqual(plain(pure.readStoreReviewMemory({ useDays: ['2026-11-01', '2026-11-01', 'x', 7], requests: [
    { at: 5, version: '1.0.1' }, { at: 'x', version: '1.0.1' }, { at: Number.NaN, version: '1' }, { at: 6 }, null] })),
  { useDays: ['2026-11-01'], requests: [{ at: 5, version: '1.0.1' }] });
  let memory = { useDays: [], requests: [] };
  memory = pure.withUseDay(memory, '2026-11-01');
  const same = pure.withUseDay(memory, '2026-11-01');
  assert.equal(same, memory, 'the same day twice is one day');
  assert.equal(pure.withUseDay(memory, 'not-a-day'), memory);
  memory = pure.withUseDay(pure.withUseDay(memory, '2026-11-02'), '2026-11-03');
  assert.deepEqual(plain(memory.useDays), ['2026-11-01', '2026-11-02', '2026-11-03']);
  assert.equal(pure.withUseDay(memory, '2026-11-04'), memory, 'nothing more is written once the minimum is met');
});

// ── Eligibility ───────────────────────────────────────────────────────────
test('only an onboarded person with three days of use and ten rows, in the foreground and unlocked, is eligible', () => {
  const ok = { onboarded: true, ledgerRows: 10, useDays: 3, privacyGateCleared: true, active: true };
  assert.equal(pure.STORE_REVIEW_MIN_USE_DAYS, 3);
  assert.equal(pure.STORE_REVIEW_MIN_ROWS, 10);
  assert.equal(pure.storeReviewEligible(ok), true);
  for (const [patch, why] of [
    [{ onboarded: false }, 'during onboarding'],
    [{ ledgerRows: 9 }, 'fewer than ten rows'],
    [{ useDays: 2 }, 'fewer than three days of use'],
    [{ useDays: 1 }, 'first launch'],
    [{ privacyGateCleared: false }, 'behind App Lock'],
    [{ active: false }, 'in the background'],
  ]) assert.equal(pure.storeReviewEligible({ ...ok, ...patch }), false, why);
});

test('a recap is a good moment only for a closed period that cost less than the one before', () => {
  const closed = { to: '2026-10-31', previousSpendFils: 500_00, spendChangeFils: -40_00 };
  assert.equal(pure.recapWentWell(closed, '2026-11-27'), true);
  assert.equal(pure.recapWentWell({ ...closed, to: '2026-11-30' }, '2026-11-27'), false, 'the period is not over');
  assert.equal(pure.recapWentWell({ ...closed, to: '2026-11-27' }, '2026-11-27'), false, 'it ends today');
  assert.equal(pure.recapWentWell({ ...closed, spendChangeFils: 0 }, '2026-11-27'), false, 'the same as before');
  assert.equal(pure.recapWentWell({ ...closed, spendChangeFils: 10_00 }, '2026-11-27'), false, 'more than before');
  assert.equal(pure.recapWentWell({ ...closed, previousSpendFils: 0 }, '2026-11-27'), false, 'nothing to compare with');
  assert.equal(pure.recapWentWell({ ...closed, previousSpendFils: null, spendChangeFils: null }, '2026-11-27'), false);
});

// ── The request itself ────────────────────────────────────────────────────
test('a due request asks the OS once, is counted before it is made, and is not repeated in the same version', async () => {
  const h = harness({ stored: ready });
  assert.equal(await h.mod.requestStoreReviewIfDue(okInput), true);
  assert.equal(h.calls.requestReview, 1);
  assert.equal(h.calls.isAvailable, 1, 'guarded by isAvailableAsync');
  assert.equal(h.calls.hasAction, 0, 'hasAction would be true for a store URL and open the store page instead');
  assert.equal(h.memory().requests.length, 1);
  assert.equal(h.memory().requests[0].version, '1.0.1');
  assert.equal(await h.mod.requestStoreReviewIfDue(okInput), false);
  assert.equal(h.calls.requestReview, 1);
});

test('no request on first launch, while locked, in the background, below the row minimum or before onboarding', async () => {
  for (const [options, input, why] of [
    [{ stored: null }, okInput, 'first launch: no days of use yet'],
    [{ stored: { ...ready, useDays: ready.useDays.slice(0, 2) } }, okInput, 'two days of use'],
    [{ stored: ready }, { ...okInput, privacyGateCleared: false }, 'App Lock is up'],
    [{ stored: ready, appState: 'background' }, okInput, 'background'],
    [{ stored: ready, appState: 'inactive' }, okInput, 'inactive'],
    [{ stored: ready }, { ...okInput, ledgerRows: 9 }, 'nine rows'],
    [{ stored: ready }, { ...okInput, onboarded: false }, 'onboarding'],
  ]) {
    const h = harness(options);
    assert.equal(await h.mod.requestStoreReviewIfDue(input), false, why);
    assert.equal(h.calls.requestReview, 0, why);
    assert.equal(h.memory()?.requests.length ?? 0, 0, `${why}: nothing counted`);
  }
});

test('never throws and never asks when the prompt is unavailable (web, Expo Go, no Play Store, TestFlight, no native module)', async () => {
  for (const [options, why] of [
    [{ platform: 'web' }, 'web'],
    [{ available: false }, 'isAvailableAsync false'],
    [{ importFails: true }, 'native module missing'],
    [{ getFails: true }, 'memory unreadable'],
    [{ setFails: true }, 'memory unwritable: an uncounted request is never made'],
  ]) {
    const h = harness({ stored: ready, ...options });
    assert.equal(await h.mod.requestStoreReviewIfDue(okInput), false, why);
    assert.equal(h.calls.requestReview, 0, why);
  }
  const failing = harness({ stored: ready, requestFails: true });
  assert.equal(await failing.mod.requestStoreReviewIfDue(okInput), false, 'a failed native task resolves');
  assert.equal(failing.memory().requests.length, 1, 'and still counts: the OS may have shown it');
});

test('the app coming to the foreground records the day of use, once a day', async () => {
  const h = harness();
  const stop = h.mod.startStoreReviewUseDays();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.memory().useDays, [isoDate(new Date())]);
  assert.equal(h.calls.listeners.length, 1);
  h.calls.listeners[0]('active');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.memory().useDays, [isoDate(new Date())]);
  stop();
  const web = harness({ platform: 'web' });
  web.mod.startStoreReviewUseDays()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(web.memory(), null);
  assert.equal(web.calls.listeners.length, 0);
});

// ── Call sites ────────────────────────────────────────────────────────────
function sourceFiles(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(entry.name) ? [rel] : [];
  });
}

test('the prompt is reachable only from statement import and the finished recap, never from an excluded screen', () => {
  const files = [...sourceFiles('src'), ...sourceFiles('modules')];
  const importers = files.filter((rel) => /from '@\/lib\/store-review'/.test(read(rel))).sort();
  assert.deepEqual(importers, ['src/app/recap.tsx', 'src/components/app-root-layout.tsx', 'src/components/supplement-imports.tsx']);
  const requesters = files.filter((rel) => rel !== 'src/lib/store-review.ts' && /requestStoreReviewIfDue\(/.test(read(rel))).sort();
  assert.deepEqual(requesters, ['src/app/recap.tsx', 'src/components/supplement-imports.tsx']);
  assert.doesNotMatch(read('src/components/app-root-layout.tsx'), /requestStoreReviewIfDue/, 'the root only counts days of use');
  const native = files.filter((rel) => /expo-store-review/.test(read(rel)));
  assert.deepEqual(native, ['src/lib/store-review.ts'], 'expo-store-review is used through the one module');
  const module = read('src/lib/store-review.ts');
  assert.doesNotMatch(module, /from 'expo-store-review'/, 'loaded lazily, so a missing native module cannot break startup');
  assert.match(module, /await import\('expo-store-review'\)/);
  // The screens the prompt must never appear from, named so a move is noticed.
  const excluded = files.filter((rel) => /(^src\/components\/onboarding\/|onboarding-gate|superwall|\/pro[-./]|src\/components\/pro\/|paywall|review-alerts|review-transfers|lock-gate|app-lock|purchases|billing|complimentary|founder|import-sms|settings-data)/.test(rel));
  assert.ok(excluded.length >= 10, `the exclusion pattern still matches the excluded screens (${excluded.length})`);
  for (const rel of excluded) assert.doesNotMatch(read(rel), /store-review|requestReview/, rel);
});

test('statement import asks only after it added rows, outside setup, with no error, filing or password step left', () => {
  const source = read('src/components/supplement-imports.tsx');
  assert.match(source, /const fromSetup = !!onboarding \|\| !!preview;/);
  assert.match(source, /if \(imported > 0 && !fromSetup\) importAddedRowsRef\.current = true;\n\s+setError\(null\);\n\s+setStatus\([^\n]+\n\s+committed\(\);\n\s+return true;/,
    'set only on the completed-and-durable path, before the result is shown');
  const effect = /useEffect\(\(\) => \{\n\s+if \(!importAddedRowsRef\.current \|\| busy !== null \|\| error !== null \|\| pendingPdfs\.length > 0\) return;\n\s+importAddedRowsRef\.current = false;[\s\S]*?requestStoreReviewIfDue\(\{ onboarded: ledger\.onboarded, ledgerRows: ledger\.transactions\.length,\n\s+privacyGateCleared: privacyGateRef\.current \}\);\n\s+\}, \[busy, error, getStateSnapshot, pendingPdfs\.length, status, summary\]\);/;
  assert.match(source, effect);
  assert.equal((source.match(/requestStoreReviewIfDue\(/g) ?? []).length, 1);
});

test('the recap asks only from Done on the last card, for a period that went well', () => {
  const screen = read('src/app/recap.tsx');
  assert.match(screen, /const finished = \(\) => \{\n\s+router\.back\(\);\n\s+if \(!recapWentWell\(snapshot, toISODate\(new Date\(\)\)\)\) return;\n\s+void requestStoreReviewIfDue\(\{ onboarded: state\.onboarded, ledgerRows: state\.transactions\.length, privacyGateCleared \}\);/);
  assert.match(screen, /onClose=\{\(\) => router\.back\(\)\} onDone=\{finished\}/, 'closing early (the X) never asks');
  assert.equal((screen.match(/requestStoreReviewIfDue\(/g) ?? []).length, 1);
  const story = read('src/components/recap/recap-story.tsx');
  assert.match(story, /onClose, onDone = onClose \}/);
  assert.match(story, /<FinaleScene \{\.\.\.props\} onDone=\{onDone\} \/>/);
  assert.match(story, /action=\{\{ icon: 'close', label: w\.close, onPress: onClose,/);
});

test('no Wafra dialog, copy, reward, analytics or network call comes with the prompt', () => {
  const module = read('src/lib/store-review.ts');
  for (const banned of [/from '@\/lib\/i18n'/, /Alert\b/, /fetch\(/, /trackGrowthEvent|analytics/, /Linking/, /ConfirmSheet|requestConsent/])
    assert.doesNotMatch(module, banned, String(banned));
  assert.ok(module.indexOf('isAvailableAsync()') < module.indexOf('requestReview()'), 'availability is checked first');
});

test('the dependency is the SDK 55 module and needs no config plugin', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.dependencies['expo-store-review'], /^~55\./);
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.packages['node_modules/expo-store-review']?.version.split('.')[0], '55');
  const plugins = JSON.parse(read('app.json')).expo.plugins ?? [];
  assert.ok(!plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-store-review'));
});
