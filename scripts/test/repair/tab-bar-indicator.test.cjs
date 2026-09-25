'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness, walk, text } = require('./reference-harness.cjs');

const flat = (style) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const BANDS = { index: 'home', flow: 'spending', bills: 'bills', wallet: 'accounts' };

for (const theme of ['light', 'dark']) {
  for (const language of ['en', 'ar']) {
    test(`${theme} ${language}: the selected tab wears its own colour and name; the others are spoken icons`, () => {
      const h = createHarness({ language, theme });
      const pill = h.deps['@/constants/theme'].TabPill[theme];
      const tree = h.tabTree('bills');
      const bar = walk(tree).find((node) => node.props?.role === 'tablist');
      assert.equal(flat(bar.props.style).backgroundColor, pill.bar, 'the floating bar is the ink pill');
      for (const name of ['index', 'flow', 'bills', 'wallet']) {
        const tab = walk(tree).find((node) => node.props?.testID === `main-tab-${name}`);
        const indicator = walk(tree).find((node) => node.props?.testID === `main-tab-${name}-indicator`);
        assert.ok(tab && indicator, name);
        const selected = name === 'bills';
        assert.equal(tab.props.accessibilityRole, 'tab');
        assert.equal(tab.props.accessibilityState.selected, selected);
        assert.equal(tab.props['aria-selected'], selected);
        assert.ok(tab.props.accessibilityLabel.length > 0, `${name} is always spoken`);
        const style = flat(indicator.props.style);
        assert.ok(style.minWidth >= 44 && style.minHeight >= 44, 'every target is at least 44pt');
        assert.equal(style.backgroundColor, selected ? pill[BANDS[name]].fill : 'transparent');
        const icon = walk(indicator).find((node) => node.type === 'svg' || node.props?.name);
        assert.ok(icon, `${name} draws its icon`);
        // Only the selected tab shows its name; the name is its own spoken label.
        assert.equal(text(indicator).trim().length > 0, selected, `${name} label visibility`);
        if (selected) assert.equal(text(indicator).trim(), tab.props.accessibilityLabel);
      }
    });
  }
}

test('at the accessibility text sizes every tab is an icon and holding one shows its name', () => {
  const h = createHarness({ largeText: true });
  // The harness reports fontScale 1.3 for largeText; the bar reads the shared breakpoint hook.
  const tree = h.tabTree('home');
  const tabs = walk(tree).filter((node) => node.props?.accessibilityRole === 'tab');
  assert.equal(tabs.length, 4);
  for (const tab of tabs) {
    assert.equal(text(tab).trim(), '', 'no visible label squeezed into the bar');
    assert.equal(typeof tab.props.onLongPress, 'function', 'hold to see the name');
  }
  tabs[2].props.onLongPress();
  assert.ok(h.events.some((event) => event[0] === 'state' && event[2] === tabs[2].props.accessibilityLabel));
});

test('the pill is drawn, never animated: selection stays immediate under any motion setting', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../src/components/tab-bar.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}|\/\/.*$/gm, '');
  assert.doesNotMatch(source, /Animated|withSpring|withTiming|useSharedValue|entering=|layout=/);
});

test('iOS keeps the native tab bar and tints each tab with its own colour', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../src/components/app-tabs-layout.ios.tsx'), 'utf8');
  assert.match(source, /from 'expo-router\/unstable-native-tabs'/);
  assert.match(source, /<NativeTabs\.Trigger\.Icon sf=\{tab\.sf\} selectedColor=\{bands\[tab\.band\]\.tabTint\} \/>/);
  assert.match(source, /<NativeTabs\.Trigger\.Label selectedStyle=\{\{ color: bands\[tab\.band\]\.tabTint \}\}>/);
  for (const [name, band] of Object.entries(BANDS)) assert.match(source, new RegExp(`name: '${name}', band: '${band}'`));
});
