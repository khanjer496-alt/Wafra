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

// ledger.ts's constants, not literals: payment-flow.ts imports the same ones,
// and the holding-account cases below prove a receipt on either still behaves.
const {
  UNASSIGNED_TRANSACTION_ACCOUNT_ID: UNASSIGNED,
  UNASSIGNED_INCOME_ACCOUNT_ID: UNASSIGNED_INCOME,
} = require('./build/ledger.js');
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
  // A pinned bank row may be the kept side: the unpinned receipt is the
  // duplicate either way, and nothing is merged into what the person edited.
  for (const [label, over] of [
    ['userEdited', { userEdited: true, category: 'bills' }],
    ['titleEdited', { titleEdited: true }],
    ['bill-linked', { billPayment: { billId: 'bill', month: '2026-08' } }],
  ]) {
    const editedRow = { ...b, ...over };
    const editedBank = reconcilePaymentFlows([r, editedRow]);
    ok(`a ${label} bank row stays, verbatim, and its unpinned receipt is dropped`,
      editedBank.length === 1 && editedBank[0] === editedRow && editedBank[0].billIdentity === undefined,
      ids(editedBank));
  }
  const bothPinned = reconcilePaymentFlows([{ ...r, userEdited: true }, { ...b, userEdited: true }]);
  ok('a pinned receipt is never dropped, even beside a pinned bank row', bothPinned.length === 2);
  const userAssigned = reconcilePaymentFlows([{ ...r, paymentInstrumentSource: 'user' }, b]);
  ok('a receipt whose account the person chose is never dropped', userAssigned.length === 2);
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

// --- Only the BILLER's own receipt is ever folded ---------------------------

{
  // A bank's own bill-pay confirmation is its record of a real debit. Probe 1:
  // Liv confirms AED 313.95 to Etisalat for consumer number 4026, and the ADCB
  // statement two days later has a different 313.95 e& payment. Before: the
  // Liv row was deleted and its consumer identity moved onto the ADCB row.
  const livBillPay = receipt('liv-billpay', 31395, '2026-10-02T09:00:00Z', {
    accountId: 'liv', billIdentity: 'consumer:4026', paymentInstrumentSource: 'alert',
  });
  const adcbRow = statementRow('adcb-stmt', 31395, '2026-10-04', { accountId: 'adcb' });
  const out = reconcilePaymentFlows([livBillPay, adcbRow]);
  ok("a bank's own bill-pay confirmation on another account is never folded away",
    ids(out) === 'adcb-stmt,liv-billpay', ids(out));
  ok('and the other bank row does not take its consumer identity',
    out.find((row) => row.id === 'adcb-stmt')?.billIdentity === undefined);
  ok('Spent counts both genuine 313.95 payments',
    summarizeMonth(out, '2026-10').expenseFils === 62790, summarizeMonth(out, '2026-10').expenseFils);
  // The real import puts that Liv message on the unassigned holding with no
  // instrument (it names no card). Its `consumer:` label alone must refuse it.
  const unassignedBillPay = reconcilePaymentFlows([
    receipt('liv-billpay', 31395, '2026-10-02T09:00:00Z', { billIdentity: 'consumer:4026' }), adcbRow,
  ]);
  ok('a consumer-number bill-pay confirmation is never folded, even unassigned',
    unassignedBillPay.length === 2, ids(unassignedBillPay));
  const homeinet = reconcilePaymentFlows([
    receipt('nick', 31395, '2026-10-02T09:00:00Z', { title: 'Homeinet', category: 'other', billIdentity: 'consumer:4026' }),
    statementRow('h-stmt', 31395, '2026-10-02', { title: 'Homeinet', category: 'other' }),
  ]);
  ok('a bill-pay nickname receipt with a consumer number is never folded', homeinet.length === 2);
}

{
  const b = bank('b', 45045, '2026-08-04T10:00:00Z');
  const cardStated = reconcilePaymentFlows([
    receipt('r', 45045, '2026-08-04T10:00:30Z', {
      accountId: 'enbd-card', paymentInstrumentSource: 'alert',
      captureInstrument: { last4: '7781', kind: 'debit', bankIdentity: 'enbd' },
    }), b,
  ]);
  ok('a receipt that states a paying card is a bank record and is never folded', cardStated.length === 2);
  const otherAccount = reconcilePaymentFlows([receipt('r', 45045, '2026-08-04T10:00:30Z', { accountId: 'enbd-card' }), b]);
  ok('a receipt on a different real account is never folded into this card', otherAccount.length === 2);
  const sameAccount = reconcilePaymentFlows([receipt('r', 45045, '2026-08-04T10:00:30Z', { accountId: 'adcb-card' }), b]);
  ok('a biller receipt already on the paying card folds into that card row', ids(sameAccount) === 'b', ids(sameAccount));
  // The shape the importer stores today for the e& portal receipt: its only
  // number (the e& account 2543) recorded as an account-kind instrument, and
  // the row routed to an account resolved from it.
  const billerNumber = reconcilePaymentFlows([
    receipt('r', 45045, '2026-08-04T10:00:30Z', {
      accountId: 'acc-2543', paymentInstrumentSource: 'alert', captureInstrument: { last4: '2543', kind: 'account' },
    }), b,
  ]);
  ok("a receipt whose only 'instrument' is the biller's own account number still folds",
    ids(billerNumber) === 'b' && billerNumber[0].billIdentity === 'account:2543', ids(billerNumber));
  const issuerNumber = reconcilePaymentFlows([
    receipt('r', 45045, '2026-08-04T10:00:30Z', {
      accountId: 'acc-2543', paymentInstrumentSource: 'alert',
      captureInstrument: { last4: '2543', kind: 'account', bankIdentity: 'enbd' },
    }), b,
  ]);
  ok('an issuer-stated account with the same digits is a bank record, not the biller number',
    issuerNumber.length === 2);
  // A bank's own confirmation of a same-amount payment to the same bill makes
  // the biller receipt ambiguous: it may confirm that payment instead.
  const competing = reconcilePaymentFlows([
    receipt('r', 45045, '2026-08-04T10:00:30Z'), b,
    receipt('liv', 45045, '2026-08-04T09:59:00Z', { accountId: 'liv', billIdentity: 'consumer:2543', paymentInstrumentSource: 'alert' }),
  ]);
  ok("a bank's confirmation of a same-bill payment makes the biller receipt ambiguous",
    competing.length === 3, ids(competing));
}

