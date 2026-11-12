'use strict';
// Home-screen widgets are refreshed by the tab shell's CaptureOwner, not by Home.
//
// Home can be paused while another screen or tab is on top (covered-screen-freeze.tsx,
// ios-tab-gate.tsx), and a paused Home runs no effects. The widget sync therefore lives in
// useWidgetSnapshotSync, which CaptureOwner calls outside every freeze. These tests run the real
// hook with the real client renderer (react-test-renderer) and counted widget-sync boundaries.
// They are not a device or launcher test.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { act } = React;
const mounted = new Set();
test.afterEach(() => { for (const r of mounted) act(() => { r.unmount(); }); mounted.clear(); });

function baseState(patch = {}) {
  const money = { schemaVersion: 2, currency: 'AED', exponent: 2 };
  return {
    hydrated: true, onboarded: true, privateMode: false, language: 'en', marketId: 'AE', ledgerMoney: money,
    transactions: [], accounts: [], budgets: [], bills: [], cardDues: [], notSubscriptions: [], cancelledSubscriptions: [],
    transferInternalIds: [], transferNormalizationVersion: 1, historyImport: null, customCategories: [], ...patch,
  };
}

function probe(initial = baseState()) {
  let state = initial; let generation = 1;
  const listeners = new Set();
  const store = {
    useStoreSelector: (selector, equal) => {
      const cache = React.useRef(null);
      const snapshot = () => {
        const next = selector({ state });
        if (cache.current && equal(cache.current, next)) return cache.current;
        cache.current = next; return next;
      };
      return React.useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, snapshot, snapshot);
    },
    useStoreActions: () => actions,
  };
  const actions = { getStateSnapshot: () => state, getStateGeneration: () => generation };
  const counts = { requested: 0, invalidated: 0, cancelled: 0, flushed: 0, options: [] };
  const appListeners = new Set();
  const frames = [];
  const dayListeners = [];
  let today = new Date(2026, 10, 12, 9, 0);
  const deps = {
    react: React,
    'react-native': { AppState: { addEventListener: (_name, listener) => { appListeners.add(listener); return { remove() { appListeners.delete(listener); } }; } } },
    '@/hooks/use-language': { useLanguage: () => state.language },
    '@/hooks/use-today': { useToday: () => {
      const [day, setDay] = React.useState(today);
      React.useEffect(() => { dayListeners.push(() => setDay((prev) => (prev.getDate() === today.getDate() ? prev : today))); }, []);
      return day;
    } },
    '@/lib/after-first-frames': { runAfterFirstFrames: (work) => { const entry = { work, cancelled: false }; frames.push(entry); return { cancel() { entry.cancelled = true; } }; } },
    '@/lib/ledger-money': { ledgerMoneySpec: () => ({ schemaVersion: 2, currency: 'AED', exponent: 2 }) },
    '@/lib/markets': { marketCurrencyCode: () => 'AED' },
    '@/lib/store': store,
    '@/lib/widget-sync': {
      WIDGET_SYNC_DEBOUNCE_MS: 2000,
      requestWidgetSnapshotSync: (input, isCurrent, options) => { counts.requested += 1; counts.lastCurrent = isCurrent; counts.lastInput = input; counts.options.push(options);
        return { cancel() { counts.cancelled += 1; }, flush() { counts.flushed += 1; }, done: Promise.resolve('written') }; },
      invalidateWidgetSnapshotSync: async () => { counts.invalidated += 1; return 'cleared'; },
    },
  };
  const { useWidgetSnapshotSync } = load(path.join(root, 'src/hooks/use-widget-snapshot-sync.ts'), deps);
  function Owner() { useWidgetSnapshotSync(); return null; }
  let renderer;
  act(() => { renderer = TestRenderer.create(React.createElement(Owner)); });
  mounted.add(renderer);
  return {
    counts,
    settle: () => act(() => { for (const f of frames.splice(0)) if (!f.cancelled) f.work(); }),
    set: (patch) => act(() => { state = { ...state, ...patch }; generation += 1; for (const l of [...listeners]) l(); }),
    appState: (next) => act(() => { for (const l of [...appListeners]) l(next); }),
    listeners: () => appListeners.size,
    resume: (nextDay) => act(() => { if (nextDay) today = nextDay; for (const l of dayListeners) l(); }),
  };
}

