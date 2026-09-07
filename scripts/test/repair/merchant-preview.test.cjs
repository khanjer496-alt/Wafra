'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const financialFixture = require('./merchant-spending-fixture.cjs');
const root = path.resolve(__dirname, '../../..');

function renderMerchant({ name = 'Cedar & Cafe', language = 'en', hydrated = true, count = 20 } = {}) {
  const events = [];
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
  const component = type => props => jsx(type, props);
  const modules = financialFixture();
  const state = { hydrated, monthStartDay: 1, accounts: [{ id: 'bank', name: 'Everyday account' }],
    transactions: Array.from({ length: count }, (_, i) => ({ id: `purchase-${i}`, title: name, type: 'expense',
      amountFils: 101, category: 'dining', accountId: 'bank', date: '2026-09-07', ts: i })) };
  const deps = {
    ...modules,
    react: { useMemo: fn => fn(), useCallback: fn => fn,
      useState: value => [value, next => events.push(['state', next])] },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { FlatList: component('FlatList'), Platform: { OS: 'android' },
      View: 'View', StyleSheet: { create: s => s, hairlineWidth: 1 } },
    'expo-router': { useLocalSearchParams: () => ({ name }), useRouter: () => ({
      push: href => events.push(['route', href]), back: () => events.push(['back']),
      replace: href => events.push(['replace', href]), canGoBack: () => true }) },
    '@/components/themed-text': { ThemedText: component('Text') },
    '@/components/entry-detail-sheet': { EntryDetailSheet: component('EntryDetailSheet') },
    '@/components/period-sheet': { PeriodSheet: component('PeriodSheet') },
    '@/components/transaction-row': { TransactionRow: component('TransactionRow') },
    '@/components/ui/controls': { Button: component('Button') },
    '@/components/ui/merchant-avatar': { MerchantAvatar: component('Avatar') },
    '@/components/ui/money': { Money: component('Money') },
    '@/components/ui/states': { SkeletonRows: component('SkeletonRows') },
    '@/components/ui/segmented-control': { SegmentedControl: component('SegmentedControl') },
    '@/components/ui/screen-scaffold': { ScreenScaffold: component('ScreenScaffold'), useScreenContentInsets: () => ({}) },
    '@/hooks/use-language': { useLanguage: () => language },
    '@/hooks/use-large-text-layout': { useLargeTextLayout: () => false },
    '@/hooks/use-theme': { useTheme: () => ({ cardBorder: 'rule', income: 'income' }) },
    '@/lib/merchant-spending-copy': load(path.join(root, 'src/lib/merchant-spending-copy.ts')),
    '@/lib/period-context': { usePeriod: () => ({ period: { mode: 'month', key: '2026-09' },
      setPeriod: p => events.push(['period', p]) }) },
    '@/lib/store': { useStore: () => ({ state }) },
  };
  const { default: MerchantRoute } = load(path.join(root, 'src/app/merchant.tsx'), deps);
  const tree = MerchantRoute();
  return { tree, events, state };
}
function walk(node) {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!node || typeof node !== 'object') return [];
  return [node, ...walk(node.props?.children), ...walk(node.props?.ListHeaderComponent), ...walk(node.props?.ListFooterComponent)];
}
const byId = (tree, id) => walk(tree).find(n => n.props?.testID === id);

test('the merchant preview is bounded while its headline and purchase count cover the full period', () => {
  const h = renderMerchant(); const list = walk(h.tree).find(n => n.type === 'FlatList');
  assert.equal(list.props.data.length, 6);
  assert.equal(list.props.data[0].id, 'purchase-19');
  const total = byId(h.tree, 'merchant-total-spent');
  assert.equal(walk(total).find(n => n.type === 'Money').props.fils, 2020);
  assert.equal(byId(h.tree, 'merchant-purchase-count').props.children, 20);
  const row = list.props.renderItem({ item: list.props.data[0] });
  assert.equal(walk(row).find(n => n.type === 'TransactionRow').props.merchantLinks, false);
  assert.deepEqual(h.events, []);
});
for (const language of ['en', 'ar']) test(`${language}: View all hands the exact merchant to Activity without replacing the period`, () => {
  const name = 'Cedar & Cafe / فرع? #2 +20%';
  const h = renderMerchant({ name, language });
  const action = walk(byId(h.tree, 'merchant-view-all-transactions')).find(n => n.type === 'Button');
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
