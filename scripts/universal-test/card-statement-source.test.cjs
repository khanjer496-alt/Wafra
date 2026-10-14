'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./load-ts.cjs');
const load = createLoader();
const { parseSms } = load('@/lib/sms-parser');
const { setActiveMarket, setLedgerCurrency } = load('@/lib/markets');

// Grammar derived from public examples, with all figures, dates, identifiers
// and issuer/product names replaced. These are synthetic regressions, not
// customer fixtures or independent account/posting ground truth.
// https://www.reddit.com/r/shortcuts/comments/1nhhshl/ios_shortcuts_to_create_due_date_reminders_from/
// https://github.com/sarim2000/pennywiseai-tracker/issues/443
function parse(text) {
  setActiveMarket('AE');
  setLedgerCurrency('AED', 2);
  return parseSms(text, undefined, { observedAt: Date.parse('2026-10-29T12:00:00Z') });
}
function statement(parsed, fields = {}) {
  assert.ok(parsed, 'a stated card obligation remains readable');
  assert.equal(parsed.kind, 'cardStatement');
  assert.equal(parsed.amountFils, 327650);
  assert.equal(parsed.minDueFils, 18025);
  assert.equal(parsed.currency, 'AED');
  assert.equal(parsed.transferHint, false);
  for (const [key, value] of Object.entries(fields)) assert.deepEqual(parsed[key], value, key);
}

