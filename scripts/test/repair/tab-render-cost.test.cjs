'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHarness, walk } = require('./reference-harness.cjs');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');

// Execute the real screen with persistent hook dependencies and opaque child
// boundaries. This counts projection work, not Android frames or device speed.
function persistentHooks() {
  let cursor = 0;
  const slots = [];
  function memo(factory, dependencies) {
    const slot = cursor++;
    const previous = slots[slot];
    if (previous && dependencies && previous.dependencies &&
      dependencies.length === previous.dependencies.length &&
      dependencies.every((item, i) => Object.is(item, previous.dependencies[i]))) {
      return previous.value;
    }
    const value = factory();
    slots[slot] = { dependencies, value };
    return value;
  }
  return {
    begin: () => { cursor = 0; },
    useMemo: memo,
    useCallback: (fn, dependencies) => memo(() => fn, dependencies),
    useRef: (value) => memo(() => ({ current: value }), []),
    useState: (initial) => {
      const cell = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []);
      return [cell.value, (next) => { cell.value = typeof next === 'function' ? next(cell.value) : next; }];
    },
  };
}

function screenProbe(screen) {
  const h = createHarness();
  const hooks = persistentHooks();
  Object.assign(h.deps.react, hooks);
  const jsx = (type, props, key) => ({ type, props, key });
  h.deps['react/jsx-runtime'] = { jsx, jsxs: jsx, Fragment: 'Fragment' };
  const originalStore = h.deps['@/lib/store'].useStore();
  let state = h.state;
  h.deps['@/lib/store'] = { useStore: () => ({ ...originalStore, state }) };
  const counts = {};
  for (const [module, names] of [
    ['@/lib/balances', ['netWorthBreakdown']],
    ['@/lib/cards', ['openDues', 'recentlySettledDues', 'reissueSuggestions', 'isInactiveAccount', 'cardFigure']],
    ['@/lib/cash-flow', ['summarizeCashOutflow']],
  ]) {
    for (const name of names) {
      const original = h.deps[module][name];
      counts[name] = 0;
      h.deps[module][name] = (...args) => {
        counts[name] += 1;
        return original(...args);
      };
    }
  }
  const Component = load(path.join(root, `src/app/(tabs)/${screen}.tsx`), h.deps).default;
  return {
    get state() { return state; },
    set state(value) { state = value; },
    counts,
    render() { hooks.begin(); return Component(); },
  };
}

for (const screen of ['wallet', 'bills']) {
  test(`${screen}: 20 status-only updates do not recompute account/statement projections`, () => {
    const p = screenProbe(screen);
    p.render();
    const initial = { ...p.counts };
    assert.ok(initial.openDues > 0, 'the actual screen projection must execute initially');
    for (let i = 1; i <= 20; i += 1) {
      p.state = { ...p.state, lastScanTs: i, historyImport: { status: 'running', scanned: i * 100 },
        reviewTray: { pending: [] }, dailySummary: i % 2 === 0 };
      p.render();
    }
    assert.deepEqual(p.counts, initial, 'nonfinancial store updates must leave financial memo results intact');
  });

  test(`${screen}: changing each financial input still refreshes statement calculations`, () => {
    const p = screenProbe(screen);
    p.render();
    for (const key of ['transactions', 'accounts', 'cardDues']) {
      const previous = p.counts.openDues;
      p.state = { ...p.state, [key]: [...p.state[key]] };
      p.render();
      assert.equal(p.counts.openDues, previous + 1, `${key} changes must invalidate dues`);
    }
  });
}

test('Wallet recomputes cash outflow when the salary-month boundary changes', () => {
  const p = screenProbe('wallet');
  p.render();
  const before = p.counts.summarizeCashOutflow;
  p.state = { ...p.state, monthStartDay: 25 };
  p.render();
  assert.equal(p.counts.summarizeCashOutflow, before + 1);
});

test('Wallet uses fresh balances after an account snapshot changes', () => {
  const p = screenProbe('wallet');
  const before = walk(p.render()).find(node => node.props?.balanceCoverageText !== undefined).props.balanceFils;
  p.state = { ...p.state, accounts: p.state.accounts.map((account, i) => i === 0
    ? { ...account, snapshotFils: account.snapshotFils + 12345 } : account) };
  const after = walk(p.render()).find(node => node.props?.balanceCoverageText !== undefined).props.balanceFils;
  assert.equal(after - before, 12345, 'performance caching must not freeze actual money updates');
});

