'use strict';
// #264 (F10): an idle Home drew about 60 frames a second, and hiding
// "Greeting and pattern" stopped it. Home's pattern is a still mosaic, so it
// must mount no animated style, shared value or animation at all; an
// animating mosaic (onboarding) schedules one finite spring per tile and
// never a repeat. This records what the component schedules, not frames,
// CPU or battery on a device.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const code = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const theme = load(path.join(root, 'src/constants/theme.ts'), { '@/global.css': {}, 'react-native': { Platform: { select: (x) => x.ios } } });
const pattern = load(path.join(root, 'src/lib/pattern.ts'), { '@/constants/theme': theme });
const tiles = pattern.buildPattern({
  name: 'Sara',
  goals: ['bills', 'salary', 'subscriptions', 'cash-cards', 'spend-less'],
  watched: ['dining', 'groceries'],
  reminders: { bills: true, cards: true, dailySummary: true },
});

function mosaic({ os, reducedMotion = false }) {
  const calls = { useSharedValue: 0, useAnimatedStyle: 0, withSpring: 0, withDelay: 0, withRepeat: 0, withTiming: 0 };
  const jsx = (type, props, key) => ({ type, props, key });
  const reanimated = {
    __esModule: true,
    default: { View: 'Animated.View' },
    useSharedValue: (value) => { calls.useSharedValue += 1; return { value }; },
    useAnimatedStyle: (fn) => { calls.useAnimatedStyle += 1; return fn(); },
    withSpring: (to, config) => { calls.withSpring += 1; return { to, config }; },
    withDelay: (ms, animation) => { calls.withDelay += 1; return { ms, animation }; },
    withRepeat: (animation, count) => { calls.withRepeat += 1; return { animation, count }; },
    withTiming: (to) => { calls.withTiming += 1; return { to }; },
  };
  const { PatternMosaic } = load(path.join(root, 'src/components/ui/pattern-mosaic.tsx'), {
    react: { useEffect: (fn) => { fn(); }, useRef: (value) => ({ current: value }) },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { Platform: { OS: os }, StyleSheet: { create: (s) => s }, Text: 'Text', View: 'View' },
    'react-native-reanimated': reanimated,
    '@/components/ui/icon': { Icon: 'Icon' },
    '@/components/wafra-logo': { WafraMark: 'WafraMark' },
    '@/constants/theme': theme,
    '@/hooks/use-band': { useBandScheme: () => 'dark' },
    '@/hooks/use-language': { useLanguage: () => 'en' },
    '@/hooks/use-reduced-motion': { useMotionPreference: () => ({ ready: true, reducedMotion }) },
    '@/lib/band-copy': { bandCopy: () => ({ pattern: 'Your pattern' }) },
    '@/lib/categories': { getCategory: () => ({ icon: 'tag' }) },
    '@/lib/i18n': { hasArabicScript: () => false },
    '@/lib/pattern': pattern,
  });
  // Expand function components the way React would, so their hooks run.
  const expand = (node) => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props));
    const children = node.props?.children;
    return { ...node, props: { ...node.props, children: children === undefined ? undefined : expand(children) } };
  };
  const walk = (node, out = []) => {
    if (Array.isArray(node)) { node.forEach((child) => walk(child, out)); return out; }
    if (!node || typeof node !== 'object') return out;
    out.push(node);
    walk(node.props?.children, out);
    return out;
  };
  const render = (props) => walk(expand(PatternMosaic({ tiles, ...props })));
  return { render, calls };
}

// The props Home passes (journal-home-screen.tsx, both band positions).
const HOME = { compact: true, testID: 'home-personal-pattern', tile: 24, gap: 3 };

test('Home renders the pattern as Home does: compact, still, tile 24', () => {
  const home = fs.readFileSync(path.join(root, 'src/screens/journal-home-screen.tsx'), 'utf8');
  const uses = home.match(/<YourPattern [^>]*\/>/g) ?? [];
  assert.equal(uses.length, 2);
  for (const use of uses) {
    assert.equal(use, '<YourPattern compact testID="home-personal-pattern" tile={24} gap={3} />');
    assert.doesNotMatch(use, /animate/);
  }
});

for (const os of ['ios', 'android']) {
  for (const reducedMotion of [false, true]) {
    test(`Home's still pattern mounts no animation on ${os} (reduce motion ${reducedMotion})`, () => {
      const { render, calls } = mosaic({ os, reducedMotion });
      const nodes = render(HOME);
      assert.equal(nodes.filter((node) => node.type === 'Animated.View').length, 0, 'no animated wrapper per tile');
      assert.deepEqual(calls, { useSharedValue: 0, useAnimatedStyle: 0, withSpring: 0, withDelay: 0, withRepeat: 0, withTiming: 0 });
      // The drawing is unchanged: every tile of the compact layout is still drawn.
      const cell = (node) => node.type === 'View' && !Array.isArray(node.props.style) &&
        JSON.stringify(node.props.style) === JSON.stringify({ width: 24, height: 24 });
      const cells = nodes.filter((node) => cell(node) && node.props.children && typeof node.props.children === 'object');
      assert.equal(cells.length, pattern.compactPattern(tiles).tiles.length);
      assert.ok(nodes.some((node) => node.props?.testID === 'home-personal-pattern' && node.props.accessibilityRole === 'image'));
    });
  }
}

test('an animating mosaic schedules one finite spring per tile on iOS and never repeats', () => {
  const { render, calls } = mosaic({ os: 'ios' });
  render({ animate: true });
  const count = tiles.length;
  assert.equal(calls.withSpring, count);
  assert.equal(calls.withDelay, count);
  assert.equal(calls.withRepeat, 0, 'the pop-in settles; it is never an endless loop');
  assert.equal(calls.withTiming, 0);
});

for (const [os, reducedMotion] of [['android', false], ['ios', true]]) {
  test(`an animating mosaic stays still on ${os} with reduce motion ${reducedMotion}`, () => {
    const { render, calls } = mosaic({ os, reducedMotion });
    render({ animate: true });
    assert.equal(calls.withSpring, 0);
    assert.equal(calls.withRepeat, 0);
  });
}

test('nothing in Home\'s band schedules an endless animation or frame loop', () => {
  const files = [
    'src/screens/journal-home-screen.tsx',
    'src/components/reference-home-summary.tsx',
    'src/components/ui/your-pattern.tsx',
    'src/components/ui/pattern-mosaic.tsx',
    'src/components/recap/recap-logo-trigger.tsx',
    'src/components/home/home-hero.tsx',
    'src/components/home/home-sparkline.tsx',
    'src/components/ui/band-scaffold.tsx',
    'src/components/ui/coins/coin-motion.ts',
    'src/components/ui/coins/coin-stack.tsx',
  ];
  for (const file of files) assert.doesNotMatch(code(file), /withRepeat|Animated\.loop|useFrameCallback|requestAnimationFrame/, file);
  // The hero's lean is the one live input on the band: it listens only while
  // Home is focused and the app is in the foreground.
  assert.match(code('src/hooks/use-device-tilt.ts'), /const live = !hold && focused && active && motion\.ready && !motion\.reducedMotion;/);
});