test('card statement total-of and minimum-of labels retain both figures', () => {
  statement(parse('Cedar Bank Credit Card XX7642 Statement is available. Total of AED 3,276.50 and minimum of AED 180.25 is due by 04-Nov-26.'),
    { date: '2026-11-04', dueDay: 4, card: { last4: '7642', kind: 'credit' } });
});
test('paired statement totals cannot bind an unrelated earlier card', () => {
  assert.equal(parse('Credit Card XX4321. Cedar Bank Credit Card XX7642 Statement is available. Total of AED 3,276.50 and minimum of AED 180.25 is due by 04-Nov-26.'), null);
});
test('paired statement totals cannot bind competing cards after the total', () => {
  assert.equal(parse('Cedar Bank Credit Card XX7642 Statement is available. Total of AED 3,276.50 and minimum of AED 180.25 is due by 04-Nov-26. Credit Card XX4321.'), null);
});
test('paired statement totals reject a different debit or prepaid owner', () => {
  for (const owner of ['Debit Card XX4321', 'Prepaid Card XX4321', 'Debit Card XX7642']) {
    assert.equal(parse(`${owner}. Cedar Bank Credit Card XX7642 Statement is available. Total of AED 3,276.50 and minimum of AED 180.25 is due by 04-Nov-26.`), null);
  }
});
test('paired statement totals cannot mistake a masked PAN prefix for its owner', () => {
  assert.equal(parse('Credit Card 7642********4321. Cedar Bank Credit Card XX7642 Statement is available. Total of AED 3,276.50 and minimum of AED 180.25 is due by 04-Nov-26.'), null);
});
test('paired statement totals retain one full masked PAN and repeated same-card labels', () => {
  for (const owner of ['Credit Card 4321********7642', 'Credit Card XX7642. Credit Card XX7642']) {
    statement(parse(`Cedar Bank ${owner} Statement is available. Total of AED 3,276.50 and minimum of AED 180.25 is due by 04-Nov-26.`),
      { card: { last4: '7642', kind: 'credit' } });
  }
});
test('account tails before or after paired dues cannot become card owners', () => {
  const due = 'Cedar Bank Credit Card XX7642 Statement is available. Total of AED 3,276.50 and minimum of AED 180.25 is due by 04-Nov-26.';
  for (const owner of ['Account XXXX0135', 'Account XXXX7642', 'Account 4321********0135']) {
    assert.equal(parse(`${owner}. ${due}`), null);
    assert.equal(parse(`${due} ${owner}.`), null);
  }
  assert.equal(parse('Cedar Bank Credit Card Statement is available for Account XXXX0135. Total of AED 3,276.50 and minimum of AED 180.25 is due by 04-Nov-26.'), null);
});
test('paired dues without instrument digits keep ownership unknown', () => {
  statement(parse('Cedar Bank Credit Card Statement is available. Total of AED 3,276.50 and minimum of AED 180.25 is due by 04-Nov-26.'),
    { card: null, date: '2026-11-04' });
});
test('an Arabic card tail cannot compete with the paired statement card', () => {
  assert.equal(parse('Cedar Bank Credit Card XX7642 Statement is available. Total of AED 3,276.50 and minimum of AED 180.25 is due by 04-Nov-26. البطاقة الائتمانية المنتهية 4321.'), null);
});
test('an unrelated total-of cashback figure cannot become statement debt', () => {
  assert.equal(parse('Cedar Bank Credit Card XX7642 statement has been generated. Total of AED 52.80 cashback was earned. Minimum due AED 180.25 by 04-Nov-26.'), null);
});
test('an unrelated minimum-of cashback figure cannot replace the stated minimum', () => {
  statement(parse('Cedar Bank Credit Card XX7642 statement has been generated. Minimum of AED 52.80 cashback was earned. Total due: AED 3,276.50. Minimum due: AED 180.25 by 04-Nov-26.'));
});
test('a generated statement states its total after the identified card', () => {
  statement(parse('Statement for your Cedar Bank Credit Card XX7642 of AED 3,276.50 has been generated. Due date: 04-11-26. Minimum amount due is AED 180.25.'),
    { date: '2026-11-04', dueDay: 4, card: { last4: '7642', kind: 'credit' } });
});
test('an explicit credit-card bill with no card digits keeps its total and unknown deadline', () => {
  statement(parse('Your Credit Card bill for September 2026 is generated. Total due: AED 3,276.50. Minimum due: AED 180.25.'),
    { date: null, dueDay: null, card: null });
});
test('an arbitrary card-product noun cannot prove credit-card debt or rescue an offer', () => {
  for (const product of ['GiftCard', 'PrepaidCard']) {
    assert.notEqual(parse(`Your ${product} bill for September 2026 is generated. Total due: AED 3,276.50. Minimum due: AED 180.25.`)?.kind, 'cardStatement');
  }
  assert.equal(parse('Apply now for your CedarCard bill for September 2026. Total due: AED 3,276.50. Minimum due: AED 180.25. Get cashback offer.'), null);
});
test('a generated statement cannot attach its total to a different earlier card', () => {
  assert.equal(parse('Credit Card XX4321. Statement for your Cedar Bank Credit Card XX7642 of AED 3,276.50 has been generated. Due date: 04-11-26. Minimum amount due is AED 180.25.'), null);
  assert.equal(parse('Credit Card 4321********7642. Statement for your Cedar Bank Credit Card XX4321 of AED 3,276.50 has been generated. Due date: 04-11-26. Minimum amount due is AED 180.25.'), null);
});
test('a generated statement cannot bind a later card or conflicting same-tail kind', () => {
  const due = 'Statement for your Cedar Bank Credit Card XX7642 of AED 3,276.50 has been generated. Due date: 04-11-26. Minimum amount due is AED 180.25.';
  assert.equal(parse(`${due} Credit Card XX4321.`), null);
  assert.equal(parse(`Debit Card XX7642. ${due}`), null);
  assert.equal(parse(`${due} البطاقة الائتمانية المنتهية 4321.`), null);
});
test('a generated statement cannot inherit an unrelated account balance', () => {
  assert.equal(parse('Account XXXX0135 available balance AED 6,854.30. Statement for your Cedar Bank Credit Card XX7642 of AED 3,276.50 has been generated. Due date: 04-11-26. Minimum amount due is AED 180.25.'), null);
});
test('an abbreviated min-dot-due label is not replaced with an estimated minimum', () => {
  statement(parse('Cedar Bank Credit Card XX7642 Statement. Total due: AED 3,276.50 Min.due: AED 180.25 Pay by 04-11-2026'),
    { date: '2026-11-04', dueDay: 4 });
});
test('an account-side repayment field list is a debit settlement with no invented target card', () => {
  const parsed = parse('Payment towards Credit Card from Account XXXXX0135 Amount: AED 432.10 Date: 29/10/2026 Available Balance: AED 6,854.30');
  assert.ok(parsed);
  assert.equal(parsed.kind, 'cardPayment');
  assert.equal(parsed.cardPaymentSide, 'debit');
  assert.equal(parsed.amountFils, 43210);
  assert.equal(parsed.transferHint, true);
  assert.equal(parsed.card, null);
  assert.equal(parsed.snapshotFils, null);
  assert.equal(parsed.snapshotKind, null);
});
test('an incomplete repayment field list cannot become spending or use available balance as payment', () => {
  for (const text of [
    'Payment towards Credit Card from Account XXXXX0135 Amount: AED XXXX Date: 29/10/2026 Available Balance: AED 6,854.30',
    'Payment towards Credit Card from Account XXXXX0135 Date: 29/10/2026 Available Balance: AED 6,854.30',
    'Payment towards Credit Card from Account XXXXX0135 Amount: AED 432.10 Date: 31/11/2026 Available Balance: AED 6,854.30',
  ]) assert.equal(parse(text), null);
});
test('a service fee cannot replace an unreadable repayment Amount field', () => {
  for (const amount of ['AED XXXX', 'pending']) {
    assert.equal(parse(`Payment towards Credit Card from Account XXXXX0135 Amount: ${amount} Date: 29/10/2026 Service fee: AED 5.00 Available Balance: AED 6,854.30`), null);
  }
  assert.equal(parse('Payment towards Credit Card from Account XXXXX0135 Amount: AED XXXX Date: 29/10/2026 Service fee Amount: AED 5.00 Date: 29/10/2026 Available Balance: AED 6,854.30'), null);
});
test('a repayment deadline or future date cannot masquerade as completed payment time', () => {
  for (const dateField of ['Due Date: 04/11/2026', 'Date: 04/11/2026']) {
    assert.equal(parse(`Payment towards Credit Card from Account XXXXX0135 Amount: AED 432.10 ${dateField} Available Balance: AED 6,854.30`), null);
  }
  assert.equal(parse('Payment towards Credit Card from Account XXXXX0135 Date: 29/10/2026 Amount: AED 432.10 Date: 04/11/2026 Available Balance: AED 6,854.30'), null);
});
test('a malformed repayment date cannot be accepted through a valid-looking prefix', () => {
  for (const suffix of ['/99', '-99', '.99', 'bad']) {
    assert.equal(parse(`Payment towards Credit Card from Account XXXXX0135 Amount: AED 432.10 Date: 29/10/2026${suffix} Available Balance: AED 6,854.30`), null);
  }
});
test('a card BIN prefix in a confirmed receipt never supplies a card suffix', () => {
  const parsed = parse('This is to confirm receipt of your payment of AED 432.10 towards your Credit Card starting with 864275 on 29/10/2026. Available limit is AED 6,854.30.');
  assert.ok(parsed === null || parsed.card === null);
  assert.ok(parsed === null || parsed.kind === 'cardPayment');
});
test('a purchase followed by a statement deadline stays a purchase', () => {
  const parsed = parse('Credit Card Purchase Card No XXXX7642 AED 52.80 at Copper Finch on 29/10/2026. Avl Bal AED 6,854.30. Your statement due on 04/11/2026.');
  assert.equal(parsed.kind, 'transaction');
  assert.equal(parsed.type, 'expense');
  assert.equal(parsed.amountFils, 5280);
  assert.equal(parsed.date, '2026-10-29');
});
test('a minimum-only or masked-total statement does not pretend the minimum is total debt', () => {
  assert.equal(parse('Cedar Bank Credit Card XX7642 statement: Minimum of AED 180.25 is due by 04-Nov-26.'), null);
  assert.equal(parse('Cedar Bank Credit Card XX7642 statement: Total of AED XXXX and minimum of AED 180.25 is due by 04-Nov-26.'), null);
});
test('loan bill and non-card bill grammar cannot become a card statement', () => {
  for (const text of [
    'Loan bill for September 2026 is generated. Total due AED 3,276.50. Minimum due AED 180.25.',
    'Your electricity bill for September 2026 is generated. Total due AED 3,276.50. Minimum due AED 180.25.',
  ]) assert.notEqual(parse(text)?.kind, 'cardStatement');
});
test('pending and future account-side repayments never post as settlements', () => {
  for (const status of ['Payment is pending processing.', 'Payment will be processed tomorrow.']) {
    assert.equal(parse(`Payment towards Credit Card from Account XXXXX0135 Amount: AED 432.10 Date: 29/10/2026 Available Balance: AED 6,854.30. ${status}`), null);
  }
});
test('a reversed account-side repayment cannot settle the card', () => {
  const parsed = parse('Payment towards Credit Card from Account XXXXX0135 Amount: AED 432.10 Date: 29/10/2026 Available Balance: AED 6,854.30. Payment was reversed.');
  assert.notEqual(parsed?.kind, 'cardPayment');
  if (parsed) assert.equal(parsed.type, 'income');
});
test('a utility receipt funded by a credit card stays spending', () => {
  const parsed = parse('Payment of AED 432.10 has been received for your electricity bill using Credit Card XX7642 on 29/10/2026.');
  assert.ok(parsed === null || parsed.kind === 'transaction');
  if (parsed) assert.equal(parsed.type, 'expense');
});
test('a card refund with headroom cannot settle a statement', () => {
  const parsed = parse('Refund of AED 52.80 from Copper Finch on Card ending XX7642. Available limit AED 6,854.30.');
  assert.equal(parsed.kind, 'transaction');
  assert.equal(parsed.type, 'income');
  assert.equal(parsed.amountFils, 5280);
  assert.equal(parsed.snapshotKind, 'limit');
});
