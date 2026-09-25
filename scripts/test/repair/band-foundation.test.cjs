'use strict';
// Design language E foundation: BandScaffold and the band/sheet building
// blocks rendered from source through the repair harness (not a device
// renderer — layout, touch and motion are asserted as the props they set).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, walk, text } = require('./reference-harness.cjs');

const flat = (style) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const AED = { currency: 'AED', exponent: 2 };

function setup({ platform = 'ios', theme = 'light', language = 'en', largeText = false, motion = 'full', focused = true } = {}) {
  const h = createHarness({ platform, theme, language, largeText });
  h.deps.react.cloneElement = (element, props) => ({ ...element, props: { ...element.props, ...props } });
  h.deps['react-native'].KeyboardAvoidingView = 'KeyboardAvoidingView';
  h.deps['react-native'].PanResponder = { create: (config) => ({ panHandlers: { onResponderGrant: config.onPanResponderGrant } }) };
  h.deps['react-native'].ActivityIndicator = 'ActivityIndicator';
  h.deps['expo-status-bar'] = { StatusBar: (props) => h.jsx('StatusBar', props) };
  h.deps['@react-navigation/native'] = { useIsFocused: () => focused, useFocusEffect: () => {} };
  h.deps['@/hooks/use-reduced-motion'] = {
    useReducedMotion: () => motion === 'reduced',
    useMotionPreference: () => ({ ready: true, reducedMotion: motion === 'reduced' }),
  };
  h.deps['@/hooks/use-keyboard-height'] = { useKeyboardHeight: () => 0 };
  h.deps['@/hooks/use-tab-bar-clearance'] = { useTabBarClearance: () => 88 };
  h.deps['react-native-safe-area-context'] = { useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) };
  h.local('@/lib/band-copy', 'src/lib/band-copy.ts');
  h.local('@/lib/limit-status', 'src/lib/limit-status.ts');
  h.local('@/lib/pattern', 'src/lib/pattern.ts');
  h.local('@/components/ui/band-scaffold');
  for (const name of ['band-segmented', 'band-chip', 'share-bar', 'pin-timeline', 'dial-limit', 'glyph-tile', 'status-bar', 'e-button']) {
    h.local(`@/components/ui/band/${name}`);
  }
  h.local('@/components/ui/pattern-mosaic');
  const band = (id) => h.deps['@/constants/theme'].BandPalettes[theme][id];
  return { ...h, band, ui: (name) => h.deps[name] };
}

const scaffoldTree = (s, props = {}) => s.ui('@/components/ui/band-scaffold').BandScaffold({
  band: 'home', testID: 'screen', children: s.jsx('Text', { children: 'sheet content' }),
  bandContent: s.jsx('Text', { children: 'band content' }), ...props,
});

test('BandScaffold: band colour to the top edge, sheet over it with a 28pt rounded overlap', () => {
  const s = setup();
  const palette = s.band('home');
  const tree = scaffoldTree(s, { nav: { back: true, title: 'Home' } });
  const nodes = walk(tree);
  const root = nodes.find((node) => node.props?.testID === 'screen');
  assert.equal(flat(root.props.style).backgroundColor, palette.band);
  assert.equal(flat(root.props.style).paddingTop, 47, 'the status-bar area stays the band colour');
  const bandNode = nodes.find((node) => node.props?.testID === 'screen-band');
  assert.equal(flat(bandNode.props.style).backgroundColor, palette.band);
  assert.ok(flat(bandNode.props.style).paddingBottom >= 28, 'band content clears the overlapping sheet');
  const sheet = nodes.find((node) => node.props?.testID === 'screen-sheet');
  const sheetStyle = flat(sheet.props.style);
  assert.equal(sheetStyle.backgroundColor, palette.sheet);
  assert.equal(sheetStyle.marginTop, -28);
  assert.equal(sheetStyle.borderTopStartRadius, 28, 'logical corners mirror under RTL');
  assert.equal(sheetStyle.borderTopEndRadius, 28);
  const overscroll = nodes.find((node) => flat(node.props?.style).top === '100%');
  assert.equal(flat(overscroll.props.style).backgroundColor, palette.sheet, 'the bottom overscroll shows the sheet');
  assert.match(text(tree), /band content/);
  assert.match(text(tree), /sheet content/);
  const scroll = nodes.find((node) => node.type === 'ScrollView');
  assert.equal(scroll.props.contentInsetAdjustmentBehavior, 'never');
  assert.ok(walk(scroll).includes(bandNode), 'the band scrolls away with the content');
});

