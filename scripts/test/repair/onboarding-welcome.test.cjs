'use strict';
// Welcome's hero (sms-coin-scene.tsx): an example bank alert whose amount
// becomes a coin that lands in its category tile, then the example pattern.
// Decoration around one spoken image: these tests pin the drawing to the
// example (no bank's name, the person's currency), keep it out of the
// accessibility tree except the example label, show the composed final frame
// under Reduce Motion, and keep Welcome away from the store.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const load = require('./load-typescript.cjs');
const { createHarness, walk, text } = require('./reference-harness.cjs');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const SCENE = 'src/components/onboarding/sms-coin-scene.tsx';
const WELCOME = 'src/components/onboarding/e-welcome.tsx';
const BANKS = ['Emirates NBD', 'FAB', 'ADCB'];
const SA_BANKS = ['Al Rajhi Bank', 'SNB', 'Riyad Bank'];
const isHidden = (node) => node.props.accessibilityElementsHidden === true &&
  node.props.importantForAccessibility === 'no-hide-descendants';
const byId = (tree, id) => walk(tree).find((node) => node.props?.testID === id);

/** The scene (and Welcome) from source over the reference harness, with a recording core Animated. */
function setup({ language = 'en', motion = { ready: true, reducedMotion: true }, currency = 'AED', region = 'AE', largeText = false,
  platform = 'android', isRTL = false } = {}) {
  const h = createHarness({ language, largeText, platform });
  const d = h.deps;
  d['react-native'].I18nManager = { isRTL };
  const runs = { started: 0, stopped: 0, listeners: 0, removed: 0 };
  const run = { start() { runs.started++; }, stop() { runs.stopped++; } };
  // An interpolation reads as its value at the moment it is built (the frame the test renders).
  const at = (x, input, output) => {
    if (typeof output[0] !== 'number') return output[0];
    for (let i = 1; i < input.length; i++) if (x <= input[i]) return output[i - 1] + (x - input[i - 1]) / (input[i] - input[i - 1]) * (output[i] - output[i - 1]);
    return output[output.length - 1];
  };
  class Value { constructor(v) { this.value = v; } setValue(v) { this.value = v; }
    interpolate({ inputRange, outputRange }) { return { value: at(this.value, inputRange, outputRange) }; } }
  d['react-native'].Animated = { View: 'Animated.View', Value, multiply: (a) => a,
    timing: () => run, spring: () => run, delay: () => run, sequence: () => run, parallel: () => run };
  d['react-native'].AppState = { currentState: 'active', addEventListener: () => { runs.listeners++; return { remove() { runs.removed++; } }; } };
  // Effects run at once and keep their cleanup, so a test can unmount.
  const cleanups = [];
  d.react.useEffect = (fn) => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); };
  d['@/hooks/use-reduced-motion'] = { useReducedMotion: () => motion.reducedMotion, useMotionPreference: () => motion };
  d['@/components/onboarding/alive-scenes'] = { onboardingDeviceRegion: () => region };
  d['@/components/ledger-currency-sheet'] = { suggestedLedgerCurrency: () => currency };
  d['@/lib/markets'] = { ...d['@/lib/markets'], MARKETS: [{ id: 'AE', currency: { code: 'AED' },
    banks: BANKS.map((name) => ({ name, domain: `${name}.example`, color: '#2B4C9B' })) },
  { id: 'SA', currency: { code: 'SAR' }, banks: SA_BANKS.map((name) => ({ name, domain: `${name}.example`, color: '#2B4C9B' })) }] };
  d['@/lib/onboarding-bank-examples'] = load(path.join(root, 'src/lib/onboarding-bank-examples.ts'), d);
  d['@/lib/onboarding-alert-examples'] = load(path.join(root, 'src/lib/onboarding-alert-examples.ts'), { '@/components/ui/icon.types': {} });
  d['@/lib/pattern'] = load(path.join(root, 'src/lib/pattern.ts'));
  d['@/lib/onboarding-e-copy'] = load(path.join(root, 'src/lib/onboarding-e-copy.ts'), d);
  d['@/components/ui/pattern-mosaic'] = { PatternMosaic: (p) => h.jsx('PatternMosaic', p) };
  const scene = load(path.join(root, SCENE), d);
  d['@/components/onboarding/sms-coin-scene'] = scene;
  // Welcome's frame and logo are their own suites' boundaries here.
  d['@/components/onboarding/e-frame'] = { EStepFrame: (p) => h.jsx('EStepFrame', p), EHeadline: (p) => h.jsx('EHeadline', p),
    EBody: (p) => h.jsx('EBody', p), ETextAction: (p) => h.jsx('ETextAction', p), bandButtonColor: () => ({}), fitPatternTile: (_w, max) => max };
  d['@/components/onboarding/e-motion'] = { LogoDraw: (p) => h.jsx('LogoDraw', p) };
  const welcome = load(path.join(root, WELCOME), d);
  const words = d['@/lib/onboarding-e-copy'].onboardingECopy(language);
  const palette = d['@/constants/theme'].BandPalettes.light.home;
  return { h, scene, words, palette, runs, unmount: () => cleanups.splice(0).forEach((cleanup) => cleanup()),
    renderWelcome: (props = {}) => welcome.WelcomeStep({ onStart() {}, restoreNote: null, disabled: false, ...props }) };
}

