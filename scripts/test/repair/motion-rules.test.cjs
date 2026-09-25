'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const code = (file) => read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const theme = load(path.join(root, 'src/constants/theme.ts'), {
  '@/global.css': {}, 'react-native': { Platform: { OS: 'ios', select: (x) => x.ios ?? x.default } },
});

test('motion tokens obey the rules: nothing over 500 ms, one 260/24 spring, the rules easing', () => {
  const { Motion, MotionSpring, EASE } = theme;
  assert.deepEqual([...EASE], [0.2, 0.8, 0.2, 1]);
  assert.equal(Motion.tap, 150);
  assert.equal(Motion.change, 240);
  assert.equal(Motion.appear, 420);
  assert.equal(Motion.max, 500);
  for (const [name, value] of Object.entries(Motion)) {
    // A looping pulse is measured per half-cycle.
    const effective = name === 'pulse' ? value / 2 : value;
    assert.ok(effective <= Motion.max, `${name} ${effective}ms exceeds ${Motion.max}ms`);
  }
  assert.equal(MotionSpring.stiffness, 260);
  assert.equal(MotionSpring.damping, 24);
});

test('pulse callers keep reading the shared token (so the cap reaches them)', () => {
  for (const file of ['src/components/lock-gate.tsx', 'src/components/recap/recap-logo-trigger.tsx',
    'src/components/ui/states.tsx']) {
    assert.match(code(file), /Motion\.pulse \/ 2/, file);
  }
});

test('the sheet opens on the shared spring and keeps its Android / Reduce Motion bypass', () => {
  const sheet = code('src/components/ui/bottom-sheet.tsx');
  assert.match(sheet, /damping: MotionSpring\.damping/);
  assert.match(sheet, /stiffness: MotionSpring\.stiffness/);
  assert.match(sheet, /overshootClamping: true/);
  assert.ok((sheet.match(/reducedMotion \|\| Platform\.OS === 'android'/g) ?? []).length >= 3);
});

test('the composition bar fade follows the app-wide motion policy (screen reader included)', () => {
  const charts = code('src/components/ui/charts.tsx');
  assert.match(charts, /entering=\{reducedMotion \? undefined : FadeIn/);
  assert.doesNotMatch(charts, /entering=\{FadeIn\.delay/);
});

test('the choice check pops on the spring with motion and only cross-fades without it', () => {
  const sheet = code('src/components/ui/choice-sheet.tsx');
  assert.match(sheet, /withSpring\(target, \{ \.\.\.MotionSpring/);
  assert.match(sheet, /if \(reducedMotion \|\| !active\) \{\s*shown\.value = withTiming/);
  assert.match(sheet, /reducedMotion\s*\? \{ opacity: shown\.value, transform: \[\{ scale: 1 \}\] \}/);
  assert.match(sheet, /useSharedValue\(active \? 1 : 0\)/, 'opening the sheet never replays the pop');
});
