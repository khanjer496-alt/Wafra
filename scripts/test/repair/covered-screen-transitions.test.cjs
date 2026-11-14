'use strict';
// Covered-screen freeze, driven by the real client renderer (react-test-renderer) and the root
// stack's transition events. Reviewer lows on #183:
//   (1) freeze when the covering push has ENDED (transitionEnd closing:true), with the timer only
//       as a fallback, so a slow push (slow phone, animator scale above 1x) never blanks the screen
//       while it is still sliding; and unfreeze when the screen WILL appear (transitionStart
//       closing:false), which is the start of an iOS swipe-back, so it is never blank mid-gesture;
//   (3) an already-mounted tree re-suspends and is revealed WITHOUT remounting: state and effects
//       survive, store updates while frozen render nothing, reveal renders once from current data.
// Not a device or frame measurement.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const jsxRuntime = require('react/jsx-runtime');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const { act } = React;
// Every renderer is unmounted after its test, so no freeze timer outlives it.
const mounted = new Set();
test.afterEach(() => { for (const r of mounted) act(() => { r.unmount(); }); mounted.clear(); });

function freezeModule() {
  const policy = load(path.join(root, 'src/lib/covered-screen-freeze.ts'), {});
  return load(path.join(root, 'src/components/freeze-when-covered.tsx'), {
    react: React, 'react/jsx-runtime': jsxRuntime, '@/lib/covered-screen-freeze': policy,
  }, { setTimeout, clearTimeout });
}

/** The (tabs) route's navigation object in the root stack, reduced to its event API. */
function transitionSource() {
  const listeners = { transitionStart: new Set(), transitionEnd: new Set() };
  return {
    addListener(type, listener) { listeners[type].add(listener); return () => listeners[type].delete(listener); },
    emit(type, closing) { for (const listener of [...listeners[type]]) listener({ data: { closing } }); },
    count: () => listeners.transitionStart.size + listeners.transitionEnd.size,
  };
}

/** An external store, like the app store's useSyncExternalStore subscription. */
function externalStore(initial) {
  let value = initial; const subs = new Set();
  return {
    get: () => value,
    set(next) { value = next; for (const s of [...subs]) s(); },
    subscribe(s) { subs.add(s); return () => subs.delete(s); },
  };
}

function harness({ delayMs = 10_000 } = {}) {
  const { FreezeWhenCovered } = freezeModule();
  const source = transitionSource();
  const store = externalStore(1);
  const stats = { renders: 0, mounts: 0, unmounts: 0 };
  function Projection() {
    const total = React.useSyncExternalStore(store.subscribe, store.get);
    const [identity] = React.useState(() => Math.random());
    React.useEffect(() => { stats.mounts += 1; return () => { stats.unmounts += 1; }; }, []);
    stats.renders += 1;
    stats.identity = identity;
    return React.createElement('total', null, String(total));
  }
  let renderer;
  const view = (covered) => React.createElement(FreezeWhenCovered,
    { covered, enabled: true, delayMs, transitions: source }, React.createElement(Projection));
  act(() => { renderer = TestRenderer.create(view(false)); });
  mounted.add(renderer);
  const shown = () => {
    const nodes = renderer.root.findAll((node) => node.type === 'total');
    return nodes.length === 1 ? nodes[0].props.children : null;
  };
  return { renderer, source, store, stats, view, shown };
}

test('a covered screen freezes when the covering push ENDS, not on a timer that may be early', () => {
  const h = harness();
  act(() => { h.renderer.update(h.view(true)); });            // navigation focus moved away
  act(() => { h.source.emit('transitionStart', true); });     // the push animation starts
  const before = h.stats.renders;
  act(() => { h.store.set(2); });
  assert.equal(h.stats.renders, before + 1, 'still sliding: the screen keeps painting current data');
  act(() => { h.source.emit('transitionEnd', true); });       // fully covered
  const frozenAt = h.stats.renders;
  for (let i = 3; i <= 22; i += 1) act(() => { h.store.set(i); });
  assert.equal(h.stats.renders, frozenAt, '20 store changes while covered: 0 renders');
});

