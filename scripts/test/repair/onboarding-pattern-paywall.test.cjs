'use strict';
// Onboarding's pattern reveal and paywall, rendered from source through the
// repair harness (not a device renderer: layout, motion and accessibility are
// asserted as the props they set; effects are run by hand where motion matters).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness, walk, text } = require('./reference-harness.cjs');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
const flat = (style) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

function setup({ language = 'en', theme = 'dark', motion = 'reduced', platform = 'ios', states, appState = 'active' } = {}) {
  const h = createHarness({ platform, theme, language, states });
  const effects = [];
  const started = [];
  const stopped = [];
  let appListener = null;
  // Effects are collected so a test can run (and clean up) them like a mount.
  h.deps.react.useEffect = (effect) => { effects.push(effect); };
  // Core Animated that records what was asked of it; values hold what they are set to.
  const Animated = h.deps['react-native'].Animated;
  const recorder = (kind) => (...args) => {
    const run = { kind, args, start() { started.push(run); }, stop() { stopped.push(run); } };
    return run;
  };
  Object.assign(Animated, { timing: recorder('timing'), spring: recorder('spring'), delay: recorder('delay'),
    sequence: recorder('sequence'), parallel: recorder('parallel'), loop: recorder('loop'),
    multiply: (a, b) => ({ factors: [a, b], get value() { return a.value; } }) });
  // Interpolations keep their mapping, so a test can read where a value puts a drawing;
  // `.value` still reads the driving value, as the final-frame harness always has.
  Animated.Value.prototype.interpolate = function interpolate(config) {
    const source = this;
    return { config, source, get value() { return source.value; } };
  };
  h.deps['react-native'].Easing = { bezier: () => null, in: (e) => e, out: (e) => e, inOut: (e) => e, quad: (v) => v, cubic: (v) => v };
  h.deps['react-native'].AppState = { currentState: appState,
    addEventListener: (_type, listener) => { appListener = listener; return { remove() { appListener = null; } }; } };
  h.deps['react-native'].Linking = { openURL: async () => {} };
  h.deps['@/hooks/use-reduced-motion'] = {
    useReducedMotion: () => motion === 'reduced',
    useMotionPreference: () => ({ ready: true, reducedMotion: motion === 'reduced' }),
  };
  h.deps['react-native-safe-area-context'] = { useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) };
  // The step frame is Agent-shared chrome with its own suite: a named boundary here.
  h.deps['@/components/onboarding/e-frame'] = {
    E_GUTTER: 24, E_TOP_ROW_HEIGHT: 52, E_BODY_TOP: 12,
    fitPatternTile: (width, max = 52) => Math.max(16, Math.min(max, Math.floor((Math.max(120, Math.min(width, 560) - 48)) / (6 + 5 * (6 / 52))))),
    EStepFrame: (p) => h.jsx('EStepFrame', p), EHeadline: (p) => h.jsx('EHeadline', p), EBody: (p) => h.jsx('EBody', p),
    ETextAction: (p) => h.jsx('ETextAction', p),
  };
  // The step layer's fade, as the gate provides it (e-motion's StepLayer); a marker to follow here.
  const stepFade = { opacity: { stepFade: true }, transform: [{ translateY: { stepFade: true } }] };
  h.deps['@/components/onboarding/e-motion'] = { useStepPhase: () => ({ leaving: false, paint: stepFade }), STEP_ARRIVE_DELAY_MS: 120 };
  h.deps['@/lib/onboarding-e'] = { trialTimeline: (days) => days > 0 ? [{ key: 'today', day: 0 }, { key: 'end', day: days }] : [] };
  h.deps['@/lib/public-links'] = { configuredPublicUrl: (key) => `https://example.test/${key}` };
  h.deps['@/lib/purchases'] = { ...h.deps['@/lib/purchases'], billingStore: () => 'appStore', yearlySavingPercent: () => null };
  h.local('@/lib/pro-plans', 'src/lib/pro-plans.ts');
  h.deps['@/components/superwall-billing-context'] = { useWafraBilling: () => ({ available: true, configured: true,
    configurationError: null, fetchProOffers: async () => [], purchasePro: async () => 'cancelled', restorePro: async () => null }) };
  h.local('@/lib/pattern', 'src/lib/pattern.ts');
  h.local('@/lib/onboarding-e-copy', 'src/lib/onboarding-e-copy.ts');
  h.local('@/components/ui/pattern-mosaic');
  h.local('@/components/onboarding/e-pattern');
  h.local('@/components/onboarding/e-paywall');
  const runEffects = () => effects.splice(0).map((effect) => effect()).filter((cleanup) => typeof cleanup === 'function');
  return { ...h, stepFade, effects, started, stopped, runEffects, appChange: (next) => appListener?.(next),
    pattern: h.deps['@/lib/pattern'], words: h.deps['@/lib/onboarding-e-copy'].onboardingECopy(language) };
}