test('BandScaffold: the status bar follows the focused band', () => {
  const statusOf = (options, band) => walk(scaffoldTree(setup(options), { band })).find((node) => node.type === 'StatusBar');
  assert.equal(statusOf({}, 'home').props.style, 'light');
  assert.equal(statusOf({}, 'bills').props.style, 'dark', 'ink text and dark icons on the light ochre band');
  assert.equal(statusOf({ theme: 'dark' }, 'bills').props.style, 'light');
  assert.equal(statusOf({ focused: false }, 'home'), undefined, 'a hidden tab never sets the bar');
});

test('BandScaffold: the sheet rises 40pt on first mount only where motion is allowed', () => {
  const translate = (options) => {
    const sheet = walk(scaffoldTree(setup(options))).find((node) => node.props?.testID === 'screen-sheet');
    return flat(sheet.props.style).transform?.[0]?.translateY;
  };
  assert.equal(translate({ platform: 'ios' }), 40, 'starts 40pt low, then springs home');
  assert.equal(translate({ platform: 'ios', motion: 'reduced' }), 0, 'Reduce Motion: nothing moves');
  assert.equal(translate({ platform: 'android' }), 0, 'Android keeps its measured motion bypass');
});

test('BandScaffold: nav row, back, actions and large text', () => {
  const s = setup();
  const pressed = [];
  const tree = scaffoldTree(s, { nav: { back: true, title: 'Bills', actions: [{ icon: 'plus', label: 'Add a bill', onPress: () => pressed.push('add') }] } });
  const back = walk(tree).find((node) => node.props?.testID === 'band-back');
  assert.equal(back.props.accessibilityLabel, 'Back');
  back.props.onPress();
  assert.deepEqual(s.events.at(-1), ['back']);
  const action = walk(tree).find((node) => node.props?.accessibilityLabel === 'Add a bill');
  assert.equal(action.props.accessibilityRole, 'button');
  assert.ok(flat(action.props.style({ pressed: false })).width >= 44);
  action.props.onPress();
  assert.deepEqual(pressed, ['add']);
  const title = walk(tree).find((node) => node.props?.accessibilityRole === 'header');
  assert.equal(text(title), 'Bills');
  // Arabic: the same controls, Arabic label; the chevron mirrors in Icon.
  const ar = walk(scaffoldTree(setup({ language: 'ar' }), { nav: { back: true } })).find((node) => node.props?.testID === 'band-back');
  assert.equal(ar.props.accessibilityLabel, 'رجوع');
  // Large text: the title leaves the control row for its own line.
  const large = walk(scaffoldTree(setup({ largeText: true }), { nav: { back: true, title: 'Bills' } }));
  const heading = large.find((node) => node.props?.accessibilityRole === 'header');
  assert.ok(flat(heading.props.style).paddingTop > 0);
});

test('BandScaffold: tab clearance, refresh tint and keyboard avoidance', () => {
  const s = setup();
  const palette = s.band('home');
  const tree = scaffoldTree(s, { tabbed: true, floatingClearance: 72, keyboardAware: true,
    refreshControl: s.jsx('RefreshControl', { refreshing: false, onRefresh() {} }) });
  const nodes = walk(tree);
  const column = walk(nodes.find((node) => node.props?.testID === 'screen-sheet')).find((node) => flat(node.props?.style).paddingBottom !== undefined);
  assert.equal(flat(column.props.style).paddingBottom, 88 + 72, 'the last row clears the tab bar and the floating Add');
  const scroll = nodes.find((node) => node.type === 'ScrollView');
  assert.equal(scroll.props.refreshControl.props.tintColor, palette.onBand, 'the spinner reads on the band');
  assert.ok(nodes.some((node) => node.type === 'KeyboardAvoidingView'));
});

