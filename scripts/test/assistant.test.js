const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  ASSISTANT_PLAN_SCHEMA,
  assistantPlanFitsQuestion,
  parseAssistantPlan,
} = require('./build/assistant-contract.js');
const { fallbackAssistantQuestion } = require('./build/assistant-fallback.js');
const { runAssistantQuery } = require('./build/assistant-query.js');

let pass = 0;
const ok = (name, condition, detail) => {
  assert.ok(condition, detail);
  pass += 1;
  console.log(`✓ ${name}`);
};

const ROOT = path.join(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const account = (id, name, kind = 'bank', cardType) => ({
  id, name, kind, cardType, openingFils: 0, color: '#111111',
});
const transaction = (id, title, amountFils, type, category, accountId, date, extra = {}) => ({
  id, title, amountFils, type, category, accountId, date, source: 'sms', ...extra,
});
const state = {
  hydrated: true,
  ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  reviewTray: { schemaVersion: 1, pending: [], tombstones: [] },
  accounts: [
    account('bank-a', 'Liv bank'),
    account('bank-b', 'FAB bank'),
    account('card', 'FAB Credit Card', 'card', 'credit'),
  ],
  transactions: [
    transaction('salary', 'Salary', 850000, 'income', 'salary', 'bank-a', '2026-08-01'),
    transaction('talabat', 'Talabat sales', 116533, 'income', 'business', 'bank-a', '2026-08-11'),
    transaction('shop', 'Corner shop', 2500, 'expense', 'groceries', 'bank-a', '2026-08-08'),
    transaction('own-out', 'Own account transfer', 2000000, 'expense', 'other', 'bank-a', '2026-08-04', {
      isTransfer: true, ts: Date.parse('2026-08-04T10:00:00Z'),
    }),
    transaction('own-in', 'Incoming transfer', 2000000, 'income', 'other', 'bank-b', '2026-08-04', {
      ts: Date.parse('2026-08-04T10:01:00Z'),
    }),
  ],
  budgets: [],
  bills: [{
    id: 'sewa', title: 'SEWA', category: 'utilities', amountFils: 31395,
    dueDay: 20, autoDetected: true, paidMonths: [],
  }],
  cardDues: [],
  goals: [],
  onboardingPlan: null,
  onboardingCurrencyEvidence: 'AED',
  merchantOverrides: {},
  accountHints: {},
  notSubscriptions: [],
  lastScanTs: 0,
  onboarded: true,
  userName: 'there',
  appLock: false,
  monthStartDay: 1,
  pro: false,
  privateMode: true,
  captureOptOut: false,
  dailySummary: false,
  trialStartTs: 0,
  marketId: 'AE',
  language: 'en',
  themePreference: 'system',
};
const NOW = new Date('2026-08-14T12:00:00Z');
const plan = (patch = {}) => ({
  tool: 'search-transactions', period: 'current-month', from: null, to: null,
  query: null, direction: 'any', category: null, account: null,
  minimumMajor: null, maximumMajor: null, ...patch,
});

const parsed = parseAssistantPlan(plan({ query: 'Talabat', direction: 'income' }));
ok('closed assistant query accepts a valid read-only plan', parsed?.query === 'Talabat');
ok('assistant plan rejects expanded output and write instructions',
  parseAssistantPlan({ ...plan(), action: 'delete' }) === null &&
    ASSISTANT_PLAN_SCHEMA.additionalProperties === false);
ok('invalid and reversed date ranges fail closed',
  parseAssistantPlan(plan({ period: 'range', from: null, to: null })) === null &&
    parseAssistantPlan(plan({ period: 'range', from: '2026-08-20', to: '2026-08-01' })) === null);
ok('historical bill plans cannot silently return current reminders',
  parseAssistantPlan(plan({ tool: 'list-bills', period: 'previous-month' })) === null &&
    !assistantPlanFitsQuestion(plan({ tool: 'list-bills' }), 'Which card paid this bill?'));
const unsupportedHistory = runAssistantQuery(
  state,
  plan({ tool: 'list-bills' }),
  NOW,
  'historical-bills',
);
ok('unsupported historical bill scope returns no current reminder as an answer',
  unsupportedHistory.unsupportedReason === 'historical-bills' &&
    unsupportedHistory.bills.length === 0 && unsupportedHistory.matchedCount === 0);

const before = JSON.stringify(state);
const talabat = runAssistantQuery(state, plan({ query: 'Talabat', direction: 'income' }), NOW);
ok('named income search returns the exact source row and amount',
  talabat.matchedCount === 1 && talabat.transactions[0].id === 'talabat' &&
    talabat.countedTotalFils === 116533, JSON.stringify(talabat));
ok('assistant query never mutates the encrypted state snapshot', JSON.stringify(state) === before);

const summary = runAssistantQuery(state, plan({ tool: 'summarize-period' }), NOW);
ok('period summary excludes both legs of an own-account transfer',
  summary.incomeFils === 966533 && summary.spendingFils === 2500 &&
    summary.countedTotalFils === 964033 &&
    summary.transactions.every((row) => row.transfer === false), JSON.stringify(summary));

const incomeOnly = runAssistantQuery(state, plan({ direction: 'income' }), NOW);
const expenseOnly = runAssistantQuery(state, plan({ direction: 'expense' }), NOW);
ok('income and expense searches do not present own-account transfer legs as ordinary money',
  incomeOnly.transactions.every((row) => !row.transfer && row.type === 'income') &&
    expenseOnly.transactions.every((row) => !row.transfer && row.type === 'expense'));

const large = runAssistantQuery(state, plan({ minimumMajor: '500' }), NOW);
ok('major-unit bounds are converted with the ledger exponent',
  large.matchedCount === 4 && large.transactions.every((row) => row.amountFils >= 50000));
const invalidPrecision = runAssistantQuery(state, plan({ minimumMajor: '500.123' }), NOW);
const zeroMaximum = runAssistantQuery(state, plan({ maximumMajor: '0' }), NOW);
ok('unrepresentable or zero amount bounds fail closed instead of broadening the search',
  invalidPrecision.unsupportedReason === 'invalid-amount' && invalidPrecision.matchedCount === 0 &&
    zeroMaximum.unsupportedReason === 'invalid-amount' && zeroMaximum.matchedCount === 0);

const fallback = fallbackAssistantQuestion('Show my Talabat income this month', state, NOW).plan;
ok('fallback recognizes an existing merchant and income direction without model text',
  fallback.query === 'Talabat sales' && fallback.direction === 'income');
const generic = fallbackAssistantQuestion('Show business income this month', state, NOW).plan;
ok('fallback never treats generic accounting words as a merchant identity', generic.query === null);
const previous = fallbackAssistantQuestion('Show income last month', state, NOW).plan;
ok('fallback uses the previous money month rather than a guessed date range',
  previous.period === 'previous-month' && previous.from === null && previous.to === null);

const bills = runAssistantQuery(state, plan({ tool: 'list-bills' }), NOW);
ok('bill tool reads saved reminder status without creating a ledger row',
  bills.bills.length === 1 && bills.bills[0].title === 'SEWA' && state.transactions.length === 5);
const pastBills = runAssistantQuery(state, plan({ tool: 'list-bills', period: 'previous-month' }), NOW);
ok('a past-period bill plan is structurally refused before current reminders are read',
  pastBills.unsupportedReason === 'historical-bills' && pastBills.bills.length === 0);
const billPayments = fallbackAssistantQuestion('Show my bill payments last month', state, NOW);
const billPaymentsResult = runAssistantQuery(
  state,
  billPayments.plan,
  NOW,
  billPayments.unsupportedReason,
);
ok('unrecognized historical bill wording cannot be replaced with current reminders',
  billPaymentsResult.unsupportedReason !== null && billPaymentsResult.bills.length === 0 &&
    billPaymentsResult.transactions.length === 0);
const paidBill = fallbackAssistantQuestion('Which card paid the Fishbasket bill last month?', {
  ...state,
  transactions: [...state.transactions, transaction(
    'fishbasket', 'Fishbasket', 20000, 'expense', 'utilities', 'card', '2026-07-10',
  )],
}, NOW).plan;
ok('paid-bill history falls back to source transactions rather than current reminders',
  paidBill.tool === 'search-transactions' && paidBill.query === 'Fishbasket' &&
    paidBill.period === 'previous-month');
const unknownPayee = fallbackAssistantQuestion('Show Acme income this month', state, NOW).plan;
const unknownPayeeResult = runAssistantQuery(state, unknownPayee, NOW);
ok('an unknown named payee stays constrained and cannot broaden into all income',
  unknownPayee.query === 'acme' && unknownPayeeResult.matchedCount === 0);
for (const wording of [
  'How much income did I receive from Acme this month?',
  'How much did Acme pay me this month?',
]) {
  const fallbackResult = fallbackAssistantQuestion(wording, state, NOW);
  const answer = runAssistantQuery(
    state,
    fallbackResult.plan,
    NOW,
    fallbackResult.unsupportedReason,
  );
  ok(`common named-payee wording never broadens: ${wording}`,
    answer.matchedCount === 0 &&
      (fallbackResult.plan.query === 'acme' || answer.unsupportedReason === 'ambiguous-query'));
}
const pluralBillPayment = fallbackAssistantQuestion('Show my bill payments this month', state, NOW);
ok('plural bill-payment wording cannot be mistaken for current due reminders',
  pluralBillPayment.plan.tool === 'search-transactions' ||
    pluralBillPayment.unsupportedReason === 'historical-bills');

const nativeRuntime = read('src/lib/local-ai-runtime-adapter.native.ts');
const screen = read('src/app/assistant.tsx');
ok('native planner clears question/account prompt state after every request',
  /async function plan/.test(nativeRuntime) &&
    /finally[\s\S]*Questions and account display names[\s\S]*clearCache\(true\)/.test(nativeRuntime));
ok('native inference and release share one serialization barrier',
  /withRuntimeLock/.test(nativeRuntime) &&
    /async function classify[\s\S]*return withRuntimeLock/.test(nativeRuntime) &&
    /async function plan[\s\S]*return withRuntimeLock/.test(nativeRuntime) &&
    /async function release[\s\S]*await withRuntimeLock/.test(nativeRuntime));
ok('assistant has no ledger mutation capability and links every source by id',
  !/addTransaction|editTransaction|deleteTransaction|importBatch|dispatch\(/.test(screen) &&
    /transactionId: id/.test(screen));
ok('assistant is internal-only until its device and answer gates are complete',
  /LOCAL_AI_EVALUATION_ENABLED/.test(screen));

console.log(`\nassistant: ${pass} passed, 0 failed`);
