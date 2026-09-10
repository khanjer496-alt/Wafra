'use strict';
// Executes production components with explicit native/service substitutes.
// These assertions are not screenshots or physical keyboard verification.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { createHarness, walk, text } = require('./reference-harness.cjs');
const root = path.resolve(__dirname, '../../..');
const flatten = value => Object.assign({}, ...[value].flat(Infinity).filter(Boolean));
const style = node => flatten(typeof node.props.style === 'function' ? node.props.style({ pressed: false }) : node.props.style);
const labelled = (node, label) => walk(node).find(n => n.props?.accessibilityLabel === label && n.props?.onPress);
function transactions(options = {}) {
  const h = createHarness(options);
  h.deps['react-native'].Keyboard = { dismiss: () => h.events.push(['keyboard-dismiss']) };
  h.deps['react-native'].SectionList = p => h.jsx('SectionList', { ...p, children: p.ListHeaderComponent });
  h.deps['@react-native-community/datetimepicker'] = { __esModule: true, default: 'DateTimePicker' };
  h.deps['@/lib/period'].periodRange = () => '';
  const tree = h.local('@/app/transactions').default();
  return { ...h, tree, list: walk(tree).find(n => n.type === 'SectionList') };
}
for (const language of ['en', 'ar']) {
  for (const largeText of [false, true]) {
    test(`${language}/${largeText}: search keeps short visible copy and full accessible instructions`, () => {
      const h = transactions({ language, largeText });
      const t = h.deps['@/lib/i18n'].t;
      const input = walk(h.tree).find(n => n.type === 'TextInput' && n.props.inputMode === 'search');
      assert.ok(input);
      assert.equal(input.props.accessibilityLabel, t('searchMerchants'));
      assert.equal(input.props.placeholder, t('transactionSearchPlaceholder'));
      assert.notEqual(input.props.placeholder, t('searchMerchants'));
      assert.ok(text(h.tree).includes(t('transactionSearchLabel')));
      input.props.onChangeText('Noon');
      assert.ok(h.events.some(e => e[0] === 'state' && e[2] === 'Noon'));
      input.props.onSubmitEditing();
      assert.ok(h.events.some(e => e[0] === 'keyboard-dismiss'));
    });
    test(`${language}/${largeText}: summary has its own net line and exclusion line`, () => {
      const h = transactions({ language, largeText });
      const summary = walk(h.tree).find(n => n.props?.testID === 'transactions-summary');
      const net = walk(summary).find(n => n.props?.testID === 'transactions-net-total');
      assert.ok(summary && net);
      assert.equal(style(summary).flexDirection, 'column');
      assert.equal(style(summary).alignItems, 'stretch');
      assert.ok(text(net).includes(h.deps['@/lib/i18n'].t('transactionNetTotal')));
      assert.equal(style(net).flexDirection, largeText ? 'column' : 'row');
      assert.equal(walk(net).some(n => n.props?.numberOfLines), false);
      const header = h.list.props.renderSectionHeader({ section: h.list.props.sections[0] });
      assert.equal(style(header).flexDirection, largeText ? 'column' : 'row');
    });
    test(`${language}/${largeText}: details pin edit/delete outside the scrolling content`, () => {
      const h = createHarness({ language, largeText });
      const tree = h.renderDetail();
      const t = h.deps['@/lib/i18n'].t;
      assert.equal(tree.props.testID, 'entry-detail-sheet');
      assert.ok(tree.props.footer);
      assert.equal(style(tree.props.footer).flexDirection, largeText ? 'column' : 'row');
      assert.ok(labelled(tree.props.footer, t('editEntry')));
      assert.ok(labelled(tree.props.footer, t('delete')));
      assert.equal(labelled(tree.props.children, t('delete')), undefined);
      for (const button of walk(tree.props.footer).filter(n => n.props?.accessibilityRole === 'button')) {
        assert.ok(style(button).minHeight >= 44);
        assert.equal(walk(button).some(n => n.props?.numberOfLines === 1), false);
      }
      labelled(tree.props.footer, t('delete')).props.onPress();
      assert.ok(h.events.some(e => e[0] === 'state' && e[1] === 7 && e[2] === true));
      assert.equal(h.events.some(e => e[0] === 'deleteTransaction'), false);
    });
    test(`${language}/${largeText}: edit mode pins save/cancel and preserves exact amount`, () => {
      const h = createHarness({ language, largeText, states: {
        0: true, 1: 'Fixture groceries', 2: '12.50', 3: 'shopping', 4: 'enbd', 5: '2026-09-06', 6: false,
      } });
      const tx = { ...h.state.transactions[0], title: 'Fixture groceries', amountFils: 1250, category: 'shopping' };
      const tree = h.renderDetail(tx), t = h.deps['@/lib/i18n'].t;
      assert.ok(labelled(tree.props.footer, t('saveChanges')));
      assert.ok(labelled(tree.props.footer, t('cancel')));
      assert.equal(labelled(tree.props.children, t('saveChanges')), undefined);
      labelled(tree.props.footer, t('saveChanges')).props.onPress();
      const edit = h.events.find(e => e[0] === 'editTransaction');
      assert.ok(edit);assert.equal(edit[2].amountFils, 1250);
      assert.equal(h.events.some(e => e[0] === 'deleteTransaction'), false);
    });
    test(`${language}/${largeText}: source and transaction date are not a fabricated filing timestamp`, () => {
      const h = createHarness({ language, largeText });
      const tree = h.renderDetail(), t = h.deps['@/lib/i18n'].t;
      assert.ok(text(tree).includes(t('transactionDateLabel')));
      assert.ok(text(tree).includes(t('bankSmsSource')));
      assert.ok(text(tree).includes(h.state.transactions[1].date));
      assert.doesNotMatch(text(tree), /filed on|filed \d|أُدرجت|تم تسجيلها في/i);
    });
  }
}
test('opening a row or filters dismisses the search keyboard before presenting a sheet', () => {
  const h = transactions();
  labelled(h.tree, h.deps['@/lib/i18n'].t('filtersButton')).props.onPress();
  assert.equal(h.events[0][0], 'keyboard-dismiss');
  const row = h.list.props.renderItem({ item: h.state.transactions[0], index: 0 });
  const action = walk(row).find(n => n.props?.testID === 'transaction-details-link');
  assert.ok(action, 'the amount/Details target, not the separate merchant link, opens the edit sheet');
  h.events.length = 0;action.props.onPress();
  assert.equal(h.events[0][0], 'keyboard-dismiss');
  assert.ok(h.events.some(e => e[0] === 'state' && e[2]?.id === h.state.transactions[0].id));
});
test('delete confirmation remains a separate, destructive second action', () => {
  const h = createHarness({ states: { 7: true } });
  const tree = h.renderDetail();
  const confirm = walk(tree).find(n => n.props?.name === 'ConfirmSheet');
  assert.ok(confirm);assert.equal(confirm.props.destructive, true);
  assert.equal(h.events.some(e => e[0] === 'deleteTransaction'), false);
  confirm.props.onConfirm();
  assert.equal(h.events.filter(e => e[0] === 'deleteTransaction').length, 1);
});
test('invalid entry amount keeps the pinned Save disabled', () => {
  const h = createHarness({ states: { 0: true, 1: 'Fixture', 2: '', 3: 'other', 4: 'enbd', 5: '2026-09-06' } });
  const tree = h.renderDetail();
  const save = labelled(tree.props.footer, h.deps['@/lib/i18n'].t('saveChanges'));
  assert.ok(save);assert.equal(save.props.disabled, true);
});
test('Noon One uses explicit display aliases without broad substring matching', () => {
  const filename = path.join(root, 'src/components/ui/merchant-logo-assets.ts');
  const source = fs.readFileSync(filename, 'utf8'), deps = {};
  for (const [index, match] of [...source.matchAll(/require\('([^']+\.png)'\)/g)].entries()) deps[match[1]] = index + 1;
  const { merchantLogoFor } = load(filename, deps);
  for (const title of ['Noon One', 'NOON ONE', 'Noon One Dubai', 'Noon One 12345']) {
    assert.equal(merchantLogoFor(title)?.id, 'noon', title);
  }
  for (const title of ['Cafe near Noon One', 'Noon One Cafe', 'Noon One Payment Unknown']) assert.equal(merchantLogoFor(title), null, title);
});
test('shared sheet keeps a fixed footer below the shrinking scroll region', () => {
  const h = createHarness();
  h.deps['react-native'].Modal = 'Modal';
  h.deps['react-native'].useWindowDimensions = () => ({ width: 390, height: 844, fontScale: 1 });
  h.deps['@/hooks/use-keyboard-height'] = { useKeyboardHeight: () => 0 };
  const gesture = new Proxy({}, { get: () => () => gesture });
  h.deps['react-native-gesture-handler'] = { Gesture: { Pan: () => gesture }, GestureDetector: 'GestureDetector', GestureHandlerRootView: 'GestureRoot' };
  Object.assign(h.deps['react-native-reanimated'], { Extrapolation: { CLAMP: 'clamp' }, runOnJS: fn => fn });
  const Sheet = h.local('@/components/ui/bottom-sheet').BottomSheet;
  const footer = h.jsx('FooterFixture', {}), content = h.jsx('ContentFixture', {});
  const tree = Sheet({ visible: true, title: 'Fixture', onClose() {}, footer, children: content, testID: 'fixture-sheet' });
  assert.equal(tree.props.hardwareAccelerated, true, 'Android modal transitions use hardware acceleration');
  const scroll = walk(tree).find(n => n.type === 'ScrollView');
  const footerBox = walk(tree).find(n => n.props?.testID === 'fixture-sheet-footer');
  assert.ok(scroll && footerBox);
  assert.equal(scroll.props.nestedScrollEnabled, true, 'nested sheet content must hand scroll gestures to Android correctly');
  assert.equal(style(scroll).flexShrink, 1);
  assert.equal(style(footerBox).flexShrink, 0);
  assert.ok(style(footerBox).paddingBottom >= 10);
  assert.equal(walk(scroll).includes(footer), false);
  assert.equal(Sheet({ visible: false, title: 'Hidden', onClose() {}, children: content }), null,
    'an initially closed sheet creates no native subtree');
});

test('entry edit does not rescan merchant history for every typed character', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/entry-detail-sheet.tsx'), 'utf8');
  const sheetSource = fs.readFileSync(path.join(root, 'src/components/ui/bottom-sheet.tsx'), 'utf8');
  assert.doesNotMatch(sheetSource, /<Pressable accessible=\{false\} onPress=\{\(\) => \{\}\} style=\{styles\.sheetBody\}>/,
    'the sheet body must not compete with its ScrollView as a press responder');
  assert.doesNotMatch(source, /\[transaction,\s*title,\s*category,\s*state\.transactions\]/,
    'editable title/category must not drive a full-ledger merchant scan');
  assert.match(source, /countMerchantMatches\(merchant, category\)/,
    'the current edited merchant is counted once when Save actually needs the rule prompt');
  assert.equal((source.match(/horizontal nestedScrollEnabled/g) || []).length, 2,
    'category and account rails must cooperate with the vertical sheet scroll');
});

test('narrow screens give search full width without reducing the font size', () => {
  const h = transactions({ width: 320 });
  const toolbar = walk(h.tree).find(n => n.props?.testID === 'transaction-search-toolbar');
  assert.equal(style(toolbar).flexDirection, 'column');
  const input = walk(toolbar).find(n => n.type === 'TextInput');
  assert.equal(style(input).fontSize, 17);
  const filter = labelled(toolbar, h.deps['@/lib/i18n'].t('filtersButton'));
  assert.equal(style(filter).alignSelf, 'flex-end');
});

test('an unresolved transfer stays excluded without making transaction Net look unfinished', () => {
  const rows = [
    fixtureRow('purchase', { amountFils: 12500 }),
    fixtureRow('unclear-transfer', {
      title: 'Incoming transfer', type: 'income', category: 'other', amountFils: 25000000,
    }),
  ];
  const h = transactions({ language: 'en', state: { transactions: rows }, period: { mode: 'all' } });
  const net = netSummary(h);
  assert.ok(net);
  assert.ok(text(net).includes(h.deps['@/lib/i18n'].t('transactionNetTotal')));
  assert.match(text(net), /125|١٢٥/);
  assert.ok(walk(h.tree).some(n => n.props?.testID === 'transactions-exclusions'));
  assert.equal(walk(h.tree).find(n => n.props?.testID === 'transactions-unresolved-transfers'), undefined,
    'transfer review belongs under Accounts rather than the transaction summary');
});

const fixtureRow = (id, overrides = {}) => ({
  id, title: 'Fixture shop', date: '2026-09-02', amountFils: 12500,
  type: 'expense', category: 'dining', accountId: 'enbd', source: 'sms', ...overrides,
});
const netSummary = h => walk(h.tree).find(n => n.props?.testID === 'transactions-net-total');
const sectionHeader = (h, section) => h.list.props.renderSectionHeader({ section });
const dayTotal = header => walk(header).find(n => n.props?.testID === 'transaction-day-total');

for (const language of ['en', 'ar']) {
  for (const largeText of [false, true]) {
    test(`${language}/${largeText}: one ordinary result has one amount, not two extra totals`, () => {
      const row = fixtureRow('only');
      const h = transactions({ language, largeText, params: { merchant: 'Fixture shop' }, state: { transactions: [row] } });
      assert.equal(netSummary(h), undefined);
      assert.equal(h.list.props.sections.length, 1);
      const header = sectionHeader(h, h.list.props.sections[0]);
      assert.equal(dayTotal(header), undefined);
      assert.ok(text(header).includes(h.list.props.sections[0].title), 'date heading remains visible');
      assert.ok(labelled(h.tree, h.deps['@/lib/i18n'].t('clearAllFilters')), 'filter removal remains available');
      const renderedRow = h.list.props.renderItem({ item: row, index: 0 });
      const details = walk(renderedRow).find(n => n.props?.testID === 'transaction-details-link');
      assert.ok(details, 'actual transaction remains available');
      assert.match(text(details), /125|١٢٥/);
      assert.deepEqual(h.events, [], 'rendering never merges, deletes or writes transactions');
      assert.deepEqual(h.state.transactions, [row]);
    });
  }
  test(`${language}: a single excluded transfer still explains that its total is zero`, () => {
    const row = fixtureRow('transfer', { isTransfer: true });
    const h = transactions({ language, state: { transactions: [row] } });
    assert.ok(netSummary(h));
    assert.ok(walk(h.tree).some(n => n.props?.testID === 'transactions-exclusions'));
    assert.equal(h.list.props.sections[0].totalFils, 0);
    assert.equal(dayTotal(sectionHeader(h, h.list.props.sections[0])), undefined);
    assert.deepEqual(h.events, []);
  });
  test(`${language}: a single split result retains its selected-category subtotal`, () => {
    const row = fixtureRow('split', { amountFils: 12500, splits: [
      { category: 'dining', amountFils: 2500 }, { category: 'groceries', amountFils: 10000 },
    ] });
    const h = transactions({ language, params: { category: 'dining' }, state: { transactions: [row] } });
    assert.ok(netSummary(h));
    assert.equal(h.list.props.sections[0].totalFils, -2500, 'keep the exact partial amount, not the full purchase');
    assert.equal(dayTotal(sectionHeader(h, h.list.props.sections[0])), undefined);
    assert.deepEqual(h.events, []);
  });
  test(`${language}: one day with multiple transactions shows one combined total`, () => {
    const rows = [fixtureRow('one'), fixtureRow('two', { amountFils: 7500 })];
    const h = transactions({ language, state: { transactions: rows } });
    assert.ok(netSummary(h));
    assert.equal(h.list.props.sections[0].totalFils, -20000);
    assert.equal(dayTotal(sectionHeader(h, h.list.props.sections[0])), undefined);
    assert.equal(h.list.props.sections[0].data.length, 2);
  });
  test(`${language}: only a multi-entry day within multi-day results has a labelled subtotal`, () => {
    const rows = [fixtureRow('one'), fixtureRow('two'), fixtureRow('three', { date: '2026-09-01' })];
    const h = transactions({ language, state: { transactions: rows } });
    assert.ok(netSummary(h));
    for (const section of h.list.props.sections) {
      const total = dayTotal(sectionHeader(h, section));
      assert.equal(Boolean(total), section.data.length > 1);
      if (total) assert.ok(text(total).includes(h.deps['@/lib/i18n'].t('transactionDayTotal')));
    }
    assert.equal(h.list.props.sections.flatMap(s => s.data).length, 3);
    assert.deepEqual(h.events, []);
  });
  test(`${language}: empty results do not invent a zero transaction total`, () => {
    const h = transactions({ language, state: { transactions: [] } });
    assert.equal(netSummary(h), undefined);
    assert.equal(h.list.props.sections.length, 0);
    assert.ok(text(h.list.props.ListEmptyComponent).includes(h.deps['@/lib/i18n'].t('nothingMatches')));
  });
}
