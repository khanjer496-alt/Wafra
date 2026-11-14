'use strict';
// Android RC 396 F1: on a fresh install, ONE balance SMS ("ADCB: Your account
// balance is AED 12,345.67 as on 13/11/2026.") stopped the first inbox import
// for ever. On the device that message became a retention-required Review item
// (unknown/unknown) that the tray REFUSED, so commitPage paused the page as
// review-capacity, saved nothing, and every retry was refused again.
// App QA Lead's 9-message synthetic inbox: six plain AED purchases, a cashback
// offer, a loan offer and the balance message.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { createHash } = require('node:crypto');
const load = require('./load-typescript.cjs');

const BUILD = path.resolve(__dirname, '../build');
const INBOX = [
  ['ENBD', 'Purchase of AED 37.45 with Debit Card ending 1234 at QA MART on 13-NOV-2026 10:05. Avl Bal AED 5,123.40.'],
  ['ADCB', 'ADCB: AED 120.00 spent on Card ending 5678 at WAFRA TEST CAFE, DUBAI on 13/11/2026 11:12. Available limit AED 9,880.00'],
  ['FAB', 'Your FAB Card ending 4455 was used for AED 85.50 at DEMO PHARMACY on 13-Nov-26 12:30.'],
  ['MASHREQ', 'Mashreq Credit Card ending 1234: AED 640.00 spent at SAMPLE FUEL STATION. Avail credit AED 4,360.00.'],
  ['ENBD', 'AED 1,234.56 debited from your card ending 1234 at QA APPLIANCES on 13-NOV-2026 13:40.'],
  ['ADCB', 'ADCB: AED 15.00 debited from Account ending 9876 at SAMPLE KIOSK on 13/11/2026 09:10. Balance AED 3,210.00.'],
  ['MASHREQ', 'Get 5% cashback up to AED 200.00 on dining this month at selected outlets. T&C apply.'],
  ['ENBD', 'Pre-approved personal loan up to AED 50,000.00 is waiting for you. Call now to apply.'],
  ['ADCB', 'ADCB: Your account balance is AED 12,345.67 as on 13/11/2026.'],
];

function installScanner() {
  const now = Date.now();
  const rows = INBOX.map(([address, body], index) => ({ id: index + 1, address, body, date: now - (INBOX.length - index) * 60_000 }));
  const stub = (name, value) => {
    const resolved = require.resolve(path.join(BUILD, name));
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, default: value }, children: [], paths: [] };
  };
  stub('sms-reader.js', {
    async getInboxSms(sinceMs, beforeDateMs, beforeId, max) {
      return rows.filter(r => r.date >= sinceMs && (r.date < beforeDateMs || (r.date === beforeDateMs && r.id < beforeId)))
        .sort((a, b) => b.date - a.date || b.id - a.id).slice(0, max);
    },
    async getReceived() { return []; },
  });
  stub('notification-reader.js', { isAvailable: () => false, isEnabled: () => false, async getCaptured() { return []; },
    async ackCaptured() { return true; }, async clearCaptured() { return true; } });
  const crypto = require(path.join(BUILD, 'stub-expo-crypto.js'));
  crypto.CryptoDigestAlgorithm = { SHA256: 'sha256' };
  crypto.digestStringAsync = async (_algorithm, data) => createHash('sha256').update(data, 'utf8').digest('hex');
  require(path.join(BUILD, 'stub-secure-store.js')).__keychain.items.set('wafra.database.key.v1', 'a5'.repeat(32));
  require(path.join(BUILD, 'stub-react-native.js')).Platform.OS = 'android';
  const markets = require(path.join(BUILD, 'markets.js'));
  markets.setLedgerCurrency('AED');
  markets.setActiveMarket('AE');
  return require(path.join(BUILD, 'auto-import.js')).scanInbox;
}

const tray = require(path.join(BUILD, 'alert-review-tray.js'));

