'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');

// Persistent hook slots/effect dependencies, as in ios-capture-setup.test.js.
// Execute the actual hook and entitlement predicate; only native/UI/executor
// boundaries are substituted. No parser fixtures or personal data are needed.
function hookRuntime() {
  const slots = [];
  const pending = [];
  let cursor = 0;
  const same = (a, b) => a && b && a.length === b.length &&
    a.every((value, index) => Object.is(value, b[index]));
  function slot(kind, initial) {
    const index = cursor++;
    if (!slots[index]) slots[index] = { kind, ...initial() };
    assert.equal(slots[index].kind, kind);
    return slots[index];
  }
  function memo(factory, dependencies) {
    const cell = slot('memo', () => ({}));
    if (!same(cell.dependencies, dependencies)) {
      cell.dependencies = dependencies;
      cell.value = factory();
    }
    return cell.value;
  }
  const react = {
    useMemo: memo,
    useCallback: (callback, dependencies) => memo(() => callback, dependencies),
    useRef: value => slot('ref', () => ({ value: { current: value } })).value,
    useState: initial => {
      const cell = slot('state', () => ({ value: typeof initial === 'function' ? initial() : initial }));
      return [cell.value, next => { cell.value = typeof next === 'function' ? next(cell.value) : next; }];
    },
    useEffect: (effect, dependencies) => {
      const cell = slot('effect', () => ({}));
      cell.effect = effect;
      if (same(cell.dependencies, dependencies)) return;
      cell.dependencies = dependencies;
      pending.push(() => { cell.cleanup?.(); cell.cleanup = effect(); });
    },
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  };
  return {
    react,
    render: callback => { cursor = 0; return callback(); },
    flush: () => { while (pending.length) pending.shift()(); },
    replay: () => {
      const effects = slots.filter(cell => cell.kind === 'effect');
      for (const cell of effects) cell.cleanup?.();
      for (const cell of effects) cell.cleanup = cell.effect();
    },
    cleanup: () => { for (const cell of slots) if (cell.kind === 'effect') cell.cleanup?.(); },
  };
}

