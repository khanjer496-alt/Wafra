'use strict';
// #263 (RC 405 scorecard O2): Review showed "AED 12345.67" where the ledger
// rows show "AED 12,345.67". The production Review screen renders through the
// workflow harness; amounts are synthetic, no inbox data.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { createWorkflowHarness, walk, text } = require('../workflows/workflow-harness.cjs');

const root = path.resolve(__dirname, '../../..');
const field = (value = null, evidence = value === null ? 'missing' : 'explicit') => ({ value, evidence, alternatives: [] });
const universal = (amount) => ({
  id: 'synthetic-universal', kind: 'universal', sourceKey: 'synthetic-universal-source',
  observedAt: Date.now() - 60000, expiresAt: Date.now() + 86400000, channel: 'inbox', parserVersion: 35,
  event: { family: 'purchase', status: 'posted', direction: 'debit', amount: field(amount), statementTotal: field(),
    balance: field(), creditLimit: field(), minimumDue: field(), merchant: field('Synthetic shop'),
    instrument: field(), transactionDate: field('2026-09-06'), statementDate: field(), dueDate: field() },
});
const registered = (amount) => ({
  kind: 'registered', id: 'synthetic-registered', sourceKey: 'synthetic-registered-source',
  observedAt: Date.now() - 60000, expiresAt: Date.now() + 86400000, channel: 'inbox', parserVersion: 1,
  market: 'AE', institution: 'emirates-nbd',
  grammar: { id: 'fixture-alert', version: 1, channel: 'bank-alert', status: 'experimental', provenance: 'launch-registry' },
  amount, direction: 'credit', family: 'refund', rail: null, instrument: null,
});
const byId = (tree, id) => walk(tree).filter((node) => node.props?.testID === id);

for (const language of ['en', 'ar']) {
  for (const [name, item] of [
    ['a registered alert', registered({ currency: 'AED', minorUnits: '1234567', exponent: 2 })],
    ['a universal alert', universal({ currency: 'AED', minorUnits: '1234567', exponent: 2 })],
  ]) {
    test(`${language}: ${name} groups its amount like the ledger rows, in the list and one at a time`, () => {
      const list = createWorkflowHarness({ language, state: { reviewTray: { pending: [item] } }, states: { 2: false } });
      const row = byId(list.renderScreen('review-alerts'), 'review-alert-row')[0];
      assert.ok(row, 'the list shows the row');
      assert.ok(text(row).includes('AED 12,345.67'), text(row));
      assert.ok(!text(row).includes('12345.67'));
      // The screen-reader label speaks the same grouped figure.
      assert.ok(walk(row).some((node) => node.props?.accessibilityLabel?.includes('AED 12,345.67')));

      const step = createWorkflowHarness({ language, state: { reviewTray: { pending: [item] } } });
      const amount = byId(step.renderScreen('review-alerts'), 'review-step-amount')[0];
      assert.equal(text(amount), 'AED 12,345.67');
    });
  }
}

test('the Review label is the ledger formatter: exact minor units, device grouping, original currency', () => {
  const ledgerMoney = load(path.join(root, 'src/lib/ledger-money.ts'), {
    '@/lib/currency-metadata': load(path.join(root, 'src/lib/currency-metadata.ts')),
  });
  const fields = load(path.join(root, 'src/components/universal-review-fields.tsx'), {
    react: { useState: (value) => [value, () => {}] },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { Pressable: 'Pressable', View: 'View', StyleSheet: { create: (styles) => styles } },
    '@/components/themed-text': { ThemedText: 'Text' },
    '@/components/ui/icon': { Icon: 'Icon' },
    '@/constants/theme': { Spacing: {}, Radius: {} },
    '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/lib/i18n': { t: (key) => key },
    '@/lib/ledger-money': ledgerMoney,
  });
  const label = fields.universalMoneyLabel;
  const money = (currency, minorUnits, exponent) => ({ currency, minorUnits, exponent });
  assert.equal(label(money('AED', '5000000', 2)), 'AED 50,000.00');
  assert.equal(label(money('AED', '1234567', 2)), 'AED 12,345.67');
  assert.equal(label(money('AED', '5', 2)), 'AED 0.05');
  assert.equal(label(money('KWD', '1234567', 3)), 'KWD 1,234.567');
  assert.equal(label(money('JPY', '1234567', 0)), 'JPY 1,234,567');
  assert.equal(label(money('AED', '-1234567', 2)), 'AED −12,345.67');
  // The alert's own exponent is kept, never re-read from the currency.
  assert.equal(label(money('USD', '1234567', 3)), 'USD 1,234.567');

  // A German phone groups with "." and writes a decimal comma, as ledger rows do there.
  ledgerMoney.setDisplayMoneyLocale({ locale: 'de-DE', decimalSeparator: ',' });
  try {
    assert.equal(label(money('EUR', '1234567', 2)), 'EUR 12.345,67');
  } finally {
    ledgerMoney.setDisplayMoneyLocale(null);
  }
  assert.equal(label(money('EUR', '1234567', 2)), 'EUR 12,345.67');

  // Beyond a safe integer the digits stay exact rather than crossing floating point.
  assert.equal(label(money('IDR', '90071992547409931', 2)), 'IDR 900719925474099.31');
  assert.equal(label(money('XXX', '1234567', 4)), 'XXX 123.4567');
});