test('the owner requests one snapshot after first frames, without Home', () => {
  const p = probe();
  assert.equal(p.counts.requested, 0, 'deferred past the first frames');
  p.settle();
  assert.equal(p.counts.requested, 1);
  assert.equal(p.counts.lastInput.language, 'en');
  assert.equal(p.counts.lastCurrent(), true);
});

test('the owner asks for the 2 s quiet period and flushes it when the app leaves the foreground', () => {
  const p = probe();
  p.settle();
  assert.equal(JSON.stringify(p.counts.options), '[{"debounceMs":2000}]', 'a burst of edits writes only the latest figures');
  p.appState('active');
  assert.equal(p.counts.flushed, 0, 'staying active does not flush');
  p.appState('inactive');
  p.appState('background');
  assert.equal(p.counts.flushed, 2, 'leaving the foreground ends the quiet period so the last edit still reaches the widgets');
  assert.equal(p.listeners(), 1, 'one AppState listener while mounted');
  p.set({ transactions: [{ id: 'tx-1', amountFils: 1000 }] });
  assert.equal(p.listeners(), 1, 'the effect re-run replaces it, never stacks them');
});

test('a ledger change while Home is paused still refreshes the widgets, once', () => {
  const p = probe();
  p.settle();
  p.set({ transactions: [{ id: 'tx-1', amountFils: 1000 }] });   // e.g. an SMS capture with Settings on top
  p.settle();
  assert.equal(p.counts.requested, 2, 'exactly one new snapshot for the new ledger');
  assert.ok(p.counts.cancelled >= 1, 'the superseded request is cancelled');
});

test('a resume on the same day, or an unrelated store change, rewrites no widgets', () => {
  const p = probe();
  p.settle();
  p.resume(); p.settle();
  p.resume(); p.settle();
  p.set({ lastScanTs: 123, reviewTray: { pending: [] } });       // fields the widgets do not read
  p.settle();
  assert.equal(p.counts.requested, 1, 'the same day and ledger: no new snapshot, no native write');
  p.resume(new Date(2026, 10, 13, 9, 0)); p.settle();
  assert.equal(p.counts.requested, 2, 'a new day refreshes them');
});

test('private mode invalidates the widgets and requests nothing', () => {
  const p = probe(baseState({ privateMode: true }));
  p.settle();
  assert.equal(p.counts.requested, 0);
  assert.equal(p.counts.invalidated, 1);
  const q = probe();
  q.settle();
  q.set({ privateMode: true }); q.settle();
  assert.equal(q.counts.invalidated, 1, 'turning Private Mode on clears them');
  assert.equal(q.counts.requested, 1, 'and asks for no new snapshot');
});

test('follows custom category labels (the spending widget names them)', () => {
  const p = probe();
  p.settle();
  p.set({ customCategories: [{ id: 'custom-pets', label: 'Pets' }] }); p.settle();
  assert.equal(p.counts.requested, 2);
});

test('exactly one owner: CaptureOwner in both tab shells, never Home (no double request)', () => {
  for (const file of ['src/components/app-tabs-layout.tsx', 'src/components/app-tabs-layout.ios.tsx']) {
    const source = read(file);
    const owner = source.slice(source.indexOf('function CaptureOwner'), source.indexOf('return null;', source.indexOf('function CaptureOwner')));
    assert.equal((owner.match(/useWidgetSnapshotSync\(\)/g) ?? []).length, 1, `${file}: CaptureOwner calls it once`);
    assert.equal((source.match(/useWidgetSnapshotSync\(\)/g) ?? []).length, 1, `${file}: nowhere else`);
  }
  for (const screen of ['src/screens/journal-home-screen.tsx', 'src/screens/ledger-home-screen.tsx']) {
    assert.doesNotMatch(read(screen), /requestWidgetSnapshotSync|useWidgetSnapshotSync/, `${screen} must not also write widgets`);
  }
});
