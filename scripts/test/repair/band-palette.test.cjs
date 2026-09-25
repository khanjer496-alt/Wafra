'use strict';
// Design language E band palettes: exact values from the approved boards
// (dark.py for dark mode), resolution by scheme, and contrast as a property
// of the tokens rather than of any one screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const theme = load(path.join(root, 'src/constants/theme.ts'), { '@/global.css': {}, 'react-native': { Platform: { select: (x) => x.android } } });
const { BandPalettes, BAND_IDS, bandPalette, TabPill, PatternPalette, BandLayout, Colors } = theme;

const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = (value) => { const [r, g, b] = hex(value); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const contrast = (a, b) => { const x = luminance(a); const y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('the six bands carry the approved light and dark colours', () => {
  const light = { home: '#16130F', spending: '#A4432F', bills: '#E2B45A', accounts: '#2F6577', flow: '#1F6B52', settings: '#EDE3CF' };
  const dark = { home: '#0B0A08', spending: '#6E2B1E', bills: '#5E4719', accounts: '#1B3F4A', flow: '#14473A', settings: '#26221C' };
  assert.deepEqual([...BAND_IDS], ['home', 'spending', 'bills', 'accounts', 'flow', 'settings']);
  for (const id of BAND_IDS) {
    assert.equal(BandPalettes.light[id].band, light[id], `light ${id}`);
    assert.equal(BandPalettes.dark[id].band, dark[id], `dark ${id}`);
    assert.equal(bandPalette(id, 'dark'), BandPalettes.dark[id], 'resolution is by reference, stable across renders');
    assert.equal(BandPalettes.light[id].sheet, '#F4F1EA');
    assert.equal(BandPalettes.dark[id].sheet, '#1C1A16');
    assert.equal(BandPalettes.dark[id].card, '#24211C');
    assert.equal(BandPalettes.dark[id].rule, '#3B362E');
    assert.equal(BandPalettes.dark[id].text, '#F2EFE8');
    assert.equal(BandPalettes.dark[id].textSecondary, '#A9A29A');
    assert.equal(BandPalettes.light[id].accent, '#57B894', 'mint is the one accent');
    assert.equal(BandPalettes.dark[id].onBand, '#F2EFE8', 'every dark band takes light text');
  }
  // Light text on dark bands, ink on the light ochre and sand bands.
  assert.equal(BandPalettes.light.bills.onBand, '#16130F');
  assert.equal(BandPalettes.light.settings.onBand, '#16130F');
  assert.equal(BandPalettes.light.spending.onBand, '#F4F1EA');
  // dark.py's tints for glyphs, links and status on dark surfaces.
  assert.deepEqual(['spending', 'accounts', 'flow', 'bills'].map((id) => BandPalettes.dark[id].tint), ['#E08A70', '#7FB4C4', '#57B894', '#D9AE62']);
  assert.deepEqual([BandPalettes.dark.home.statusOk, BandPalettes.dark.home.statusNear, BandPalettes.dark.home.statusOver], ['#57B894', '#D9AE62', '#E08A70']);
  assert.deepEqual([BandLayout.sheetRadius, BandLayout.sheetOverlap, BandLayout.sheetRise, BandLayout.buttonHeight, BandLayout.buttonRadius, BandLayout.chipHeight],
    [28, 28, 40, 56, 16, 38]);
});

test('the status bar follows the band: light content on dark bands', () => {
  for (const id of BAND_IDS) assert.equal(BandPalettes.dark[id].statusBar, 'light', `dark ${id}`);
  assert.deepEqual([...BAND_IDS].map((id) => BandPalettes.light[id].statusBar), ['light', 'light', 'dark', 'light', 'light', 'dark']);
});

for (const scheme of ['light', 'dark']) {
  test(`${scheme}: every text token holds 4.5:1 where it is drawn`, () => {
    for (const id of BAND_IDS) {
      const p = BandPalettes[scheme][id];
      const pairs = [
        ['onBand/band', p.onBand, p.band], ['onBand/tile', p.onBand, p.tile],
        ['onBandSecondary/band', p.onBandSecondary, p.band], ['onBandSecondary/tile', p.onBandSecondary, p.tile],
        ['onSelected/selected', p.onSelected, p.selected], ['onBand/unselected track', p.onBand, p.tile],
        ['tint/sheet', p.tint, p.sheet], ['onFill/fill', p.onFill, p.fill],
        ['text/sheet', p.text, p.sheet], ['textSecondary/sheet', p.textSecondary, p.sheet], ['text/card', p.text, p.card],
        ['onAccent/accent', p.onAccent, p.accent], ['onAccentSecondary/accent', p.onAccentSecondary, p.accent],
        ['statusOk/sheet', p.statusOk, p.sheet], ['statusNear/sheet', p.statusNear, p.sheet], ['statusOver/sheet', p.statusOver, p.sheet],
        ['text/glyphGround', p.text, p.glyphGround],
      ];
      for (const [name, fg, bg] of pairs) assert.ok(contrast(fg, bg) >= 4.5, `${scheme} ${id} ${name}: ${contrast(fg, bg).toFixed(2)}`);
      // Week bars that are not today read as data: 3:1 against the band.
      assert.ok(contrast(p.bandMark, p.band) >= 3, `${scheme} ${id} bandMark ${contrast(p.bandMark, p.band).toFixed(2)}`);
      assert.ok(contrast(p.accent, p.band) >= 1.2, 'today\'s mint bar stands apart from the band');
    }
  });

  test(`${scheme}: the floating tab pill labels and icons are legible`, () => {
    const pill = TabPill[scheme];
    for (const tab of ['home', 'spending', 'bills', 'accounts']) {
      assert.ok(contrast(pill[tab].text, pill[tab].fill) >= 4.5, `${scheme} ${tab} label ${contrast(pill[tab].text, pill[tab].fill).toFixed(2)}`);
    }
    assert.ok(contrast(pill.inactive, pill.bar) >= 4.5, 'unselected icons');
    for (const id of ['home', 'spending', 'bills', 'accounts']) {
      // iOS tints the selected system tab item: it must read on the platform bar.
      const bar = scheme === 'light' ? '#F9F9F9' : '#1C1C1E';
      assert.ok(contrast(BandPalettes[scheme][id].tabTint, bar) >= 4.5, `${scheme} ${id} iOS tint`);
    }
  });
}

test('pattern colours are palette tokens only, with a light and a dark resolution', () => {
  const tokens = ['ink', 'clay', 'ochre', 'slate', 'green', 'mint', 'sand', 'cream'];
  for (const scheme of ['light', 'dark']) {
    assert.deepEqual(Object.keys(PatternPalette[scheme].fill).sort(), [...tokens].sort());
    assert.deepEqual(Object.keys(PatternPalette[scheme].mark).sort(), [...tokens].sort());
  }
  assert.equal(PatternPalette.dark.fill.sand, '#2E2A23', 'sand grounds deepen at night (dark.py)');
  assert.equal(PatternPalette.dark.mark.clay, '#E08A70', 'glyph strokes move to the lighter tint');
});

test('the existing Ledger & Light palette is untouched', () => {
  assert.equal(Colors.light.background, '#F4F1EA');
  assert.equal(Colors.dark.background, '#14120F');
  assert.equal(Colors.light.primary, '#1F6B52');
  assert.equal(Colors.light.expense, '#A3402D');
  assert.equal(Colors.dark.expense, '#E0836B');
});

test('useBand resolves the scheme the way useTheme does: scope, then preference, then light', () => {
  const hook = (scope, scheme) => load(path.join(root, 'src/hooks/use-band.ts'), {
    react: { useContext: (context) => context.value },
    '@/constants/theme': theme,
    '@/hooks/use-color-scheme': { useColorScheme: () => scheme },
    '@/hooks/use-theme': { ThemeScope: { value: scope } },
  });
  assert.equal(hook(undefined, 'dark').useBand('spending'), BandPalettes.dark.spending);
  assert.equal(hook(undefined, 'light').useBand('spending'), BandPalettes.light.spending);
  assert.equal(hook(undefined, null).useBand('bills'), BandPalettes.light.bills, 'an unknown OS scheme paints light');
  assert.equal(hook(undefined, 'unspecified').useBand('home'), BandPalettes.light.home);
  assert.equal(hook('dark', 'light').useBand('home'), BandPalettes.dark.home, 'a presentation scope wins');
  assert.equal(hook('dark', 'light').useBand('home', 'light'), BandPalettes.light.home, 'an explicit override wins over everything');
  assert.equal(hook(undefined, 'dark').useBandScheme(), 'dark');
});
