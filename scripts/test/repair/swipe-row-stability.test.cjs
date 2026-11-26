'use strict';
// SwipeRow sits under ~100 mounted Transactions rows. The swipeable rebuilds its
// Pan and Tap gestures (with native gesture-handler updates) whenever
// `onSwipeableWillOpen` or `animationOptions` changes identity, and re-renders its
// action elements when `renderRightActions`/`renderLeftActions` does. SwipeRow must
// not re-render for equal props, and must hand the swipeable the same callbacks when
// it does re-render for something that did not change them. The component runs for
// real; React is a tiny harness with hooks and memo's shallow-equality contract.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');

function setup({ rtl = false } = {}) {
  const log = { innerRenders: 0, tapped: 0, closed: 0, hookCounts: [] };
  const slots = [];
  let cursor = 0;
  const cell = () => (slots[cursor++] ??= {});
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    memo: (inner) => ({ $$typeof: 'memo', inner }),
    useRef: (initial) => { const c = cell(); return (c.ref ??= { current: initial }); },
    useCallback: (fn, deps) => {
      const c = cell();
      if (!c.deps || !same(c.deps, deps)) { c.deps = deps; c.fn = fn; }
      return c.fn;
    },
    useMemo: (fn, deps) => {
      const c = cell();
      if (!c.deps || !same(c.deps, deps)) { c.deps = deps; c.value = fn(); }
      return c.value;
    },
  };
  const element = (type, props, key) => ({ type, props: props ?? {}, key });
  const runtime = { jsx: element, jsxs: element, Fragment: 'Fragment' };
  const theme = { text: '#111', backgroundElement: '#eee' };
  const bandPalettes = { light: { home: { danger: '#b33', onDanger: '#fff' }, bills: { band: '#ca3', onBand: '#000' }, accounts: { band: '#789', onBand: '#fff' } } };
  const Swipeable = function ReanimatedSwipeable() {};
  const deps = {
    react, 'react/jsx-runtime': runtime,
    'react-native': { Pressable: 'Pressable', View: 'View', StyleSheet: { create: (styles) => styles } },
    'react-native-gesture-handler/ReanimatedSwipeable': { __esModule: true, default: Swipeable },
    'react-native-reanimated': { ReduceMotion: { Always: 'always' } },
    '@/components/themed-text': { ThemedText: 'ThemedText' },
    '@/components/ui/icon': { Icon: 'Icon' },
    '@/constants/theme': { BandPalettes: bandPalettes, MotionSpring: { spring: true } },
    '@/hooks/use-band': { useBandScheme: () => 'light' },
    '@/hooks/use-reduced-motion': { useMotionPreference: () => ({ reducedMotion: false }) },
    '@/hooks/use-theme': { useTheme: () => theme },
    '@/lib/haptics': { tapped: () => { log.tapped += 1; } },
    '@/lib/i18n': { isRTL: () => rtl },
  };
  const { SwipeRow } = load(path.join(root, 'src/components/swipe-row.tsx'), deps);
  assert.equal(SwipeRow.$$typeof, 'memo', 'SwipeRow is wrapped in React.memo');
  // One mounted row: memo's default contract (shallow-equal props skip the render), then the hooks.
  let lastProps = null;
  let lastOutput = null;
  const render = (props) => {
    const shallowEqual = lastProps && Object.keys(props).length === Object.keys(lastProps).length &&
      Object.keys(props).every((key) => Object.is(props[key], lastProps[key]));
    if (shallowEqual) return lastOutput;
    lastProps = props;
    cursor = 0;
    log.innerRenders += 1;
    lastOutput = SwipeRow.inner(props);
    log.hookCounts.push(cursor);
    return lastOutput;
  };
  return { render, log, Swipeable };
}

const action = (name, extra = {}) => ({ name, label: name, icon: 'x', onPress: () => {}, ...extra });
const swipeableProps = (output) => output.props;

