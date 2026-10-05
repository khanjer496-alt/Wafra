'use strict';
// Onboarding's shared flow: the step frame's pinned actions, the Name step's
// flipping tile and large-text layout, the step change (no empty colour field),
// the band each step wears, and the first-payment result's limit coins. Source
// runs through the repair harness and the journey harness (not a device
// renderer): layout, motion and accessibility are asserted as the props they
// set, effects are run by hand where motion matters.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness, walk, text } = require('./reference-harness.cjs');
const { gate, profile } = require('../ios-journey/onboarding-extreme-navigation.test.cjs');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const flat = (style) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const byID = (nodes, id) => nodes.find((node) => node.props?.testID === id);
const hiddenFromAssistiveTech = (node) => node.props.accessibilityElementsHidden === true &&
  node.props.importantForAccessibility === 'no-hide-descendants';

function setup({ language = 'en', theme = 'light', motion = 'reduced', platform = 'ios', largeText = false, fontScale, phase,
  keyboard = 0, insets = { top: 47, bottom: 34, left: 0, right: 0 } } = {}) {
  const h = createHarness({ platform, theme, language, largeText });
  // The step layer's phase context: consumers read `phase` (the default outside a test that sets one).
  h.deps.react.createContext = (value) => ({ Provider: 'ContextProvider', _default: value });
  h.deps.react.useContext = (context) => phase ?? context._default;
  const effects = [];
  const started = [];
  const set = [];
  h.deps.react.useEffect = (effect) => { effects.push(effect); };
  const native = h.deps['react-native'];
  native.Platform.OS = platform;
  native.useWindowDimensions = () => ({ width: 320, height: 844, fontScale: fontScale ?? (largeText ? 2 : 1) });
  // Core Animated that records what was asked of it; values remember what they were set to.
  class Value {
    constructor(value) { this.value = value; }
    setValue(value) { this.value = value; set.push(value); }
    interpolate(config) { return { interpolate: true, from: this, ...config }; }
  }
  const recorder = (kind) => (...args) => {
    const run = { kind, args, start() { started.push(run); }, stop() {} };
    return run;
  };
  native.Animated = { View: 'Animated.View', Value, timing: recorder('timing'), spring: recorder('spring'),
    delay: recorder('delay'), sequence: recorder('sequence'), parallel: recorder('parallel') };
  native.Easing = { bezier: () => null, in: (e) => e, out: (e) => e, inOut: (e) => e, quad: (v) => v, cubic: (v) => v };
  native.I18nManager = { isRTL: language === 'ar' };
  h.deps['@/hooks/use-reduced-motion'] = {
    useReducedMotion: () => motion === 'reduced',
    useMotionPreference: () => ({ ready: motion !== 'unknown', reducedMotion: motion === 'reduced' }),
  };
  h.deps['react-native-safe-area-context'] = { useSafeAreaInsets: () => insets, SafeAreaView: (p) => h.jsx('SafeAreaView', p) };
  h.deps['@/hooks/use-keyboard-height'] = { useKeyboardHeight: () => keyboard };
  h.local('@/components/ui/coins/coin-motion', 'src/components/ui/coins/coin-motion.ts');
  h.local('@/components/ui/coins/coin-disc');
  h.local('@/components/ui/coins/coin-stack');
  h.local('@/lib/types', 'src/lib/types.ts');
  h.local('@/lib/splits', 'src/lib/splits.ts');
  h.local('@/lib/onboarding-e', 'src/lib/onboarding-e.ts');
  h.local('@/lib/onboarding-e-copy', 'src/lib/onboarding-e-copy.ts');
  h.local('@/lib/pattern', 'src/lib/pattern.ts');
  h.deps['@/lib/onboarding'] = { normalizePreferredName: (value) => typeof value === 'string' && value.trim() ? value.trim() : null,
    MAX_PREFERRED_NAME_LENGTH: 40 };
  h.deps['@/components/country-picker-sheet'] = { CountryPickerSheet: (p) => h.jsx('CountryPickerSheet', p),
    countryPickerName: (code) => code ? 'United Arab Emirates' : null };
  h.deps['@/lib/country'] = { countryFlag: () => '' };
  h.deps['@/components/ui/band/status-bar'] = { StatusBar: (p) => h.jsx('LimitBar', p) };
  h.deps['@/components/ui/merchant-avatar'] = { MerchantAvatar: (p) => h.jsx('MerchantAvatar', p) };
  h.deps['react-native-reanimated'] = { ...h.deps['react-native-reanimated'],
    default: { View: 'Reanimated.View', createAnimatedComponent: (c) => c }, useAnimatedProps: (f) => f() };
  h.local('@/components/onboarding/e-motion');
  h.local('@/components/onboarding/e-frame');
  h.local('@/components/onboarding/e-name');
  h.local('@/components/onboarding/e-first-payment');
  const runEffects = () => effects.splice(0).map((effect) => effect()).filter((cleanup) => typeof cleanup === 'function');
  return { ...h, effects, started, set, runEffects, words: h.deps['@/lib/onboarding-e-copy'].onboardingECopy(language),
    theme: h.deps['@/constants/theme'] };
}