test('BandSegmented: a tablist of tabs, the selected one on the sheet surface', () => {
  const s = setup();
  const palette = s.band('spending');
  const changed = [];
  const tree = s.ui('@/components/ui/band/band-segmented').BandSegmented({ label: 'Spending view', palette, value: 'compare',
    onChange: (value) => changed.push(value),
    segments: [{ value: 'categories', label: 'Categories' }, { value: 'compare', label: 'Compare' }, { value: 'calendar', label: 'Calendar' }] });
  assert.equal(tree.props.accessibilityRole, 'tablist');
  const tabs = walk(tree).filter((node) => node.props?.accessibilityRole === 'tab');
  assert.deepEqual(tabs.map((tab) => tab.props.accessibilityState.selected), [false, true, false]);
  assert.equal(flat(tabs[1].props.style).backgroundColor, palette.selected);
  assert.equal(flat(tabs[0].props.style).backgroundColor, 'transparent');
  assert.equal(flat(walk(tabs[1]).find((node) => node.type === 'Text').props.style).color, palette.onSelected);
  tabs[2].props.onPress();
  assert.deepEqual(changed, ['calendar']);
});

test('ShareBar: one tone, top three named with shares that add to 100, the rest counted', () => {
  const s = setup();
  const { ShareBar, sharePercents } = s.ui('@/components/ui/band/share-bar');
  assert.deepEqual([...sharePercents([1836, 1004, 880, 562, 438, 214, 180, 366])].reduce((a, b) => a + b, 0), 100);
  assert.deepEqual([...sharePercents([1, 1, 1])], [34, 33, 33]);
  assert.deepEqual([...sharePercents([0, 0])], [0, 0]);
  const palette = s.band('spending');
  const tree = ShareBar({ palette, label: 'spending', segments: [
    { key: 'g', label: 'Groceries', value: 1836 }, { key: 'd', label: 'Dining', value: 1004 }, { key: 's', label: 'Shopping', value: 880 },
    { key: 't', label: 'Transport', value: 562 }, { key: 'u', label: 'Utilities', value: 438 }, { key: 'x', label: 'Other', value: 760 },
  ] });
  const image = walk(tree).find((node) => node.props?.accessibilityRole === 'image');
  assert.equal(image.props.accessibilityLabel, 'Share of spending: Groceries 34%, Dining 18%, Shopping 16%, 3 other categories 32%');
  const segments = walk(image).filter((node) => flat(node.props?.style).flexGrow !== undefined);
  assert.equal(segments.length, 6);
  assert.ok(segments.every((node) => flat(node.props.style).backgroundColor === palette.onBand), 'no hue stands for a category');
  assert.match(text(tree), /\+3 more/);
});

test('StatusBar (limit): green within, amber from 85%, red over', () => {
  const s = setup();
  const { limitStatus, limitFillPercent } = s.ui('@/lib/limit-status');
  assert.deepEqual([84, 85, 100, 101].map((spent) => limitStatus(spent, 100)), ['ok', 'near', 'near', 'over']);
  assert.equal(limitFillPercent(150, 100), 100);
  assert.equal(limitStatus(1, 0), 'over', 'spending against a zero limit is over it');
  const palette = s.band('spending');
  const colour = (spent) => {
    const bar = s.ui('@/components/ui/band/status-bar').StatusBar({ spentMinor: spent, limitMinor: 100, palette });
    assert.equal(flat(bar.props.style).backgroundColor, palette.rule, 'the track is the sheet rule');
    return flat(walk(bar.props.children).find((node) => node.type === 'View').props.style).backgroundColor;
  };
  assert.deepEqual([50, 92, 120].map(colour), [palette.statusOk, palette.statusNear, palette.statusOver]);
});

test('DialLimit: adjustable, currency-scaled steps, snapped, announced with its currency', () => {
  const s = setup();
  const { DialLimit, snapDialValue, dialValueAt } = s.ui('@/components/ui/band/dial-limit');
  assert.equal(snapDialValue(123456, 2500, 500000), 122500);
  assert.equal(snapDialValue(-10, 2500, 500000), 0);
  assert.equal(dialValueAt(75, 0, 150, 400000, 2500), 0, 'the top of the dial is zero');
  assert.equal(dialValueAt(150, 75, 150, 400000, 2500), 100000, 'a quarter turn clockwise');
  const changes = [];
  const tree = DialLimit({ valueMinor: 120000, onChange: (next) => changes.push(next), palette: s.band('spending'), label: 'Dining', moneySpec: AED });
  const dial = walk(tree).find((node) => node.props?.accessibilityRole === 'adjustable');
  assert.equal(dial.props.accessibilityValue.text, 'AED 1,200');
  assert.match(dial.props.accessibilityLabel, /^Dining/);
  dial.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
  dial.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } });
  // The harness ledger is AED: ledgerTypicalMinor(25) = 2,500 fils.
  assert.deepEqual(changes, [122500, 117500]);
  const raise = walk(tree).find((node) => node.props?.accessibilityLabel === 'Raise by AED 25');
  assert.ok(raise, 'steppers name their currency-scaled step');
});

