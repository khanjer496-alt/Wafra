/**
 * Golden end-to-end accounting scenarios.
 *
 * These cross the same seams as a real Android history reread: bank text ->
 * parser -> import plan -> id materialisation -> reducer reconciliation ->
 * spending/income/cash-out summaries. Isolated regex tests cannot catch an
 * event-identity collision that only corrupts totals after dedupe.
 */
const assert = require('assert');
const { isDeepStrictEqual } = require('util');

const { summarizeCashOutflow } = require('./build/cash-flow.js');
const { summarizeMonth } = require('./build/insights.js');
const { buildImportPlan } = require('./build/import-plan.js');
const {
  applyMaterializedImportBatch,
  materializeImportBatch,
} = require('./build/ledger-import.js');
const { setActiveMarket, setLedgerCurrency } = require('./build/markets.js');
const { parseSms } = require('./build/sms-parser.js');

let pass = 0;
const ok = (name, condition, detail) => {
  assert.ok(condition, detail);
  pass += 1;
  console.log(`✓ ${name}`);
};

const accounts = [
  {
    id: 'liv-bank', name: 'Liv bank', kind: 'bank', bankName: 'Liv', last4: '0002',
    openingFils: 0, color: '#111111',
  },
  {
    id: 'fab-bank', name: 'FAB bank', kind: 'bank', bankName: 'FAB', last4: '0004',
    openingFils: 0, color: '#222222',
  },
  {
    id: 'fab-card', name: 'FAB card', kind: 'card', cardType: 'credit', bankName: 'FAB',
    last4: '5444', openingFils: 0, color: '#333333',
  },
];
const BASE = {
  hydrated: true,
  onboarded: true,
  accounts,
  transactions: [],
  budgets: [],
  bills: [],
  goals: [],
  cardDues: [],
  accountHints: { '0002': 'liv-bank', '0004': 'fab-bank', '5444': 'fab-card' },
  merchantOverrides: {},
  reviewTray: { schemaVersion: 1, pending: [], tombstones: [] },
  lastScanTs: 0,
  parserVersion: 0,
  marketId: 'AE',
  monthStartDay: 1,
  privateMode: false,
  captureOptOut: false,
};

const NOW = new Date('2026-08-12T12:00:00Z');
const messages = [
  {
    id: 101,
    ts: Date.parse('2026-08-01T14:25:32Z'),
    sender: 'Liv',
    body: 'Dear Customer, AED 12,168.00 has been debited from your account 0002 towards instant transfer. The available balance is AED 15,000.00.',
  },
  {
    id: 102,
    ts: Date.parse('2026-08-01T14:27:27Z'),
    sender: 'FAB',
    body: 'Dear Customer, Your payment instructions of AED 12168.00 to Fishbasket for consumer number 1318124036 has been processed on 01/08/2026 18:27',
  },
  {
    id: 103,
    ts: Date.parse('2026-08-11T08:00:00Z'),
    sender: 'Liv',
    body: 'AED 1,165.33 has been credited to your account. B/O DELIVERY HERO TALABAT DB LLC Talabat Biweekly Payment till 10-Aug-2026.',
  },
  {
    id: 104,
    ts: Date.parse('2026-08-08T09:00:00Z'),
    sender: 'FAB',
    body: 'Purchase of AED 25.00 at STORE ONE with Credit Card ending 5444',
  },
  {
    id: 105,
    ts: Date.parse('2026-08-08T09:00:00Z'),
    sender: 'FAB',
    body: 'Purchase of AED 25.00 at STORE TWO with Credit Card ending 5444',
  },
  {
    id: 106,
    ts: Date.parse('2026-08-10T10:00:00Z'),
    sender: 'FAB',
    body: 'AED 1,000.00 has been deducted from your account 0002 towards payment of your Credit Card ending 5444.',
  },
  {
    id: 107,
    ts: Date.parse('2026-08-10T10:00:00Z'),
    sender: 'FAB',
    body: 'Payment of AED 1,000.00 received towards your Credit Card ending 5444. Thank you.',
  },
  {
    id: 108,
    ts: Date.parse('2026-08-10T08:00:00Z'),
    sender: 'Etisalat',
    body: 'Dear Customer, The due date for your e& bill is nearing. A total amount of AED 775.81 including VAT is due on 15-08-2026.',
  },
  {
    id: 109,
    ts: Date.parse('2026-08-08T08:00:00Z'),
    sender: 'SEWA',
    body: 'Dear Customer, Bill amount for your account 9992442 is AED 200.00, billed on 08-Aug-26. Please pay by 23-Aug-26. https://sewa.gov.ae',
  },
];

