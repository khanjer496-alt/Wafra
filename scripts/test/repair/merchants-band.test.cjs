'use strict';
// The merchants directory in design language E: what the clay band carries,
// what moves onto the sheet at the accessibility sizes, and the ranked rows.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const financialFixture = require('./merchant-spending-fixture.cjs');
const root = path.resolve(__dirname, '../../..');

function renderDirectory({ largeText = false, language = 'en', transactions } = {}) {
  const events = [];
  const jsx = (type, props, key) => typeof type === 'function' && !type.boundary ? type(props) : { type: type.boundary ?? type, props, key };
  const boundary = (name) => Object.assign(() => null, { boundary: name });
  const modules = financialFixture();
  const state = { hydrated: true, monthStartDay: 1, accounts: [{ id: 'bank', name: 'Everyday account' }],
    transactions: transactions ?? [
      { id: 'a', title: 'Carrefour', type: 'expense', amountFils: 142000, category: 'groceries', accountId: 'bank', date: '2026-09-03' },
      { id: 'b', title: 'Carrefour', type: 'expense', amountFils: 1000, category: 'groceries', accountId: 'bank', date: '2026-09-04' },
      { id: 'c', title: 'IKEA', type: 'expense', amountFils: 64000, category: 'shopping', accountId: 'bank', date: '2026-09-05' },
    ] };
  const palette = { band: 'clay', onBand: 'cream', onBandSecondary: 'cream2', text: 'ink', textSecondary: 'ink2', card: 'card', rule: 'rule' };
  const deps = {
    ...modules,
    react: { memo: (f) => f, useMemo: (fn) => fn(), useCallback: (fn) => fn, useDeferredValue: (v) => v,
      useState: (value) => [typeof value === 'function' ? value() : value, (next) => events.push(['state', next])] },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { FlatList: boundary('FlatList'), Platform: { OS: 'android' }, Pressable: 'Pressable', View: 'View',
      StyleSheet: { create: (s) => s, hairlineWidth: 1 } },
    'expo-router': { useRouter: () => ({ push: (href) => events.push(['route', href]), back() {}, replace() {}, canGoBack: () => true }) },
    '@/components/themed-text': { ThemedText: boundary('Text') },
    '@/components/period-sheet': { PeriodSheet: boundary('PeriodSheet') },
    '@/components/ui/action-icon-button': { ActionIconButton: boundary('ActionIconButton') },
    '@/components/ui/band-scaffold': { BandScaffold: boundary('BandScaffold'), useBandBottomInset: () => 10, BAND_GUTTER: 20 },
    '@/components/ui/band/band-segmented': { BandSegmented: boundary('BandSegmented') },
    '@/components/ui/band/e-button': { EButton: boundary('EButton') },
    '@/components/ui/merchant-avatar': { MerchantAvatar: boundary('Avatar') },
    '@/components/ui/money': { Money: boundary('Money') },
    '@/components/ui/segmented-control': { SegmentedControl: boundary('SegmentedControl') },
    '@/components/ui/states': { SkeletonRows: boundary('SkeletonRows') },
    '@/components/ui/text-field': { TextField: boundary('TextField') },
    '@/constants/theme': { Fonts: {}, Spacing: { two: 8 } },
    '@/hooks/use-band': { useBand: () => palette },
    '@/hooks/use-language': { useLanguage: () => language },
    '@/hooks/use-large-text-layout': { useLargeTextLayout: () => largeText },
    '@/lib/details-copy': load(path.join(root, 'src/lib/details-copy.ts')),
    '@/lib/everyday-band-copy': load(path.join(root, 'src/lib/everyday-band-copy.ts')),
    '@/lib/merchant-insights': load(path.join(root, 'src/lib/merchant-insights.ts'),
      { ...modules, '@/lib/uncategorised': require('../build/uncategorised.js') }),
    '@/lib/merchant-spending-copy': load(path.join(root, 'src/lib/merchant-spending-copy.ts')),
    '@/lib/period-context': { usePeriod: () => ({ period: { mode: 'month', key: '2026-09' }, setPeriod() {} }) },
    '@/lib/store': { useStore: () => ({ state }) },
  };
  const { default: MerchantsScreen } = load(path.join(root, 'src/app/merchants.tsx'), deps);
  return { tree: MerchantsScreen(), events, palette };
}
function walk(node) {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!node || typeof node !== 'object') return [];
  return [node, ...walk(node.props?.children), ...walk(node.props?.bandContent), ...walk(node.props?.ListHeaderComponent)];
}
const byId = (tree, id) => walk(tree).find((n) => n.props?.testID === id);
const textOf = (node) => walk(node).filter((n) => n.type === 'Text').map((n) => [n.props.children].flat(Infinity).join('')).join(' ');

test('the clay band carries the title, the period with its merchant count and the sort', () => {
  const { tree, events } = renderDirectory();
  const screen = byId(tree, 'merchant-directory');
  assert.equal(screen.type, 'BandScaffold');
  assert.equal(screen.props.band, 'spending');
  assert.equal(screen.props.scroll, false, 'the sheet owns the virtualized list');
  const band = walk(screen.props.bandContent);
  assert.ok(textOf(screen.props.bandContent).includes('Merchants'));
  assert.match(textOf(byId(screen.props.bandContent, 'merchant-directory-line')), /· 2 merchants$/);
  const sort = band.find((n) => n.type === 'BandSegmented');
  assert.equal(sort.props.testID, 'merchant-sort');
  assert.deepEqual(Array.from(sort.props.segments, (s) => s.value), ['amount', 'visits'], 'New needs history before the period');
  // The period picker is a nav action with its old testID.
  screen.props.nav.actions.find((action) => action.testID === 'merchant-period').onPress();
  assert.deepEqual(events, [['state', true]]);
});

test('at the accessibility sizes the line and the sort move onto the sheet', () => {
  const { tree } = renderDirectory({ largeText: true });
  const screen = byId(tree, 'merchant-directory');
  assert.equal(byId(screen.props.bandContent, 'merchant-directory-line'), undefined);
  assert.ok(!walk(screen.props.bandContent).some((n) => n.type === 'BandSegmented'));
  const list = walk(screen.props.children).find((n) => n.type === 'FlatList');
  const header = walk(list.props.ListHeaderComponent);
  assert.ok(header.some((n) => n.props?.testID === 'merchant-directory-line'));
  assert.ok(header.some((n) => n.type === 'SegmentedControl'));
});

test('rows are ranked 1, 2… with the logo tile, "category · N payments" and the amount', () => {
  const { tree } = renderDirectory();
  const list = walk(byId(tree, 'merchant-directory').props.children).find((n) => n.type === 'FlatList');
  assert.deepEqual(Array.from(list.props.data, (row) => row.title), ['Carrefour', 'IKEA']);
  const row = list.props.renderItem({ item: list.props.data[0], index: 0 });
  const rendered = walk(row);
  assert.equal(rendered.find((n) => n.props?.testID === 'merchant-rank').props.children, '1');
  assert.ok(rendered.some((n) => n.type === 'Avatar' && n.props.title === 'Carrefour'), 'merchant logo tiles stay on every row');
  assert.ok(textOf(row).includes('Groceries · 2 payments'));
  assert.equal(rendered.find((n) => n.type === 'Money').props.fils, 143000);
  assert.equal(walk(byId(tree, 'merchant-directory-total')).find((n) => n.type === 'Money').props.fils, 207000);
});
