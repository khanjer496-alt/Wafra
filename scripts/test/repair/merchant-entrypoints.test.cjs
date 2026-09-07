'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

// Execute the real row; only navigation, presentation and OS primitives are
// substituted. This checks interaction contracts, not native frame timings.
function rowFixture({ language = 'en', large = false } = {}) {
  const events = [];
  const jsx = (type, props) => typeof type === 'function' ? type(props) : ({ type, props });
  const theme = { text: 'ink', income: 'income', backgroundSelected: 'selected' };
  const { TransactionRow } = load(path.resolve(__dirname, '../../../src/components/transaction-row.tsx'), {
    react: { memo: component => component }, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Pressable: 'Pressable', View: 'View', StyleSheet: { create: value => value } },
    'expo-router': { useRouter: () => ({ navigate: href => events.push(['merchant', href]) }) },
    '@/components/themed-text': { ThemedText: props => jsx('Text', props) },
    '@/components/ui/merchant-avatar': { MerchantAvatar: props => jsx('Avatar', props) },
    '@/hooks/use-language': { useLanguage: () => language },
    '@/hooks/use-large-text-layout': { useLargeTextLayout: () => large },
    '@/hooks/use-theme': { useTheme: () => theme },
    '@/lib/categories': { getCategory: id => id, categoryLabel: id => id },
    '@/lib/format': { clockTime: () => '12:30', formatAmount: minor => (minor / 100).toFixed(2) },
    '@/lib/markets': { ledgerCurrencyCode: () => 'AED' },
    '@/lib/i18n': { t: key => key },
    '@/lib/merchant-spending-copy': load(path.resolve(__dirname, '../../../src/lib/merchant-spending-copy.ts')),
  });
  const transaction = { id: 'fixture', title: 'Talabat', amountFils: 12345, type: 'expense',
    category: 'dining', accountId: 'card', date: '2026-09-07' };
  const render = (overrides = {}, props = {}) => TransactionRow({ transaction: { ...transaction, ...overrides },
    account: { id: 'card', name: 'Everyday card' }, onPress: tx => events.push(['transaction', tx.id]), ...props });
  return { render, events, theme };
}
function walk(node) {
  if (Array.isArray(node)) return node.flatMap(walk);
  return node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : [];
}
const byId = (tree, id) => walk(tree).find(node => node.props?.testID === id);

test('merchant identity and transaction amount have independent, non-nested actions', () => {
  const h = rowFixture(); const tree = h.render();
  assert.deepEqual(h.events, [], 'rendering must not navigate or edit');
  const merchant = byId(tree, 'transaction-merchant-link');
  const details = byId(tree, 'transaction-details-link');
  assert.ok(merchant); assert.ok(details);
  assert.equal(walk(merchant.props.children).filter(n => n.type === 'Pressable').length, 0);
  assert.equal(walk(details.props.children).filter(n => n.type === 'Pressable').length, 0);
  assert.match(merchant.props.accessibilityLabel, /Talabat/);
  assert.match(details.props.accessibilityLabel, /Talabat.*Everyday card.*123\.45 AED/);
  merchant.props.onPress(); details.props.onPress();
  assert.deepEqual(h.events, [['merchant', '/merchant?name=Talabat'], ['transaction', 'fixture']]);
});
test('merchant URL preserves Arabic, punctuation and reserved query characters', () => {
  for (const name of ['مطعم عربي', 'R&D / Cafe? #2 + 20%', ' Talabat Business ']) {
    const h = rowFixture(); byId(h.render({ title: name }), 'transaction-merchant-link').props.onPress();
    const url = new URL(h.events[0][1], 'https://example.test');
    assert.equal(url.pathname, '/merchant'); assert.equal(url.searchParams.get('name'), name.trim());
    assert.equal([...url.searchParams].length, 1);
  }
});
test('transfers never masquerade as merchant-spending links', () => {
  for (const [overrides, props] of [[{ isTransfer: true }, {}], [{ type: 'income' }, { internal: true }]]) {
    const h = rowFixture(); const tree = h.render(overrides, props);
    assert.equal(byId(tree, 'transaction-merchant-link'), undefined);
    tree.props.onPress(); assert.deepEqual(h.events, [['transaction', 'fixture']]);
  }
});
test('merchant previews can disable their own merchant link without losing transaction details', () => {
  const h = rowFixture(); const tree = h.render({}, { merchantLinks: false });
  assert.equal(byId(tree, 'transaction-merchant-link'), undefined);
  tree.props.onPress(); assert.deepEqual(h.events, [['transaction', 'fixture']]);
});
test('non-interactive rows remain non-interactive', () => {
  const h = rowFixture(); const tree = h.render({}, { onPress: undefined });
  assert.equal(tree.props.onPress, undefined);
  assert.equal(byId(tree, 'transaction-merchant-link'), undefined);
});
test('Arabic and large text preserve both minimum-size touch targets and exact money', () => {
  const h = rowFixture({ language: 'ar', large: true }); const tree = h.render();
  const merchant = byId(tree, 'transaction-merchant-link'); const details = byId(tree, 'transaction-details-link');
  assert.match(merchant.props.accessibilityLabel, /عرض تفاصيل التاجر/);
  for (const target of [merchant, details]) {
    assert.equal(target.props.accessibilityRole, 'button');
    assert.equal(target.props.style({ pressed: false })[0].minHeight, 48);
  }
  assert.ok(walk(tree).filter(n => n.type === 'Text').every(n => n.props.numberOfLines === undefined));
  assert.equal(tree.props.style[2].flexDirection, 'column');
});
