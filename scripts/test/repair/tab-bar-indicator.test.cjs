'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness, walk } = require('./reference-harness.cjs');

const flat = (style) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

for (const language of ['en', 'ar']) {
  test(`${language}: the selected tab carries the Material 3 pill and a selected state`, () => {
    const h = createHarness({ language });
    const tree = h.tabTree('bills');
    for (const name of ['index', 'flow', 'bills', 'wallet']) {
      const tab = walk(tree).find((node) => node.props?.testID === `main-tab-${name}`);
      const pill = walk(tree).find((node) => node.props?.testID === `main-tab-${name}-indicator`);
      assert.ok(tab && pill, name);
      const selected = name === 'bills';
      assert.equal(tab.props.accessibilityState.selected, selected);
      assert.equal(tab.props.accessibilityRole, 'tab');
      const style = flat(pill.props.style);
      assert.equal(style.width, 64);
      assert.equal(style.height, 32);
      assert.equal(style.backgroundColor, selected ? h.theme.primarySoft : 'transparent',
        'the pill is laid out for every tab so icons never shift; only the selected one is filled');
    }
  });
}

test('the pill is drawn, never animated: selection stays immediate under any motion setting', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../src/components/tab-bar.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}|\/\/.*$/gm, '');
  assert.doesNotMatch(source, /Animated|withSpring|withTiming|useSharedValue|entering=|layout=/);
});
