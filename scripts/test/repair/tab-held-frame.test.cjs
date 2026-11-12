'use strict';
// iOS tabs, after the iPhone 15 A/B (TestFlight 190 vs 192): a paused tab keeps
// and shows its last frame on focus and catches up after the first frames, and a
// hidden tab is pre-warmed once when the app is idle. Real React (the client
// renderer), the real StorePauseBoundary, the real held handle and the real tab
// gate. The store is the same handle/selection pair the app's useStoreSelector
// uses. This proves what renders and when; it is not a device frame measurement.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const jsxRuntime = require('react/jsx-runtime');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const { act } = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const selection = load(path.join(root, 'src/lib/store-selection.ts'), {});
const pause = load(path.join(root, 'src/lib/store-pause.tsx'), {
  react: React, 'react/jsx-runtime': jsxRuntime, '@/lib/store-selection': selection,
});
const ValueContext = React.createContext(null);
const HandleContext = React.createContext(null);
const StorePauseBoundary = pause.createStorePauseBoundary(ValueContext, HandleContext,
  (live, held) => live.privateMode !== held.privateMode);

/** The app's store shape: a publishing handle plus a provider that re-renders with each value. */
function appStore(initial) {
  const handle = selection.createStoreHandle(initial);
  let value = initial;
  return {
    handle,
    get value() { return value; },
    Provider: ({ children }) => React.createElement(HandleContext.Provider, { value: handle },
      React.createElement(ValueContext.Provider, { value }, children)),
    set(next) { value = next; handle.set(next); },
  };
}

/** A tab whose figures are an expensive projection of the ledger, read like useStoreSelector. */
function figuresTab(stats) {
  return function Figures() {
    const handle = React.useContext(HandleContext);
    const select = React.useRef(selection.createSelection()).current;
    const snapshot = () => select(handle.get(), (store) => ({ total: store.total, privateMode: store.privateMode }));
    const chosen = React.useSyncExternalStore(handle.subscribe, snapshot, snapshot);
    const fromContext = React.useContext(ValueContext);
    const figures = React.useMemo(() => { stats.projections += 1; return chosen.privateMode ? '***' : String(chosen.total); }, [chosen]);
    stats.renders += 1;
    return React.createElement('figures', { context: fromContext.total }, figures);
  };
}
const shown = (renderer) => renderer.root.findByType('figures').props.children;

test('held handle: while held, source changes reach no listener and get() is the held value', () => {
  const source = selection.createStoreHandle({ total: 1 });
  const held = selection.createHeldHandle(source);
  let calls = 0;
  const off = held.subscribe(() => { calls += 1; });
  held.hold({ total: 1 });
  for (let total = 2; total <= 21; total += 1) { source.set({ total }); source.notify(); }
  assert.equal(calls, 0);
  assert.equal(held.get().total, 1);
  held.resume();
  assert.equal(held.get().total, 21, 'resuming reads the live source in the same render');
  assert.equal(calls, 0, 'listeners are told only on notify, after commit');
  held.notify();
  assert.equal(calls, 1);
  source.set({ total: 22 }); source.notify();
  assert.equal(calls, 2, 'live again: source changes pass through');
  off();
  source.notify();
  assert.equal(calls, 2);
});

test('StorePauseBoundary: a paused subtree does no store work and keeps its frame; resume catches up once', () => {
  const store = appStore({ total: 1, privateMode: false });
  const stats = { renders: 0, projections: 0 };
  const Figures = figuresTab(stats);
  const view = (paused) => React.createElement(store.Provider, null,
    React.createElement(StorePauseBoundary, { paused }, React.createElement(Figures)));
  let renderer;
  act(() => { renderer = TestRenderer.create(view(false)); });
  act(() => { renderer.update(view(true)); });
  const before = { ...stats };
  for (let total = 2; total <= 21; total += 1) {
    act(() => { store.set({ total, privateMode: false }); renderer.update(view(true)); store.handle.notify(); });
  }
  assert.equal(stats.projections, before.projections, '20 store changes recompute nothing while paused');
  assert.equal(shown(renderer), '1', 'the native views keep the last frame');
  assert.equal(renderer.root.findByType('figures').props.context, 1, 'useStore() consumers are held too');
  act(() => { renderer.update(view(false)); });
  assert.equal(shown(renderer), '21');
  assert.equal(stats.projections, before.projections + 1, 'one catch-up, from the current store');
  act(() => { renderer.unmount(); });
});

test('StorePauseBoundary: Private Mode reaches a paused tab at once', () => {
  const store = appStore({ total: 5, privateMode: false });
  const stats = { renders: 0, projections: 0 };
  const Figures = figuresTab(stats);
  const view = () => React.createElement(store.Provider, null,
    React.createElement(StorePauseBoundary, { paused: true }, React.createElement(Figures)));
  let renderer;
  act(() => { renderer = TestRenderer.create(view()); });
  act(() => { store.set({ total: 5, privateMode: true }); renderer.update(view()); store.handle.notify(); });
  assert.equal(shown(renderer), '***', 'a held frame never shows amounts the user just hid');
  act(() => { renderer.unmount(); });
});

