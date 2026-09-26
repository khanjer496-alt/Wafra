'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const file = path.join(root, 'src/components/recap/recap-story.tsx');
const source = fs.readFileSync(file, 'utf8');

// Every import of the story is a boundary here: only its pure exports run.
const component = () => null;
const inert = new Proxy({}, { get: (_target, key) => key === '__esModule' ? true : component });
const story = load(file, {
  react: { __esModule: true, default: {}, useCallback: (fn) => fn, useEffect() {}, useMemo: (fn) => fn(), useState: (v) => [v, () => {}] },
  'react-native': { StyleSheet: { create: (styles) => styles, hairlineWidth: 1, absoluteFillObject: {} },
    Pressable: component, View: component, useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }) },
  'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: 'Fragment' },
  'expo-status-bar': inert,
  'react-native-safe-area-context': inert,
  'react-native-reanimated': inert,
  '@/components/themed-text': inert,
  '@/components/ui/band/band-figure': inert,
  '@/components/ui/band/e-button': inert,
  '@/components/ui/band/stat-tile': inert,
  '@/components/ui/band-scaffold': { BAND_GUTTER: 20, BandIconButton: component },
  '@/components/ui/bank-avatar': inert,
  '@/components/ui/grow-bar': inert,
  '@/components/ui/merchant-avatar': inert,
  '@/components/ui/your-pattern': inert,
  '@/constants/theme': { EASE: [0.2, 0.8, 0.2, 1], Fonts: {}, Motion: { change: 240 }, bandPalette: () => ({}) },
  '@/hooks/use-band': inert,
  '@/hooks/use-language': inert,
  '@/hooks/use-large-text-layout': inert,
  '@/hooks/use-reduced-motion': inert,
  '@/lib/format': inert,
  '@/lib/ledger-money': inert,
  '@/lib/haptics': inert,
  '@/lib/i18n': inert,
  '@/lib/recap-copy': inert,
  '@/lib/recap': { RECAP_TIME_BUCKETS: ['morning', 'afternoon', 'evening', 'night'] },
});

const snapshot = (over = {}) => ({
  descriptor: { id: 'month:2026-08', kind: 'month', key: '2026-08', label: 'August 2026' },
  topMerchants: [{ key: 'carrefour', title: 'Carrefour', category: 'groceries', spendFils: 142_000, count: 14 }],
  topCategories: [{ category: 'groceries', label: 'Groceries', spendFils: 142_000, percent: 40 }],
  mostUsedAccount: { account: { id: 'card' }, label: 'Card', spendFils: 1, count: 1 },
  spendingCount: 20,
  largestPurchase: { title: 'IKEA', category: 'shopping', amountFils: 64_000, date: '2026-08-02' },
  timedCount: 12,
  ...over,
});

// The module runs in its own VM realm: copy its arrays into this one.
const scenesOf = (snap) => [...story.recapScenes(snap)];

test('the cover opens the story on the ink band and "where and when" follows on clay', () => {
  const scenes = scenesOf(snapshot());
  assert.deepEqual(scenes, ['cover', 'where', 'category', 'account', 'rhythm', 'highlight', 'final']);
  assert.equal(story.RECAP_SCENE_BANDS.cover, 'home');
  assert.equal(story.RECAP_SCENE_BANDS.where, 'spending');
  assert.equal(story.RECAP_SCENE_BANDS.final, 'home');
});

test('a card is left out when the period has nothing true to show on it', () => {
  assert.deepEqual(scenesOf(snapshot({ topMerchants: [], topCategories: [], mostUsedAccount: null,
    spendingCount: 0, largestPurchase: null })), ['cover', 'final']);
  // A year always has its month-by-month card.
  assert.ok(scenesOf(snapshot({ descriptor: { id: 'year:2025', kind: 'year', year: 2025, label: '2025' },
    largestPurchase: null })).includes('highlight'));
});

test('time of day: counts only, highest in mint, bars grow 50ms apart, base is timed payments', () => {
  const block = source.slice(source.indexOf('function TimeOfDay'), source.indexOf('function WhereWhenScene'));
  assert.match(block, /testID="recap-time-of-day"/);
  assert.match(block, /lead \? palette\.accent : palette\.bandMark/);
  assert.match(block, /delay=\{index \* 50\}/);
  assert.match(block, /w\.timedBase\(snapshot\.timedCount\)/);
  // A tie names no single time.
  assert.match(block, /leaders\.length === 1 \? leaders\[0\] : null/);
  assert.doesNotMatch(block, /formatMinorUnits|moneyLabel/);
  // The card only draws the bars when some payment had a clock time.
  assert.match(source, /\{timed \? <TimeOfDay /);
});

test('the story keeps its testIDs, its close control and its spoken position', () => {
  for (const id of ['recap-spend-change', 'recap-spend-counts', 'recap-time-of-day', 'recap-cover', 'recap-where-when',
    'recap-top-merchant', 'recap-time-caption', 'recap-close', 'recap-done']) {
    assert.ok(source.includes(`'${id}'`) || source.includes(`"${id}"`), id);
  }
  assert.match(source, /accessibilityLabel=\{w\.position\(index \+ 1, scenes\.length\)\}/);
  assert.match(source, /label: w\.close, onPress: onClose/);
});

test('band figures are Geist SemiBold, never Geist Mono, never italic', () => {
  assert.doesNotMatch(source, /Fonts\.mono|italic|serif/);
  assert.match(source, /<BandFigure testID="recap-spend-total"/);
});