for (const language of ['en', 'ar']) {
  test(`${language}: Welcome draws the alert-to-coin scene above Get started, with the example pattern still spoken as one`, () => {
    const { renderWelcome, words, h } = setup({ language });
    const tree = renderWelcome();
    const scene = byId(tree, 'onboarding-sms-coin-scene');
    assert.ok(scene, 'the hero is on Welcome');
    assert.equal(scene.props.pointerEvents, 'none');
    // The body text comes first; the scene fills the space down to Get started.
    const order = walk(tree).map((node) => node.type === 'EBody' ? 'body' : node.props?.testID === 'onboarding-sms-coin-scene' ? 'scene' : null).filter(Boolean);
    assert.deepEqual(order, ['body', 'scene']);
    assert.ok(byId(tree, 'onboarding-get-started') || walk(tree).some((node) => node.props?.testID === 'onboarding-get-started'));

    const example = byId(tree, 'onboarding-example-pattern');
    const mosaic = walk(example).find((node) => node.type === 'PatternMosaic');
    assert.equal(mosaic.props.accessibilityLabel, words.exampleLabel, 'the one spoken part, unchanged');
    assert.equal(mosaic.props.scheme, 'light', 'drawn in the on-ink palette, so no tile sinks into the dark band');
    assert.ok(text(example).includes(words.exampleLabel), 'and labelled on screen');
    assert.ok(!/\d[\d,]*\.\d\d/.test(text(example)), 'the pattern itself carries no money');
    assert.ok(!walk(tree).some((node) => node.props?.onPress && walk(scene).includes(node)), 'nothing in the scene is pressable');
    assert.deepEqual(h.events, [], 'rendering Welcome writes nothing');
  });

  test(`${language}: the example's first tile is the logo-green nameless square, never a clay letter under the green mark`, () => {
    const { renderWelcome } = setup({ language });
    const mosaic = walk(byId(renderWelcome(), 'onboarding-example-pattern')).find((node) => node.type === 'PatternMosaic');
    const first = mosaic.props.tiles.find((tile) => tile.col === 0 && tile.row === 0);
    assert.equal(first.key, 'name:you');
    assert.deepEqual([first.kind, first.color, first.letter], ['square', 'green', undefined]);
    assert.ok(!mosaic.props.tiles.some((tile) => tile.kind === 'letter'), 'no made-up initial reads as a red logo');
  });

  test(`${language}: everything drawn besides the example pattern is hidden from assistive tech`, () => {
    const { renderWelcome, words } = setup({ language });
    const scene = byId(renderWelcome(), 'onboarding-sms-coin-scene');
    for (const id of ['sms-coin-alert', 'sms-coin-tile']) assert.ok(isHidden(byId(scene, id)), `${id} is hidden`);
    // Every node a screen reader could reach in the scene is the example pattern or inside a hidden branch.
    const reachable = (node, out = []) => {
      if (Array.isArray(node)) node.forEach((child) => reachable(child, out));
      else if (node && typeof node === 'object' && !node.props?.accessibilityElementsHidden) {
        out.push(node); reachable(node.props?.children, out);
      }
      return out;
    };
    const labelled = reachable(scene).filter((node) => typeof node.props?.accessibilityLabel === 'string');
    assert.deepEqual(labelled.map((node) => node.props.accessibilityLabel), [words.exampleLabel]);
    const spokenText = reachable(scene).filter((node) => node.type === 'Text' && node.props.accessible !== false);
    assert.deepEqual(spokenText, [], 'the on-screen caption repeats the label and is not spoken twice');
  });
}

