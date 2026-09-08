'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHarness, walk } = require('./reference-harness.cjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Run the actual Home component AND ScreenScaffold. Keep the native primitives
// and asynchronous capture/reminder boundaries explicit; this verifies wiring
// and state, not Android touch interception, layout, or spinner animation.
function refreshHarness({ platform = 'android', empty = false, scan, reminders } = {}) {
  const h = createHarness({ empty });
  const stateSlots = [];
  const refSlots = [];
  const effectSlots = [];
  const pendingEffects = [];
  let cursor = 0;
  let refCursor = 0;
  let effectCursor = 0;
  let generation = 0;
  let period = empty ? { mode: 'month', key: '2026-09' } : { mode: 'all' };
  const calls = { scans: [], reminders: 0, reminderRevisions: [] };
  h.deps.react.useState = initial => {
    const index = cursor++;
    if (!Object.hasOwn(stateSlots, index)) {
      stateSlots[index] = typeof initial === 'function' ? initial() : initial;
    }
    return [stateSlots[index], next => {
      stateSlots[index] = typeof next === 'function' ? next(stateSlots[index]) : next;
    }];
  };
  h.deps.react.useRef = initial => {
    const index = refCursor++;
    if (!refSlots[index]) refSlots[index] = { current: initial };
    return refSlots[index];
  };
  h.deps.react.useEffect = (effect, dependencies) => {
    const index = effectCursor++;
    const previous = effectSlots[index];
    if (previous && dependencies && previous.dependencies &&
      dependencies.length === previous.dependencies.length &&
      dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) {
      previous.effect = effect;
      return;
    }
    const slot = { dependencies, effect, cleanup: previous?.cleanup };
    effectSlots[index] = slot;
    pendingEffects.push(() => { slot.cleanup?.(); slot.cleanup = effect(); });
  };
  h.deps.react.cloneElement = (element, props) => ({
    ...element, props: { ...element.props, ...props },
  });
  h.deps['react-native'].Platform.OS = platform;
  h.deps['@/components/themed-view'] = { ThemedView: props => h.jsx('View', props) };
  h.deps['@/components/ui/screen-header'] = { ScreenHeader: props => h.jsx('Header', props) };
  h.deps['@/hooks/use-keyboard-height'] = { useKeyboardHeight: () => 0 };
  h.deps['@/hooks/use-tab-bar-clearance'] = { useTabBarClearance: () => 88 };
  h.deps['react-native-safe-area-context'] = {
    useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
  };
  h.local('@/components/ui/screen-scaffold');
  h.deps['@/components/reference-home-summary'] = {
    ReferenceHomeSummary: props => h.jsx('Summary', props),
  };
  h.deps['@/lib/period-context'] = { usePeriod: () => ({ period }) };
  h.deps['@/lib/dashboard-projection'] = { projectDashboard: () => ({
    hero: { incomeFils: 0, expenseFils: 0, netFils: 0 },
    activityRows: period.mode === 'all' ? h.state.transactions : [],
    accountById: new Map(), internalTransactionIds: new Set(), upcoming: { items: [] },
    uncategorised: { shouldPrompt: false }, unreadFormats: { shouldPrompt: false },
  }) };
  h.deps['@/hooks/use-auto-import'] = { useAutoImport: () => ({
    captureState: 'waiting-for-alert', needsPermission: false,
    runAutoImport: async interactive => {
      calls.scans.push(interactive);
      if (scan) await scan;
    },
  }) };
  h.deps['@/lib/notifications'] = { syncPaymentReminders: async state => {
    calls.reminders += 1;
    calls.reminderRevisions.push(state.reminderRevision);
    if (typeof reminders === 'function') await reminders(state, calls.reminders);
    else if (reminders) await reminders;
  } };
  const store = h.deps['@/lib/store'].useStore();
  store.getStateGeneration = () => generation;
  const Home = h.local('@/screens/journal-home-screen').default;
  function render() {
    cursor = 0;
    refCursor = 0;
    effectCursor = 0;
    const tree = Home();
    while (pendingEffects.length) pendingEffects.shift()();
    const scroll = walk(tree).find(node => node.type === 'ScrollView');
    assert.ok(scroll, 'actual scaffold must keep one scroll owner for Home');
    assert.ok(scroll.props.refreshControl, 'actual scaffold must forward the native refresh control');
    return { tree, scroll, refresh: scroll.props.refreshControl.props };
  }
  function unmount() { for (const slot of effectSlots) slot.cleanup?.(); }
  return { ...h, calls, render, unmount,
    remount: () => { unmount(); stateSlots.length = 0; refSlots.length = 0; effectSlots.length = 0; return render(); },
    replayEffects: () => { unmount(); for (const slot of effectSlots) slot.cleanup = slot.effect(); },
    replaceLedger: () => { generation += 1; },
    setPeriod: next => { period = next; } };
}

