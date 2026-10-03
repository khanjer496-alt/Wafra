/**
 * One bill payment, two messages: the biller's own receipt and the bank alert.
 *
 * e& confirms a payment itself ("Payment Channel: e& UAE app", no card, so it
 * lands on the unassigned account) and the card that paid it alerts as an
 * ordinary purchase ("ADCB Credit Card XXX2518 has been used for AED 450.45
 * at MB BILL DR:ETISALAT TELEP DUBAI"). Both were expenses, so Spent counted
 * the bill twice. These tests run the shipping modules from build/: first the
 * pure reconciler over row literals, then the real parse -> plan -> apply
 * pipeline in both arrival orders, and finally the bill and month totals.
 */
const { reconcilePaymentFlows } = require('./build/payment-flow.js');
const { summarizeMonth } = require('./build/insights.js');
const { billsForMonth } = require('./build/bills.js');
const { setMonthStartDay } = require('./build/format.js');
const { buildImportPlan } = require('./build/import-plan.js');
const { applyMaterializedImportBatch, materializeImportBatch } = require('./build/ledger-import.js');
const { setActiveMarket, setLedgerCurrency } = require('./build/markets.js');
const { parseSms, classifyMerchantDescription } = require('./build/sms-parser.js');

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
const ids = (rows) => rows.map((row) => row.id).sort().join(',');

const UNASSIGNED = '__unassigned-transaction__';
const at = (iso) => Date.parse(iso);

function receipt(id, amountFils, iso, over = {}) {
  return {
    id, type: 'expense', amountFils, category: 'telecom', accountId: UNASSIGNED,
    title: 'Etisalat', date: iso.slice(0, 10), ts: at(iso), source: 'sms',
    smsKey: `h${id}`, paymentFlowSide: 'receipt', billIdentity: 'account:2543', ...over,
  };
}
function bank(id, amountFils, iso, over = {}) {
  return {
    id, type: 'expense', amountFils, category: 'telecom', accountId: 'adcb-card',
    title: 'Etisalat', date: iso.slice(0, 10), ts: at(iso), source: 'sms', smsKey: `h${id}`,
    captureInstrument: { last4: '2518', kind: 'credit', bankIdentity: 'adcb' }, ...over,
  };
}
/** A PDF statement row: date only, a synthetic midday clock, upload provenance. */
function statementRow(id, amountFils, date, over = {}) {
  const noon = at(`${date}T12:00:00Z`);
  return bank(id, amountFils, `${date}T12:00:00Z`, {
    smsKey: `s${noon}-${amountFils}`, captureSource: 'pdf',
    statementImportId: 'a'.repeat(32), statementRowIndex: 1, captureInstrument: undefined, ...over,
  });
}

// --- The pure rule ----------------------------------------------------------

{
  const r = receipt('r', 45045, '2026-08-04T10:00:30Z');
  const b = bank('b', 45045, '2026-08-04T10:00:00Z');
  for (const [label, rows] of [['receipt first', [r, b]], ['bank first', [b, r]]]) {
    const out = reconcilePaymentFlows(rows);
    ok(`${label}: one e& payment observed twice is one row`, out.length === 1 && out[0].id === 'b', ids(out));
    ok(`${label}: the kept row is on the real card, not the unassigned account`,
      out[0]?.accountId === 'adcb-card');
    ok(`${label}: the receipt's bill identity moves onto the kept row`,
      out[0]?.billIdentity === 'account:2543' && out[0]?.paymentFlowSide === undefined);
  }
  ok('the input rows are not mutated', b.billIdentity === undefined && r.accountId === UNASSIGNED);
  const once = reconcilePaymentFlows([r, b]);
  ok('reconciling the reconciled ledger again changes nothing',
    reconcilePaymentFlows(once) === once);
  ok('a re-imported copy of the same receipt folds into the same bank row again',
    ids(reconcilePaymentFlows([...once, r])) === 'b');
}

{
  // The receipt usually lands within a minute; the statement posts later and
  // states only a date.
  const out = reconcilePaymentFlows([
    receipt('r', 45045, '2026-08-04T10:00:30Z'),
    statementRow('stmt', 45045, '2026-08-06'),
  ]);
  ok('a date-only statement row two days later pairs with the receipt',
    out.length === 1 && out[0].id === 'stmt', ids(out));
}

