'use strict';
// Foreign activity in design language E: the clay band's figure and currency
// tiles, the per-row rate source on the sheet, and the large-text layout.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const financialFixture = require('./merchant-spending-fixture.cjs');
const root = path.resolve(__dirname, '../../..');

function renderCurrency({ largeText = false, language = 'en', states = {} } = {}) {
  const events = [];
  let hook = 0;
  const jsx = (type, props, key) => typeof type === 'function' && !type.boundary ? type(props) : { type: type.boundary ?? type, props, key };
  const boundary = (name) => Object.assign(() => null, { boundary: name });
  const modules = financialFixture();
  const fx = require('../build/fx.js');
  const tx = (id, currency, minor, amountFils, fxSource, date = '2026-09-0' + (id.length + 1)) => ({ id, title: `Shop ${id}`, type: 'expense',
    amountFils, category: 'shopping', accountId: 'bank', date, originalCurrency: currency, originalAmountMinor: minor, fxSource });
  const state = { hydrated: true, monthStartDay: 1, accounts: [{ id: 'bank', name: 'Everyday', bankName: 'First Bank' }],
    ledgerMoney: { currency: 'AED', exponent: 2 },
    transactions: [tx('a', 'EUR', 8900, 35920, 'bank'), tx('bb', 'USD', 5800, 21300, 'reference'), tx('ccc', 'EUR', 1000, 4000, 'fallback')] };
  const palette = { band: 'clay', onBand: 'cream', onBandSecondary: 'cream2', tile: 'tile', selected: 'pill', onSelected: 'clayText',
    text: 'ink', textSecondary: 'ink2', card: 'card', rule: 'rule', tint: 'clayTint', glyphGround: 'ground' };
  const fxSummary = load(path.join(root, 'src/lib/fx-summary.ts'), { '@/lib/fx': fx, '@/lib/markets': modules['@/lib/markets'] });
  const deps = {
    ...modules,
    react: { useMemo: (fn) => fn(), useCallback: (fn) => fn, useDeferredValue: (v) => v,
      useState: (value) => { const index = hook++; return [Object.hasOwn(states, index) ? states[index] : typeof value === 'function' ? value() : value,
        (next) => events.push(['state', index, typeof next === 'function' ? next(null) : next])]; } },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { FlatList: boundary('FlatList'), ScrollView: boundary('ScrollView'), Platform: { OS: 'android' },
      Pressable: 'Pressable', View: 'View', StyleSheet: { create: (s) => s, hairlineWidth: 1 } },
    '@/components/entry-detail-sheet': { EntryDetailSheet: boundary('EntryDetailSheet') },
    '@/components/ledger-currency-sheet': { LedgerCurrencySheet: boundary('LedgerCurrencySheet') },
    '@/components/period-sheet': { PeriodSheet: boundary('PeriodSheet') },
    '@/components/themed-text': { ThemedText: boundary('Text') },
    '@/components/ui/band-scaffold': { BandScaffold: boundary('BandScaffold'), useBandBottomInset: () => 10, BAND_GUTTER: 20 },
    '@/components/ui/band/band-figure': { BandFigure: boundary('BandFigure') },
    '@/components/ui/band/stat-tile': { statTileColors: () => ({ bg: 'tile', fg: 'cream', fgSecondary: 'cream2' }) },
    '@/components/ui/icon': { Icon: boundary('Icon') },
    '@/components/ui/merchant-avatar': { MerchantAvatar: boundary('Avatar') },
    '@/components/ui/section-header': { SectionHeader: boundary('SectionHeader') },
    '@/components/ui/text-field': { TextField: boundary('TextField') },
    '@/constants/theme': { Fonts: {}, Radius: { full: 999 }, Spacing: { one: 4, two: 8, three: 12, four: 16, five: 24 } },
    '@/hooks/use-band': { useBand: () => palette },
    '@/hooks/use-language': { useLanguage: () => language },
    '@/hooks/use-large-text-layout': { useLargeTextLayout: () => largeText },
    '@/lib/details-copy': load(path.join(root, 'src/lib/details-copy.ts')),
    '@/lib/everyday-band-copy': load(path.join(root, 'src/lib/everyday-band-copy.ts')),
    '@/lib/fx': fx,
    '@/lib/fx-summary': fxSummary,
    '@/lib/period-context': { usePeriod: () => ({ period: { mode: 'month', key: '2026-09' } }) },
    '@/lib/spending-details-copy': load(path.join(root, 'src/lib/spending-details-copy.ts')),
    '@/lib/store': { useStore: () => ({ state, setLedgerMoney: () => {} }) },
  };
  const { default: CurrencyScreen } = load(path.join(root, 'src/app/currency.tsx'), deps);
  return { tree: CurrencyScreen(), events, palette };
}
function walk(node) {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!node || typeof node !== 'object') return [];
  return [node, ...walk(node.props?.children), ...walk(node.props?.bandContent),
    ...walk(node.props?.ListHeaderComponent), ...walk(node.props?.ListFooterComponent)];
}
const byId = (tree, id) => walk(tree).find((n) => n.props?.testID === id);
const textOf = (node) => walk(node).filter((n) => n.type === 'Text').map((n) => [n.props.children].flat(Infinity).join('')).join(' ');

