'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const file = path.resolve(__dirname, '../../../src/components/ui/grow-bar.tsx');
const flat = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
function harness(platform, reducedMotion, ready = true) {
  let preference = { reducedMotion, ready };
  let hooks = 0;
  const effects = [], animations = [];
  const shared = { value: 0 }, shown = { current: false };
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
  const { GrowBar } = load(file, {
    react: { useRef: () => { hooks++; return shown; }, useEffect: fn => { hooks++; effects.push(fn); } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Platform: { OS: platform }, View: 'NativeView' },
    'react-native-reanimated': {
      __esModule: true, default: { View: 'AnimatedView' },
      Easing: { bezier: () => 'curve' }, ReduceMotion: { System: 'system' },
      useSharedValue: () => { hooks++; return shared; },
      useAnimatedStyle: fn => { hooks++; return fn(); },
      withDelay: (delay, value) => { animations.push(['delay', delay]); return value; },
      withTiming: (size, options) => { animations.push(['timing', size, options]); return size; },
      withSpring: (size, options) => { animations.push(['spring', size, options]); return size; },
    },
    '@/hooks/use-reduced-motion': { useMotionPreference: () => preference },
  });
  return { render: GrowBar, hooks: () => hooks, effects, animations, preference: value => { preference = value; } };
}
for (const [platform, reduced, ready] of [['android', false, true], ['android', false, false], ['ios', true, true], ['web', true, true]]) {
  for (const axis of ['height', 'width']) test(`${platform} reduced=${reduced} ready=${ready}: ${axis} renders current size with no animation hooks/effects`, () => {
    const h = harness(platform, reduced, ready);
    const decoration = { backgroundColor: 'mint', borderRadius: 4, [axis]: 999 };
    for (const size of [0, 70, 12.5, 0]) {
      const tree = h.render({ axis, size, delay: 100, style: decoration });
      assert.equal(tree.type, 'NativeView');
      assert.equal(flat(tree.props.style)[axis], axis === 'width' ? `${size}%` : size);
      assert.equal(flat(tree.props.style).backgroundColor, 'mint');
      assert.equal(flat(tree.props.style).borderRadius, 4);
    }
    assert.equal(h.hooks(), 0);
    assert.equal(h.effects.length, 0);
    assert.deepEqual(h.animations, []);
  });
}
for (const platform of ['ios', 'web']) test(`${platform} normal motion retains delayed first timing and subsequent springs`, () => {
  const h = harness(platform, false);
  const first = h.render({ axis: 'height', size: 70, delay: 50 });
  assert.equal(first.type, 'AnimatedView');
  assert.equal(flat(first.props.style).height, 0);
  h.effects.shift()();
  assert.deepEqual(h.animations.map(call => call[0]), ['timing', 'delay']);
  assert.equal(h.animations[0][1], 70);
  assert.equal(h.animations[0][2].duration, 420);
  h.render({ axis: 'height', size: 35, delay: 50 });
  h.effects.shift()();
  assert.equal(h.animations.at(-1)[0], 'spring');
  assert.equal(h.animations.at(-1)[1], 35);
  h.preference({ reducedMotion: true, ready: true });
  const stopped = h.render({ axis: 'height', size: 20 });
  assert.equal(stopped.type, 'NativeView');
  assert.equal(flat(stopped.props.style).height, 20, 'turning on Reduce Motion shows final size synchronously');
});
test('normal animation waits for the motion preference to be ready', () => {
  const h = harness('ios', false, false);
  h.render({ axis: 'width', size: 90 }); h.effects.shift()();
  assert.deepEqual(h.animations, []);
  h.preference({ reducedMotion: false, ready: true });
  h.render({ axis: 'width', size: 90 }); h.effects.shift()();
  assert.equal(h.animations[0][0], 'timing');
  assert.equal(h.animations[0][1], 90);
});