{
  // The user's real ADCB statement: e& app payments post as
  // "E& DIGITAL APP ABU DHABI ARE", and the plan repeats at 313.95 monthly.
  const classified = classifyMerchantDescription('E& DIGITAL APP ABU DHABI ARE', 'expense', 'AE');
  ok('the statement importer titles the e& app descriptor as the Etisalat biller',
    classified.merchant === 'Etisalat' && classified.categoryGuess === 'telecom',
    JSON.stringify(classified));
  const octoberReceipt = receipt('oct-receipt', 31395, '2026-10-03T09:12:00Z');
  const augustRow = statementRow('aug-stmt', 31395, '2026-08-04', { title: classified.merchant });
  const augustOnly = reconcilePaymentFlows([augustRow, octoberReceipt]);
  ok("October's 313.95 receipt never pairs with August's 313.95 statement row",
    augustOnly.length === 2, ids(augustOnly));
  for (const date of ['2026-10-03', '2026-10-04']) {
    const out = reconcilePaymentFlows([
      augustRow, octoberReceipt, statementRow(`oct-stmt-${date}`, 31395, date, { title: classified.merchant }),
    ]);
    ok(`the 313.95 receipt pairs with the E& DIGITAL APP statement row dated ${date}`,
      ids(out) === `aug-stmt,oct-stmt-${date}`, ids(out));
  }
  const raw = reconcilePaymentFlows([
    octoberReceipt, statementRow('raw-stmt', 31395, '2026-10-04', { title: 'E& DIGITAL APP ABU DHABI ARE', category: 'other' }),
  ]);
  ok('a row that kept the raw E& DIGITAL APP descriptor still resolves to the biller',
    ids(raw) === 'raw-stmt', ids(raw));
}

{
  // Many identical small e& charges: 30.00 on 27/07, 29/07 and 02/08.
  const charges = [
    statementRow('c27', 3000, '2026-07-27'),
    statementRow('c29', 3000, '2026-07-29'),
    statementRow('c02', 3000, '2026-08-02'),
  ];
  const out = reconcilePaymentFlows([...charges, receipt('r30', 3000, '2026-07-29T08:00:00Z')]);
  ok('a 30.00 receipt with two same-amount charges in its window pairs with neither',
    out.length === 4, ids(out));
  const late = reconcilePaymentFlows([...charges, receipt('r31', 3000, '2026-07-31T08:00:00Z')]);
  ok('a receipt equidistant from two same-amount charges stays ambiguous', late.length === 4, ids(late));
}

{
  const two = reconcilePaymentFlows([
    receipt('r1', 45045, '2026-08-04T10:00:30Z'),
    receipt('r2', 45045, '2026-08-04T18:00:30Z'),
    bank('b1', 45045, '2026-08-04T10:00:00Z'),
    bank('b2', 45045, '2026-08-04T18:00:00Z'),
  ]);
  ok('two e& payments of one amount on one day are ambiguous and all four rows stay',
    two.length === 4, ids(two));
  const oneBank = reconcilePaymentFlows([
    receipt('r1', 45045, '2026-08-04T10:00:30Z'),
    receipt('r2', 45045, '2026-08-04T18:00:30Z'),
    bank('b1', 45045, '2026-08-04T10:00:00Z'),
  ]);
  ok('two receipts competing for one bank row pair with neither', oneBank.length === 3, ids(oneBank));
}

{
  const out = reconcilePaymentFlows([
    receipt('r', 45045, '2026-08-04T10:00:30Z'), bank('b', 31395, '2026-08-04T10:00:00Z'),
  ]);
  ok('different amounts are two payments', out.length === 2);
  const late = reconcilePaymentFlows([
    receipt('r', 45045, '2026-08-04T10:00:30Z'), bank('b', 45045, '2026-08-08T10:00:31Z'),
  ]);
  ok('a bank row more than three days from the receipt is a different payment', late.length === 2);
  const fx = reconcilePaymentFlows([
    receipt('r', 45045, '2026-08-04T10:00:30Z'),
    bank('b', 45045, '2026-08-04T10:00:00Z', { originalCurrency: 'USD', originalMinorUnits: 12265, originalExponent: 2 }),
  ]);
  ok('a foreign-currency charge never pairs with a ledger-currency receipt', fx.length === 2);
  const otherBiller = reconcilePaymentFlows([
    receipt('r', 45045, '2026-08-04T10:00:30Z'),
    bank('b', 45045, '2026-08-04T10:00:00Z', { title: 'DEWA', category: 'utilities' }),
  ]);
  ok('a same-amount charge to another biller is not this receipt', otherBiller.length === 2);
  const otherLine = reconcilePaymentFlows([
    receipt('r', 45045, '2026-08-04T10:00:30Z'),
    bank('b', 45045, '2026-08-04T10:00:00Z', { billIdentity: 'account:9911' }),
  ]);
  ok('a bank row naming a different bill account is a different bill', otherLine.length === 2);
  const unnamed = reconcilePaymentFlows([
    receipt('r', 45045, '2026-08-04T10:00:30Z', { title: 'Payment to •2543' }),
    bank('b', 45045, '2026-08-04T10:00:00Z', { title: 'Payment to •2543' }),
  ]);
  ok('a receipt that names only an account fragment is never paired', unnamed.length === 2);
}

