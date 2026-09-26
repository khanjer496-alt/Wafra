'use strict';
// Transactions, the entry sheet and Add in design language E: what sits on
// the band, what sits on the sheet, and that the sheets take a band's surface.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness, walk, text } = require('./reference-harness.cjs');
const { createWorkflowHarness } = require('../workflows/workflow-harness.cjs');

const root = path.resolve(__dirname, '../../..');
const byId = (tree, id) => walk(tree).find((node) => node.props?.testID === id);

function transactions(options = {}) {
  const h = createHarness(options);
  h.deps['react-native'].Keyboard = { dismiss() {} };
  h.deps['react-native'].SectionList = (p) => h.jsx('SectionList', { ...p, children: p.ListHeaderComponent });
  h.deps['@react-native-community/datetimepicker'] = { __esModule: true, default: 'DateTimePicker' };
  h.deps['@/lib/period'].periodRange = () => '';
  const tree = h.local('@/app/transactions').default();
  return { ...h, tree, scaffold: walk(tree).find((node) => node.type === 'BandScaffold') };
}

test('Transactions: ink band with back, title and Add; search, filter and chips on the band', () => {
  const h = transactions();
  assert.equal(h.scaffold.props.band, 'home');
  assert.equal(h.scaffold.props.scroll, false, 'the sheet owns the virtualized list');
  assert.equal(h.scaffold.props.nav.back, true);
  assert.equal(h.scaffold.props.nav.title, 'Transactions');
  const band = h.scaffold.props.bandContent;
  assert.ok(byId(band, 'transaction-search-toolbar'));
  assert.ok(byId(band, 'transactions-type-chips'));
  assert.ok(walk(band).some((node) => node.props?.inputMode === 'search'), 'the search field is on the band');
  const ink = h.deps['@/hooks/use-band'].useBand('home');
  const chip = walk(byId(band, 'transactions-chip-all')).find((node) => node.props?.accessibilityRole === 'button');
  assert.equal(chip.props.accessibilityState.selected, true);
  // At the accessibility sizes the controls leave the band for the list header.
  const large = transactions({ largeText: true });
  assert.equal(large.scaffold.props.bandContent, undefined);
  assert.ok(byId(walk(large.tree).find((node) => node.type === 'SectionList').props.ListHeaderComponent, 'transaction-search-toolbar'));
  assert.ok(ink.band);
});

test('Transactions: swipe actions wear Category ochre, Transfer slate and Delete clay', () => {
  const h = transactions();
  const list = walk(h.tree).find((node) => node.type === 'SectionList');
  const swipe = walk(list.props.renderItem({ item: h.state.transactions[1], index: 0 })).find((node) => node.type === 'SwipeRow');
  assert.deepEqual([...swipe.props.actions.map((action) => `${action.name}:${action.band}`)],
    ['category:bills', 'transfer:accounts', 'delete:spending']);
  const source = fs.readFileSync(path.join(root, 'src/components/swipe-row.tsx'), 'utf8');
  assert.match(source, /BandPalettes\[scheme\]\[tone\]/, 'the colour comes from the band palette for the current scheme');
  assert.doesNotMatch(source, /#[0-9A-Fa-f]{6}/, 'no hard-coded colours');
});

test('Entry detail: centred logo and figure, category and transfer chips, Done', () => {
  const h = createHarness();
  const tree = h.renderDetail();
  assert.equal(tree.props.palette, h.deps['@/hooks/use-band'].useBand('home'), 'the sheet is the ink band\'s sheet, lifted');
  const head = byId(tree, 'entry-detail-head');
  assert.ok(byId(head, 'entry-detail-amount'));
  assert.match(byId(head, 'entry-detail-amount').props.accessibilityLabel, /AED −620\.00/);
  const chips = byId(tree, 'entry-detail-chips');
  const category = byId(chips, 'entry-category-chip');
  assert.equal(category.props.accessibilityLabel, 'Category: Dining');
  category.props.onPress();
  assert.ok(h.events.some((event) => event[0] === 'state' && event[1] === 13 && event[2] === true), 'opens the category picker');
  assert.ok(byId(chips, 'entry-mark-transfer'));
  const done = byId(tree.props.footer, 'entry-detail-done');
  done.props.onPress();
  assert.ok(h.events.some((event) => event[0] === 'close'));
  assert.equal(h.events.some((event) => event[0] === 'editTransaction'), false);
  // From Spending, the sheet is clay.
  const clay = h.deps['@/components/entry-detail-sheet'].EntryDetailSheet({ transaction: h.state.transactions[1], band: 'spending', onClose() {} });
  assert.equal(clay.props.palette, h.deps['@/hooks/use-band'].useBand('spending'));
});

function add(options = {}) {
  const h = createWorkflowHarness({ language: options.language ?? 'en', state: {
    ledgerMoney: { schemaVersion: 2, currency: 'USD', exponent: 2 }, reviewTray: { pending: [], tombstones: [], templateRules: [] },
    accounts: [{ id: 'cash', name: 'Cash', kind: 'cash', openingFils: 0, color: '#997349' }] } });
  h.deps['@/lib/review-promotion'] = { reviewTemplateRuleFor: () => null };
  h.deps['@/lib/universal-categorization'] = { suggestUniversalCategory: () => null };
  h.local('@/lib/review-alert-copy', 'src/lib/review-alert-copy.ts');
  h.local('@/components/universal-review-fields');
  const tree = h.renderScreen('add-transaction');
  return { ...h, tree, scaffold: walk(tree).find((node) => node.type === 'BandScaffold') };
}

test('Add: green band with Expense/Income, the amount, the merchant; keypad and Save on the sheet', () => {
  const h = add();
  assert.equal(h.scaffold.props.band, 'flow');
  assert.equal(h.scaffold.props.keyboardAware, true);
  const band = h.scaffold.props.bandContent;
  const tabs = walk(band).filter((node) => node.props?.accessibilityRole === 'tab');
  assert.deepEqual([...tabs.map((tab) => tab.props.accessibilityLabel)], ['Expense', 'Income']);
  const display = walk(band).find((node) => node.type === 'KeypadAmountDisplay');
  assert.equal(display.props.palette, h.deps['@/hooks/use-band'].useBand('flow'), 'the amount is the band\'s figure');
  assert.ok(byId(band, 'add-merchant-field'), 'the merchant is typed on the band');
  assert.ok(byId(band, 'amount-mode-toggle'), 'the system keyboard stays one tap away');
  const keypad = walk(h.scaffold.props.children).find((node) => node.type === 'AmountKeypad');
  assert.ok(keypad, 'the keypad is on the sheet');
  assert.equal(keypad.props.palette, h.deps['@/hooks/use-band'].useBand('flow'));
  assert.ok(byId(h.scaffold.props.children, 'add-detail-chips'));
  assert.equal(byId(h.scaffold.props.footer, 'add-save').props.accessibilityLabel, 'Save transaction');
  assert.match(text(band), /Amount/);
});
