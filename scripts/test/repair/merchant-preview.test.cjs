'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const financialFixture = require('./merchant-spending-fixture.cjs');
const root = path.resolve(__dirname, '../../..');

function renderMerchant({ name = 'Cedar & Cafe', type, language = 'en', hydrated = true, count = 20,
  transactions, accounts, period = { mode: 'month', key: '2026-09' } } = {}) {
  const events = [];
  let params = { name, type }; let activeKey; let hookIndex = 0; let hooks = [];
  // Model React's keyed route-child lifetime so changing direction for the
  // same recorded name cannot retain the previous page's selected list.
  const jsx = (componentType, props, key) => {
    if (typeof componentType !== 'function') return { type: componentType, props, key };
    if (componentType.name === 'MerchantScreen') {
      if (activeKey !== key) hooks = [];
      activeKey = key; hookIndex = 0;
    }
    return componentType(props);
  };
  const component = type => props => jsx(type, props);
  const modules = financialFixture();
  const state = { hydrated, monthStartDay: 1, accounts: accounts ?? [{ id: 'bank', name: 'Everyday account' }],
    transactions: transactions ?? Array.from({ length: count }, (_, i) => ({ id: `purchase-${i}`, title: name, type: 'expense',
      amountFils: 101, category: 'dining', accountId: 'bank', date: '2026-09-07', ts: i })) };
  const deps = {
    ...modules,
    react: { useMemo: fn => fn(), useCallback: fn => fn,
      useState: value => {
        const index = hookIndex++;
        if (!(index in hooks)) hooks[index] = typeof value === 'function' ? value() : value;
        return [hooks[index], next => { hooks[index] = next; events.push(['state', next]); }];
      } },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { Platform: { OS: 'android' }, useWindowDimensions: () => ({ width: 390, fontScale: 1 }),
      View: 'View', StyleSheet: { create: s => s, hairlineWidth: 1 } },
    'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({
      push: href => events.push(['route', href]), back: () => events.push(['back']),
      replace: href => events.push(['replace', href]), canGoBack: () => true }) },
    '@/components/themed-text': { ThemedText: component('Text') },
    '@/components/entry-detail-sheet': { EntryDetailSheet: component('EntryDetailSheet') },
    '@/components/period-sheet': { PeriodSheet: component('PeriodSheet') },
    '@/components/transaction-row': { TransactionRow: component('TransactionRow') },
    '@/components/merchant-month-bars': { MerchantMonthBars: component('MerchantMonthBars') },
    '@/components/merchant-category-rule': { MerchantCategoryRule: component('MerchantCategoryRule') },
    // Design language E: the clay band's pieces are boundaries here; the
    // scaffold hands over its nav, band content and sheet as props.
    '@/components/ui/band-scaffold': { BandScaffold: component('BandScaffold') },
    '@/components/ui/band/band-figure': { BandFigure: component('BandFigure') },
    '@/components/ui/band/e-button': { EButton: component('EButton') },
    '@/components/ui/band/stat-tile': { StatTile: component('StatTile'),
      statTileColors: () => ({ bg: 'tile', fg: 'onBand', fgSecondary: 'onBandSecondary' }) },
    '@/components/ui/merchant-avatar': { MerchantAvatar: component('Avatar') },
    '@/components/ui/money': { Money: component('Money') },
    '@/components/ui/states': { SkeletonRows: component('SkeletonRows') },
    '@/components/ui/segmented-control': { SegmentedControl: component('SegmentedControl') },
    '@/constants/theme': { Fonts: {} },
    '@/hooks/use-band': { useBand: () => ({ band: 'clay', onBand: 'cream', onBandSecondary: 'cream2', text: 'ink',
      textSecondary: 'ink2', card: 'card', rule: 'rule', tint: 'clay' }) },
    '@/hooks/use-language': { useLanguage: () => language },
    '@/hooks/use-large-text-layout': { useLargeTextLayout: () => false },
    '@/lib/assistant-copy': load(path.join(root, 'src/lib/assistant-copy.ts')),
    '@/lib/everyday-band-copy': load(path.join(root, 'src/lib/everyday-band-copy.ts')),
    '@/lib/merchant-spending-copy': load(path.join(root, 'src/lib/merchant-spending-copy.ts')),
    '@/lib/period-context': { usePeriod: () => ({ period,
      setPeriod: p => events.push(['period', p]) }) },
    '@/lib/store': { useStore: () => ({ state }) },
  };
  const { default: MerchantRoute } = load(path.join(root, 'src/app/merchant.tsx'), deps);
  let tree = MerchantRoute();
  return { get tree() { return tree; }, get componentKey() { return activeKey; }, events, state,
    rerender: (nextParams = {}) => { params = { ...params, ...nextParams }; tree = MerchantRoute(); return tree; } };
}
function walk(node) {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!node || typeof node !== 'object') return [];
  return [node, ...walk(node.props?.children), ...walk(node.props?.bandContent)];
}
const byId = (tree, id) => walk(tree).find(n => n.props?.testID === id);
/** The recent rows the sheet shows, and the transactions their rows render. */
const recentRows = tree => walk(tree).filter(n => n.props?.testID === 'merchant-recent-row');
const recentIds = tree => recentRows(tree).map(row => walk(row).find(n => n.type === 'TransactionRow').props.transaction.id);

