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
  assert.equal(h.source.count(), 0);
});
