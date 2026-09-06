const assert = require('assert');
const { isDeepStrictEqual } = require('util');

const { interpretBankAlert } = require('./build/bank-alert-interpreter.js');
const { createLaunchAlertSession } = require('./build/launch-alert-parser.js');
const { withMarketPackForParsing } = require('./build/markets.js');
const { parseSms } = require('./build/sms-parser.js');
const uaeCorpus = require('./fixtures/uae-bank-formats');
const saudiCorpus = require('./fixtures/saudi-bank-formats');

let pass = 0;
const ok = (name, condition, detail) => {
  assert.ok(condition, detail);
  pass += 1;
  console.log(`✓ ${name}`);
};

// The new seam is legacy-first. Every launch-tested corpus success must remain
// the exact same ParsedSms object—not merely keep the same amount.
for (const row of [...uaeCorpus, ...saudiCorpus]) {
  const legacy = withMarketPackForParsing(row.market, () =>
    parseSms(row.body, {}, { sender: row.bank }));
  const result = interpretBankAlert({
    source: row.body,
    sender: row.bank,
    market: row.market,
  });
  ok(`${row.id}: existing parser result is byte-for-byte stable`,
    result.outcome === 'parsed' && isDeepStrictEqual(result.parsed, legacy),
    JSON.stringify({ legacy, result }));
}

const payroll = interpretBankAlert({
  source: 'Payroll credit: AED 7,500.00 was posted to your account 1234.',
  sender: 'FAB',
  market: 'AE',
});
ok('explicit posted payroll corrects a legacy debit-direction mistake',
  payroll.outcome === 'parsed' && payroll.origin === 'semantic' &&
    payroll.meaning === 'salary-income' && payroll.parsed.type === 'income' &&
    payroll.parsed.amountFils === 750000 && payroll.parsed.currency === 'AED' &&
    payroll.parsed.merchant === 'Salary' && payroll.parsed.categoryGuess === 'salary' &&
    payroll.parsed.transferHint === false,
  JSON.stringify(payroll));

const payrollWithBalance = interpretBankAlert({
  source: 'Payroll credit AED 7,500.00 was posted to your account 1234. Available balance AED 9,250.00.',
  sender: 'FAB',
  market: 'AE',
});
ok('a salary uses the posted figure and never the balance decoy',
  payrollWithBalance.outcome === 'parsed' &&
    payrollWithBalance.parsed.amountFils === 750000 &&
    payrollWithBalance.parsed.snapshotFils === 925000,
  JSON.stringify(payrollWithBalance));

const ownMove = interpretBankAlert({
  source: 'AED 5,000.00 moved from your account 002 to your own account 004 successfully.',
  sender: 'ADCB',
  market: 'AE',
});
ok('explicit owned account-to-account movement is excluded from spending',
  ownMove.outcome === 'parsed' && ownMove.origin === 'semantic' &&
    ownMove.meaning === 'own-account-transfer' && ownMove.parsed.type === 'expense' &&
    ownMove.parsed.amountFils === 500000 && ownMove.parsed.transferHint === true &&
    ownMove.parsed.merchant === 'Own account transfer' &&
    ownMove.parsed.categoryGuess === 'other',
  JSON.stringify(ownMove));

for (const [name, source, sender, market, amountFils] of [
  ['ENBD payroll', 'Payroll credit: AED 7,500.00 was posted to your account 1234.', 'ENBD', 'AE', 750000],
  ['ADCB WPS', 'WPS AED 8,500.00 posted to A/C XXXX1234.', 'ADCB', 'AE', 850000],
  ['Mashreq salary', 'Your salary of AED 12,000.00 was credited to your account.', 'Mashreq', 'AE', 1200000],
  ['Albilad Arabic salary', 'تم إيداع راتب بمبلغ SAR 8500.00 في حسابك بنجاح', 'ALBILAD', 'SA', 850000],
]) {
  const result = interpretBankAlert({ source, sender, market });
  ok(`${name} reaches the same bank-independent salary meaning`,
    result.outcome === 'parsed' && result.meaning === 'salary-income' &&
      result.parsed.type === 'income' && result.parsed.categoryGuess === 'salary' &&
      result.parsed.amountFils === amountFils,
    JSON.stringify(result));
}