test('the merchant preview is bounded while its headline and purchase count cover the full period', () => {
  const h = renderMerchant();
  assert.equal(recentRows(h.tree).length, 6);
  assert.equal(recentIds(h.tree)[0], 'purchase-19');
  assert.equal(byId(h.tree, 'merchant-total-spent').props.fils, 2020);
  assert.equal(byId(h.tree, 'merchant-purchase-count').props.children, 20);
  assert.equal(walk(recentRows(h.tree)[0]).find(n => n.type === 'TransactionRow').props.merchantLinks, false);
  assert.deepEqual(h.events, []);
});

test('design language E: the clay band carries logo, name, total, count and month bars; the sheet the rest', () => {
  const h = renderMerchant();
  const screen = byId(h.tree, 'merchant-detail');
  assert.equal(screen.type, 'BandScaffold');
  assert.equal(screen.props.band, 'spending', 'a Spending detail wears the clay band');
  const band = walk(screen.props.bandContent);
  assert.ok(band.some(n => n.type === 'Avatar' && n.props.size === 56), 'the logo tile leads the band');
  assert.ok(band.some(n => n.props?.testID === 'merchant-total-spent'));
  assert.ok(band.some(n => n.props?.testID === 'merchant-purchase-count'));
  assert.ok(band.some(n => n.type === 'MerchantMonthBars' && n.props.palette), 'month bars sit on the band');
  assert.ok(band.some(n => n.type === 'StatTile'), 'count and average are band-tone tiles');
  const sheet = walk(screen.props.children);
  assert.ok(sheet.some(n => n.type === 'MerchantCategoryRule' && n.props.palette), 'the Always <category> rule is on the sheet');
  assert.ok(!band.some(n => n.type === 'MerchantCategoryRule'));
  // Every row shares Dining, so the band names it; the period action keeps its testID.
  assert.ok(band.some(n => n.type === 'Text' && n.props.children === 'Dining'));
  const period = screen.props.nav.actions.find(action => action.testID === 'merchant-period');
  period.onPress();
  assert.deepEqual(h.events, [['state', true]]);
});