{
  // A bill alias is free text. "Home" must not find "HOME CENTRE", and only a
  // canonical biller name is searched for inside a longer descriptor.
  const home = reconcilePaymentFlows([
    receipt('r', 45045, '2026-08-04T10:00:30Z', { title: 'Home' }),
    bank('b', 45045, '2026-08-04T10:00:00Z', { title: 'HOME CENTRE DUBAI', category: 'shopping' }),
  ]);
  ok('an alias-titled receipt never matches by a word inside an unrelated descriptor', home.length === 2);
  const exactAlias = reconcilePaymentFlows([
    receipt('r', 45045, '2026-08-04T10:00:30Z', { title: 'Home internet' }),
    bank('b', 45045, '2026-08-04T10:00:00Z', { title: 'Home internet services llc' }),
  ]);
  ok('a non-canonical receipt title must equal the bank payee exactly', exactAlias.length === 2);
  const raw = reconcilePaymentFlows([
    receipt('r', 45045, '2026-08-04T10:00:30Z'),
    bank('b', 45045, '2026-08-04T10:00:00Z', { title: 'MB BILL DR:ETISALAT TELEP DUBAI', category: 'other' }),
  ]);
  ok('the canonical e& biller still matches its raw bank descriptor', ids(raw) === 'b', ids(raw));
}

// --- The asymmetric window ---------------------------------------------------

{
  const r = receipt('r', 31395, '2026-07-31T19:00:00Z', { billIdentity: 'account:0000' });
  const fit = (date) => reconcilePaymentFlows([r, statementRow('s', 31395, date)]);
  ok('a statement row dated the day BEFORE the receipt never pairs', fit('2026-07-30').length === 2);
  ok('a statement row on the receipt day pairs', ids(fit('2026-07-31')) === 's');
  // Probe 6, the designed boundary: a 31/07 receipt and a statement posted
  // 03/08 are one payment (three days of posting lag), and the kept row is
  // the statement's, so the bill counts in August, once.
  const boundary = fit('2026-08-03');
  ok('a statement row posted three days after the receipt pairs (posting lag)',
    ids(boundary) === 's' && summarizeMonth(boundary, '2026-07').expenseFils === 0 &&
      summarizeMonth(boundary, '2026-08').expenseFils === 31395, ids(boundary));
  ok('a statement row four days after the receipt is another payment', fit('2026-08-04').length === 2);
  // Probe 1 C: a 30/07 receipt and a single 30.00 charge posted 27/07.
  const earlier = reconcilePaymentFlows([
    receipt('r30', 3000, '2026-07-30T09:00:00Z', { billIdentity: 'account:1111' }),
    statementRow('c27', 3000, '2026-07-27'),
  ]);
  ok('a charge posted before the receipt is never folded with it', earlier.length === 2, ids(earlier));
  const live = (iso) => reconcilePaymentFlows([
    receipt('r', 45045, '2026-08-04T10:00:00Z'), bank('b', 45045, iso),
  ]).length;
  ok('a live bank alert 23 hours after the receipt pairs', live('2026-08-05T09:00:00Z') === 1);
  ok('a live bank alert 23 hours before the receipt pairs', live('2026-08-03T11:00:00Z') === 1);
  ok('a live bank alert 25 hours after the receipt is another payment', live('2026-08-05T11:00:00Z') === 2);
}

// --- Cost --------------------------------------------------------------------

