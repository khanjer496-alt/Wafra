const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./load-ts.cjs').createLoader();
const { createLaunchAlertSession, inspectGenericBankEventForReview, universalSourceParseContext } = load('@/lib/launch-alert-parser');
const { inspectUniversalBankEvent: inspect } = load('@/lib/universal-parser');
const { setActiveCountry } = load('@/lib/country');
const { setActiveMarket, setLedgerCurrency } = load('@/lib/markets');

// Existing regression layouts with fictional values and safety mutations.
// These test source-convention handoff, not received-message bank coverage.
// Jordan's existing pack aliases are local to a routed issuer. The public
// currency convention is 1 JD = 1000 fils; see the Central Bank of Jordan:
// https://www.cbj.gov.jo/ebv4.0/root_storage/en/eb_list_page/7bc0d085-521e-423c-9d36-b6d5a8ca89ec.pdf
const observedAt = Date.parse('2026-10-12T12:00:00Z');
const purchase = (unit = 'GBP 12.34', day = '03/04/2026', merchant = 'TESCO') =>
  `Your card ending 1234 was charged ${unit} at ${merchant} on ${day}.`;
const money = (minorUnits, currency = 'JOD', exponent = 3) => ({ currency, minorUnits, exponent });

function context(currency, country = 'US', activeCountry = country) {
  setActiveMarket('ZZ');
  setLedgerCurrency(currency, currency === 'JOD' ? 3 : 2);
  setActiveCountry(activeCountry);
  return createLaunchAlertSession({ overrides: {}, activeMarket: 'ZZ', pinnedCurrency: currency,
    bestEffort: { enabled: true, country }, fxLookup: () => null });
}
function read(source, sender, currency = 'GBP', country = 'US', activeCountry = country) {
  const session = context(currency, country, activeCountry);
  const inspection = session.inspect(source, sender);
  return { session, inspection,
    parsed: session.parseUnproven(source, sender, inspection, observedAt),
    direct: session.parse(source, sender, inspection, undefined, observedAt) };
}

test('ordinary capture refusal shares qualified issuer conventions without caller-specific context', () => {
  context('GBP', 'US');
  const uk = inspectGenericBankEventForReview(purchase(), 'BARCLAYS');
  assert.equal(uk.decision, 'review');
  assert.equal(uk.transactionDate.value, '2026-04-03');
  const jordan = inspectGenericBankEventForReview(purchase('JD 12.345'), 'ARABBANK');
  assert.deepEqual(jordan.amount.value, money('12345'));
  assert.equal(jordan.transactionDate.value, '2026-04-03');
  context('USD', 'GB');
  assert.equal(inspectGenericBankEventForReview(purchase('$12.34'), 'CHASE').transactionDate.value, '2026-04-03');
});

test('a routed UK issuer keeps its day-first date on a US-selected GBP ledger', () => {
  const result = read(purchase(), 'BARCLAYS');
  assert.equal(result.inspection.route.market, 'GB');
  assert.equal(result.parsed.date, '2026-04-03');
  assert.equal(result.direct.date, '2026-04-03');
  assert.equal(result.parsed.amountFils, 1234);
});

test('a routed US issuer keeps its month-first date on a UK-selected USD ledger', () => {
  const result = read(purchase('USD 12.34'), 'CHASE', 'USD', 'GB');
  assert.equal(result.inspection.route.market, 'US');
  assert.equal(result.parsed.date, '2026-03-04');
  assert.equal(result.direct.date, '2026-03-04');
});

test('a shared dollar cannot circularly corroborate its routed US date convention', () => {
  const result = read(purchase('$12.34'), 'CHASE', 'USD', 'GB');
  const sourceContext = universalSourceParseContext(result.inspection, 'CHASE', 'GB');
  assert.equal(sourceContext.dateOrder, 'DMY');
  assert.equal(result.parsed.date, '2026-04-03');
});

test('the explicit session country owns fallback dates rather than mutable global country', () => {
  const result = read(purchase(), 'UNLISTED-BANK', 'GBP', 'GB', 'US');
  assert.equal(result.parsed.date, '2026-04-03');
});