test('a merchant whose rows differ in category names none on the band', () => {
  const h = renderMerchant({ transactions: [
    { id: 'a', title: 'Cedar & Cafe', type: 'expense', amountFils: 100, category: 'dining', accountId: 'bank', date: '2026-09-07' },
    { id: 'b', title: 'Cedar & Cafe', type: 'expense', amountFils: 100, category: 'groceries', accountId: 'bank', date: '2026-09-08' },
  ] });
  const band = walk(byId(h.tree, 'merchant-detail').props.bandContent);
  assert.ok(!band.some(n => n.type === 'Text' && (n.props.children === 'Dining' || n.props.children === 'Groceries')));
});
for (const language of ['en', 'ar']) test(`${language}: View all hands the exact merchant to Activity without replacing the period`, () => {
  const name = 'Cedar & Cafe / فرع? #2 +20%';
  const h = renderMerchant({ name, language });
  const action = walk(byId(h.tree, 'merchant-view-all-transactions')).find(n => n.type === 'EButton');
  assert.equal(action.props.label, language === 'ar' ? 'عرض كل الحركات' : 'View all transactions');
  action.props.onPress(); assert.equal(h.events.length, 1);
  const url = new URL(h.events[0][1], 'https://example.test');
  assert.equal(url.pathname, '/transactions'); assert.equal(url.searchParams.get('merchant'), name);
  assert.equal(url.searchParams.get('type'), 'all', 'explicit all-type scope prevents the legacy merchant spending default');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['merchant', 'type'], 'neither income nor expenses must be silently filtered away');
});
test('an unhydrated merchant page shows loading instead of a misleading zero', () => {
  const h = renderMerchant({ hydrated: false });
  assert.ok(walk(h.tree).some(n => n.type === 'SkeletonRows'));
  assert.equal(byId(h.tree, 'merchant-total-spent'), undefined);
  assert.equal(byId(h.tree, 'merchant-view-all-transactions'), undefined);
});
test('a blank merchant never produces an unfiltered View all transaction handoff', () => {
  assert.equal(byId(renderMerchant({ name: '' }).tree, 'merchant-view-all-transactions'), undefined);
});

const receipt = (id, amountFils, extra = {}) => ({ id, title: 'Talabat sales', type: 'income',
  amountFils, category: 'business', accountId: 'bank', date: '2026-09-07', ...extra });
const segmentIn = tree => walk(tree).find(node => node.type === 'SegmentedControl');
const stringsIn = tree => walk(tree).filter(node => node.type === 'Text').map(node => node.props.children).flat(Infinity).join(' ');
const actionIn = tree => walk(byId(tree, 'merchant-view-all-transactions')).find(node => node.type === 'EButton');

for (const language of ['en', 'ar']) test(`${language}: the reported income-only screen leads with the received total and payment count`, () => {
  const h = renderMerchant({ name: 'Talabat sales', type: 'income', language, period: { mode: 'all' },
    transactions: [receipt('sales', 101188997)] });
  const screen = byId(h.tree, 'merchant-detail');
  assert.equal(screen.props.nav.title, language === 'ar' ? 'حركات الدخل' : 'Income activity');
  const hero = byId(h.tree, 'merchant-total-received');
  assert.ok(hero.props.label.startsWith(language === 'ar' ? 'إجمالي المبالغ المستلمة' : 'Total received'));
  assert.equal(hero.props.fils, 101188997);
  assert.equal(byId(h.tree, 'merchant-income-count').props.children, 1);
  assert.equal(byId(h.tree, 'merchant-total-spent'), undefined, 'the income screen must not lead with AED 0 spending');
  assert.equal(byId(h.tree, 'merchant-purchase-count'), undefined);
  assert.equal(byId(h.tree, 'merchant-money-received'), undefined, 'income is the headline, not a duplicate secondary total');
  const segment = segmentIn(h.tree);
  assert.equal(segment.props.value, 'received');
  assert.equal(segment.props.segments[0].label, language === 'ar' ? 'الدخل' : 'Income');
  assert.deepEqual(recentIds(h.tree), ['sales']);
  assert.equal(actionIn(h.tree).props.label, language === 'ar' ? 'عرض كل الدخل' : 'View all income');
  actionIn(h.tree).props.onPress();
  assert.deepEqual(h.events, [['route', '/transactions?type=income&merchant=Talabat%20sales']]);
});

