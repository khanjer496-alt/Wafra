'use strict';
// Reopening Wafra on Android: what runs in the first frames, and how Home's
// coins move. The coin groups run on one native-driven clock (no JS timers
// between coins), nothing starts while the app is in the background, behind
// App Lock or under the launch splash, deferred work waits for real frames
// and the foreground lease, and a resume with the same figures does not
// rewrite the widgets. Source components with explicit native boundaries;
// these assertions count requests, they do not measure device frames.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { createHarness, walk } = require('./reference-harness.cjs');
const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const theme = load(path.join(root, 'src/constants/theme.ts'), { '@/global.css': {}, 'react-native': { Platform: { select: (o) => o.android } } });

// ── Core Animated with real value arithmetic ─────────────────────────────
// Values hold numbers; interpolations and sums compute from their parents, so
// a test can move a clock and read where each coin is drawn.
function animatedModel() {
  const log = { timings: [], jsTimed: [], stops: 0 };
  const interpolate = (input, { inputRange, outputRange, extrapolate }) => {
    const last = inputRange.length - 1;
    let i = 1;
    while (i < last && input > inputRange[i]) i += 1;
    const [a, b] = [inputRange[i - 1], inputRange[i]];
    let x = input;
    if (extrapolate === 'clamp') x = Math.min(inputRange[last], Math.max(inputRange[0], x));
    const share = b === a ? 0 : (x - a) / (b - a);
    return outputRange[i - 1] + (outputRange[i] - outputRange[i - 1]) * share;
  };
  class Node { interpolate(config) { return new Interpolation(this, config); } }
  class Value extends Node {
    constructor(value) { super(); this.value = value; }
    setValue(value) { this.value = value; }
  }
  class Interpolation extends Node {
    constructor(parent, config) { super(); this.parent = parent; this.config = config; }
    get value() { return interpolate(this.parent.value, this.config); }
  }
  class Addition extends Node {
    constructor(a, b) { super(); this.a = a; this.b = b; }
    get value() { return this.a.value + this.b.value; }
  }
  const jsTimed = (name) => () => { log.jsTimed.push(name); return { start() {}, stop() {} }; };
  const Animated = {
    View: 'Animated.View', Value, add: (a, b) => new Addition(a, b),
    timing: (value, config) => ({ start() { log.timings.push({ value, config }); }, stop() { log.stops += 1; } }),
    spring: jsTimed('spring'), delay: jsTimed('delay'), sequence: jsTimed('sequence'),
    parallel: jsTimed('parallel'), stagger: jsTimed('stagger'),
  };
  return { Animated, Value, Addition, log };
}