const answers = {
  // Name, one goal, one watched category, a reminder: what Sam answered in the screenshots.
  sam: { name: 'Sam', goals: ['bills', 'subscriptions'], watched: ['dining'] },
  full: { name: 'Sara', goals: ['bills', 'salary', 'subscriptions', 'cash-cards', 'spend-less'], watched: ['dining', 'groceries'],
    reminders: { bills: true, cards: true, dailySummary: true } },
  skipped: {},
};

function renderPattern(s, input, props = {}) {
  const tiles = s.pattern.buildPattern(input);
  const tree = s.deps['@/components/onboarding/e-pattern'].PatternStep({ tiles, name: input.name ?? null, continueLabel: 'One last thing',
    onContinue() {}, disabled: false, ...props });
  return { tiles, tree, nodes: walk(tree) };
}
/** What an Animated node shows right now: an interpolation evaluated, a product multiplied. */
const shown = (node) => {
  if (node.factors) return node.factors.reduce((product, factor) => product * shown(factor), 1);
  if (!node.config) return node.value;
  const { inputRange: input, outputRange: output } = node.config;
  const x = Math.min(input.at(-1), Math.max(input[0], node.source.value));
  for (let i = 1; i < input.length; i++) {
    if (x <= input[i]) return output[i - 1] + ((x - input[i - 1]) / (input[i] - input[i - 1])) * (output[i] - output[i - 1]);
  }
  return output.at(-1);
};
const byID = (nodes, id) => nodes.find((node) => node.props?.testID === id);
/** The mosaic's cells in reading order: true where a tile is drawn. */
const cellsOf = (mosaic) => mosaic.props.children.flatMap((row) => row.props.children.map((cell) => cell.props.children != null));

/* ── the reveal: packed as Home packs it ───────────────────────────────── */

test('the reveal packs skipped answers with no holes, exactly as Home packs them', () => {
  const s = setup();
  for (const input of [answers.sam, answers.full, answers.skipped, { goals: ['spend-less'] }, { watched: ['groceries'], reminders: { bills: true } }]) {
    const { tiles, nodes } = renderPattern(s, input);
    const mosaic = byID(nodes, 'onboarding-pattern-mosaic');
    assert.equal(mosaic.props.accessibilityLabel, 'Your pattern', 'one spoken image, unchanged');
    const layout = s.pattern.compactPattern(tiles);
    const cells = cellsOf(mosaic);
    assert.equal(mosaic.props.children.length, layout.rows);
    assert.equal(cells.length, layout.columns * layout.rows);
    // Every drawn tile comes before every empty cell: a gap can only trail the last row.
    assert.deepEqual(cells, cells.map((_cell, index) => index < tiles.length), JSON.stringify(input));
    assert.equal(cells.filter(Boolean).length, tiles.length, 'nothing invented, nothing dropped');
  }
  // Sam's four tiles sit in one row, the order Home's header shows: S, quarter, fork, ring.
  const { tiles } = renderPattern(s, answers.sam);
  assert.deepEqual(plain(s.pattern.compactPattern(tiles).tiles.map((tile) => tile.key)),
    ['name:you', 'goals:bills', 'watch:dining', 'goals:subscriptions']);
  // Home draws the same packing (YourPattern compact), so the user lands on the picture they just saw.
  assert.match(read('src/screens/journal-home-screen.tsx'), /<YourPattern compact testID="home-personal-pattern"/);
  assert.match(read('src/components/onboarding/e-pattern.tsx'), /<PatternMosaic tiles=\{tiles\} tile=\{tile\} compact wrapTile=\{wrapTile\}/);
});