/* ── the frame: the primary action is pinned, never below the fold ─────── */

function frame(s, props = {}) {
  const { EStepFrame } = s.deps['@/components/onboarding/e-frame'];
  const palette = s.theme.BandPalettes.light.settings;
  const tree = EStepFrame({ palette, step: 3, onBack() {}, testID: 'onboarding-watch',
    footer: s.jsx('Fragment', { children: [
      s.jsx('Pressable', { testID: 'primary', accessibilityLabel: 'Save 1 limit', onPress() {} }),
      null,
      false,
      s.jsx('Pressable', { testID: 'secondary', accessibilityLabel: 'Skip for now', onPress() {} }),
      s.jsx('Text', { testID: 'status', accessibilityLiveRegion: 'polite', children: 'Not a Wafra backup' }),
    ] }),
    children: s.jsx('View', { testID: 'body' }), ...props });
  return { tree, nodes: walk(tree), palette };
}

test('every step pins its actions below the scrolling body, above the bottom safe area', () => {
  const s = setup();
  const { tree, nodes } = frame(s);
  const safe = nodes.find((node) => node.type === 'SafeAreaView');
  assert.deepEqual([...safe.props.edges], ['top', 'bottom'], 'the safe area pads the pinned strip off the home indicator');
  const scroll = nodes.find((node) => node.type === 'ScrollView');
  const pinned = byID(nodes, 'onboarding-watch-actions');
  assert.ok(pinned, 'the actions have their own pinned strip');
  // The strip is a sibling after the scroll view, never inside it.
  assert.equal(byID(walk(scroll), 'primary'), undefined, 'the primary action does not scroll away');
  assert.ok(byID(walk(pinned), 'primary'));
  assert.ok(byID(walk(pinned), 'secondary'), 'at ordinary sizes the quieter action is pinned too');
  const column = safe.props.children;
  const content = [column.props.children].flat(Infinity).find((node) => node?.type === 'Animated.View');
  const kids = [content.props.children].flat(Infinity).filter(Boolean);
  assert.ok(kids.indexOf(scroll) >= 0 && kids.indexOf(scroll) < kids.indexOf(pinned), 'body above, actions below');
  assert.equal(flat(scroll.props.style).flex, 1, 'the body takes the room the actions leave');
  assert.equal(flat(pinned.props.style).paddingHorizontal, 24, 'the strip keeps the side gutter');
  assert.ok(byID(walk(scroll), 'body'));
  assert.ok(tree);
});

test('at every text size the actions stay pinned in order, so the primary is read before Skip', () => {
  for (const [language, largeText] of [['en', false], ['en', true], ['ar', true]]) {
    const s = setup({ largeText, language });
    const { nodes } = frame(s);
    const pinned = byID(nodes, 'onboarding-watch-actions');
    const order = walk(pinned).map((node) => node.props?.testID).filter((id) => id === 'primary' || id === 'secondary');
    assert.deepEqual(order, ['primary', 'secondary'], `${language}${largeText ? ' large' : ''}: primary, then the quieter action`);
    const scroll = nodes.find((node) => node.type === 'ScrollView');
    assert.equal(byID(walk(scroll), 'secondary'), undefined, 'no action is read before the pinned primary');
  }
});

test('status text in a footer is not an action: it ends the scroll, never the pinned strip', () => {
  const s = setup();
  const { nodes } = frame(s);
  assert.equal(byID(walk(byID(nodes, 'onboarding-watch-actions')), 'status'), undefined);
  assert.ok(byID(walk(nodes.find((node) => node.type === 'ScrollView')), 'status'));
});

test('footers split into actions and status: fragments flatten, empty slots drop, order kept', () => {
  const s = setup();
  const { footerActions, splitFooter } = s.deps['@/components/onboarding/e-frame'];
  const a = s.jsx('Pressable', { testID: 'a', onPress() {} });
  const b = s.jsx('Pressable', { testID: 'b', onPress() {} });
  const note = s.jsx('Text', { children: 'note' });
  const split = (footer, pin) => { const out = splitFooter(footer, pin); return { pinned: [...out.pinned], scrolled: [...out.scrolled] }; };
  assert.deepEqual([...footerActions(null)], []);
  assert.deepEqual([...footerActions(s.jsx('Fragment', { children: [null, a, [false, b]] }))], [a, b]);
  assert.deepEqual([...footerActions(a)], [a], 'a single button is its own primary');
  assert.deepEqual(split(s.jsx('Fragment', { children: [a, b, note] }), true), { pinned: [a, b], scrolled: [note] });
  assert.deepEqual(split(s.jsx('Fragment', { children: [a, b, note] }), false), { pinned: [], scrolled: [a, b, note] });
  // A step without a footer draws no strip.
  const { nodes } = frame(s, { footer: null });
  assert.equal(byID(nodes, 'onboarding-watch-actions'), undefined);
});