const businessPayout = interpretBankAlert({
  source: 'Merchant payout of AED 1,250.00 was credited to your account 4321 successfully.',
  sender: 'FAB',
  market: 'AE',
});
ok('an explicit merchant payout is business income without a bank sentence template',
  businessPayout.outcome === 'parsed' && businessPayout.origin === 'semantic' &&
    businessPayout.meaning === 'business-income' && businessPayout.parsed.type === 'income' &&
    businessPayout.parsed.amountFils === 125000 &&
    businessPayout.parsed.categoryGuess === 'business' &&
    businessPayout.parsed.merchant === 'Business income',
  JSON.stringify(businessPayout));

const refund = interpretBankAlert({
  source: 'Refund of AED 125.00 was credited to your account 4321 successfully.',
  sender: 'FAB',
  market: 'AE',
});
ok('an explicit posted refund remains an offset rather than revenue',
  refund.outcome === 'parsed' && refund.meaning === 'refund' &&
    refund.parsed.type === 'income' && refund.parsed.amountFils === 12500 &&
    refund.parsed.categoryGuess === 'other' && refund.parsed.merchant === 'Refund',
  JSON.stringify(refund));

const externalTransfer = interpretBankAlert({
  source: 'AED 700.00 was transferred from your account 002 to AHMED successfully.',
  sender: 'ADCB',
  market: 'AE',
});
ok('a named outgoing transfer stays external cash out rather than an own-account move',
  externalTransfer.outcome === 'parsed' &&
    externalTransfer.meaning === 'external-transfer' &&
    externalTransfer.parsed.type === 'expense' &&
    externalTransfer.parsed.amountFils === 70000 &&
    externalTransfer.parsed.transferHint === false,
  JSON.stringify(externalTransfer));

const withdrawal = interpretBankAlert({
  source: 'Cash withdrawal of AED 600.00 was completed at ATM using card ending 1234.',
  sender: 'ENBD',
  market: 'AE',
});
ok('ATM wording produces a cash withdrawal, not a generic purchase',
  withdrawal.outcome === 'parsed' && withdrawal.meaning === 'cash-withdrawal' &&
    withdrawal.parsed.categoryGuess === 'cash-withdrawal' &&
    withdrawal.parsed.amountFils === 60000,
  JSON.stringify(withdrawal));

const fee = interpretBankAlert({
  source: 'Annual card fee of AED 250.00 was debited from your card ending 1234.',
  sender: 'FAB',
  market: 'AE',
});
ok('an explicit posted fee remains a deliberate bank cost',
  fee.outcome === 'parsed' && fee.meaning === 'fee' &&
    fee.parsed.type === 'expense' && fee.parsed.amountFils === 25000 &&
    fee.parsed.categoryGuess === 'other' && fee.parsed.categoryDeliberate === true,
  JSON.stringify(fee));

const utility = interpretBankAlert({
  source: 'Your electricity bill payment of AED 410.00 was processed successfully for account 1234.',
  sender: 'ADCB',
  market: 'AE',
});
ok('a completed utility payment carries receipt evidence for history and reconciliation',
  utility.outcome === 'parsed' && utility.meaning === 'utility-payment' &&
    utility.parsed.type === 'expense' && utility.parsed.categoryGuess === 'utilities' &&
    utility.parsed.paymentFlowSide === 'receipt' && utility.parsed.amountFils === 41000,
  JSON.stringify(utility));

const internetUtility = interpretBankAlert({
  source: 'Your internet bill payment of AED 410.00 was processed successfully for Party-ID 3014835.',
  sender: 'ADCB',
  market: 'AE',
});
ok('semantic payment evidence preserves the parser’s more specific Telecom category',
  internetUtility.outcome === 'parsed' &&
    internetUtility.meaning === 'utility-payment' &&
    internetUtility.parsed.categoryGuess === 'telecom' &&
    internetUtility.parsed.paymentFlowSide === 'receipt',
  JSON.stringify(internetUtility));

const settlementReceipt = interpretBankAlert({
  source: 'Payment of AED 900.00 was received for your credit card ending 1234.',
  sender: 'FAB',
  market: 'AE',
});
ok('a card-payment receipt has the correct transfer side and direction',
  settlementReceipt.outcome === 'parsed' && settlementReceipt.origin === 'semantic' &&
    settlementReceipt.meaning === 'card-settlement' &&
    settlementReceipt.parsed.kind === 'cardPayment' &&
    settlementReceipt.parsed.type === 'income' &&
    settlementReceipt.parsed.cardPaymentSide === 'receipt' &&
    settlementReceipt.parsed.transferHint === true,
  JSON.stringify(settlementReceipt));