test('mixed source income preview, count, average and footer all use exact name, period and eligible income', () => {
  const transactions = [
    ...Array.from({ length: 8 }, (_, i) => receipt(`receipt-${i}`, 101, { ts: i })),
    receipt('expense', 9000, { type: 'expense', originalCurrency: 'USD' }),
    receipt('similar-name', 999999, { title: 'Talabat sales business' }),
    receipt('old-income', 999999, { date: '2026-08-31' }),
    receipt('hidden-income', 999999, { accountId: 'hidden' }),
    receipt('unknown-income', 999999, { accountId: 'missing' }),
    receipt('transfer-income', 999999, { isTransfer: true }),
  ];
  const h = renderMerchant({ name: 'Talabat sales', type: 'income', transactions,
    accounts: [{ id: 'bank' }, { id: 'hidden', archived: true }] });
  assert.equal(byId(h.tree, 'merchant-total-received').props.fils, 808);
  assert.equal(byId(h.tree, 'merchant-income-count').props.children, 8);
  assert.ok(walk(h.tree).some(n => n.type === 'BandFigure' && n.props.size === 'medium' && n.props.fils === 101), 'the average tile');
  assert.deepEqual(recentIds(h.tree), ['receipt-7', 'receipt-6', 'receipt-5', 'receipt-4', 'receipt-3', 'receipt-2']);
  assert.equal(walk(h.tree).find(n => n.props?.accessibilityLiveRegion === 'polite').props.children.join(''), '6 / 8',
    'the preview states how many of the eight counted payments are actually shown');
  assert.equal(walk(recentRows(h.tree)[0]).find(n => n.type === 'TransactionRow').props.merchantLinks, false);
  assert.equal(stringsIn(h.tree).includes('Uses the converted amounts'), false, 'a foreign purchase does not make the income total converted');
  actionIn(h.tree).props.onPress();
  assert.equal(new URL(h.events[0][1], 'https://example.test').searchParams.get('type'), 'income');
  segmentIn(h.tree).props.onChange('all'); h.rerender();
  assert.equal(segmentIn(h.tree).props.value, 'all');
  assert.equal(actionIn(h.tree).props.label, 'View all transactions');
  actionIn(h.tree).props.onPress();
  assert.equal(new URL(h.events.at(-1)[1], 'https://example.test').searchParams.get('type'), 'all');
  assert.equal(byId(h.tree, 'merchant-total-received').props.fils, 808,
    'showing all activity cannot silently net expenses from income');
});

test('same source switching from income to expenses remounts the default list and keeps each headline correct', () => {
  const h = renderMerchant({ name: 'Talabat sales', type: 'income', transactions: [
    receipt('income', 5000), receipt('expense', 1200, { type: 'expense' }),
  ] });
  const incomingKey = h.componentKey;
  segmentIn(h.tree).props.onChange('all'); h.rerender();
  assert.equal(h.componentKey, incomingKey, 'changing a tab must keep the route lifetime');
  h.rerender({ type: 'expense' });
  assert.notEqual(h.componentKey, incomingKey, 'same-name direction changes need a new route-child state');
  assert.equal(segmentIn(h.tree).props.value, 'spending');
  assert.deepEqual(recentIds(h.tree), ['expense']);
  assert.equal(byId(h.tree, 'merchant-total-spent').props.fils, 1200);
  assert.equal(byId(h.tree, 'merchant-purchase-count').props.children, 1);
  h.rerender({ type: 'income' });
  assert.equal(segmentIn(h.tree).props.value, 'received');
  assert.deepEqual(recentIds(h.tree), ['income']);
  assert.equal(byId(h.tree, 'merchant-total-received').props.fils, 5000);
});

for (const language of ['en', 'ar']) test(`${language}: income loading and empty states do not claim zero spending`, () => {
  const loading = renderMerchant({ name: 'Talabat sales', type: 'income', language, hydrated: false });
  assert.ok(walk(loading.tree).some(node => node.type === 'SkeletonRows'));
  assert.equal(byId(loading.tree, 'merchant-total-received'), undefined);
  assert.equal(byId(loading.tree, 'merchant-total-spent'), undefined);
  const h = renderMerchant({ name: 'Talabat sales', type: 'income', language, transactions: [] });
  assert.equal(recentRows(h.tree).length, 0);
  assert.ok(stringsIn(byId(h.tree, 'merchant-recent-empty')).includes(
language === 'ar' ? 'لا يوجد دخل في هذه الفترة' : 'No income in this period'));
});
