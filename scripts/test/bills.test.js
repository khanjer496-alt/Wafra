/**
 * Reminders, and the two questions Flow and Bills get wrong quietly.
 *
 * Every assertion here failed before the change that follows it, and each one
 * is about money being restated at the wrong size or against the wrong set of
 * rows — the class of defect this app produces that nobody notices, because
 * the screen still looks like a screen.
 *
 *   1. A YEARLY bill filed as monthly. `Bill` had no cadence, so an Amazon
 *      Prime renewal of AED 310 a year became AED 310 a MONTH: twelve times
 *      the money, in the Reminders list and in every notification derived
 *      from it.
 *   2. A bill auto-reconciled against a charge the rest of the app does not
 *      count. `billsForMonth` asked `isSpending(t)` with no live/internal
 *      sets, so a debit on an ARCHIVED card flipped a bill to "Paid" while
 *      Flow's Total out never moved — and a bill that says paid is a bill the
 *      user stops looking at.
 *   3. Flow recomputing per-budget spend the month summary already holds. Not
 *      a wrong figure but a slow one, and the substitution is only safe if
 *      the two really are the same number — including over split rows,
 *      archived accounts and paired internal transfers, which is what the
 *      last block pins.
 */
const fs = require('fs');
const path = require('path');
const bills = require('./build/bills');
const fmt = require('./build/format');
const insights = require('./build/insights');
const { internalTransferIds, liveAccountIds } = require('./build/ledger');

let pass = 0;
let fail = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name}\n    got ${a}\n    want ${e}`);
  }
}
function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name} ${detail}`);
  }
}

/* ── 1. A yearly bill is due once a year ─────────────────────────────── */

const yearly = {
  id: 'prime',
  title: 'Amazon Prime',
  category: 'shopping',
  amountFils: 31_000,
  dueDay: 12,
  yearlyOnISO: '2026-08-12',
  paidMonths: [],
};
const monthly = {
  id: 'dewa',
  title: 'DEWA Bill',
  category: 'utilities',
  amountFils: 45_000,
  dueDay: 12,
  paidMonths: [],
};

const rowsIn = (billList, date) => bills.billsForMonth(billList, [], date).map((r) => r.bill.id);

eq(
  'yearly: due in its anniversary month',
  rowsIn([yearly, monthly], new Date(2026, 7, 1)).sort(),
  ['dewa', 'prime'],
);
// The whole defect, in one line: every other month, the AED 310 charge is not
// owed and must not be listed or notified.
eq('yearly: absent from every other month', rowsIn([yearly, monthly], new Date(2026, 8, 1)), [
  'dewa',
]);
eq('yearly: absent eleven months of twelve', rowsIn([yearly, monthly], new Date(2027, 1, 1)), [
  'dewa',
]);
// The year in the anchor records which anniversary was OBSERVED, not the only
// one that counts — otherwise the reminder fires once and never again.
eq('yearly: recurs in following years', rowsIn([yearly], new Date(2027, 7, 1)), ['prime']);
eq(
  'yearly: the due date is the anniversary, not the month start',
  bills.billsForMonth([yearly], [], new Date(2026, 7, 1))[0].dueISO,
  '2026-08-12',
);
eq(
  'yearly: 29 Feb falls back to the 28th in a common year',
  bills.yearlyDueInMonth('2027-02', '2028-02-29'),
  '2027-02-28',
);
eq(
  'yearly: 29 Feb is itself in a leap year',
  bills.yearlyDueInMonth('2028-02', '2028-02-29'),
  '2028-02-29',
);
eq('yearly: a month that does not contain the anniversary', bills.yearlyDueInMonth('2026-03', '2026-08-12'), null);

// A money month starting on a salary day spans two calendar months, and a
// December one spans two calendar YEARS. Both candidate years are tried.
fmt.setMonthStartDay(25);
eq(
  'yearly: anniversary in the second calendar year of a money month',
  bills.yearlyDueInMonth('2026-12', '2025-01-03'),
  '2027-01-03',
);
eq(
  'yearly: anniversary in the first calendar year of a money month',
  bills.yearlyDueInMonth('2026-12', '2025-12-28'),
  '2026-12-28',
);
eq(
  'monthly bills are untouched by any of this',
  bills.billsForMonth([monthly], [], new Date(2026, 7, 1))[0].dueISO,
  '2026-08-12',
);
fmt.setMonthStartDay(1);

/* ── 2. Reconciliation only against money the app counts ─────────────── */

const accounts = [
  { id: 'live', name: 'Live', kind: 'card', openingFils: 0, color: '#000' },
  { id: 'old', name: 'Old', kind: 'card', openingFils: 0, color: '#000', archived: true },
];
const charge = (accountId) => ({
  id: `tx-${accountId}`,
  type: 'expense',
  amountFils: 45_000,
  category: 'utilities',
  accountId,
  title: 'DEWA Bill',
  date: '2026-08-10',
});
const live = liveAccountIds(accounts);
const august = new Date(2026, 7, 18);

eq(
  'reconcile: a charge on a live account settles the bill',
  bills.billsForMonth([monthly], [charge('live')], august, live, new Set())[0].status,
  'paid',
);
// The defect: an archived card's debit is excluded from Flow's Total out, from
// budgets and from net worth — it must not be the evidence that a bill is
// settled either.
eq(
  'reconcile: a charge on an ARCHIVED account does not settle the bill',
  bills.billsForMonth([monthly], [charge('old')], august, live, new Set())[0].status,
  'overdue',
);
// Both halves of a move between the user's own accounts are excluded the same
// way, and by the same argument.
eq(
  'reconcile: a paired internal transfer does not settle the bill',
  bills.billsForMonth([monthly], [charge('live')], august, live, new Set(['tx-live']))[0].status,
  'overdue',
);
// The sets stay optional: a caller with no accounts to hand (tests, the
// importer) still gets the transfer rule and the old behaviour.
eq(
  'reconcile: still works with no account sets passed',
  bills.billsForMonth([monthly], [charge('old')], august)[0].status,
  'paid',
);

