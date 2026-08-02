const {
  buildExpenseReportHtml,
  escapeReportHtml,
  reportExpenses,
} = require('./build/reimbursement-report.js');
const { internalTransferIds, liveAccountIds } = require('./build/ledger.js');

let passed = 0;
function ok(name, condition) {
  if (!condition) {
    console.error(`FAIL  ${name}`);
    process.exitCode = 1;
    return;
  }
  passed += 1;
}

const accounts = [
  { id: 'work', name: 'Work <Card>', kind: 'card', openingFils: 0, color: '#000' },
];
const rows = [
  {
    id: 'expense',
    type: 'expense',
    amountFils: 12345,
    category: 'transport',
    accountId: 'work',
    title: 'Careem & Co <script>alert(1)</script>',
    note: '"Airport" ride',
    date: '2026-07-10',
  },
  {
    id: 'transfer',
    type: 'expense',
    amountFils: 99900,
    category: 'other',
    accountId: 'work',
    title: 'Card settlement',
    date: '2026-07-11',
    isTransfer: true,
  },
  {
    id: 'income',
    type: 'income',
    amountFils: 500000,
    category: 'salary',
    accountId: 'work',
    title: 'Salary',
    date: '2026-07-12',
  },
];

ok('escapes all HTML metacharacters', escapeReportHtml(`<&>"'`) === '&lt;&amp;&gt;&quot;&#39;');
ok('report range keeps reimbursable expense only', reportExpenses(rows, '2026-07-01', '2026-07-31').length === 1);

const english = buildExpenseReportHtml({
  transactions: rows,
  accounts,
  currency: 'AED',
  language: 'en',
  from: '2026-07-01',
  to: '2026-07-31',
  generatedAt: new Date('2026-07-31T12:00:00Z'),
});
ok('report is a well-formed printable document', english.startsWith('<!DOCTYPE html>') && english.includes('@page { size: A4;'));
ok('merchant markup cannot execute', !english.includes('<script>') && english.includes('&lt;script&gt;'));
ok('account markup cannot execute', english.includes('Work &lt;Card&gt;'));
ok('transfer and income are not exported', !english.includes('Card settlement') && !english.includes('Salary'));
ok('expense value and count are summarized', english.includes('123.45') && english.includes('1 entries'));

const arabic = buildExpenseReportHtml({
  transactions: rows,
  accounts,
  currency: 'AED',
  language: 'ar',
  from: '2026-07-01',
  to: '2026-07-31',
  generatedAt: new Date('2026-07-31T12:00:00Z'),
});
ok('Arabic export is RTL and translated', arabic.includes('lang="ar" dir="rtl"') && arabic.includes('تقرير مصروفات'));
ok('Arabic category label is translated', arabic.includes('تنقّل'));

// A legacy own-account sweep (structural "Outgoing/Incoming transfer" title,
// no isTransfer flag because it predates the flag) and spending on an
// archived account must not reach the export either — the same rule every
// other total in the app applies. Before this, reportExpenses only ever
// checked the isTransfer flag and never looked at the account list at all.
const multiAccounts = [
  { id: 'work', name: 'Work <Card>', kind: 'card', openingFils: 0, color: '#000' },
  { id: 'savings', name: 'Savings', kind: 'bank', openingFils: 0, color: '#000' },
  { id: 'old', name: 'Old Card', kind: 'card', openingFils: 0, color: '#000', archived: true },
];
const sweepRows = [
  {
    id: 'sweep-out', type: 'expense', amountFils: 500000, category: 'other',
    accountId: 'work', title: 'Outgoing transfer', date: '2026-07-15',
  },
  {
    id: 'sweep-in', type: 'income', amountFils: 500000, category: 'business',
    accountId: 'savings', title: 'Incoming transfer', date: '2026-07-15',
  },
  {
    id: 'hidden-spend', type: 'expense', amountFils: 15000, category: 'shopping',
    accountId: 'old', title: 'Old Card Purchase', date: '2026-07-16',
  },
  {
    id: 'real', type: 'expense', amountFils: 8800, category: 'groceries',
    accountId: 'work', title: 'Carrefour', date: '2026-07-17',
  },
];
const liveMulti = liveAccountIds(multiAccounts);
const internalMulti = internalTransferIds(sweepRows, liveMulti);
ok('reportExpenses drops a legacy structural transfer and an archived account',
  (() => {
    const guarded = reportExpenses(sweepRows, '2026-07-01', '2026-07-31', liveMulti, internalMulti);
    return guarded.length === 1 && guarded[0].id === 'real';
  })());
ok('reportExpenses keeps the sweep without the exclusion, proving it is the guard doing the work',
  reportExpenses(sweepRows, '2026-07-01', '2026-07-31').some((tx) => tx.id === 'sweep-out'));

const withSweep = buildExpenseReportHtml({
  transactions: sweepRows,
  accounts: multiAccounts,
  currency: 'AED',
  language: 'en',
  from: '2026-07-01',
  to: '2026-07-31',
  generatedAt: new Date('2026-07-31T12:00:00Z'),
});
ok('the sweep and the archived-account purchase are not exported',
  !withSweep.includes('Outgoing transfer') &&
    !withSweep.includes('Incoming transfer') &&
    !withSweep.includes('Old Card Purchase'));
ok('the real purchase still exports', withSweep.includes('Carrefour'));

if (!process.exitCode) console.log(`${passed} report tests passed`);
