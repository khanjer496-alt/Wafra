'use strict';
// Spending in design language E: the clay band's content per view, the
// calendar tile colours, the Compare sentence and the sheet rows.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { createHarness, walk, text } = require('./reference-harness.cjs');

const root = path.resolve(__dirname, '../../..');
const theme = load(path.join(root, 'src/constants/theme.ts'), { '@/global.css': {}, 'react-native': { Platform: { select: (x) => x.android } } });
const tiles = load(path.join(root, 'src/lib/spending-calendar-tiles.ts'), { '@/constants/theme': theme });
const { compareDirection } = load(path.join(root, 'src/lib/spending-compare.ts'));
const byId = (tree, id) => walk(tree).find((node) => node.props?.testID === id);

test('calendar tiles: one tone, stronger with more spending, day numbers readable at 4.5:1 in both schemes', () => {
  for (const scheme of ['light', 'dark']) {
    const clay = theme.BandPalettes[scheme].spending;
    const min = tiles.minTileAlpha(clay);
    let previous = null;
    for (let step = 0; step <= 20; step += 1) {
      const share = step / 20;
      const tile = tiles.calendarTileColors(clay, share, min);
      if (share === 0) {
        assert.equal(tile.background, null, 'an empty day shows the band');
        assert.ok(tiles.contrastRatio(tile.text, clay.band) >= 4.5, `${scheme} empty day number`);
        continue;
      }
      assert.ok(tiles.contrastRatio(tile.text, tile.background) >= 4.5, `${scheme} ${share}: ${tile.text} on ${tile.background}`);
      // More spending never reads as less: the fill moves steadily toward the band's text colour.
      const distance = tiles.contrastRatio(tile.background, clay.band);
      if (previous !== null) assert.ok(distance >= previous, `${scheme} ${share} strengthens`);
      previous = distance;
    }
  }
  assert.equal(tiles.blendHex('#FFFFFF', '#000000', 0.5), '#808080');
  assert.equal(tiles.blendHex('#F4F1EA', '#A4432F', 0), '#A4432F');
});

test('Compare direction: the like-for-like delta, with a noise floor for "about the same"', () => {
  assert.equal(compareDirection({ currentFils: 164_000, previousFils: 100_000, deltaFils: 64_000 }, 5_000), 'more');
  assert.equal(compareDirection({ currentFils: 90_000, previousFils: 100_000, deltaFils: -10_000 }, 5_000), 'less');
  assert.equal(compareDirection({ currentFils: 101_000, previousFils: 100_000, deltaFils: 1_000 }, 5_000), 'same', 'under the floor');
  assert.equal(compareDirection({ currentFils: 1_010_000, previousFils: 1_000_000, deltaFils: 10_000 }, 5_000), 'same', 'under 2% of the earlier figure');
  assert.equal(compareDirection({ currentFils: 0, previousFils: 0, deltaFils: 0 }, 0), 'same');
});

test('Categories: the band holds the period total, Day X of Y and the one-tone share bar', () => {
  const h = createHarness();
  const tree = h.render('flow');
  const scaffold = walk(tree).find((node) => node.type === 'BandScaffold');
  assert.equal(scaffold.props.band, 'spending');
  assert.equal(scaffold.props.tabbed, true);
  assert.equal(scaffold.props.nav.title, 'Spending');
  assert.deepEqual([...scaffold.props.nav.actions.map((a) => a.testID)], ['spending-search', 'spending-period']);
  assert.match(scaffold.props.nav.actions[1].label, /^Choose period, Sept? 2026$/);
  const band = scaffold.props.bandContent;
  const total = byId(band, 'spending-total');
  assert.match(total.props.accessibilityLabel, /^Spent this month, AED 5,360\.00$/);
  assert.equal(text(byId(band, 'spending-pace')), 'Day 6 of 30');
  assert.ok(byId(band, 'spending-share-bar'));
  // A past month names itself instead of "this month", with no pace.
  const past = walk(createHarness({ period: { mode: 'month', key: '2026-08' } }).render('flow'))
    .find((node) => node.type === 'BandScaffold').props.bandContent;
  assert.match(byId(past, 'spending-total').props.accessibilityLabel, /^Spent in Aug 2026, AED /);
  assert.equal(byId(past, 'spending-pace'), undefined);
});

test('Categories rows: glyph tiles in one tone; limit bars only on rows with a limit; rows without one say so', () => {
  const h = createHarness();
  const tree = h.render('flow');
  const clay = h.deps['@/hooks/use-band'].useBand('spending');
  const dining = byId(tree, 'spending-category-dining');
  const other = byId(tree, 'spending-category-other');
  assert.ok(byId(dining, 'spending-limit-bar-dining'), 'dining has a limit and its bar');
  assert.equal(byId(other, 'spending-limit-bar-other'), undefined);
  assert.match(text(byId(other, 'spending-share-other')), /% of spending · no limit$/);
  // Every glyph tile on the sheet shares one ground and one ink.
  const grounds = new Set(walk(tree).filter((node) => node.props?.importantForAccessibility === 'no' && node.props?.style?.[1]?.backgroundColor)
    .map((node) => node.props.style[1].backgroundColor));
  assert.deepEqual([...grounds], [clay.glyphGround]);
});

test('Compare: the plain sentence on the band from the existing comparison, bars on the sheet', () => {
  const h = createHarness({ params: { view: 'compare' } });
  const tree = h.render('flow');
  const band = walk(tree).find((node) => node.type === 'BandScaffold').props.bandContent;
  const sentence = text(byId(band, 'spending-compare-sentence'));
  // Harness ledger: September's everyday spending (rent left out) against August's.
  assert.match(sentence, /^AED [\d,.]+ (more|less) than by this point in Aug 2026$/);
  assert.match(byId(band, 'spending-compare-band').props.accessibilityLabel, /Days 1–6 of each month · rent and fixed costs left out/);
  assert.ok(byId(tree, 'spending-trends'), 'the sheet keeps the movers and history');
});

test('Calendar: the grid on the band, the selected day\'s rows and total on the sheet', () => {
  const recent = createHarness({ params: { view: 'calendar' } }).render('flow');
  assert.equal(text(byId(recent, 'spending-day-heading')), 'Recent spending');
  assert.equal(byId(recent, 'spending-day-total'), undefined);
  const band = walk(recent).find((node) => node.type === 'BandScaffold').props.bandContent;
  assert.ok(byId(band, 'spending-calendar'), 'the grid is on the band');
  assert.match(text(byId(band, 'spending-calendar-no-spend')), /no-spend day/);
  const future = byId(band, 'spending-calendar-day-2026-09-20');
  assert.equal(future.props.disabled, true, 'days still to come are not selectable');

  // useState order in flow.tsx: 0 view … 9 calendarDay.
  const selected = createHarness({ params: { view: 'calendar' }, states: { 9: '2026-09-03' } }).render('flow');
  assert.match(text(byId(selected, 'spending-day-heading')), /3 September/);
  assert.match(text(byId(selected, 'spending-day-total')), /620\.00/);
  const ring = byId(walk(selected).find((node) => node.type === 'BandScaffold').props.bandContent, 'spending-calendar-day-2026-09-03');
  assert.equal(ring.props.accessibilityState.selected, true);
  assert.ok(byId(selected, 'spending-day-clear'), 'the day can be cleared back to recent rows');
});