setLedgerCurrency(null);
setActiveMarket('AE');
const parsed = messages.flatMap((message) => {
  const result = parseSms(message.body, {}, { sender: message.sender });
  return result
    ? [{
        ...result,
        date: result.date ?? new Date(message.ts).toISOString().slice(0, 10),
        smsTs: message.ts,
        sender: message.sender,
        channel: 'inbox',
        sourceEventId: `a${message.id}`,
      }]
    : [];
});
ok('every golden bank alert is understood', parsed.length === messages.length, parsed.length);

const newestTs = Math.max(...messages.map((message) => message.ts));
const plan = buildImportPlan(parsed, BASE, newestTs, NOW);
let id = 0;
const batch = materializeImportBatch(plan.batch, BASE, (prefix) => `gold-${prefix}-${++id}`);
let state = applyMaterializedImportBatch(BASE, batch);

ok('same-time same-value card purchases remain two real events',
  state.transactions.filter((row) => row.amountFils === 2500).length === 2);
ok('Talabat settlement is countable business income, not an internal transfer',
  state.transactions.some((row) =>
    row.title === 'Talabat sales' && row.type === 'income' && row.category === 'business' &&
    row.isTransfer !== true));
ok('linked utility funding and receipt collapse to one named payment',
  state.transactions.filter((row) => row.amountFils === 1216800).length === 1 &&
    state.transactions.some((row) => row.title === 'Fishbasket'));
ok('e& and SEWA become separate current fixed obligations',
  state.bills.length === 2 && new Set(state.bills.map((bill) => bill.title)).size === 2);

// The user identifies that the named utility purchase was made on the card.
// It remains spending now; cash leaves only when that card is repaid.
state = {
  ...state,
  transactions: state.transactions.map((row) =>
    row.title === 'Fishbasket'
      ? { ...row, accountId: 'fab-card', category: 'utilities', userEdited: true }
      : row),
};
const month = { mode: 'month', key: '2026-08' };
const summary = summarizeMonth(state.transactions, month);
const cashOut = summarizeCashOutflow(state, month);
ok('card-funded utility purchase counts once in spending', summary.expenseFils === 1221800,
  summary.expenseFils);
ok('Talabat settlement reaches income totals', summary.incomeFils === 116533,
  summary.incomeFils);
ok('the two-sided credit-card repayment contributes to cash out exactly once',
  cashOut.totalFils === 100000 && cashOut.cardPaymentsFils === 100000,
  JSON.stringify({
    cashOut,
    settlements: state.transactions
      .filter((row) => row.amountFils === 100000)
      .map((row) => ({
        type: row.type,
        accountId: row.accountId,
        isTransfer: row.isTransfer,
        cardPaymentSide: row.cardPaymentSide,
        date: row.date,
        ts: row.ts,
      })),
  }));

const replayPlan = buildImportPlan(parsed, state, newestTs, NOW);
const replayBatch = materializeImportBatch(
  replayPlan.batch,
  state,
  (prefix) => `gold-replay-${prefix}-${++id}`,
);
const replayState = applyMaterializedImportBatch(state, replayBatch);
ok('replaying the complete bank history makes no ledger or accounting change',
  isDeepStrictEqual(replayState, state));

console.log(`\naccounting-pipeline: ${pass} passed, 0 failed`);