{
  // The pass must not cost receipts x same-amount bank rows. A 14.4k-row
  // ledger with 1,800 receipts, 600 of them at one amount (AED 30) beside
  // ~2,000 AED 30 bank rows, took 143ms (and over 300ms on a busy host) while
  // main took ~2.5ms. Baseline: the same ledger with every receipt
  // user-assigned, so nothing is removable and the pass ends after one scan.
  const rows = [];
  const start = Date.parse('2024-01-01T00:00:00Z');
  const titles = ['Etisalat', 'Carrefour', 'Talabat', 'DEWA', 'Noon', 'Amazon', 'Careem', 'Du', 'ENOC', 'Starbucks'];
  for (let i = 0; i < 14000; i++) {
    const ts = start + i * 5_400_000;
    const title = titles[i % titles.length];
    const amountFils = i % 7 === 0 ? 3000 : (i % 11 === 0 ? 31395 : 1000 + (i * 37) % 50000);
    rows.push({ id: `p${i}`, type: 'expense', amountFils, category: 'telecom', accountId: 'a', title,
      date: new Date(ts).toISOString().slice(0, 10), ts, source: 'sms', smsKey: `h${i}`,
      ...(i % 10 === 0 ? { paymentFlowSide: 'receipt', billIdentity: 'account:2543' } : {}) });
  }
  for (let i = 0; i < 400; i++) {
    const ts = start + i * 86_400_000;
    rows.push({ id: `x${i}`, type: 'expense', amountFils: 3000, category: 'telecom', accountId: UNASSIGNED,
      title: 'Etisalat', date: new Date(ts).toISOString().slice(0, 10), ts, source: 'sms', smsKey: `hx${i}`,
      paymentFlowSide: 'receipt', billIdentity: 'account:2543' });
  }
  const baseline = rows.map((row) => (row.paymentFlowSide ? { ...row, paymentInstrumentSource: 'user' } : row));
  const fastest = (input) => {
    let best = Infinity;
    for (let k = 0; k < 7; k++) {
      const t0 = process.hrtime.bigint();
      reconcilePaymentFlows(input);
      best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6);
    }
    return best;
  };
  fastest(rows);
  fastest(baseline);
  const pairedMs = fastest(rows);
  const baselineMs = fastest(baseline);
  ok('pairing 1,800 receipts on a 14.4k-row ledger costs at most ~3x the pass-free baseline',
    pairedMs < baselineMs * 3 + 2, `${pairedMs.toFixed(2)}ms vs ${baselineMs.toFixed(2)}ms`);
  ok('and stays inside a frame on Node', pairedMs < 40, `${pairedMs.toFixed(2)}ms`);
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
    livBillPay: {
      id: 3, ts: at('2026-08-04T09:00:00Z'), sender: 'LIV',
      body: 'Your payment instructions of AED 313.95 to Etisalat for consumer number 4026 has been processed',
    },
    adcb313: {
      id: 4, ts: at('2026-08-05T09:00:00Z'), sender: 'ADCB',
      body: 'Your ADCB Credit Card XXX2518 has been used for AED 313.95 at MB BILL DR:ETISALAT TELEP DUBAI on 05/08/2026.',
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

  // Probe 2: the person edits the kept bank row, then the receipt SMS is read
  // again (a History re-import, a rescan). Before: the edit stopped the
  // pairing, the receipt came back, and Spent was 900.90 for good.
  const folded = importBatch(BASE, ['bank', 'receipt']);
  const edited = {
    ...folded,
    transactions: folded.transactions.map((row) => ({ ...row, category: 'bills', userEdited: true })),
  };
  for (const [label, keys] of [['the receipt', ['receipt']], ['both messages', ['receipt', 'bank']]]) {
    const reread = importBatch(edited, keys);
    const rows = reread.transactions;
    ok(`after a user edit, a re-read of ${label} still leaves one row`,
      rows.length === 1 && rows[0].userEdited === true && rows[0].category === 'bills',
      JSON.stringify(rows.map((row) => [row.title, row.accountId, row.paymentFlowSide, row.userEdited])));
    ok(`after a user edit, a re-read of ${label} keeps Spent at 450.45`,
      summarizeMonth(rows, '2026-08').expenseFils === 45045, summarizeMonth(rows, '2026-08').expenseFils);
  }

  // Probe 1 through the real pipeline: Liv's own bill-pay confirmation and an
  // ADCB card payment of the same amount to e& the next day are two payments.
  const twoBanks = importBatch(BASE, ['livBillPay', 'adcb313']).transactions;
  ok("through the importer, Liv's bill-pay confirmation and an ADCB e& charge stay two rows",
    twoBanks.length === 2 && summarizeMonth(twoBanks, '2026-08').expenseFils === 62790,
    JSON.stringify(twoBanks.map((row) => [row.title, row.accountId, row.billIdentity, row.paymentInstrumentSource])));
}