for (const platform of ['android', 'ios']) {
  for (const empty of [false, true]) {
    test(`${platform}: ${empty ? 'empty current month' : 'populated all-time'} forwards refresh and starts capture`, async () => {
      const scan = deferred();
      const h = refreshHarness({ platform, empty, scan: scan.promise });
      const before = h.render();
      assert.equal(before.refresh.refreshing, false);
      assert.notEqual(before.scroll.props.scrollEnabled, false);
      assert.notEqual(before.refresh.enabled, false);
      const running = before.refresh.onRefresh();
      assert.deepEqual(h.calls.scans, [true]);
      assert.equal(h.render().refresh.refreshing, true);
      scan.resolve();
      await running;
      assert.equal(h.render().refresh.refreshing, false);
      assert.equal(h.calls.reminders, 1);
    });
  }
}

test('switching from all-time to an empty month retains one pending refresh and refuses a competing scan', async () => {
  const scan = deferred();
  const h = refreshHarness({ scan: scan.promise });
  const running = h.render().refresh.onRefresh();
  h.setPeriod({ mode: 'month', key: '2026-09' });
  const month = h.render();
  assert.ok(walk(month.tree).some(node => node.type === 'EmptyMonth'));
  assert.equal(month.refresh.refreshing, true, 'a period change does not falsely mark the in-flight scan complete');
  await month.refresh.onRefresh();
  assert.deepEqual(h.calls.scans, [true], 'already-refreshing guard is shared across the selected periods');
  scan.resolve(); await running;
  const finished = h.render();
  assert.equal(finished.refresh.refreshing, false);
  await finished.refresh.onRefresh();
  assert.deepEqual(h.calls.scans, [true, true], 'current month can refresh again after actual completion');
});

test('a rejected inbox scan clears Home refreshing and exposes the failure', async () => {
  const scan = deferred();
  const h = refreshHarness({ empty: true, scan: scan.promise });
  const running = h.render().refresh.onRefresh();
  scan.reject(new Error('synthetic inbox failure'));
  await running;
  assert.equal(h.render().refresh.refreshing, false);
  assert.equal(h.calls.reminders, 0);
  assert.equal(h.events.filter(event => event[0] === 'toast').length, 1);
});

test('completed capture clears Home refreshing while notification scheduling remains pending', async () => {
  const reminders = deferred();
  const h = refreshHarness({ empty: true, reminders: reminders.promise });
  const running = h.render().refresh.onRefresh();
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.calls.scans, [true]);
    assert.equal(h.calls.reminders, 1);
    assert.equal(h.render().refresh.refreshing, false, 'SMS refresh completion must not await native reminder scheduling');
  } finally { reminders.resolve(); await running; }
  assert.equal(h.render().refresh.refreshing, false);
});

test('a reminder failure is handled without reporting an SMS import failure', async () => {
  const reminders = deferred();
  const h = refreshHarness({ empty: true, reminders: reminders.promise });
  const running = h.render().refresh.onRefresh();
  await new Promise(resolve => setImmediate(resolve));
  reminders.reject(new Error('synthetic notification failure'));
  await running;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.render().refresh.refreshing, false);
  assert.deepEqual(h.events.filter(event => event[0] === 'toast'), []);
});

test('two pulls before a render cannot start competing capture operations', async () => {
  const scan = deferred();
  const h = refreshHarness({ empty: true, scan: scan.promise });
  const refresh = h.render().refresh.onRefresh;
  const first = refresh();
  const second = refresh();
  try {
    assert.deepEqual(h.calls.scans, [true], 'capture guard must take effect before React rerenders');
    assert.equal(h.render().refresh.refreshing, true);
  } finally { scan.resolve(); await Promise.all([first, second]); }
});

