// Public regressions preserve the reported bank wording with synthetic card/amount values.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };
const baseState = () => ({
  hydrated: true, onboarded: true, pro: false, captureOptOut: false, privateMode: false,
  transactions: [], accounts: [], cardDues: [], bills: [], budgets: [], goals: [],
  notSubscriptions: [], cancelledSubscriptions: [], dailySummary: false,
  monthStartDay: 1, language: 'en', marketId: 'ae', ledgerMoney: { currency: 'AED', exponent: 2 },
  historyImport: { status: 'complete' }, lastScanTs: 1,
});
const due = { id: 'due', accountId: 'card', totalDueFils: 924964, minDueFils: 46248, dueDate: '2026-09-30', paidFils: 0 };
const account = { id: 'card', kind: 'card', cardType: 'credit', last4: '9426', bankName: 'ADCB', name: 'ADCB Credit Card ·9426', openingFils: 0 };

function hookHarness({ owner = true, platform = 'android' } = {}) {
  let state = baseState(), cursor = 0;
  const slots = [], effects = [], waits = [], calls = [], summaries = [], modes = [], listeners = new Set();
  let durable = Promise.resolve();
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const slot = () => { const i = cursor++; return slots[i] ??= {}; };
  const memo = (factory, deps) => { const cell = slot(); if (!same(cell.deps, deps)) { cell.deps = deps; cell.value = factory(); } return cell.value; };
  const react = {
    useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps),
    useRef: value => memo(() => ({ current: value }), []),
    useState: initial => { const cell = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []); return [cell.value, value => { cell.value = typeof value === 'function' ? value(cell.value) : value; }]; },
    useEffect: (fn, deps) => { const cell = slot(); if (same(cell.deps, deps)) return; cell.deps = deps; effects.push(() => { cell.cleanup?.(); cell.cleanup = fn(); }); },
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  };
  const appState = { currentState: 'active', addEventListener: (_name, fn) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; } };
  const actions = {
    getStateSnapshot: () => state, getStateGeneration: () => 0, ensureDurable: () => durable,
    importBatch() {}, stageReviewAlerts() {}, undoBatch() {}, setMarket() {}, recordIosCaptureWarning() {}, clearIosCaptureWarning() {},
  };
  const hook = load(path.join(root, 'src/hooks/use-auto-import.ts'), {
    react, 'react-native': { AppState: appState, Platform: { OS: platform } },
    'expo-router': { useRouter: () => ({}), useFocusEffect() {} },
    '@/components/ui/toast': { useToast: () => ({ show() {} }) }, '@/components/lock-gate': { usePrivacyGateCleared: () => true },
    '@/lib/auto-import': { isSmsScanningAvailable: () => false, hasBankNotificationAccess: () => false, hasBankNotificationSystemAccess: () => false },
    '@/lib/background-relay': { enableRelayBackgroundSync: async () => {} },
    '@/lib/capture': { getIosCaptureNativeModule: () => null, isCaptureAvailable: () => false },
    '@/lib/capture-executor': { createCaptureExecutor: () => ({ execute: async () => ({ kind: 'up-to-date' }) }) },
    '@/lib/android-live-background': { installAndroidLiveCaptureLedger: () => () => {} },
    '@/lib/android-capture-sources': { androidSmsCaptureEnabled: () => false, androidNotificationCaptureEnabled: () => false },
    '@/lib/haptics': {}, '@/lib/capture-toast': {}, '@/lib/i18n': { t: value => value },
    '@/lib/fx-rates': {},
    '@/lib/notifications': { syncPaymentReminders: async (value, _now, mode) => { calls.push(value); modes.push(mode); }, syncDailySummary: async value => { summaries.push(value); } },
    '@/lib/purchases': { isProActive: () => false },
    '@/lib/trusted-bank-notification-packages': { bankNotificationAdmissionExpiresAt: () => 0 },
    '@/lib/relay': { getRelayConfig: async () => null }, '@/lib/ios-local-capture': {},
    '@/lib/store': { useStore: () => ({ ...actions, state }) },
    '@/lib/ios-capture-health': {}, '@/lib/ios-message-onboarding': {},
    '@/lib/inbox-refresh-scheduler': load(path.join(root, 'src/lib/inbox-refresh-scheduler.ts')),
    '@/lib/foreground-history-priority': { waitForForegroundHistoryIdle: () => { const gate = deferred(); waits.push(gate); return gate.promise; } },
    '../../modules/notification-reader': { __esModule: true, default: {} },
    '../../modules/sms-reader': { __esModule: true, default: {} },
  }, { setTimeout: () => 1, clearTimeout() {} });
  const render = () => { cursor = 0; hook.useAutoImport(owner, false); while (effects.length) effects.shift()(); };
  return {
    calls, summaries, modes, render,
    update(patch) { state = { ...state, ...patch }; render(); },
    setDurable(promise) { durable = promise; },
    async idle() { const pending = waits.splice(0); pending.forEach(wait => wait.resolve()); await settle(); },
    async lifecycle(value) { appState.currentState = value; for (const fn of listeners) fn(value); await settle(); },
    cleanup() { slots.forEach(cell => cell.cleanup?.()); },
  };
}