/* ── 3. Per-category spend has exactly one answer ────────────────────── */

/**
 * Flow's Limits section reads its per-budget spend out of the month summary
 * instead of walking the ledger once per budget. That is only allowed because
 * the two agree by construction — same rows, same predicates, same period —
 * and this is the assertion that says so, over the three cases where the two
 * implementations could plausibly diverge: a split row counted per part, a
 * row on an archived account, and a paired internal transfer.
 */
{
  const accts = [
    { id: 'a1', name: 'Main', kind: 'bank', openingFils: 0, color: '#000' },
    { id: 'a2', name: 'Hidden', kind: 'card', openingFils: 0, color: '#000', archived: true },
  ];
  const txs = [
    {
      id: 't1',
      type: 'expense',
      amountFils: 20_000,
      category: 'groceries',
      accountId: 'a1',
      title: 'Carrefour',
      date: '2026-08-03',
      splits: [
        { category: 'groceries', amountFils: 15_000 },
        { category: 'shopping', amountFils: 5_000 },
      ],
    },
    {
      id: 't2',
      type: 'expense',
      amountFils: 8_000,
      category: 'groceries',
      accountId: 'a2',
      title: 'Union Coop',
      date: '2026-08-05',
    },
    {
      id: 't3',
      type: 'expense',
      amountFils: 50_000,
      category: 'other',
      accountId: 'a1',
      title: 'Own account transfer',
      date: '2026-08-06',
      isTransfer: true,
    },
    {
      id: 't4',
      type: 'income',
      amountFils: 50_000,
      category: 'other',
      accountId: 'a2',
      title: 'Incoming transfer',
      date: '2026-08-06',
    },
    {
      id: 't5',
      type: 'expense',
      amountFils: 9_000,
      category: 'dining',
      accountId: 'a1',
      title: 'Ravi',
      date: '2026-08-07',
    },
  ];
  const liveIds = liveAccountIds(accts);
  const internal = internalTransferIds(txs, accts);
  const summary = insights.summarizeMonth(txs, '2026-08', liveIds, internal);
  const byCategory = new Map(summary.byCategory.map((c) => [c.category, c.totalFils]));

  for (const category of ['groceries', 'shopping', 'dining', 'travel']) {
    eq(
      `limits: summary and spentInMonthForCategory agree on ${category}`,
      byCategory.get(category) ?? 0,
      insights.spentInMonthForCategory(txs, '2026-08', category, liveIds, internal),
    );
  }
  // Not a vacuous agreement: the fixtures above really do exercise all three
  // exclusions, so a regression in either implementation moves a number.
  eq('limits: a split row is counted per part', byCategory.get('groceries'), 15_000);
  eq('limits: the archived account contributes nothing', byCategory.get('groceries'), 15_000);
  ok('limits: the paired transfer is excluded', !byCategory.has('other'));
}

/* ── 4. The screens that create bills ────────────────────────────────── */

/**
 * `billFromSubscription` is where a detected subscription becomes a `Bill`,
 * and the defect was that there were TWO copies of that conversion inline in
 * the JSX — a row button and a sheet button — each passing the raw charge with
 * no cadence. A source assertion rather than a behavioural one because the
 * conversion lives in a React screen the harness cannot transpile; what it
 * guards is that neither call site grows its own copy again.
 */
{
  // Comments stripped, as contracts.test.js does: a regex over raw source
  // cannot tell a call from the sentence explaining why there is no call, and
  // the accurate comment above `billFromSubscription` names the very field the
  // assertion below counts.
  const src = fs
    .readFileSync(path.join(__dirname, '../../src/app/(tabs)/bills.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
  const addBillCalls = src.match(/addBill\(/g) ?? [];
  eq('bills.tsx: three addBill call sites (row, sheet, adder)', addBillCalls.length, 3);
  eq(
    'bills.tsx: both subscription call sites go through billFromSubscription',
    (src.match(/addBill\(billFromSubscription\(/g) ?? []).length,
    2,
  );
  // The raw charge is read in ONE place — the helper, where the cadence that
  // qualifies it is read too. A second reading is a second call site that has
  // forgotten about yearly.
  eq(
    'bills.tsx: the raw subscription charge is read exactly once',
    (src.match(/\.avgAmountFils/g) ?? []).length -
      (src.match(/formatAED\(sub\.avgAmountFils/g) ?? []).length,
    1,
  );
  ok(
    'bills.tsx: the remind affordance is gated on a representable cadence',
    (src.match(/remindable\((sub|detail)\)/g) ?? []).length === 2,
  );
  // Save was enabled for "45", "0" and "12.5" — values saveBill rejects — so
  // the tap silently did nothing with the sheet still open.
  ok(
    'bills.tsx: Save is disabled by the same rule saveBill enforces',
    /disabled=\{!draftValid\}/.test(src) && /if \(!draftValid/.test(src),
  );
  // An expense booked to an archived account is excluded from every total, so
  // the bill reads "Paid" while the money never appears.
  ok(
    'bills.tsx: marking a bill paid prefers an account still in play',
    /state\.accounts\.find\(\(a\) => !a\.archived\)\?\.id/.test(src),
  );
}

console.log(`\nbills.test.js: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