test('EButton: 56pt, 16pt radius, centred label; primary takes the band fill', () => {
  const s = setup();
  const palette = s.band('accounts');
  const { EButton } = s.ui('@/components/ui/band/e-button');
  const primary = EButton({ label: 'Record a payment', onPress() {}, palette });
  const style = flat(primary.props.style({ pressed: false }));
  assert.equal(style.minHeight, 56);
  assert.equal(style.borderRadius, 16);
  assert.equal(style.justifyContent, 'center');
  assert.equal(style.backgroundColor, palette.fill);
  assert.equal(primary.props.accessibilityLabel, 'Record a payment');
  const disabled = EButton({ label: 'Save', onPress() {}, palette, disabled: true, variant: 'secondary' });
  assert.equal(disabled.props.accessibilityState.disabled, true);
  assert.equal(flat(disabled.props.style({ pressed: false })).backgroundColor, palette.card);
  const custom = EButton({ label: 'Make it mine', onPress() {}, palette, color: { fill: '#F4F1EA', text: '#16130F' } });
  assert.equal(flat(custom.props.style({ pressed: false })).backgroundColor, '#F4F1EA');
});

test('GlyphTile: one tone for every category', () => {
  const s = setup();
  const palette = s.band('spending');
  const { GlyphTile } = s.ui('@/components/ui/band/glyph-tile');
  const a = GlyphTile({ category: 'dining', palette });
  const b = GlyphTile({ category: 'groceries', palette });
  assert.equal(flat(a.props.style).backgroundColor, flat(b.props.style).backgroundColor);
  assert.equal(flat(a.props.style).backgroundColor, palette.glyphGround);
  assert.equal(a.props.accessible, false);
});

test('PinTimeline: every payment spoken in date order; pins stay on the strip', () => {
  const s = setup();
  const { PinTimeline, pinPosition } = s.ui('@/components/ui/band/pin-timeline');
  assert.equal(pinPosition(0, 30), 3);
  assert.equal(pinPosition(30, 30), 97);
  assert.equal(pinPosition(45, 30), 97);
  const tree = PinTimeline({ palette: s.band('bills'), pins: [
    { key: 'b', dayOffset: 3, title: 'ADCB', spokenAmount: 'AED 3,180' },
    { key: 'a', dayOffset: 1, title: 'DEWA', spokenAmount: 'about AED 420' },
    { key: 'z', dayOffset: 40, title: 'Later' },
  ] });
  assert.equal(tree.props.accessibilityLabel, 'Next 30 days: DEWA tomorrow about AED 420, ADCB in 3 days AED 3,180');
});

test('PatternMosaic: one image called "Your pattern", a 6 × 2 grid, still under Reduce Motion', () => {
  const s = setup({ motion: 'reduced' });
  const { buildPattern } = s.ui('@/lib/pattern');
  const tiles = buildPattern({ name: 'Sara', goals: ['bills', 'salary'], watched: ['dining'], reminders: { dailySummary: true } });
  const tree = s.ui('@/components/ui/pattern-mosaic').PatternMosaic({ tiles, tile: 26, animate: true });
  assert.equal(tree.props.accessibilityRole, 'image');
  assert.equal(tree.props.accessibilityLabel, 'Your pattern');
  const rows = tree.props.children;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.props.children.length === 6));
  const animated = walk(tree).filter((node) => node.type === 'View' && flat(node.props?.style).opacity !== undefined);
  assert.equal(animated.length, tiles.length);
  assert.ok(animated.every((node) => flat(node.props.style).transform[0].scale === 1), 'every tile is already in place');
  assert.match(text(tree), /S/);
  const arabic = setup({ language: 'ar', motion: 'reduced' });
  assert.equal(arabic.ui('@/components/ui/pattern-mosaic').PatternMosaic({ tiles }).props.accessibilityLabel, 'نمطك');
});