function harness(overrides = {}, options = {}) {
  let now = Date.UTC(2026, 8, 8, 12);
  class Clock extends Date { static now() { return now; } }
  let state = {
    hydrated: true, onboarded: true, captureOptOut: false, privateMode: false,
    pro: false, founderPro: false, trialStartTs: now - 10 * 86400000,
    historyImport: { status: 'complete' }, lastScanTs: now - 3600000,
    transactions: [], dailySummary: false, iosCaptureWarning: null,
    ...overrides,
  };
  const calls = { scans: 0, permission: 0, routes: [], toasts: [], setup: 0 };
  const appListeners = new Set();
  const inboxListeners = new Set();
  const runtime = hookRuntime();
  const router = { push: route => calls.routes.push(route) };
  const toast = { show: text => calls.toasts.push(text) };
  const native = {
    Platform: { OS: 'android', Version: 36 },
    AppState: { currentState: 'active', addEventListener: (_event, listener) => {
      appListeners.add(listener);
      return { remove: () => appListeners.delete(listener) };
    } },
  };
  const purchases = load(path.join(root, 'src/lib/purchases.ts'), { 'react-native': native }, { Date: Clock });
  const store = {
    getStateSnapshot: () => state,
    getStateGeneration: () => 0,
    importBatch: () => ({ ids: [], durable: Promise.resolve() }),
    stageReviewAlerts: () => ({ admitted: 0, durable: Promise.resolve() }),
    undoBatch: () => {}, ensureDurable: async () => {}, setMarket: () => true,
    recordIosCaptureWarning: () => ({ durable: Promise.resolve() }),
    clearIosCaptureWarning: () => ({ cleared: false, durable: Promise.resolve() }),
  };
  const hook = load(path.join(root, 'src/hooks/use-auto-import.ts'), {
    '@/lib/inbox-refresh-scheduler': load(path.join(root, 'src/lib/inbox-refresh-scheduler.ts')),
    '@/lib/ios-local-capture-protocol': load(
      path.join(root, 'src/lib/ios-local-capture-protocol.ts'), {}, { process: { env: {} } },
    ),
    react: runtime.react,
    'react-native': native,
    'expo-router': {
      useRouter: () => router,
      useFocusEffect: effect => runtime.react.useEffect(effect, [effect]),
    },
    '@/components/ui/toast': { useToast: () => toast },
    '@/lib/auto-import': {
      subscribeInboxChanges: listener => { inboxListeners.add(listener); return () => inboxListeners.delete(listener); },
      isSmsScanningAvailable: () => true,
      hasSmsPermission: async () => { calls.permission += 1; return options.permission !== false; },
      requestSmsPermission: async () => options.permission !== false,
      isSmsInboxAccessError: () => false, openSmsPermissionSettings: async () => {},
    },
    '@/lib/background-relay': {
      enableRelayBackgroundSync: async () => { calls.setup += 1; },
      setChargeAlertsEnabled: async () => {},
    },
    '@/lib/capture': {
      getIosCaptureNativeModule: () => null, isCaptureAvailable: () => true,
      publishIosCaptureStatusRefresh: () => {}, subscribeIosCaptureStatusRefresh: () => () => {},
    },
    '@/lib/capture-executor': { createCaptureExecutor: () => ({ execute: async intent => {
      assert.equal(intent, 'routine');
      calls.scans += 1;
      if (options.scanGate) await options.scanGate;
      return { kind: 'up-to-date', source: 'sms', transactions: 0, dues: 0,
        bills: 0, healed: 0, newAccounts: 0, transactionIds: [], reviewAlerts: 0 };
    } }) },
    '@/lib/haptics': { committed: () => {} },
    '@/lib/i18n': { t: key => key, tf: key => key },
    '@/lib/notifications': { syncDailySummary: async () => {}, syncPaymentReminders: async () => {} },
    '@/lib/purchases': purchases,
    '@/lib/relay': { getRelayConfig: async () => null,
      isLegacyShortcutCaptureActive: () => false, retireRelayShortcutCapture: async () => {} },
    '@/lib/ios-local-capture': { getSharedIosLocalCaptureCoordinator: () => null },
    '@/lib/store': { useStore: () => ({ ...store, state }) },
    '@/lib/ios-capture-health': { isCaptureTimestamp: value => Number.isFinite(value) && value > 0 },
    '@/lib/ios-message-onboarding': { loadIosMessageSetupProgress: async () => null },
  }, { Date: Clock });
  let model;
  function render() {
    model = runtime.render(() => {
      const owner = hook.useAutoImport(options.watchForeground !== false, false);
      if (options.secondOwner) hook.useAutoImport(true, false);
      return owner;
    });
    runtime.flush();
  }
  async function settle() {
    // Drain asynchronous boundary completions, then reflect hook state updates.
    await new Promise(resolve => setImmediate(resolve));
    render();
    await new Promise(resolve => setImmediate(resolve));
  }
  return {
    calls, runtime, render, settle,
    get model() { return model; },
    update: async patch => { state = { ...state, ...patch }; render(); await settle(); },
    advance: ms => { now += ms; },
    background: () => { native.AppState.currentState = 'background'; for (const listener of appListeners) listener('background'); },
    resume: async () => { native.AppState.currentState = 'active'; for (const listener of appListeners) listener('active'); await new Promise(r => setTimeout(r, 280)); await settle(); },
    emitInboxChange: () => { for (const listener of inboxListeners) listener(); },
    inboxChanged: async () => { for (const listener of inboxListeners) listener(); await new Promise(r => setTimeout(r, 280)); await settle(); },
    observerCount: () => inboxListeners.size,
    active: () => purchases.isProActive(state),
  };
}

test('a foreground inactive-to-Pro transition scans once without a navigation or app-state event', async t => {
  const h = harness(); t.after(h.runtime.cleanup);
  h.render(); await h.settle();
  assert.equal(h.active(), false, 'the expired trial must not authorize the initial scan');
  assert.equal(h.calls.scans, 0);
  await h.update({ pro: true });
  assert.equal(h.calls.scans, 1, 'Pro activation must retry the previously ineligible scan');
  assert.equal(h.calls.permission, 1);
  assert.deepEqual(h.calls.routes, [], 'the retry is silent, not a paywall interaction');
  assert.deepEqual(h.calls.toasts, []);
  for (let index = 0; index < 5; index += 1) await h.update({ transactions: [], entitlementRefresh: index });
  assert.equal(h.calls.scans, 1, 'unchanged eligibility and ledger rerenders cannot make a refresh loop');
  assert.equal(h.calls.setup, 1);
});