test('a parent re-render with equal props does not re-render SwipeRow', () => {
  const h = setup();
  const actions = [action('category', { band: 'bills' }), action('delete', { destructive: true })];
  const children = { type: 'Row', props: {} };
  const first = h.render({ actions, children, testID: 't' });
  const second = h.render({ actions, children, testID: 't' });
  assert.equal(h.log.innerRenders, 1);
  assert.equal(second, first);
});

test('a re-render for new children hands the swipeable the same callbacks (no gesture rebuild)', () => {
  const h = setup();
  const actions = [action('category', { band: 'bills' }), action('delete', { destructive: true })];
  const a = swipeableProps(h.render({ actions, children: { type: 'Row', props: { n: 1 } } }));
  const b = swipeableProps(h.render({ actions, children: { type: 'Row', props: { n: 2 } } }));
  assert.equal(h.log.innerRenders, 2, 'the changed children did re-render the row');
  assert.equal(b.onSwipeableWillOpen, a.onSwipeableWillOpen, 'the open tick is one module-level function');
  assert.equal(b.animationOptions, a.animationOptions);
  assert.equal(b.renderRightActions, a.renderRightActions, 'the action renderer only changes with the actions');
  assert.equal(b.renderLeftActions, undefined);
  assert.equal(h.log.hookCounts[0], h.log.hookCounts[1], 'hooks run in the same order every render');
});

test('new actions give a new action renderer and nothing else changes', () => {
  const h = setup();
  const children = { type: 'Row', props: {} };
  const a = swipeableProps(h.render({ actions: [action('delete', { destructive: true })], children }));
  const b = swipeableProps(h.render({ actions: [action('category', { band: 'bills' }), action('delete', { destructive: true })], children }));
  assert.notEqual(b.renderRightActions, a.renderRightActions);
  assert.equal(b.onSwipeableWillOpen, a.onSwipeableWillOpen);
  assert.equal(b.animationOptions, a.animationOptions);
  const names = b.renderRightActions().props.children.map((node) => node.props.testID);
  assert.deepEqual(names, ['swipe-action-category', 'swipe-action-delete']);
});

test('Arabic puts the same stable renderer on the left edge', () => {
  const h = setup({ rtl: true });
  const actions = [action('delete', { destructive: true })];
  const a = swipeableProps(h.render({ actions, children: { type: 'Row', props: { n: 1 } } }));
  const b = swipeableProps(h.render({ actions, children: { type: 'Row', props: { n: 2 } } }));
  assert.equal(a.renderRightActions, undefined);
  assert.equal(typeof a.renderLeftActions, 'function');
  assert.equal(b.renderLeftActions, a.renderLeftActions);
});

test('no actions renders the bare children, and actions appearing later keeps hook order', () => {
  const h = setup();
  const children = { type: 'Row', props: {} };
  const bare = h.render({ actions: [], children });
  assert.equal(bare.type, 'Fragment');
  assert.equal(bare.props.children, children);
  const withActions = h.render({ actions: [action('delete', { destructive: true })], children });
  assert.equal(withActions.type, h.Swipeable);
  assert.equal(h.log.hookCounts[0], h.log.hookCounts[1], 'the early return sits after every hook');
});

test('pressing an action still ticks, closes the row and runs the action; opening ticks once', () => {
  const h = setup();
  let ran = 0;
  const actions = [action('delete', { destructive: true, onPress: () => { ran += 1; } })];
  const props = swipeableProps(h.render({ actions, children: { type: 'Row', props: {} } }));
  props.ref.current = { close: () => { h.log.closed += 1; } };
  props.onSwipeableWillOpen();
  assert.equal(h.log.tapped, 1, 'the open tick');
  const pressable = props.renderRightActions().props.children[0];
  pressable.props.onPress();
  assert.deepEqual([ran, h.log.closed, h.log.tapped], [1, 1, 2]);
  const style = pressable.props.style({ pressed: true });
  assert.equal(style[1].opacity, 0.8);
  assert.equal(style[1].backgroundColor, '#b33', 'a destructive action is clay');
});