{
  const r = receipt('r', 45045, '2026-08-04T10:00:30Z');
  const b = bank('b', 45045, '2026-08-04T10:00:00Z');
  for (const [label, over] of [
    ['userEdited', { userEdited: true }],
    ['titleEdited (a bill alias)', { titleEdited: true }],
    ['split', { splits: [{ category: 'telecom', amountFils: 45045 }] }],
  ]) {
    const out = reconcilePaymentFlows([{ ...r, ...over }, b]);
    ok(`a ${label} receipt is preserved, never folded away`, out.length === 2 && out.some((row) => row.id === 'r'));
  }
  const editedBank = reconcilePaymentFlows([r, { ...b, userEdited: true }]);
  ok('a user-edited bank row is left alone together with its receipt',
    editedBank.length === 2 && editedBank.find((row) => row.id === 'b').billIdentity === undefined);
  const competing = reconcilePaymentFlows([
    r, { ...receipt('r-edited', 45045, '2026-08-04T10:02:00Z'), userEdited: true }, b,
  ]);
  ok('an edited lookalike receipt still makes the pairing ambiguous', competing.length === 3);
}

{
  const r = receipt('r', 45045, '2026-08-04T10:00:30Z');
  for (const [label, row] of [
    ['an income row', bank('x', 45045, '2026-08-04T10:00:00Z', { type: 'income' })],
    ['a transfer', bank('x', 45045, '2026-08-04T10:00:00Z', { isTransfer: true })],
    ['a card repayment', bank('x', 45045, '2026-08-04T10:00:00Z', { isTransfer: true, cardPaymentSide: 'debit' })],
    ['an ordinary-looking card settlement leg', bank('x', 45045, '2026-08-04T10:00:00Z', { cardPaymentSide: 'receipt' })],
    ['another receipt', receipt('x', 45045, '2026-08-04T10:00:00Z', { accountId: 'adcb-card' })],
    ['a manual entry', bank('x', 45045, '2026-08-04T10:00:00Z', { source: 'manual' })],
  ]) {
    ok(`a receipt never pairs with ${label}`, reconcilePaymentFlows([r, row]).length === 2);
  }
  // A Liv funding alert already explained this receipt; a stray ordinary row
  // must not also consume it.
  const funded = reconcilePaymentFlows([
    bank('funding', 45045, '2026-08-04T09:59:00Z', {
      accountId: 'bank', title: 'Outgoing transfer', isTransfer: true, paymentFlowSide: 'funding',
    }),
    r,
    bank('b', 45045, '2026-08-04T10:00:00Z'),
  ]);
  ok('a receipt already paired with its funding leg is not paired again', ids(funded) === 'b,r', ids(funded));
}

// --- Bills and totals --------------------------------------------------------