test('repeated successful pulls coalesce pending reminder requests using the latest ledger snapshot', async () => {
  const firstReminder = deferred();
  let concurrent = 0;
  let maximumConcurrent = 0;
  const h = refreshHarness({ empty: true, reminders: async (_state, invocation) => {
    concurrent += 1;
    maximumConcurrent = Math.max(maximumConcurrent, concurrent);
    try { if (invocation === 1) await firstReminder.promise; }
    finally { concurrent -= 1; }
  } });
  h.state.reminderRevision = 1;
  const first = h.render().refresh.onRefresh();
  await new Promise(resolve => setImmediate(resolve));
  try {
    h.state.reminderRevision = 2;
    await h.render().refresh.onRefresh();
    h.state.reminderRevision = 3;
    await h.render().refresh.onRefresh();
    assert.deepEqual(h.calls.scans, [true, true, true], 'finished SMS reads remain independently refreshable');
    assert.deepEqual(h.calls.reminderRevisions, [1], 'later pulls cannot overlap an unfinished reminder sync');
  } finally { firstReminder.resolve(); await first; }
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls.reminderRevisions, [1, 3], 'queued refresh reads the latest snapshot once');
  assert.equal(maximumConcurrent, 1);
});

test('unmount discards queued reminders and a new Home waits for the old native call', async () => {
  const native = deferred();
  let concurrent = 0;
  let maximumConcurrent = 0;
  const h = refreshHarness({ empty: true, reminders: async (_state, invocation) => {
    concurrent += 1; maximumConcurrent = Math.max(maximumConcurrent, concurrent);
    try { if (invocation === 1) await native.promise; }
    finally { concurrent -= 1; }
  } });
  h.state.reminderRevision = 1;
  await h.render().refresh.onRefresh();
  await new Promise(resolve => setImmediate(resolve));
  h.state.reminderRevision = 2;
  await h.render().refresh.onRefresh();
  h.unmount();
  h.state.reminderRevision = 3;
  try {
    await h.remount().refresh.onRefresh();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.calls.reminderRevisions, [1], 'new Home must wait for the uncancellable native call');
  } finally { native.resolve(); }
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls.reminderRevisions, [1, 3], 'dead Home must never issue its queued second call');
  assert.equal(maximumConcurrent, 1);
});

test('a capture that finishes after Home unmounts cannot enqueue reminders', async () => {
  const scan = deferred();
  const h = refreshHarness({ empty: true, scan: scan.promise });
  const running = h.render().refresh.onRefresh();
  h.unmount();
  scan.resolve(); await running;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.reminders, 0);
});

test('ledger replacement discards queued reminder work even when Home stays mounted', async () => {
  const native = deferred();
  const h = refreshHarness({ empty: true, reminders: (_state, invocation) => invocation === 1 ? native.promise : undefined });
  h.state.reminderRevision = 1;
  await h.render().refresh.onRefresh();
  await new Promise(resolve => setImmediate(resolve));
  h.state.reminderRevision = 2;
  await h.render().refresh.onRefresh();
  h.replaceLedger(); h.state.reminderRevision = 3;
  native.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls.reminderRevisions, [1]);
  await h.render().refresh.onRefresh();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls.reminderRevisions, [1, 3], 'a fresh capture can schedule for the replacement ledger');
});

test('ledger replacement during capture prevents reminders for that stale capture', async () => {
  const scan = deferred();
  const h = refreshHarness({ empty: true, scan: scan.promise });
  const running = h.render().refresh.onRefresh();
  h.replaceLedger();
  scan.resolve(); await running;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.reminders, 0);
  assert.equal(h.render().refresh.refreshing, false);
});

test('Strict Mode effect replay rearms Home refresh without allowing an old completion to enqueue reminders', async () => {
  const scan = deferred();
  const h = refreshHarness({ empty: true, scan: scan.promise });
  const old = h.render().refresh.onRefresh();
  h.replayEffects();
  scan.resolve(); await old;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.reminders, 0);
  await h.render().refresh.onRefresh();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.reminders, 1, 'the replayed setup must permit a fresh refresh');
});