/** The real useHistoryImport commitPage, with the real tray admission and receipts. */
function historyCommit(page, { refuse = () => false } = {}) {
  const events = [];
  let state = { historyImport: { status: 'paused' }, marketId: 'AE', merchantOverrides: {}, hydrated: true, onboarded: true,
    captureOptOut: false, reviewTray: tray.emptyAlertReviewTray() };
  let dependencies;
  const store = {
    state, getStateSnapshot: () => state, getStateGeneration: () => 1, setHistoryImportProgress: async () => {}, setMarket: () => true,
    stageReviewAlerts: (items, _q, _b, mode) => {
      events.push('review');
      const admitted = tray.admitPreparedReviewAlerts(state.reviewTray, items.filter(item => !refuse(item)), Date.now(), mode);
      state = { ...state, reviewTray: admitted.state };
      return { admitted: admitted.outcomes.filter(o => o === 'admitted').length, durable: Promise.resolve(),
        retention: () => items.map(item => refuse(item)
          ? { sourceKey: tray.reviewSourceKeyOf(item), outcome: 'refused' }
          : tray.reviewRetentionReceipts(state.reviewTray, [item], Date.now())[0]),
        retainedSourceKeys: () => tray.reviewClaimSourceKeys(state.reviewTray, Date.now()) };
    },
    importBatch: (batch) => { events.push('ledger:' + batch.transactions.length); return { durable: Promise.resolve() }; },
  };
  const hook = load(path.resolve(__dirname, '../../../src/hooks/use-history-import.ts'), {
    react: { useMemo: f => f(), useCallback: f => f, useEffect() {}, useRef: value => ({ current: value }) },
    'react-native': { Platform: { OS: 'android' }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    '@/lib/capture-source-identity': require(path.join(BUILD, 'capture-source-identity.js')),
    '@/lib/alert-review-tray': tray,
    '@/lib/review-source-bindings': { collectLegacyReviewSourceKeys: () => [] },
    '@/lib/auto-import': { hasSmsPermission: async () => true, isSmsInboxAccessError: () => false, scanInbox: async () => page,
      buildImportPlan: (rows) => ({ batch: { transactions: rows.map((row, i) => ({ id: 'tx' + i, ...row })) } }) },
    '@/lib/android-capture-sources': { androidSmsCaptureEnabled: () => true },
    '@/lib/history-import': { subscribeHistoryImportRequest: () => () => {}, createHistoryImportCoordinator: value => { dependencies = value; return { run() {} }; } },
    '@/lib/android-history-background': { historyBackground: { canContinue: () => true, run: job => job(), cancel() {} } },
    '@/lib/purchases': { isProActive: () => true },
    '@/lib/launch-performance': { markLaunchPhase() {} },
    '@/lib/foreground-history-priority': { waitForForegroundHistoryIdle: async () => {} },
    '@/lib/store': { useStore: () => store },
  }, { setTimeout: fn => { fn(); return 1; } });
  hook.useHistoryImport();
  const next = { status: 'complete', cursor: null };
  return { events, commit: () => dependencies.commitPage({ ...page, commit: async () => events.push('ack') }, next, () => true) };
}

test('the 9-message inbox with one balance SMS commits its six purchases on the first import', async () => {
  const scanInbox = installScanner();
  const page = await scanInbox(0, {}, undefined, undefined, { cursor: null, pageSize: 128, legacyReviewSourceKeys: [],
    historyRepair: true, knownReviewSourceKeys: [], includeNotificationQueue: false });
  assert.equal(page.scannedCount, 9);
  assert.equal(page.parsed.length, 6, 'the six plain purchases parse');
  assert.equal(page.deferredInboxReviews ?? false, false);
  const h = historyCommit(page);
  assert.equal(await h.commit(), true, 'the page commits; nothing pauses');
  assert.ok(h.events.includes('ledger:6'), JSON.stringify(h.events));
});

test('as on the device: the balance SMS is a retention-required item the tray refuses, and the purchases still commit', async () => {
  const scanInbox = installScanner();
  const page = await scanInbox(0, {}, undefined, undefined, { cursor: null, pageSize: 128, legacyReviewSourceKeys: [],
    historyRepair: true, knownReviewSourceKeys: [], includeNotificationQueue: false });
  const balance = page.reviewCandidates.find(item => item.event?.family === 'balance');
  assert.ok(balance, 'the balance SMS reaches Review');
  // Device reading (variant E log): family unknown, status unknown, decision review.
  const deviceBalance = { ...balance, event: { ...balance.event, family: 'unknown', status: 'unknown' } };
  assert.equal(tray.requiresReviewRetention(deviceBalance), true, 'unknown/unknown is retention-required');
  const devicePage = { ...page, reviewCandidates: page.reviewCandidates.map(item => item === balance ? deviceBalance : item) };
  const h = historyCommit(devicePage, { refuse: item => item === deviceBalance });
  assert.equal(await h.commit(), true, 'a refused source cannot freeze the first import');
  assert.ok(h.events.includes('ledger:6'), JSON.stringify(h.events));
});