// --- Review findings: only a biller's own unassigned receipt is folded -----
{
  // A bank's bill-pay instruction is receipt-side too, titled with the user's
  // nickname. FAB's names no account digits, so the real parser leaves it with
  // no card and the planner puts it on the unassigned account, exactly like a
  // biller receipt. Only its `consumer:` identity tells them apart.
  const billPay = (id, title, iso, identity) => receipt(id, 25000, iso, { title, billIdentity: identity });
  const restaurant = bank('rest', 25000, '2026-08-05T13:00:00Z', { title: 'Fishbasket Restaurant', category: 'food' });
  const nick = billPay('nick', 'Fishbasket', '2026-08-04T09:00:00Z', 'consumer:4026');
  ok('a bill-pay nickname never merges with a restaurant of that name',
    ids(reconcilePaymentFlows([nick, restaurant])) === 'nick,rest');
  const fabEtisalat = billPay('fab', 'Etisalat', '2026-08-04T09:00:00Z', 'consumer:4026');
  const adcbEtisalat = bank('adcb', 25000, '2026-08-06T09:00:00Z');
  ok('two banks paying Etisalat the same amount are two payments',
    ids(reconcilePaymentFlows([fabEtisalat, adcbEtisalat])) === 'adcb,fab');
  // Etisalat's own settlement message names no instrument; it must never be
  // the row kept over the bank's debit.
  const settlement = bank('settle', 25000, '2026-08-04T09:05:00Z', {
    accountId: UNASSIGNED, captureInstrument: undefined, billIdentity: 'account:9876',
  });
  ok('a bank bill-pay is never deleted in favour of an unassigned settlement',
    ids(reconcilePaymentFlows([billPay('fab2', 'Etisalat', '2026-08-04T09:00:00Z', 'account:9876'), settlement])) === 'fab2,settle');
  const unassignedReceipt = receipt('r2', 25000, '2026-08-04T09:00:30Z', { billIdentity: 'account:9876' });
  ok('an unassigned receipt never folds into an unassigned settlement',
    reconcilePaymentFlows([unassignedReceipt, settlement]).length === 2);
  const incomeHolding = { ...settlement, id: 'inc', accountId: UNASSIGNED_INCOME };
  ok('a row on the unassigned-income holding is never the kept side either',
    reconcilePaymentFlows([unassignedReceipt, incomeHolding]).length === 2);
  // A holding-account row is still a same-amount payment to the same biller:
  // it competes, so a real card row beside it is no longer the only candidate.
  const card = bank('card', 25000, '2026-08-04T09:01:00Z');
  ok('a holding-account lookalike makes the fold ambiguous instead of being ignored',
    ids(reconcilePaymentFlows([unassignedReceipt, settlement, card])) === 'card,r2,settle');
  ok('without it, the same receipt folds into the card row',
    ids(reconcilePaymentFlows([unassignedReceipt, card])) === 'card');
}

{
  // Main's isBillerOwnReceipt: only a receipt carrying the biller's own
  // account number is ever removed. The review's billerSentReceipt alone would
  // remove an unlabelled receipt-side row (no identity, no instrument); the
  // union keeps it, and it still competes for the bank rows it matches.
  const b = bank('b', 45045, '2026-08-04T10:00:00Z');
  const bare = receipt('bare', 45045, '2026-08-04T10:00:30Z', { billIdentity: undefined });
  ok('a receipt-side row with no bill identity is never folded',
    ids(reconcilePaymentFlows([bare, b])) === 'b,bare');
  const party = receipt('party', 45045, '2026-08-04T10:00:30Z', { billIdentity: 'party:2543' });
  ok("a receipt whose identity is not the biller's account number is never folded",
    ids(reconcilePaymentFlows([party, b])) === 'b,party');
  const own = receipt('own', 45045, '2026-08-04T10:00:40Z');
  ok('and an unlabelled receipt beside a real one makes the bank row ambiguous',
    ids(reconcilePaymentFlows([bare, own, b])) === 'b,bare,own');
}

{
  // The older parser read Etisalat's "account number ····2543" as the user's
  // account and minted "Account •2543". Such a receipt is still the biller's.
  const phantom = receipt('old', 45045, '2026-08-04T10:00:30Z', {
    accountId: 'acc-2543', captureInstrument: { last4: '2543', kind: 'account', bankIdentity: null },
  });
  const out = reconcilePaymentFlows([phantom, bank('b', 45045, '2026-08-04T10:00:00Z')]);
  ok('a receipt on an account made from the biller number still folds into the bank charge',
    out.length === 1 && out[0].id === 'b' && out[0].accountId === 'adcb-card', ids(out));
  const realAccount = receipt('mine', 45045, '2026-08-04T10:00:30Z', {
    accountId: 'adcb-current', captureInstrument: { last4: '7781', kind: 'account', bankIdentity: 'adcb' },
  });
  const onSameCard = receipt('card', 45045, '2026-08-04T10:00:30Z', {
    accountId: 'adcb-card', captureInstrument: { last4: '2518', kind: 'credit', bankIdentity: 'adcb' },
  });
  // Main shipped this as a fold; the review made a stated paying card mean
  // "a bank sent this" (billerSentReceipt). The safer reading wins: a bank's
  // own bill-pay confirmation naming the card is that bank's record of a
  // debit, and folding it on amount + biller + day could delete a genuine
  // second payment. Without the card stated, the same receipt on the same
  // card still folds (see "a biller receipt already on the paying card").
  const sameCardOut = reconcilePaymentFlows([onSameCard, bank('b', 45045, '2026-08-04T10:00:00Z')]);
  ok('a receipt that states the paying card is a bank record and is never folded, even on that card',
    ids(sameCardOut) === 'b,card', ids(sameCardOut));
  ok('a receipt on a different real account of the user\'s never folds',
    reconcilePaymentFlows([realAccount, bank('b', 45045, '2026-08-04T10:00:00Z')]).length === 2);
}

// --- Three observations of one payment: alert, biller receipt, statement ----
{
  // The receipt rule never picks between a live alert and a statement row
  // that dedupe has not yet merged: either could be the payment, so it
  // removes nothing, and whatever dedupe later keeps is the one bank row.
  const r = receipt('r', 31395, '2026-08-04T10:00:30Z');
  const alert = bank('alert', 31395, '2026-08-04T10:00:00Z');
  const stmt = statementRow('stmt', 31395, '2026-08-05');
  ok('an unmerged alert + statement pair leaves the receipt alone (no double claim)',
    ids(reconcilePaymentFlows([r, alert, stmt])) === 'alert,r,stmt');
  ok('once dedupe keeps either one, the receipt folds into exactly that row',
    ids(reconcilePaymentFlows([r, alert])) === 'alert' && ids(reconcilePaymentFlows([r, stmt])) === 'stmt');
}

