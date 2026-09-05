const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader } = require('./load-ts.cjs');
const { extractUniversalMoney } = createLoader()('@/lib/universal-money');

// Synthetic grammar controls; no additional bank-template coverage is claimed.
const money = (currency, minorUnits, exponent) => ({ currency, minorUnits, exponent });
const explicit = (field, expected) => {
  assert.equal(field.evidence, 'explicit');
  assert.deepEqual(field.value, expected);
  assert.deepEqual(field.alternatives, []);
};
for (const [token, expected] of [
  ['USD24.90', money('USD', '2490', 2)],
  ['JPY2500', money('JPY', '2500', 0)],
  ['KWD٢٤٫٩٠٠', money('KWD', '24900', 3)],
  ['INR1,23,456.78', money('INR', '12345678', 2)],
  ['EUR1.234,56', money('EUR', '123456', 2)],
  ['EUR1 234,56', money('EUR', '123456', 2)],
  ["USD1'234.56", money('USD', '123456', 2)],
  ['CAD24.90', money('CAD', '2490', 2)],
]) test(`explicit ISO amount independent of country: ${token}`, () => {
  const source = `Purchase ${token} at NORTH STAR MARKET.`;
  const result = extractUniversalMoney(source);
  explicit(result.amount, expected);
  assert.equal(source.slice(result.amount.spans[0].start, result.amount.spans[0].end), token);
  assert.match(source.slice(result.transactionSpan.start, result.transactionSpan.end), /Purchase.*NORTH STAR MARKET/);
});
for (const separator of [', ', '. ', '; ', '\n', ' ']) {
  for (const reverse of [false, true]) test(`purchase and balance own separate amounts: ${JSON.stringify(separator)} reverse=${reverse}`, () => {
    const purchase = 'Purchase USD24.90 at NORTH STAR MARKET';
    const balance = 'Available balance USD500.00';
    const source = reverse ? balance + separator + purchase : purchase + separator + balance;
    const result = extractUniversalMoney(source);
    explicit(result.amount, money('USD', '2490', 2));
    explicit(result.balance, money('USD', '50000', 2));
    const segment = source.slice(result.transactionSpan.start, result.transactionSpan.end);
    assert.match(segment, /Purchase/); assert.match(segment, /NORTH STAR MARKET/);
    assert.doesNotMatch(segment, /balance|500\.00/);
  });
}
test('postfixed posting and balance labels retain their own fields', () => {
  const result = extractUniversalMoney('USD24.90 debited at NORTH STAR MARKET, USD500.00 available balance.');
  explicit(result.amount, money('USD', '2490', 2)); explicit(result.balance, money('USD', '50000', 2));
});
for (const fields of [
  'Minimum due USD10.00, Total amount due USD100.00, Credit limit USD5000.00.',
  'Credit limit USD5000.00. Total amount due USD100.00. Minimum due USD10.00.',
]) test(`statement fields do not become ordinary transactions: ${fields}`, () => {
  const result = extractUniversalMoney('Card statement. ' + fields);
  explicit(result.minimumDue, money('USD', '1000', 2));
  explicit(result.statementTotal, money('USD', '10000', 2));
  explicit(result.creditLimit, money('USD', '500000', 2));
  assert.equal(result.amount.value, null); assert.equal(result.transactionSpan, null);
});
test('minimum-only statement never supplies its total or payment amount', () => {
  const result = extractUniversalMoney('Your card statement: Minimum payment due USD10.00.');
  explicit(result.minimumDue, money('USD', '1000', 2));
  assert.equal(result.statementTotal.value, null); assert.equal(result.amount.value, null);
});
test('label abbreviations keep their role across internal punctuation', () => {
  const result = extractUniversalMoney('Card statement. Min. Amt Due USD10.00. Total Amt Due USD100.00. Avl Cr. Limit USD5000.00.');
  explicit(result.minimumDue, money('USD', '1000', 2));
  explicit(result.statementTotal, money('USD', '10000', 2));
  explicit(result.creditLimit, money('USD', '500000', 2));
  assert.equal(result.amount.value, null);
});
test('generic bill due remains a bill-review amount', () => {
  const result = extractUniversalMoney('Utility bill amount due EUR75,00 by 2026-09-15.');
  explicit(result.amount, money('EUR', '7500', 2));
  assert.equal(result.observations[0].role, 'bill-due'); assert.equal(result.statementTotal.value, null);
});
test('fees cannot displace a purchase or balance', () => {
  const result = extractUniversalMoney('Fee USD1.00, Purchase USD24.90 at SHOP. Balance USD500.00.');
  explicit(result.amount, money('USD', '2490', 2)); explicit(result.balance, money('USD', '50000', 2));
  assert.ok(result.observations.some((row) => row.role === 'fee' && row.field.value.minorUnits === '100'));
});
test('a standalone fee can be the main reviewed amount', () => {
  const result = extractUniversalMoney('Monthly service fee USD5.00 charged. Available balance USD500.00.');
  explicit(result.amount, money('USD', '500', 2));
});
for (const movement of ['Cash withdrawal', 'Cash deposit']) test(`${movement} principal cannot be replaced by its fee`, () => {
  const result = extractUniversalMoney(`${movement} USD100.00 completed. Service fee USD2.00 charged.`);
  explicit(result.amount, money('USD', '10000', 2));
  assert.equal(result.observations[0].role, 'transaction');
});
test('an unknown monetary field prevents selecting an otherwise standalone fee', () => {
  const result = extractUniversalMoney('Unclassified USD100.00. Service fee USD2.00 charged.');
  assert.equal(result.amount.value, null);
  assert.equal(result.amount.evidence, 'ambiguous');
  assert.ok(result.amount.issues.includes('amount-role-unresolved'));
  assert.equal(result.transactionSpan, null);
});
test('a real standalone fee retains its own amount beside informational money', () => {
  const result = extractUniversalMoney('Service fee USD2.00 charged. Balance USD500.00. Credit limit USD1000.00.');
  explicit(result.amount, money('USD', '200', 2));
});
test('zero informational amounts remain exact facts, not transactions', () => {
  const result = extractUniversalMoney('Statement total JPY0. Available balance JPY0. Credit limit JPY0.');
  explicit(result.statementTotal, money('JPY', '0', 0)); explicit(result.balance, money('JPY', '0', 0));
  explicit(result.creditLimit, money('JPY', '0', 0)); assert.equal(result.amount.value, null);
  assert.equal(extractUniversalMoney('Purchase USD0.00.').amount.value, null);
});
test('currency and number ambiguity retain all interpretations', () => {
  const dollar = extractUniversalMoney('Purchase $24.90 at SHOP.').amount;
  assert.equal(dollar.evidence, 'ambiguous'); assert.equal(dollar.value, null);
  assert.ok(dollar.alternatives.some((value) => value.currency === 'USD'));
  assert.ok(dollar.alternatives.some((value) => value.currency === 'CAD'));
  const decimal = extractUniversalMoney('Purchase KWD1.234 at SHOP.').amount;
  assert.equal(decimal.evidence, 'ambiguous'); assert.equal(decimal.value, null);
  assert.deepEqual(decimal.alternatives.map((value) => value.minorUnits).sort(), ['1234', '1234000']);
});
test('equal independent transaction fields remain ambiguous', () => {
  const result = extractUniversalMoney('Purchase USD25.00 at ALPHA. Purchase USD25.00 at BETA.');
  assert.equal(result.amount.evidence, 'ambiguous'); assert.equal(result.amount.value, null);
  assert.equal(result.amount.spans.length, 2); assert.equal(result.transactionSpan, null);
});
for (const token of ['USD1 00', "USD1'00", 'USD1\t00', "USD1'", 'USD1 000 00', 'USD1 234.5 6', 'USD1,23,4.56', 'USD12/34', 'USD****24.90', '****24.90 USD']) {
  test(`malformed or masked complete numeric token is never trusted: ${token}`, () => {
    const result = extractUniversalMoney(`Purchase ${token} at SHOP.`);
    assert.equal(result.amount.value, null);
  });
}
test('authentication money stays out of the main transaction amount', () => {
  const result = extractUniversalMoney('OTP 123456 for purchase USD24.90. Do not share this code.');
  assert.equal(result.amount.value, null);
});
test('an OTP safety footer cannot erase a separate posted purchase amount', () => {
  const source = 'Card purchase USD24.90 at LOCAL CAFE. Do not share your OTP.';
  const result = extractUniversalMoney(source);
  explicit(result.amount, money('USD', '2490', 2));
  assert.doesNotMatch(source.slice(result.transactionSpan.start, result.transactionSpan.end), /OTP|share/);
  assert.ok(result.draft.reasons.includes('authentication-or-otp'));
});
for (const merchant of ['NEW BALANCE', 'BALANCE CAFE']) test(`excluded merchant words cannot own money roles: ${merchant}`, () => {
  const source = `Card purchase at ${merchant} for USD24.90. Available balance USD500.00.`;
  const start = source.indexOf(merchant);
  const result = extractUniversalMoney(source, {}, [{ start, end: start + merchant.length }]);
  explicit(result.amount, money('USD', '2490', 2));
  explicit(result.balance, money('USD', '50000', 2));
  assert.equal(result.statementTotal.value, null);
  assert.equal(source.slice(result.amount.spans[0].start, result.amount.spans[0].end), 'USD24.90');
  assert.ok(source.slice(result.transactionSpan.start, result.transactionSpan.end).includes(merchant));
  assert.ok(result.draft.normalizedText.includes(merchant));
});
for (const [posting, balance] of [
  ['Paiement EUR32,70 débité chez MAISON VERTE', 'Solde disponible EUR500,00'],
  ['Kartenzahlung EUR32,70 bei GRÜNER LADEN', 'Kontostand EUR500,00'],
  ['Compra EUR32,70 en TIENDA VERDE', 'Saldo EUR500,00'],
]) test(`existing language vocabulary retains balance ownership: ${posting}`, () => {
  const result = extractUniversalMoney(`${posting}, ${balance}.`);
  explicit(result.amount, money('EUR', '3270', 2)); explicit(result.balance, money('EUR', '50000', 2));
});
test('documented currency aliases preserve exact Arabic decimal evidence', () => {
  const result = extractUniversalMoney('شراء بمبلغ ٢٤٫٩٠٠ د.ك الرصيد المتاح ٥٠٠٫٠٠٠ د.ك', {
    currencyAliases: { 'د.ك': ['KWD'] },
  });
  explicit(result.amount, money('KWD', '24900', 3)); explicit(result.balance, money('KWD', '500000', 3));
});
test('informational money after a purchase does not carry deadline language into its segment', () => {
  const source = 'Purchase USD24.90 at SHOP, statement total USD100.00 due on 2026-09-15.';
  const result = extractUniversalMoney(source);
  explicit(result.amount, money('USD', '2490', 2));
  assert.doesNotMatch(source.slice(result.transactionSpan.start, result.transactionSpan.end), /statement|due on/);
});
test('observations and selected fields contain no raw source text', () => {
  const result = extractUniversalMoney('Purchase USD24.90 at PRIVATE MERCHANT.');
  const { draft, ...facts } = result;
  assert.ok(draft.normalizedText.includes('PRIVATE MERCHANT'));
  assert.doesNotMatch(JSON.stringify(facts), /PRIVATE MERCHANT|sourceText|normalizedText/);
});
for (const currency of ['AED', 'SAR', 'CAD']) test(`an otherwise unknown explicit ${currency} amount is reviewable without guessing its role`, () => {
  const source = `Unfamiliar bank wording ${currency}25.00.`;
  const result = extractUniversalMoney(source);
  explicit(result.amount, money(currency, '2500', 2));
  assert.ok(result.amount.issues.includes('amount-role-unresolved'));
  assert.equal(result.observations[0].role, 'unknown');
  assert.ok(result.transactionSpan);
});
test('multiple unknown amounts retain ambiguity rather than selecting the first', () => {
  const result = extractUniversalMoney('Unfamiliar USD25.00. Another USD40.00.');
  assert.equal(result.amount.value, null); assert.equal(result.amount.evidence, 'ambiguous');
  assert.deepEqual(result.amount.alternatives.map((value) => value.minorUnits).sort(), ['2500', '4000']);
  assert.ok(result.amount.issues.includes('amount-role-unresolved'));
  assert.equal(result.transactionSpan, null);
});
test('known instrument collisions are excluded before unknown-role amount selection', () => {
  const source = 'Card 1234 USD. Unfamiliar CAD25.00.';
  const start = source.indexOf('1234');
  const result = extractUniversalMoney(source, {}, [], [{ start, end: start + 4 }]);
  explicit(result.amount, money('CAD', '2500', 2));
  assert.ok(result.amount.issues.includes('amount-role-unresolved'));
  assert.equal(result.observations.length, 1);
  assert.equal(result.draft.candidates.length, 2);
});
test('unknown-role fallback cannot promote informative fields or ignored authentication', () => {
  for (const source of [
    'Minimum due USD10.00.', 'Statement total USD100.00.', 'Balance USD500.00.',
    'Credit limit USD1000.00.', 'OTP code for USD25.00.', 'Unfamiliar USD0.00.',
    'Unfamiliar USD25.00. ' + 'x'.repeat(4096),
  ]) assert.equal(extractUniversalMoney(source).amount.value, null, source.slice(0, 80));
});
for (const information of ['Available balance CAD500.00', 'Credit limit CAD1000.00']) {
  test(`unknown principal remains reviewable beside ${information}`, () => {
    const result = extractUniversalMoney(`Notice CAD24.90. ${information}.`);
    explicit(result.amount, money('CAD', '2490', 2));
    assert.ok(result.amount.issues.includes('amount-role-unresolved'));
    assert.ok(result.transactionSpan);
  });
}
for (const [label, field, value] of [
  ['Available balance', 'balance', '50000'],
  ['Credit limit', 'creditLimit', '100000'],
  ['Statement total', 'statementTotal', '10000'],
  ['Minimum due', 'minimumDue', '1000'],
]) test(`a label-only line still owns its next-line ${field}`, () => {
  const amount = (Number(value) / 100).toFixed(2);
  for (const gap of ['\n', ':\n\n', ' -\n']) {
    const result = extractUniversalMoney(`${label}${gap}CAD${amount}`);
    explicit(result[field], money('CAD', value, 2));
    assert.equal(result.amount.value, null);
  }
});
test('line-label inheritance cannot cross arbitrary prose or a merchant name', () => {
  for (const source of ['Available balance\nUnfamiliar CAD25.00', 'Merchant: BALANCE CAFE\nCAD25.00']) {
    const result = extractUniversalMoney(source);
    assert.equal(result.balance.value, null);
    assert.equal(result.observations[0].role, 'unknown');
    assert.ok(result.amount.issues.includes('amount-role-unresolved'));
  }
});