test('the example alert names no bank, shows the sender as "your bank", and marks the amount and the merchant', () => {
  for (const language of ['en', 'ar']) {
    const { renderWelcome, words } = setup({ language });
    const alert = byId(renderWelcome(), 'sms-coin-alert');
    const shown = text(alert);
    for (const bank of BANKS) assert.ok(!shown.includes(bank), `${language}: no ${bank}`);
    assert.ok(shown.includes(words.exampleSender), 'the sender line says it is an example from your bank');
    assert.ok(!/Balance/i.test(shown), 'no balance figure: the only money is the one the coin carries');
    assert.ok(byId(alert, 'sms-coin-token-amount') && byId(alert, 'sms-coin-token-merchant'));
    assert.ok(text(byId(alert, 'sms-coin-token-merchant')).includes('CARREFOUR'), 'the regional grocer, as a bank writes it');
  }
  const { words: en } = setup({ language: 'en' });
  const { words: ar } = setup({ language: 'ar' });
  assert.equal(en.exampleSender, 'Your bank · example');
  assert.match(ar.exampleSender, /[؀-ۿ]/);
  assert.ok(!/\b(NBD|FAB|ADCB|Rajhi|SNB|HSBC)\b/.test(read('src/lib/onboarding-e-copy.ts').match(/exampleSender: '[^']*'/g).join(' ')));
});

test('the amount is the coffee-sized sample in the person\'s currency, never a silent AED', () => {
  const amountOf = (options) => {
    const { renderWelcome } = setup(options);
    return text(byId(renderWelcome(), 'sms-coin-token-amount')).trim();
  };
  assert.equal(amountOf({ currency: 'AED' }), 'AED 24.50');
  assert.equal(amountOf({ currency: 'JPY', region: 'JP' }), 'JPY 2,450');
  assert.equal(amountOf({ currency: 'KWD', region: 'KW' }), 'KWD 2.450');
  assert.equal(amountOf({ currency: 'INR', region: 'IN' }), 'INR 245');
  const { scene } = setup();
  assert.deepEqual({ ...scene.sampleAmount(null) }, { text: '24.50', spoken: '24.50' });
  assert.equal(scene.sampleAmount('SAR').text, 'SAR 24.50');
  // The money-preview helper and this one agree.
  assert.match(read('src/components/onboarding/money-preview.tsx'), /typicalMinorAmount\(spec, 1\) \* 24\.5/);
  assert.match(read(SCENE), /typicalMinorAmount\(spec, 1\) \* 24\.5/);
});

test('the coin lands in the category the merchant maps to, drawn as the pattern draws it', () => {
  const { renderWelcome, h, scene } = setup();
  const tree = renderWelcome();
  assert.equal(scene.SMS_COIN_CATEGORY, 'groceries');
  assert.equal(h.deps['@/lib/categories'].getCategory('groceries').icon, 'cart', 'the grocer\'s glyph');
  const tile = byId(tree, 'sms-coin-tile');
  const flat = Object.assign({}, ...[tile.props.style].flat(Infinity).filter(Boolean));
  const mosaic = walk(tree).find((node) => node.type === 'PatternMosaic');
  const cell = mosaic.props.tiles.find((item) => item.category === 'groceries');
  const column = cell.col * (mosaic.props.tile + mosaic.props.gap);
  const styleOf = (node, id) => Object.assign({}, ...[byId(node, id).props.style].flat(Infinity).filter(Boolean));
  // Native lays out logically under the app's direction (and I18nManager after an Arabic relaunch, whose
  // left/right swap would mirror a physical side twice): start/end, in English and Arabic, RTL or not.
  assert.equal(flat.start, column, 'over the pattern\'s own Groceries tile');
  assert.equal(flat.left, undefined);
  for (const isRTL of [false, true]) {
    const native = setup({ language: 'ar', isRTL, platform: 'ios' }).renderWelcome();
    assert.equal(styleOf(native, 'sms-coin-tile').start, column, `native Arabic (isRTL ${isRTL}): logical start`);
    assert.equal(styleOf(native, 'sms-coin-tile').right, undefined);
    assert.ok(styleOf(native, 'sms-coin-badge').end < 0, 'the badge on the end corner');
  }
  // The web resolves start/end from the device, not the app: physical sides from the app's language.
  const webEn = setup({ platform: 'web' }).renderWelcome();
  assert.equal(styleOf(webEn, 'sms-coin-tile').left, column);
  assert.ok(styleOf(webEn, 'sms-coin-badge').right < 0);
  for (const isRTL of [false, true]) {
    const webAr = setup({ language: 'ar', platform: 'web', isRTL }).renderWelcome();
    assert.equal(styleOf(webAr, 'sms-coin-tile').right, column, 'web Arabic: the same column from the right, as the mirrored mosaic draws it');
    assert.equal(styleOf(webAr, 'sms-coin-tile').left, undefined);
    assert.ok(styleOf(webAr, 'sms-coin-badge').left < 0);
  }
  assert.equal(flat.top, cell.row * (mosaic.props.tile + mosaic.props.gap));
  assert.equal(flat.backgroundColor, h.deps['@/constants/theme'].PatternPalette.light.fill[cell.color]);
  assert.ok(walk(tile).some((node) => node.props?.testID === 'sms-coin-badge'), 'with the coin badge');
  assert.match(read(SCENE), /getCategory\(model\.category \?\? SMS_COIN_CATEGORY\)\.icon/, 'the category\'s own glyph');
});

test('Reduce Motion or a screen reader shows the composed final frame at once and starts nothing', () => {
  const { renderWelcome, runs } = setup({ motion: { ready: true, reducedMotion: true } });
  const tree = renderWelcome();
  const opacity = (node) => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean)).opacity.value;
  assert.equal(opacity(byId(tree, 'sms-coin-alert')), 1, 'the alert in place');
  assert.equal(opacity(byId(tree, 'sms-coin-tile')), 1, 'the category tile in place');
  assert.equal(opacity(byId(tree, 'sms-coin-badge')), 1, 'the coin settled on it');
  const board = walk(byId(tree, 'onboarding-example-pattern')).find((node) => node.type === 'Animated.View');
  assert.equal(opacity(board), 1, 'the pattern assembled');
  for (const token of ['amount', 'merchant']) {
    const mark = walk(byId(tree, `sms-coin-token-${token}`)).find((node) => node.type === 'Animated.View');
    assert.ok(opacity(mark) > 0, `${token} marked`);
  }
  assert.equal(runs.started, 0, 'no animation runs');
  assert.equal(runs.listeners, 0, 'and nothing waits to loop');
});