//
// dedupe.ts folds a statement row into the live alert it repeats (commit
// 70e318ab); this file's rule folds a biller receipt into the bank row it
// repeats. Both remove rows, so they must never claim the same row twice nor
// delete both sides. One AED 313.95 e& payment from the ADCB card is seen as
// the ADCB alert, e&'s own receipt, and the ADCB statement row
// "E& DIGITAL APP ABU DHABI ARE" posted the next day, through the real
// parse -> plan -> apply -> reconcile path, in every arrival order.
{
  setLedgerCurrency(null);
  setActiveMarket('AE');
  setMonthStartDay(1);
  const today = new Date(2026, 7, 20);
  const OTHER = {
    id: 'kept-carrefour', type: 'expense', amountFils: 31395, category: 'groceries', accountId: 'adcb-card',
    title: 'Carrefour', date: '2026-08-04', ts: at('2026-08-04T18:00:00Z'), source: 'sms', smsKey: 'hcarrefour',
    captureInstrument: { last4: '2518', kind: 'credit', bankIdentity: 'adcb' },
  };
  const BASE = {
    hydrated: true, onboarded: true,
    accounts: [{ id: 'adcb-card', name: 'ADCB card', kind: 'card', cardType: 'credit', bankName: 'ADCB',
      last4: '2518', openingFils: 0, color: '#111111' }],
    transactions: [OTHER], budgets: [], bills: [], goals: [], cardDues: [], accountHints: { 2518: 'adcb-card' },
    merchantOverrides: {}, reviewTray: { schemaVersion: 1, pending: [], tombstones: [] },
    lastScanTs: 0, parserVersion: 0, marketId: 'AE', monthStartDay: 1, privateMode: false,
    captureOptOut: false, ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  };
  const sms = (id, iso, sender, body) => {
    const ts = at(iso);
    const result = parseSms(body, {}, { sender });
    return { ...result, date: result.date ?? iso.slice(0, 10), smsTs: ts, sender, channel: 'inbox', sourceEventId: `t${id}` };
  };
  const adcbAlert = (id, iso, day) => sms(id, iso, 'ADCB',
    `Your ADCB Credit Card XXX2518 has been used for AED 313.95 at MB BILL DR:ETISALAT TELEP DUBAI on ${day}.`);
  const eAndReceipt = (id, iso, tail) => sms(id, iso, 'Etisalat',
    `Dear Customer, Your payment to the account number ····${tail} has been processed.\n` +
      'Amount Due: AED 313.95 \nAmount Paid: AED 313.95 \nPayment Channel: Etisalat Mobile App');
  // The shape server/src/index.ts queues for a PDF card-statement row: the
  // relay's own title for the descriptor, the statement's card, the bank it
  // named, a midday clock, and the upload's opaque id and row index.
  const described = classifyMerchantDescription('E& DIGITAL APP ABU DHABI ARE', 'expense', 'AE');
  const statementLine = (date, index, upload = 'b') => ({
    kind: 'transaction', type: 'expense', amountFils: 31395, currency: 'AED', merchant: described.merchant, date,
    dueDay: null, minDueFils: null, card: { last4: '2518', kind: 'credit' }, reference: null, transferHint: false,
    snapshotFils: null, snapshotKind: null, categoryGuess: described.categoryGuess,
    categoryDeliberate: described.categoryDeliberate, bankHint: 'ADCB',
    captureSource: 'pdf', smsTs: at(`${date}T12:00:00Z`), statementImportId: upload.repeat(32), statementRowIndex: index,
  });
  let counter = 0;
  const importRows = (state, rows) => {
    const plan = buildImportPlan(rows, state, Math.max(...rows.map((p) => p.smsTs)), new Date('2026-08-20T00:00:00Z'));
    return applyMaterializedImportBatch(state, materializeImportBatch(plan.batch, state, (prefix) => `${prefix}-${++counter}`));
  };
  const reminder = (id, tail) => ({
    id, title: 'E&', category: 'telecom', amountFils: 31395, dueDay: 15,
    autoDetected: true, importIdentity: `account:${tail}`, paidMonths: [],
  });
  const describe = (rows) => JSON.stringify(rows.map((row) =>
    [row.title, row.accountId, row.captureSource ?? 'sms', row.paymentFlowSide, row.billIdentity]));
  const e = (rows) => rows.filter((row) => row.id !== OTHER.id);

  const one = {
    alert: adcbAlert(11, '2026-08-04T10:00:00Z', '04/08/2026'),
    receipt: eAndReceipt(12, '2026-08-04T10:00:30Z', '2543'),
    statement: statementLine('2026-08-05', 0),
  };
  ok('the e& receipt parses with its bill identity, the alert as an ordinary charge',
    one.receipt.paymentFlowSide === 'receipt' && one.receipt.billIdentity === 'account:2543' &&
      one.alert.paymentFlowSide === undefined && one.alert.amountFils === 31395, describe([one.receipt, one.alert]));
  const permutations = (keys) => keys.length <= 1 ? [keys]
    : keys.flatMap((key, i) => permutations([...keys.slice(0, i), ...keys.slice(i + 1)]).map((rest) => [key, ...rest]));
  const orders = [
    ['one batch, statement listed first', [['statement', 'receipt', 'alert']]],
    ...permutations(['alert', 'receipt', 'statement']).map((order) => [order.join(' -> '), order.map((key) => [key])]),
    ['alert + receipt, then statement', [['alert', 'receipt'], ['statement']]],
    ['statement, then alert + receipt', [['statement'], ['alert', 'receipt']]],
  ];
  for (const [label, batches] of orders) {
    let state = BASE;
    for (const batch of batches) state = importRows(state, batch.map((key) => one[key]));
    const rows = e(state.transactions);
    ok(`${label}: exactly one counted row, on the ADCB card`,
      rows.length === 1 && rows[0].accountId === 'adcb-card' && rows[0].paymentFlowSide === undefined, describe(rows));
    ok(`${label}: it carries the e& bill identity`, rows[0]?.billIdentity === 'account:2543', describe(rows));
    ok(`${label}: the unrelated same-amount Carrefour charge is untouched`,
      state.transactions.filter((row) => row.id === OTHER.id).length === 1 &&
        state.transactions.find((row) => row.id === OTHER.id).title === 'Carrefour');
    ok(`${label}: Spent for August is 313.95 for the bill (+ the Carrefour charge)`,
      summarizeMonth(state.transactions, '2026-08').expenseFils === 62790,
      summarizeMonth(state.transactions, '2026-08').expenseFils);
    const bills = billsForMonth([reminder('bill', '2543')], state.transactions, today);
    ok(`${label}: the e& bill is paid`, bills[0].status === 'paid', JSON.stringify(bills[0]));
    const reread = importRows(state, [one.statement, one.receipt, one.alert]);
    if (batches.length === 1) {
      // KNOWN GAP, not this rule's: a statement row folded with its alert in
      // ONE batch keeps the statement's synthetic identity and drops the
      // alert's, so re-reading the statement and the alert together in one
      // later batch brings the alert back (dedupe/import-plan; reproduced with
      // no receipt at all). Only the safety property is asserted for it.
      ok(`${label}: re-reading all three never loses the payment`,
        e(reread.transactions).filter((row) => row.accountId === 'adcb-card').length >= 1 &&
          summarizeMonth(reread.transactions, '2026-08').expenseFils >= 62790, describe(e(reread.transactions)));
    } else {
      ok(`${label}: re-reading all three keeps one counted row`,
        e(reread.transactions).length === 1 && summarizeMonth(reread.transactions, '2026-08').expenseFils === 62790,
        describe(e(reread.transactions)));
    }
  }

  // KNOWN GAP, not this rule's: when the live alert precedes the statement row
  // INSIDE one import batch (the relay sorts a sync by smsTs, so an alert and
  // a statement queued together arrive in this order), dedupe.ts does not
  // match the statement row to the alert, even with no receipt involved. The
  // receipt then sees two equal ADCB rows and refuses to guess. Only the
  // safety property is asserted here: nothing is deleted, nothing is lost.
  {
    const state = importRows(BASE, [one.alert, one.receipt, one.statement]);
    const rows = e(state.transactions);
    const card = rows.filter((row) => row.accountId === 'adcb-card' && row.paymentFlowSide === undefined);
    ok('one batch, alert first: the ADCB payment is never lost and the Carrefour charge survives',
      card.length >= 1 && state.transactions.some((row) => row.id === OTHER.id), describe(rows));
    ok('one batch, alert first: Spent never drops below the real payments',
      summarizeMonth(state.transactions, '2026-08').expenseFils >= 62790);
    ok('one batch, alert first: a later re-read of the three does not add rows',
      importRows(state, [one.alert, one.receipt, one.statement]).transactions.length === state.transactions.length);
  }

  // Two genuine payments, two weeks apart, each seen three times: two rows.
  const two = {
    ...one,
    alert2: adcbAlert(21, '2026-08-18T10:00:00Z', '18/08/2026'),
    receipt2: eAndReceipt(22, '2026-08-18T10:00:30Z', '2543'),
    statement2: statementLine('2026-08-19', 1),
  };
  for (const [label, keys] of [
    ['in arrival order', ['alert', 'receipt', 'alert2', 'receipt2', 'statement', 'statement2']],
    ['statements first', ['statement', 'statement2', 'receipt2', 'alert', 'receipt', 'alert2']],
  ]) {
    let state = BASE;
    for (const key of keys) state = importRows(state, [two[key]]);
    const rows = e(state.transactions);
    ok(`two payments two weeks apart, ${label}: two rows, both on the ADCB card, one per date`,
      rows.length === 2 && rows.every((row) => row.accountId === 'adcb-card' && row.billIdentity === 'account:2543') &&
        new Set(rows.map((row) => row.date.slice(0, 10) <= '2026-08-10' ? 'early' : 'late')).size === 2, describe(rows));
  }

  // Two genuine payments on the SAME day to two e& accounts, 20 minutes
  // apart: each receipt sees two equal ADCB charges, so the receipt rule
  // refuses to guess. It must never fold either ADCB payment away.
  const sameDay = {
    alertA: adcbAlert(31, '2026-08-04T10:00:00Z', '04/08/2026'),
    receiptA: eAndReceipt(32, '2026-08-04T10:00:30Z', '2543'),
    alertB: adcbAlert(33, '2026-08-04T10:20:00Z', '04/08/2026'),
    receiptB: eAndReceipt(34, '2026-08-04T10:20:30Z', '9911'),
    statementA: statementLine('2026-08-05', 0, 'c'),
    statementB: statementLine('2026-08-05', 1, 'c'),
  };
  {
    let state = BASE;
    for (const key of Object.keys(sameDay)) state = importRows(state, [sameDay[key]]);
    const rows = e(state.transactions);
    const card = rows.filter((row) => row.accountId === 'adcb-card' && row.paymentFlowSide === undefined);
    ok('two same-day payments to two e& accounts: both ADCB payments survive',
      card.length === 2, describe(rows));
    ok('and Spent never counts fewer than the two payments',
      summarizeMonth(state.transactions, '2026-08').expenseFils >= 31395 * 3,
      summarizeMonth(state.transactions, '2026-08').expenseFils);
  }

  // Liv's own bill-pay of the same amount beside the ADCB triple: two payments.
  {
    const liv = sms(41, '2026-08-04T09:00:00Z', 'LIV',
      'Your payment instructions of AED 313.95 to Etisalat for consumer number 4026 has been processed');
    for (const [label, rows] of [
      ['Liv first', [liv, one.alert, one.receipt, one.statement]],
      ['Liv last', [one.statement, one.receipt, one.alert, liv]],
    ]) {
      let state = BASE;
      for (const row of rows) state = importRows(state, [row]);
      const out = e(state.transactions);
      ok(`${label}: Liv's bill-pay and the ADCB e& payment stay two payments`,
        out.length === 2 && out.filter((row) => row.accountId === 'adcb-card').length === 1, describe(out));
    }
  }

  // M2 through parse -> plan -> apply: the settlement keeps the biller tail
  // as a guard, the e& receipt for another account survives, and the
  // settlement still pays a Party-ID-keyed e& reminder.
  {
    const settlement = (id, iso, tail) => sms(id, iso, 'ETISALAT',
      `Your payment of AED 313.95 from your Credit Card ending 2518 has been received towards your Etisalat account ${tail}.`);
    const s9876 = settlement(51, '2026-08-04T10:00:00Z', '9876');
    ok('the parsed settlement carries the guard, its card and no bill identity',
      s9876.billerAccountTail === '9876' && s9876.billIdentity === undefined && s9876.card?.last4 === '2518',
      JSON.stringify({ g: s9876.billerAccountTail, b: s9876.billIdentity, c: s9876.card }));
    const receipt2543 = eAndReceipt(52, '2026-08-04T10:05:00Z', '2543');
    for (const [label, rows] of [['settlement first', [s9876, receipt2543]], ['receipt first', [receipt2543, s9876]]]) {
      let state = BASE;
      for (const row of rows) state = importRows(state, [row]);
      const out = e(state.transactions);
      ok(`${label}: a settlement for e& 9876 and a receipt for e& 2543 stay two payments`,
        out.length === 2 && out.some((row) => row.billIdentity === 'account:2543') &&
          out.some((row) => row.billerAccountTail === '9876' && row.billIdentity === undefined), describe(out));
      const party = { id: 'party', title: 'E&', category: 'telecom', amountFils: 31395, dueDay: 15,
        autoDetected: true, importIdentity: 'party:4835', paidMonths: [] };
      const bills = billsForMonth([party], state.transactions, today);
      ok(`${label}: the settlement still pays a Party-ID-keyed e& reminder`, bills[0]?.status === 'paid',
        JSON.stringify(bills[0] && bills[0].status));
    }
  }
}