test('a bank brand mentioned as a merchant does not replace the selected country convention', () => {
  const result = read(purchase('GBP 12.34', '03/04/2026', 'Barclays'), 'UNLISTED-BANK');
  assert.equal(result.inspection.route.market, 'GB');
  assert.equal(result.parsed.date, '2026-03-04');
});

test('a multinational Barclays sender quoting USD cannot impose a UK date on US-selected money', () => {
  const result = read(purchase('USD 12.34'), 'BARCLAYS', 'USD', 'US');
  assert.equal(result.inspection.route.market, 'GB');
  assert.equal(result.parsed.date, '2026-03-04');
});

test('a home-currency balance cannot override the foreign principal date convention', () => {
  const source = purchase('USD 12.34') + ' Available balance GBP 500.00.';
  const result = read(source, 'BARCLAYS', 'USD', 'US');
  assert.equal(result.parsed.amountFils, 1234);
  assert.equal(result.parsed.currency, 'USD');
  assert.equal(result.parsed.date, '2026-03-04');
  assert.equal(result.direct.date, result.parsed.date);
  assert.equal(inspectGenericBankEventForReview(source, 'BARCLAYS').transactionDate.value, result.parsed.date);
});

test('a foreign balance cannot override the separately owned home-currency principal', () => {
  const source = purchase('GBP 12.34') + ' Available balance USD 500.00.';
  const result = read(source, 'BARCLAYS', 'GBP', 'US');
  assert.equal(result.parsed.amountFils, 1234);
  assert.equal(result.parsed.currency, 'GBP');
  assert.equal(result.parsed.date, '2026-04-03');
});

for (const secondary of ['Service fee GBP 1.00.', 'Available credit limit GBP 500.00.', 'Minimum due GBP 1.00.']) {
  test(`a secondary home-currency figure cannot supply principal date conventions: ${secondary}`, () => {
    const result = read(purchase('USD 12.34') + ' ' + secondary, 'BARCLAYS', 'USD', 'US');
    assert.equal(universalSourceParseContext(result.inspection, 'BARCLAYS', 'US').dateOrder, 'MDY');
    if (!secondary.startsWith('Minimum')) {
      assert.equal(result.parsed.amountFils, 1234);
      assert.equal(result.parsed.date, '2026-03-04');
    } else {
      assert.equal(result.parsed, null);
    }
  });
}

test('an Arab Bank sender quoting USD keeps the explicit US date convention', () => {
  const result = read(purchase('USD 12.34'), 'ARABBANK', 'USD', 'US');
  assert.equal(result.inspection.route.market, 'JO');
  assert.equal(result.parsed.date, '2026-03-04');
});

for (const [literal, day] of [['2026-04-03', '2026-04-03'], ['13/04/2026', '2026-04-13'], ['April 3, 2026', '2026-04-03']]) {
  test(`explicit calendar evidence remains unchanged: ${literal}`, () => {
    assert.equal(read(purchase('GBP 12.34', literal), 'BARCLAYS').parsed.date, day);
  });
}

for (const country of ['ZZ', 'CA']) test(`an unrouted ambiguous date remains unresolved with country ${country}`, () => {
  const result = read(purchase(), 'UNLISTED-BANK', 'GBP', country, 'US');
  assert.equal(result.parsed?.date ?? null, null);
});

test('conflicting issuer evidence cannot resolve a numeric date through the selected country', () => {
  const result = read('Chase Bank alert: ' + purchase(), 'BARCLAYS');
  assert.equal(result.inspection.route.decision, 'ambiguous');
  assert.ok(result.inspection.route.reasons.includes('sender-institution-conflict'));
  assert.equal(result.parsed?.date ?? null, null);
});