test('nothing starts before the motion preference is known; once it is, the loop runs only until unmount', () => {
  const waiting = setup({ motion: { ready: false, reducedMotion: false } });
  const before = waiting.renderWelcome();
  assert.equal(waiting.runs.started, 0);
  const opacity = (node) => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean)).opacity.value;
  assert.equal(opacity(byId(before, 'sms-coin-alert')), 0, 'nothing drawn before the start either');
  // ...except the example pattern, at rest: its caption never sits under an empty space.
  const example = byId(before, 'onboarding-example-pattern');
  const resting = walk(example).find((node) => node.type === 'Animated.View');
  assert.equal(opacity(resting), waiting.scene.AT_REST);
  assert.ok(waiting.scene.AT_REST >= 0.3, 'dimmed, clearly there');
  assert.ok(walk(resting).some((node) => node.type === 'PatternMosaic'));
  assert.ok(text(example).includes(waiting.words.exampleLabel));
  assert.equal(opacity(byId(before, 'sms-coin-tile')), 0, 'its category tile pops only when the coin arrives');

  const moving = setup({ motion: { ready: true, reducedMotion: false } });
  const tree = moving.renderWelcome();
  assert.equal(moving.runs.started, 1, 'the alert plays');
  assert.equal(moving.runs.listeners, 1, 'and pauses with the app');
  moving.unmount();
  assert.equal(moving.runs.removed, 1);
  assert.ok(moving.runs.stopped >= 1, 'the loop stops on unmount');
  assert.equal(opacity(byId(tree, 'sms-coin-alert')), 1, 'interrupted, it lands at its target');
});