test('a capture step offering only "How it works" pins nothing; Set up / Continue are pinned', async () => {
  const source = read('src/components/onboarding-gate.tsx');
  assert.match(source, /pinActions=\{Platform\.OS === 'ios' \|\| \(Platform\.OS === 'android' && \(androidSmsReady \|\| androidNotificationReady\)\)\}/);
  const h = await gate({ profile: profile('capture') });
  assert.ok(h.byTestID('onboarding-ios-live-actions'), 'iPhone: Set up is pinned');
  const android = await gate({ profile: profile('capture'), platform: 'android' });
  assert.equal(android.byTestID('onboarding-capture-actions'), undefined, 'no primary yet: How it works ends the scroll');
  assert.ok(android.byTestID('onboarding-how-it-works'));
});

test('a focused field is scrolled clear of the pinned strip when the keyboard opens', () => {
  const s = setup();
  const { scrollTargetForInput } = s.deps['@/components/onboarding/e-frame'];
  // Viewport 100–500 (the strip and keyboard below it); a field at 480–528.
  assert.equal(scrollTargetForInput({ viewTop: 100, viewHeight: 400, inputTop: 480, inputHeight: 48, offsetY: 60 }), 60 + 44);
  assert.equal(scrollTargetForInput({ viewTop: 100, viewHeight: 400, inputTop: 200, inputHeight: 48, offsetY: 60 }), null, 'in view: no scroll');
  assert.equal(scrollTargetForInput({ viewTop: 100, viewHeight: 400, inputTop: 90, inputHeight: 48, offsetY: 60 }), 34, 'above: back down');
  const source = read('src/components/onboarding/e-frame.tsx');
  assert.match(source, /TextInput\.State\?\.currentlyFocusedInput/);
  assert.match(source, /if \(keyboardBottom <= 0\) return;\s*const frame = requestAnimationFrame\(\(\) => revealFocusedInput/);
});

test('pinActions={false} keeps every action at the end of the scroll (the paywall)', () => {
  for (const largeText of [false, true]) {
    const s = setup({ largeText });
    const { nodes } = frame(s, { pinActions: false });
    assert.equal(byID(nodes, 'onboarding-watch-actions'), undefined, 'no pinned strip');
    const scroll = nodes.find((node) => node.type === 'ScrollView');
    assert.ok(byID(walk(scroll), 'primary') && byID(walk(scroll), 'secondary'), 'both actions scroll after the content');
  }
  assert.match(read('src/components/onboarding/e-paywall.tsx'), /<EStepFrame[^>]*testID="onboarding-paywall"[\s\S]{0,120}pinActions=\{false\}/);
});

test('the paywall\'s actions are not in a pinned strip: they follow its price, terms and legal links', async () => {
  const h = await gate({ profile: profile('capture') });
  await h.press('addByHand');
  await h.tap('onboarding-complete-continue');
  await h.tap('onboarding-pattern-continue');
  const paywall = h.byTestID('onboarding-paywall');
  assert.ok(paywall, 'reached the paywall');
  assert.equal(h.byTestID('onboarding-paywall-actions'), undefined, 'no pinned strip on the paywall');
  const scroll = walk(paywall).find((node) => node.type === 'ScrollView');
  assert.ok(byID(walk(scroll), 'onboarding-paywall-free'), 'Start free scrolls with the content');
  // Every earlier step still pins its primary action.
  const fresh = await gate();
  assert.ok(fresh.byTestID('onboarding-welcome-actions'), 'Welcome pins Get started');
});

test('the pinned actions ride above the keyboard on both platforms', () => {
  const ios = frame(setup({ keyboard: 336 })).nodes;
  const iosColumn = ios.find((node) => node.type === 'SafeAreaView').props.children;
  assert.equal(flat(iosColumn.props.style).paddingBottom, 336 - 34, 'iOS: the keyboard less the safe area already padded');
  const android = frame(setup({ keyboard: 300, platform: 'android' })).nodes;
  assert.equal(flat(android.find((node) => node.type === 'SafeAreaView').props.children.props.style).paddingBottom, 300);
  const none = frame(setup()).nodes;
  assert.equal(flat(none.find((node) => node.type === 'SafeAreaView').props.children.props.style).paddingBottom, undefined);
});

test('the frame keeps its accessibility contracts: one scroll, bounces only at large text, labelled progress', () => {
  const source = read('src/components/onboarding/e-frame.tsx');
  assert.match(source, /bounces=\{largeText\} alwaysBounceVertical=\{false\}/);
  assert.match(source, /footer: \{ marginTop: 'auto'/);
  assert.match(source, /accessibilityRole="progressbar"/);
  assert.doesNotMatch(source, /automaticallyAdjustKeyboardInsets/, 'the frame pads for the keyboard itself, never twice');
  assert.doesNotMatch(source, /position: 'absolute'/, 'the strip is in the layout flow, so content never hides under it');
});

/* ── Name: the tile turns over; words wrap whole; the lock grows ──────── */

function nameStep(s, props = {}) {
  const { NameStep } = s.deps['@/components/onboarding/e-name'];
  const tree = NameStep({ nameDraft: '', onChangeName() {}, onContinue() {}, onSkip() {}, onBack() {}, busy: false,
    saveFailed: false, country: 'AE', suggestedCountry: 'AE', onCountry() {}, currency: 'AED', onCurrency() {}, ...props });
  return { tree, nodes: walk(tree) };
}

test('Name wears slate, its own colour, so the wipe from Welcome\'s ink is seen', () => {
  const s = setup();
  const e = s.deps['@/lib/onboarding-e'];
  assert.equal(e.ONBOARDING_E_BANDS.name, 'accounts');
  for (const scheme of ['light', 'dark']) {
    const bands = s.theme.BandPalettes[scheme];
    const order = ['welcome', 'name', 'goals', 'watch', 'reminders', 'capture'];
    for (let i = 1; i < order.length; i++) {
      assert.notEqual(bands[e.ONBOARDING_E_BANDS[order[i]]].band, bands[e.ONBOARDING_E_BANDS[order[i - 1]]].band,
        `${scheme}: ${order[i - 1]} → ${order[i]} changes colour`);
    }
    assert.notEqual(bands[e.ONBOARDING_E_BANDS.name].band, bands.spending.band, 'not the near-black that hid the wipe');
  }
  const { nodes } = nameStep(s);
  const button = byID(nodes, 'onboarding-name-continue');
  assert.equal(flat(button.props.style({ pressed: false })).backgroundColor, s.theme.BandPalettes.light.accounts.onBand);
  // The comments say what the bands are.
  const lib = read('src/lib/onboarding-e.ts');
  assert.match(lib, /Name slate; Goals and the first payment indigo/);
  assert.doesNotMatch(lib, /Name clay|Goals and first payment green/);
});

test('the first tile is a card hidden from assistive tech; the preview still speaks the same words', () => {
  const s = setup({ motion: 'moving' });
  const { nodes } = nameStep(s, { nameDraft: 'Sam' });
  const tile = byID(nodes, 'onboarding-name-tile');
  assert.ok(hiddenFromAssistiveTech(tile));
  assert.equal(tile.props.pointerEvents, 'none');
  const letter = byID(nodes, 'onboarding-name-tile-letter');
  const blank = byID(nodes, 'onboarding-name-tile-blank');
  assert.equal(text(letter).trim(), 'S');
  // Each face turns on its vertical axis, in perspective, and shows on its own half of the turn.
  for (const face of [letter, blank]) {
    const style = flat(face.props.style);
    assert.equal(style.transform[0].perspective, 900);
    assert.ok(style.transform[1].rotateY.interpolate);
    assert.ok(style.opacity.interpolate);
    assert.equal(style.backfaceVisibility, 'hidden');
  }
  assert.deepEqual([...flat(blank.props.style).transform[1].rotateY.outputRange], ['0deg', '180deg']);
  assert.deepEqual([...flat(letter.props.style).transform[1].rotateY.outputRange], ['-180deg', '0deg']);
  const preview = byID(nodes, 'onboarding-name-preview');
  assert.equal(preview.props.accessibilityLabel, `${s.words.firstTile} ${s.words.homeGreets} ${s.words.greeting(new Date().getHours(), 'Sam')}`);
});

test('typing a name turns the blank face over to the initial; clearing turns it back', () => {
  const s = setup({ motion: 'moving' });
  nameStep(s, { nameDraft: 'Sam' });
  s.runEffects();
  const turn = s.started.find((run) => run.kind === 'spring');
  assert.ok(turn, 'the turn springs');
  assert.equal(turn.args[1].toValue, 1, 'a name shows the initial');
  assert.equal(turn.args[1].overshootClamping, true, 'COIN_MOVE: a turn, not a wobble');
  s.started.length = 0;
  nameStep(s, { nameDraft: '' });
  s.runEffects();
  assert.equal(s.started.find((run) => run.kind === 'spring').args[1].toValue, 0, 'cleared: back to the blank face');
});

test('Reduce Motion shows the face at once, and nothing turns before the motion answer is known', () => {
  for (const motion of ['reduced', 'unknown']) {
    const s = setup({ motion });
    nameStep(s, { nameDraft: 'Sam' });
    s.runEffects();
    assert.equal(s.started.length, 0, `${motion}: no turn`);
    assert.equal(s.set.at(-1), 1, `${motion}: the initial's face, in place`);
  }
});

test('at large text the greeting takes the full width (words wrap whole) and the lock grows with the line', () => {
  const s = setup({ largeText: true, fontScale: 2 });
  const { nodes } = nameStep(s);
  const preview = byID(nodes, 'onboarding-name-preview');
  assert.equal(flat(preview.props.style).flexDirection, 'column', 'the tile above, the words under it');
  const copy = preview.props.children.find((child) => child?.props?.style && flat(child.props.style).alignSelf === 'stretch');
  assert.ok(copy, 'the words span the step, not the room beside a 96pt tile');
  // The lock sits in a box one privacy line tall (20pt at 1x), centred on the first line.
  const box = nodes.find((node) => flat(node.props?.style).height === 40 && flat(node.props?.style).justifyContent === 'center');
  assert.ok(box, 'the lock box grows with the line');
  const size = walk(box).find((node) => node.props?.width !== undefined).props.width;
  assert.equal(size, 28, 'a 14pt lock at 2x text is 28pt');
  const ordinary = nameStep(setup({ fontScale: 1 })).nodes;
  assert.equal(flat(byID(ordinary, 'onboarding-name-preview').props.style).flexDirection, 'row');
});

/* ── the step change: no empty colour field ───────────────────────────── */

function layer(s, props) {
  const { StepLayer } = s.deps['@/components/onboarding/e-motion'];
  const tree = StepLayer({ leaving: false, wipe: false, arriving: true, color: '#2F6577',
    children: s.jsx('View', { testID: 'step' }), ...props });
  return tree;
}

test('a leaving step stays drawn on its own colour, inert and hidden from assistive tech', () => {
  const s = setup({ motion: 'moving' });
  const leaving = layer(s, { leaving: true, wipe: true, arriving: false, color: '#16130F' });
  assert.ok(hiddenFromAssistiveTech(leaving));
  assert.equal(leaving.props.pointerEvents, 'none');
  assert.equal(leaving.props['aria-hidden'], true);
  assert.equal(flat(leaving.props.style).backgroundColor, '#16130F', 'the old colour stays until the wipe covers it');
  const active = layer(s, {});
  assert.equal(active.props.accessibilityElementsHidden, false);
  assert.equal(flat(active.props.style).backgroundColor, undefined, 'the active step sits on the root band');
});

test('the step change is sequenced: old content is gone before the new starts, never drawn over it', () => {
  const s = setup({ motion: 'moving' });
  const e = s.deps['@/components/onboarding/e-motion'];
  const { nativeDriver } = s.deps['@/components/ui/coins/coin-motion'];
  layer(s, { leaving: true, wipe: true, arriving: false });
  s.runEffects();
  const leave = s.started.at(-1);
  assert.equal(leave.kind, 'parallel');
  const [fade, ...rest] = leave.args[0];
  assert.equal(fade.args[1].toValue, 0);
  assert.equal(fade.args[1].duration, e.STEP_LEAVE_MS);
  assert.ok(e.STEP_LEAVE_MS >= 100 && e.STEP_LEAVE_MS <= 140, 'about 120ms out');
  assert.equal(rest.length, 0, 'under the wipe the old colour stays for the circle; only its content fades');
  layer(s, { leaving: false, wipe: true, arriving: true, follows: true });
  s.runEffects();
  const arrive = s.started.at(-1).args[0][0];
  assert.equal(arrive.args[1].toValue, 1);
  assert.ok(arrive.args[1].delay >= fade.args[1].duration, 'the new content starts only once the old has faded');
  for (const run of [fade, arrive]) assert.equal(run.args[1].useNativeDriver, nativeDriver, 'paint only, on the native driver');
  // The first step of all (nothing leaving) does not wait.
  layer(s, { leaving: false, wipe: false, arriving: true, follows: false });
  s.runEffects();
  assert.equal(s.started.at(-1).args[0][0].args[1].delay, 0);
});

test('without a wipe (Android, one colour) the band stays: content out, then in', () => {
  const s = setup({ motion: 'moving', platform: 'android' });
  const e = s.deps['@/components/onboarding/e-motion'];
  layer(s, { leaving: true, wipe: false, arriving: false });
  s.runEffects();
  const runs = s.started.at(-1).args[0];
  assert.equal(runs.length, 2);
  for (const run of runs) assert.equal(run.args[1].duration, e.STEP_LEAVE_MS, 'content and its colour go together, in 120ms');
  for (const wipe of [true, false]) {
    assert.equal(e.stepLeaveHoldMs(wipe), e.STEP_LEAVE_MS + 40);
    assert.ok(e.stepLeaveHoldMs(wipe) < 350, 'gone inside the gate\'s 350ms settle lock');
  }
});

test('the header is never doubled: a leaving frame hides it at once, the arriving one shows it at once', () => {
  const leavingPhase = { leaving: true, paint: { opacity: 'content' } };
  const nodes = frame(setup({ phase: leavingPhase })).nodes;
  const topRow = (list) => list.find((node) => node.type === 'View' && flat(node.props?.style).minHeight === 52);
  const row = topRow(nodes);
  assert.equal(flat(row.props.style).opacity, 0, 'the old back control and dots are gone from the first frame');
  const arriving = frame(setup({ phase: { leaving: false, paint: { opacity: 'content' } } })).nodes;
  const safe = arriving.find((node) => node.type === 'SafeAreaView');
  const column = [safe.props.children.props.children].flat(Infinity).filter(Boolean);
  const header = column.find((node) => walk(node).some((child) => child.props?.testID === 'onboarding-back'));
  const content = column.find((node) => node.type === 'Animated.View');
  assert.notEqual(flat(header.props.style).opacity, 0, 'the new header is drawn at once');
  assert.equal(walk(content).some((node) => node.props?.testID === 'onboarding-back'), false, 'the header is outside the fade');
  assert.equal(flat(content.props.style).opacity, 'content', 'the body and actions fade with the step');
  // Outside the gate (no layer) nothing fades and nothing hides.
  const plain = frame(setup()).nodes;
  assert.notEqual(flat(topRow(plain).props.style).opacity, 0);
});

test('Reduce Motion swaps steps at once: nothing animates, the leaving step is gone', () => {
  const s = setup({ motion: 'reduced' });
  layer(s, { leaving: true, wipe: true, arriving: false });
  layer(s, { leaving: false, wipe: false, arriving: true });
  s.runEffects();
  assert.equal(s.started.length, 0);
  assert.deepEqual(s.set, [0, 0, 1, 1], 'leaving: content and layer gone; arriving: in place');
});

test('the gate keeps the step just left under its own key, then lets it go', async () => {
  const h = await gate({ reducedMotion: false, manualClock: true });
  await h.press('getStarted');
  const leaving = walk(h.tree).find((node) => node.props?.accessibilityElementsHidden === true && byID(walk(node), 'onboarding-welcome'));
  assert.ok(leaving, 'Welcome is still drawn while Name arrives');
  assert.equal(leaving.props.pointerEvents, 'none');
  assert.ok(h.byTestID('onboarding-name'), 'Name is the step a person can use');
  assert.equal(h.byTestID('onboarding-welcome'), undefined, 'the leaving step is not reachable');
  await h.advance(600);
  assert.equal(walk(h.tree).some((node) => node.props?.testID === 'onboarding-welcome'), false, 'released once faded');
  const source = read('src/components/onboarding-gate.tsx');
  assert.match(source, /<StepLayer key=\{`step-\$\{item\.step\}`\} leaving/);
  assert.match(source, /<StepLayer key=\{`step-\$\{activeStep\}`\} leaving=\{false\}/);
  assert.match(source, /\[\.\.\.underWipe\.map\(leavingLayer\), wipeLayer, activeLayer,/);
  assert.doesNotMatch(source, /stepEntering|from 'react-native-reanimated'/, 'the step layer is core Animated');
  // Nothing about the step change is written to a ref during render: only the layer's effect records a frame.
  assert.doesNotMatch(source, /lastFrame|shownColor/);
  assert.match(source, /onCommit=\{\(element\) => \{ committedFrame\.current = \{ step: activeStep, element \}; \}\}/);
  assert.ok(h.events.some((event) => event[0] === 'keyboardDismiss'), 'the keyboard closes when a step starts leaving');
});

test('under Reduce Motion the gate never keeps a leaving step', async () => {
  const h = await gate({ manualClock: true });
  await h.press('getStarted');
  assert.equal(walk(h.tree).some((node) => node.props?.testID === 'onboarding-welcome'), false);
  assert.ok(h.byTestID('onboarding-name'));
});

/* ── the result: the watched limit, from real state ───────────────────── */

test('limit coins come from the real limit and this month\'s spending; a payment lifts its coins off', () => {
  const s = setup();
  const { limitCoins, LIMIT_COINS } = s.deps['@/components/onboarding/e-first-payment'];
  assert.equal(LIMIT_COINS, 8, 'Home\'s Left-in-budgets stack');
  assert.deepEqual({ ...limitCoins({ category: 'dining', spentMinor: 0, limitMinor: 60000 }) }, { before: 8, after: 8 });
  assert.deepEqual({ ...limitCoins({ category: 'dining', spentMinor: 12000, limitMinor: 50000 }, 12000) }, { before: 8, after: 6 });
  assert.deepEqual({ ...limitCoins({ category: 'dining', spentMinor: 70000, limitMinor: 50000 }, 2400) }, { before: 0, after: 0 });
  assert.deepEqual({ ...limitCoins({ category: 'dining', spentMinor: 49000, limitMinor: 50000 }, 0) }, { before: 1, after: 1 },
    'a little left is never drawn as none');
});

test('the result draws the watched limit as a whole stack, writes and speaks the real figures', () => {
  const s = setup({ theme: 'dark' });
  const { LimitResult } = s.deps['@/components/onboarding/e-first-payment'];
  const palette = s.theme.BandPalettes.dark.flow;
  const tree = LimitResult({ palette, watch: { category: 'dining', spentMinor: 0, limitMinor: 60000 },
    money: { schemaVersion: 2, currency: 'AED', exponent: 2 } });
  const nodes = walk(tree);
  const coins = byID(nodes, 'onboarding-complete-watch-coins');
  assert.ok(hiddenFromAssistiveTech(coins));
  assert.equal(coins.props.pointerEvents, 'none');
  const stack = byID(nodes, 'onboarding-complete-watch-coins-stack');
  assert.ok(stack, 'Home\'s coin stack');
  // Eight gold coins: nothing spent yet.
  const gold = walk(stack).filter((node) => /-coin-\d$/.test(node.props?.testID ?? ''));
  assert.equal(gold.length, 8);
  const spoken = nodes.find((node) => node.props?.accessible && typeof node.props.accessibilityLabel === 'string');
  assert.match(spoken.props.accessibilityLabel, /^Dining, /);
  assert.match(spoken.props.accessibilityLabel, /AED[\s\u00a0]*0 of AED[\s\u00a0]*600$/, 'spent of limit, this month, spoken in full');
  assert.ok(/600/.test(text(tree)), 'the limit is written beside the coins');
});

test('reduce motion shows the level now; with motion the stack starts before the payment, then drains', () => {
  const watch = { category: 'dining', spentMinor: 12000, limitMinor: 50000 };
  const tx = { id: 't', title: 'Cafe', category: 'dining', amountFils: 12000, type: 'expense', date: '2026-09-20', source: 'sms' };
  const money = { schemaVersion: 2, currency: 'AED', exponent: 2 };
  const level = (s) => {
    const { ArrivedCard } = s.deps['@/components/onboarding/e-first-payment'];
    const nodes = walk(ArrivedCard({ palette: s.theme.BandPalettes.light.flow, transaction: tx, money, watch }));
    assert.ok(hiddenFromAssistiveTech(byID(nodes, 'onboarding-first-payment-coins')));
    const stack = byID(nodes, 'onboarding-first-payment-coins-stack');
    return walk(stack).filter((node) => node.props?.on === true).length ||
      walk(stack).filter((node) => /-coin-\d$/.test(node.props?.testID ?? '')).length;
  };
  const reduced = setup();
  assert.ok(level(reduced) >= 6);
  const moving = setup({ motion: 'moving' });
  level(moving);
  // The drain waits for the stack's drop-in, on a timer the effect cleans up.
  const cleanups = moving.runEffects();
  assert.ok(cleanups.length > 0, 'a timer that is cleared on unmount');
  for (const cleanup of cleanups) cleanup();
  const spoken = walk(moving.deps['@/components/onboarding/e-first-payment'].ArrivedCard({
    palette: moving.theme.BandPalettes.light.flow, transaction: tx, money, watch }))
    .find((node) => node.props?.testID === 'onboarding-first-payment-watch');
  assert.match(spoken.props.accessibilityLabel, /^Dining, /, 'the watch row still speaks category and figures');
});

test('the manual result shows the watched limit from the ledger; without a limit nothing is drawn', async () => {
  const h = await gate({ profile: profile('capture'), ledger: { budgets: [{ category: 'dining', limitFils: 60000 }],
    ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 } } });
  await h.press('addByHand');
  assert.ok(h.text().includes(h.eWords.manualTitle), 'the manual heading the e2e reads is unchanged');
  assert.ok(h.byTestID('onboarding-complete'));
  assert.ok(h.byTestID('onboarding-complete-continue'), 'Continue is unchanged');
  const watch = h.byTestID('onboarding-complete-watch');
  assert.ok(watch, 'the limit set on Watch is drawn on the result');
  assert.ok(walk(watch).some((node) => node.props?.accessibilityLabel === `Dining, ${h.eWords.ofLimit('0', '60000')}`));
  assert.deepEqual(h.state.transactions, [], 'drawing the limit writes nothing');
  assert.deepEqual(h.state.budgets, [{ category: 'dining', limitFils: 60000 }]);
  const none = await gate({ profile: profile('capture') });
  await none.press('addByHand');
  assert.equal(none.byTestID('onboarding-complete-watch'), undefined, 'no limit, no invented stack');
});

/* ── review follow-ups: inert leaving steps, rapid changes, confirmed answers ─ */

test('rapid changes keep at most two leaving steps, drop a returned-to step, and never double one', () => {
  const s = setup();
  const { withLeavingStep } = s.deps['@/components/onboarding/e-motion'];
  const entry = (step, wipe = true) => ({ step, color: step, wipe, element: null });
  const steps = (list) => [...list].map((item) => item.step);
  let leaving = withLeavingStep([], entry('welcome'), 'name');
  leaving = withLeavingStep(leaving, entry('name'), 'goals');
  assert.deepEqual(steps(leaving), ['welcome', 'name'], 'A stays while B leaves: nothing drops abruptly');
  leaving = withLeavingStep(leaving, entry('goals'), 'watch');
  assert.deepEqual(steps(leaving), ['name', 'goals'], 'the oldest (already faded) goes first');
  assert.deepEqual(steps(withLeavingStep(leaving, entry('watch'), 'goals')), ['name', 'watch'], 'back to Goals: it is active again');
  assert.deepEqual(steps(withLeavingStep(withLeavingStep([], entry('name'), 'goals'), entry('name'), 'goals')), ['name'],
    'the same change applied twice (a discarded render) leaves one');
});

test('a leaving step cannot act: the next step stays locked until it is gone', async () => {
  const h = await gate({ reducedMotion: false, manualClock: true, profile: profile('focus') });
  await h.advance(600);
  await h.press('skipForNow');
  const leaving = walk(h.tree).find((node) => node.props?.accessibilityElementsHidden === true && byID(walk(node), 'onboarding-goals'));
  assert.ok(leaving, 'Goals is still drawn while Watch arrives');
  const stale = byID(walk(leaving), 'onboarding-goals-continue');
  const saves = h.events.filter((event) => event[0] === 'saveHomeWidgets').length;
  const stage = h.state.onboardingProfile.stage;
  stale.props.onPress(); await h.flush(0);
  assert.equal(h.events.filter((event) => event[0] === 'saveHomeWidgets').length, saves, 'the old Continue saved nothing again');
  assert.equal(h.state.onboardingProfile.stage, stage);
  assert.ok(h.byTestID('onboarding-watch'));
  const { stepLeaveHoldMs } = setup().deps['@/components/onboarding/e-motion'];
  await h.advance(stepLeaveHoldMs(true) + 5);
  assert.equal(walk(h.tree).some((node) => node.props?.testID === 'onboarding-goals'), false, 'Goals is gone');
  assert.equal(h.byTestID('onboarding-watch-continue').props.disabled, true, '…before the settle lock ends');
  await h.advance(350 - stepLeaveHoldMs(true));
  assert.equal(h.byTestID('onboarding-watch-continue').props.disabled, false, 'the next step is usable at 350ms, as before');
});

test('the settle lock stays 350ms with or without motion, and outlasts every leaving step', () => {
  const source = read('src/components/onboarding-gate.tsx');
  assert.match(source, /const STEP_TRANSITION_MS = 350;/);
  const { stepLeaveHoldMs } = setup().deps['@/components/onboarding/e-motion'];
  assert.ok(Math.max(stepLeaveHoldMs(true), stepLeaveHoldMs(false)) < 350);
  // The wipe paints the old colour itself once the leaving step has gone.
  assert.match(source, /from=\{underWipe\.length > 0 \? undefined : wipe\.from\}/);
});

test('Welcome and the SMS explainer get the confirmed currency and country, undefined when unknown', () => {
  const source = read('src/components/onboarding-gate.tsx');
  assert.match(source, /const confirmedCurrency = \(previewMode \? currencyDraft : null\) \?\? state\.ledgerMoney\?\.currency \?\? undefined;/);
  assert.match(source, /const confirmedCountry = selectedCountry \?\? undefined;/);
  assert.match(source, /<WelcomeStep[\s\S]{0,600}currency=\{confirmedCurrency\} country=\{confirmedCountry\} \/>/);
  assert.match(source, /<SmsPermissionExplainer[\s\S]{0,400}currency=\{confirmedCurrency\} country=\{confirmedCountry\}/);
});

test('web: the Name field has no browser focus box; focus shows on its underline', () => {
  const s = setup({ platform: 'web' });
  const { nodes } = nameStep(s);
  const input = byID(nodes, 'onboarding-name-input');
  assert.equal(flat(input.props.style).outlineWidth, 0);
  const underline = byID(nodes, 'onboarding-name-underline');
  const palette = s.theme.BandPalettes.light.accounts;
  assert.equal(flat(underline.props.style).borderBottomColor, palette.onBandSecondary);
  assert.equal(typeof input.props.onFocus, 'function');
  const source = read('src/components/onboarding/e-name.tsx');
  assert.match(source, /borderBottomColor: focused \? band\.onBand : band\.onBandSecondary/);
  assert.match(source, /inputWrapFocused: \{ borderBottomWidth: 3, paddingBottom: 5 \}/, 'heavier when focused, nothing moves');
  const ios = byID(nameStep(setup()).nodes, 'onboarding-name-input');
  assert.equal(flat(ios.props.style).outlineWidth, undefined, 'native fields keep their own focus');
});
