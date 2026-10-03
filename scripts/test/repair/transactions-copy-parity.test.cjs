'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const source = load(path.join(root, 'src/lib/transaction-source.ts'));
const { transactionsCopy, transactionsWords } = load(path.join(root, 'src/lib/transactions-copy.ts'), {
  '@/lib/transaction-source': source,
});
const ARABIC = /[؀-ۿ]/;
// Product names Apple writes in Latin script in every language.
const BRAND = new Set(['Apple Pay']);

test('transactions copy has identical EN/AR keys, including every source kind', () => {
  const { en, ar } = transactionsCopy;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ar).sort());
  for (const table of ['source', 'sourceTitle']) {
    assert.deepEqual(Object.keys(en[table]).sort(), [...source.TRANSACTION_SOURCE_KINDS].sort(), table);
    assert.deepEqual(Object.keys(ar[table]).sort(), [...source.TRANSACTION_SOURCE_KINDS].sort(), table);
  }
});

test('every Arabic value is Arabic text, apart from product names', () => {
  const check = (value, key) => {
    if (typeof value === 'function') value = value('x');
    if (value && typeof value === 'object') { for (const [k, v] of Object.entries(value)) check(v, `${key}.${k}`); return; }
    assert.equal(typeof value, 'string', key);
    assert.ok(value.trim(), key);
    if (!BRAND.has(value)) assert.match(value, ARABIC, key);
  };
  for (const [key, value] of Object.entries(transactionsCopy.ar)) check(value, key);
  assert.equal(transactionsWords('ar'), transactionsCopy.ar);
  assert.equal(transactionsWords('en'), transactionsCopy.en);
  assert.equal(transactionsWords(undefined), transactionsCopy.en);
});
