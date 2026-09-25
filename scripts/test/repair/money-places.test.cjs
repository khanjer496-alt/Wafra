'use strict';
// Pure figures behind Accounts, account/goal detail and the Bills timeline,
// and parity of their copy module. Synthetic data only.
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const format = require('../build/format');
const ledger = require('../build/ledger');
const places = load(path.join(root, 'src/lib/money-places.ts'), { '@/lib/format': format, '@/lib/ledger': ledger });
const { moneyPlacesCopy } = load(path.join(root, 'src/lib/money-places-copy.ts'));

test('the usage bar needs a limit the user entered AND a bank figure', () => {
  const credit = { cardType: 'credit' };
  assert.equal(places.cardUsage({ ...credit, snapshotFils: 190_400, snapshotKind: 'outstanding' }), null, 'no limit');
  assert.equal(places.cardUsage({ ...credit, creditLimitFils: 500_000 }), null, 'no bank figure');
  assert.equal(places.cardUsage({ ...credit, creditLimitFils: 500_000, snapshotFils: 100, snapshotKind: 'balance' }), null);
  assert.equal(places.cardUsage({ cardType: 'debit', creditLimitFils: 500_000, snapshotFils: 1, snapshotKind: 'outstanding' }), null);
  assert.deepEqual({ ...places.cardUsage({ ...credit, creditLimitFils: 500_000, snapshotFils: 190_400, snapshotKind: 'outstanding' }) },
    { usedFils: 190_400, limitFils: 500_000, ratio: 190_400 / 500_000 });
  // Headroom quoted: used is limit minus what is available.
  assert.equal(places.cardUsage({ ...credit, creditLimitFils: 500_000, snapshotFils: 320_000, snapshotKind: 'limit' }).usedFils, 180_000);
  // Over the limit fills the bar without overflowing it.
  assert.equal(places.cardUsage({ ...credit, creditLimitFils: 100, snapshotFils: 150, snapshotKind: 'outstanding' }).ratio, 1);
});

test('in / out this month is the account\'s recorded movement, duplicates counted once', () => {
  const rows = [
    { id: 'salary', accountId: 'bank', type: 'income', amountFils: 420_000, date: '2026-09-01' },
    { id: 'rent', accountId: 'bank', type: 'expense', amountFils: 200_000, date: '2026-09-02' },
    { id: 'move-out', accountId: 'bank', type: 'expense', amountFils: 50_000, date: '2026-09-03', isTransfer: true },
    { id: 'move-out-dup', accountId: 'bank', type: 'expense', amountFils: 50_000, date: '2026-09-03' },
    { id: 'august', accountId: 'bank', type: 'expense', amountFils: 9_999, date: '2026-08-30' },
    { id: 'other', accountId: 'cash', type: 'expense', amountFils: 1_000, date: '2026-09-04' },
  ];
  const flow = places.accountMonthFlow(rows, 'bank', new Date(2026, 8, 25), new Set(['move-out-dup']));
  assert.deepEqual({ ...flow }, { inFils: 420_000, outFils: 250_000, count: 3 });
  assert.deepEqual({ ...places.accountMonthFlow(rows, 'none', new Date(2026, 8, 25)) }, { inFils: 0, outFils: 0, count: 0 });
  assert.deepEqual([...places.recentAccountTransactions(rows, 'bank', 2).map((r) => r.id)], ['move-out', 'move-out-dup']);
});