for (const platform of ['android', 'ios']) test(`${platform}: imported statement and payment refresh reminders after durable idle`, async t => {
  const h = hookHarness({ platform }); t.after(h.cleanup); h.render(); await settle(); await h.idle();
  h.calls.length = 0;
  const gate = deferred(); h.setDurable(gate.promise);
  h.update({ accounts: [account], cardDues: [due] }); await h.idle();
  assert.equal(h.calls.length, 0, 'a rendered statement is not durable yet');
  gate.resolve(); await settle();
  assert.equal(h.calls.length, 1, 'new statement must schedule without a restart or manual refresh');
  assert.equal(h.calls[0].cardDues[0].totalDueFils, 924964);
  h.update({ transactions: [{ id: 'receipt', type: 'income', isTransfer: true, cardPaymentSide: 'receipt', accountId: 'card', amountFils: 925100, date: '2026-09-30' }] });
  await h.idle();
  assert.equal(h.calls.length, 2, 'payment must cancel stale due reminders');
  assert.equal(h.calls[1].transactions[0].amountFils, 925100);
});

test('foreground scheduling coalesces bursts, ignores progress, and follows manual bill/account changes', async t => {
  const h = hookHarness(); t.after(h.cleanup); h.render(); await settle(); await h.idle(); h.calls.length = 0;
  h.update({ cardDues: [due] });
  h.update({ cardDues: [{ ...due, minDueFils: 40000 }] });
  h.update({ lastScanTs: 99 });
  await h.idle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].cardDues[0].minDueFils, 40000);
  h.update({ historyImport: { status: 'complete', scanned: 500 } }); await h.idle();
  assert.equal(h.calls.length, 1, 'history progress must not rebuild identical reminders');
  h.update({ bills: [{ id: 'bill', paidMonths: ['2026-09'] }] }); await h.idle();
  h.update({ accounts: [{ ...account, archived: true }] }); await h.idle();
  assert.equal(h.calls.length, 3);
});

test('history pages defer recurrence until completion; departure flushes obligations and resume finishes maintenance', async t => {
  const h = hookHarness(); t.after(h.cleanup); h.render(); await settle(); await h.idle(); h.calls.length = 0;
  h.update({ historyImport: { status: 'running' }, cardDues: [due] }); await h.idle();
  h.update({ cardDues: [{ ...due, minDueFils: 40000 }] }); await h.idle();
  assert.equal(h.calls.length, 0);
  h.update({ historyImport: { status: 'complete' } });
  await h.lifecycle('background'); await h.idle();
  assert.equal(h.calls.length, 1);
  assert.deepEqual({ ...h.modes.at(-1) }, { obligationsOnly: true });
  await h.lifecycle('active'); await h.idle();
  assert.equal(h.calls.length, 2);
  assert.notEqual(h.modes.at(-1)?.obligationsOnly, true);
});

test('leaving within the foreground grace still schedules durable dues without another app open', async t => {
  const h = hookHarness(); t.after(h.cleanup); h.render(); await settle(); await h.idle();
  h.calls.length = 0; h.modes.length = 0;
  const gate = deferred(); h.setDurable(gate.promise);
  h.update({ accounts: [account], cardDues: [due] });
  await h.lifecycle('background');
  assert.equal(h.calls.length, 0, 'background transition must wait for the actual encrypted write');
  gate.resolve(); await settle();
  assert.equal(h.calls.length, 1, 'a user who leaves before the grace expires must still receive the due reminder');
  assert.deepEqual({ ...h.modes[0] }, { obligationsOnly: true });
  assert.equal(h.calls[0].cardDues[0].totalDueFils, 924964);
  await h.idle();
  assert.equal(h.calls.length, 1, 'deferred recurrence never runs while away');
});