for (const [literal, minor] of [['JD 12.345', '12345'], ['د.أ ١٢٫٣٤٥', '12345'], ['JOD 12.345', '12345']]) {
  test(`Jordan pack retains its exact three-decimal principal: ${literal}`, () => {
    const source = purchase(literal);
    const event = inspect(source, { sender: 'ARABBANK', market: 'JO', dateOrder: 'DMY' });
    assert.deepEqual(event.amount.value, money(minor));
    const result = read(source, 'ARABBANK', 'JOD');
    assert.equal(result.inspection.route.market, 'JO');
    assert.equal(result.parsed.amountFils, Number(minor));
    assert.equal(result.parsed.currency, 'JOD');
    assert.equal(result.parsed.date, '2026-04-03');
    assert.equal(result.direct.amountFils, Number(minor));
  });
}

test('market aliases enrich the existing Arabic Jordan fixture without changing literal spans', () => {
  const source = 'البنك العربي: تم الخصم د.أ ٢٤٫٥٠٠ لشراء بالبطاقة لدى متجر الساحة.';
  const event = inspect(source, { market: 'JO', sender: 'ARABBANKJO' });
  assert.deepEqual(event.amount.value, money('24500'));
  assert.ok(event.amount.spans.some(span => source.slice(span.start, span.end) === 'د.أ ٢٤٫٥٠٠'));
});

test('a Jordan issuer cannot relabel an explicit foreign currency or invent a conversion', () => {
  const source = purchase('USD 12.34');
  assert.deepEqual(inspect(source, { market: 'JO', sender: 'ARABBANK' }).amount.value,
    money('1234', 'USD', 2));
  assert.equal(read(source, 'ARABBANK', 'JOD').parsed, null);
});

for (const literal of ['JOD 12,345', 'JD 12,345', 'USD 12.345']) test(`a Jordan route does not resolve unsupported grouping: ${literal}`, () => {
  const event = inspect(purchase(literal), { market: 'JO', sender: 'ARABBANK' });
  assert.equal(event.amount.value, null);
  assert.equal(event.amount.evidence, 'ambiguous');
  assert.equal(read(purchase(literal), 'ARABBANK', literal.startsWith('USD') ? 'USD' : 'JOD').parsed, null);
});

test('bare JD does not become globally known from the selected country or a ledger', () => {
  const source = purchase('JD 12.345');
  assert.equal(inspect(source).amount.value, null);
  assert.equal(read(source, 'UNLISTED-BANK', 'JOD', 'JO').parsed, null);
});

test('a body-only Arab Bank mention cannot activate Jordan money aliases', () => {
  const result = read(purchase('JD 12.345', '2026-04-03', 'Arab Bank'), 'UNLISTED-BANK', 'JOD', 'JO');
  assert.equal(result.inspection.route.market, 'JO');
  assert.equal(result.parsed, null);
});

test('Jordan fee and balance aliases retain the Review principal while competing money prevents posting', () => {
  const source = 'Fee JD 1.000; ' + purchase('JD 12.345', '2026-04-03') + ' Available balance JD 500.000.';
  const event = inspect(source, { market: 'JO', sender: 'ARABBANK' });
  assert.deepEqual(event.amount.value, money('12345'));
  assert.deepEqual(event.balance.value, money('500000'));
  assert.ok(event.observations.some(row => row.role === 'fee' && row.field.value.minorUnits === '1000'));
  assert.equal(read(source, 'ARABBANK', 'JOD').parsed, null);
});

for (const token of ['Reference AB250JD', 'Reference ABJD250', 'Reference: ****250JD']) test(`routed aliases cannot recover an identifier or masked amount: ${token}`, () => {
  const event = inspect(token + '.', { market: 'JO', sender: 'ARABBANK' });
  assert.equal(event.amount.value, null);
});

for (const suffix of ['was declined', 'requires OTP 123456', 'will be charged tomorrow', 'is pending authorization']) {
  test(`Jordan alias recognition preserves non-posting controls: ${suffix}`, () => {
    const source = `Your card ending 1234 purchase JD 12.345 at TESCO ${suffix} on 03/04/2026.`;
    assert.equal(read(source, 'ARABBANK', 'JOD').parsed, null);
    assert.notEqual(inspect(source, { market: 'JO', sender: 'ARABBANK' }).status, 'posted');
  });
}

