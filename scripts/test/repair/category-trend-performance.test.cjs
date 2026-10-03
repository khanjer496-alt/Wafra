'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { performance } = require('node:perf_hooks');
const modules = require('./merchant-spending-fixture.cjs')();
const { categoryTrend } = modules['@/lib/analytics'];
const { monthKey, shiftMonthKey, setMonthStartDay } = modules['@/lib/format'];
const { isSpending } = modules['@/lib/ledger'];
const { amountInCategory } = modules['@/lib/splits'];
const live = new Set(Array.from({ length: 44 }, (_, i) => `account-${i}`));
const plain = value => JSON.parse(JSON.stringify(value));
function reference(rows, category, months, end, internal = new Set()) {
  return Array.from({ length: months }, (_, i) => {
    const key = shiftMonthKey(end, i - months + 1);
    let fils = 0;
    for (const row of rows) if (isSpending(row, live, internal) && monthKey(row.date) === key) {
      fils += amountInCategory(row, category);
    }
    return { key, fils };
  });
}
function fixture(size) {
  return Array.from({ length: size }, (_, i) => ({
    id: `row-${i}`, accountId: `account-${i % 44}`, title: `Merchant ${i % 800}`,
    date: new Date(Date.UTC(2026, 8, 23 - Math.floor(i / 20))).toISOString().slice(0, 10),
    category: i % 3 ? 'dining' : 'groceries', amountFils: 100 + i % 5000,
    type: 'expense', source: 'sms',
  }));
}
test('category history preserves salary boundaries, splits, exclusions and arbitrary input order', () => {
  const rows = fixture(300);
  rows.push(...[
    { id: 'split', date: '2026-09-25', splits: [{ category: 'dining', amountFils: 35 }, { category: 'groceries', amountFils: 65 }] },
    { id: 'boundary-before', date: '2026-09-24' },
    { id: 'hidden', accountId: 'hidden' }, { id: 'internal' },
    { id: 'transfer', isTransfer: true }, { id: 'income', type: 'income' },
    { id: 'future', date: '2027-01-01' }, { id: 'old', date: '2024-01-01' },
  ].map(extra => ({ ...rows[0], amountFils: 100, ...extra })));
  const shuffled = [...rows.filter((_, i) => i % 2), ...rows.filter((_, i) => !(i % 2))];
  const internal = new Set(['internal']);
  const original = plain(rows);
  try {
    for (const salaryDay of [1, 25, 28]) {
      setMonthStartDay(salaryDay);
      for (const input of [rows, shuffled, []]) for (const months of [0, 1, 6, 12]) {
        for (const category of ['dining', 'groceries', 'rent']) {
          assert.deepEqual(plain(categoryTrend(input, category, months, '2026-09', live, internal)),
            reference(input, category, months, '2026-09', internal));
        }
      }
    }
    assert.deepEqual(plain(rows), original, 'projection must not mutate transactions');
    assert.throws(() => categoryTrend(rows, 'dining', 6, new Set(), live, internal), /4th argument is endKey/);
  } finally { setMonthStartDay(1); }
});
for (const size of [15000, 30000]) test(`${size} rows require at most one ledger date read per row`, () => {
  const rows = fixture(size);
  let reads = 0;
  const counted = rows.map(row => ({ ...row, get date() { reads++; return row.date; } }));
  const result = categoryTrend(counted, 'dining', 6, '2026-09', live, new Set());
  assert.deepEqual(plain(result), reference(rows, 'dining', 6, '2026-09'));
  console.log(JSON.stringify({ rows: size, dateReads: reads }));
  assert.ok(reads <= size, `${reads} date reads for ${size} rows`);
  if (process.env.WAFRA_TREND_TIMING === '1') {
    const baselineStart = performance.now();
    reference(rows, 'dining', 6, '2026-09');
    const baselineMs = performance.now() - baselineStart;
    const start = performance.now();
    categoryTrend(rows, 'dining', 6, '2026-09', live, new Set());
    console.log(JSON.stringify({ rows: size, baselineHostMs: +baselineMs.toFixed(3), afterHostMs: +(performance.now() - start).toFixed(3) }));
  }
});
