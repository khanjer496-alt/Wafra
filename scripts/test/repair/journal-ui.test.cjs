'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { harness, walk, text } = require('./journal-harness.cjs');
// Home B leads with Today; the period spending figure is the one inside home-spending-total.
const periodMoney = (nodes) => walk(nodes.find((node) => node.props.testID === 'home-spending-total')).find((node) => node.type === 'Money');

test('Home puts one spending summary and recent activity before capture controls', () => {
  const h = harness();
  const nodes = walk(h.tree);
  const section = (id) => nodes.findIndex((node) => node.props.testID === id);
  for (const id of ['journal-summary', 'home-widget-activity', 'journal-import-controls']) {
    assert.notEqual(section(id), -1, `${id} is rendered`);
  }
  assert.ok(section('journal-summary') < section('home-widget-activity'));
  assert.ok(section('home-widget-activity') < section('journal-import-controls'));
  assert.equal(periodMoney(nodes).props.fils, 508700);
  assert.match(text(h.tree), /View spending breakdown/);
  assert.match(text(nodes.find((node) => node.props.testID === 'home-widget-activity')), /Recent transactions/);
});
test('settings and explicit manual entry remain working visible quick actions', () => {
  const ios = harness({ platform: 'ios' });
  const nodes = walk(ios.tree);
  nodes.find((n) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Add').props.onPress();
  nodes.find((n) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Settings').props.onPress();
  assert.deepEqual(ios.events.filter((e) => e[0] === 'route'), [['route', '/add-transaction'], ['route', '/settings']]);
  // Android keeps manual entry as the floating Add above the tab bar.
  const android = harness({ platform: 'android' });
  const fab = walk(android.tree).find((n) => n.type === 'HomeAddButton');
  assert.equal(walk(android.tree).some((n) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Add'), false);
  fab.props.onPress();
  assert.deepEqual(android.events.filter((e) => e[0] === 'route'), [['route', '/add-transaction']]);
});
test('Android Home reserves room under its last row for the floating Add; iOS does not', () => {
  // Home is a design-language-E band screen: BandScaffold, the ink band.
  const scaffold = (platform) => walk(harness({ platform }).tree).find((n) => n.type === 'BandScaffold');
  assert.equal(scaffold('ios').props.band, 'home');
  assert.equal(scaffold('ios').props.tabbed, true);
  // The 56pt button plus a gap, on top of the tab-bar clearance the scaffold adds.
  assert.ok(scaffold('android').props.floatingClearance >= 56 + 8);
  assert.equal(scaffold('ios').props.floatingClearance, 0);
  // ...and the scaffold adds it to the tab screen's bottom padding.
  const path = require('node:path');
  const load = require('./load-typescript.cjs');
  const { useBandBottomInset } = load(path.join(__dirname, '../../../src/components/ui/band-scaffold.tsx'), {
    react: { useEffect() {}, useRef: (v) => ({ current: v }) }, 'react/jsx-runtime': { jsx() {}, jsxs() {}, Fragment: 'Fragment' },
    'react-native': { Platform: { OS: 'android' }, StyleSheet: { create: (s) => s }, ScrollView: 'ScrollView', View: 'View', Pressable: 'Pressable', KeyboardAvoidingView: 'KAV' },
    'react-native-reanimated': { __esModule: true, default: { View: 'View' }, useAnimatedStyle: (f) => f(), useSharedValue: (v) => ({ value: v }), withSpring: (v) => v },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 24, bottom: 16 }) },
    '@react-navigation/native': { useIsFocused: () => true }, 'expo-status-bar': { StatusBar: 'StatusBar' }, 'expo-router': { useRouter: () => ({}) },
    '@/components/themed-text': {}, '@/components/ui/icon': {}, '@/hooks/use-band': {}, '@/hooks/use-keyboard-height': {},
    '@/hooks/use-language': {}, '@/hooks/use-large-text-layout': {}, '@/hooks/use-reduced-motion': {}, '@/lib/band-copy': {},
    '@/constants/theme': { BandLayout: { sheetOverlap: 28, sheetRadius: 28, buttonHeight: 56 }, MaxContentWidth: 800, MotionSpring: {}, Spacing: { one: 4, two: 8, three: 16, four: 24 } },
    '@/hooks/use-tab-bar-clearance': { useTabBarClearance: () => 90 },
  });
  assert.equal(useBandBottomInset({ tabbed: true }), 90);
  assert.equal(useBandBottomInset({ tabbed: true, floatingClearance: 72 }), 162);
});
test('Founder logo unlock exists only in founder-enabled internal builds', async () => {
  const production = harness();
  assert.equal(walk(production.tree).some((node) => node.props.testID === 'founder-unlock-logo'), false);

  const internal = harness({ founderUnlock: true, founderPro: false });
  const logo = walk(internal.tree).find((node) => node.props.testID === 'founder-unlock-logo');
  assert.ok(logo);
  logo.props.onPress();
  await Promise.resolve();
  assert.ok(internal.events.some((event) => event[0] === 'founder'));
});
test('activity search and full bills remain reachable without duplicate Accounts shortcuts', () => {
  const h = harness();
  for (const node of walk(h.tree)) {
    if (node.type === 'Pressable' && (text(node.props.children).trim() === 'See all' || node.props.accessibilityLabel === 'View all payments')) node.props.onPress();
  }
  assert.ok(h.events.some((e) => e[1] === '/transactions'));
  assert.ok(h.events.some((e) => e[1] === '/bills'));
});
test('failed history exposes resume rather than pretending capture completed', async () => {
  const h = harness({ history: { status: 'failed', scanned: 1000, found: 120, error: 'page-failed' } });
  assert.match(text(h.tree), /Import interrupted/);
  const button = walk(h.tree).find((node) => node.type === 'Pressable' && text(node.props.children).trim() === 'Resume');
  button.props.onPress();
  await Promise.resolve();
  assert.deepEqual(h.events, [['resume']]);
});
test('paused history has an explicit resume action; running history does not restart it', () => {
  const paused = harness({ history: { status: 'paused', scanned: 1000, found: 120 } });
  assert.match(text(paused.tree), /History import paused/);
  const running = harness({ history: { status: 'running', scanned: 1000, found: 120 } });
  assert.match(text(running.tree), /1,000\s+Messages checked/);
  assert.match(text(running.tree), /120\s+Alerts found/);
  assert.equal(walk(running.tree).filter((n) => n.type === 'Pressable' && text(n.props.children).trim() === 'Resume').length, 0);
});
test('capture opt-out changes only after an explicit press and then opens iOS setup', async () => {
  const h = harness({ optOut: true, platform: 'ios' });
  assert.deepEqual(h.events, []);
  const button = walk(h.tree).find((node) => node.type === 'Pressable' && node.props.accessibilityLabel?.startsWith('Bank alerts.'));
  button.props.onPress();
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(h.events, [['optOut', false], ['route', '/ios-setup']]);
});
test('empty month retains manual entry and explicit bank-alert check', () => {
  const h = harness({ empty: true });
  const empty = walk(h.tree).find((node) => node.type === 'EmptyMonth');
  assert.ok(empty);
  empty.props.onAddManually();
  assert.ok(h.events.some((e) => e[1] === '/add-transaction'));
  assert.equal(typeof empty.props.onReadInbox, 'function');
});
test('unhydrated ledger renders skeletons, not a misleading zero dashboard', () => {
  const h = harness({ hydrated: false });
  assert.ok(walk(h.tree).some((node) => node.type === 'SkeletonRows'));
  assert.equal(walk(h.tree).some((node) => node.props.testID === 'journal-summary'), false);
});
test('incoming transfer remains positive but not coloured as earned income', () => {
  const h = harness();
  const row = h.TransactionRow({ transaction: { id: 'transfer', title: 'Incoming transfer', amountFils: 26500,
    category: 'other', type: 'income' }, internal: true });
  const amount = walk(row).find((node) => node.type === 'Text' && text(node.props.children).startsWith('+'));
  assert.ok(amount);
  assert.equal(amount.props.style[1].color, h.theme.text);
});
test('Arabic and larger text render the same controls without English journal headings', () => {
  const h = harness({ language: 'ar', largeText: true, theme: 'dark' });
  assert.match(text(h.tree), /حركتك المالية/);
  assert.doesNotMatch(text(h.tree), /Your activity/);
  assert.ok(walk(h.tree).some((node) => node.props.testID === 'journal-import-controls'));
});

test('Home places nonurgent upcoming payments after recent activity', () => {
  const nodes = walk(harness().tree);
  const at = (id) => nodes.findIndex((node) => node.props.testID === id);
  for (const id of ['journal-summary', 'home-widget-activity', 'home-widget-upcoming']) {
    assert.notEqual(at(id), -1, `${id} is rendered`);
  }
  assert.ok(at('journal-summary') < at('home-widget-activity'));
  assert.equal(at('reference-quick-actions'), -1);
  assert.equal(at('reference-month-cards'), -1);
  assert.equal(at('home-widget-due'), -1, 'the nonurgent fixture has no due-now payment');
  assert.ok(at('home-widget-activity') < at('home-widget-upcoming'));
});
test('known balances never replace spending or add another summary on Home', () => {
  const h = harness({ knownBalance: 3870000 });
  assert.equal(periodMoney(walk(h.tree)).props.fils, 508700);
  assert.doesNotMatch(text(h.tree), /Recorded balances|Net after spending/);
  assert.doesNotMatch(text(h.tree), /6%|on track|safe to spend/i);
});
test('zero and unknown account balances do not change the Home spending figure', () => {
  const zero = harness({ knownBalance: 0 });
  assert.equal(periodMoney(walk(zero.tree)).props.fils, 508700);
  assert.doesNotMatch(text(zero.tree), /Recorded balances/);
  const unknown = harness();
  assert.equal(periodMoney(walk(unknown.tree)).props.fils, 508700);
  assert.doesNotMatch(text(unknown.tree), /Recorded balances/);
});
test('Home does not duplicate import shortcuts; explicit capture control remains accessible', () => {
  for (const platform of ['android', 'ios']) {
    const h = harness({ platform });
    assert.ok(walk(h.tree).some((n) => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith('Bank alerts.')));
    assert.equal(walk(h.tree).filter((n) => n.props.testID === 'reference-quick-actions').length, 0);
    assert.deepEqual(h.events, []);
  }
});