/** Hooks that persist across renders; effects run after each render and clean up like React's. */
function hookRuntime() {
  let cursor = 0;
  const slots = [];
  const effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const memo = (factory, dependencies) => {
    const i = cursor++;
    if (!slots[i] || !same(slots[i].dependencies, dependencies)) slots[i] = { value: factory(), dependencies };
    return slots[i].value;
  };
  const react = {
    memo: (component) => component, Fragment: 'Fragment',
    useMemo: memo, useCallback: (fn, dependencies) => memo(() => fn, dependencies),
    useRef: (initial) => memo(() => ({ current: initial }), []),
    useState: (initial) => {
      const cell = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []);
      return [cell.value, (next) => { cell.value = typeof next === 'function' ? next(cell.value) : next; }];
    },
    useEffect: (work, dependencies) => {
      const i = cursor++;
      if (slots[i] && same(slots[i].dependencies, dependencies)) return;
      const previous = slots[i];
      const slot = slots[i] = { dependencies };
      effects.push(() => { previous?.cleanup?.(); slot.cleanup = work(); });
    },
    useSyncExternalStore: (_subscribe, get) => get(),
  };
  return {
    react,
    render(component) {
      cursor = 0;
      const tree = component();
      while (effects.length) effects.shift()();
      return tree;
    },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

/** The shipping CoinStack, on the model above, with a mutable motion/foreground environment. */
function stackProbe(env = {}) {
  const model = animatedModel();
  const runtime = hookRuntime();
  const environment = { active: true, ready: true, reducedMotion: false, ...env };
  const native = { Animated: model.Animated, View: 'View', Platform: { OS: 'android' } };
  const motion = load(path.join(root, 'src/components/ui/coins/coin-motion.ts'), {
    react: runtime.react, 'react-native': native, '@/constants/theme': theme,
  });
  const jsx = (type, props, key) => ({ type, props, key });
  const { CoinStack, stackSteps } = load(path.join(root, 'src/components/ui/coins/coin-stack.tsx'), {
    react: runtime.react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'react-native': native,
    '@/components/ui/coins/coin-disc': { CoinDisc: 'CoinDisc', GOLD: {}, discGeometry: (width) => ({ width, face: 8, edge: 3, height: 11 }) },
    '@/constants/theme': theme, '@/components/ui/coins/coin-motion': motion,
    '@/hooks/use-app-active': { useAppActive: () => environment.active },
    '@/hooks/use-reduced-motion': { useMotionPreference: () => ({ ready: environment.ready, reducedMotion: environment.reducedMotion }) },
  });
  let props = { total: 8, filled: 3, width: 22, ghost: {}, testID: 'stack' };
  const coins = (tree) => walk(tree).filter((node) => typeof node.type === 'function' && node.props?.shown).map((node) => node.props.shown);
  return {
    model, motion, environment, stackSteps,
    render(next = {}) { props = { ...props, ...next }; return coins(runtime.render(() => CoinStack(props))); },
    dispose: runtime.dispose,
  };
}
const valuesAt = (coins) => coins.map((coin) => Math.round(coin.value * 1000) / 1000);

test('a stack drops in on ONE native-driven clock; empty places never move', () => {
  const p = stackProbe();
  const coins = p.render();
  assert.equal(p.model.log.timings.length, 1, 'one animation for the whole stack, not one per coin');
  assert.deepEqual(p.model.log.jsTimed, [], 'no Animated.delay/sequence/spring timers between coins');
  const [{ value: clock, config }] = p.model.log.timings;
  assert.equal(config.useNativeDriver, true);
  assert.equal(config.isInteraction, false);
  assert.equal(config.easing(0.25), 0.25, 'linear time: the spring lives in each coin\'s window');
  const base = clock.value;
  assert.equal(config.toValue - base, config.duration);
  // Gold coins read the clock; the five empty places are plain values, untouched.
  assert.deepEqual(coins.map((coin) => coin instanceof p.model.Addition), [true, true, true, false, false, false, false, false]);
  assert.deepEqual(valuesAt(coins), [0, 0, 0, 0, 0, 0, 0, 0], 'from the bottom, nothing shown yet');
  // Each coin starts 45ms after the one below it and overshoots its landing (the squash).
  for (const [index, coin] of coins.slice(0, 3).entries()) {
    clock.setValue(base + index * 45);
    assert.equal(coin.value, 0, `coin ${index} waits for its turn`);
    let peak = 0;
    for (let t = 0; t <= 1500; t += 4) { clock.setValue(base + index * 45 + t); peak = Math.max(peak, coin.value); }
    assert.ok(peak > 1.12 && peak < 1.25, `coin ${index} bounces once (${peak})`);
  }
  clock.setValue(config.toValue);
  assert.deepEqual(valuesAt(coins), [1, 1, 1, 0, 0, 0, 0, 0], 'the run ends with every coin at rest on its level');
  p.dispose();
});

test('a later change drains from the old top down on a new window, with no flash between runs', () => {
  const p = stackProbe();
  p.render();
  const first = p.model.log.timings[0];
  first.value.setValue(first.config.toValue);
  const coins = p.render({ filled: 1 });
  assert.equal(p.model.log.timings.length, 2);
  assert.deepEqual(p.model.log.jsTimed, []);
  const second = p.model.log.timings[1];
  assert.equal(second.value, first.value, 'the same clock, moving forward');
  assert.ok(second.value.value >= first.config.toValue, 'the new window starts after the old one');
  assert.deepEqual(coins.map((coin) => coin instanceof p.model.Addition), [false, true, true, false, false, false, false, false],
    'only the two lifted coins move');
  // Where the clock stood before the new run: still the old level (no jump).
  second.value.setValue(first.config.toValue);
  assert.deepEqual(valuesAt(coins), [1, 1, 1, 0, 0, 0, 0, 0]);
  // The old top (coin 2) lifts first, coin 1 a stagger later.
  const base = second.config.toValue - second.config.duration;
  second.value.setValue(base + 40);
  assert.ok(coins[2].value < 1 && coins[1].value === 1);
  second.value.setValue(second.config.toValue);
  assert.deepEqual(valuesAt(coins), [1, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(JSON.parse(JSON.stringify(p.stackSteps(8, 3, 1).map((step) => step && [step.at, step.from, step.to]))),
    [null, [45, 1, 0], [0, 1, 0], null, null, null, null, null]);
  p.dispose();
});

test('nothing moves while the app is in the background: a change there lands at once and never replays', () => {
  const p = stackProbe();
  p.render();
  const first = p.model.log.timings[0];
  // A headless bank capture lands while Wafra is paused; Android would freeze a run and finish it in a clump.
  p.environment.active = false;
  const coins = p.render({ filled: 6 });
  assert.equal(p.model.log.timings.length, 1, 'no run starts in the background');
  assert.equal(first.value.value, first.config.toValue, 'the run in flight landed at its end');
  assert.deepEqual(valuesAt(coins), [1, 1, 1, 1, 1, 1, 0, 0], 'the new level, drawn at once');
  assert.ok(coins.every((coin) => coin instanceof p.model.Value), 'plain values, not tied to any clock');
  p.environment.active = true;
  assert.deepEqual(valuesAt(p.render()), [1, 1, 1, 1, 1, 1, 0, 0]);
  assert.equal(p.model.log.timings.length, 1, 'returning to the foreground does not replay what changed away');
  p.dispose();
});

test('the first reveal waits behind the lock or splash (hold), then plays once', () => {
  const p = stackProbe();
  const held = p.render({ hold: true });
  assert.equal(p.model.log.timings.length, 0);
  assert.deepEqual(valuesAt(held), [0, 0, 0, 0, 0, 0, 0, 0], 'held below the stack, not shown finished behind the lock');
  p.render({ hold: true, filled: 4 });
  assert.equal(p.model.log.timings.length, 0);
  const shown = p.render({ hold: false });
  assert.equal(p.model.log.timings.length, 1, 'unlocked: the drop-in plays');
  const [{ value: clock, config }] = p.model.log.timings;
  clock.setValue(config.toValue);
  assert.deepEqual(valuesAt(shown), [1, 1, 1, 1, 0, 0, 0, 0]);
  // Re-locked and unlocked with the same level: nothing replays.
  p.render({ hold: true });
  p.render({ hold: false });
  assert.equal(p.model.log.timings.length, 1);
  p.dispose();
});

test('Reduce Motion and the screen-reader wait keep their contracts; unmount lands the run', () => {
  const reduced = stackProbe({ reducedMotion: true });
  assert.deepEqual(valuesAt(reduced.render()), [1, 1, 1, 0, 0, 0, 0, 0]);
  assert.equal(reduced.model.log.timings.length, 0);
  reduced.dispose();
  const waiting = stackProbe({ ready: false });
  assert.deepEqual(valuesAt(waiting.render()), [0, 0, 0, 0, 0, 0, 0, 0], 'held until the screen-reader answer');
  assert.equal(waiting.model.log.timings.length, 0);
  waiting.environment.ready = true;
  waiting.render();
  assert.equal(waiting.model.log.timings.length, 1);
  const [{ value: clock, config }] = waiting.model.log.timings;
  waiting.dispose();
  assert.equal(clock.value, config.toValue, 'unmounted mid-run, the clock lands at the end');
  assert.equal(waiting.model.log.stops, 1);
});

test('the sampled springs follow Animated.spring: one bounce for a rise, none for a move, ending exactly at rest', () => {
  const { motion } = stackProbe();
  const rise = motion.COIN_RISE_CURVE;
  const move = motion.COIN_MOVE_CURVE;
  for (const curve of [rise, move]) {
    assert.equal(curve.times[0], 0);
    assert.equal(curve.values[0], 0);
    assert.equal(curve.values.at(-1), 1);
    assert.ok(curve.times.every((t, i) => i === 0 || t > curve.times[i - 1]));
    assert.ok(curve.times.length < 40, 'thinned for the native interpolation');
  }
  assert.ok(Math.max(...rise.values) > 1.12, 'COIN_RISE overshoots past the squash point');
  assert.ok(Math.max(...move.values) <= 1, 'COIN_MOVE clamps its overshoot');
  assert.ok(rise.restMs > 600 && rise.restMs < 1600, `rise rests when RN would (${rise.restMs})`);
  assert.ok(move.restMs < rise.restMs);
});

test('no coin group drives its stagger with JS timers', () => {
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const stack = strip(read('src/components/ui/coins/coin-stack.tsx'));
  const summary = strip(read('src/components/reference-home-summary.tsx'));
  const home = strip(read('src/screens/journal-home-screen.tsx'));
  const section = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));
  const groups = {
    CoinStack: stack,
    AverageColumns: section(summary, 'const AverageColumns', 'function FlowStacks'),
    ArrivingRow: section(home, 'export function ArrivingRow', 'const HOME_REVEAL_QUIET_MS'),
  };
  for (const [name, source] of Object.entries(groups)) {
    assert.ok(source.length > 200, name);
    assert.doesNotMatch(source, /Animated\.(delay|sequence|stagger|spring|parallel)\(|setTimeout\(|requestAnimationFrame\(/, name);
    assert.match(source, /useCoinClock\(\)/, `${name} owns one clock`);
    assert.match(source, /useCoinRun\(/, `${name} runs it once`);
  }
});

// ── Home: the coins wait for the splash, the lock and the foreground ──────
function homeTimings({ gate = true, active = true, splash = true } = {}) {
  const h = createHarness({ platform: 'android', state: { budgets: [] } });
  const model = animatedModel();
  h.deps['react-native'].Animated = model.Animated;
  const effects = [];
  h.deps.react.useEffect = (work) => { effects.push(work); };
  h.deps['@/hooks/use-reduced-motion'] = { useReducedMotion: () => false, useMotionPreference: () => ({ ready: true, reducedMotion: false }) };
  h.deps['@/hooks/use-app-active'] = { useAppActive: () => active };
  h.deps['@/lib/launch-splash'] = { useLaunchSplashHidden: () => splash };
  h.deps['@/components/lock-gate'] = { usePrivacyGateCleared: () => gate };
  h.local('@/components/ui/coins/coin-stack');
  h.local('@/components/reference-home-summary');
  const tree = h.render('home');
  for (const work of effects.splice(0)) work();
  const groups = ['home-today-coins', 'home-flow-coins-spent', 'home-flow-coins-in', 'home-average-columns']
    .filter((id) => walk(tree).some((node) => node.props?.testID === id));
  return { tree, groups, model };
}

test('Home\'s coins hold while the splash, App Lock or the background hide Home, then run one clock per group', () => {
  const shown = homeTimings();
  assert.deepEqual(shown.groups, ['home-today-coins', 'home-flow-coins-spent', 'home-flow-coins-in', 'home-average-columns']);
  assert.equal(shown.model.log.timings.length, shown.groups.length, 'one native clock per coin group, no more');
  assert.ok(shown.model.log.timings.every(({ config }) => config.useNativeDriver === true));
  assert.deepEqual(shown.model.log.jsTimed, []);
  for (const hidden of [{ gate: false }, { splash: false }, { active: false }]) {
    const behind = homeTimings(hidden);
    assert.equal(behind.model.log.timings.length, 0, `nothing runs unseen: ${JSON.stringify(hidden)}`);
    // Held below their places for the reveal, not drawn finished and then replayed.
    const gold = walk(behind.tree).filter((node) => /^home-today-coins-coin-\d+$/.test(node.props?.testID ?? ''));
    assert.ok(gold.length > 0 && gold.every((node) => [node.props.style].flat(2).find((s) => s?.opacity)?.opacity.value === 0));
  }
});

test('useHomeRevealReady: lock cleared, foreground and splash gone', () => {
  for (const [gate, active, splash, ready] of [[true, true, true, true], [false, true, true, false],
    [true, false, true, false], [true, true, false, false]]) {
    const h = createHarness({ platform: 'android' });
    h.deps['@/components/lock-gate'] = { usePrivacyGateCleared: () => gate };
    h.deps['@/hooks/use-app-active'] = { useAppActive: () => active };
    h.deps['@/lib/launch-splash'] = { useLaunchSplashHidden: () => splash };
    const screen = load(path.join(root, 'src/screens/journal-home-screen.tsx'), h.deps);
    assert.equal(screen.useHomeRevealReady(), ready);
  }
});

test('an arrival committed while the app is away lands in place and counts as shown', () => {
  const h = createHarness({ platform: 'ios' });
  const model = animatedModel();
  h.deps['react-native'].Animated = model.Animated;
  const effects = [];
  h.deps.react.useEffect = (work) => { effects.push(work); };
  h.deps['@/hooks/use-reduced-motion'] = { useReducedMotion: () => false, useMotionPreference: () => ({ ready: true, reducedMotion: false }) };
  for (const [deps, label] of [[{ '@/hooks/use-app-active': { useAppActive: () => false } }, 'background'], [{}, 'held by Home']]) {
    Object.assign(h.deps, deps);
    const { ArrivingRow } = load(path.join(root, 'src/screens/journal-home-screen.tsx'), h.deps);
    const tree = ArrivingRow({ children: 'row', hold: label === 'held by Home' });
    for (const work of effects.splice(0)) work();
    const coin = walk(tree).find((node) => node !== tree && node.props?.accessibilityElementsHidden);
    const opacity = (node) => [node.props.style].flat(2).find((s) => s?.opacity)?.opacity.value;
    assert.deepEqual([opacity(tree), opacity(coin)], [1, 0], `${label}: the row in place, the coin already gone`);
    assert.equal(model.log.timings.length, 0, label);
  }
});

// ── Deferred work waits for frames and the foreground lease ───────────────
function deferralProbe() {
  const frames = [];
  const timers = [];
  let lease = null;
  const globals = {
    requestAnimationFrame: (work) => { frames.push(work); return frames.length; },
    cancelAnimationFrame: (id) => { frames[id - 1] = null; },
    setTimeout: (work, ms) => { timers.push({ work, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].work = null; },
  };
  const helper = load(path.join(root, 'src/lib/after-first-frames.ts'), {
    '@/lib/foreground-history-priority': { waitForForegroundHistoryIdle: () => lease?.promise ?? Promise.resolve() },
  }, globals);
  return {
    helper,
    frame() { const pending = frames.splice(0); for (const work of pending) work?.(0); },
    timer() { const pending = timers.splice(0); for (const timer of pending) timer.work?.(); return pending.map((t) => t.ms); },
    holdLease() { let release; lease = { promise: new Promise((resolve) => { release = resolve; }) }; return () => { lease = null; release(); }; },
  };
}

test('runAfterFirstFrames waits for two drawn frames, a settle and the foreground lease', async () => {
  const p = deferralProbe();
  const release = p.holdLease();
  let ran = 0;
  p.helper.runAfterFirstFrames(() => { ran += 1; });
  await Promise.resolve();
  assert.equal(ran, 0, 'never in the tick after commit (InteractionManager is a setImmediate in RN 0.83)');
  p.frame();
  assert.equal(ran, 0, 'not after the commit frame');
  assert.deepEqual(p.timer(), [], 'no timer before the second frame');
  p.frame();
  assert.equal(ran, 0);
  assert.deepEqual(p.timer(), [p.helper.AFTER_FIRST_FRAMES_DELAY_MS]);
  await Promise.resolve();
  assert.equal(ran, 0, 'Home\'s entrance still holds the lease');
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ran, 1);

  const cancelled = deferralProbe();
  let never = 0;
  const task = cancelled.helper.runAfterFirstFrames(() => { never += 1; }, { delayMs: 0, idle: false });
  cancelled.frame();
  task.cancel();
  cancelled.frame(); cancelled.timer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(never, 0, 'a cancelled task never runs');
});

test('Home defers through the helper and holds the lease for its entrance', () => {
  const home = read('src/screens/journal-home-screen.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(home, /InteractionManager/);
  assert.ok((home.match(/runAfterFirstFrames\(/g) ?? []).length >= 6, 'insight, recap, recurrence, widgets, insight run, transfer queue');
  assert.match(home, /prioritizeForegroundNavigation\(HOME_REVEAL_QUIET_MS\)/);
  assert.match(home, /const HOME_REVEAL_QUIET_MS = 1_500/);
  for (const file of ['src/app/(tabs)/bills.tsx', 'src/app/transactions.tsx', 'src/app/settings-data.tsx']) {
    assert.doesNotMatch(read(file), /InteractionManager\.runAfterInteractions/, file);
  }
});

// ── Widgets are not rewritten on a resume with the same figures ───────────
function widgetSync(options = {}) {
  const sync = load(path.join(root, 'src/lib/widget-sync.ts'), {
    '@/lib/ledger': {}, '@/lib/subscriptions': {}, '@/lib/widget-ledger': {},
    '../../modules/wafra-widgets': { setWidgetSnapshot() {}, clearWidgetSnapshot() {} },
  });
  let now = 1_000_000;
  let snapshot = { version: 1, generatedAt: now, todayISO: '2026-09-27', todayMinor: 100, bills: [] };
  let clears = 0;
  const writes = [];
  const owner = sync.createWidgetSnapshotSync({
    prepare: async () => ({ ...snapshot, generatedAt: now }),
    write: (json) => { writes.push(JSON.parse(json)); },
    clear: () => {},
    now: () => now,
    externalClears: () => clears,
    ...options,
  });
  const input = { state: { hydrated: true, onboarded: true, privateMode: false }, now: new Date(now) };
  return {
    sync, writes,
    request: () => owner.request(input).done,
    clear: () => owner.clear(),
    set now(value) { now = value; }, get now() { return now; },
    change(patch) { snapshot = { ...snapshot, ...patch }; },
    eraseElsewhere() { clears += 1; },
  };
}

test('the widget snapshot is written once for the same figures, and again when they or the native copy change', async () => {
  const w = widgetSync();
  assert.equal(await w.request(), 'written');
  w.now += 60_000;
  assert.equal(await w.request(), 'unchanged', 'a resume a minute later with the same figures');
  assert.equal(w.writes.length, 1);
  w.change({ todayMinor: 250 });
  assert.equal(await w.request(), 'written', 'a new capture');
  w.change({ todayISO: '2026-09-28' });
  assert.equal(await w.request(), 'written', 'a new day');
  assert.equal(await w.request(), 'unchanged');
  w.eraseElsewhere();
  assert.equal(await w.request(), 'written', 'Erase everything cleared the native copy directly');
  assert.equal(await w.clear(), 'cleared');
  assert.equal(await w.request(), 'written', 'after the sync\'s own clear');
  w.now += w.sync.WIDGET_REWRITE_AFTER_MS;
  assert.equal(await w.request(), 'written', 'still re-stamped a few times a day for the widgets\' staleness limit');
  assert.equal(w.writes.length, 6);
});

test('a failed native write is not remembered as written', async () => {
  let fail = true;
  const writes = [];
  const w = widgetSync({ write: (json) => { if (fail) throw new Error('fixture'); writes.push(json); } });
  assert.equal(await w.request(), 'failed');
  fail = false;
  assert.equal(await w.request(), 'written');
  assert.equal(writes.length, 1);
  // Android's module answers false (no React context): not stored, so not skipped next time.
  let stored = false;
  const answered = [];
  const android = widgetSync({ write: (json) => { answered.push(json); return stored; } });
  assert.equal(await android.request(), 'failed');
  stored = true;
  assert.equal(await android.request(), 'written');
  assert.equal(await android.request(), 'unchanged');
  assert.equal(answered.length, 2);
});

test('the native bridge reports a refused write; iOS (no answer) counts as stored', () => {
  for (const [answer, stored] of [[false, false], [true, true], [undefined, true]]) {
    const bridge = load(path.join(root, 'modules/wafra-widgets/index.ts'), {
      'react-native': { Platform: { OS: 'android' } },
      'expo-modules-core': { requireOptionalNativeModule: () => ({ setSnapshot: () => answer, clearSnapshot() {} }) },
    });
    assert.equal(bridge.setWidgetSnapshot('{}'), stored, String(answer));
  }
  const throwing = load(path.join(root, 'modules/wafra-widgets/index.ts'), {
    'react-native': { Platform: { OS: 'android' } },
    'expo-modules-core': { requireOptionalNativeModule: () => ({ setSnapshot: () => { throw new Error('fixture'); } }) },
  });
  assert.equal(throwing.setWidgetSnapshot('{}'), false);
});

test('Home\'s widget sync follows custom category labels (the spending widget names them)', () => {
  const home = read('src/screens/journal-home-screen.tsx');
  const effect = home.slice(home.indexOf('requestWidgetSnapshotSync({'), home.indexOf('getStateGeneration, getStateSnapshot]);'));
  assert.match(home, /latest\.customCategories === source\.customCategories/);
  assert.match(effect, /state\.customCategories/);
});

// ── A resume or an unlock repeats no ledger walk ──────────────────────────
function homeProbe() {
  const h = createHarness({ platform: 'android' });
  // Widgets are drawn only outside Private Mode (the harness default is on).
  let state = { ...h.state, privateMode: false, transactions: [...h.state.transactions,
    { id: 'own-transfer', title: 'Own account transfer', amountFils: 50_000, date: '2026-09-05', type: 'expense', category: 'transfer', accountId: h.state.accounts[0].id, source: 'sms' }] };
  let gate = true;
  let cursor = 0;
  const slots = [];
  const effects = [];
  const interactions = [];
  const appListeners = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const memo = (factory, dependencies) => {
    const i = cursor++;
    if (!slots[i] || !same(slots[i].dependencies, dependencies)) slots[i] = { value: factory(), dependencies };
    return slots[i].value;
  };
  const effect = (work, dependencies) => {
    const i = cursor++;
    if (slots[i] && same(slots[i].dependencies, dependencies)) return;
    const previous = slots[i];
    const slot = slots[i] = { dependencies };
    effects.push(() => { previous?.cleanup?.(); slot.cleanup = work(); });
  };
  Object.assign(h.deps.react, {
    useMemo: memo, useCallback: (fn, dependencies) => memo(() => fn, dependencies),
    useRef: (initial) => memo(() => ({ current: initial }), []),
    useState: (initial) => {
      const cell = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []);
      return [cell.value, (next) => { cell.value = typeof next === 'function' ? next(cell.value) : next; }];
    },
    useEffect: effect, startTransition: (work) => work(),
  });
  h.deps['@react-navigation/native'] = { useIsFocused: () => true, useFocusEffect: (callback) => effect(() => callback(), [callback]) };
  h.deps['@/components/lock-gate'] = { usePrivacyGateCleared: () => gate };
  h.deps['react-native'].AppState = { currentState: 'active', addEventListener: (_event, listener) => {
    appListeners.push(listener); return { remove() {} };
  } };
  h.deps['react-native'].InteractionManager = { runAfterInteractions: (work) => {
    const entry = { work, cancelled: false };
    interactions.push(entry);
    return { cancel() { entry.cancelled = true; } };
  } };
  const counts = { walks: 0, widgets: 0 };
  const ledger = h.deps['@/lib/ledger'];
  h.deps['@/lib/ledger'] = { ...ledger, transferReconciliationForState: (...args) => { counts.walks += 1; return ledger.transferReconciliationForState(...args); } };
  h.deps['@/lib/widget-sync'] = { ...h.deps['@/lib/widget-sync'],
    requestWidgetSnapshotSync: () => { counts.widgets += 1; return { cancel() {}, done: Promise.resolve('written') }; } };
  const store = h.deps['@/lib/store'].useStore();
  // The store's actions are stable functions, as useStoreActions gives them.
  const getStateSnapshot = () => state;
  h.deps['@/lib/store'] = { useStore: () => ({ ...store, state, getStateSnapshot }) };
  const jsx = (type, props, key) => ({ type, props, key });
  h.deps['react/jsx-runtime'] = { jsx, jsxs: jsx, Fragment: 'Fragment' };
  const Home = load(path.join(root, 'src/screens/journal-home-screen.tsx'), h.deps).default;
  return {
    counts,
    set gate(value) { gate = value; },
    render() { cursor = 0; Home(); while (effects.length) effects.shift()(); },
    settle() { while (interactions.length) { const entry = interactions.shift(); if (!entry.cancelled) entry.work(); } },
    resume() { for (const listener of appListeners) listener('active'); },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('a resume on the same day rewrites no widgets, and unlocking repeats no transfer walk', () => {
  const p = homeProbe();
  p.render(); p.settle();
  assert.equal(p.counts.widgets, 1, 'the first snapshot after launch');
  assert.equal(p.counts.walks, 1, 'the transfer queue, once');
  // Every reopen used to reset Home's clock and with it the widget sync.
  p.resume(); p.render(); p.settle();
  p.resume(); p.render(); p.settle();
  assert.equal(p.counts.widgets, 1, 'the same day and ledger: no new snapshot, no native write');
  // App Lock re-engages after a while away, then the person unlocks.
  p.gate = false; p.render(); p.settle();
  p.gate = true; p.render(); p.settle();
  assert.equal(p.counts.walks, 1, 'the unchanged queue is reused, not rebuilt on unlock');
  p.dispose();
});

// ── The launch splash ─────────────────────────────────────────────────────
function splashProbe() {
  const calls = { prevent: 0, hide: 0 };
  let hidden;
  const frames = [];
  const timers = [];
  const splash = load(path.join(root, 'src/lib/launch-splash.ts'), {
    'expo-splash-screen': {
      preventAutoHideAsync: async () => { calls.prevent += 1; },
      hideAsync: () => { calls.hide += 1; return new Promise((resolve) => { hidden = resolve; }); },
    },
    react: { useSyncExternalStore: (_subscribe, get) => get() },
  }, {
    requestAnimationFrame: (work) => { frames.push(work); return frames.length; },
    setTimeout: (work, ms) => { timers.push({ work, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].work = null; },
  });
  return { splash, calls, frames, timers, finishHide: () => hidden() };
}

test('the splash stays up until the ledger\'s first screen, then Home starts a frame after it goes', async () => {
  const p = splashProbe();
  p.splash.holdLaunchSplash();
  assert.equal(p.splash.launchSplashHidden(), false);
  assert.equal(p.timers.at(-1).ms, p.splash.LAUNCH_SPLASH_TIMEOUT_MS, 'with a fallback');
  p.splash.releaseLaunchSplash();
  p.splash.releaseLaunchSplash();
  assert.equal(p.calls.hide, 1, 'hidden once');
  p.splash.holdLaunchSplash();
  p.finishHide();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(p.splash.launchSplashHidden(), false, 'not until a frame after the hide');
  p.frames.splice(0).forEach((work) => work());
  assert.equal(p.splash.launchSplashHidden(), true, 'a hold during the hide does not strand it');

  const slow = splashProbe();
  slow.splash.holdLaunchSplash();
  slow.timers.filter((timer) => timer.work).at(-1).work();
  assert.equal(slow.calls.hide, 1, 'a slow or failed ledger read never keeps the splash past the fallback');
});

test('the root releases the splash over the first hydrated frame, not at fonts-ready', () => {
  const layout = read('src/components/app-root-layout.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(layout, /SplashScreen\.hideAsync/);
  assert.match(layout, /if \(!state\.hydrated\) return;[\s\S]*?requestAnimationFrame\(\(\) => releaseLaunchSplash\(\)\)/);
  assert.match(layout, /useEffect\(\(\) => holdLaunchSplash\(\), \[\]\)/);
  assert.match(layout, /loadHomeWidgetPreferences\(\)/, 'Home\'s layout is read beside hydration');
});

test('Home\'s first render uses the saved layout already in memory', async () => {
  let stored = JSON.stringify({ order: ['activity', 'greeting', 'overview', 'today', 'week', 'due', 'upcoming', 'capture'], hidden: ['insight'] });
  const widgets = load(path.join(root, 'src/lib/home-widgets.ts'), {
    '@react-native-async-storage/async-storage': { getItem: async () => stored, setItem: async (_key, value) => { stored = value; } },
    '@/lib/home-widget-preferences': load(path.join(root, 'src/lib/home-widget-preferences.ts')),
  });
  assert.equal(widgets.peekHomeWidgetPreferences(), null, 'nothing read yet');
  const loaded = await widgets.loadHomeWidgetPreferences();
  assert.deepEqual(widgets.peekHomeWidgetPreferences(), loaded);
  const peeked = widgets.peekHomeWidgetPreferences();
  peeked.order.length = 0;
  assert.deepEqual(widgets.peekHomeWidgetPreferences(), loaded, 'callers get a copy');
  const home = read('src/screens/journal-home-screen.tsx');
  assert.match(home, /useState<HomeWidgetPreferences>\(\(\) =>\s*peekHomeWidgetPreferences\(\) \?\? defaultHomeWidgetPreferences\(\)\)/);
});

test('the foreground state: background and inactive are away; unknown counts as active', () => {
  const listeners = [];
  const AppState = { currentState: 'unknown', addEventListener: (_event, listener) => { listeners.push(listener); return { remove() {} }; } };
  const active = load(path.join(root, 'src/hooks/use-app-active.ts'), { react: { useSyncExternalStore: (_s, get) => get() }, 'react-native': { AppState } });
  assert.equal(active.appIsActive(), true);
  let changes = 0;
  active.subscribeAppActive(() => { changes += 1; });
  listeners.forEach((listener) => listener('background'));
  assert.equal(active.useAppActive(), false);
  listeners.forEach((listener) => listener('inactive'));
  listeners.forEach((listener) => listener('active'));
  assert.equal(active.appIsActive(), true);
  assert.equal(changes, 2, 'one change out, one back');
});

// ── Transactions: only the first transfer separation waits for frames ─────
test('Transactions waits out the push for its first transfer separation, then recomputes edits on the next turn', () => {
  const h = createHarness({ platform: 'android' });
  let state = h.state;
  let cursor = 0;
  const slots = [];
  const effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const memo = (factory, dependencies) => {
    const i = cursor++;
    if (!slots[i] || !same(slots[i].dependencies, dependencies)) slots[i] = { value: factory(), dependencies };
    return slots[i].value;
  };
  Object.assign(h.deps.react, {
    useMemo: memo, useCallback: (fn, dependencies) => memo(() => fn, dependencies),
    useRef: (initial) => memo(() => ({ current: initial }), []),
    useState: (initial) => {
      const cell = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []);
      return [cell.value, (next) => { cell.value = typeof next === 'function' ? next(cell.value) : next; }];
    },
    useEffect: (work, dependencies) => {
      const i = cursor++;
      if (slots[i] && same(slots[i].dependencies, dependencies)) return;
      const previous = slots[i];
      const slot = slots[i] = { dependencies };
      effects.push(() => { previous?.cleanup?.(); slot.cleanup = work(); });
    },
    useDeferredValue: (value) => value, startTransition: (work) => work(),
  });
  const jsx = (type, props, key) => ({ type, props, key });
  h.deps['react/jsx-runtime'] = { jsx, jsxs: jsx, Fragment: 'Fragment' };
  h.deps['react-native'].SectionList = 'SectionList';
  h.deps['react-native'].Keyboard = { dismiss() {} };
  h.deps['@/components/ui/screen-scaffold'].useScreenContentInsets = () =>
    ({ contentContainerStyle: {}, contentInset: { top: 0, bottom: 0 }, scrollIndicatorInsets: { top: 0, bottom: 0 } });
  h.deps['@/lib/period'].periodRange = () => '';
  const store = h.deps['@/lib/store'].useStore();
  const getStateSnapshot = () => state;
  h.deps['@/lib/store'] = { useStore: () => ({ ...store, state, getStateSnapshot }) };
  const scheduled = [];
  h.deps['@/lib/after-first-frames'] = {
    runAfterFirstFrames: () => { scheduled.push('after-first-frames'); return { cancel() {} }; },
    runSoon: () => { scheduled.push('soon'); return { cancel() {} }; },
  };
  const Screen = load(path.join(root, 'src/app/transactions.tsx'), h.deps,
    { requestAnimationFrame: (callback) => { callback(); return 1; }, cancelAnimationFrame() {} }).default;
  const render = () => { cursor = 0; Screen(); while (effects.length) effects.shift()(); };
  render();
  assert.deepEqual(scheduled, ['after-first-frames'], 'opening the screen: after the push animation');
  render();
  assert.deepEqual(scheduled, ['after-first-frames'], 'a re-render with the same ledger schedules nothing');
  state = { ...state, transactions: [...state.transactions] };
  render();
  assert.deepEqual(scheduled, ['after-first-frames', 'soon'], 'an edit while the screen is shown: the next turn');
});