test('background history pages do not reschedule obligations after the departure flush', async t => {
  const h = hookHarness(); t.after(h.cleanup); h.render(); await settle(); await h.idle();
  h.calls.length = 0;
  h.update({ historyImport: { status: 'running' }, cardDues: [due] });
  await h.lifecycle('background');
  assert.equal(h.calls.length, 1, 'actual departure preserves already-known bank dues');
  h.update({ transactions: [{ id: 'old-1' }], cardDues: [{ ...due }] }); await settle();
  h.update({ transactions: [{ id: 'old-1' }, { id: 'old-2' }] }); await settle();
  assert.equal(h.calls.length, 1, 'retained history pages stay cheap while rebuilding in background');
  h.update({ historyImport: { status: 'complete' } }); await settle();
  assert.equal(h.calls.length, 2, 'completed history refreshes obligations once even while away');
  assert.deepEqual({ ...h.modes.at(-1) }, { obligationsOnly: true });
});

test('paused or failed history still schedules authoritative dues without recurrence analysis', async t => {
  const h = hookHarness(); t.after(h.cleanup); h.render(); await settle(); await h.idle();
  h.calls.length = 0; h.modes.length = 0;
  h.update({ historyImport: { status: 'paused' }, cardDues: [due] }); await h.idle();
  assert.equal(h.calls.length, 1, 'paused history must not strand an independently captured statement');
  assert.deepEqual({ ...h.modes[0] }, { obligationsOnly: true });
  h.update({ historyImport: { status: 'failed' }, transactions: [{ id: 'receipt' }] }); await h.idle();
  assert.equal(h.calls.length, 2);
  assert.deepEqual({ ...h.modes[1] }, { obligationsOnly: true });
  h.update({ historyImport: { status: 'complete' } }); await h.idle();
  assert.equal(h.calls.length, 3);
  assert.notEqual(h.modes[2]?.obligationsOnly, true, 'history completion restores full recurrence maintenance');
});

test('non-owner consumers never schedule reactive reminders', async t => {
  const h = hookHarness({ owner: false }); t.after(h.cleanup); h.render(); await settle(); await h.idle();
  h.update({ cardDues: [due], transactions: [] }); await h.idle();
  assert.equal(h.calls.length, 0);
});

function backgroundHarness() {
  let state = { ...baseState(), pro: true }, handler;
  let next = {}, durable = Promise.resolve(), failSync = false;
  const calls = [], summaries = [];
  const api = load(path.join(root, 'src/lib/android-live-background.ts'), {
    'react-native': { Platform: { OS: 'android' }, AppState: { currentState: 'background' }, AppRegistry: { registerHeadlessTask: (_name, factory) => { handler = factory(); } } },
    '../../modules/notification-reader': { __esModule: true, default: { isAdmissionActive: () => true } },
    '../../modules/sms-reader': { __esModule: true, default: {} },
    '@/lib/android-capture-sources': { androidSmsCaptureEnabled: () => true, androidNotificationCaptureEnabled: () => true },
    '@/lib/auto-import': {},
    '@/lib/capture-executor': { createCaptureExecutor: () => ({ execute: async () => {
      state = { ...state, ...next }; await durable;
      return { kind: 'imported', transactionIds: [] };
    } }) },
    '@/lib/i18n': { setLanguage() {} }, '@/lib/ledger-import': {},
    '@/lib/ledger-persistence': { createLedgerPersistence: () => ({}) },
    '@/lib/ledger-money': { isLedgerMoneySpec: () => true },
    '@/lib/markets': { setActiveMarket() {}, setLedgerCurrency() {} }, '@/lib/country': { setActiveCountry() {} },
    '@/lib/best-effort-autopost': { setBestEffortAutoPostEnabled() {} },
    '@/lib/purchases': { isProActive: () => true }, '@/lib/state-storage': {},
    '@/lib/reminders': load(path.join(root, 'src/lib/reminders.ts'), {
      '@/lib/bills': {}, '@/lib/cards': {}, '@/lib/format': {}, '@/lib/i18n': {}, '@/lib/ledger': {}, '@/lib/subscriptions': {},
    }),
    '@/lib/notifications': { syncDailySummary: async state => { summaries.push(state); }, syncPaymentReminders: async (...args) => { calls.push(args); if (failSync) throw new Error('OS denied scheduling'); } },
  });
  const uninstall = api.installAndroidLiveCaptureLedger({ getState: () => state });
  return { calls, summaries, uninstall, run: () => handler({ source: 'sms', observedAt: 1000 }),
    change: patch => { next = patch; }, setDurable: promise => { durable = promise; }, failSync: () => { failSync = true; } };
}