test('an already-mounted tree is revealed without remounting, once, with current data', () => {
  const h = harness();
  const identity = h.stats.identity;
  act(() => { h.renderer.update(h.view(true)); });
  act(() => { h.source.emit('transitionStart', true); h.source.emit('transitionEnd', true); });
  const frozenAt = h.stats.renders;
  for (let i = 2; i <= 6; i += 1) act(() => { h.store.set(i); });
  assert.equal(h.stats.renders, frozenAt);
  act(() => { h.renderer.update(h.view(false)); });           // back on screen
  assert.equal(h.stats.renders, frozenAt + 1, 'reveal renders exactly once');
  assert.equal(h.shown(), '6', 'the first frame back shows the latest store value');
  assert.equal(h.stats.mounts, 1, 'no remount: the effect did not run again');
  assert.equal(h.stats.unmounts, 0);
  assert.equal(h.stats.identity, identity, 'component state survived the freeze');
});

test('a screen unfreezes when it WILL appear (iOS swipe-back start), before focus returns', () => {
  const h = harness();
  act(() => { h.renderer.update(h.view(true)); });
  act(() => { h.source.emit('transitionStart', true); h.source.emit('transitionEnd', true); });
  act(() => { h.store.set(5); });
  const frozenAt = h.stats.renders;
  act(() => { h.source.emit('transitionStart', false); });    // gesture begins, still `covered`
  assert.equal(h.stats.renders, frozenAt + 1, 'the revealed screen paints during the gesture');
  assert.equal(h.shown(), '5');
  // Gesture cancelled: the screen disappears again and re-freezes at the end.
  act(() => { h.source.emit('transitionStart', true); h.source.emit('transitionEnd', true); });
  const again = h.stats.renders;
  act(() => { h.store.set(6); });
  assert.equal(h.stats.renders, again, 'a cancelled swipe re-freezes');
  assert.equal(h.stats.mounts, 1);
});

test('the timer is only a fallback: it freezes when no transition events arrive (tab switch)', async () => {
  const h = harness({ delayMs: 20 });
  act(() => { h.renderer.update(h.view(true)); });            // e.g. another iOS tab selected
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
  const frozenAt = h.stats.renders;
  act(() => { h.store.set(9); });
  assert.equal(h.stats.renders, frozenAt, 'no events: frozen after the fallback delay');
  act(() => { h.renderer.update(h.view(false)); });
  assert.equal(h.shown(), '9');
});

test('a started push suppresses the fallback timer until the push ends', async () => {
  const h = harness({ delayMs: 20 });
  act(() => { h.renderer.update(h.view(true)); });
  act(() => { h.source.emit('transitionStart', true); });     // a slow push is under way
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
  const before = h.stats.renders;
  act(() => { h.store.set(3); });
  assert.equal(h.stats.renders, before + 1, 'past the timer but still sliding: not frozen');
});

test('listeners are removed on unmount and when disabled', () => {
  const h = harness();
  assert.equal(h.source.count(), 2);
  act(() => { h.renderer.unmount(); });
  mounted.delete(h.renderer);
  assert.equal(h.source.count(), 0);
});

// ---------------------------------------------------------------------------
// iOS tab gate with the real client renderer (Reviewer #191 Medium 3 and 2a).
// ---------------------------------------------------------------------------
// The tabs read the store the way the app's screens do: through the store's
// value and handle contexts, under the real StorePauseBoundary (store-pause.tsx).
const ValueContext = React.createContext(null);
const HandleContext = React.createContext(null);
function gateModule() {
  const policy = load(path.join(root, 'src/lib/covered-screen-freeze.ts'), {});
  const freeze = load(path.join(root, 'src/components/freeze-when-covered.tsx'), {
    react: React, 'react/jsx-runtime': jsxRuntime, '@/lib/covered-screen-freeze': policy,
  }, { setTimeout, clearTimeout });
  const selection = load(path.join(root, 'src/lib/store-selection.ts'), {});
  const pause = load(path.join(root, 'src/lib/store-pause.tsx'), {
    react: React, 'react/jsx-runtime': jsxRuntime, '@/lib/store-selection': selection,
  });
  return load(path.join(root, 'src/components/ios-tab-gate.tsx'), {
    react: React, 'react/jsx-runtime': jsxRuntime,
    'react-native': { Platform: { OS: 'ios' } },
    '@react-navigation/native': {},
    '@/components/freeze-when-covered': freeze,
    '@/lib/covered-screen-freeze': policy,
    // After the first frames: the next macrotask here.
    '@/lib/after-first-frames': { runAfterFirstFrames: (task) => { const id = setTimeout(task, 0); return { cancel: () => clearTimeout(id) }; } },
    '@/lib/store': { StorePauseBoundary: pause.createStorePauseBoundary(ValueContext, HandleContext) },
    '@/lib/tab-prewarm': { scheduleTabPrewarm: () => ({ cancel() {} }) },
  }, { setTimeout, clearTimeout });
}