test('reactivation bypasses recent scan freshness, while revocation never reads the inbox', async t => {
  const h = harness({ pro: true }); t.after(h.runtime.cleanup);
  h.render(); await h.settle();
  assert.equal(h.calls.scans, 1);
  await h.update({ pro: false });
  await h.resume();
  assert.equal(h.calls.scans, 1);
  h.advance(1000);
  await h.update({ pro: true });
  assert.equal(h.calls.scans, 2, 'the earlier successful scan must not suppress renewed eligibility');
  await h.resume();
  assert.equal(h.calls.scans, 3, 'Android resume checks new messages even within 30 seconds of the previous read');
});

test('history ownership defers an activation retry without consuming its freshness bypass', async t => {
  const h = harness({ pro: true }); t.after(h.runtime.cleanup);
  h.render(); await h.settle();
  assert.equal(h.calls.scans, 1);
  await h.update({ pro: false, historyImport: { status: 'running' } });
  await h.update({ pro: true });
  assert.equal(h.calls.scans, 1, 'running history retains exclusive inbox ownership');
  await h.update({ historyImport: { status: 'complete' } });
  assert.equal(h.calls.scans, 2, 'the activation retry is still due after history releases the inbox');
});

test('unchanged eligibility during a live trial does not force a scan when the Pro cache changes', async t => {
  const h = harness({ trialStartTs: Date.UTC(2026, 8, 8, 11) }); t.after(h.runtime.cleanup);
  h.render(); await h.settle();
  assert.equal(h.active(), true);
  assert.equal(h.calls.scans, 1);
  await h.update({ pro: true });
  await h.update({ pro: false });
  assert.equal(h.calls.scans, 1, 'only derived eligibility transitions can bypass freshness');
});

test('a restored founder entitlement also resumes scanning without changing the purchased Pro flag', async t => {
  const h = harness(); t.after(h.runtime.cleanup);
  h.render(); await h.settle();
  await h.update({ founderPro: true });
  assert.equal(h.calls.scans, 1);
});

for (const [label, before, unblock] of [
  ['opt-out', { captureOptOut: true }, { captureOptOut: false }],
  ['hydration', { hydrated: false }, { hydrated: true }],
  ['onboarding', { onboarded: false }, { onboarded: true }],
  ['running history', { historyImport: { status: 'running' } }, { historyImport: { status: 'complete' } }],
  ['paused history', { historyImport: { status: 'paused' } }, { historyImport: { status: 'complete' } }],
]) {
  test(`activation preserves ${label} and scans only once that guard clears`, async t => {
    const h = harness(before); t.after(h.runtime.cleanup);
    h.render(); await h.settle();
    await h.update({ pro: true });
    assert.equal(h.calls.scans, 0);
    assert.equal(h.calls.permission, 0, 'guards apply before native permission access');
    await h.update(unblock);
    assert.equal(h.calls.scans, 1);
  });
}

test('an entitlement refresh cannot enable a denied permission or bypass the interactive paywall', async t => {
  const h = harness({}, { permission: false }); t.after(h.runtime.cleanup);
  h.render(); await h.settle();
  await h.model.runAutoImport(true);
  assert.deepEqual(h.calls.routes, ['/pro']);
  await h.update({ pro: true });
  assert.equal(h.calls.permission, 1);
  assert.equal(h.calls.scans, 0);
  assert.equal(h.model.needsPermission, true);
});

test('status-only consumers do not become additional foreground scan owners', async t => {
  const h = harness({}, { watchForeground: false }); t.after(h.runtime.cleanup);
  h.render(); await h.settle();
  await h.update({ pro: true });
  assert.equal(h.calls.scans, 0);
  assert.equal(h.calls.permission, 0);
  assert.equal(h.observerCount(), 0);
});

test('the mounted Android owner imports a new provider event without a pull gesture', async t => {
  const h = harness({ pro: true }); t.after(h.runtime.cleanup);
  h.render(); await h.settle(); assert.equal(h.calls.scans, 1);
  assert.equal(h.observerCount(), 1);
  await h.inboxChanged(); assert.equal(h.calls.scans, 2);
  await h.update({ captureOptOut: true }); assert.equal(h.observerCount(), 0);
  await h.inboxChanged(); assert.equal(h.calls.scans, 2, 'capture opt-out removes the listener');
});

