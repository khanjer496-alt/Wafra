/**
 * Cash out and spending answer different questions. These tests exercise the
 * shipping TypeScript modules directly so their settlement-dedupe policy
 * cannot drift behind a test-only copy.
 */
const fs = require('fs');
const Module = require('module');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const originalResolveFilename = Module._resolveFilename;
const originalTsLoader = require.extensions['.ts'];

require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

Module._resolveFilename = function resolveWafraAlias(request, parent, isMain, options) {
  if (request.startsWith('@/lib/')) {
    const filename = path.join(root, 'src/lib', `${request.slice('@/lib/'.length)}.ts`);
    return originalResolveFilename.call(this, filename, parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const { summarizeCashOutflow } = require('../../src/lib/cash-flow.ts');
const { reconcileCaptureDuplicates } = require('../../src/lib/dedupe.ts');
const { setMonthStartDay } = require('../../src/lib/format.ts');
const { summarizeMonth } = require('../../src/lib/insights.ts');
const { internalTransferIds, liveAccountIds } = require('../../src/lib/ledger.ts');

Module._resolveFilename = originalResolveFilename;
if (originalTsLoader) require.extensions['.ts'] = originalTsLoader;
else delete require.extensions['.ts'];

let pass = 0;
let fail = 0;
function ok(name, condition, detail) {
  if (condition) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, `got ${actual}, want ${expected}`);
}

const accounts = [
  { id: 'bank', name: 'Bank', kind: 'bank', openingFils: 0, color: '#111' },
  { id: 'credit', name: 'Credit', kind: 'card', cardType: 'credit', openingFils: 0, color: '#222' },
  { id: 'debit', name: 'Debit', kind: 'card', cardType: 'debit', openingFils: 0, color: '#333' },
  { id: 'cash', name: 'Cash', kind: 'cash', openingFils: 0, color: '#444' },
  { id: 'hidden', name: 'Hidden', kind: 'bank', openingFils: 0, color: '#555', archived: true },
];

function tx(id, amountFils, over = {}) {
  return {
    id,
    type: 'expense',
    amountFils,
    category: 'other',
    accountId: 'bank',
    title: 'Entry',
    date: '2026-07-10',
    source: 'sms',
    ...over,
  };
}

const transactions = [
  tx('bank-purchase', 10000),
  tx('credit-purchase', 20000, { accountId: 'credit' }),
  tx('debit-purchase', 30000, { accountId: 'debit' }),
  tx('cash-purchase', 40000, { accountId: 'cash' }),
  // One settlement, observed from both sides on adjacent dates.
  tx('payment-debit', 50000, {
    type: 'income', accountId: 'credit', isTransfer: true, cardPaymentSide: 'debit',
  }),
  tx('payment-receipt', 50000, {
    type: 'income', accountId: 'credit', isTransfer: true, cardPaymentSide: 'receipt',
    date: '2026-07-11',
  }),
  // Same-side confirmations are separate genuine payments and must remain so.
  tx('payment-one', 60000, {
    type: 'income', accountId: 'credit', isTransfer: true, cardPaymentSide: 'receipt',
    date: '2026-07-15',
  }),
  tx('payment-two', 60000, {
    type: 'income', accountId: 'credit', isTransfer: true, cardPaymentSide: 'receipt',
    date: '2026-07-15', ts: 2,
  }),
  tx('own-out', 70000, { isTransfer: true, title: 'Own account transfer' }),
  tx('own-in', 70000, {
    type: 'income', accountId: 'debit', title: 'Incoming transfer', date: '2026-07-11',
  }),
  tx('external-transfer', 80000, { isTransfer: true, title: 'Transfer to another person' }),
  tx('hidden-expense', 90000, { accountId: 'hidden' }),
  tx('other-period', 100000, { date: '2026-06-10' }),
];

const state = {
  hydrated: true,
  accounts,
  transactions,
  budgets: [], bills: [], cardDues: [], goals: [], merchantOverrides: {}, accountHints: {},
  notSubscriptions: [], lastScanTs: 0, onboarded: true, userName: '', appLock: false,
  monthStartDay: 1, pro: true, privateMode: false, dailySummary: false, trialStartTs: 0,
  marketId: 'AE', language: 'en', themePreference: 'system',
};
const period = { mode: 'month', key: '2026-07' };
const cashOut = summarizeCashOutflow(state, period);
const live = liveAccountIds(accounts);
const internal = internalTransferIds(transactions, accounts);
const spending = summarizeMonth(transactions, period, live, internal);

eq('credit purchases count in spending but not cash out', spending.expenseFils, 100000);
eq('cash out includes funded spending, settlements once, and external transfers', cashOut.totalFils, 330000);
eq('cash out explains the card-payment portion without counting purchases twice',
  cashOut.cardPaymentsFils, 170000);
eq('cash out explains the immediately-funded account portion',
  cashOut.accountOutflowFils, 160000);
ok('opposite settlement alerts are represented by one canonical row',
  Number(cashOut.transactionIds.has('payment-debit')) +
    Number(cashOut.transactionIds.has('payment-receipt')) === 1);
ok('two genuine equal same-side card payments remain two cash movements',
  cashOut.transactionIds.has('payment-one') && cashOut.transactionIds.has('payment-two'));
const twoManualsOneReceiptState = {
  ...state,
  transactions: [
    tx('same-day-manual-one', 100000, {
      type: 'income', accountId: 'credit', source: 'manual', isTransfer: true,
      title: 'Card Payment', date: '2026-07-10', ts: 1,
    }),
    tx('same-day-manual-two', 100000, {
      type: 'income', accountId: 'credit', source: 'manual', isTransfer: true,
      title: 'Card Payment', date: '2026-07-10', ts: 2,
    }),
    tx('same-day-receipt', 100000, {
      type: 'income', accountId: 'credit', isTransfer: true, cardPaymentSide: 'receipt',
      date: '2026-07-10', ts: 3,
    }),
  ],
};
eq('one receipt confirms only one of two deliberate same-day manual payments',
  summarizeCashOutflow(twoManualsOneReceiptState, period).totalFils,
  200000);
ok('both deliberate manual payment claims survive the compat prefilter',
  summarizeCashOutflow(twoManualsOneReceiptState, period).transactionIds.size === 2);
ok('neither half of a paired own-account transfer is cash out',
  !cashOut.transactionIds.has('own-out') && !cashOut.transactionIds.has('own-in'));
ok('external outgoing transfers remain visible as cash leaving the ledger',
  cashOut.transactionIds.has('external-transfer'));
ok('archived accounts and other periods stay outside the figure',
  !cashOut.transactionIds.has('hidden-expense') && !cashOut.transactionIds.has('other-period'));

function settlementAcross(debitDate, receiptDate) {
  return reconcileCaptureDuplicates([
    tx('boundary-debit', 100000, {
      type: 'income', accountId: 'credit', isTransfer: true, cardPaymentSide: 'debit',
      date: debitDate, ts: Date.parse(`${debitDate}T23:59:00Z`),
    }),
    tx('boundary-receipt', 100000, {
      type: 'income', accountId: 'credit', isTransfer: true, cardPaymentSide: 'receipt',
      date: receiptDate, ts: Date.parse(`${receiptDate}T00:01:00Z`),
    }),
  ]);
}

const midnightSettlement = settlementAcross('2026-07-31', '2026-08-01');
const midnightState = { ...state, transactions: midnightSettlement };
ok('settlement reconciliation keeps the receipt plus the funding-account date',
  midnightSettlement.length === 1 &&
    midnightSettlement[0].cardPaymentSide === 'receipt' &&
    midnightSettlement[0].cashOutDate === '2026-07-31');
eq('a midnight settlement remains cash out in the debit calendar month',
  summarizeCashOutflow(midnightState, { mode: 'month', key: '2026-07' }).totalFils, 100000);
eq('the receipt month does not count the same settlement again',
  summarizeCashOutflow(midnightState, { mode: 'month', key: '2026-08' }).totalFils, 0);
eq('a custom range follows the funding date, not the receipt date',
  summarizeCashOutflow(midnightState, {
    mode: 'range', from: '2026-07-31', to: '2026-07-31',
  }).totalFils, 100000);

setMonthStartDay(25);
const moneyMonthSettlement = settlementAcross('2026-08-24', '2026-08-25');
const moneyMonthState = { ...state, transactions: moneyMonthSettlement };
eq('a salary-cycle boundary keeps cash out in the funding money month',
  summarizeCashOutflow(moneyMonthState, { mode: 'month', key: '2026-07' }).totalFils, 100000);
eq('the next salary-cycle month does not count the receipt again',
  summarizeCashOutflow(moneyMonthState, { mode: 'month', key: '2026-08' }).totalFils, 0);
setMonthStartDay(1);

const crossAccountState = {
  ...state,
  transactions: [
    tx('bank-payment-debit', 120000, {
      accountId: 'bank', isTransfer: true, cardPaymentSide: 'debit',
      date: '2026-07-31', ts: Date.parse('2026-07-31T23:59:00Z'),
    }),
    tx('card-payment-receipt', 120000, {
      type: 'income', accountId: 'credit', isTransfer: true, cardPaymentSide: 'receipt',
      date: '2026-08-01', ts: Date.parse('2026-08-01T00:01:00Z'),
    }),
  ],
};
const crossJuly = summarizeCashOutflow(crossAccountState, { mode: 'month', key: '2026-07' });
eq('a bank-account debit plus card receipt is one cash movement', crossJuly.totalFils, 120000);
ok('the absorbed cross-account debit is not counted beside the canonical receipt',
  crossJuly.transactionIds.size === 1 && crossJuly.transactionIds.has('card-payment-receipt'));
eq('the cross-account receipt month does not count the payment again',
  summarizeCashOutflow(crossAccountState, { mode: 'month', key: '2026-08' }).totalFils, 0);

const twoCrossAccountPayments = {
  ...state,
  transactions: [
    tx('bank-debit-one', 90000, {
      accountId: 'bank', isTransfer: true, cardPaymentSide: 'debit',
      date: '2026-07-10', ts: 1,
    }),
    tx('bank-debit-two', 90000, {
      accountId: 'bank', isTransfer: true, cardPaymentSide: 'debit',
      date: '2026-07-10', ts: 2,
    }),
    tx('card-receipt-one', 90000, {
      type: 'income', accountId: 'credit', isTransfer: true, cardPaymentSide: 'receipt',
      date: '2026-07-10', ts: 3,
    }),
    tx('card-receipt-two', 90000, {
      type: 'income', accountId: 'credit', isTransfer: true, cardPaymentSide: 'receipt',
      date: '2026-07-10', ts: 4,
    }),
  ],
};
eq('two equal cross-account settlement pairs remain two payments',
  summarizeCashOutflow(twoCrossAccountPayments, period).totalFils, 180000);

const competingCrossAccountLegs = {
  ...state,
  transactions: [
    tx('cross-receipt-one', 100000, {
      type: 'income', accountId: 'credit', isTransfer: true, cardPaymentSide: 'receipt',
      date: '2026-07-30', ts: 1,
    }),
    tx('cross-receipt-two', 100000, {
      type: 'income', accountId: 'credit', isTransfer: true, cardPaymentSide: 'receipt',
      date: '2026-07-31', ts: 2,
    }),
    tx('cross-debit-one', 100000, {
      accountId: 'bank', isTransfer: true, cardPaymentSide: 'debit',
      date: '2026-07-31', ts: 3,
    }),
    tx('cross-debit-two', 100000, {
      accountId: 'bank', isTransfer: true, cardPaymentSide: 'debit',
      date: '2026-08-01', ts: 4,
    }),
  ],
};
eq('competing cross-account observations keep the first funding movement in July',
  summarizeCashOutflow(competingCrossAccountLegs, { mode: 'month', key: '2026-07' }).totalFils,
  100000);
eq('competing cross-account observations keep the second funding movement in August',
  summarizeCashOutflow(competingCrossAccountLegs, { mode: 'month', key: '2026-08' }).totalFils,
  100000);
ok('four cross-account observations collapse to exactly two canonical payments',
  summarizeCashOutflow(competingCrossAccountLegs, {
    mode: 'range', from: '2026-07-01', to: '2026-08-31',
  }).transactionIds.size === 2);

const unmatchedDebitState = {
  ...state,
  transactions: [tx('unmatched-debit', 130000, {
    accountId: 'bank', isTransfer: true, cardPaymentSide: 'debit',
  })],
};
eq('an unmatched explicit debit observation still counts once',
  summarizeCashOutflow(unmatchedDebitState, period).totalFils, 130000);

const manualReceiptAndDebitState = {
  ...state,
  transactions: [
    tx('manual-paid', 100000, {
      type: 'income', accountId: 'credit', source: 'manual', isTransfer: true,
      title: 'Card Payment',
      date: '2026-07-10', ts: Date.parse('2026-07-10T12:00:00Z'),
    }),
    tx('card-receipt-after-manual', 100000, {
      type: 'income', accountId: 'credit', isTransfer: true, cardPaymentSide: 'receipt',
      date: '2026-07-12', ts: Date.parse('2026-07-12T12:01:00Z'),
    }),
    tx('bank-debit-after-manual', 100000, {
      accountId: 'bank', isTransfer: true, cardPaymentSide: 'debit',
      date: '2026-07-12', ts: Date.parse('2026-07-12T12:00:00Z'),
    }),
  ],
};
const manualReceiptAndDebit = summarizeCashOutflow(manualReceiptAndDebitState, period);
eq('Mark paid plus card receipt plus bank debit is one cash movement',
  manualReceiptAndDebit.totalFils, 100000);
ok('the absorbed receipt still connects its bank debit to the manual canonical row',
  manualReceiptAndDebit.transactionIds.size === 1 &&
    manualReceiptAndDebit.transactionIds.has('manual-paid'),
  `ids ${[...manualReceiptAndDebit.transactionIds].join(', ')}`);

const manualReceiptAndLaterDebitState = {
  ...state,
  transactions: [
    tx('manual-before-boundary', 100000, {
      type: 'income', accountId: 'credit', source: 'manual', isTransfer: true,
      title: 'Card Payment', date: '2026-07-30', ts: Date.parse('2026-07-30T12:00:00Z'),
    }),
    tx('receipt-before-boundary', 100000, {
      type: 'income', accountId: 'credit', isTransfer: true, cardPaymentSide: 'receipt',
      date: '2026-07-31', ts: Date.parse('2026-07-31T23:59:00Z'),
    }),
    tx('debit-after-boundary', 100000, {
      accountId: 'credit', isTransfer: true, cardPaymentSide: 'debit',
      date: '2026-08-01', ts: Date.parse('2026-08-01T00:01:00Z'),
    }),
  ],
};
eq('a later debit overrides the provisional manual cash-out month',
  summarizeCashOutflow(manualReceiptAndLaterDebitState, { mode: 'month', key: '2026-07' }).totalFils,
  0);
eq('a manual, receipt and later debit count once in the funding month',
  summarizeCashOutflow(manualReceiptAndLaterDebitState, { mode: 'month', key: '2026-08' }).totalFils,
  100000);

const manualSevenDaysBeforeBankLegs = {
  ...state,
  transactions: [
    tx('manual-seven-days-earlier', 140000, {
      type: 'income', accountId: 'credit', source: 'manual', isTransfer: true,
      title: 'Card Payment', date: '2026-07-24', ts: Date.parse('2026-07-24T12:00:00Z'),
    }),
    tx('receipt-seven-days-later', 140000, {
      type: 'income', accountId: 'credit', isTransfer: true, cardPaymentSide: 'receipt',
      date: '2026-07-31', ts: Date.parse('2026-07-31T23:59:00Z'),
    }),
    tx('debit-after-receipt-boundary', 140000, {
      accountId: 'credit', isTransfer: true, cardPaymentSide: 'debit',
      date: '2026-08-01', ts: Date.parse('2026-08-01T00:01:00Z'),
    }),
  ],
};
eq('a bank debit joins an absorbed adjacent receipt beyond the manual anchor window',
  summarizeCashOutflow(manualSevenDaysBeforeBankLegs, { mode: 'month', key: '2026-08' }).totalFils,
  140000);
eq('that three-leg payment does not remain in the manual month',
  summarizeCashOutflow(manualSevenDaysBeforeBankLegs, { mode: 'month', key: '2026-07' }).totalFils,
  0);

const manualThenDebitThenReceipt = {
  ...state,
  transactions: [
    tx('manual-before-debit', 150000, {
      type: 'income', accountId: 'credit', source: 'manual', isTransfer: true,
      title: 'Card Payment', date: '2026-07-24', ts: Date.parse('2026-07-24T12:00:00Z'),
    }),
    tx('debit-seven-days-later', 150000, {
      accountId: 'credit', isTransfer: true, cardPaymentSide: 'debit',
      date: '2026-07-31', ts: Date.parse('2026-07-31T23:59:00Z'),
    }),
    tx('receipt-after-debit-boundary', 150000, {
      type: 'income', accountId: 'credit', isTransfer: true, cardPaymentSide: 'receipt',
      date: '2026-08-01', ts: Date.parse('2026-08-01T00:01:00Z'),
    }),
  ],
};
eq('reverse bank-leg order still follows the actual debit date once',
  summarizeCashOutflow(manualThenDebitThenReceipt, { mode: 'month', key: '2026-07' }).totalFils,
  150000);
eq('the adjacent receipt does not repeat that reverse-order payment',
  summarizeCashOutflow(manualThenDebitThenReceipt, { mode: 'month', key: '2026-08' }).totalFils,
  0);

const twoManualClaimsThenReceipts = {
  ...state,
  transactions: [
    tx('manual-claim-one', 100000, {
      type: 'income', accountId: 'credit', source: 'manual', isTransfer: true,
      title: 'Card Payment', date: '2026-07-01', ts: 1,
    }),
    tx('manual-claim-two', 100000, {
      type: 'income', accountId: 'credit', source: 'manual', isTransfer: true,
      title: 'Card Payment', date: '2026-07-02', ts: 2,
    }),
    tx('receipt-for-claim-one', 100000, {
      type: 'income', accountId: 'credit', isTransfer: true, cardPaymentSide: 'receipt',
      date: '2026-07-08', ts: 3,
    }),
    tx('receipt-for-claim-two', 100000, {
      type: 'income', accountId: 'credit', isTransfer: true, cardPaymentSide: 'receipt',
      date: '2026-07-09', ts: 4,
    }),
  ],
};
eq('competing manual claims consume later receipts in order without a duplicate',
  summarizeCashOutflow(twoManualClaimsThenReceipts, period).totalFils,
  200000);
ok('two manual claims and two receipts retain exactly two canonical payments',
  summarizeCashOutflow(twoManualClaimsThenReceipts, period).transactionIds.size === 2);

const competingManualsOneConfirmation = {
  ...state,
  transactions: [
    tx('older-manual', 100000, {
      type: 'income', accountId: 'credit', source: 'manual', isTransfer: true,
      title: 'Card Payment', date: '2026-07-26', ts: 1,
    }),
    tx('nearer-manual', 100000, {
      type: 'income', accountId: 'credit', source: 'manual', isTransfer: true,
      title: 'Card Payment', date: '2026-08-01', ts: 2,
    }),
    tx('one-bank-confirmation', 100000, {
      accountId: 'credit', isTransfer: true, cardPaymentSide: 'debit',
      date: '2026-08-02', ts: 3,
    }),
  ],
};
eq('one confirmation matches the closest of two valid manual claims',
  summarizeCashOutflow(competingManualsOneConfirmation, { mode: 'month', key: '2026-07' }).totalFils,
  100000);
eq('the confirmed nearer manual remains one payment in its funding month',
  summarizeCashOutflow(competingManualsOneConfirmation, { mode: 'month', key: '2026-08' }).totalFils,
  100000);

const competingObservedLegs = {
  ...state,
  transactions: [
    tx('observed-debit-one', 100000, {
      accountId: 'credit', isTransfer: true, cardPaymentSide: 'debit',
      date: '2026-07-30', ts: 1,
    }),
    tx('observed-debit-two', 100000, {
      accountId: 'credit', isTransfer: true, cardPaymentSide: 'debit',
      date: '2026-07-31', ts: 2,
    }),
    tx('observed-receipt-one', 100000, {
      type: 'income', accountId: 'credit', isTransfer: true, cardPaymentSide: 'receipt',
      date: '2026-07-31', ts: 3,
    }),
    tx('observed-receipt-two', 100000, {
      type: 'income', accountId: 'credit', isTransfer: true, cardPaymentSide: 'receipt',
      date: '2026-08-01', ts: 4,
    }),
  ],
};
eq('competing debit and receipt observations preserve both real payments',
  summarizeCashOutflow(competingObservedLegs, { mode: 'month', key: '2026-07' }).totalFils,
  200000);
eq('neither observed receipt repeats those payments in the next month',
  summarizeCashOutflow(competingObservedLegs, { mode: 'month', key: '2026-08' }).totalFils,
  0);
ok('four competing observations collapse to exactly two canonical payments',
  summarizeCashOutflow(competingObservedLegs, { mode: 'range', from: '2026-07-01', to: '2026-08-31' })
    .transactionIds.size === 2);

const archivedCreditState = {
  ...crossAccountState,
  accounts: state.accounts.map((account) =>
    account.id === 'credit' ? { ...account, archived: true } : account),
};
eq('a live bank debit still counts when the receiving credit card is archived',
  summarizeCashOutflow(archivedCreditState, { mode: 'month', key: '2026-07' }).totalFils,
  120000);

const archivedBankState = {
  ...crossAccountState,
  accounts: state.accounts.map((account) =>
    account.id === 'bank' ? { ...account, archived: true } : account),
};
eq('a settlement funded by an archived bank account stays outside the live scope',
  summarizeCashOutflow(archivedBankState, { mode: 'month', key: '2026-07' }).totalFils,
  0);

// Older ledgers may still contain both sides. Exercise the reverse ordering:
// the card receipt arrives first and the funding-bank debit follows after the
// boundary. The canonical date exists only in the derived card-payment row;
// the cash-flow seam must not discard it while mapping back to persisted ids.
const legacyReverseRows = [
  tx('legacy-receipt', 110000, {
    type: 'income', accountId: 'credit', isTransfer: true, cardPaymentSide: 'receipt',
    date: '2026-07-31', ts: Date.parse('2026-07-31T23:59:00Z'),
  }),
  tx('legacy-debit', 110000, {
    type: 'income', accountId: 'credit', isTransfer: true, cardPaymentSide: 'debit',
    date: '2026-08-01', ts: Date.parse('2026-08-01T00:01:00Z'),
  }),
];
const legacyReverseState = { ...state, transactions: legacyReverseRows };
eq('a legacy receipt-first pair is absent from the receipt calendar month',
  summarizeCashOutflow(legacyReverseState, { mode: 'month', key: '2026-07' }).totalFils, 0);
eq('a legacy receipt-first pair appears once in the later debit calendar month',
  summarizeCashOutflow(legacyReverseState, { mode: 'month', key: '2026-08' }).totalFils, 110000);
eq('a reverse-order legacy custom range follows the later debit date',
  summarizeCashOutflow(legacyReverseState, {
    mode: 'range', from: '2026-08-01', to: '2026-08-01',
  }).totalFils, 110000);

setMonthStartDay(25);
const legacyMoneyMonthState = {
  ...state,
  transactions: [
    { ...legacyReverseRows[0], date: '2026-08-24', ts: Date.parse('2026-08-24T23:59:00Z') },
    { ...legacyReverseRows[1], date: '2026-08-25', ts: Date.parse('2026-08-25T00:01:00Z') },
  ],
};
eq('a legacy reverse pair is absent from the receipt salary-cycle month',
  summarizeCashOutflow(legacyMoneyMonthState, { mode: 'month', key: '2026-07' }).totalFils, 0);
eq('a legacy reverse pair appears once in the debit salary-cycle month',
  summarizeCashOutflow(legacyMoneyMonthState, { mode: 'month', key: '2026-08' }).totalFils, 110000);
setMonthStartDay(1);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