{
  setMonthStartDay(1);
  const today = new Date(2026, 7, 20);
  const pair = [receipt('r', 45045, '2026-08-04T10:00:30Z'), bank('b', 45045, '2026-08-04T10:00:00Z')];
  const after = reconcilePaymentFlows(pair);
  ok('before: the two rows counted the bill twice in Spent',
    summarizeMonth(pair, '2026-08').expenseFils === 90090);
  ok('after: Spent counts the AED 450.45 bill once',
    summarizeMonth(after, '2026-08').expenseFils === 45045, summarizeMonth(after, '2026-08').expenseFils);
  const reminder = (id, tail) => ({
    id, title: 'E&', category: 'telecom', amountFils: 45045, dueDay: 15,
    autoDetected: true, importIdentity: `account:${tail}`, paidMonths: [],
  });
  const one = billsForMonth([reminder('bill', '2543')], after, today);
  ok('the e& bill is still marked paid by the folded payment',
    one[0].status === 'paid' && one[0].autoReconciled === true, JSON.stringify(one[0]));
  const household = billsForMonth([reminder('home', '2543'), reminder('mobile', '9911')], after, today);
  ok('with two e& lines of one price, the carried identity settles only its own line',
    household.filter((row) => row.status === 'paid').map((row) => row.bill.id).join() === 'home',
    JSON.stringify(household.map((row) => [row.bill.id, row.status])));
}

// --- The real pipeline, both orders, same and separate batches ---------------

{
  setLedgerCurrency(null);
  setActiveMarket('AE');
  const BASE = {
    hydrated: true, onboarded: true,
    accounts: [{ id: 'adcb-card', name: 'ADCB card', kind: 'card', cardType: 'credit', bankName: 'ADCB',
      last4: '2518', openingFils: 0, color: '#111111' }],
    transactions: [], budgets: [], bills: [], goals: [], cardDues: [], accountHints: { 2518: 'adcb-card' },
    merchantOverrides: {}, reviewTray: { schemaVersion: 1, pending: [], tombstones: [] },
    lastScanTs: 0, parserVersion: 0, marketId: 'AE', monthStartDay: 1, privateMode: false,
    captureOptOut: false, ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  };
  const messages = {
    receipt: {
      id: 1, ts: at('2026-08-04T10:00:30Z'), sender: 'Etisalat',
      body: 'Dear Customer, Your payment to the account number ····2543 has been processed.\n' +
        'Amount Due: AED 450.45 \nAmount Paid: AED 450.45 \nPayment Channel: Etisalat Mobile App',
    },
    bank: {
      id: 2, ts: at('2026-08-04T10:00:00Z'), sender: 'ADCB',
      body: 'Your ADCB Credit Card XXX2518 has been used for AED 450.45 at MB BILL DR:ETISALAT TELEP DUBAI on 04/08/2026.',
    },
  };
  let counter = 0;
  const parsedOf = (key) => {
    const message = messages[key];
    const result = parseSms(message.body, {}, { sender: message.sender });
    return {
      ...result, date: result.date ?? new Date(message.ts).toISOString().slice(0, 10),
      smsTs: message.ts, sender: message.sender, channel: 'inbox', sourceEventId: `a${message.id}`,
    };
  };
  const importBatch = (state, keys) => {
    const parsed = keys.map(parsedOf);
    const plan = buildImportPlan(parsed, state, Math.max(...parsed.map((p) => p.smsTs)), new Date('2026-08-20T00:00:00Z'));
    return applyMaterializedImportBatch(state, materializeImportBatch(plan.batch, state, (prefix) => `${prefix}-${++counter}`));
  };
  const parsedReceipt = parsedOf('receipt');
  ok('the e& receipt parses as a telecom biller receipt with a bill identity',
    parsedReceipt.paymentFlowSide === 'receipt' && parsedReceipt.merchant === 'Etisalat' &&
      parsedReceipt.billIdentity === 'account:2543');
  for (const [label, batches] of [
    ['same batch', [['receipt', 'bank']]],
    ['receipt first, separate batches', [['receipt'], ['bank']]],
    ['bank first, separate batches', [['bank'], ['receipt']]],
  ]) {
    let state = BASE;
    for (const batch of batches) state = importBatch(state, batch);
    const rows = state.transactions;
    ok(`${label}: one row on the ADCB card carrying the bill identity`,
      rows.length === 1 && rows[0].accountId === 'adcb-card' && rows[0].billIdentity === 'account:2543',
      JSON.stringify(rows.map((row) => [row.title, row.accountId, row.paymentFlowSide, row.billIdentity])));
    ok(`${label}: Spent for August is 450.45 once`, summarizeMonth(rows, '2026-08').expenseFils === 45045);
    const reread = importBatch(state, ['receipt', 'bank']);
    ok(`${label}: a re-read of both messages keeps one row`, reread.transactions.length === 1);
  }
}

console.log(`\nbiller-receipt-dedupe.test.js: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
