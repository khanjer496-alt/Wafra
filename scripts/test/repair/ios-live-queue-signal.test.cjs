'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

// Execute the actual hook and source-free scheduler with deterministic timers.
// UI, the native queue and the already-tested durable coordinator are boundaries.
function harness(options = {}) {
  const slots = [], effects = [], timers = new Map(), listeners = new Set(), appListeners = new Set();
  let cursor = 0, timerId = 0, state = {
    hydrated: true, onboarded: true, pro: true, captureOptOut: false,
    privateMode: false, historyImport: null, lastScanTs: 1, dailySummary: false,
    ...options.state,
  };
  const calls = { drains: 0, status: 0, activeDrains: 0, maxActiveDrains: 0, subscriptions: 0 };
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const slot = (kind, init) => {
    const n = cursor++; slots[n] ??= { kind, ...init() };
    assert.equal(slots[n].kind, kind); return slots[n];
  };
  const memo = (factory, deps) => {
    const s = slot('memo', () => ({}));
    if (!same(s.deps, deps)) { s.deps = deps; s.value = factory(); }
    return s.value;
  };
  const react = {
    useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps),
    useRef: value => slot('ref', () => ({ value: { current: value } })).value,
    useState: initial => {
      const s = slot('state', () => ({ value: typeof initial === 'function' ? initial() : initial }));
      return [s.value, value => { s.value = typeof value === 'function' ? value(s.value) : value; }];
    },
    useEffect: (fn, deps) => {
      const s = slot('effect', () => ({})); s.effect = fn;
      if (same(s.deps, deps)) return;
      s.deps = deps; effects.push(() => { s.cleanup?.(); s.cleanup = fn(); });
    },
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  };
  const globals = {
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id),
  };
  const appState = {
    currentState: 'active',
    addEventListener: (_event, listener) => {
      appListeners.add(listener); return { remove: () => appListeners.delete(listener) };
    },
  };
  let drainGate = options.drainGate;
  const coordinator = {
    drain: async () => {
      calls.drains++; calls.activeDrains++;
      calls.maxActiveDrains = Math.max(calls.maxActiveDrains, calls.activeDrains);
      try { if (drainGate) await drainGate.promise; }
      finally { calls.activeDrains--; }
      return { imported: 0, reviews: 0, retirement: 'not-needed' };
    },
    retryRetirementIfNeeded: async () => 'not-needed',
  };
  const native = {
    queueChangeEventsSupported: options.supported !== false,
    addListener: (event, listener) => {
      assert.equal(event, 'onQueueChanged'); calls.subscriptions++;
      listeners.add(listener); return { remove: () => listeners.delete(listener) };
    },
    getCaptureStatus: async () => {
      calls.status++;
      return { enabled: options.enabled !== false, entitled: true, dropped: 0, corrupt: false };
    },
  };
  const store = {
    getStateSnapshot: () => state, getStateGeneration: () => 0,
    importBatch: () => {}, stageReviewAlerts: () => {}, ensureDurable: async () => {},
    setMarket: () => true, undoBatch: () => {},
    recordIosCaptureWarning: () => ({ durable: Promise.resolve() }), clearIosCaptureWarning: () => {},
  };
  const hook = load(path.join(root, 'src/hooks/use-auto-import.ts'), {
    react, 'expo-router': { useRouter: () => ({}), useFocusEffect: () => {} },
    'react-native': { AppState: appState, Platform: { OS: 'ios' } },
    '@/components/ui/toast': { useToast: () => ({ show: () => {} }) },
    '@/lib/auto-import': {},
    '@/lib/background-relay': { enableRelayBackgroundSync: async () => {} },
    '@/lib/capture': { getIosCaptureNativeModule: () => native, isCaptureAvailable: () => true,
      publishIosCaptureStatusRefresh: () => {}, subscribeIosCaptureStatusRefresh: () => () => {} },
    '@/lib/capture-executor': { createCaptureExecutor: () => ({}) },
    '@/lib/haptics': {}, '@/lib/i18n': {},
    '@/lib/notifications': { syncPaymentReminders: async () => {} },
    '@/lib/purchases': { isProActive: value => value.pro },
    '@/lib/relay': { getRelayConfig: async () => null },
    '@/lib/ios-local-capture': { getSharedIosLocalCaptureCoordinator: () => coordinator },
    '@/lib/ios-local-capture-protocol': {},
    '@/lib/store': { useStore: () => ({ ...store, state }) },
    '@/lib/ios-capture-health': {}, '@/lib/ios-message-onboarding': {},
    '@/lib/inbox-refresh-scheduler': load(path.join(root, 'src/lib/inbox-refresh-scheduler.ts'), {}, globals),
  }, globals);
  const settle = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };
  function render() {
    cursor = 0; hook.useAutoImport(options.owner !== false, false);
    while (effects.length) effects.shift()();
  }
  return {
    calls, listeners, render, settle,
    emit: () => { for (const listener of listeners) listener(); },
    tick: async () => { const burst = [...timers.values()]; timers.clear(); burst.forEach(fn => fn()); await settle(); },
    update: async patch => { state = { ...state, ...patch }; render(); await settle(); },
    lifecycle: async value => { appState.currentState = value; for (const listener of appListeners) listener(value); await settle(); },
    setGate: gate => { drainGate = gate; },
    cleanup: () => { for (const s of slots) if (s.kind === 'effect') s.cleanup?.(); },
    replay: () => {
      const selected = slots.filter(s => s.kind === 'effect');
      selected.forEach(s => s.cleanup?.()); selected.forEach(s => { s.cleanup = s.effect(); });
    },
  };
}