// --- M2: a settlement's biller account is a fold guard ----------------------
{
  // "Your payment of AED 350.00 from your Credit Card ending 2518 has been
  // received towards your Etisalat account 9876" carries no bill identity
  // (bills.ts would refuse it against a Party-ID reminder), only the guard
  // billerAccountTail. An e& receipt for account 2543 of the same amount the
  // same morning is a different line's payment and must survive.
  const r = receipt('r2543', 35000, '2026-09-01T09:00:00Z');
  const settle = bank('s9876', 35000, '2026-09-01T09:30:00Z', { billerAccountTail: '9876' });
  for (const [label, rows] of [['receipt first', [r, settle]], ['settlement first', [settle, r]]]) {
    const out = reconcilePaymentFlows(rows);
    ok(`${label}: a settlement for e& 9876 never absorbs a receipt for e& 2543`,
      ids(out) === 'r2543,s9876', ids(out));
  }
  ok('the guard is not carried onto the bank row or turned into a bill identity',
    reconcilePaymentFlows([r, settle]).find((row) => row.id === 's9876')?.billIdentity === undefined);
  // Control: the same account on both sides is one payment, as before.
  const same = reconcilePaymentFlows([r, bank('s2543', 35000, '2026-09-01T09:30:00Z', { billerAccountTail: '2543' })]);
  ok('a settlement naming the receipt\'s own account still folds the receipt', ids(same) === 's2543', ids(same));
  // A malformed stored guard reads as absent, never as a wildcard conflict.
  const junk = reconcilePaymentFlows([r, bank('sjunk', 35000, '2026-09-01T09:30:00Z', { billerAccountTail: 'account:9876' })]);
  ok('a malformed guard is ignored', ids(junk) === 'sjunk', ids(junk));
  // An unplaceable receipt is compared with the BANK row's stated accounts,
  // the guard included: one for 9876 cannot be the receipt of a settlement
  // that names 2543, so it does not block that fold.
  const otherCompetitor = reconcilePaymentFlows([
    receipt('r', 35000, '2026-09-01T09:00:00Z'),
    bank('b', 35000, '2026-09-01T09:00:30Z', { billerAccountTail: '2543' }),
    receipt('c', 35000, '2026-09-01T09:05:00Z', { title: 'Payment to •9876', billIdentity: 'account:9876' }),
  ]);
  ok("an unnamed receipt for another account than the bank row's guard does not compete", ids(otherCompetitor) === 'b,c',
    ids(otherCompetitor));
  // Against a bank row that states no account, either receipt could be its
  // own, exactly like two named receipts for two accounts: nothing folds.
  const open = reconcilePaymentFlows([
    receipt('r', 35000, '2026-09-01T09:00:00Z'),
    bank('b', 35000, '2026-09-01T09:00:30Z'),
    receipt('c', 35000, '2026-09-01T09:05:00Z', { title: 'Payment to •9876', billIdentity: 'account:9876' }),
  ]);
  ok('with no stated account on the bank row, an unnamed receipt for another account keeps it ambiguous',
    ids(open) === 'b,c,r', ids(open));
}

