'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const reference = require('./ledger-reference.cjs');
const ledger = load(path.resolve(__dirname, '../../../src/lib/ledger.ts'));
const day = 86400000;
const start = Date.UTC(2026, 0, 1, 12);
const accounts = [{ id: 'bank', archived: true }, { id: 'savings' }, { id: 'card' }];
const row = (id, type, at, extra = {}) => ({
  id, type, ts: at, date: '2026-01-01', amountFils: 10000,
  accountId: type === 'expense' ? 'bank' : 'savings',
  title: type === 'expense' ? 'Outgoing transfer' : 'Incoming transfer',
  category: 'other', ...extra,
});
const check = (rows, owned = accounts) => {
  assert.deepEqual([...ledger.internalTransferIds(rows, owned)], [...reference(rows, owned)]);
};

test('nearest match, not first row; original position breaks equidistant ties', () => {
  const rows = [row('far', 'expense', start - 2 * day), row('right', 'expense', start + day),
    row('left', 'expense', start - day), row('in', 'income', start)];
  check(rows);
  assert.deepEqual([...ledger.internalTransferIds(rows, accounts)], ['right', 'in']);
});
test('three-day boundary is inclusive and one millisecond beyond is excluded', () => {
  for (const offset of [-3 * day - 1, -3 * day, 3 * day, 3 * day + 1]) {
    check([row('out', 'expense', start + offset), row('in', 'income', start)]);
  }
});
test('each outgoing row pairs once; same-account arrivals do not pair', () => {
  check([row('out', 'expense', start), row('same', 'income', start, { accountId: 'bank' }),
    row('first', 'income', start), row('second', 'income', start)]);
});
test('ordinary spending, salaries, refunds and flagged income stay excluded', () => {
  for (const patch of [{ category: 'salary' }, { title: 'Refund' }, { isTransfer: true }]) {
    check([row('out', 'expense', start), row('in', 'income', start, patch)]);
  }
  check([row('shop', 'expense', start, { title: 'Grocery' }), row('in', 'income', start)]);
});
test('archived account and legacy live-ID set do not turn own transfers into income', () => {
  const rows = [row('out', 'expense', start), row('in', 'income', start)];
  check(rows);
  check(rows, new Set(['savings']));
  check(rows, [{ id: 'savings' }]);
});
test('date fallback, epoch zero, invalid dates and non-finite timestamps agree', () => {
  for (const at of [undefined, null, 0, NaN, Infinity, -Infinity]) {
    check([row('out', 'expense', at), row('in', 'income', at)]);
  }
  check([row('out', 'expense', undefined, { date: 'invalid' }), row('in', 'income', start)]);
});
test('does not mutate the transaction array or its rows', () => {
  const rows = Object.freeze([Object.freeze(row('out', 'expense', start)), Object.freeze(row('in', 'income', start))]);
  check(rows);
});
test('400 seeded mixed ledgers retain exact pair IDs and ordering', () => {
  let seed = 0xabc123;
  const random = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor((seed / 0x100000000) * n); };
  const titles = ['Outgoing transfer', 'Incoming transfer', 'Inward remittance', 'Bank transfer', 'Self transfer',
    'Grocery', 'Salary', 'Refund', 'Savings transfer', ' own account transfer '];
  let matched = 0;
  for (let sample = 0; sample < 400; sample += 1) {
    const rows = Array.from({ length: 140 }, (_, i) => row(`t${i}`, random(2) ? 'expense' : 'income',
      start + (random(30) - 15) * day + random(3), {
        amountFils: [0, 100, 1000, 10000, 9900][random(5)], accountId: ['bank', 'savings', 'card', 'unknown'][random(4)],
        title: titles[random(titles.length)], category: random(7) === 0 ? 'salary' : 'other',
        isTransfer: random(5) === 0,
      }));
    const owned = sample % 2 ? accounts : new Set(['savings']);
    check(rows, owned);
    matched += ledger.internalTransferIds(rows, owned).size;
  }
  assert.ok(matched > 400, `Expected meaningful paired coverage, got ${matched} paired IDs`);
});
