'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const guards = load('@/lib/principal-posting-guards');

test('a closed own-card receipt keeps its amount without inventing card digits', () => {
  load('@/lib/country').setActiveCountry('AE');
  load('@/lib/markets').setActiveMarket('AE');
  load('@/lib/markets').setLedgerCurrency('AED', 2);
  const body = 'Your Credit Card XXX 250.00 AED purchase at NOON';
  const parsed = load('@/lib/sms-parser').parseSms(body, {}, { sender: 'ENBD' });
  assert.equal(parsed?.type, 'expense');
  assert.equal(parsed.amountFils, 25000);
  assert.equal(parsed.card?.last4 ?? null, null);
});

test('a masked card cannot consume the integer part of an explicit decimal price', () => {
  const body = 'Your Credit Card XXX 250.00 AED purchase at NOON';
  const money = load('@/lib/universal-money').extractUniversalMoney(body, { sender: 'ENBD' });
  const fields = load('@/lib/universal-fields').extractUniversalFields(body, { sender: 'ENBD' }, money.amount.spans);
  assert.equal(fields.instrument.value?.last4 ?? null, null);
  assert.ok(fields.instrument.spans.every(span => span.end <= money.amount.spans[0].start));
  const event = load('@/lib/universal-parser').inspectUniversalBankEvent(body, { sender: 'ENBD' });
  assert.equal(event.amount.evidence, 'explicit');
  assert.equal(event.amount.value?.minorUnits, '25000');
});

// The instrument/merchant may precede, follow or interrupt the predicate.
// Its spelling is not settlement evidence and cannot hide finite wording.
const rows = require('./credit-settlement-review-probes.json').filter(row =>
  row.incompleteExpense && (row.id.startsWith('cross-family-f406-') || row.id.startsWith('owned-descriptor-order:') || row.origin === 'trace-967-owned-unknown-finite' || row.origin === 'cross-family-Grok-047caf3b-and-owned-closure'));
for (const row of rows) test(`${row.id}: owned finite aspect is refused`, () => {
  const price = ['AED 250.00', '250.00 AED', 'AED 50.00'].find(value => row.body.includes(value));
  assert.ok(price, row.id);
  const start = row.body.indexOf(price);
  const span = { start, end: start + price.length };
  assert.equal(guards.isIncompletePrincipal(row.body, span, true), true, row.body);
  assert.equal(guards.isCompletedExpensePrincipal(row.body, span), false, row.body);
});

for (const descriptor of ['using card ending 1234', 'at NOT NOW CAFE', 'with your card ending 1234', 'from your account ending 1234']) {
  test(`affirmative descriptor remains complete: ${descriptor}`, () => {
    const body = `A purchase of AED 250.00 ${descriptor} was successfully made.`;
    const start = body.indexOf('AED 250.00');
    assert.equal(guards.isIncompletePrincipal(body, { start, end: start + 'AED 250.00'.length }, true), false);
    assert.equal(guards.isCompletedExpensePrincipal(body, { start, end: start + 'AED 250.00'.length }), true);
  });
}

test('owned transfer completion ends before its account descriptor', () => {
  const body = 'AED 5,000.00 was transferred between your accounts successfully.';
  assert.equal(guards.isIncompletePrincipal(body, { start: 0, end: 'AED 5,000.00'.length }, true), false);
  assert.equal(guards.isCompletedExpensePrincipal(body, { start: 0, end: 'AED 5,000.00'.length }), true);
});

for (const [body, price] of [
  ['Your payment of AED 200.00 was received towards your account. Card 1234 was used at NOON.', 'AED 200.00'],
  ['Payment of AED 350.00 received towards your DEWA account. Thank you.', 'AED 350.00'],
  ['Beneficiary AHMED received AED 700.00 from your account 002 via instant transfer.', 'AED 700.00'],
  ['AED 250.00 purchase at NOON with Credit Card 4110 is currently pending settlement.', 'AED 250.00'],
  ['Purchase posted: AED 62.00 at Harbor Lamp Bakery.', 'AED 62.00'],
  ['Refund AED 47.99 to card 1234 was reversed and debited from your account.', 'AED 47.99'],
  ['Purchase of AED 50.00 at SAMPLE SHOP with card ending 1234 on 12/10/2026, if this transaction was not processed by you call 600 000000', 'AED 50.00'],
  ['AED 250.00 was debited from your card ending 1234 at NOON, refund of your previous order is pending.', 'AED 250.00'],
  ['Account maintenance fee AED 25.00 has been applied to account 1234.', 'AED 25.00'],
  ['A Dr. transaction of AED 350.00 on your account number XXX990021 was successful.Available balance is AED 1,070.75.', 'AED 350.00'],
  ['A Dr. transaction of AED 64.30 on your account number XXX904417 was successful.Available balance is AED 2,405.40.', 'AED 64.30'],
  ['AED300.00 debited from Acc/Cr.Card XXX7720 for Salik on 11-02-2025 09:03:37 through ADCB Mobile App.Avl.Limit is AED 2508.31', 'AED300.00'],
  ['Purchase of AED 250.00 at NOON with Credit Card 4110 was authenticated via 3D Secure. Avl Bal AED 900.00', 'AED 250.00'],
  ['Trx. of AED 42.10 on your card ending **1234 at SMILES, UAE is Approved. Avl. card bal is 1234.56.', 'AED 42.10'],
  ['AED 25.00 annual card fee was assessed on card 1234.', 'AED 25.00'],
  ['Your card purchase of AED 47.99 at CANVA was approved. Card ending 1234.', 'AED 47.99'],
]) test(`existing principal is not vetoed by another owner: ${body}`, () => {
  const start = body.indexOf(price);
  assert.equal(guards.isIncompletePrincipal(body, { start, end: start + price.length }, true), false, body);
});

for (const body of [
  'Purchase of AED 50.00 with Debit Card ending 1234 at CARREFOUR.',
  'Purchase of AED 50.00 with Debit Card ending 1234 at NOT NOW CAFE.',
  'تم سحب مبلغ AED 50.00 من حسابك لدى SAMPLE',
]) test(`a genuine receipt supplies positive debit evidence: ${body}`, () => {
  const start = body.indexOf('AED 50.00');
  assert.equal(guards.isCompletedExpensePrincipal(body, { start, end: start + 'AED 50.00'.length }), true, body);
});

// A pure same-movement FX quote is annotation at every descriptor position.
for (const descriptor of ['(USD 68.00) using card ending 1234', 'using card ending 1234 (USD 68.00)', 'using card ending 1234 at AMAZON.AE (USD 68.00)', 'using card ending 1234 (68.00 USD) at AMAZON.AE']) {
  test(`FX annotation cannot cut the selected affirmative predicate: ${descriptor}`, () => {
    const body = `A purchase of AED 250.00 ${descriptor} was made.`;
    const start = body.indexOf('AED 250.00');
    const span = { start, end: start + 'AED 250.00'.length };
    assert.equal(guards.isIncompletePrincipal(body, span, true), false, body);
    assert.equal(guards.isCompletedExpensePrincipal(body, span), true, body);
  });
}
for (const sender of [undefined, 'ENBD', 'Tabby', 'Tamara']) test(`received-payment receipt retains its source identity boundary: ${sender}`, () => {
  const body = 'We have received your payment of AED 120.00 for your order from Namshi.';
  const got = load('@/lib/sms-parser').parseSms(body, {}, { sender });
  if (sender === 'Tabby' || sender === 'Tamara') assert.equal(got, null);
  else { assert.equal(got?.type, 'expense'); assert.equal(got.amountFils, 12000); }
});