const settlementWithSalaryFooter = interpretBankAlert({
  source: 'Payment of AED 900.00 was received for your credit card ending 1234. Earn salary rewards with FAB.',
  sender: 'FAB',
  market: 'AE',
});
ok('unrelated salary language cannot turn a structured card payment into salary',
  settlementWithSalaryFooter.outcome === 'parsed' &&
    settlementWithSalaryFooter.parsed.kind === 'cardPayment' &&
    settlementWithSalaryFooter.meaning === 'card-settlement',
  JSON.stringify(settlementWithSalaryFooter));

const userPinnedPayout = interpretBankAlert({
  source: 'Merchant payout of AED 1,250.00 was credited to your account 4321 successfully.',
  sender: 'FAB',
  market: 'AE',
  overrides: { 'incoming transfer': 'salary' },
});
ok('a compatible user category pin still outranks semantic categorization',
  userPinnedPayout.outcome === 'parsed' && userPinnedPayout.parsed.categoryPinned === true &&
    userPinnedPayout.parsed.categoryGuess === 'salary',
  JSON.stringify(userPinnedPayout));

const namedPersonalCredit = interpretBankAlert({
  source: 'AED 2,500.00 has been credited to your account from JOHN DOE.',
  sender: 'FAB',
  market: 'AE',
});
ok('a named personal credit is not invented as salary or business income',
  namedPersonalCredit.outcome === 'parsed' &&
    namedPersonalCredit.meaning === 'generic-income' &&
    namedPersonalCredit.parsed.categoryGuess === 'other' &&
    namedPersonalCredit.parsed.categoryDeliberate === false,
  JSON.stringify(namedPersonalCredit));

const debitToSalary = interpretBankAlert({
  source: 'AED 500.00 has been debited from your account 1234 to SALARY successfully.',
  sender: 'FAB',
  market: 'AE',
});
ok('salary as an outgoing payee never becomes salary income',
  debitToSalary.outcome === 'parsed' && debitToSalary.parsed.type === 'expense' &&
    debitToSalary.meaning !== 'salary-income',
  JSON.stringify(debitToSalary));

const futureSalary = interpretBankAlert({
  source: 'Your salary of AED 15,000.00 will be credited on 25 Aug.',
  sender: 'FAB',
  market: 'AE',
});
ok('a future salary notice never posts money', futureSalary.outcome === 'refuse',
  JSON.stringify(futureSalary));

const futureUtility = interpretBankAlert({
  source: 'Your electricity bill of AED 410.00 is due on 25 Aug.',
  sender: 'ADCB',
  market: 'AE',
});
ok('a due-only utility reminder never becomes a posted payment',
  futureUtility.outcome === 'refuse' ||
    (futureUtility.outcome === 'parsed' && futureUtility.parsed.kind === 'billDue'),
  JSON.stringify(futureUtility));

const billDue = interpretBankAlert({
  source: 'Your DEWA bill of AED 450.00 is due on 25/08/2026. Please pay before the due date.',
  sender: 'DEWA',
  market: 'AE',
});
ok('due-only utility wording stays a reminder rather than becoming spending',
  billDue.outcome === 'parsed' && billDue.meaning === 'bill-due' &&
    billDue.parsed.kind === 'billDue' && billDue.parsed.amountFils === 45000,
  JSON.stringify(billDue));

const cardStatement = interpretBankAlert({
  source: 'Your Credit Card ending 4821 statement is generated. Total due AED 3,240.00, minimum due AED 162.00 by 05/08/2026.',
  sender: 'FAB',
  market: 'AE',
});
ok('statement labels retain total, minimum and due date without posting spending',
  cardStatement.outcome === 'parsed' && cardStatement.meaning === 'card-statement' &&
    cardStatement.parsed.kind === 'cardStatement' &&
    cardStatement.parsed.amountFils === 324000 &&
    cardStatement.parsed.minDueFils === 16200 &&
    cardStatement.parsed.date === '2026-08-05',
  JSON.stringify(cardStatement));

const ambiguousSalary = interpretBankAlert({
  source: 'Payroll amounts AED 7,500.00 and AED 500.00 were posted to your account 1234.',
  sender: 'FAB',
  market: 'AE',
});
ok('two plausible payroll amounts cannot use semantic auto-import',
  ambiguousSalary.outcome !== 'parsed' || ambiguousSalary.origin !== 'semantic',
  JSON.stringify(ambiguousSalary));

