'use strict';

// Real screen hooks with deterministic focus/effect scheduling. These assertions
// count ledger work; they do not pretend to measure native frames or phone speed.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHarness, walk } = require('./reference-harness.cjs');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');

function screenProbe(file, platform = 'ios', options = {}) {
  const h = createHarness({ ...options, platform });
  let state = h.state;
  let focused = true;
  let cursor = 0;
  const slots = [];
  const refs = [];
  const effects = [];
  const timers = new Map();
  const interactions = [];
  const frames = new Map();
  let nextId = 0;
  function same(a, b) { return a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i])); }
  function memo(factory, dependencies) {
    const i = cursor++;
    if (!slots[i] || !same(slots[i].dependencies, dependencies)) slots[i] = { value: factory(), dependencies };
    return slots[i].value;
  }
  function effect(work, dependencies) {
    const i = cursor++;
    if (slots[i] && same(slots[i].dependencies, dependencies)) return;
    const previous = slots[i];
    const slot = slots[i] = { dependencies };
    effects.push(() => { previous?.cleanup?.(); slot.cleanup = work(); });
  }
  Object.assign(h.deps.react, {
    useMemo: memo, useCallback: (fn, dependencies) => memo(() => fn, dependencies),
    useRef: initial => memo(() => { const ref = { current: initial }; refs.push(ref); return ref; }, []),
    useState: initial => {
      const cell = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []);
      return [cell.value, next => { cell.value = typeof next === 'function' ? next(cell.value) : next; }];
    },
    useEffect: effect, startTransition: work => work(),
  });
  h.deps['@react-navigation/native'] = {
    useIsFocused: () => focused,
    useFocusEffect: callback => effect(() => focused ? callback() : undefined, [focused, callback]),
  };
  h.deps['react-native'].InteractionManager = { runAfterInteractions: work => {
    const entry = { work, cancelled: false };
    interactions.push(entry);
    return { cancel() { entry.cancelled = true; } };
  } };
  const store = h.deps['@/lib/store'].useStore();
  h.deps['@/lib/store'] = { useStore: () => ({ ...store, state, getStateSnapshot: () => state }) };
  const jsx = (type, props, key) => ({ type, props, key });
  h.deps['react/jsx-runtime'] = { jsx, jsxs: jsx, Fragment: 'Fragment' };
  const globals = {
    setTimeout(work, delay) { const id = ++nextId; timers.set(id, { work, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(work) { const id = ++nextId; frames.set(id, work); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  let Component;
  return {
    deps: h.deps,
    get state() { return state; },
    set state(next) { state = next; },
    set focused(next) { focused = next; },
    render() {
      Component ??= load(path.join(root, file), h.deps, globals).default;
      cursor = 0;
      const tree = Component();
      while (effects.length) effects.shift()();
      return tree;
    },
    interactions() { while (interactions.length) { const entry = interactions.shift(); if (!entry.cancelled) entry.work(); } },
    timers(delay) {
      for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.work(); }
    },
    frames() { while (frames.size) { const [id, work] = frames.entries().next().value; frames.delete(id); work(0); } },
    refsRetain(target) {
      const seen = new Set();
      const contains = value => {
        if (value === target) return true;
        if (!value || typeof value !== 'object' || seen.has(value)) return false;
        seen.add(value);
        return Object.values(value).some(contains);
      };
      return refs.some(ref => contains(ref.current));
    },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

for (const platform of ['ios', 'android']) {
  test(`${platform} Bills paints before recurrence analysis and publishes cooperative results`, async () => {
    const p = screenProbe('src/app/(tabs)/bills.tsx', platform);
    const subscriptions = p.deps['@/lib/subscriptions'];
    const expected = subscriptions.detectSubscriptions();
    let synchronous = 0;
    let cooperative = 0;
    subscriptions.detectSubscriptions = () => { synchronous += 1; return expected; };
    subscriptions.detectSubscriptionsCooperatively = async () => { cooperative += 1; return expected; };
    let visible;
    subscriptions.trueSubscriptions = rows => { visible = rows; return rows; };
    p.render();
    assert.equal(synchronous, 0, 'first paint must not synchronously walk recurrence history');
    assert.equal(cooperative, 0, 'first paint must precede optional historical analysis');
    if (platform === 'android') {
      p.interactions(); p.frames();
      await Promise.resolve();
      assert.equal(cooperative, 0, 'Android keeps its initial navigation grace after painting');
      p.timers(4_000);
    }
    p.interactions(); p.frames();
    await Promise.resolve();
    assert.equal(cooperative, 1, 'focused native screen must schedule the cooperative detector');
    p.render();
    assert.equal(visible, expected, 'finished analysis must become the visible recurrence source');
    assert.equal(synchronous, 0);
    p.dispose();
  });

  test(`${platform} Bills cancels recurrence publication on blur and resumes on refocus`, async () => {
    const p = screenProbe('src/app/(tabs)/bills.tsx', platform);
    const subscriptions = p.deps['@/lib/subscriptions'];
    const expected = subscriptions.detectSubscriptions();
    const jobs = [];
    subscriptions.detectSubscriptionsCooperatively = (...args) => new Promise(resolve => jobs.push({ resolve, cancelled: args[5] }));
    let visible;
    subscriptions.trueSubscriptions = rows => { visible = rows; return rows; };
    p.render(); p.timers(4_000); p.interactions(); p.frames();
    assert.equal(jobs.length, 1);
    p.focused = false; p.render();
    assert.equal(jobs[0].cancelled(), true, 'blur must reach the cooperative detector cancellation callback');
    jobs[0].resolve(expected); await Promise.resolve(); p.render();
    assert.equal(visible.length, 0, 'a completed cancelled job must not publish after blur');
    p.focused = true; p.render(); p.timers(4_000); p.interactions(); p.frames();
    assert.equal(jobs.length, 2, 'refocus must restart unfinished analysis');
    jobs[1].resolve(expected); await Promise.resolve(); p.render();
    assert.equal(visible, expected);
    p.dispose();
  });
}

test('iOS Bills reuses cached results and keeps existing rows while a changed ledger refreshes', async () => {
  const p = screenProbe('src/app/(tabs)/bills.tsx');
  const subscriptions = p.deps['@/lib/subscriptions'];
  const expected = subscriptions.detectSubscriptions();
  const originalRows = p.state.transactions;
  subscriptions.detectSubscriptions = () => { throw new Error('native render called synchronous recurrence'); };
  subscriptions.peekSubscriptionDetection = rows => rows === originalRows ? expected : null;
  const jobs = [];
  subscriptions.detectSubscriptionsCooperatively = (...args) => new Promise(resolve => jobs.push({ resolve, cancelled: args[5] }));
  let visible;
  subscriptions.trueSubscriptions = rows => { visible = rows; return rows; };
  p.render(); p.render(); p.timers(4_000); p.interactions(); p.frames();
  assert.equal(visible, expected, 'shared cache must appear on the first frame');
  assert.equal(jobs.length, 0, 'a shared cache hit must not repeat historical analysis');
  p.state = { ...p.state, transactions: [...p.state.transactions] };
  p.render(); p.interactions(); p.frames();
  assert.equal(visible, expected, 'refresh keeps the previous answer visible');
  assert.equal(jobs.length, 1, 'a changed ledger with existing results starts without the initial grace delay');
  p.state = { ...p.state, notSubscriptions: [expected[0].title] };
  p.render(); p.interactions(); p.frames();
  assert.equal(visible.some(row => row.title === expected[0].title), false, 'dismissed merchants disappear before refresh completes');
  assert.equal(jobs[0].cancelled(), true, 'changed analysis inputs cancel the older snapshot');
  jobs[0].resolve(expected); await Promise.resolve(); p.render();
  assert.equal(visible.some(row => row.title === expected[0].title), false, 'late old results cannot restore a dismissed merchant');
  assert.equal(jobs.length, 2);
  const updated = expected.slice(1);
  jobs[1].resolve(updated); await Promise.resolve(); p.render();
  assert.equal(visible, updated);
  p.dispose();
});

for (const empty of [false, true]) {
  test(`iOS Bills marks pending recurrence honestly with ${empty ? 'no' : 'known'} obligations`, async () => {
    const p = screenProbe('src/app/(tabs)/bills.tsx', 'ios', { empty });
    let finish;
    p.deps['@/lib/subscriptions'].detectSubscriptionsCooperatively = () => new Promise(resolve => { finish = resolve; });
    const nodes = tree => walk(tree).flatMap(node => [node, ...(node.props?.bandContent ? walk(node.props.bandContent) : [])]);
    const initial = nodes(p.render());
    assert.ok(initial.some(node => node.props?.testID === 'bills-summary-pending'), 'pending analysis must have a visible status');
    assert.equal(initial.some(node => node.props?.testID === 'bills-summary'), false, 'incomplete recurrence must not present a complete total');
    const agendas = initial.filter(node => node.props?.onOpen && Array.isArray(node.props?.items));
    assert.equal(agendas.some(node => node.props.items.length === 0), false, 'pending must not render an empty agenda verdict');
    assert.equal(agendas.some(node => node.props.items.some(item => item.kind === 'bill')), !empty, 'known bills stay available during analysis');
    assert.equal(agendas.some(node => node.props.items.some(item => item.kind === 'card')), !empty, 'known statements stay available during analysis');
    p.interactions(); p.frames();
    assert.equal(typeof finish, 'function', 'iOS starts after paint without Android grace delay');
    finish([]); await Promise.resolve();
    const completed = nodes(p.render());
    assert.equal(completed.some(node => node.props?.testID === 'bills-summary-pending'), false);
    assert.ok(completed.some(node => node.props?.testID === 'bills-summary'), 'a completed empty analysis can show the total');
    p.dispose();
  });
}

test('Home cancels queued insight work on blur and defers changed ledgers until refocus', () => {
  const p = screenProbe('src/screens/journal-home-screen.tsx');
  const analysed = [];
  p.deps['@/lib/dashboard-projection'].projectDashboardInsight = state => { analysed.push(state.transactions); return null; };
  p.render(); p.interactions(); p.timers(1_800); p.render();
  // Insight is now ready and queued, but the user switches tabs before it runs.
  p.focused = false; p.render(); p.interactions();
  assert.equal(analysed.length, 0, 'blur must cancel an already queued historical insight');
  p.state = { ...p.state, transactions: [...p.state.transactions] };
  p.render(); p.interactions();
  assert.equal(analysed.length, 0, 'new ledger snapshots must not schedule hidden Home analysis');
  p.focused = true; p.render(); p.interactions();
  assert.equal(analysed.length, 1, 'returning to Home must analyse the latest snapshot');
  assert.equal(analysed[0], p.state.transactions);
  p.focused = false; p.render(); p.focused = true; p.render(); p.interactions();
  assert.equal(analysed.length, 1, 'unchanged tab switching must reuse the completed insight');
  const completedLedger = p.state.transactions;
  assert.equal(p.refsRetain(completedLedger), true, 'the probe must observe the completed snapshot before invalidation');
  p.focused = false; p.render();
  p.state = { ...p.state, transactions: [...p.state.transactions] };
  p.render(); p.interactions();
  assert.equal(p.refsRetain(completedLedger), false, 'hidden Home must release obsolete completed ledger references');
  assert.equal(analysed.length, 1, 'releasing an obsolete cache must not schedule hidden analysis');
  p.focused = true; p.render(); p.interactions();
  assert.equal(analysed.length, 2);
  assert.equal(analysed[1], p.state.transactions);
  p.dispose();
});


test('Home recomputes completed insights when the custom category catalog changes', () => {
  const p = screenProbe('src/screens/journal-home-screen.tsx');
  const analysed = [];
  p.deps['@/lib/dashboard-projection'].projectDashboardInsight = state => { analysed.push(state.customCategories); return null; };
  p.render(); p.interactions(); p.timers(1_800); p.render(); p.interactions();
  assert.equal(analysed.length, 1);
  const updated = [{ id: 'custom:work', name: 'Work meals', type: 'expense', icon: 'briefcase' }];
  p.state = { ...p.state, customCategories: updated };
  p.render(); p.interactions();
  assert.equal(analysed.length, 2, 'catalog edits must invalidate completed insight labels');
  assert.equal(analysed[1], updated);
  p.focused = false; p.render(); p.focused = true; p.render(); p.interactions();
  assert.equal(analysed.length, 2, 'unchanged catalog still reuses completed work');
  p.dispose();
});