test('PatternMosaic keeps its defaults for Home, the lock screen and the recap: wrapTile is opt-in', () => {
  const s = setup();
  const tiles = s.pattern.buildPattern(answers.sam);
  const fixed = s.deps["@/components/ui/pattern-mosaic"].PatternMosaic({ tiles, tile: 26 });
  assert.equal(fixed.props.children.length, 2);
  assert.ok(fixed.props.children.every((row) => row.props.children.length === 6), 'still the fixed 6 × 2 grid by default');
  const wrapped = [];
  const mosaic = s.deps['@/components/ui/pattern-mosaic'].PatternMosaic({ tiles, tile: 26,
    wrapTile: (tile, drawn) => { wrapped.push(tile.key); return s.jsx('Wrap', { children: drawn }); } });
  assert.deepEqual(plain(wrapped.sort()), plain(tiles.map((tile) => tile.key).sort()), 'each drawn tile wrapped once, empty cells never');
  assert.equal(walk(mosaic).filter((node) => node.type === 'Wrap').length, tiles.length);
});

test('everything skipped: one clear "You" tile, Home\'s mark on it, and an honest line that it grows', () => {
  for (const language of ['en', 'ar']) {
    const s = setup({ language });
    const { nodes, tree } = renderPattern(s, answers.skipped);
    const mosaic = byID(nodes, 'onboarding-pattern-mosaic');
    assert.equal(mosaic.props.children.length, 1);
    assert.equal(cellsOf(mosaic).length, 1, 'one tile, not a lone tile in a 6 × 2 field');
    // Home's compact pattern draws the Wafra mark on a nameless tile; the reveal and its key do too.
    const mark = walk(s.deps['@/components/wafra-logo'].WafraMark({ size: 20, color: '#000' })).find((node) => node.props?.viewBox);
    assert.ok(walk(mosaic).some((node) => node.type === mark.type && node.props?.viewBox === mark.props.viewBox),
      'the nameless tile carries Wafra\'s mark, as on Home');
    assert.ok(walk(byID(nodes, 'onboarding-pattern-key-name')).some((node) => node.props?.viewBox === mark.props.viewBox),
      'and so does its key swatch');
    const key = byID(nodes, 'onboarding-pattern-legend');
    assert.deepEqual(plain(key.props.children.map((row) => row.key)), ['name']);
    assert.ok(text(tree).includes(s.words.patternNoteStarting));
    assert.ok(!text(tree).includes(s.words.patternNote));
  }
  // With answers, the usual note.
  const s = setup();
  const { tree } = renderPattern(s, answers.sam);
  assert.ok(text(tree).includes(s.words.patternNote));
  assert.ok(!text(tree).includes(s.words.patternNoteStarting));
  const copy = setup().deps['@/lib/onboarding-e-copy'].ONBOARDING_E_COPY;
  assert.deepEqual(plain(Object.keys(copy.en).sort()), plain(Object.keys(copy.ar).sort()));
  assert.match(copy.ar.patternNoteStarting, /[؀-ۿ]/);
  assert.doesNotMatch(copy.en.patternNoteStarting, /\d|AED|bank/i, 'no figure, no bank');
});

test('the key is one column: every row starts at the same edge, in the order the mosaic assembles', () => {
  for (const largeText of [false, true]) {
    const s = setup();
    s.deps['@/hooks/use-large-text-layout'] = { useLargeTextLayout: () => largeText };
    s.local('@/components/onboarding/e-pattern');
    const { nodes } = renderPattern(s, answers.full);
    const key = byID(nodes, 'onboarding-pattern-legend');
    assert.equal(flat(key.props.style).flexDirection, 'column');
    assert.equal(flat(key.props.style).flexWrap, undefined, 'nothing wraps into a second column');
    const rows = key.props.children;
    assert.deepEqual(plain(rows.map((row) => row.key)), ['name', 'goals', 'watch', 'remind']);
    const styles = rows.map((row) => flat(row.props.style));
    for (const style of styles) {
      assert.equal(style.flexDirection, 'row');
      assert.equal(style.flexBasis, undefined, 'no half-width basis to orphan a row');
      assert.equal(style.flexGrow, undefined);
    }
    assert.deepEqual(plain(rows.map((row) => text(row.props.children[1]).trim())), ['You', 'Your goals', 'What you watch', 'Your reminders']);
  }
});

