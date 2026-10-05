'use strict';
// A goal's jar of coins and the recap cover's row of coins, rendered from the
// shipping source through the reference harness. The coins are decoration
// beside written figures: hidden from assistive tech, sized from the real
// figures, and the spoken labels stay as they were. Synthetic ledger only.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { createHarness, walk, text } = require('./reference-harness.cjs');

const root = path.resolve(__dirname, '../../..');
const byId = (tree, id) => walk(tree).find((node) => node.props?.testID === id);
const flat = (style) => Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean));
const hidden = (node) => node.props.importantForAccessibility === 'no-hide-descendants' && node.props.accessibilityElementsHidden === true;

/* ── Goal jar ─────────────────────────────────────────────────────────── */

function renderGoal(goal, options = {}) {
  const h = createHarness({ ...options, state: { goals: [{ id: 'umrah', title: 'Umrah trip', emoji: 'plane', ...goal }] } });
  h.deps['expo-router'].useLocalSearchParams = () => ({ id: 'umrah' });
  h.local('@/components/goals/goal-jar');
  return { h, tree: load(path.join(root, 'src/app/goal.tsx'), h.deps).default() };
}

/** Gold coins showing in the jar: the harness holds each coin at its final frame. */
const goldCoins = (tree) => walk(tree).filter((node) => /^goal-jar-coins-coin-\d+$/.test(node.props?.testID ?? ''))
  .filter((node) => flat(node.props.style).opacity.value === 1).length;

test('the goal jar fills from the real figures and is hidden from assistive tech', () => {
  const { h, tree } = renderGoal({ targetFils: 500000, savedFils: 320000 });
  const jar = byId(tree, 'goal-jar');
  assert.ok(jar, 'the jar is drawn');
  assert.ok(hidden(jar), 'the jar is hidden from assistive tech');
  assert.ok(hidden(byId(tree, 'goal-jar-coins')), 'its coins too');
  const coins = walk(tree).filter((node) => /^goal-jar-coins-coin-\d+$/.test(node.props?.testID ?? ''));
  assert.equal(coins.length, 10, 'a full jar is ten coins');
  assert.equal(goldCoins(tree), 6, '64% saved fills six of ten');
  const { jarCoins, JAR_COINS } = h.deps['@/components/goals/goal-jar'];
  assert.equal(JAR_COINS, 10);
  assert.equal(jarCoins(320000, 500000), 6);
  // The figures and the spoken label are unchanged.
  const image = walk(byId(tree, 'goal-progress')).find((node) => node.props?.accessibilityRole === 'image');
  assert.equal(image.props.accessible, true);
  assert.equal(image.props.accessibilityLabel, '64 percent saved. AED 3,200.00 of AED 5,000.00');
  assert.match(text(byId(tree, 'goal-progress')), /64%[\s\S]*saved[\s\S]*Umrah trip[\s\S]*AED 3,200.00 of AED 5,000.00/);
});

test('the jar never draws a little saved as empty, nearly all as full, or past full', () => {
  assert.equal(goldCoins(renderGoal({ targetFils: 500000, savedFils: 0 }).tree), 0);
  assert.equal(goldCoins(renderGoal({ targetFils: 500000, savedFils: 100 }).tree), 1, 'a little saved shows a coin');
  assert.equal(goldCoins(renderGoal({ targetFils: 500000, savedFils: 499000 }).tree), 9, 'nearly there is not yet full');
  const reached = renderGoal({ targetFils: 500000, savedFils: 650000 }).tree;
  assert.equal(goldCoins(reached), 10, 'a reached goal is a full jar');
  assert.match(text(byId(reached, 'goal-left')), /Reached|reached/);
  assert.equal(walk(byId(reached, 'goal-progress')).find((node) => node.props?.accessibilityRole === 'image').props.accessibilityLabel,
    '100 percent saved. AED 6,500.00 of AED 5,000.00');
});

test('under large text the jar and its percent stack', () => {
  const { tree } = renderGoal({ targetFils: 500000, savedFils: 320000 }, { largeText: true });
  const image = walk(byId(tree, 'goal-progress')).find((node) => node.props?.accessibilityRole === 'image');
  assert.equal(flat(image.props.style).flexDirection, 'column');
  const regular = renderGoal({ targetFils: 500000, savedFils: 320000 }).tree;
  assert.equal(flat(walk(byId(regular, 'goal-progress')).find((node) => node.props?.accessibilityRole === 'image').props.style).flexDirection, 'row');
});

/* ── Recap cover ──────────────────────────────────────────────────────── */