const unknownSender = createLaunchAlertSession({ overrides: {}, activeMarket: 'AE' });
const unknownSalary = unknownSender.parse(
  'Payroll credit: AED 7,500.00 was posted to your account 1234.',
  'MY-COMPANY',
  null,
);
ok('an already-importable local-currency alert may have its proven salary direction corrected',
  unknownSalary?.type === 'income' && unknownSalary.categoryGuess === 'salary' &&
    unknownSalary.amountFils === 750000,
  JSON.stringify(unknownSalary));

const unknownSenderMiss = createLaunchAlertSession({ overrides: {}, activeMarket: 'AE' });
const unknownMiss = unknownSenderMiss.parse(
  'AED 5,000.00 moved from account 002 to own account 004 successfully.',
  'MY-COMPANY',
  null,
);
ok('unknown senders cannot unlock a brand-new semantic transaction', unknownMiss === null,
  JSON.stringify(unknownMiss));

const globalIssuer = createLaunchAlertSession({ overrides: {}, activeMarket: 'AE' });
const globalInspection = globalIssuer.inspect(
  'CHASE: Payroll credit USD 7,500.00 was posted to your account 1234.',
  'CHASE',
);
const globalSalary = globalIssuer.parse(
  'CHASE: Payroll credit USD 7,500.00 was posted to your account 1234.',
  'CHASE',
  globalInspection,
);
ok('a global issuer never falls through to the Gulf semantic parser', globalSalary === null,
  JSON.stringify({ globalInspection, globalSalary }));

ok('semantic evidence is closed and contains no message or sender text',
  payroll.outcome === 'parsed' &&
    !JSON.stringify(payroll.evidence).includes('7,500') &&
    !JSON.stringify(payroll.evidence).includes('FAB') &&
    payroll.evidence.includes('salary-language'),
  JSON.stringify(payroll.outcome === 'parsed' ? payroll.evidence : payroll));

// Regression: the real ENBD fixture must never be relabelled by semantic
// fallback after the legacy parser's accounting-currency guard refuses it.
{
  const markets = require('./build/markets.js');
  const body = uaeCorpus.find((row) => row.id === 'enbd-credit-card-purchase').body;
  for (const [currency, exponent] of [['USD', 2], ['KWD', 3], ['JPY', 0], ['SAR', 2], ['AED', 3]]) {
    markets.setLedgerCurrency(null);
    markets.setActiveMarket('AE');
    markets.setLedgerCurrency(currency, exponent);
    const result = interpretBankAlert({ source: body, sender: 'ENBD', market: 'AE' });
    ok(`${currency}/${exponent}: incompatible ledger blocks semantic fallback`,
      result.outcome === 'refuse', JSON.stringify(result));
    const session = createLaunchAlertSession({ overrides: {} });
    ok(`${currency}/${exponent}: capture never returns differently denominated money`,
      session.parse(body, 'ENBD', session.inspect(body, 'ENBD')) === null);
  }
  markets.setLedgerCurrency(null);
  markets.setActiveMarket('AE');
  markets.setLedgerCurrency('AED', 2);
  const { parsePastedBankAlerts } = require('./build/launch-alert-parser.js');
  ok('paste exposes the shared semantic interpretation boundary', typeof parsePastedBankAlerts === 'function');
  const pasted = parsePastedBankAlerts('Payroll credit: AED 7,500.00 was posted to your account 1234.', {});
  ok('existing payroll regression is income through the public paste boundary',
    pasted.length === 1 && pasted[0].type === 'income' &&
      pasted[0].categoryGuess === 'salary' && pasted[0].amountFils === 750000,
    JSON.stringify(pasted));
  ok('paste never manufactures sender evidence for a foreign issuer',
    parsePastedBankAlerts('CHASE: Payroll credit USD 7,500.00 was posted to your account 1234.', {}).length === 0);
  markets.setLedgerCurrency(null);
}

// Minimum-payment information cannot establish a total debt or an expense.
for (const source of [
  'Card XXXX8722 Available Balance AED440.10 Last Stmt2022-05-11 Min Amt AED154.32 Pymt due2022-06-06 Last Pymt AED50 Last Pymt date2022-05-07',
  'Credit Card ending 1234 statement: Minimum due AED 50.00. Due on 05/10/2026.',
  'Credit card statement: Minimum payment AED 50.00. Due on 05/10/2026.',
]) {
  const result = interpretBankAlert({ source, sender: 'ENBD', market: 'AE' });
  ok('minimum-only statement is refused rather than restored as an expense or obligation',
    result.outcome === 'refuse', JSON.stringify(result));
  const { parsePastedBankAlerts } = require('./build/launch-alert-parser.js');
  ok('pasted minimum-only statement admits no transaction-shaped review row',
    parsePastedBankAlerts(source, {}).length === 0);
}

