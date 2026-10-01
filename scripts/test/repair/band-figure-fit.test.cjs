'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, walk, text } = require('./reference-harness.cjs');
const flat = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

for (const language of ['en', 'ar']) for (const fontScale of [1, 1.3, 3.1]) {
  test(`million-scale band amounts fit at ${fontScale}x in ${language}, including rolling and narrow tiles`, () => {
    const h = createHarness({ language, theme: 'dark', width: 320, largeText: fontScale >= 1.6 });
    h.deps['react-native'].useWindowDimensions = () => ({ width: 320, fontScale });
    h.deps['@/components/ui/rolling-money'] = { RollingMoney: 'RollingMoney' };
    const { BandFigure, figureEms } = h.local('@/components/ui/band/band-figure');
    const palette = h.deps['@/constants/theme'].bandPalette('spending', 'dark');
    const spec = { schemaVersion: 2, currency: 'AED', exponent: 2 };
    for (const [size, fitInset] of [['hero', 0], ['large', 160], ['medium', 100]]) {
      const amount = h.deps['@/lib/ledger-money'].formatMinorUnits(123456789, spec);
      const props = { fils: 123456789, palette, moneySpec: spec, size, fitInset };
      const staticTree = BandFigure(props);
      const digits = walk(staticTree).find(node => node.type === 'Text' && text(node) === amount);
      assert.ok(digits, 'all exact digits are rendered as text');
      const metrics = flat(digits.props.style);
      const drawnSize = metrics.fontSize * Math.min(fontScale, digits.props.maxFontSizeMultiplier);
      // Measured Geist SemiBold: digits 0.62em, separators 0.23em; the estimate
      // charges 0.64em and 0.32em.
      assert.ok(figureEms(amount) >= amount.replace(/[^0-9]/g, '').length * .62 + amount.replace(/[0-9]/g, '').length * .23);
      assert.ok(drawnSize * figureEms(amount) <= 320 - 40 - fitInset, 'amount fits conservative tabular advance');
      assert.equal(metrics.writingDirection, 'ltr');
      assert.equal(digits.props.ellipsizeMode, undefined);
      assert.equal(digits.props.numberOfLines, undefined);
      if (fontScale === 1 && size === 'hero') assert.ok(metrics.fontSize < 56, 'base size itself shrinks at default scale');
      const staticInline = walk(staticTree).find(node => flat(node.props.style).direction === 'ltr');
      assert.equal(flat(staticInline.props.style).flexDirection, 'column', 'currency gets its own line when needed');
      const rollingTree = BandFigure({ ...props, rolling: true });
      const rolling = walk(rollingTree).find(node => node.type === 'RollingMoney');
      assert.ok(rolling);
      assert.deepEqual(flat(rolling.props.figureStyle), metrics, 'rolling uses identical fitted text metrics');
      assert.equal(rolling.props.maxFontSizeMultiplier, digits.props.maxFontSizeMultiplier);
      assert.equal(rolling.props.prefix, false, 'currency layout is shared by static and rolling');
      assert.equal(staticTree.props.accessibilityLabel, rollingTree.props.accessibilityLabel);
      assert.ok(staticTree.props.accessibilityLabel.includes(`AED ${amount}`));
    }
  });
}
test('short amounts retain their intended size and locale currency placement', () => {
  const h = createHarness({ width: 390 });
  const { BandFigure } = h.deps['@/components/ui/band/band-figure'];
  const tree = BandFigure({ fils: 4200, moneySpec: { currency: 'AED', exponent: 2 }, palette: h.deps['@/constants/theme'].bandPalette('home', 'light') });
  const digits = walk(tree).find(node => node.type === 'Text' && text(node) === '42');
  assert.ok(digits);
  assert.equal(flat(digits.props.style).fontSize, 56);
  assert.equal(flat(walk(tree).find(node => flat(node.props.style).direction === 'ltr').props.style).flexDirection, 'row');
});