function renderCover({ reducedMotion = true, largeText = false, spend = 354_000, income = 830_000 } = {}) {
  const h = createHarness({ largeText });
  let slot = 0;
  h.deps.react = { ...h.deps.react, useState: (initial) => [slot++ === 0 ? 0 : initial, () => {}] };
  h.deps['react-native-reanimated'] = { ...h.deps['react-native-reanimated'],
    FadeInLeft: { duration() { return this; } }, FadeInRight: { duration() { return this; } },
    cancelAnimation() {}, runOnJS: (fn) => fn, withTiming: (value) => value };
  h.deps['@/hooks/use-reduced-motion'] = { useReducedMotion: () => reducedMotion,
    useMotionPreference: () => ({ ready: true, reducedMotion }) };
  h.deps['expo-status-bar'] = { StatusBar: 'StatusBar' };
  h.deps['@/components/ui/band/e-button'] = { EButton: 'EButton' };
  h.deps['@/components/ui/band/band-figure'] = { BandFigure: 'BandFigure' };
  h.deps['@/components/ui/band/stat-tile'] = { StatTile: 'StatTile' };
  h.deps['@/components/ui/band-scaffold'] = { BAND_GUTTER: 20, BandIconButton: 'BandIconButton' };
  h.deps['@/components/ui/grow-bar'] = { GrowBar: 'GrowBar' };
  h.deps['@/lib/recap-copy'] = load(path.join(root, 'src/lib/recap-copy.ts'), h.deps);
  h.deps['@/lib/recap'] = { RECAP_TIME_BUCKETS: ['morning', 'afternoon', 'evening', 'night'] };
  const { RecapStory } = load(path.join(root, 'src/components/recap/recap-story.tsx'), h.deps);
  return RecapStory({ snapshot: {
    descriptor: { id: 'month:2026-08', kind: 'month', key: '2026-08', label: 'August 2026' },
    from: '2026-08-01', to: '2026-08-31', totalSpendFils: spend, totalIncomeFils: income, netFils: 476_000,
    spendChangePercent: -12, spendingCount: 20, merchantCount: 9, noSpendDays: 4,
    topMerchants: [], topCategories: [], mostUsedAccount: null, largestPurchase: null, timedCount: 0,
  }, moneySpec: { schemaVersion: 2, currency: 'AED', exponent: 2 }, name: 'Sara', onClose() {} });
}

test('the recap cover keeps its content and adds a hidden row of coins under the title', () => {
  const tree = renderCover();
  const cover = byId(tree, 'recap-cover');
  assert.ok(cover);
  const row = byId(cover, 'recap-cover-coins');
  assert.ok(row, 'the coin row is drawn on the cover');
  assert.ok(hidden(row), 'and hidden from assistive tech');
  // AED 3,540 out of AED 8,300 in: 2 of 5 coins gold, the other 3 empty places.
  const coins = walk(row).filter((node) => /^recap-cover-coin-\d+$/.test(node.props?.testID ?? ''));
  assert.equal(coins.length, 2);
  assert.equal(walk(row).filter((node) => /^recap-cover-ghost-\d+$/.test(node.props?.testID ?? '')).length, 3);
  // Reduce Motion: every coin is already in place.
  assert.ok(coins.every((coin) => flat(coin.props.style).opacity.value === 1));
  // The cover's own content is all still there, in order, and the coins speak nothing.
  for (const id of ['recap-cover-pattern', 'recap-spend-total', 'recap-spend-change', 'recap-spend-counts', 'recap-money-in-net']) {
    assert.ok(byId(cover, id), id);
  }
  assert.equal(walk(row).filter((node) => node.props?.accessibilityLabel || node.props?.accessible).length, 0);
  assert.equal(text(row).trim(), '');
  const header = walk(cover).find((node) => node.props?.accessibilityRole === 'header');
  assert.match(text(header), /August 2026/);
});

test('with motion on, the cover coins start hidden and rise in; large text keeps them small', () => {
  const moving = byId(renderCover({ reducedMotion: false }), 'recap-cover-coins');
  const coins = walk(moving).filter((node) => /^recap-cover-coin-\d+$/.test(node.props?.testID ?? ''));
  assert.ok(coins.every((coin) => flat(coin.props.style).opacity.value === 0), 'held below their place until the rise runs');
  const large = byId(renderCover({ largeText: true }), 'recap-cover-coins');
  const disc = walk(large).find((node) => typeof flat(node.props?.style).width === 'number');
  assert.equal(flat(disc.props.style).width, 26);
});

test('the cover coins stand for a real share: none without money in or spending, all when spending passed it', () => {
  assert.equal(byId(renderCover({ spend: 0 }), 'recap-cover-coins'), undefined, 'nothing spent, no row');
  assert.equal(byId(renderCover({ income: 0 }), 'recap-cover-coins'), undefined, 'no money in, no share to draw');
  const over = byId(renderCover({ spend: 900_000, income: 830_000 }), 'recap-cover-coins');
  assert.equal(walk(over).filter((node) => /^recap-cover-coin-\d+$/.test(node.props?.testID ?? '')).length, 5);
  assert.equal(walk(over).filter((node) => /^recap-cover-ghost-\d+$/.test(node.props?.testID ?? '')).length, 0);
});
