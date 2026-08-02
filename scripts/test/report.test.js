const {
  buildExpenseReportHtml,
  escapeReportHtml,
  reportExpenses,
} = require('./build/reimbursement-report.js');

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

if (!process.exitCode) console.log(`${passed} report tests passed`);