// Synthetic punctuation/precision mutations of the existing purchase grammar.
// These are refusal controls, not evidence of a new bank format or locale.
for (const amount of ['1.234,56', '1,23', '100.001', '1,00,0.00', '8 950.00', '8\u00a0950.00', '8\u2009950.00', '89.50e3']) {
  const source = `Purchase of AED ${amount} with Credit Card ending 1234 at CARREFOUR on 05/09/2026. Available limit AED 5,000.00. Fee AED 2.00 applied.`;
  ok(`malformed local amount ${amount} cannot become a partial purchase or fee`,
    parseSms(source) === null);
  const result = interpretBankAlert({ source, sender: 'ENBD', market: 'AE' });
  ok(`semantic fallback cannot restore malformed local amount ${amount}`,
    result.outcome !== 'parsed', JSON.stringify(result));
}
for (const [market, sender, source] of [
  ['AE', 'ENBD', 'Purchase of 100.001 AED with Credit Card ending 1234 at CARREFOUR. Fee AED 2.00 applied.'],
  ['SA', 'ALBILAD', 'Purchase of SAR 100.001 with Credit Card ending 1234 at CARREFOUR. Fee SAR 2.00 applied.'],
  ['AE', 'ENBD', 'Purchase of USD 20.00 (AED 73.451) with Credit Card ending 1234 at CARREFOUR.'],
  ['AE', 'ENBD', 'Credit Card ending 1234 statement: Minimum due AED 50.00. Total due AED 1.234,56. Due on 05/10/2026.'],
]) {
  const result = interpretBankAlert({ source, sender, market });
  ok(`${market}: suffix, FX and statement paths cannot bypass whole local-money validation`,
    result.outcome !== 'parsed', JSON.stringify(result));
}
for (const [source, amountFils] of [
  ['Purchase of AED 1,234.56 with Credit Card ending 1234 at CARREFOUR.', 123456],
  ['Purchase of AED .99 with Credit Card ending 1234 at CARREFOUR.', 99],
  ['Purchase of 1,234.56 AED with Credit Card ending 1234 at CARREFOUR.', 123456],
  ['Purchase of AED 150٫75 with Credit Card ending 1234 at CARREFOUR.', 15075],
]) {
  ok('well-formed grouping, suffix and sub-unit amounts remain readable',
    parseSms(source)?.amountFils === amountFils);
}
{
  const source = 'Purchase of AED 89.50 with Credit Card ending 1234 at CARREFOUR. Available limit AED 1.234,56.';
  const parsed = parseSms(source);
  ok('an invalid balance cannot corrupt an otherwise valid purchase',
    parsed?.amountFils === 8950 && parsed.snapshotFils === null);
}
{
  // Original parking corpus: VAT precision belongs to a separate tax detail,
  // while the posted fee itself is explicitly stated in whole fils.
  const source = 'Confirmation\nPlateNo-1239301\nPlateSource-Dubai\nTicketNo-4479126\nFee-AED2.38\nVAT-AED0.019\nPaid upto 09/07/26 09:08PM';
  const parsed = parseSms(source);
  ok('ancillary parking tax precision preserves the explicit posted fee',
    parsed?.amountFils === 238 && parsed.categoryGuess === 'transport');
}

for (const currency of ['AED', 'CAD']) {
  for (const clause of ['requires OTP123456', 'Enter OTP123456 to complete', 'Use OTP123456 to confirm']) {
    const source = `Card purchase ${currency} 24.90 at LOCAL CAFE ${clause}.`;
    const result = interpretBankAlert({ source, sender: 'ENBD', market: 'AE' });
    ok(`known launch bank cannot restore ${currency} ${clause} as a posting`,
      result.outcome === 'refuse', JSON.stringify(result));
  }
}
for (const merchant of ['LOCAL CAFE', 'SECURITY CODE CAFE', 'OTP123456 CAFE', 'USE OTP123456 CAFE']) {
  const source = `Purchase of AED 24.90 with Credit Card ending 1234 at ${merchant}. Do not share your OTP. Ref: 123456.`;
  const result = interpretBankAlert({ source, sender: 'ENBD', market: 'AE' });
  ok(`completed ${merchant} purchase retains ordinary security footer`,
    result.outcome === 'parsed' && result.parsed.amountFils === 2490, JSON.stringify(result));
}

console.log(`\nbank-alert-interpreter: ${pass} passed, 0 failed`);