/* ── the reveal's motion ───────────────────────────────────────────────── */

test('Reduce Motion (or a screen reader): the finished mosaic, flat on the screen, and every key row, at once', () => {
  const s = setup({ motion: 'reduced' });
  const { tiles, nodes } = renderPattern(s, answers.full);
  for (const tile of tiles) {
    const wrap = byID(nodes, `onboarding-pattern-tile-${tile.key}`);
    assert.ok(wrap, tile.key);
    const style = flat(wrap.props.style);
    assert.equal(style.opacity.value, 1);
    assert.ok(style.transform.every((step) => Object.values(step)[0].value === 1), 'in place, full size');
  }
  const stage = flat(byID(nodes, 'onboarding-pattern-stage').props.style);
  assert.equal(stage.transform[0].perspective, 900);
  assert.equal(stage.transform.find((step) => step.rotateX).rotateX.value, 1, 'upright, not lying flat');
  for (const row of byID(nodes, 'onboarding-pattern-legend').props.children) assert.equal(flat(row.props.style).opacity.value, 1);
  const cleanups = s.runEffects();
  assert.equal(s.started.length, 0, 'nothing animates');
  cleanups.forEach((cleanup) => cleanup());
});

test('with motion: groups assemble in order with their key rows, then the mosaic lifts on the native driver', () => {
  const s = setup({ motion: 'full' });
  const { tiles, nodes } = renderPattern(s, answers.full);
  const first = byID(nodes, `onboarding-pattern-tile-${tiles[0].key}`);
  assert.equal(flat(first.props.style).opacity.value, 0, 'tiles wait for their group');
  const stage = flat(byID(nodes, 'onboarding-pattern-stage').props.style);
  assert.equal(stage.transform.find((step) => step.rotateX).rotateX.value, 0, 'lying flat before it lifts');
  const cleanups = s.runEffects();
  assert.equal(s.started.length, 1, 'one reveal');
  const steps = s.started[0].args[0];
  // Each step: delay, then a spring to 1 on the native driver.
  const timeline = steps.map((step) => ({ delay: step.args[0][0].args[0], spring: step.args[0][1] }));
  for (const { spring } of timeline) {
    assert.equal(spring.kind, 'spring');
    assert.equal(spring.args[1].toValue, 1);
    assert.equal(spring.args[1].useNativeDriver, true);
  }
  const lift = timeline.at(-1);
  assert.ok(timeline.slice(0, -1).every((step) => step.delay < lift.delay), 'the lift comes after the last group');
  assert.equal(timeline.length, tiles.length + 4 + 1, 'one spring per tile, per key row and the lift');
  // A tile never starts before its own group's key row: name, then goals, then watch, then remind.
  const keyRows = byID(nodes, 'onboarding-pattern-legend').props.children;
  const rowValue = (row) => flat(row.props.style).opacity.source;
  const rowDelays = keyRows.map((row) => timeline.find((step) => step.spring.args[0] === rowValue(row)).delay);
  assert.deepEqual(plain(rowDelays), plain([...rowDelays].sort((a, b) => a - b)));
  assert.equal(new Set(rowDelays).size, rowDelays.length, 'one group at a time');
  for (const tile of tiles) {
    const value = flat(byID(nodes, `onboarding-pattern-tile-${tile.key}`).props.style).opacity.source;
    const step = timeline.find((each) => each.spring.args[0] === value);
    const group = ['name', 'goals', 'watch', 'remind'].indexOf(tile.group);
    assert.ok(step.delay >= rowDelays[group] && (group === 3 || step.delay < rowDelays[group + 1]), tile.key);
  }
  // Interrupted (the person taps on): everything lands where it ends.
  cleanups.forEach((cleanup) => cleanup());
  assert.equal(s.stopped.length, 1);
  assert.equal(flat(first.props.style).opacity.value, 1, 'an interrupted reveal lands finished');
  assert.equal(stage.transform.find((step) => step.rotateX).rotateX.value, 1);
  // Arabic: key rows slide in from the right, the reading start.
  const source = read('src/components/onboarding/e-pattern.tsx');
  assert.match(source, /const slide = language === 'ar' \? ROW_SLIDE : -ROW_SLIDE;/);
  assert.doesNotMatch(source, /react-native-reanimated/, 'core Animated, so Android animates too');
});