test('headless statement/payment changes sync bounded obligations only after durable capture', async t => {
  const h = backgroundHarness(); t.after(h.uninstall);
  const gate = deferred(); h.setDurable(gate.promise); h.change({ accounts: [account], cardDues: [due] });
  const run = h.run(); await settle(); assert.equal(h.calls.length, 0);
  gate.resolve(); await run;
  assert.equal(h.calls.length, 1);
  assert.deepEqual({ ...h.calls[0][2] }, { obligationsOnly: true });
  assert.equal(h.calls[0][0].cardDues[0].totalDueFils, 924964);
  h.change({ transactions: [{ id: 'payment', amountFils: 925100 }] }); await h.run();
  assert.equal(h.calls.length, 2);
});

test('headless empty capture, rejected persistence, and notification failure cannot break the ledger', async t => {
  const h = backgroundHarness(); t.after(h.uninstall);
  await h.run(); assert.equal(h.calls.length, 0, 'identical inputs must avoid recurrence/scheduling work');
  h.setDurable(Promise.reject(new Error('disk unavailable'))); h.change({ cardDues: [due] });
  await assert.rejects(h.run(), /disk unavailable/);
  assert.equal(h.calls.length, 0);
  h.setDurable(Promise.resolve()); h.change({ cardDues: [{ ...due }] }); h.failSync();
  await h.run();
  assert.equal(h.calls.length, 1, 'notification failure is contained after durable capture');
});

test('headless spend refreshes tonight summary after durability even when obligation scheduling fails', async t => {
  const h = backgroundHarness(); t.after(h.uninstall);
  const gate = deferred(); h.setDurable(gate.promise);
  h.change({ dailySummary: true, transactions: [{ id: 'new-charge', amountFils: 3690 }] });
  h.failSync();
  const run = h.run(); await settle();
  assert.equal(h.summaries.length, 0);
  gate.resolve(); await run;
  assert.equal(h.summaries.length, 1);
  assert.equal(h.summaries[0].transactions[0].amountFils, 3690);
});

test('returning from Android settings retries reminders even with unchanged ledger', async t => {
  const h = hookHarness(); t.after(h.cleanup); h.render(); await settle(); await h.idle();
  h.calls.length = 0;
  await h.lifecycle('background'); await h.lifecycle('active'); await h.idle();
  assert.equal(h.calls.length, 1, 'permission grants and calendar rollover need a fresh plan on resume');
  await h.lifecycle('background'); await h.lifecycle('active'); await h.idle();
  assert.equal(h.calls.length, 2, 'a completed refresh must not suppress future resumes');
});

test('leaving before summary grace flushes durable spending for 9 pm', async t => {
  const h = hookHarness(); t.after(h.cleanup); h.render(); await settle(); await h.idle();
  const gate = deferred(); h.setDurable(gate.promise);
  h.update({ dailySummary: true, transactions: [{ id: 'new-charge', amountFils: 3690 }] });
  await h.lifecycle('background');
  assert.equal(h.summaries.length, 0);
  gate.resolve(); await settle();
  assert.equal(h.summaries.length, 1);
  assert.equal(h.summaries[0].transactions[0].amountFils, 3690);
  await h.idle();
  assert.equal(h.summaries.length, 1, 'the grace callback must not duplicate the departure flush');
});

test('history completing while already background schedules the durable summary', async t => {
  const h = hookHarness(); t.after(h.cleanup); h.render(); await settle(); await h.idle();
  h.update({ dailySummary: true, historyImport: { status: 'running' }, transactions: [{ id: 'charge' }] });
  await h.lifecycle('background');
  assert.equal(h.summaries.length, 0);
  h.update({ historyImport: { status: 'complete' } }); await h.idle();
  assert.equal(h.summaries.length, 1);
});
