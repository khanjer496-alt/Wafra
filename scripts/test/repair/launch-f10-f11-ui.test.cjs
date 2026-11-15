'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');

// Execute the shipping component with pure UI/animation boundaries. This
// records scheduling, not frames, CPU use, battery use or native performance.
function render(unread, reducedMotion) {
  const scheduled = [];
  const cleanup = [];
  const jsx = (type, props) => ({ type, props });
  const { RecapLogoTrigger } = load(path.join(root, 'src/components/recap/recap-logo-trigger.tsx'), {
    react: { useEffect: (fn) => cleanup.push(fn()) },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Pressable: 'Pressable', View: 'View', StyleSheet: { create: (s) => s } },
    'react-native-reanimated': {
      __esModule: true, default: { View: 'Animated.View' },
      Easing: { bezier: () => 'easing' }, cancelAnimation: () => {},
      useSharedValue: (value) => ({ value }), useAnimatedStyle: (fn) => fn(),
      withTiming: (to, options) => ({ to, options }), withSequence: (...steps) => ({ steps }),
      withRepeat: (animation, count) => { scheduled.push(count); return { animation, count }; },
    },
    '@/components/wafra-logo': { WafraMark: 'WafraMark' },
    '@/constants/theme': { EASE: [0, 0, 1, 1], Motion: { pulse: 2000 } },
    '@/hooks/use-reduced-motion': { useReducedMotion: () => reducedMotion },
    '@/hooks/use-theme': { useTheme: () => ({ primary: 'primary', primarySoft: 'soft', cardBorderStrong: 'border', gold: 'gold', background: 'bg' }) },
  });
  let opens = 0, longPresses = 0;
  const tree = RecapLogoTrigger({ unread, accessibilityLabel: 'Recap', onPress: () => opens++, onLongPress: () => longPresses++ });
  return { tree, scheduled, cleanup, counts: () => [opens, longPresses] };
}

for (const reducedMotion of [false, true]) {
  test(`F10 unread scheduling is bounded (reduced motion ${reducedMotion})`, () => {
    const result = render(true, reducedMotion);
    assert.ok(result.scheduled.every((count) => count > 0), 'Unread Home schedules an infinite repeat');
    if (reducedMotion) assert.equal(result.scheduled.length, 0);
    result.cleanup.forEach((fn) => fn?.());
  });
}

test('F10 static unread marker, accessible open and long-press survive', () => {
  for (const reducedMotion of [false, true]) {
    const { tree, counts } = render(true, reducedMotion);
    assert.equal(tree.props.accessibilityRole, 'button');
    assert.equal(tree.props.accessibilityLabel, 'Recap');
    tree.props.onPress(); tree.props.onLongPress();
    assert.deepEqual(counts(), [1, 1]);
    const ring = tree.props.children;
    assert.equal(ring.props.style[1].borderColor, 'primary');
    assert.equal(ring.props.style[1].backgroundColor, 'soft');
    assert.equal(ring.props.children[1].type, 'View', 'unread dot remains visible');
  }
});

test('F10 read state has no cue or unread dot', () => {
  const { tree, scheduled } = render(false, false);
  assert.equal(scheduled.length, 0);
  const ring = tree.props.children;
  assert.equal(ring.props.style[1].backgroundColor, 'transparent');
  assert.equal(ring.props.children[1], null);
});

test('F11 manual hint and visible validation select manual copy in both languages', () => {
  const source = fs.readFileSync(path.join(root, 'src/app/add-transaction.tsx'), 'utf8');
  const manual = source.slice(source.indexOf('{!reviewItem ? <View testID="add-detail-chips"'));
  assert.match(manual, /accessibilityHint=\{copy\.manualEntryChooseCategory\}/);
  assert.match(manual.slice(manual.indexOf('{categoryInvalid &&')), /\{copy\.manualEntryChooseCategory\}/);
  const i18n = load(path.join(root, 'src/lib/i18n.ts'));
  const { motionAndroidCopy } = load(path.join(root, 'src/lib/motion-android-copy.ts'), { '@/lib/i18n': i18n });
  assert.equal(motionAndroidCopy('en').manualEntryChooseCategory, 'Choose the category before adding this transaction.');
  assert.equal(motionAndroidCopy('ar').manualEntryChooseCategory, 'اختر التصنيف قبل إضافة هذه المعاملة.');
});

test('F11 alert-review category wording remains unchanged', () => {
  const { t } = load(path.join(root, 'src/lib/i18n.ts'));
  assert.equal(t('reviewAlertChooseCategory', 'en'), 'Choose the category before adding this alert.');
  assert.equal(t('reviewAlertChooseCategory', 'ar'), 'اختر التصنيف قبل إضافة هذا التنبيه.');
});
