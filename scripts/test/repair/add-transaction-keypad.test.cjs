'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkflowHarness, walk } = require('../workflows/workflow-harness.cjs');

const byId = (tree, id) => walk(tree).find((node) => node.props?.testID === id);
const byType = (tree, type) => walk(tree).find((node) => node.type === type);
const amountField = (tree) => walk(tree).find((node) => node.props?.keyboardType === 'decimal-pad' &&
  typeof node.props.onChangeText === 'function');

function harness({ ledgerMoney = { schemaVersion: 2, currency: 'USD', exponent: 2 }, language = 'en' } = {}) {
  const h = createWorkflowHarness({ language, state: { ledgerMoney, reviewTray: { pending: [], tombstones: [], templateRules: [] },
    accounts: [{ id: 'cash', name: 'Cash', kind: 'cash', openingFils: 0, color: '#997349' }] } });
  const states = [], refs = []; let stateIndex = 0, refIndex = 0;
  h.deps.react.useState = (initial) => {
    const index = stateIndex++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
  };
  h.deps.react.useRef = (initial) => refs[refIndex++] ??= { current: initial };
  h.deps['@/lib/haptics'].committed = () => {};
  h.deps['@/lib/review-promotion'] = { reviewTemplateRuleFor: () => null };
  h.deps['@/lib/universal-categorization'] = { suggestUniversalCategory: () => null };
  h.local('@/lib/review-alert-copy', 'src/lib/review-alert-copy.ts');
  h.local('@/components/universal-review-fields');
  const store = h.deps['@/lib/store'].useStore();
  store.getStateGeneration = () => 0;
  store.getStateSnapshot = () => h.state;
  store.addTransaction = (input, spec) => h.events.push(['add', input, spec]);
  const render = () => { stateIndex = 0; refIndex = 0; return h.renderScreen('add-transaction'); };
  const press = (...keys) => { for (const key of keys) byType(render(), 'AmountKeypad').props.onKey(key); return render(); };
  const save = () => {
    const button = walk(render()).find((node) => node.props?.onPress &&
      node.props.accessibilityLabel === h.deps['@/lib/i18n'].t('saveTransaction'));
    assert.ok(button, 'save button');
    button.props.onPress();
  };
  return { ...h, render, press, save, store };
}

test('the keypad writes exact minor units for a two-decimal ledger', () => {
  const h = harness();
  const keypad = byType(h.render(), 'AmountKeypad');
  assert.ok(keypad, 'manual entry opens on the keypad');
  assert.equal(keypad.props.exponent, 2);
  h.press('1', '8', 'decimal', '5');
  const display = byType(h.render(), 'KeypadAmountDisplay');
  assert.equal(display.props.text, '18.5');
  assert.equal(display.props.currency, 'USD');
  assert.match(display.props.spokenLabel, /USD 18\.5/);
  h.save();
  const added = h.events.find((event) => event[0] === 'add');
  assert.ok(added, 'saved');
  assert.equal(added[1].amountFils, 1850);
  assert.equal(added[1].source, 'manual');
  assert.equal(added[1].type, 'expense');
});

test('a whole-unit ledger has no decimal key and saves whole units', () => {
  const h = harness({ ledgerMoney: { schemaVersion: 2, currency: 'JPY', exponent: 0 } });
  assert.equal(byType(h.render(), 'AmountKeypad').props.exponent, 0);
  h.press('1', 'decimal', '5', '0', '0');
  h.save();
  assert.equal(h.events.find((event) => event[0] === 'add')[1].amountFils, 1500);
});

test('a three-decimal ledger keeps all three decimals', () => {
  const h = harness({ ledgerMoney: { schemaVersion: 2, currency: 'KWD', exponent: 3 } });
  h.press('2', 'decimal', '1', '2', '5', '9');
  h.save();
  assert.equal(h.events.find((event) => event[0] === 'add')[1].amountFils, 2125);
});

test('an empty keypad does not save and marks the amount invalid', () => {
  const h = harness();
  h.save();
  assert.equal(h.events.some((event) => event[0] === 'add'), false);
  const display = byType(h.render(), 'KeypadAmountDisplay');
  assert.equal(display.props.invalid, true);
  assert.ok(display.props.errorText);
  assert.ok(display.props.ref && 'current' in display.props.ref,
    'the display takes the amount ref, so focusing the first invalid field reaches it');
});

test('the system keyboard stays one tap away and keeps the typed value', () => {
  const h = harness();
  h.press('4', '2');
  byId(h.render(), 'amount-mode-toggle').props.onPress();
  const tree = h.render();
  assert.equal(byType(tree, 'AmountKeypad'), undefined, 'keypad hidden while typing');
  const field = amountField(tree);
  assert.ok(field, 'typed amount field');
  assert.equal(field.props.value, '42');
  field.props.onChangeText('42.75');
  h.save();
  assert.equal(h.events.find((event) => event[0] === 'add')[1].amountFils, 4275);
});

test('switching back to the keypad carries the typed amount exactly', () => {
  const h = harness();
  byId(h.render(), 'amount-mode-toggle').props.onPress();
  amountField(h.render()).props.onChangeText('7.5');
  byId(h.render(), 'amount-mode-toggle').props.onPress();
  assert.equal(byType(h.render(), 'KeypadAmountDisplay').props.text, '7.5');
  h.save();
  assert.equal(h.events.find((event) => event[0] === 'add')[1].amountFils, 750);
});

test('category, date and account share one chip row; date opens a choice sheet', () => {
  const h = harness();
  const tree = h.render();
  const row = byId(tree, 'add-detail-chips');
  assert.ok(row);
  for (const id of ['category-picker-trigger', 'date-picker-trigger', 'account-picker-trigger']) {
    assert.ok(walk(row).some((node) => node.props?.testID === id), id);
  }
  byId(tree, 'date-picker-trigger').props.onPress();
  const sheet = walk(h.render()).find((node) => node.props?.name === 'ChoiceSheet' && node.props.visible);
  assert.ok(sheet, 'date sheet open');
  assert.equal(sheet.props.options.length, 4);
  sheet.props.onSelect('1');
  h.press('5');
  h.save();
  const added = h.events.find((event) => event[0] === 'add')[1];
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  assert.equal(added.date, yesterday.toISOString().slice(0, 10));
});

test('the Add form offers no Transfer type', () => {
  const h = harness();
  const labels = walk(h.render()).filter((node) => node.props?.accessibilityRole === 'tab')
    .map((node) => node.props.accessibilityLabel);
  assert.equal(labels.length, 2);
});
