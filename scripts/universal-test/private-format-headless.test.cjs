const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sourceLoader = require('../test/repair/load-typescript.cjs');
const { createLoader } = require('./load-ts.cjs');
const root = path.resolve(__dirname, '../..');
const now = Date.parse('2026-10-12T12:00:00Z');
const source = 'Bank alert: account ending 1357. GBP 46.80 at CEDAR BAKERY. Date: 2026-10-10.';
function currentSource(name, load, overrides) {
  const file = path.join(root, 'src/lib', name + '.ts'); const dependencies = { ...overrides };
  for (const found of fs.readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    if (!Object.hasOwn(dependencies, found[1])) Object.defineProperty(dependencies, found[1], { enumerable: true, get: () => load(found[1]) });
  }
  return sourceLoader(file, dependencies);
}
async function harness(options = {}) {
  const load = createLoader(); const tasks = new Map(); const nativeAcks = [], scans = [], stored = new Map();
  const native = { isAvailable: () => true, isEnabled: () => true, isAdmissionActive: () => options.admission !== false,
    async getCaptured() { return [{ id: 'private-headless-notification-0001', pkg: 'com.example.alerts', title: '', text: source.replace('46.80', '73.25'),
      appLabel: 'Alerts', ts: now, sourceClass: 'financial-candidate' }]; }, async ackCaptured(ids) { nativeAcks.push(...ids); return true; } };
  const sms = { async getInboxSms() { return []; }, async getReceived() { return []; } };
  const rn = load('react-native'); rn.Platform.OS = 'android'; rn.AppState = { currentState: 'background' };
  rn.AppRegistry = { registerHeadlessTask(name, provider) { tasks.set(name, provider); } };
  load('expo-modules-core').requireOptionalNativeModule = name => name === 'SmsReader' ? sms : name === 'NotificationReader' ? native : null;
  load('expo-secure-store').__keychain.items.set('wafra.database.key.v1', 'a5'.repeat(32));
  const crypto = load('expo-crypto'); crypto.CryptoDigestAlgorithm = { SHA256: 'sha256' };
  crypto.digestStringAsync = async (_algorithm, text) => createHash('sha256').update(text).digest('hex');
  const formats = load('@/lib/private-alert-format-runtime'); let secret = null, keyReads = 0, keyWrites = 0, inCapture = false;
  const runtime = formats.createPrivateAlertFormatRuntime({ isNative: () => true,
    async readSecret() { keyReads++; if (inCapture) await options.beforeKeyRead?.(runtime); return secret; },
    async writeSecret(value) { keyWrites++; secret = value; }, async removeSecret() { secret = null; }, async randomBytes() { return new Uint8Array(32).fill(23); } });
  runtime.activate({ version: 1, templates: [] });
  const first = source.replace('2026-10-10', '2026-10-08');
  const created = await runtime.prepare({ source: first, sender: '', confirmed: { amountMinor: 4680, currency: 'GBP', exponent: 2, direction: 'debit',
    merchant: 'CEDAR BAKERY', date: '2026-10-08' }, context: { country: 'GB', dateOrder: 'DMY' }, now });
  assert.equal(created.ok, true, created.reason);
  const second = source.replace('46.80', '57.90').replace('CEDAR BAKERY', 'ASTER SHOP').replace('2026-10-10', '2026-10-09');
  const validated = await runtime.validate(created.template, second, '', { now, country: 'GB', dateOrder: 'DMY' });
  assert.equal(validated.ok, true, validated.reason);
  const templateStore = { version: 1, templates: [validated.template] };
  runtime.invalidate(); if (options.missingSecret) secret = null;
  let activations = 0, invalidations = 0;
  formats.activatePrivateAlertFormats = value => { activations++; runtime.activate(value); };
  formats.invalidatePrivateAlertFormats = () => { invalidations++; runtime.invalidate(); };
  formats.createPrivateAlertFormatSession = options => runtime.session(options);
  const tray = load('@/lib/alert-review-tray');
  const state = { onboarded: true, pro: options.pro !== false, trialStartTs: 1, captureOptOut: options.optOut ?? false, privateMode: true,
    marketId: 'ZZ', country: 'GB', language: 'en', bestEffortAutoPost: false, accounts: [], transactions: [], cardDues: [], bills: [], budgets: [], goals: [],
    statementCoverage: [], trustedNotificationPackages: [], localCaptureQualifications: [], reviewTray: tray.emptyAlertReviewTray(), merchantOverrides: {},
    accountHints: {}, billAliases: {}, lastScanTs: now - 86400000, ledgerMoney: { schemaVersion: 2, currency: 'GBP', exponent: 2 },
    androidCaptureSources: options.sources ?? { sms: true, notifications: true }, privateAlertFormats: templateStore };
  stored.set('wafra/state/v1', JSON.stringify(state)); let loads = 0, saves = 0;
  const storage = { async getItem(key) { loads++; await options.beforeLoad?.(); if (options.loadError) throw Error('storage locked'); return stored.get(key) ?? null; },
    async multiGet(keys) { return keys.map(key => [key, stored.get(key) ?? null]); },
    async multiSet(pairs) { saves++; for (const [key, value] of pairs) stored.set(key, value); },
    async multiRemove(keys) { for (const key of keys) stored.delete(key); },
    async removeItem(key) { stored.delete(key); } };
  const ai = load('@/lib/ai-alert-reader'); ai.createAiAlertReviewSession = () => ({ async read() { return null; } });
  const auto = load('@/lib/auto-import'); const scan = auto.scanInbox;
  auto.scanInbox = async (...args) => { if (options.scanError) throw Error('native scan unavailable'); const result = await scan(...args); scans.push(result); return result; };
  const executor = currentSource('capture-executor', load, { '@/lib/auto-import': auto, '@/lib/relay': {},
    '@/lib/capture': { collectNewMessages: () => { throw Error('explicit bounded collector required'); } } });
  const background = currentSource('android-live-background', load, { 'react-native': rn,
    '../../modules/notification-reader': { __esModule: true, default: native }, '../../modules/sms-reader': { __esModule: true, default: sms },
    '@/lib/auto-import': auto, '@/lib/capture-executor': executor,
    '@/lib/state-storage': { stateStorage: storage, migrateLegacyState: async () => false },
    '@/lib/notifications': { syncPaymentReminders: async () => {}, syncDailySummary: async () => {} },
    '@/lib/reminders': { reminderScheduleInputsChanged: () => false } });
  return { runtime, state, stored, templateStore, nativeAcks, scans,
    counts: () => ({ loads, saves, activations, invalidations, keyReads, keyWrites }),
    async run(source = 'push') { inCapture = true; return tasks.get('WafraLiveCapture')()({ source, observedAt: now }); },
    install(adapter) { return background.installAndroidLiveCaptureLedger(adapter); }, idle: background.waitForAndroidBackgroundCaptureIdle };
}
test('cold-process Headless capture activates validated formats only for its authoritative encrypted snapshot', async () => {
  const h = await harness(); const before = h.counts(); await h.run();
  assert.equal(h.scans.length, 1); assert.equal(h.scans[0].parsed.length, 0); assert.equal(h.scans[0].reviewCandidates.length, 1);
  const item = h.scans[0].reviewCandidates[0]; assert.equal(item.event.direction, 'debit'); assert.equal(item.event.status, 'unknown');
  assert.ok(item.event.issues.includes('learned-format')); assert.equal(item.event.amount.value.minorUnits, '7325');
  assert.deepEqual(h.nativeAcks, []); assert.equal(h.counts().keyWrites, before.keyWrites);
  assert.equal(h.counts().activations, 1); assert.equal(h.counts().invalidations, 1);
  assert.equal(await h.runtime.read(source, '', now, { country: 'GB' }), null);
  assert.ok([...h.stored.values()].every(value => !value.includes(source) && !value.includes('CEDAR BAKERY')));
});
for (const [name, options, wake = 'push'] of [
  ['opt-out', { optOut: true }], ['expired Pro', { pro: false }], ['source disabled', { sources: { sms: true, notifications: false } }],
  ['SMS admission lease inactive', { admission: false }, 'sms'],
]) test(`headless ${name} gate prevents format activation and secure matching`, async () => {
  const h = await harness(options); const before = h.counts(); await h.run(wake);
  assert.equal(h.counts().activations, 0); assert.equal(h.counts().invalidations, 0); assert.equal(h.scans.length, 0);
  assert.equal(h.counts().keyReads, before.keyReads); assert.equal(h.counts().keyWrites, before.keyWrites); assert.deepEqual(h.nativeAcks, []);
});
test('restored capsules without a device key abstain and never initialize one headlessly', async () => {
  const h = await harness({ missingSecret: true }); const before = h.counts(); await h.run();
  assert.equal(h.scans.length, 1); assert.equal(h.scans[0].reviewCandidates[0].event.direction, 'unknown');
  assert.ok(!h.scans[0].reviewCandidates[0].event.issues.includes('learned-format'));
  assert.equal(h.counts().keyWrites, before.keyWrites); assert.deepEqual(h.nativeAcks, []); assert.equal(h.counts().invalidations, 1);
});
test('a reset during headless device-key read invalidates the in-flight match', async () => {
  const h = await harness({ beforeKeyRead: async runtime => runtime.invalidate() }); await h.run();
  assert.equal(h.scans[0].reviewCandidates[0].event.direction, 'unknown'); assert.ok(!h.scans[0].reviewCandidates[0].event.issues.includes('learned-format'));
  assert.deepEqual(h.nativeAcks, []); assert.equal(h.counts().invalidations, 1);
});
test('native scan errors retire only the owned headless format view', async () => {
  const h = await harness({ scanError: true }); await assert.rejects(h.run(), /native scan unavailable/); await h.idle();
  assert.equal(h.counts().activations, 1); assert.equal(h.counts().invalidations, 1); assert.deepEqual(h.nativeAcks, []);
  assert.equal(await h.runtime.read(source, '', now, { country: 'GB' }), null);
});
test('locked encrypted storage cannot activate formats or access the device format key', async () => {
  const h = await harness({ loadError: true }); const before = h.counts(); await assert.rejects(h.run(), /storage locked/); await h.idle();
  assert.equal(h.counts().activations, 0); assert.equal(h.counts().invalidations, 0); assert.equal(h.scans.length, 0);
  assert.equal(h.counts().keyReads, before.keyReads); assert.deepEqual(h.nativeAcks, []);
});
test('borrowed foreground ledger retains its active format runtime after the background wake', async () => {
  const h = await harness(); h.runtime.activate(h.templateStore);
  const state = { ...h.state, hydrated: true, privateAlertFormats: { version: 1, templates: [] } };
  const adapter = { getState: () => state, getStateGeneration: () => 1,
    importBatch() { throw Error('learned Review cannot import money'); }, async ensureDurable() {} };
  const dispose = h.install(adapter); await h.run(); dispose();
  assert.equal(h.scans[0].reviewCandidates[0].event.direction, 'debit'); assert.equal(h.counts().loads, 0);
  assert.equal(h.counts().activations, 0); assert.equal(h.counts().invalidations, 0);
  assert.ok(await h.runtime.read(source, '', now, { country: 'GB' })); assert.deepEqual(h.nativeAcks, []);
});
test('a foreground adapter appearing during encrypted load keeps ownership of its format view', async () => {
  let entered, release; const started = new Promise(resolve => { entered = resolve; }); const gate = new Promise(resolve => { release = resolve; });
  const h = await harness({ beforeLoad: async () => { entered(); await gate; } });
  const pending = h.run(); await started;
  const state = { ...h.state, hydrated: true }; h.runtime.activate(h.templateStore);
  const dispose = h.install({ getState: () => state, getStateGeneration: () => 1,
    importBatch() { throw Error('new foreground owner must not import from stale headless disk'); }, async ensureDurable() {} });
  release(); await pending; dispose();
  assert.equal(h.scans.length, 0); assert.equal(h.counts().activations, 0); assert.equal(h.counts().invalidations, 0);
  assert.ok(await h.runtime.read(source, '', now, { country: 'GB' })); assert.deepEqual(h.nativeAcks, []);
});