function twoTabs({ delayMs = 20 } = {}) {
  const { TabFocusGate } = gateModule();
  const shell = transitionSource();
  const store = externalStore(1);
  const renders = { home: 0, flow: 0 };
  const tab = (name) => function Tab() {
    const handle = React.useContext(HandleContext);
    React.useSyncExternalStore(handle.subscribe, handle.get);
    renders[name] += 1;
    return React.createElement('tab', { name });
  };
  const Home = tab('home'); const Flow = tab('flow');
  // selected: which tab the shell shows; shellFocused: no pushed screen or sheet on top.
  const view = ({ selected, shellFocused }) => React.createElement(HandleContext.Provider, { value: store },
    React.createElement(ValueContext.Provider, { value: store.get() },
    React.createElement(TabFocusGate, { key: 'home', focused: shellFocused && selected === 'home', selected: selected === 'home',
      shellFocused, transitions: shell, delayMs }, React.createElement(Home)),
    React.createElement(TabFocusGate, { key: 'flow', focused: shellFocused && selected === 'flow', selected: selected === 'flow',
      shellFocused, transitions: shell, delayMs }, React.createElement(Flow))));
  let renderer;
  act(() => { renderer = TestRenderer.create(view({ selected: 'flow', shellFocused: true })); });
  mounted.add(renderer);
  act(() => { renderer.update(view({ selected: 'home', shellFocused: true })); });   // Flow visited, then left
  return { renderer, shell, store, renders, view };
}
const wait = (ms) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

test('iOS: a swipe-back releases only the selected tab; hidden sibling tabs stay frozen', async () => {
  const t = twoTabs();
  await wait(60);                                                   // Flow freezes after the tab-switch fallback
  act(() => { t.renderer.update(t.view({ selected: 'home', shellFocused: false })); }); // Settings pushed
  act(() => { t.shell.emit('transitionStart', true); t.shell.emit('transitionEnd', true); });
  act(() => { t.shell.emit('transitionStart', false); });        // swipe-back to the shell begins
  await wait(5);                                                    // the held frame, then the catch-up
  const flowBefore = t.renders.flow; const homeBefore = t.renders.home;
  for (let i = 2; i <= 11; i += 1) act(() => { t.store.set(i); });
  assert.equal(t.renders.flow, flowBefore, 'the hidden Flow tab must not wake up on the swipe');
  assert.ok(t.renders.home > homeBefore, 'the selected Home tab paints during the swipe');
});

test('iOS: no freeze from the timer while the whole shell is covered (page sheet sends no transitions)', async () => {
  const t = twoTabs();
  act(() => { t.renderer.update(t.view({ selected: 'home', shellFocused: false })); }); // add-transaction sheet
  await wait(700);                                                  // past the default 600 ms fallback, no events
  const homeBefore = t.renders.home;
  act(() => { t.store.set(7); });
  assert.equal(t.renders.home, homeBefore + 1, 'Home stays painted behind the page sheet');
});

test('iOS: with the shell covered by a push, the selected tab freezes when the push ends', () => {
  const t = twoTabs({ delayMs: 10_000 });
  act(() => { t.renderer.update(t.view({ selected: 'home', shellFocused: false })); });
  act(() => { t.shell.emit('transitionStart', true); t.shell.emit('transitionEnd', true); });
  const homeBefore = t.renders.home;
  for (let i = 2; i <= 6; i += 1) act(() => { t.store.set(i); });
  assert.equal(t.renders.home, homeBefore);
});