test('Android provider bursts coalesce and unmount cancels a scheduled refresh', async t => {
  const h = harness({ pro: true }); t.after(h.runtime.cleanup);
  h.render(); await h.settle();
  for (let i = 0; i < 10; i++) h.emitInboxChange();
  await h.inboxChanged();
  assert.equal(h.calls.scans, 2, 'one provider burst earns only one follow-up read');
  h.emitInboxChange();
  h.runtime.cleanup();
  assert.equal(h.observerCount(), 0);
  await new Promise(resolve => setTimeout(resolve, 280));
  assert.equal(h.calls.scans, 2, 'disposed timers cannot read after the owner unmounts');
});

test('a provider event during an Android scan waits for it and then rereads once', async t => {
  let finish;
  const scanGate = new Promise(resolve => { finish = resolve; });
  t.after(() => finish());
  const h = harness({ pro: true }, { scanGate }); t.after(h.runtime.cleanup);
  h.render(); await h.settle();
  assert.equal(h.calls.scans, 1);
  await h.inboxChanged();
  assert.equal(h.calls.scans, 1, 'the provider hint cannot start a competing ledger scan');
  finish(); await h.settle();
  assert.equal(h.calls.scans, 2, 'joining the old read must not lose a later provider change');
});

test('Android provider hints stay silent in background and resume catches up immediately', async t => {
  const h = harness({ pro: true }); t.after(h.runtime.cleanup);
  h.render(); await h.settle();
  h.background(); await h.inboxChanged();
  assert.equal(h.calls.scans, 1);
  await h.resume();
  assert.equal(h.calls.scans, 2, 'the pending foreground read does not wait for the freshness timeout');
});

test('Android resume preserves a background provider hint while the previous scan is still running', async t => {
  let finish;
  const scanGate = new Promise(resolve => { finish = resolve; });
  t.after(() => finish());
  const h = harness({ pro: true }, { scanGate }); t.after(h.runtime.cleanup);
  h.render(); await h.settle();
  h.background(); await h.inboxChanged(); await h.resume();
  assert.equal(h.calls.scans, 1, 'resume waits for the existing scan to finish');
  finish(); await h.settle();
  assert.equal(h.calls.scans, 2, 'resume must reread the provider after the older in-flight snapshot');
});

test('Android reattaches its native observer after denied SMS permission is restored', async t => {
  const options = { permission: false };
  const h = harness({ pro: true }, options); t.after(h.runtime.cleanup);
  h.render(); await h.settle();
  assert.equal(h.observerCount(), 0, 'a permission-denied native subscription cannot deliver provider events');
  assert.equal(h.calls.scans, 0);
  options.permission = true;
  await h.resume();
  assert.equal(h.calls.scans, 1);
  assert.equal(h.observerCount(), 1, 'OnStartObserving must run again after permission is granted');
  await h.inboxChanged();
  assert.equal(h.calls.scans, 2);
});

test('revocation cancels a queued Android hint and denied permission still prevents inbox reads', async t => {
  const h = harness({ pro: true }); t.after(h.runtime.cleanup);
  h.render(); await h.settle();
  h.emitInboxChange(); await h.update({ pro: false });
  await h.inboxChanged();
  assert.equal(h.observerCount(), 0);
  assert.equal(h.calls.scans, 1);
  assert.equal(h.calls.permission, 1, 'revocation stops before even checking native permission');

  const denied = harness({ pro: true }, { permission: false }); t.after(denied.runtime.cleanup);
  denied.render(); await denied.settle();
  await denied.inboxChanged();
  assert.equal(denied.calls.scans, 0);
  assert.equal(denied.model.needsPermission, true);
  assert.deepEqual(denied.calls.routes, []);
  assert.deepEqual(denied.calls.toasts, []);
});

test('two mounted foreground owners and effect replay join one activation scan', async t => {
  let finish;
  const scanGate = new Promise(resolve => { finish = resolve; });
  const h = harness({}, { secondOwner: true, scanGate }); t.after(h.runtime.cleanup);
  h.render(); await h.settle();
  await h.update({ pro: true });
  assert.equal(h.calls.scans, 1, 'activation starts the shared scan before any effect replay');
  h.runtime.replay(); await h.settle();
  assert.equal(h.calls.scans, 1);
  assert.equal(h.calls.permission, 1);
  finish(); await h.settle();
  await h.update({ transactions: [] });
  assert.equal(h.calls.scans, 1);
});
