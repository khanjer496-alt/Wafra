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


// ---------------------------------------------------------------------------
// Card diagnostic export.
//
// The user's reported bugs are double-counting and cards being read wrongly,
// and the existing "Improve accuracy" export cannot show either: it lists only
// messages the parser was UNSURE about, and `raw` is deliberately discarded for
// anything parsed confidently. A card statement that parsed cleanly and was
// then filed against the wrong account leaves no trace in that export at all.
//
// So this one reports what the LEDGER DID with every card row, which is where
// a double count is actually visible.
const { cardDiagnostics } = require('./build/accuracy.js');

const cardAccounts = [
  { id: 'card-1', name: 'FAB Credit', kind: 'card', cardType: 'credit', last4: '4110', openingFils: 0, color: '#000' },
  { id: 'bank-1', name: 'ADCB', kind: 'bank', last4: '8783', openingFils: 0, color: '#000' },
];
const cardTx = [
  // A purchase on the card: ordinary spending.
  { id: 't1', date: '2026-08-01', title: 'Noon', amountFils: 14900, type: 'expense', category: 'shopping', accountId: 'card-1' },
  // The two legs of ONE card payment. If both are counted, the user sees the
  // payment twice — the exact complaint.
  { id: 't2', date: '2026-08-02', title: 'Card payment', amountFils: 50000, type: 'expense', category: 'other', accountId: 'bank-1', isTransfer: true, cardPaymentSide: 'debit' },
  { id: 't3', date: '2026-08-02', title: 'Payment received', amountFils: 50000, type: 'income', category: 'other', accountId: 'card-1', isTransfer: true, cardPaymentSide: 'receipt' },
  // Not card-related at all — must not appear.
  { id: 't4', date: '2026-08-03', title: 'Salary', amountFils: 1850000, type: 'income', category: 'salary', accountId: 'bank-1' },
];
const cardDues = [
  { id: 'due-1', accountId: 'card-1', totalDueFils: 120900, minDueFils: 12090, dueDate: '2026-08-15', paidFils: 50000 },
];
const diag = cardDiagnostics({ accounts: cardAccounts, transactions: cardTx, cardDues });

ok('the diagnostic names the card and its last4', /FAB Credit/.test(diag) && /4110/.test(diag));
ok('it reports the statement, its due date and what has been paid',
  /120,?900|1,209\.00/.test(diag.replace(/\s+/g,' ')) && /2026-08-15/.test(diag));
ok('both legs of a card payment are listed, with their sides',
  /debit/.test(diag) && /receipt/.test(diag));
ok('a card purchase is included', /Noon/.test(diag));
ok('an unrelated salary is NOT included', !/Salary/.test(diag));
ok('the counted totals are stated, which is where a double count shows',
  /counted/i.test(diag));
ok('long digit runs are masked', !/\b\d{5,}\b/.test(diag));


// ── the diagnostic has to answer "how was net worth calculated?" ──
//
// It could not, and neither could the app. Net worth is a sum over accounts,
// and the two ways it goes wrong are both invisible in a total: one physical
// card held as several account rows, each with its own balance snapshot; and
// an account dormant for months, hidden from Wallet's list but still counted.
{
  const A = (o) => ({ kind: 'card', openingFils: 0, color: '#000', ...o });
  const nwAccounts = [
    // Liv is Emirates NBD's digital bank: one card, two account rows.
    A({ id: '1', name: 'Liv Debit Card', last4: '8783', cardType: 'debit', bankName: 'Liv',
        snapshotKind: 'balance', snapshotFils: 3584802 }),
    A({ id: '2', name: 'Emirates NBD Card', last4: '8783', bankName: 'Emirates NBD',
        snapshotKind: 'balance', snapshotFils: 3584802 }),
    // An available limit is not money you have.
    A({ id: '3', name: 'FAB Credit Card', last4: '5793', cardType: 'credit', bankName: 'FAB',
        snapshotKind: 'limit', snapshotFils: 1480882 }),
    // A credit card can only ever subtract.
    A({ id: '4', name: 'ADCB Credit Card', last4: '7720', cardType: 'credit', bankName: 'ADCB',
        snapshotKind: 'outstanding', snapshotFils: 71474 }),
    // Silent since 2022: gone from Wallet's list, still in the total.
    A({ id: '5', name: 'Old FAB Card', last4: '8722', bankName: 'FAB',
        snapshotKind: 'balance', snapshotFils: 44010 }),
    A({ id: '6', name: 'Hidden card', last4: '9999', cardType: 'debit', archived: true,
        snapshotKind: 'balance', snapshotFils: 999900 }),
  ];
  const nwTx = [
    { id: 'x', accountId: '1', date: '2026-08-04', title: 'Shop', amountFils: 100, type: 'expense', category: 'other', source: 'sms' },
    { id: 'y', accountId: '5', date: '2022-05-11', title: 'Shop', amountFils: 100, type: 'expense', category: 'other', source: 'sms' },
  ];
  const nw = cardDiagnostics({ accounts: nwAccounts, transactions: nwTx, cardDues: [] });
  const flat = nw.replace(/\s+/g, ' ');

  ok('net worth: the headline figure is stated', /NET WORTH\s+AED/.test(nw));
  ok('net worth: the total equals the counted parts',
    /NET WORTH AED 71,421\.00/.test(flat), flat.slice(0, 200));
  ok('net worth: a quoted balance is counted, and says who quoted it',
    /\+35,848\.02 Liv Debit Card ·8783 \(balance quoted by the bank\)/.test(flat));
  ok('net worth: a credit card subtracts its outstanding',
    /-714\.74 ADCB Credit Card ·7720 \(outstanding quoted by the bank\)/.test(flat));
  ok('net worth: an available limit is excluded, with the reason',
    /FAB Credit Card ·5793 — the bank quoted a limit, not an outstanding balance/.test(flat));
  ok('net worth: a hidden account is excluded, with the reason',
    /Hidden card ·9999 — you hid this account/.test(flat));
  // The two findings the user actually needs out of this file.
  ok('net worth: a dormant account still counting is flagged where it counts',
    /Old FAB Card[^[]*\[SILENT SINCE 2022-05-11 — hidden from Wallet's list, still counted here\]/.test(flat));
  ok('net worth: two counted accounts sharing a last four are flagged as a possible double count',
    /·8783 <-- MORE THAN ONE OF THESE IS COUNTED/.test(flat));
  // ...and NOT flagged when only one of them contributes, or the warning is
  // noise on every card the app has ever seen twice.
  const oneCounts = cardDiagnostics({
    accounts: [nwAccounts[0], { ...nwAccounts[1], snapshotKind: undefined, snapshotFils: undefined }],
    transactions: nwTx, cardDues: [],
  }).replace(/\s+/g, ' ');
  ok('net worth: a shared last four where only one side counts is not flagged',
    /·8783/.test(oneCounts) && !/MORE THAN ONE OF THESE IS COUNTED/.test(oneCounts));
}

if (!process.exitCode) console.log(`${passed} report tests passed`);
