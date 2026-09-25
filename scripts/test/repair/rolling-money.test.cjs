'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const walk = (node, out = []) => {
  if (Array.isArray(node)) node.forEach((n) => walk(n, out));
  else if (node && typeof node === 'object') { out.push(node); walk(node.props?.children, out); }
  return out;
};
const text = (node) => (Array.isArray(node) ? node.map(text).join('')
  : node && typeof node === 'object' ? text(node.props?.children) : node == null || node === false ? '' : String(node));

function mount({ reducedMotion, platform = 'ios' }) {
  let states = []; let index = 0;
  const react = {
    useState: (initial) => {
      const i = index++;
      if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
      return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }];
    },
    useEffect() {},
  };
  const ledgerMoney = load(path.join(root, 'src/lib/ledger-money.ts'), {
    '@/lib/currency-metadata': require('../build/currency-metadata.js'),
  });
  const module = load(path.join(root, 'src/components/ui/rolling-money.tsx'), {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { Platform: { OS: platform }, StyleSheet: { create: (s) => s, absoluteFill: {} }, View: 'View' },
    'react-native-reanimated': { __esModule: true, default: { View: 'Animated.View' }, Easing: { bezier: () => 'ease' },
      useAnimatedStyle: (fn) => fn(), useSharedValue: (v) => ({ value: v }), withDelay: (_d, a) => a, withTiming: (v) => v },
    '@/components/themed-text': { ThemedText: 'Text' },
    '@/constants/theme': { EASE: [0.2, 0.8, 0.2, 1], Fonts: {}, Motion: { digitStagger: 60, change: 240 }, Spacing: { two: 8 } },
    '@/hooks/use-ledger-money': { useLedgerMoney: () => null, useMoneyLocaleKey: () => '' },
    '@/hooks/use-reduced-motion': { useReducedMotion: () => reducedMotion },
    '@/lib/format': { formatAmount: () => { throw new Error('ledger spec is always passed here'); } },
    '@/lib/ledger-money': ledgerMoney,
    '@/lib/markets': { ledgerCurrencyDisplay: () => 'AED' },
    '@/lib/rolling-digits': load(path.join(root, 'src/lib/rolling-digits.ts')),
  });
  const spec = { schemaVersion: 2, currency: 'USD', exponent: 2 };
  // Each render mirrors React: a derived-state setState during render re-runs it.
  return (props) => {
    let tree;
    for (let pass = 0; pass < 3; pass++) {
      const before = JSON.stringify(states);
      index = 0;
      tree = module.RollingMoney({ moneySpec: spec, decimals: true, ...props });
      if (JSON.stringify(states) === before) break;
    }
    return tree;
  };
}

// Rolling positions are RollingGlyphView elements marked changed.
const glyphs = (tree) => walk(tree).filter((n) => n.props?.glyph?.changed === true);

test('the accessible value is always the full formatted amount with its ISO code', () => {
  const render = mount({ reducedMotion: false });
  const first = render({ fils: 4562 });
  assert.equal(first.props.accessibilityLabel, 'USD 45.62');
  assert.equal(first.props.accessible, true);
  const next = render({ fils: 5237 });
  assert.equal(next.props.accessibilityLabel, 'USD 52.37', 'the final value, not a digit in flight');
});

test('first appearance is static; a change rolls only the changed digits', () => {
  const render = mount({ reducedMotion: false });
  assert.equal(glyphs(render({ fils: 128410 })).length, 0, 'first paint never rolls');
  const tree = render({ fils: 129010 });
  // 1,284.10 -> 1,290.10: only the tens and units of the whole part roll.
  assert.deepEqual(glyphs(tree).map((n) => `${n.props.glyph.previous}>${n.props.glyph.char}`).join(' '), '8>9 4>0');
  assert.equal(walk(tree).filter((n) => n.props?.glyph).map((n) => n.props.glyph.char).join(''), '1,290.10');
  assert.equal(glyphs(render({ fils: 129010 })).length, 2, 'the same value does not start a new roll');
});

test('Reduce Motion or a screen reader keeps the figure static', () => {
  const render = mount({ reducedMotion: true });
  render({ fils: 4562 });
  const tree = render({ fils: 5237 });
  assert.equal(glyphs(tree).length, 0);
  assert.match(text(tree), /52\.37/);
});

test('Android stays static unless a measured opt-in asks for motion', () => {
  const android = mount({ reducedMotion: false, platform: 'android' });
  android({ fils: 4562 });
  assert.equal(glyphs(android({ fils: 5237 })).length, 0);
  const optedIn = mount({ reducedMotion: false, platform: 'android' });
  optedIn({ fils: 4562, motionOnAndroid: true });
  assert.ok(glyphs(optedIn({ fils: 5237, motionOnAndroid: true })).length > 0);
});