test('profile, due and identifier dates cannot compete with a separately owned transaction date', () => {
  const source = purchase('JD 12.345', '2026-04-03') + ' Customer name: APRIL 03/04/2026. Due date 2026-05-09. Reference: 07/08/2026.';
  const event = inspect(source, { sender: 'ARABBANK', market: 'JO', dateOrder: 'DMY' });
  assert.equal(event.transactionDate.value, '2026-04-03');
  assert.equal(event.dueDate.value, '2026-05-09');
  assert.equal(read(source, 'ARABBANK', 'JOD').parsed, null);
});

for (const metadata of [
  'Account opening date: 2020-04-03.',
  'Card issuance date: 2020-04-03.',
  'Account registered on 2020-04-03.',
  'Date of birth: 2020-04-03.',
  'Customer name: APRIL on 2020-04-03.',
  'تاريخ فتح الحساب: 2020-04-03.',
  'تاريخ الميلاد: 2020-04-03.',
]) test(`owner or lifecycle metadata is not a transaction date: ${metadata}`, () => {
  const source = 'Your card ending 1234 was charged USD 12.34 at TESCO. ' + metadata;
  const result = read(source, 'CHASE', 'USD', 'US');
  assert.equal(result.parsed.amountFils, 1234);
  assert.equal(result.parsed.date, null);
  assert.equal(result.direct.date, null);
  assert.equal(inspectGenericBankEventForReview(source, 'CHASE').transactionDate.evidence, 'missing');
});

test('an explicit transaction date survives separate owner and lifecycle dates', () => {
  const source = purchase('USD 12.34', '2026-04-03') + ' Account opening date: 2020-04-03. Date of birth: 1990-08-09.';
  const result = read(source, 'CHASE', 'USD', 'US');
  assert.equal(result.parsed.date, '2026-04-03');
  assert.equal(result.direct.date, '2026-04-03');
});

test('a greeting owner date is excluded while its completed transaction suffix survives', () => {
  const source = 'Dear JORDAN 2020-04-03, ' + purchase('USD 12.34', '2026-04-03');
  const result = read(source, 'CHASE', 'USD', 'US');
  assert.equal(result.parsed.date, '2026-04-03');
  assert.equal(result.direct.date, '2026-04-03');
});

test('a long owner clause cannot escape date ownership through the bounded label lookback', () => {
  const source = 'Your card ending 1234 was charged USD 12.34 at TESCO. Customer name: ' +
    'JORDAN '.repeat(25) + 'on 2020-04-03.';
  assert.equal(read(source, 'CHASE', 'USD', 'US').parsed.date, null);
});

test('the existing Chinese completed purchase keeps its directly labelled yuan principal', () => {
  const source = '您尾号1234的卡于10月02日在美团消费成功,金额58.00元。';
  const event = inspect(source);
  assert.deepEqual(event.amount.value, money('5800', 'CNY', 2));
  const result = read(source, 'ICBC', 'CNY', 'CN');
  assert.equal(result.parsed.kind, 'transaction');
  assert.equal(result.parsed.type, 'expense');
  assert.equal(result.parsed.amountFils, 5800);
  assert.equal(result.parsed.currency, 'CNY');
  assert.ok(result.parsed.bestEffort);
});

for (const token of ['金额AB58.00元', '金额****58.00元', '参考号AB金额58.00元', '参考编号金额58.00元', '金额58.00元ABC']) {
  test(`a Chinese amount-field exception cannot recover an identifier or masked tail: ${token}`, () => {
    const source = '您尾号1234的卡于10月02日在美团消费成功,' + token + '。';
    assert.equal(inspect(source).amount.value, null);
    assert.equal(read(source, 'ICBC', 'CNY', 'CN').parsed, null);
  });
}

