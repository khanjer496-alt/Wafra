const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader } = require('./load-ts.cjs');
const { extractUniversalFields } = createLoader()('@/lib/universal-fields');

// Synthetic field-extraction controls using vocabulary in the supplied corpus.
// These do not establish support for any additional real bank template.
const explicit = (field, value) => {
  assert.equal(field.evidence, 'explicit');
  assert.deepEqual(field.value, value);
  assert.deepEqual(field.alternatives, []);
};
test('explicit merchant label retains source spelling and exact span', () => {
  const source = 'Merchant: MAISON VERTE\nAmount EUR32.70';
  const field = extractUniversalFields(source).merchant;
  explicit(field, 'MAISON VERTE');
  assert.equal(source.slice(field.spans[0].start, field.spans[0].end), field.value);
});
for (const [source, merchant] of [
  ['Card purchase USD24.86 at NORTH STAR MARKET.', 'NORTH STAR MARKET'],
  ['Paiement par carte EUR32,70 débité chez MAISON VERTE.', 'MAISON VERTE'],
  ['Kartenzahlung EUR32,70 bei GRÜNER LADEN.', 'GRÜNER LADEN'],
  ['Compra con tarjeta EUR32,70 en TIENDA VERDE.', 'TIENDA VERDE'],
  ['Pagamento con carta EUR32,70 presso CASA VERDE.', 'CASA VERDE'],
  ['Pinbetaling EUR32,70 bij GROENE WINKEL.', 'GROENE WINKEL'],
  ['شراء بمبلغ ٣٢٫٧٠ درهم لدى متجر النور.', 'متجر النور'],
]) test(`grounded merchant preposition: ${merchant}`, () => {
  explicit(extractUniversalFields(source).merchant, merchant);
});
test('hyphenated surname and reference boundary preserve the actual merchant', () => {
  const source = 'Purchase AED250.57 at PRASERT ON-PUTTHA Ref: ABC123 on 20/04/2026.';
  explicit(extractUniversalFields(source).merchant, 'PRASERT ON-PUTTHA');
});
test('conflicting named merchant fields remain ambiguous', () => {
  const field = extractUniversalFields('Merchant: ALPHA SHOP\nPayee: BETA SHOP').merchant;
  assert.equal(field.evidence, 'ambiguous'); assert.equal(field.value, null);
  assert.deepEqual(field.alternatives.sort(), ['ALPHA SHOP', 'BETA SHOP']);
});
test('account and instruction footers cannot become merchant names', () => {
  for (const source of ['USD25 debited from your account. Log in to View Your Statement.', 'USD25 credited to your account 1234.', 'Purchase USD25. Call us at 600123456.']) {
    assert.equal(extractUniversalFields(source).merchant.evidence, 'missing');
  }
});
test('money spans cannot be claimed as merchants', () => {
  const source = 'Purchase at USD 24.00 with card 1234.';
  assert.equal(extractUniversalFields(source, {}, [{ start: 12, end: 21 }]).merchant.evidence, 'missing');
});
test('explicit ISO transaction date has no locale ambiguity', () => {
  explicit(extractUniversalFields('Transaction date: 2026-05-04').transactionDate, '2026-05-04');
});
test('day/month order stays ambiguous without documented context', () => {
  const field = extractUniversalFields('Purchase USD25 on 04/05/2026.').transactionDate;
  assert.equal(field.evidence, 'ambiguous'); assert.equal(field.value, null);
  assert.deepEqual(field.alternatives.sort(), ['2026-04-05', '2026-05-04']);
});
test('explicit date order resolves the same source differently', () => {
  const source = 'Purchase USD25 on 04/05/2026.';
  explicit(extractUniversalFields(source, { dateOrder: 'DMY' }).transactionDate, '2026-05-04');
  explicit(extractUniversalFields(source, { dateOrder: 'MDY' }).transactionDate, '2026-04-05');
});
test('unambiguous numeric date needs no country assumption', () => {
  explicit(extractUniversalFields('Purchase USD25 on 23/05/2026.').transactionDate, '2026-05-23');
});
test('named months need an explicit four-digit year', () => {
  explicit(extractUniversalFields('Purchase USD25 on 5 January 2027.').transactionDate, '2027-01-05');
  for (const token of ['05/01/27', '5 January', '5 Jan 27']) {
    const field = extractUniversalFields(`Purchase USD25 on ${token}.`).transactionDate;
    assert.equal(field.value, null); assert.ok(field.issues.includes('missing-four-digit-year'));
  }
});
test('calendar-invalid dates cannot roll into another month', () => {
  const field = extractUniversalFields('Transaction date: 2026-02-30').transactionDate;
  assert.equal(field.value, null); assert.ok(field.issues.includes('invalid-date'));
});
test('statement generation and payment deadline remain separate', () => {
  const result = extractUniversalFields('Statement generated on 2026-12-20. Payment due on 2027-01-05.');
  explicit(result.statementDate, '2026-12-20'); explicit(result.dueDate, '2027-01-05');
  assert.equal(result.transactionDate.evidence, 'missing');
});
test('Arabic date labels and Arabic digits preserve date roles', () => {
  const result = extractUniversalFields('تاريخ العملية: ٢٠٢٦-٠٥-٠٤\nتاريخ الاستحقاق: ٢٠٢٦-٠٦-٠٥');
  explicit(result.transactionDate, '2026-05-04'); explicit(result.dueDate, '2026-06-05');
});
test('yearless payment deadline never takes the generation date', () => {
  const result = extractUniversalFields('Statement date: 2026-08-01. Payment due on 25 Aug.');
  explicit(result.statementDate, '2026-08-01'); assert.equal(result.dueDate.value, null);
  assert.ok(result.dueDate.issues.includes('missing-four-digit-year'));
});
test('two differing transaction dates remain ambiguous', () => {
  const field = extractUniversalFields('Transaction date: 2026-05-04\nTransaction date: 2026-05-05').transactionDate;
  assert.equal(field.evidence, 'ambiguous'); assert.equal(field.alternatives.length, 2);
});
test('merchant reference digits are not transaction dates', () => {
  const result = extractUniversalFields('Merchant: SHOP 2026\nReference: 2026-05-04');
  assert.equal(result.transactionDate.evidence, 'missing');
});
test('card ending with and masked PAN retain only final four digits', () => {
  explicit(extractUniversalFields('Card ending with 1234 was charged USD25.').instrument, { kind: 'card', last4: '1234' });
  explicit(extractUniversalFields('Credit Card 4782********4833 was charged USD25.').instrument, { kind: 'card', last4: '4833' });
});
test('differing card identities are ambiguous instead of first-match wins', () => {
  const field = extractUniversalFields('Card ending 1234. Card ending 5678.').instrument;
  assert.equal(field.value, null); assert.equal(field.evidence, 'ambiguous'); assert.equal(field.alternatives.length, 2);
});
test('incomplete card masks cannot create a last-four identity', () => {
  const field = extractUniversalFields('Card ending XX34 was charged USD25.').instrument;
  assert.equal(field.value?.last4 ?? null, null);
});
test('issuer headers and support footers are not merchant evidence', () => {
  for (const source of ['From HSBC: Your card was charged USD25.', 'Purchase USD25. Contact us at BANK SUPPORT.']) {
    assert.equal(extractUniversalFields(source).merchant.evidence, 'missing');
  }
});
test('a beneficiary IBAN is an instrument identifier, not a seller name', () => {
  assert.equal(extractUniversalFields('Beneficiary: AE123456789012345678901').merchant.evidence, 'missing');
});
test('explicit year-first slash dates retain the four-digit year', () => {
  explicit(extractUniversalFields('Transaction date: 2026/05/04', { dateOrder: 'YMD' }).transactionDate, '2026-05-04');
});
test('Arabic instrument labels keep the stated last four digits', () => {
  explicit(extractUniversalFields('بطاقة رقم **١٢٣٤').instrument, { kind: 'card', last4: '1234' });
});
test('direct field extraction is bounded for long source input', () => {
  const result = extractUniversalFields('x'.repeat(5000) + '\nMerchant: ALPHA SHOP');
  for (const field of Object.values(result)) {
    assert.equal(field.evidence, 'missing'); assert.ok(field.issues.includes('input-too-long'));
  }
});
test('compact named dates require the stated century too', () => {
  explicit(extractUniversalFields('Payment due date is 5Jan2027.').dueDate, '2027-01-05');
  const short = extractUniversalFields('Payment due date is 5Jan27.').dueDate;
  assert.equal(short.value, null); assert.ok(short.issues.includes('missing-four-digit-year'));
});
test('repeated evidence is stable and every span stays inside the source', () => {
  const source = '💳 Merchant: MAISON VERTE\nMerchant: MAISON VERTE\nCard ending1234\nTransaction date: 2026-05-04';
  const first = extractUniversalFields(source);
  explicit(first.merchant, 'MAISON VERTE');
  for (let i = 0; i < 10; i++) assert.deepEqual(extractUniversalFields(source), first);
  for (const field of Object.values(first)) for (const span of field.spans) {
    assert.ok(span.start >= 0 && span.end <= source.length && span.end > span.start);
  }
});
for (const suffix of [
  'requires OTP123456', 'requires OTP 123456', 'requires a verification code',
  'requires your security code', 'declined', 'failed due to insufficient funds',
  'pending authorization', 'scheduled for tomorrow',
]) test(`merchant span leaves its status clause visible: ${suffix}`, () => {
  const source = `Card purchase USD24.90 at LOCAL CAFE ${suffix}.`;
  const merchant = extractUniversalFields(source).merchant;
  explicit(merchant, 'LOCAL CAFE');
  assert.equal(source.slice(merchant.spans[0].end).trim(), suffix + '.');
});
test('a status word inside an actual merchant name remains part of its identity', () => {
  for (const name of ['DECLINED CAFE', 'THE PENDING CAFE', 'FAILED CAFE']) {
    explicit(extractUniversalFields(`Card purchase USD24.90 at ${name}.`).merchant, name);
  }
});
for (const name of ['NEW BALANCE', 'BALANCE CAFE']) test(`a balance word in the seller survives a later price: ${name}`, () => {
  const source = `Card purchase at ${name} for USD24.90 on 2026-09-05.`;
  const start = source.indexOf('USD');
  explicit(extractUniversalFields(source, {}, [{ start, end: start + 8 }]).merchant, name);
});
test('an actual available-balance field remains outside the seller span', () => {
  const source = 'Card purchase USD24.90 at LOCAL CAFE available balance USD500.00.';
  const start = source.lastIndexOf('USD');
  explicit(extractUniversalFields(source, {}, [{ start, end: start + 9 }]).merchant, 'LOCAL CAFE');
});
for (const [label, kind] of [['Card', 'card'], ['Account', 'account']]) {
  test(`a spaced ${kind} identifier retains only its final group`, () => {
    explicit(extractUniversalFields(`${label} 4782 1234 5678 4833 was charged USD25.`).instrument,
      { kind, last4: '4833' });
  });
}
test('an incomplete spaced identifier does not invent a four-digit tail', () => {
  const field = extractUniversalFields('Card 4782 1234 5678 33 was charged USD25.').instrument;
  assert.equal(field.value?.last4 ?? null, null);
});
for (const token of ['2026/05/04/2030', '04/05/2026/2027', '2026-05-04/2030']) {
  test(`malformed date is not accepted from a prefix: ${token}`, () => {
    const field = extractUniversalFields(`Transaction date: ${token}`, { dateOrder: 'DMY' }).transactionDate;
    assert.equal(field.value, null); assert.ok(field.issues.includes('invalid-date'));
  });
}
test('a statement dated field is generation evidence, not a transaction date', () => {
  const fields = extractUniversalFields('Card statement dated 2026-09-01. Payment due on 2026-09-25.');
  explicit(fields.statementDate, '2026-09-01'); explicit(fields.dueDate, '2026-09-25');
  assert.equal(fields.transactionDate.evidence, 'missing');
});
test('a currency-labelled balance footer is bounded even without supplied money spans', () => {
  explicit(extractUniversalFields('Card purchase USD24.90 at LOCAL CAFE available balance USD500.00.').merchant, 'LOCAL CAFE');
});
test('a grouped identifier beyond the extraction bound cannot use an earlier tail', () => {
  const field = extractUniversalFields('Card ' + Array(9).fill('1234').join(' ') + ' 5678 was charged USD25.').instrument;
  assert.equal(field.value?.last4 ?? null, null);
});
for (const token of ['2026-05/04', '04/05-2026']) test(`mixed date separators stay invalid: ${token}`, () => {
  const field = extractUniversalFields(`Transaction date: ${token}`).transactionDate;
  assert.equal(field.value, null); assert.ok(field.issues.includes('invalid-date'));
});