// --- L1: receipts the rule cannot place still compete ------------------------
{
  const r = receipt('r', 45045, '2026-08-04T10:00:30Z');
  const b = bank('b', 45045, '2026-08-04T10:00:00Z');
  ok('control: the receipt folds into the bank row on its own', ids(reconcilePaymentFlows([r, b])) === 'b');
  // e&'s amount-first receipt is titled "Payment to •2543" (parser 62). A
  // second message about the same payment makes the bank row's receipt
  // ambiguous: nothing is folded.
  const unnamed = receipt('u', 45045, '2026-08-04T10:01:00Z', { title: 'Payment to •2543' });
  for (const [label, rows] of [['unnamed first', [unnamed, r, b]], ['unnamed last', [r, b, unnamed]]]) {
    ok(`${label}: an unnamed same-money receipt competes, so nothing is folded`,
      ids(reconcilePaymentFlows(rows)) === 'b,r,u', ids(reconcilePaymentFlows(rows)));
  }
  const bareUnnamed = receipt('u2', 45045, '2026-08-04T10:01:00Z', { title: 'Payment to •2543', billIdentity: undefined });
  ok('an unnamed receipt with no identity competes too',
    ids(reconcilePaymentFlows([r, b, bareUnnamed])) === 'b,r,u2');
  const pinnedUnnamed = { ...unnamed, id: 'up', userEdited: true };
  ok('a pinned unnamed receipt competes and is never removed',
    ids(reconcilePaymentFlows([r, b, pinnedUnnamed])) === 'b,r,up');
  const bankSentUnnamed = { ...unnamed, id: 'uc', billIdentity: 'consumer:2543' };
  ok("a bank's unnamed bill-pay confirmation competes as well",
    ids(reconcilePaymentFlows([r, b, bankSentUnnamed])) === 'b,r,uc');
  ok('an unnamed receipt alone is never folded and never removes anything',
    ids(reconcilePaymentFlows([unnamed, b])) === 'b,u');
  // Only a receipt that COULD be the bank row's: another amount, another
  // stated account, or a day outside the window does not compete.
  ok('an unnamed receipt of another amount does not compete',
    ids(reconcilePaymentFlows([r, b, { ...unnamed, amountFils: 45046 }])) === 'b,u');
  ok('an unnamed receipt three days earlier does not compete',
    ids(reconcilePaymentFlows([r, b, receipt('far', 45045, '2026-08-01T10:00:00Z', { title: 'Payment to •2543' })])) === 'b,far');
  // A receipt whose date cannot be read cannot be placed in any window, so it
  // competes with every same-money bank row instead of being ignored.
  const undated = receipt('d', 45045, '2026-08-04T10:01:00Z', { date: '' });
  ok('an undated receipt is never removed', ids(reconcilePaymentFlows([undated, b])) === 'b,d');
  ok('an undated receipt competes, so nothing is folded',
    ids(reconcilePaymentFlows([r, b, undated])) === 'b,d,r');
  const statedBank = bank('bs', 45045, '2026-08-04T10:00:00Z', { billerAccountTail: '2543' });
  ok("an undated receipt for another account than the bank row's does not compete",
    ids(reconcilePaymentFlows([r, statedBank, { ...undated, billIdentity: 'account:9911' }])) === 'bs,d');
  ok('an undated bank bill-pay confirmation competes as well',
    ids(reconcilePaymentFlows([r, b, { ...undated, id: 'dc', billIdentity: 'consumer:2543' }])) === 'b,dc,r');
  const unreadable = receipt('x', 45045, '2026-08-04T10:01:00Z', { title: '•' });
  ok('a receipt whose title yields no biller key competes',
    ids(reconcilePaymentFlows([r, b, unreadable])) === 'b,r,x');
}

console.log(`\nbiller-receipt-dedupe.test.js: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