test('captured card spending is this month\'s spending on the asked cards, never payments or own moves', () => {
  const rows = [
    { id: 'buy', accountId: 'visa', type: 'expense', amountFils: 4_562, category: 'groceries', title: 'Market', date: '2026-09-20' },
    { id: 'buy2', accountId: 'visa', type: 'expense', amountFils: 1_549, category: 'entertainment', title: 'Stream', date: '2026-09-02' },
    { id: 'pay', accountId: 'visa', type: 'income', amountFils: 90_000, category: 'other', title: 'Payment', date: '2026-09-10', isTransfer: true },
    { id: 'move', accountId: 'visa', type: 'expense', amountFils: 7_000, category: 'other', title: 'Move', date: '2026-09-11', isTransfer: true },
    { id: 'internal', accountId: 'visa', type: 'expense', amountFils: 3_000, category: 'other', title: 'Sweep', date: '2026-09-12' },
    { id: 'aug', accountId: 'visa', type: 'expense', amountFils: 999, category: 'dining', title: 'Old', date: '2026-08-31' },
    { id: 'other-card', accountId: 'amex', type: 'expense', amountFils: 500, category: 'dining', title: 'Cafe', date: '2026-09-20' },
  ];
  const totals = places.capturedCardSpendFils(rows, new Set(['visa']), new Date(2026, 8, 25), new Set(['internal']));
  assert.equal(totals.get('visa'), 4_562 + 1_549);
  assert.equal(totals.has('amex'), false);
  assert.equal(places.capturedCardSpendFils(rows, new Set(), new Date(2026, 8, 25)).size, 0);
  assert.equal(places.isAccountDetailTarget({ kind: 'bank' }), true);
  assert.equal(places.isAccountDetailTarget({ kind: 'cash' }), true);
  assert.equal(places.isAccountDetailTarget({ kind: 'card', cardType: 'debit' }), false);
  assert.equal(places.isAccountDetailTarget({ kind: 'bank', cardType: 'credit' }), false);
});

test('goal progress is saved against target and nothing else', () => {
  assert.deepEqual({ ...places.goalProgress({ savedFils: 320_000, targetFils: 500_000 }) },
    { ratio: 0.64, percent: 64, leftFils: 180_000, reached: false });
  assert.deepEqual({ ...places.goalProgress({ savedFils: 600_000, targetFils: 500_000 }) },
    { ratio: 1, percent: 100, leftFils: 0, reached: true });
  assert.equal(places.goalProgress({ savedFils: 1, targetFils: 0 }).ratio, 0);
});

test('the timeline shows only the window it names, soonest first, stacking same-day pins', () => {
  const pins = places.timelinePins([
    { id: 'late', title: 'Overdue', dateISO: '2026-09-20' },
    { id: 'far', title: 'Insurance', dateISO: '2026-11-30' },
    { id: 'b', title: 'Spotify', dateISO: '2026-10-07' },
    { id: 'a', title: 'Netflix', dateISO: '2026-09-28' },
    { id: 'c', title: 'Electricity', dateISO: '2026-10-07' },
    { id: 'today', title: 'Gym', dateISO: '2026-09-25' },
    { id: 'edge', title: 'Visa', dateISO: '2026-10-25' },
  ], '2026-09-25');
  assert.deepEqual(JSON.parse(JSON.stringify(pins.map((p) => [p.id, p.day, p.lane]))), [
    ['today', 0, 0], ['a', 3, 0], ['c', 12, 0], ['b', 12, 1], ['edge', 30, 0],
  ]);
  assert.equal(pins[0].position, 0);
  assert.equal(pins[pins.length - 1].position, 1);
});

test('the copy module has the same keys in English and Arabic, and Arabic is Arabic', () => {
  const en = Object.keys(moneyPlacesCopy.en).sort();
  const ar = Object.keys(moneyPlacesCopy.ar).sort();
  assert.deepEqual(ar, en);
  for (const key of en) {
    const e = moneyPlacesCopy.en[key];
    const a = moneyPlacesCopy.ar[key];
    assert.equal(typeof a, typeof e, key);
    const sample = typeof a === 'function' ? a(3, '3') : a;
    assert.match(String(sample), /[؀-ۿ]/, `${key} is not Arabic`);
  }
  // Arabic counts agree with their noun.
  assert.equal(moneyPlacesCopy.ar.estimateFrom(2), 'تقدير من آخر دفعتين');
  assert.equal(moneyPlacesCopy.ar.estimateFrom(3), 'تقدير من آخر 3 دفعات');
  assert.equal(moneyPlacesCopy.ar.timelineA11y(1), 'دفعة واحدة خلال الأيام الثلاثين القادمة');
  assert.equal(moneyPlacesCopy.en.timelineA11y(1), '1 payment in the next 30 days');
});

test('the copy never claims Wafra sends or moves money', () => {
  for (const lang of ['en']) {
    for (const [key, value] of Object.entries(moneyPlacesCopy[lang])) {
      const text = typeof value === 'function' ? value(2, '2') : value;
      assert.doesNotMatch(String(text), /\b(Pay in full|Pay minimum|We paid|sent your payment|transferred)\b/i, key);
    }
  }
});
