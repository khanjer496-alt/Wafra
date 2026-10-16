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
    delay: recorder('delay'), sequence: recorder('sequence'), parallel: recorder('parallel'),
    // A coin's resting value plus its window of the group clock (coin-motion.ts coinTrack).
    add: (rest) => rest };
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

test('ordinary text pins the actions in order; the accessibility sizes pin only the primary', () => {
  const s = setup({ language: 'en' });
  const { nodes } = frame(s);
  const order = walk(byID(nodes, 'onboarding-watch-actions')).map((node) => node.props?.testID)
    .filter((id) => id === 'primary' || id === 'secondary');
  assert.deepEqual(order, ['primary', 'secondary'], 'primary, then the quieter action');
  for (const language of ['en', 'ar']) {
    const large = frame(setup({ largeText: true, language })).nodes;
    const pinned = byID(large, 'onboarding-watch-actions');
    assert.ok(byID(walk(pinned), 'primary'), `${language}: the primary stays in view at 2–3x text`);
    assert.equal(byID(walk(pinned), 'secondary'), undefined, `${language}: the strip is one button tall`);
    const scroll = large.find((node) => node.type === 'ScrollView');
    assert.ok(byID(walk(scroll), 'secondary'), `${language}: Skip ends the scroll, straight after the content`);
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
  // Once the strip has risen, the field clears the keyboard and the strip above it.
  // The viewport already ends above the strip's resting place: only the lift covers it.
  assert.match(source, /if \(keyboardBottom <= 0\) return;[\s\S]{0,240}revealFocusedInput\(scrollRef\.current, scrollY\.current, keyboardBottom\)/);
  assert.doesNotMatch(source, /stripHeight/);
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

test('the pinned strip rides the keyboard as paint: lifted on the native driver, the safe area counted once', () => {
  const s = setup({ keyboard: 336, motion: 'moving' });
  const { keyboardLift, KEYBOARD_FOLLOW_MS } = s.deps['@/components/onboarding/e-frame'];
  assert.equal(keyboardLift(336, 34, 'ios'), 302, 'iOS: the keyboard less the home-indicator inset the frame already pads');
  assert.equal(keyboardLift(300, 48, 'android'), 300, 'Android reports the keyboard above the navigation bar');
  assert.equal(keyboardLift(0, 34, 'ios'), 0);
  const { nodes } = frame(s);
  const column = nodes.find((node) => node.type === 'SafeAreaView').props.children;
  assert.equal(flat(column.props.style).paddingBottom, undefined, 'nothing is laid out again: the body never jumps');
  const strip = byID(nodes, 'onboarding-watch-actions');
  assert.equal(strip.type, 'Animated.View');
  assert.ok(flat(strip.props.style).transform[0].translateY instanceof s.deps['react-native'].Animated.Value);
  assert.equal(flat(strip.props.style).backgroundColor, s.theme.BandPalettes.light.settings.band, 'the body passes behind it');
  assert.ok(byID(nodes, 'onboarding-watch-keyboard-room'), 'room at the body\'s foot to scroll every field clear');
  s.runEffects();
  const follow = s.started.find((run) => run.kind === 'timing' && run.args[1].toValue === -302);
  assert.ok(follow, 'the strip follows the keyboard up');
  assert.equal(follow.args[1].duration, KEYBOARD_FOLLOW_MS);
  assert.equal(follow.args[1].useNativeDriver, s.deps['@/components/ui/coins/coin-motion'].nativeDriver);
  // Reduce Motion: the strip is simply where it belongs.
  const reduced = setup({ keyboard: 300, platform: 'android' });
  frame(reduced);
  reduced.runEffects();
  assert.ok(reduced.set.includes(-300));
  assert.equal(reduced.started.filter((run) => run.kind === 'timing').length, 0);
  const none = frame(setup()).nodes;
  assert.equal(byID(none, 'onboarding-watch-keyboard-room'), undefined);
  assert.doesNotMatch(read('src/components/onboarding/e-frame.tsx'), /paddingBottom: keyboardBottom/);
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

// The reference harness pins the clock to 2026-09-06T12:00:00Z; the greeting reads that hour, not the real one.
const HARNESS_HOUR = new Date('2026-09-06T12:00:00Z').getHours();

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
  assert.equal(preview.props.accessibilityLabel, `${s.words.firstTile} ${s.words.homeGreets} ${s.words.greeting(HARNESS_HOUR, 'Sam')}`);
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
    assert.ok(s.set.includes(1), `${motion}: the initial's face, in place`);
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
  // Every leaving step is below the arriving one, so its header shows from the first frame.
  assert.match(source, /\[\.\.\.underWipe\.map\(leavingLayer\), wipeLayer,\s*\.\.\.shownLeaving\.filter\(\(item\) => !item\.wipe\)\.map\(leavingLayer\), activeLayer\]/);
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
  const layer = () => h.nodes().find((node) => node.props?.testID === 'onboarding-step-layer');
  assert.equal(layer().props.pointerEvents, 'none', '…before the settle lock ends (touches swallowed)');
  assert.notEqual(h.byTestID('onboarding-watch-continue').props.disabled, true, 'the lock is never drawn');
  await h.advance(350 - stepLeaveHoldMs(true));
  assert.equal(layer().props.pointerEvents, 'box-none', 'the next step is usable at 350ms, as before');
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

test('keyboard Done closes the keyboard and never skips the country and currency rows', () => {
  const input = byID(nameStep(setup()).nodes, 'onboarding-name-input');
  assert.equal(input.props.onSubmitEditing, undefined, 'Done must not continue past the hidden rows');
  assert.equal(input.props.submitBehavior, 'blurAndSubmit');
});

/* ── device QA round: glitches seen on a real Android phone ─────────────── */

const rootLayers = (h) => {
  // The overlay's band: the View that draws the step layers.
  const root = walk(h.tree).find((node) => node.type === 'View' &&
    [node.props?.children].flat(Infinity).some((child) => child?.props?.testID === 'onboarding-step-layer'));
  return [root.props.children].flat(Infinity).filter((child) => /^onboarding-step-layer/.test(child?.props?.testID ?? ''));
};

test('1 · the settle lock is never drawn: no spinner, no dimming, touches swallowed by the arriving layer', async () => {
  const source = read('src/components/onboarding-gate.tsx');
  // `transitioning` only guards handlers and the layer; no busy/disabled/finishing visual reads it.
  const uses = source.split('\n').filter((line) => /\btransitioning\b/.test(line));
  for (const line of uses) {
    assert.doesNotMatch(line, /\b(busy|disabled|finishing|backDisabled)=\{[^}]*transitioning/, line.trim());
    assert.doesNotMatch(line, /const backDisabled = [^;]*transitioning/, line.trim());
  }
  assert.match(source, /locked=\{transitioning \|\| handoffTiles !== null\}/, 'locked through the settle and the hand-off');
  const h = await gate({ profile: profile('tracking'), manualClock: true, reducedMotion: false });
  await h.press('skipForNow');
  const allow = h.byTestID('onboarding-reminders-allow');
  assert.equal(allow.props.accessibilityState.busy, false, 'Allow shows its label, not a spinner');
  assert.notEqual(allow.props.disabled, true);
  assert.equal(flat(allow.props.style({ pressed: false })).opacity, 1, 'not dimmed');
  assert.equal(h.nodes().find((node) => node.props?.testID === 'onboarding-step-layer').props.pointerEvents, 'none');
  await h.advance(350);
  assert.equal(h.nodes().find((node) => node.props?.testID === 'onboarding-step-layer').props.pointerEvents, 'box-none');
});

test('2 · without a wipe the leaving step sits below the arriving one, so the new header shows from frame 1', async () => {
  const h = await gate({ platform: 'android', reducedMotion: false, manualClock: true, profile: profile('focus') });
  await h.advance(600);
  await h.press('skipForNow');
  const layers = rootLayers(h).map((layer) => layer.props.testID);
  assert.deepEqual(layers, ['onboarding-step-layer-leaving', 'onboarding-step-layer'], 'old below, new on top');
  const active = rootLayers(h).at(-1);
  const header = walk(active).find((node) => node.type === 'View' && flat(node.props?.style).minHeight === 52);
  assert.notEqual(flat(header.props.style).opacity, 0, 'the new back control and dots are drawn at once');
  assert.ok(walk(header).some((node) => node.props?.testID === 'onboarding-back'));
});

test('3 · into Home: the paywall stays drawn and fades (words first when the pattern flies); Home\'s pattern is covered until it lands', async () => {
  const s = setup({ motion: 'moving', insets: { top: 47, bottom: 34, left: 0, right: 0 } });
  s.deps['@/components/onboarding/e-paywall'] = { PAYWALL_BACKDROP_TOP: 56, paywallBackdropOpacity: (scheme) => scheme === 'dark' ? 0.62 : 0.42 };
  s.deps['@/components/ui/pattern-mosaic'] = { PatternMosaic: (p) => s.jsx('PatternMosaic', p) };
  s.deps['@/components/onboarding/e-pattern'] = { PATTERN_MOSAIC_TOP: 100 };
  s.local('@/components/onboarding/e-handoff');
  const { OverlayHandoff, handoffGeometry, HANDOFF_WORDS_MS, handoffMs } = s.deps['@/components/onboarding/e-handoff'];
  const tiles = s.deps['@/lib/pattern'].buildPattern({ name: 'Sam', goals: ['bills'], watched: ['dining'] });
  const child = s.jsx('View', { testID: 'paywall-overlay' });
  // Not handing off: a plain, touchable pass-through.
  const idle = walk(OverlayHandoff({ tiles: null, onDone() {}, children: child }));
  assert.equal(idle[0].props?.testID ?? idle.find((node) => node.type === 'Animated.View')?.props.testID, undefined);
  assert.ok(byID(idle, 'paywall-overlay'));
  // Handing off where the flourish runs (iOS): the overlay itself fades, the pattern flies.
  const tree = OverlayHandoff({ tiles, onDone() {}, children: child });
  const nodes = walk(tree);
  const overlay = byID(nodes, 'onboarding-handoff');
  assert.ok(byID(walk(overlay), 'paywall-overlay'), 'the paywall is still drawn, not cut on the first frame');
  assert.ok(hiddenFromAssistiveTech(overlay));
  assert.equal(overlay.props.pointerEvents, 'none');
  const flying = byID(nodes, 'onboarding-handoff-pattern');
  const geometry = handoffGeometry(tiles, 320, 47, false);
  assert.equal(geometry.start.top, 47 + 56, 'starts where the paywall draws its backdrop');
  assert.deepEqual([...flat(flying.props.style).opacity.outputRange], [0.42, 1, 1], 'starts at the backdrop\'s dimming');
  const patch = byID(nodes, 'onboarding-handoff-patch');
  assert.equal(flat(patch.props.style).backgroundColor, s.theme.BandPalettes.light.home.band);
  assert.ok(flat(patch.props.style).width >= geometry.home.width && flat(patch.props.style).start <= geometry.end.start,
    'Home\'s own pattern is covered until the copy lands on it');
  assert.equal(overlay.props.needsOffscreenAlphaCompositing, true, 'Android fades the overlay as one layer');
  s.runEffects();
  const fades = s.started.at(-1).args[0];
  assert.equal(fades[0].args[1].duration, HANDOFF_WORDS_MS, 'the words go in the first beat');
  assert.equal(fades[1].args[1].duration, handoffMs(true));
  // Android (no flourish): the whole paywall cross-fades into Home, no separate mosaic.
  const android = setup({ motion: 'moving', platform: 'android' });
  android.deps['@/components/onboarding/e-paywall'] = s.deps['@/components/onboarding/e-paywall'];
  android.deps['@/components/ui/pattern-mosaic'] = s.deps['@/components/ui/pattern-mosaic'];
  android.deps['@/components/onboarding/e-pattern'] = s.deps['@/components/onboarding/e-pattern'];
  android.local('@/components/onboarding/e-handoff');
  const plain = walk(android.deps['@/components/onboarding/e-handoff'].OverlayHandoff({ tiles, onDone() {}, children: child }));
  assert.equal(byID(plain, 'onboarding-handoff-pattern'), undefined);
  assert.equal(byID(plain, 'onboarding-handoff-patch'), undefined);
  android.runEffects();
  assert.equal(android.started.at(-1).args[0][0].args[1].duration, handoffMs(false));
  // The gate keeps the overlay for the hand-off, wrapped by a stable element (no remount when it starts).
  const gateSource = read('src/components/onboarding-gate.tsx');
  assert.match(gateSource, /if \(!showOverlay && handoffTiles === null\)/);
  assert.match(gateSource, /<OverlayHandoff tiles=\{handoffTiles\} from=\{activeStep === 'pattern' \? 'pattern' : 'paywall'\}\s*onDone=\{\(\) => setHandoff\(null\)\}>/);
  assert.equal(walk(OverlayHandoff({ tiles: null, onDone() {}, children: child })).find((node) => node.type === 'Animated.View')
    .props.needsOffscreenAlphaCompositing, false,
    'only while the hand-off runs');
});

test('3 · the iPhone flourish finishes into Home with the overlay drawn until the flight lands', async () => {
  const h = await gate({ profile: profile('capture', null), manualClock: true, reducedMotion: false });
  await h.press('addByHand'); await h.advance(400);
  await h.press('continue'); await h.advance(400);
  await h.press('oneLastThing'); await h.advance(400);
  h.byTestID('onboarding-paywall-free').props.onPress(); await h.advance(0);
  assert.deepEqual(h.routes, [['replace', '/']]);
  assert.ok(walk(h.tree).some((node) => node.props?.testID === 'onboarding-paywall'), 'the paywall is still there to fade');
  assert.ok(walk(h.tree).some((node) => node.props?.testID === 'onboarding-handoff-pattern'));
  await h.advance(600);
  assert.equal(walk(h.tree).some((node) => node.props?.testID === 'onboarding-handoff'), false);
});

test('4a · Goals and Watch keep their button\'s height whatever its label says', async () => {
  const s = setup();
  s.local('@/components/ui/band/e-button');
  const { EButton } = s.deps['@/components/ui/band/e-button'];
  const palette = s.theme.BandPalettes.light.flow;
  const nodes = walk(EButton({ palette, label: 'Continue', onPress() {}, reserveLabels: ['Continue', 'Skip for now'] }));
  const texts = nodes.filter((node) => node.type === 'Text');
  assert.deepEqual(texts.map((node) => text(node).trim()), ['Continue', 'Skip for now']);
  const ghost = texts[1];
  assert.equal(flat(ghost.props.style).opacity, 0);
  assert.equal(flat(ghost.props.style).marginStart, '-100%', 'laid over the shown label: the row is as tall as the taller');
  assert.equal(ghost.props.accessibilityElementsHidden, true);
  assert.equal(nodes[0].props.accessibilityLabel, 'Continue', 'it still speaks only what it says');
  // Without the opt-in the button draws exactly as before.
  assert.equal(walk(EButton({ palette, label: 'Continue', onPress() {} })).filter((node) => node.type === 'Text').length, 1);
  assert.match(read('src/components/onboarding/e-goals.tsx'), /reserveLabels=\{\[words\.continue, words\.skipForNow\]\}/);
  const watch = read('src/components/onboarding/e-watch.tsx');
  assert.match(watch, /reserveLabels=\{reserveLabels\}/);
  assert.match(watch, /\[words\.skipForNow, words\.continue,\s*\.\.\.WATCH_CATEGORIES\.map\(\(_category, index\) => words\.watchSave\(index \+ 1\)\)\]/);
});

test('4b/4c · Watch at large text: the amount field has the width, "per month" its own line, names wrap whole', async () => {
  for (const language of ['en', 'ar']) {
    const h = await gate({ profile: profile('tracking'), largeText: true, language,
      ledger: { ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 } } });
    await h.tap('onboarding-watch-dining');
    const steps = h.byTestID('onboarding-watch-limit-steps');
    assert.equal(flat(steps.props.style).flexDirection, undefined, `${language}: a column`);
    const rows = [steps.props.children].flat(Infinity).filter(Boolean)
      .flatMap((node) => node.type === 'Fragment' ? [node.props.children].flat(Infinity).filter(Boolean) : [node]);
    const perMonth = rows.find((node) => node.props?.testID === 'onboarding-watch-limit-per-month');
    assert.ok(perMonth, `${language}: per month under the field, not squeezed beside a stepper`);
    const field = rows[0];
    assert.ok(!walk(field).some((node) => node.props?.testID === 'onboarding-watch-limit-per-month'));
    const steppers = rows.find((node) => walk(node).some((child) => child.props?.testID === 'onboarding-watch-limit-raise'));
    assert.ok(rows.indexOf(perMonth) < rows.indexOf(steppers), `${language}: − and + on a row of their own, last`);
    assert.equal(flat(field.props.style).alignSelf, 'stretch');
    assert.ok(!walk(field).some((node) => node.props?.testID === 'onboarding-watch-limit-raise'), 'no stepper in the field\'s row');
    const row = h.byTestID('onboarding-watch-groceries');
    const first = [row.props.children].flat(Infinity).filter(Boolean)[0];
    assert.equal(first.type, 'Text', `${language}: the name comes first`);
    assert.equal(flat(first.props.style).flexBasis, '100%', `${language}: on a line of its own, so it wraps between words`);
  }
  const ordinary = await gate({ profile: profile('tracking'), ledger: { ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 } } });
  await ordinary.tap('onboarding-watch-dining');
  assert.equal(flat(ordinary.byTestID('onboarding-watch-limit-steps').props.style).flexDirection, 'row');
});

test('6 · Pattern → Paywall: the backdrop starts as the reveal\'s mosaic and settles up into its dimmed place', async () => {
  const pattern = read('src/components/onboarding/e-pattern.tsx');
  assert.match(pattern, /export const PATTERN_MOSAIC_TOP = E_TOP_ROW_HEIGHT \+ E_BODY_TOP \+ MOSAIC_TOP_PAD;/);
  const paywall = read('src/components/onboarding/e-paywall.tsx');
  assert.match(paywall, /outputRange: \[PATTERN_MOSAIC_TOP - PAYWALL_BACKDROP_TOP, 0\]/);
  assert.match(paywall, /outputRange: \[1, dim\]/, 'from full strength to its dimming');
  assert.match(paywall, /Animated\.delay\(STEP_ARRIVE_DELAY_MS\)/, 'once the reveal\'s words have gone');
  const h = await gate({ profile: profile('capture'), manualClock: true, reducedMotion: false });
  await h.press('addByHand'); await h.advance(400);
  await h.press('continue'); await h.advance(400);
  await h.press('oneLastThing');
  const backdrop = walk(h.tree).find((node) => node.props?.testID === 'onboarding-paywall-backdrop' &&
    !walk(h.tree).some((leaving) => leaving.props?.testID === 'onboarding-step-layer-leaving' && walk(leaving).includes(node)));
  assert.ok(flat(backdrop.props.style).transform, 'rising from the reveal\'s place');
  const reduced = await gate({ profile: profile('capture') });
  await reduced.press('addByHand'); await reduced.press('continue'); await reduced.press('oneLastThing');
  const still = reduced.byTestID('onboarding-paywall-backdrop-dim');
  assert.equal(typeof flat(still.props.style).opacity, 'number', 'Reduce Motion: simply dimmed in place');
});

test('7 · returning to Goals does not pop the tray again; only a goal picked on this visit pops', () => {
  const s = setup({ motion: 'moving' });
  s.deps['@/lib/home-widgets'] = { loadHomeWidgetPreferences: async () => ({ order: [], hidden: [] }) };
  s.deps['@/components/ui/pattern-mosaic'] = { PatternMosaic: (p) => s.jsx('PatternMosaic', p) };
  s.local('@/lib/customize-copy', 'src/lib/customize-copy.ts');
  s.local('@/components/onboarding/e-choice-row');
  s.local('@/components/onboarding/e-goals');
  const { GoalsStep } = s.deps['@/components/onboarding/e-goals'];
  const { buildPattern } = s.deps['@/lib/pattern'];
  // Each render is a fresh mount here (this harness keeps no state between calls), as a return to the step is.
  const visit = (goals) => {
    const tree = GoalsStep({ goals, onToggle() {}, onContinue() {}, onBack() {}, disabled: false,
      tiles: buildPattern({ name: 'Sam', goals }) });
    s.runEffects();
    return Object.fromEntries(walk(tree).filter((node) => node.type === 'PatternMosaic')
      .map((node) => [node.props.tiles[0].key, node.props.animate]));
  };
  const first = visit(['bills']);
  assert.ok(Object.values(first).every(Boolean), 'the first visit pops its tiles in');
  const back = visit(['bills']);
  assert.ok(Object.values(back).every((animate) => animate === false), 'back on Goals, the tray is simply there');
  const picked = visit(['bills', 'salary']);
  assert.equal(Object.values(picked).filter(Boolean).length, 1, 'only the new pick pops');
});

test('8 · the Watch editor fades in as it opens; status is not shown on a step that is leaving', async () => {
  const watch = read('src/components/onboarding/e-watch.tsx');
  assert.match(watch, /Animated\.timing\(appear, \{ toValue: 1, duration: Motion\.change/);
  assert.match(watch, /<Animated\.View style=\{\[styles\.editor, \{ borderTopColor: palette\.bandRule \}, appearPaint\]\}/);
  const s = setup({ phase: { leaving: true, paint: null } });
  const { ActiveStepOnly } = s.deps['@/components/onboarding/e-motion'];
  assert.equal(ActiveStepOnly({ children: s.jsx('Text', { children: 'Saving your choice…' }) }), null);
  const live = setup();
  assert.ok(live.deps['@/components/onboarding/e-motion'].ActiveStepOnly({ children: live.jsx('Text', { children: 'x' }) }));
  assert.match(read('src/components/onboarding-gate.tsx'), /<ActiveStepOnly><ThemedText[^>]*\s*style=\{\{ color: stepBand\.onBandSecondary \}\}>\{t\('onboardSetupWorking'\)\}/);
});

test('9 · web: the Watch amount field has no browser focus box', async () => {
  const h = await gate({ profile: profile('tracking'), platform: 'web', ledger: { ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 } } });
  await h.tap('onboarding-watch-dining');
  assert.equal(flat(h.byTestID('onboarding-watch-limit-input').props.style).outlineWidth, 0);
  const ios = await gate({ profile: profile('tracking'), ledger: { ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 } } });
  await ios.tap('onboarding-watch-dining');
  assert.equal(flat(ios.byTestID('onboarding-watch-limit-input').props.style).outlineWidth, undefined);
});

/* ── review follow-ups ──────────────────────────────────────────────────── */

test('review 1 · the hand-off places from the start edge on native (any isRTL), physically on the web', () => {
  const s = setup();
  s.deps['@/components/onboarding/e-paywall'] = { PAYWALL_BACKDROP_TOP: 56, paywallBackdropOpacity: () => 0.42 };
  s.deps['@/components/ui/pattern-mosaic'] = { PatternMosaic: (p) => s.jsx('PatternMosaic', p) };
  s.deps['@/components/onboarding/e-pattern'] = { PATTERN_MOSAIC_TOP: 100 };
  s.local('@/components/onboarding/e-handoff');
  const { handoffGeometry } = s.deps['@/components/onboarding/e-handoff'];
  const tiles = s.deps['@/lib/pattern'].buildPattern({ name: 'Sam', goals: ['bills'] });
  const en = handoffGeometry(tiles, 390, 47, false, 'paywall', 'ios');
  const ar = handoffGeometry(tiles, 390, 47, true, 'paywall', 'ios');
  // Native: the same logical offsets in both languages; Yoga (and an Arabic relaunch's I18nManager) mirrors them once.
  assert.deepEqual([en.start.start, en.end.start, en.patch.start], [ar.start.start, ar.end.start, ar.patch.start]);
  for (const box of [ar.start, ar.end, ar.patch]) assert.equal(box.left, undefined, 'no physical side to be swapped twice');
  assert.equal(ar.end.start, 20, 'lands on Home\'s pattern, 20pt in from the start edge');
  // The travel is a transform, never mirrored: physical, opposite in Arabic.
  assert.ok(ar.dx > 0, 'in Arabic the pattern travels right, to the start edge');
  // Web: physical, from the app's language.
  const web = handoffGeometry(tiles, 390, 47, true, 'paywall', 'web');
  assert.equal(web.end.start, undefined);
  assert.equal(web.end.left, 390 - 20 - web.home.width, 'web Arabic: Home\'s pattern at the right');
  assert.equal(web.patch.left, web.end.left - 4);
});

test('review 2 · the fading paywall cannot take a second "Start free" during the hand-off', async () => {
  const h = await gate({ profile: profile('capture', null), manualClock: true, reducedMotion: false });
  await h.press('addByHand'); await h.advance(400);
  await h.press('continue'); await h.advance(400);
  await h.press('oneLastThing'); await h.advance(400);
  h.byTestID('onboarding-paywall-free').props.onPress(); await h.advance(0);
  const layer = walk(h.tree).find((node) => node.props?.testID === 'onboarding-step-layer');
  assert.equal(layer.props.pointerEvents, 'none', 'the layer swallows touches while it fades into Home');
  const completed = h.events.filter((event) => event[0] === 'committed').length;
  const free = walk(layer).find((node) => node.props?.testID === 'onboarding-paywall-free');
  free.props.onPress(); await h.advance(0);
  assert.equal(h.events.filter((event) => event[0] === 'committed').length, completed, 'no second completion');
  assert.equal(h.routes.length, 1);
  assert.match(read('src/components/onboarding-gate.tsx'),
    /const finishJourney = \(\) => \{[\s\S]{0,200}\/\/ Already handing over to Home[^\n]*\n\s*if \(handoff !== null\) return;\s*void runSetupAction/);
});

test('review 4 · the Watch amount field shows focus on its underline', async () => {
  const h = await gate({ profile: profile('tracking'), platform: 'web', ledger: { ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 } } });
  await h.tap('onboarding-watch-dining');
  assert.equal(flat(h.byTestID('onboarding-watch-limit-field').props.style).borderBottomWidth, 2);
  h.byTestID('onboarding-watch-limit-input').props.onFocus(); await h.flush();
  const focused = flat(h.byTestID('onboarding-watch-limit-field').props.style);
  assert.equal(focused.borderBottomWidth, 3, 'heavier while focused');
  assert.equal(focused.marginBottom, -1, 'nothing below moves');
  h.byTestID('onboarding-watch-limit-input').props.onBlur(); await h.flush();
  assert.equal(flat(h.byTestID('onboarding-watch-limit-field').props.style).borderBottomWidth, 2);
});

test('review 5 · a new journey pops the Goals tray anew; the gate forgets on reset', () => {
  const s = setup({ motion: 'moving' });
  s.deps['@/lib/home-widgets'] = { loadHomeWidgetPreferences: async () => ({ order: [], hidden: [] }) };
  s.deps['@/components/ui/pattern-mosaic'] = { PatternMosaic: (p) => s.jsx('PatternMosaic', p) };
  s.local('@/lib/customize-copy', 'src/lib/customize-copy.ts');
  s.local('@/components/onboarding/e-choice-row');
  s.local('@/components/onboarding/e-goals');
  const { GoalsStep } = s.deps['@/components/onboarding/e-goals'];
  const { buildPattern } = s.deps['@/lib/pattern'];
  const visit = (journey) => {
    const tree = GoalsStep({ goals: ['bills'], onToggle() {}, onContinue() {}, onBack() {}, disabled: false, journey,
      tiles: buildPattern({ name: 'Sam', goals: ['bills'] }) });
    s.runEffects();
    return walk(tree).filter((node) => node.type === 'PatternMosaic').map((node) => node.props.animate);
  };
  assert.ok(visit('journey:0:1').every(Boolean));
  assert.ok(visit('journey:0:1').every((animate) => animate === false), 'the same journey: already shown');
  assert.ok(visit('preview:1:1').every(Boolean), 'a Settings preview (a new run) pops them again');
  const gateSource = read('src/components/onboarding-gate.tsx');
  assert.match(gateSource, /const resetJourneyState = \(\) => \{\s*\/\/ A fresh run[^\n]*\n\s*setJourneyRun\(\(run\) => run \+ 1\);\s*forgetTrayTiles\(\);/);
  // trayTiles keeps its own documentation.
  assert.match(read('src/components/onboarding/e-goals.tsx'), /so it reads as a mark on the flow band\.\n \*\/\nexport function trayTiles/);
});

test('review 6 · a journey ending on the reveal hands off from the reveal\'s place, at full strength', () => {
  const s = setup({ motion: 'moving' });
  s.deps['@/components/onboarding/e-paywall'] = { PAYWALL_BACKDROP_TOP: 56, paywallBackdropOpacity: () => 0.42 };
  s.deps['@/components/ui/pattern-mosaic'] = { PatternMosaic: (p) => s.jsx('PatternMosaic', p) };
  s.deps['@/components/onboarding/e-pattern'] = { PATTERN_MOSAIC_TOP: 100 };
  s.local('@/components/onboarding/e-handoff');
  const { OverlayHandoff, handoffGeometry } = s.deps['@/components/onboarding/e-handoff'];
  const tiles = s.deps['@/lib/pattern'].buildPattern({ name: 'Sam', goals: ['bills'] });
  assert.equal(handoffGeometry(tiles, 390, 47, false, 'pattern').start.top, 47 + 100);
  const nodes = walk(OverlayHandoff({ tiles, from: 'pattern', onDone() {}, children: s.jsx('View', {}) }));
  const flying = byID(nodes, 'onboarding-handoff-pattern');
  assert.equal(flat(flying.props.style).top, 47 + 100);
  assert.deepEqual([...flat(flying.props.style).opacity.outputRange], [1, 1, 1], 'not dimmed: the reveal drew it at full strength');
});