test('the mature UAE path retains amount and source date when country is US', () => {
  setActiveMarket('AE'); setLedgerCurrency('AED', 2); setActiveCountry('US');
  const session = createLaunchAlertSession({ overrides: {}, activeMarket: 'AE', pinnedCurrency: 'AED',
    bestEffort: { enabled: true, country: 'US' }, fxLookup: () => null });
  const source = 'Purchase of AED 50.00 to TABBY with Credit Card ending 1234 on 13/04/2026. Avl limit AED 5,000.00';
  const parsed = session.parse(source, 'FAB', session.inspect(source, 'FAB'), undefined, observedAt);
  assert.equal(parsed.amountFils, 5000);
  assert.equal(parsed.type, 'expense');
  assert.equal(parsed.bestEffort, undefined);
  assert.equal(session.parseUnproven(source, 'FAB', session.inspect(source, 'FAB'), observedAt), null);
});

test('the mature Saudi refusal cannot be reopened by new source conventions', () => {
  setActiveMarket('SA'); setLedgerCurrency('SAR', 2); setActiveCountry('US');
  const session = createLaunchAlertSession({ overrides: {}, activeMarket: 'SA', pinnedCurrency: 'SAR',
    bestEffort: { enabled: true, country: 'US' }, fxLookup: () => null });
  const source = 'اشعار:رصيد غير كافي\nالعملية:POS\nمبلغ:46.80 SAR\nبطاقة:1357*;مدى\nفي:2026-04-03 09:15';
  const inspection = session.inspect(source, 'SNB');
  assert.equal(session.parse(source, 'SNB', inspection, undefined, observedAt), null);
  assert.equal(session.parseUnproven(source, 'SNB', inspection, observedAt), null);
});

test('shared Review context reads the same issuer-owned date as both posting seams', () => {
  const source = purchase();
  const result = read(source, 'BARCLAYS');
  const sourceContext = universalSourceParseContext(result.inspection, 'BARCLAYS', 'US');
  const review = inspectGenericBankEventForReview(source, 'BARCLAYS', null, sourceContext);
  assert.equal(review.transactionDate.value, result.parsed.date);
  assert.equal(review.transactionDate.value, result.direct.date);
});

test('shared Review context reads the same Jordan principal without narrowing semantic packs', () => {
  const source = purchase('JD 12.345');
  const result = read(source, 'ARABBANK', 'JOD');
  const sourceContext = universalSourceParseContext(result.inspection, 'ARABBANK', 'US');
  assert.equal(sourceContext.market, undefined);
  assert.equal(sourceContext.moneyMarket, 'JO');
  const review = inspectGenericBankEventForReview(source, 'ARABBANK', null, sourceContext);
  assert.deepEqual(review.amount.value, money('12345'));
  assert.equal(review.transactionDate.value, result.parsed.date);
});

test('a single market with competing institution bodies does not supply issuer conventions', () => {
  const source = 'Transfer reference names Barclays and Lloyds Bank. ' + purchase();
  const result = read(source, '', 'GBP', 'US');
  assert.equal(result.inspection.review.institution.decision, 'ambiguous');
  const sourceContext = universalSourceParseContext(result.inspection, '', 'US');
  assert.equal(sourceContext.moneyMarket, undefined);
  assert.equal(sourceContext.dateOrder, 'MDY');
});

for (const suffix of ['is declined', 'was declined', 'sera débité', 'wird abgebucht', 'سيتم خصم المبلغ']) {
  test(`routed money conventions cannot drop a non-posting control in another language: ${suffix}`, () => {
    const source = `Your card ending 1234 purchase JD 12.345 at TESCO ${suffix} on 03/04/2026.`;
    const result = read(source, 'ARABBANK', 'JOD');
    const sourceContext = universalSourceParseContext(result.inspection, 'ARABBANK', 'US');
    const scoped = inspect(source, sourceContext);
    const iso = inspect(source.replace('JD 12.345', 'JOD 12.345'), { sender: 'ARABBANK', dateOrder: 'MDY' });
    assert.equal(scoped.status, iso.status);
    assert.equal(scoped.direction, iso.direction);
    assert.equal(scoped.family, iso.family);
    assert.equal(result.parsed, null);
  });
}
