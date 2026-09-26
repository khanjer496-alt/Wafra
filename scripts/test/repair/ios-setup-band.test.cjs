'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const theme = load(path.join(root, 'src/constants/theme.ts'), {
  '@/global.css': {}, 'react-native': { Platform: { select: values => values.ios } },
});
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)];
const style = value => Object.assign({}, ...(Array.isArray(value) ? value.flat(Infinity) : [value]).filter(Boolean));
function components(scheme, largeText) {
  const jsx = (type, props) => typeof type === 'function' ? type(props ?? {}) : ({ type, props: props ?? {} });
  return load(path.join(root, 'src/components/ios-message-setup/setup-step.tsx'), {
    react: {}, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', StyleSheet: { create: value => value, hairlineWidth: 1 } },
    '@/constants/theme': theme,
    '@/components/themed-text': { ThemedText: 'Text' }, '@/components/ui/icon': { Icon: 'Icon' },
    '@/hooks/use-theme': { useTheme: () => theme.Colors[scheme] },
    '@/hooks/use-large-text-layout': { useLargeTextLayout: () => largeText },
  });
}
for (const scheme of ['light', 'dark']) {
  test(`setup progress stacks at accessibility sizes while retaining the active step (${scheme})`, () => {
    const { StepProgress } = components(scheme, true);
    const tree = StepProgress({ current: 2, labels: ['Add', 'Test', 'Automate'], template: 'Step {step} of {total}', palette: theme.bandPalette('flow', scheme) });
    assert.equal(style(tree.props.style).flexDirection, 'column');
    assert.equal(tree.props.accessibilityValue.now, 2);
    assert.equal(tree.props.accessibilityLabel, 'Step 2 of 3: Test');
    assert.equal(walk(tree).filter(node => node.type === 'Icon' && node.props.name === 'check').length, 1);
    assert.ok(walk(tree).filter(node => node.type === 'Text').every(node => node.props.numberOfLines === undefined));
  });
  test(`setup result retains alert semantics and uses the screen palette (${scheme})`, () => {
    const { SetupStep } = components(scheme, false);
    const palette = theme.bandPalette('flow', scheme);
    const tree = SetupStep({ badge: '2', title: 'Check', body: 'Keep the phone unlocked', result: { tone: 'fail', title: 'Try again' }, palette });
    assert.equal(style(tree.props.style).backgroundColor, palette.card);
    const failure = walk(tree).find(node => node.props.testID === 'setup-result-fail');
    assert.equal(failure.props.accessibilityRole, 'alert');
    assert.equal(failure.props.accessibilityLabel, 'Try again');
    assert.equal(style(failure.props.style).backgroundColor, palette.statusOverSoft);
  });
}
test('new setup headings have nonempty English and Arabic counterparts', () => {
  const { iosSetupBandCopy } = load(path.join(root, 'src/lib/ios-setup-band-copy.ts'));
  const en = iosSetupBandCopy('en'), ar = iosSetupBandCopy('ar');
  assert.deepEqual(Object.keys(en), Object.keys(ar));
  for (const key of Object.keys(en)) { assert.ok(en[key].length); assert.match(ar[key], /[\u0600-\u06ff]/); }
});