test('at the accessibility text sizes the scene keeps only the example pattern, with no text ceiling', () => {
  const { renderWelcome, words, runs } = setup({ largeText: true, motion: { ready: true, reducedMotion: false } });
  const tree = renderWelcome();
  assert.equal(byId(tree, 'sms-coin-alert'), undefined);
  assert.equal(byId(tree, 'sms-coin-tile'), undefined);
  assert.equal(walk(tree).find((node) => node.type === 'PatternMosaic').props.accessibilityLabel, words.exampleLabel);
  assert.equal(runs.started, 0, 'still at large text');
  assert.ok(!/maxFontSizeMultiplier|numberOfLines|adjustsFontSizeToFit/.test(read(SCENE)));
});

test('Welcome and its scene never touch the store or the ledger', () => {
  for (const file of [WELCOME, SCENE]) {
    const source = read(file);
    assert.ok(!/@\/lib\/store|useStore|importBatch|addTransaction|setOnboarded|setCaptureOptOut|loadDemoData|setLedgerMoney/.test(source), file);
  }
  // Core Animated on the native driver with the coin springs; paint only.
  const source = read(SCENE);
  assert.match(source, /useNativeDriver: nativeDriver/);
  assert.match(source, /COIN_MOVE[\s\S]*COIN_POP[\s\S]*COIN_RISE/);
  assert.ok(!/react-native-reanimated/.test(source));
  assert.ok(!/function MessageParse|function Token\b/.test(source));
});

test('the SMS explainer reuses the scene without a pattern: the coin is filed under its category, all of it hidden', () => {
  const { h } = setup();
  const d = h.deps;
  d['@/lib/onboarding-copy'] = load(path.join(root, 'src/lib/onboarding-copy.ts'), d);
  d['@/components/onboarding/e-frame'].ETextAction = (p) => h.jsx('ETextAction', p);
  const explainer = load(path.join(root, 'src/components/onboarding/sms-explainer.tsx'), d);
  const palette = d['@/constants/theme'].BandPalettes.light.flow;
  const tree = explainer.SmsPermissionExplainer({ language: 'en', disabled: false, onContinue() {}, onNotNow() {}, palette });
  const scene = byId(tree, 'onboarding-sms-explainer-scene');
  assert.ok(scene);
  assert.equal(walk(scene).find((node) => node.type === 'PatternMosaic'), undefined);
  assert.ok(text(scene).includes('Groceries'));
  for (const node of scene.props.children.filter(Boolean)) assert.ok(isHidden(node), 'decorative throughout');
  assert.ok(byId(tree, 'onboarding-sms-explainer-continue'), 'the explainer\'s own action is unchanged');
});