/* ── the paywall ───────────────────────────────────────────────────────── */

function renderPaywall(s, input = answers.sam, props = {}) {
  const tiles = s.pattern.buildPattern(input);
  const tree = s.deps['@/components/onboarding/e-paywall'].PaywallStep({ tiles, watchedCategory: 'Dining', remindersOn: false,
    trialDays: 3, captureOn: false, onFinish() {}, preview: false, finishing: false, ...props });
  return { tiles, tree, nodes: walk(tree) };
}

test('the paywall decoration is hidden from assistive tech, untouchable, and drawn from their watched tile', () => {
  const s = setup();
  const { nodes } = renderPaywall(s);
  const deco = byID(nodes, 'onboarding-paywall-keeps-going');
  assert.ok(deco);
  assert.equal(deco.props.pointerEvents, 'none');
  assert.equal(deco.props.importantForAccessibility, 'no-hide-descendants');
  assert.equal(deco.props.accessibilityElementsHidden, true);
  assert.equal(deco.props.accessible, false);
  // A fixed box: the loop never moves the timeline, the plans, the terms or the buttons.
  const box = flat(deco.props.style);
  assert.equal(typeof box.width, 'number');
  assert.equal(typeof box.height, 'number');
  const drawn = walk(deco).find((node) => node.props?.accessibilityRole === 'image');
  assert.equal(drawn.props.accessibilityLabel, '');
  // Their own watched tile, drawn exactly as their pattern draws it.
  const dining = s.pattern.buildPattern(answers.sam).find((tile) => tile.group === 'watch');
  const own = s.deps['@/components/ui/pattern-mosaic'].PatternMosaic({ tiles: [dining], tile: flat(drawn.props.style).width, compact: true, accessibilityLabel: '' });
  assert.equal(JSON.stringify(drawn.props.children), JSON.stringify(own.props.children), 'their category glyph');
  // The timeline's spoken label is unchanged.
  assert.match(byID(nodes, 'onboarding-trial-timeline').props.accessibilityLabel, /^What happens during the free days\. Today: /);
  // No watched category: an example tile, never a figure.
  const generic = byID(renderPaywall(setup(), answers.skipped, { watchedCategory: null }).nodes, 'onboarding-paywall-keeps-going');
  assert.doesNotMatch(text(generic), /\d/);
  assert.match(read('src/components/onboarding/e-paywall.tsx'), /const EXAMPLE_TILE: PatternTile = \{ key: 'watch:example'[\s\S]{0,140}category: 'other'/);
});

test('the paywall loop holds still under Reduce Motion, while a purchase is busy, and in the background', () => {
  const still = (s) => {
    const { nodes } = renderPaywall(s);
    const coin = byID(nodes, 'onboarding-paywall-keeps-going-coin');
    return shown(flat(coin.props.style).opacity);
  };
  // Reduce Motion: the still frame, a coin at the tile's mouth, and nothing runs.
  const reduced = setup({ motion: 'reduced' });
  assert.equal(still(reduced), 1, 'the coin is shown at rest');
  reduced.runEffects();
  assert.equal(reduced.started.filter((run) => run.kind === 'loop').length, 0);
  // Motion on: the loop runs on the native driver…
  const moving = setup({ motion: 'full' });
  renderPaywall(moving);
  const cleanups = moving.runEffects();
  const loops = moving.started.filter((run) => run.kind === 'loop');
  assert.equal(loops.length, 1);
  const leaves = (run) => run.kind === 'sequence' || run.kind === 'parallel' ? run.args[0].flatMap(leaves) : [run];
  const parts = leaves(loops[0].args[0]).filter((part) => part.kind === 'timing' || part.kind === 'spring');
  assert.ok(parts.length >= 5);
  assert.ok(parts.every((part) => part.args[1].useNativeDriver === true), 'every move on the native driver');
  // …stops when the app leaves the foreground and resumes when it is back…
  moving.appChange('background');
  assert.equal(moving.stopped.filter((run) => run.kind === 'loop').length, 1);
  moving.appChange('active');
  assert.equal(moving.started.filter((run) => run.kind === 'loop').length, 2);
  // …and stops when the screen goes away.
  cleanups.forEach((cleanup) => cleanup());
  assert.equal(moving.stopped.filter((run) => run.kind === 'loop').length, 2);
  // A purchase in progress: the loop does not run (busy is index 3 of the checkout's state).
  const busy = setup({ motion: 'full', states: { 3: 'purchase' } });
  const busyTree = renderPaywall(busy);
  assert.equal(byID(busyTree.nodes, 'onboarding-paywall-pro').props.accessibilityState.busy, true, 'the purchase is the busy one');
  busy.runEffects();
  assert.equal(busy.started.filter((run) => run.kind === 'loop').length, 0);
  // Finishing (the free way on saving) holds it too.
  const finishing = setup({ motion: 'full' });
  renderPaywall(finishing, answers.sam, { finishing: true });
  finishing.runEffects();
  assert.equal(finishing.started.filter((run) => run.kind === 'loop').length, 0);
});

test('the paywall backdrop is Home\'s packed pattern, dimmed less on the dark band', () => {
  const opacityIn = (theme) => {
    const s = setup({ theme });
    const { nodes, tiles } = renderPaywall(s);
    // The dimming is on the backdrop's own layer (it settles there when the paywall follows the reveal).
    const dim = byID(nodes, 'onboarding-paywall-backdrop-dim');
    const backdrop = walk(dim).find((node) => node.props?.accessibilityRole === 'image' &&
      cellsOf(node).length === s.pattern.compactPattern(tiles).columns);
    assert.ok(backdrop, 'the packed backdrop');
    assert.deepEqual(cellsOf(backdrop), cellsOf(backdrop).map(() => true), 'no holes behind the words either');
    return flat(dim.props.style).opacity;
  };
  const light = opacityIn('light');
  const dark = opacityIn('dark');
  assert.ok(dark > light, 'more of it on the dark band, where dimmed tiles nearly vanished');
  assert.ok(dark <= 0.7, 'still behind the words');
});

test('the free way on is the one button when there is no Pro button; prices and legal links are untouched', () => {
  // The store answered with nothing (the web, an unconfigured store): checkout state is index 1.
  const s = setup({ states: { 1: 'unavailable' } });
  const { nodes } = renderPaywall(s);
  assert.equal(byID(nodes, 'onboarding-paywall-pro'), undefined);
  const free = byID(nodes, 'onboarding-paywall-free');
  assert.equal(free.type, 'Pressable');
  assert.equal(free.props.accessibilityRole, 'button');
  assert.equal(free.props.accessibilityLabel, 'Start the free 3 days');
  assert.ok(byID(nodes, 'onboarding-plans-unavailable'));
  // With the Pro button, the free way on stays a text action under it.
  const shown = renderPaywall(setup());
  assert.ok(byID(shown.nodes, 'onboarding-paywall-pro'));
  assert.equal(byID(shown.nodes, 'onboarding-paywall-free').type, 'ETextAction');
  // Legal links are still both there, spoken as links.
  const links = shown.nodes.filter((node) => node.props?.accessibilityRole === 'link').map((node) => node.props.accessibilityLabel);
  assert.equal(links.length, 2);
  const source = read('src/components/onboarding/e-paywall.tsx');
  assert.doesNotMatch(source, /(?:US\$|\$|€|£|AED|SAR)\s?\d/, 'no written price');
});

test('KeepsGoing never moves the purchase area: it is out of the scrolling column, in the header\'s room', () => {
  for (const props of [{}, { onClose() {} }]) {
    const s = setup();
    const { tree, nodes, tiles } = renderPaywall(s, answers.sam, props);
    const frame = byID(nodes, 'onboarding-paywall');
    assert.equal(frame.type, 'EStepFrame');
    // Nothing of it inside the frame's column or footer, where the body, timeline, plans, terms and buttons flow.
    assert.equal(walk(frame).filter((node) => node !== frame && node.props?.testID === 'onboarding-paywall-keeps-going').length, 0);
    const column = frame.props.children.flat(Infinity).filter(Boolean);
    assert.equal(column[0].type, 'EHeadline');
    assert.equal(column[1].type, 'EBody');
    assert.equal(column[2].props.testID, 'onboarding-trial-timeline', 'the timeline follows the body directly');
    // The column's top padding is the backdrop's own height plus its margin, as without the drawing.
    const layout = s.pattern.compactPattern(tiles);
    const tileSize = s.deps['@/components/onboarding/e-frame'].fitPatternTile(390, 52);
    const height = layout.rows * tileSize + (layout.rows - 1) * Math.max(2, Math.round((tileSize * 6) / 52));
    assert.equal(flat(frame.props.contentStyle).paddingTop, height + 40);
    // Its layer: absolute, untouchable, hidden, inside the 52pt top row and clear of the backdrop 56pt down.
    const layer = tree.props.children.find((child) => child && walk(child).some((node) => node.props?.testID === 'onboarding-paywall-keeps-going'));
    const style = flat(layer.props.style);
    assert.equal(style.position, 'absolute');
    assert.equal(layer.props.pointerEvents, 'none');
    assert.equal(layer.props.importantForAccessibility, 'no-hide-descendants');
    const box = flat(byID(nodes, 'onboarding-paywall-keeps-going').props.style);
    assert.ok(style.top - 47 + box.height <= 56, 'above the backdrop');
    // At the end corner; beside the close control when there is one.
    const inner = flat(layer.props.children.props.style);
    assert.equal(inner.alignItems, 'flex-end');
    assert.equal(inner.paddingEnd !== undefined, !!props.onClose);
  }
});

test('a tile or key row that appears after the reveal has played is shown, not left invisible', () => {
  const s = setup({ motion: 'full' });
  const realRef = s.deps.react.useRef;
  // React keeps refs across renders; the harness does not, so give it one hook store.
  const store = [];
  let cursor = 0;
  s.deps.react.useRef = (initial) => { const slot = cursor++; if (!store[slot]) store[slot] = { current: initial }; return store[slot]; };
  const render = (input) => { cursor = 0; return renderPattern(s, input); };
  render(answers.sam);
  s.runEffects();
  assert.equal(s.started.length, 1, 'the reveal played');
  // A reminder answered later (the gate re-renders with more tiles) after the reveal ran.
  const later = render({ ...answers.sam, reminders: { bills: true } });
  const late = later.tiles.filter((tile) => tile.group === 'remind');
  assert.ok(late.length > 0);
  for (const tile of late) {
    assert.equal(flat(byID(later.nodes, `onboarding-pattern-tile-${tile.key}`).props.style).opacity.value, 1, tile.key);
  }
  assert.equal(flat(byID(later.nodes, 'onboarding-pattern-key-remind').props.style).opacity.value, 1);
  // Paint is built once per tile and kept across renders (no native node churn mid-reveal).
  const again = render({ ...answers.sam, reminders: { bills: true } });
  for (const tile of later.tiles) {
    assert.equal(byID(again.nodes, `onboarding-pattern-tile-${tile.key}`).props.style,
      byID(later.nodes, `onboarding-pattern-tile-${tile.key}`).props.style, tile.key);
  }
  assert.equal(byID(again.nodes, 'onboarding-pattern-key-name').props.style[1], byID(later.nodes, 'onboarding-pattern-key-name').props.style[1]);
  s.deps.react.useRef = realRef;
});

test('the paywall coin falls in plain sight: drawn over the tile, starting above it, landing on its face', () => {
  for (const motion of ['reduced', 'full']) {
    const s = setup({ motion });
    const { nodes } = renderPaywall(s);
    const box = byID(nodes, 'onboarding-paywall-keeps-going');
    const layers = box.props.children.flat(Infinity).filter(Boolean);
    const tileAt = layers.findIndex((layer) => layer.props?.testID === 'onboarding-paywall-keeps-going-tile');
    const coinAt = layers.findIndex((layer) => layer.props?.testID === 'onboarding-paywall-keeps-going-coin');
    assert.ok(tileAt >= 0 && coinAt > tileAt, 'the coin is drawn after (over) the tile');
    assert.ok(coinAt === layers.length - 1, 'nothing covers the falling coin');
    // A tray of coins already taken, at the tile's foot.
    assert.ok(layers.filter((layer, index) => index !== coinAt && walk(layer).some((node) => flat(node.props?.style).borderRadius === 6)).length >= 2,
      'two resting coins beside the tile');
    const tile = flat(layers[tileAt].props.style);
    const tileSize = flat(walk(layers[tileAt]).find((node) => node.props?.accessibilityRole === 'image').props.style).width;
    const coin = flat(layers[coinAt].props.style);
    const coinSize = flat(walk(layers[coinAt]).find((node) => node.props?.style && flat(node.props.style).width).props.style).width;
    const fall = coin.transform.find((step) => step.translateY).translateY;
    const [from, to] = fall.config.outputRange;
    assert.ok(coin.top + from + coinSize <= tile.top - coinSize / 2, 'it starts clearly above the tile, at least half a coin clear of it');
    assert.ok(to - from >= coinSize, 'at least one coin height of visible travel');
    assert.ok(coin.top + to >= tile.top && coin.top + to + coinSize <= tile.top + tileSize, 'it lands on the tile\'s face');
    // The still frame (and the first frame before motion starts): poised above the tile, fully shown.
    assert.ok(coin.top + shown(fall) + coinSize <= tile.top, 'at rest it waits above the tile, not behind it');
    assert.equal(shown(coin.opacity), 1);
    // Inside the header's room, clear of the backdrop (56pt down).
    assert.ok(flat(box.props.style).height + 3 <= 56);
  }
});

test('the paywall\'s backdrop and corner drawing arrive and leave with the step\'s own fade', () => {
  const s = setup();
  const { nodes } = renderPaywall(s);
  for (const id of ['onboarding-paywall-backdrop', 'onboarding-paywall-corner']) {
    const layer = byID(nodes, id);
    assert.ok(layer, id);
    assert.ok(layer.props.style.flat(Infinity).includes(s.stepFade), `${id} takes the step layer's fade`);
    assert.equal(layer.props.pointerEvents, 'none');
    assert.equal(layer.props.importantForAccessibility, 'no-hide-descendants');
  }
  assert.ok(walk(byID(nodes, 'onboarding-paywall-corner')).some((node) => node.props?.testID === 'onboarding-paywall-keeps-going'));
  // Outside the gate (no layer), nothing is applied and both are simply drawn.
  const outside = setup();
  outside.deps['@/components/onboarding/e-motion'] = { useStepPhase: () => ({ leaving: false, paint: null }), STEP_ARRIVE_DELAY_MS: 120 };
  outside.local('@/components/onboarding/e-paywall');
  const still = renderPaywall(outside);
  assert.ok(byID(still.nodes, 'onboarding-paywall-backdrop').props.style.flat(Infinity).every((part) => part === null || typeof part === 'object'));
  assert.match(read('src/components/onboarding/e-paywall.tsx'), /const phase = useStepPhase\(\);/);
});

test('when the store returns no plans, the paywall offers the retry its copy asks for', () => {
  // Seen on iPhone 15: "try loading prices again" was shown with no control to do it.
  const source = read('src/components/onboarding/e-paywall.tsx');
  assert.match(source, /testID="onboarding-plans-retry"/);
  assert.match(source, /onPress=\{\(\) => void checkout\.load\(\)\}/);
  assert.match(source, /\{t\('retryPrices'\)\}/);
});