test('foreground native bursts coalesce into one fresh serialized drain', async t => {
  const h = harness(); t.after(h.cleanup); h.render(); await h.settle();
  assert.equal(h.calls.drains, 1, 'existing launch reconciliation');
  h.emit(); h.emit(); h.emit(); await h.tick();
  assert.equal(h.calls.drains, 2);
  assert.equal(h.calls.maxActiveDrains, 1);
});

test('event after the current scan read waits for it, then rereads the queue', async t => {
  const gate = deferred(), h = harness({ drainGate: gate }); t.after(h.cleanup);
  h.render(); await h.settle(); h.emit(); await h.tick();
  assert.equal(h.calls.drains, 1, 'does not overlap the existing scan');
  gate.resolve(); await h.settle();
  assert.equal(h.calls.drains, 2, 'joining the stale read alone is insufficient');
  assert.equal(h.calls.maxActiveDrains, 1);
});

test('events during an event-triggered drain earn exactly one subsequent read', async t => {
  const h = harness(); t.after(h.cleanup); h.render(); await h.settle();
  const gate = deferred(); h.setGate(gate); h.emit(); await h.tick();
  h.emit(); h.emit(); await h.tick(); assert.equal(h.calls.drains, 2);
  gate.resolve(); await h.settle(); await h.tick();
  assert.equal(h.calls.drains, 3); assert.equal(h.calls.maxActiveDrains, 1);
});

for (const [name, patch] of [
  ['opt-out', { captureOptOut: true }], ['unhydrated/erased ledger', { hydrated: false }],
  ['expired entitlement', { pro: false }], ['history owner', { historyImport: { status: 'running' } }],
]) test(`${name} cancels a scheduled wake before touching native records`, async t => {
  const h = harness(); t.after(h.cleanup); h.render(); await h.settle();
  const before = h.calls.drains; h.emit(); await h.update(patch); await h.tick();
  assert.equal(h.calls.drains, before);
});

test('native disabled capture does not drain even if a spurious signal arrives', async t => {
  const h = harness({ enabled: false }); t.after(h.cleanup); h.render(); await h.settle();
  h.emit(); await h.tick(); assert.equal(h.calls.drains, 0);
});

test('suspended signals do not process; foreground reconciliation catches missed delivery', async t => {
  const h = harness(); t.after(h.cleanup); h.render(); await h.settle();
  await h.lifecycle('background'); h.emit(); await h.tick(); assert.equal(h.calls.drains, 1);
  await h.lifecycle('active'); assert.equal(h.calls.drains, 2);
});

test('unmount during an awaited scan prevents queued follow-up work', async () => {
  const gate = deferred(), h = harness({ drainGate: gate });
  h.render(); await h.settle(); h.emit(); await h.tick(); h.cleanup();
  gate.resolve(); await h.settle(); await h.tick();
  assert.equal(h.listeners.size, 0); assert.equal(h.calls.drains, 1);
});

test('Strict Mode cleanup/replay retains exactly one working queue listener', async t => {
  const h = harness(); t.after(h.cleanup); h.render(); await h.settle();
  h.replay(); await h.settle(); assert.equal(h.listeners.size, 1);
  const before = h.calls.drains; h.emit(); await h.tick(); assert.equal(h.calls.drains, before + 1);
});

test('older binaries retain launch/resume fallback without unsupported event registration', async t => {
  const h = harness({ supported: false }); t.after(h.cleanup); h.render(); await h.settle();
  assert.equal(h.calls.subscriptions, 0); assert.equal(h.calls.drains, 1);
  await h.lifecycle('active'); assert.equal(h.calls.drains, 2);
});

test('status-only surfaces never register extra queue drain listeners', async t => {
  const h = harness({ owner: false }); t.after(h.cleanup); h.render(); await h.settle();
  assert.equal(h.calls.subscriptions, 0); assert.equal(h.calls.drains, 0);
});