test('the explainer forwards the confirmed currency and country; null and absent fall back the same way', () => {
  const { h, renderWelcome } = setup({ currency: 'AED', region: 'AE' });
  const d = h.deps;
  d['@/lib/onboarding-copy'] = load(path.join(root, 'src/lib/onboarding-copy.ts'), d);
  const explainer = load(path.join(root, 'src/components/onboarding/sms-explainer.tsx'), d);
  const palette = d['@/constants/theme'].BandPalettes.light.flow;
  const render = (props) => explainer.SmsPermissionExplainer({ language: 'en', disabled: false, onContinue() {}, onNotNow() {}, palette, ...props });
  const amount = (tree) => text(byId(tree, 'sms-coin-token-amount')).trim();
  const merchant = (tree) => text(byId(tree, 'sms-coin-token-merchant')).trim();
  // Confirmed on Name: Saudi riyal and Saudi Arabia, not the phone's AED and UAE.
  const confirmed = render({ currency: 'SAR', country: 'SA' });
  assert.equal(amount(confirmed), 'SAR 24.50');
  assert.equal(merchant(confirmed), 'PANDA', 'the confirmed country\'s grocer');
  for (const bank of [...BANKS, ...SA_BANKS]) assert.ok(!text(byId(confirmed, 'sms-coin-alert')).includes(bank), `no ${bank}`);
  // Nothing confirmed: the phone's suggestion, identically from both callers and for null or undefined.
  for (const props of [{}, { currency: null, country: null }, { currency: undefined, country: undefined }]) {
    assert.equal(amount(render(props)), 'AED 24.50');
    assert.equal(amount(renderWelcome(props)), 'AED 24.50');
    assert.equal(merchant(render(props)), merchant(renderWelcome(props)));
  }
});

test('interpolations are built once per scene, not on every render of the step around it', () => {
  const source = read(SCENE).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const body = source.slice(source.indexOf('export function SmsCoinScene'));
  const scene = body.slice(0, body.indexOf('\nfunction FlyingCoin'));
  // In the component body, every interpolation comes from the memoised paint.
  assert.match(scene, /const paint = useMemo\(\(\) => scenePaint\(/);
  assert.ok(!/\.interpolate\(|Animated\.multiply\(/.test(scene), 'no node built during render');
  const flying = body.slice(body.indexOf('\nfunction FlyingCoin'));
  assert.match(flying, /const style = useMemo\(\(\) => \{[\s\S]*Animated\.multiply[\s\S]*\}, \[flight, coin, travel\]\)/);
  const landing = source.slice(source.indexOf('function LandingTile'), source.indexOf('export function SmsCoinScene'));
  assert.ok(!/\.interpolate\(/.test(landing));
});

test('the coin starts just outside the alert, under the amount, and never arcs back over its words', () => {
  const { scene } = setup();
  const box = (x, y, width, height) => ({ x, y, width, height });
  const boxes = { bubble: box(0, 0, 340, 96), wrap: box(14, 34, 312, 50), chunk: box(90, 0, 70, 20), piece: box(0, 0, 70, 20),
    example: box(0, 124, 340, 120), board: box(0, 0, 300, 94), tile: box(100, 50, 44, 44), badge: box(32, -6, 18, 18) };
  const flight = scene.flightFrom(boxes, true);
  assert.equal(flight.from.x, 14 + 90 + 35, 'under the amount it stands for');
  assert.ok(flight.from.y - 13 >= 96, 'its top edge is below the alert, so no word is covered');
  assert.ok(flight.from.y + 13 <= 124, 'inside the gap above the pattern');
  assert.deepEqual({ ...flight.to }, { x: 100 + 32 + 9, y: 124 + 50 - 6 + 9 });
  // The bow is capped so the path never rises above its start (back over the alert).
  const source = read(SCENE);
  assert.match(source, /const lift = Math\.max\(0, Math\.min\(56, \(to\.y - from\.y\) \/ 4\)\)/);
  const { from, to } = flight; const lift = Math.max(0, Math.min(56, (to.y - from.y) / 4));
  for (let step = 0; step <= 1; step += 0.05) assert.ok(from.y + (to.y - from.y) * step - lift * 4 * step * (1 - step) >= from.y - 1e-9);
  assert.ok(!/key=\{boardKey\}|setBoardKey/.test(source), 'the pattern is never remounted mid-loop, so it is never empty');
});