test('Tab labels use the narrow language context, not the transaction store', () => {
  const h = createHarness();
  let language = 'en';
  h.deps['@/lib/store'].useStore = () => { throw new Error('Tab bar subscribed to the entire ledger'); };
  h.deps['@/hooks/use-language'].useLanguage = () => language;
  const Bar = h.local('@/components/tab-bar').WafraTabBar;
  const navigation = { emit: () => ({ defaultPrevented: false }), navigate() {} };
  const state = { index: 0, routes: ['index', 'flow', 'bills', 'wallet'].map(name => ({ key: name, name })) };
  const labels = () => walk(Bar({ state, navigation })).filter(n => n.props?.accessibilityRole === 'tab')
    .map(n => n.props.accessibilityLabel);
  assert.deepEqual(labels(), ['Home', 'Spending', 'Bills', 'Accounts']);
  language = 'ar';
  assert.ok(labels().every(label => /[\u0600-\u06ff]/.test(label)), 'language changes still update every tab');
});

test('Tab navigation respects prevented and repeated presses and switches once', () => {
  const h = createHarness();
  const Bar = h.deps['@/components/tab-bar'].WafraTabBar;
  let prevented = true;
  const destinations = [];
  const navigation = { emit: () => ({ defaultPrevented: prevented }), navigate: name => destinations.push(name) };
  const state = { index: 0, routes: ['index', 'flow', 'bills', 'wallet'].map(name => ({ key: name, name })) };
  const buttons = walk(Bar({ state, navigation })).filter(n => n.props?.accessibilityRole === 'tab');
  buttons[1].props.onPress();
  assert.deepEqual(destinations, []);
  prevented = false;
  buttons[0].props.onPress();
  assert.deepEqual(destinations, []);
  buttons[1].props.onPress();
  assert.deepEqual(destinations, ['flow']);
});

test('Theme identity remains stable, but palette and contrast changes remain reactive', () => {
  const hooks = persistentHooks();
  let scheme = 'light';
  let increasedContrast = false;
  const Colors = { light: { text: 'ink', controlBorder: 'normal', controlBorderHigh: 'strong' },
    dark: { text: 'paper', controlBorder: 'dark-normal', controlBorderHigh: 'dark-strong' } };
  const { useTheme: renderThemeHook } = load(path.join(root, 'src/hooks/use-theme.ts'), {
    react: hooks, '@/constants/theme': { Colors },
    '@/hooks/use-color-scheme': { useColorScheme: () => scheme },
    '@/hooks/use-increased-contrast': { useIncreasedContrast: () => increasedContrast },
  });
  const render = () => { hooks.begin(); return renderThemeHook(); };
  const light = render();
  assert.equal(render(), light, 'unchanged theme must not allocate a new props object');
  increasedContrast = true;
  const stronger = render();
  assert.equal(stronger.controlBorder, 'strong');
  assert.notEqual(stronger, light);
  assert.equal(render(), stronger);
  scheme = 'dark';
  assert.equal(render().text, 'paper');
  assert.equal(render().controlBorder, 'dark-strong');
  scheme = 'unspecified';
  assert.equal(render().text, 'ink');
});

test('Android freezes inactive tab rendering while capture remains outside the navigator', () => {
  const jsx = (type, props) => ({ type, props });
  const Tabs = Object.assign(() => null, { Screen: 'TabScreen' });
  let platform = 'android';
  const calls = [];
  const Component = load(path.join(root, 'src/components/app-tabs-layout.tsx'), {
    react: {}, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'expo-router': { Tabs },
    'react-native': { Platform: { get OS() { return platform; } } },
    '@/components/tab-bar': { WafraTabBar: 'TabBar' },
    '@/components/ui/tab-bar-metrics': { TabBarMetricsProvider: 'Metrics' },
    '@/hooks/use-auto-import': { useAutoImport: (...args) => calls.push(['auto', ...args]) },
    '@/hooks/use-history-import': { useHistoryImport: () => calls.push(['history']) },
  }).default;
  const tree = Component();
  const [owner, navigator] = tree.props.children;
  assert.equal(navigator.type, Tabs);
  assert.equal(navigator.props.screenOptions.freezeOnBlur, true);
  assert.notEqual(navigator.props.screenOptions.lazy, false);
  assert.equal(navigator.props.detachInactiveScreens, undefined);
  assert.equal(navigator.props.children.length, 4);
  owner.type();
  assert.deepEqual(calls, [['history'], ['auto', true, false]], 'capture must not be inside the frozen tab');
  platform = 'ios';
  assert.notEqual(Component().props.children[1].props.screenOptions.freezeOnBlur, true);
  platform = 'web';
  assert.notEqual(Component().props.children[1].props.screenOptions.freezeOnBlur, true);
});