function gate({ afterFrames, prewarmJobs }) {
  const policy = load(path.join(root, 'src/lib/covered-screen-freeze.ts'), {});
  const freeze = load(path.join(root, 'src/components/freeze-when-covered.tsx'), {
    react: React, 'react/jsx-runtime': jsxRuntime, '@/lib/covered-screen-freeze': policy,
  }, { setTimeout, clearTimeout });
  return load(path.join(root, 'src/components/ios-tab-gate.tsx'), {
    react: React, 'react/jsx-runtime': jsxRuntime,
    'react-native': { Platform: { OS: 'ios' } },
    '@react-navigation/native': {},
    '@/components/freeze-when-covered': freeze,
    '@/lib/covered-screen-freeze': policy,
    '@/lib/after-first-frames': { runAfterFirstFrames: (task) => {
      const job = { task, cancelled: false }; afterFrames.push(job);
      return { cancel() { job.cancelled = true; } };
    } },
    '@/lib/store': { StorePauseBoundary },
    '@/lib/tab-prewarm': { scheduleTabPrewarm: (run) => {
      const job = { run, cancelled: false }; prewarmJobs.push(job);
      return { cancel() { job.cancelled = true; } };
    } },
  }, { setTimeout, clearTimeout });
}
const wait = (ms) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const runFrames = (afterFrames) => act(() => { for (const job of afterFrames.splice(0)) if (!job.cancelled) job.task(); });

test('snapshot on focus: a refocused tab shows its paused frame with no recompute, then catches up after the first frames', async () => {
  const afterFrames = []; const prewarmJobs = [];
  const { TabFocusGate } = gate({ afterFrames, prewarmJobs });
  const store = appStore({ total: 100, privateMode: false });
  const stats = { renders: 0, projections: 0 };
  const Figures = figuresTab(stats);
  // A fresh element each render, as GatedTab passes <Screen {...props} />.
  const view = (focused) => React.createElement(store.Provider, null,
    React.createElement(TabFocusGate, { focused, delayMs: 20 }, React.createElement(Figures)));
  let renderer;
  act(() => { renderer = TestRenderer.create(view(true)); });
  act(() => { renderer.update(view(false)); });                    // the user switches to another tab
  await wait(40);                                                    // past the tab-switch fallback: paused
  const paused = stats.projections;
  for (let total = 101; total <= 120; total += 1) {
    act(() => { store.set({ total, privateMode: false }); renderer.update(view(false)); store.handle.notify(); });
  }
  assert.equal(stats.projections, paused, 'a hidden tab recomputes nothing on 20 edits');
  act(() => { renderer.update(view(true)); });                     // the tap that shows the tab
  assert.equal(shown(renderer), '100', 'the first frame on focus is the frame the tab was paused on');
  assert.equal(stats.projections, paused, 'no catch-up work on the tap itself');
  assert.equal(afterFrames.filter((job) => !job.cancelled).length, 1, 'the catch-up waits for the first frames');
  runFrames(afterFrames);
  assert.equal(shown(renderer), '120', 'after the first frames it shows the current store');
  assert.equal(stats.projections, paused + 1, 'exactly one catch-up');
  act(() => { renderer.unmount(); });
});

test('pre-warm: a never-opened hidden tab mounts once when its idle slot comes, then pauses; a real open cancels it', async () => {
  const afterFrames = []; const prewarmJobs = [];
  const { TabFocusGate } = gate({ afterFrames, prewarmJobs });
  const store = appStore({ total: 7, privateMode: false });
  const stats = { renders: 0, projections: 0 };
  const Figures = figuresTab(stats);
  const view = (focused) => React.createElement(store.Provider, null,
    React.createElement(TabFocusGate, { focused, delayMs: 20 }, React.createElement(Figures)));
  let renderer;
  act(() => { renderer = TestRenderer.create(view(false)); });     // NativeTabs mounts the hidden tab at launch
  assert.equal(stats.renders, 0, 'nothing renders at launch');
  assert.equal(prewarmJobs.length, 1, 'one pre-warm queued');
  act(() => { prewarmJobs[0].run(); });                            // its idle slot
  assert.equal(shown(renderer), '7', 'pre-warmed: the tab is rendered before its first open');
  await wait(40);
  const warmed = stats.projections;
  act(() => { store.set({ total: 8, privateMode: false }); renderer.update(view(false)); store.handle.notify(); });
  assert.equal(stats.projections, warmed, 'a pre-warmed hidden tab then pauses like a visited one');
  act(() => { renderer.update(view(true)); });                     // first open: a reveal, not a cold mount
  assert.equal(shown(renderer), '7');
  act(() => { renderer.unmount(); });

  const jobs = []; const frames = [];
  const second = gate({ afterFrames: frames, prewarmJobs: jobs });
  const statsTwo = { renders: 0, projections: 0 };
  const FiguresTwo = figuresTab(statsTwo);
  const viewTwo = (focused) => React.createElement(store.Provider, null,
    React.createElement(second.TabFocusGate, { focused, delayMs: 20 }, React.createElement(FiguresTwo)));
  let rendererTwo;
  act(() => { rendererTwo = TestRenderer.create(viewTwo(false)); });
  act(() => { rendererTwo.update(viewTwo(true)); });               // opened before its slot came
  assert.equal(jobs[0].cancelled, true, 'opening the tab drops its pre-warm');
  act(() => { rendererTwo.unmount(); });
});