test('the clay band carries the converted total and one tile per currency, largest first', () => {
  const { tree, events } = renderCurrency();
  const screen = byId(tree, 'currency-screen');
  assert.equal(screen.type, 'BandScaffold');
  assert.equal(screen.props.band, 'spending');
  assert.equal(screen.props.scroll, false, 'the sheet owns the virtualized list');
  const figure = byId(screen.props.bandContent, 'currency-total');
  assert.equal(figure.props.fils, 61220);
  assert.equal(figure.props.qualifier, '3 payments · 2 currencies');
  const tiles = walk(screen.props.bandContent).filter((n) => /^currency-tile-/.test(n.props?.testID ?? ''));
  assert.deepEqual(tiles.map((n) => n.props.testID), ['currency-tile-EUR', 'currency-tile-USD']);
  assert.equal(tiles[0].props.accessibilityState.selected, false);
  assert.match(tiles[0].props.accessibilityLabel, /^EUR\. .*65%\. 2 payments$/);
  tiles[0].props.onPress();
  assert.ok(events.some(([kind, , value]) => kind === 'state' && value === 'EUR'), 'a tile filters the list to its currency');
  // The period picker is a nav action.
  assert.ok(screen.props.nav.actions.some((action) => action.testID === 'currency-period'));
  // At the default sizes the currency rows are the tiles: no second copy on the sheet.
  assert.equal(walk(screen.props.children).filter((n) => /^currency-row-/.test(n.props?.testID ?? '')).length, 0);
});

test('each charge names its original amount and how it was converted', () => {
  const { tree } = renderCurrency();
  const list = walk(byId(tree, 'currency-screen').props.children).find((n) => n.type === 'FlatList');
  const rows = Array.from(list.props.data, (item, index) => list.props.renderItem({ item, index }));
  const lines = rows.map((row) => textOf(row));
  assert.ok(lines.some((line) => line.includes('bank’s rate')));
  assert.ok(lines.some((line) => line.includes('reference rate for that date')));
  assert.ok(lines.some((line) => line.includes('approximate rate for now')), 'a fallback rate is never presented as exact');
  assert.ok(rows.every((row) => /rate/.test(row.props.accessibilityLabel)));
  // The ledger-currency row and the qualified rate-source footer close the sheet.
  assert.ok(byId(list.props.ListFooterComponent, 'currency-ledger-row'));
  assert.ok(byId(list.props.ListFooterComponent, 'currency-fx-footer'));
});

test('a selected currency shows as selected on its tile and as a clearable filter on the sheet', () => {
  // useState order: currency sheet, period, entry, query, selected currency, show all.
  const { tree } = renderCurrency({ states: { 4: 'EUR' } });
  const screen = byId(tree, 'currency-screen');
  assert.equal(byId(screen.props.bandContent, 'currency-tile-EUR').props.accessibilityState.selected, true);
  const list = walk(screen.props.children).find((n) => n.type === 'FlatList');
  assert.deepEqual(Array.from(list.props.data, (tx) => tx.id), ['a', 'ccc'], 'only the EUR charges');
  assert.ok(byId(list.props.ListHeaderComponent, 'currency-filter'));
});

test('at the accessibility sizes the figure and currencies move onto the sheet as rows', () => {
  const { tree } = renderCurrency({ largeText: true });
  const screen = byId(tree, 'currency-screen');
  assert.equal(screen.props.bandContent, undefined, 'the band keeps only its nav row');
  const header = walk(screen.props.children).find((n) => n.type === 'FlatList').props.ListHeaderComponent;
  assert.ok(byId(header, 'currency-total'));
  assert.equal(byId(header, 'currency-total').props.color, 'ink', 'on the sheet the figure takes the sheet text colour');
  assert.ok(byId(header, 'currency-row-EUR') && byId(header, 'currency-row-USD'));
});
