'use strict';
// Copy for the Spending detail screens in design language E (merchant,
// merchants, foreign activity), and the per-row rate source on Currencies.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const { spendingDetailsCopyTables, spendingDetailsCopy } = load(path.join(root, 'src/lib/spending-details-copy.ts'));
const { en, ar } = spendingDetailsCopyTables;
const ARABIC = /[؀-ۿ]/;
const sample = (value) => typeof value === 'function'
  ? value.length === 5 ? value('EUR', 'EUR 89.00', 'AED 359.20', 34, 'دفعتان') : value(34, '3 payments')
  : value;

test('English and Arabic carry exactly the same keys and kinds', () => {
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    assert.equal(typeof ar[key], typeof en[key], key);
    if (typeof en[key] === 'function') assert.equal(ar[key].length, en[key].length, `${key} arity`);
  }
  assert.deepEqual(Object.keys(ar.rate).sort(), Object.keys(en.rate).sort());
  assert.deepEqual(Object.keys(en.rate).sort(), ['bank', 'estimated', 'reference']);
  assert.equal(spendingDetailsCopy('ar'), ar);
  assert.equal(spendingDetailsCopy('en'), en);
  assert.equal(spendingDetailsCopy('fr'), en, 'anything else reads English');
});

test('every Arabic string is Arabic and every English string is not', () => {
  for (const key of ['change', 'tileMeta']) {
    assert.ok(!ARABIC.test(sample(en[key]).replace('دفعتان', '')), `${key} en`);
  }
  assert.ok(ARABIC.test(ar.change));
  for (const source of Object.keys(en.rate)) {
    assert.ok(en.rate[source].trim() && !ARABIC.test(en.rate[source]), `rate.${source} en`);
    assert.ok(ARABIC.test(ar.rate[source]), `rate.${source} ar`);
  }
});

test('currency tiles read their figures whole, isolated left to right in Arabic', () => {
  assert.equal(en.tileMeta(34, '3 payments'), '34% · 3 payments');
  assert.equal(en.tileSpoken('EUR', 'EUR 89.00', 'AED 359.20', 34, '3 payments'), 'EUR. EUR 89.00. AED 359.20. 34%. 3 payments');
  assert.equal(ar.tileMeta(34, 'دفعتان'), '⁦34%⁩ · دفعتان');
  assert.match(ar.tileSpoken('EUR', 'EUR 89.00', 'AED 359.20', 34, 'دفعتان'), /⁦EUR 89\.00⁩\. ⁦AED 359\.20⁩/);
});

test('each foreign row names its rate source by the same rule the summary counts with', () => {
  const fx = { originalMoneyOf: (tx) => tx.originalCurrency ? { currency: tx.originalCurrency, minorUnits: tx.originalMinor, exponent: 2 } : null };
  const summaryModule = load(path.join(root, 'src/lib/fx-summary.ts'), {
    '@/lib/fx': fx, '@/lib/markets': { ledgerCurrencyCode: () => 'AED' },
  });
  assert.equal(summaryModule.fxRowSource({ fxSource: 'bank' }), 'bank');
  assert.equal(summaryModule.fxRowSource({ fxSource: 'reference' }), 'reference');
  assert.equal(summaryModule.fxRowSource({ fxSource: 'fallback' }), 'estimated');
  assert.equal(summaryModule.fxRowSource({}), 'estimated', 'a row from before the source was recorded is an approximation');
  const row = (id, fxSource) => ({ id, type: 'expense', amountFils: 1000, originalCurrency: 'EUR', originalMinor: 250,
    accountId: 'a', date: '2026-09-01', fxSource });
  const summary = summaryModule.summarizeForeignActivity([row('a', 'bank'), row('b', 'reference'), row('c', 'fallback'), row('d')]);
  assert.deepEqual([summary.bankQuotedCount, summary.referenceCount, summary.estimatedCount], [1, 1, 2]);
  assert.deepEqual(summary.transactions.map((tx) => en.rate[summaryModule.fxRowSource(tx)]),
    ['bank’s rate', 'reference rate for that date', 'approximate rate for now', 'approximate rate for now']);
});