test('pre-warm scheduler: one hidden tab per idle slot, in order, cancelled ones skipped, a recent tap defers it', () => {
  const slots = [];
  let blockedMs = 0;
  const prewarm = load(path.join(root, 'src/lib/tab-prewarm.ts'), {
    '@/lib/after-first-frames': { runAfterFirstFrames: (task, options) => {
      slots.push({ task, options }); return { cancel() {} };
    } },
    '@/lib/covered-screen-freeze': load(path.join(root, 'src/lib/covered-screen-freeze.ts'), {}),
    '@/lib/foreground-history-priority': { foregroundHistoryBlockedFor: () => blockedMs },
  });
  const ran = [];
  prewarm.scheduleTabPrewarm(() => ran.push('flow'));
  const bills = prewarm.scheduleTabPrewarm(() => ran.push('bills'));
  prewarm.scheduleTabPrewarm(() => ran.push('wallet'));
  assert.equal(slots.length, 1, 'never two tabs waiting on the same frames');
  assert.equal(slots[0].options.delayMs, 3000);
  assert.equal(slots[0].options.idle, undefined, 'waits for the foreground lease (the default)');
  blockedMs = 400;                                                   // the user tapped just before the slot
  slots.shift().task();
  assert.deepEqual(ran, [], 'a tap since the slot opened defers the mount');
  assert.equal(slots.length, 1, 'and the same tab waits for the next slot');
  blockedMs = 0;
  bills.cancel();
  slots.shift().task();
  assert.deepEqual(ran, ['flow']);
  assert.equal(slots.length, 1);
  slots.shift().task();
  assert.deepEqual(ran, ['flow', 'wallet'], 'a cancelled tab (opened meanwhile) is skipped');
  assert.equal(slots.length, 0);
});

test('pre-warm mounts in a transition, so React yields it to a tap', () => {
  const code = require('node:fs').readFileSync(path.join(root, 'src/components/ios-tab-gate.tsx'), 'utf8');
  assert.match(code, /scheduleTabPrewarm\(\(\) => startTransition\(\(\) => setVisited\(true\)\)\)/);
});

// The app store's real pass-through rule, the one store.tsx wires.
const appState = (state) => ({ state: { privateMode: false, onboarded: true, hydrated: true, transactions: [1, 2, 3], total: 3, ...state } });

test('appStoreMustBeLive: Private Mode, onboarding, hydration and an erased ledger pass through; an edit does not', () => {
  const held = appState({});
  assert.equal(pause.appStoreMustBeLive(appState({ privateMode: true }), held), true);
  assert.equal(pause.appStoreMustBeLive(appState({ onboarded: false }), held), true);
  assert.equal(pause.appStoreMustBeLive(appState({ hydrated: false }), held), true, 'Erase Everything blocks persistence');
  assert.equal(pause.appStoreMustBeLive(appState({ transactions: [] }), held), true, 'clearAll keeps onboarded: the emptied ledger itself passes');
  assert.equal(pause.appStoreMustBeLive(appState({ transactions: [1, 2, 3, 4] }), held), false, 'an ordinary edit stays held');
  assert.equal(pause.appStoreMustBeLive(appState({ transactions: [] }), appState({ transactions: [] })), false);
  const store = require('node:fs').readFileSync(path.join(root, 'src/lib/store.tsx'), 'utf8');
  assert.match(store, /createStorePauseBoundary<StoreValue>\(\s*StoreContext,\s*StoreHandleContext,\s*appStoreMustBeLive,\s*\)/,
    'store.tsx must pause with exactly this rule');
});

test('Erase Everything reaches a held tab at once through the real boundary and rule', () => {
  const AppBoundary = pause.createStorePauseBoundary(ValueContext, HandleContext, pause.appStoreMustBeLive);
  const store = appStore(appState({}));
  function Ledger() {
    const handle = React.useContext(HandleContext);
    const value = React.useSyncExternalStore(handle.subscribe, handle.get, handle.get);
    return React.createElement('ledger', null, String(value.state.transactions.length));
  }
  const view = () => React.createElement(store.Provider, null,
    React.createElement(AppBoundary, { paused: true }, React.createElement(Ledger)));
  let renderer;
  act(() => { renderer = TestRenderer.create(view()); });
  act(() => { store.set(appState({ transactions: [1, 2, 3, 4] })); renderer.update(view()); store.handle.notify(); });
  assert.equal(renderer.root.findByType('ledger').props.children, '3', 'an edit stays held while paused');
  act(() => { store.set(appState({ transactions: [] })); renderer.update(view()); store.handle.notify(); });
  assert.equal(renderer.root.findByType('ledger').props.children, '0', 'erased entries are never shown from a held frame');
  act(() => { renderer.unmount(); });
});
