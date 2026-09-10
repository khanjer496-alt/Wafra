'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const financialFixture = require('./merchant-spending-fixture.cjs');
const { createHarness } = require('./reference-harness.cjs');
const root = path.resolve(__dirname, '../../..');
const jsx = (type, props = {}, key) => ({ type, props, key });
function walk(node) {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!node || typeof node !== 'object') return [];
  return [node, ...walk(node.props?.children), ...walk(node.props?.footer), ...walk(node.props?.ListHeaderComponent)];
}
function hooks() {
  let cursor = 0;
  const slots = [];
  function memo(fn, deps) {
    const i = cursor++, prior = slots[i];
    if (prior && deps && prior.deps?.length === deps.length && deps.every((x, j) => Object.is(x, prior.deps[j]))) return prior.value;
    const value = fn(); slots[i] = { value, deps }; return value;
  }
  return {
    begin() { cursor = 0; }, reset() { cursor = 0; slots.length = 0; },
    useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect() {}, useDeferredValue: value => value,
    useRef: value => memo(() => ({ current: value }), []),
    useState(initial) {
      const cell = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []);
      return [cell.value, next => { cell.value = typeof next === 'function' ? next(cell.value) : next; }];
    },
  };
}
const defaults = () => ({ type: null, accountId: null, categories: new Set(), datePreset: 'selected', dateFrom: null, dateTo: null, minFils: null, sort: 'newest' });
function filterProbe(language = 'en', options = {}) {
  const deps = financialFixture(), react = hooks(), events = [];
  const native = { View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', TextInput: 'TextInput',
    Platform: { OS: 'android' }, StyleSheet: { create: s => s, hairlineWidth: 1 } };
  Object.assign(deps, {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    '@react-native-community/datetimepicker': { __esModule: true, default: 'DateTimePicker' },
    '@/components/themed-text': { ThemedText: 'Text' }, '@/components/ui/icon': { Icon: 'Icon' },
    '@/components/ui/bottom-sheet': { BottomSheet: 'Sheet' },
    '@/components/ui/controls': { Button: 'Button', Chip: 'Chip' },
    '@/components/ui/category-chips': { CategoryChips: 'Categories' },
    '@/hooks/use-language': { useLanguage: () => language }, '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/constants/theme': { Radius: { sm: 4 }, Spacing: { one: 4, two: 8, three: 12 } },
  });
  const filters = load(path.join(root, 'src/lib/transaction-filter.ts'), deps);
  deps['@/lib/transaction-filter'] = filters;
  const rows = [
    { id: 'one', title: 'Cafe', type: 'expense', category: 'dining', amountFils: 1250, accountId: 'bank', date: '2026-09-07', source: 'sms' },
    { id: 'two', title: 'Salary', type: 'income', category: 'salary', amountFils: 77700, accountId: 'bank', date: '2026-09-06', source: 'manual' },
    { id: 'old', title: 'Cafe', type: 'expense', category: 'dining', amountFils: 2300, accountId: 'bank', date: '2026-08-03', source: 'sms' },
  ];
  const props = { initialFilters: defaults(), resetFilters: defaults(), accounts: [{ id: 'bank', name: 'Bank' }],
    hasUnassignedIncome: false, index: filters.createTransactionFilterIndex(rows, language),
    options: { query: '', merchant: null, smsOnly: false, currentKey: '2026-09', period: { mode: 'month', key: '2026-09' }, live: new Set(['bank']), internal: new Set(), ...options },
    onClose: () => events.push(['close']), onApply: (filters, resetScope) => events.push(['apply', filters, resetScope]) };
  const { TransactionFilterSheet } = load(path.join(root, 'src/components/transaction-filter-sheet.tsx'), deps);
  const render = () => { react.begin(); return TransactionFilterSheet(props); };
  const tr = key => deps['@/lib/i18n'].t(key, language);
  return { render, props, events, tr, react };
}
for (const language of ['en', 'ar']) {
  test(`${language}: filter draft applies once from a fixed footer and never mutates the original`, () => {
    const h = filterProbe(language);
    let tree = h.render();
    assert.equal(tree.type, 'Sheet');
    assert.ok(tree.props.footer);
    assert.equal(walk(tree.props.children).some(n => n.type === 'Button'), false);
    const income = walk(tree).find(n => n.type === 'Chip' && n.props.label === '+ ' + h.tr('incomeLabel'));
    income.props.onPress(); tree = h.render();
    assert.deepEqual(h.events, []);
    assert.equal(h.props.initialFilters.type, null);
    const apply = walk(tree.props.footer).find(n => n.type === 'Button' && n.props.variant !== 'outline');
    assert.equal(apply.props.disabled, false);
    assert.ok(apply.props.label.includes('1'), 'canonical projection counts one matching income');
    apply.props.onPress();
    assert.equal(h.events.length, 1); assert.equal(h.events[0][1].type, 'income'); assert.equal(h.events[0][2], false);
  });
  test(`${language}: Close discards drafts; Reset clears deep-link restrictions only after Apply`, () => {
    const h = filterProbe(language, { merchant: 'Cafe', smsOnly: true });
    let tree = h.render();
    walk(tree.props.footer).find(n => n.props.label === h.tr('reset')).props.onPress();
    tree = h.render(); assert.deepEqual(h.events, []);
    const apply = walk(tree.props.footer).find(n => n.type === 'Button' && n.props.variant !== 'outline');
    assert.ok(apply.props.label.includes('2'), 'reset preview includes manual income as well as the SMS purchase');
    tree.props.onClose(); assert.deepEqual(h.events, [['close']]);
    apply.props.onPress(); assert.equal(h.events[1][2], true);
    assert.equal(h.props.options.merchant, 'Cafe'); assert.equal(h.props.options.smsOnly, true);
  });
  test(`${language}: category draft owns a distinct Set and preserves selected filters`, () => {
    const h = filterProbe(language);
    let tree = h.render();
    walk(tree).find(n => n.type === 'Categories').props.onToggle('dining'); tree = h.render();
    assert.equal(h.props.initialFilters.categories.size, 0);
    const apply = walk(tree.props.footer).find(n => n.type === 'Button' && n.props.variant !== 'outline');
    apply.props.onPress(); assert.deepEqual([...h.events[0][1].categories], ['dining']);
  });
}
test('filter secondary controls are collapsed native subtrees until explicitly expanded', () => {
  const h = filterProbe(); const tree = h.render();
  const section = walk(tree).find(n => typeof n.type === 'function' && n.type.name === 'FilterSection');
  assert.ok(section);
  // Read the child from the actual compiled module with the same test hook
  // facade. Its JSX is opaque, so the initial child state has not been called.
  h.react.reset(); const first = section.type(section.props);
  const toggle = walk(first).find(n => n.type === 'Pressable');
  assert.equal(toggle.props.accessibilityState.expanded, false);
  assert.equal(walk(first).some(n => n.type === 'ScrollView'), false);
  toggle.props.onPress(); h.react.begin(); const expanded = section.type(section.props);
  assert.equal(walk(expanded).find(n => n.type === 'Pressable').props.accessibilityState.expanded, true);
  assert.equal(walk(expanded).some(n => n.type === 'ScrollView'), true);
});
test('typing and opening filters preserve the actual memoized SectionList element', () => {
  const h = createHarness(), react = hooks();
  Object.assign(h.deps.react, react);
  h.deps['react/jsx-runtime'] = { jsx, jsxs: jsx, Fragment: 'Fragment' };
  h.deps['react-native'].SectionList = 'SectionList'; h.deps['react-native'].Keyboard = { dismiss() {} };
  const insets = { contentContainerStyle: {}, contentInset: { top: 0, bottom: 0 }, scrollIndicatorInsets: { top: 0, bottom: 0 } };
  h.deps['@/components/ui/screen-scaffold'].useScreenContentInsets = () => insets;
  h.deps['@/lib/period'].periodRange = () => '';
  const Screen = load(path.join(root, 'src/app/transactions.tsx'), h.deps).default;
  const render = () => { react.begin(); return Screen(); };
  let tree = render(); const original = walk(tree).find(n => n.type === 'SectionList'); assert.ok(original);
  walk(tree).find(n => n.props?.inputMode === 'search').props.onChangeText('Cafe');
  tree = render(); assert.equal(walk(tree).find(n => n.type === 'SectionList'), original);
  walk(tree).find(n => n.props?.accessibilityLabel === h.deps['@/lib/i18n'].t('filtersButton')).props.onPress();
  tree = render(); assert.equal(walk(tree).find(n => n.type === 'SectionList'), original);
  const sheet = walk(tree).find(n => n.props?.initialFilters);
  assert.ok(sheet);
  sheet.props.onApply({ ...sheet.props.initialFilters, type: 'income' }, false);
  const updated = walk(render()).find(n => n.type === 'SectionList');
  assert.notEqual(updated, original, 'committing filters must still refresh the results');
  assert.ok(updated.props.sections.flatMap(section => section.data).every(row => row.type === 'income'));
});

test('entry reconciliation reuses unchanged inputs but refreshes after financial state changes', () => {
  const h = createHarness(), react = hooks();
  Object.assign(h.deps.react, react);
  h.deps['react/jsx-runtime'] = { jsx, jsxs: jsx, Fragment: 'Fragment' };
  const original = h.deps['@/lib/transfer-reconciliation'].reconcileTransfers;
  let calls = 0;
  h.deps['@/lib/transfer-reconciliation'].reconcileTransfers = (...args) => { calls++; return original(...args); };
  const render = () => { react.begin(); return h.renderDetail(); };
  render(); assert.equal(calls, 1);
  for (let i = 0; i < 20; i++) render();
  assert.equal(calls, 1, 'form/parent rerenders must not reconcile the complete ledger again');
  h.state.transactions = [...h.state.transactions]; render(); assert.equal(calls, 2);
  h.state.accounts = [...h.state.accounts]; render(); assert.equal(calls, 3);
});
