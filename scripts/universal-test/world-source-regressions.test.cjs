const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader } = require('./load-ts.cjs');
const load = createLoader();
const { inspectUniversalBankEvent: inspect } = load('@/lib/universal-parser');
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');

// SOURCE-BACKED SYNTHETIC: grammar comes from these public sources. Every
// amount, date, identifier, instrument and counterparty below is fictional.
// These fixtures establish extraction behavior, not real settlement or bank
// coverage. Safety mutations are synthetic controls, not quoted source SMS.
const sources = {
  saCardFrom: 'https://hawamer.com/vb/hawamer2757510',
  saCardAt: 'https://hawamer.com/vb/hawamer2822260',
  saIncoming: 'https://hawamer.com/vb/hawamer2673655',
  saBiller: 'https://hawamer.com/vb/hawamer2732748-3',
  saCash: 'https://hawamer.com/vb/hawamer2745352',
  ngFields: 'https://github.com/sarim2000/pennywiseai-tracker/issues/461',
  tzWallet: 'https://github.com/sarim2000/pennywiseai-tracker/issues/524',
  usWithdrawalPosted: 'https://github.com/sarim2000/pennywiseai-tracker/issues/239',
  usWithdrawalProcessed: 'https://github.com/sarim2000/pennywiseai-tracker/issues/121',
  refund: 'https://raw.githubusercontent.com/ikppramesh/EveryPaisa/20ed39f77161cd504e1dd82a517ce4600aaa2a02/TEST_TRANSACTIONS.md',
};
const exactMoney = (field, currency, minorUnits) => {
  assert.equal(field.evidence, 'explicit');
  assert.deepEqual(field.value, { currency, minorUnits, exponent: 2 });
};

for (const [label, source, merchant, direction] of [
  ['purchase seller', 'شراء إنترنت\nبطاقة:1357*;مدى\nمبلغ:46.80 SAR\nحساب:2468*\nمن:ORCHARD BOOKSHOP\nفي:2026-10-09 09:15', 'ORCHARD BOOKSHOP', 'debit'],
  ['purchase at', 'شراء انترنت\nبطاقة: مدى\nمبلغ:SAR46.80\nلدى:CEDAR BAKERY\nفي:2026-10-09 09:15', 'CEDAR BAKERY', 'debit'],
  ['incoming remitter', 'حوالة واردة:محلية\nمبلغ:SAR46.80\nالى:*2468\nمن:CEDAR INSURANCE\nمن ايبان:*9753\nفي:2026-10-09 09:15', 'CEDAR INSURANCE', 'credit'],
  ['bill supplier', 'سداد فاتورة\nمبلغ:SAR46.80\nجهة:CEDAR SERVICES\nخدمة:خدمة اختبار\nفاتورة:135724\nفي:2026-10-09 09:15', 'CEDAR SERVICES', 'debit'],
  ['government supplier', 'مدفوعات وزارة الداخلية\nمن:13572468\nمبلغ:SAR46.80\nالجهة:CEDAR SERVICES\nالخدمة:خدمة اختبار\nفي:2026-10-09 09:15', 'CEDAR SERVICES', 'debit'],
]) test(`structured Arabic ${label} retains literal fields without asserting settlement`, () => {
  const event = inspect(source, { sender: 'UNLISTED-BANK' });
  exactMoney(event.amount, 'SAR', '4680');
  assert.ok(event.observations.some(row => row.role === 'transaction'));
  assert.equal(event.direction, direction);
  assert.equal(event.merchant.value, merchant);
  assert.equal(event.transactionDate.value, '2026-10-09');
  assert.equal(event.status, 'unknown');
  assert.equal(event.decision, 'review');
});

test('an internal-transfer heading preserves amount while leaving direction unresolved', () => {
  const event = inspect('حوالة داخلية\nمبلغ:SAR46.80\nالى:****\nمن:CEDAR CLIENT\nفي:2026-10-09 09:15');
  exactMoney(event.amount, 'SAR', '4680');
  assert.equal(event.direction, 'unknown');
  assert.equal(event.status, 'unknown');
});

test('Arabic presentation forms retain labelled fields and original source spans', () => {
  const source = 'ﺷراء\nﺑطﺎﻗة:\nﻣﺑﻟﻎ:SAR46.80\nﻟدى:CEDAR BAKERY\nﻓﻲ:2026-10-09 09:15';
  const event = inspect(source);
  exactMoney(event.amount, 'SAR', '4680');
  assert.ok(event.observations.some(row => row.role === 'transaction'));
  assert.equal(event.direction, 'debit');
  assert.equal(event.merchant.value, 'CEDAR BAKERY');
  assert.equal(event.transactionDate.value, '2026-10-09');
  assert.equal(event.status, 'unknown');
  const span = event.merchant.spans[0];
  assert.equal(source.slice(span.start, span.end), 'CEDAR BAKERY');
});

test('a multi-letter Arabic ligature cannot move later merchant or date source offsets', () => {
  const { normalizeAlertText } = load('@/lib/alert-draft');
  const source = 'Purchase USD34.25 at ﻻ CEDAR STORE on 2026-10-09.';
  const normalized = normalizeAlertText(source);
  assert.equal(normalized.length, source.length);
  assert.ok(normalized.includes('ﻻ'));
  const event = inspect(source);
  exactMoney(event.amount, 'USD', '3425');
  assert.equal(event.merchant.value, 'ﻻ CEDAR STORE');
  for (const field of [event.merchant, event.transactionDate]) {
    const span = field.spans[0];
    assert.equal(source.slice(span.start, span.end), field.value);
  }
});

test('a structured Arabic ATM heading states cash-flow direction without inventing completion', () => {
  const event = inspect('سحب:صراف آلي\nبطاقة:\nمبلغ:46.80 SAR\nمكان السحب:CEDAR ATM\nفي:2026-10-09 09:15');
  exactMoney(event.amount, 'SAR', '4680');
  assert.equal(event.direction, 'debit');
  assert.equal(event.status, 'unknown');
});

for (const [heading, literal, minor, direction] of [
  ['Debit!', '-125.60', '-12560', 'debit'], ['Credit!', '125.60', '12560', 'credit'],
]) test(`structured ${heading} and Amt retain exact signed money and declared direction`, () => {
  const event = inspect(`${heading}\nAcct:35****2468\nAmt:NGN${literal}\nDesc:POS PURCHASE ORCHARD BOOKSHOP\nDate:2026-10-09 09:15\nBal:NGN3,500.00`);
  exactMoney(event.amount, 'NGN', minor);
  assert.equal(event.direction, direction);
  assert.equal(event.status, 'unknown');
  assert.equal(event.balance.value.minorUnits, '350000');
});

test('TSh transfer principal is not replaced by Total Charges or Fees', () => {
  const event = inspect('Money sent successfully to CEDAR CLIENT. Amount Tsh 12,500. Total Charges Tsh 430, Fees Tsh 400. Wallet balance is Tsh 1,200. ID: ABC135724. 2026-10-09 09:15.');
  exactMoney(event.amount, 'TZS', '1250000');
  exactMoney(event.balance, 'TZS', '120000');
  assert.equal(event.direction, 'debit');
  assert.equal(event.status, 'posted');
  const fees = event.observations.filter(row => row.role === 'fee');
  assert.deepEqual(fees.map(row => row.field.value.minorUnits).sort(), ['40000', '43000']);
});

test('TSh incoming transfer keeps the receipt amount after a preceding balance', () => {
  const event = inspect('Transfer Successful. Wallet balance is Tsh 17,500. You have received Tsh 12,500 from CEDAR CLIENT; Transfer ID: ABC135724. 2026-10-09 09:15.');
  exactMoney(event.amount, 'TZS', '1250000');
  exactMoney(event.balance, 'TZS', '1750000');
  assert.equal(event.direction, 'credit');
});

test('TSh cash-out principal retains its completed withdrawal semantics', () => {
  const event = inspect('Cash Out of Tsh 12,500 from CEDAR AGENT is successful. Total Charges Tsh 430. Fees Tsh 400. Wallet balance is Tsh 1,200.');
  exactMoney(event.amount, 'TZS', '1250000');
  assert.equal(event.direction, 'debit');
  assert.equal(event.family, 'cash-withdrawal');
  assert.equal(event.status, 'posted');
});

for (const source of [
  'Bank Alert - A debit transaction from WITHDRAWAL for $63.10 on account *2468 was posted on October 9, 2026.',
  'Bank Alert. We processed a debit card withdrawal: $63.10 at CEDAR ATM. Acct XXXX2468 has a $700.00 bal (2026-10-09 09:15).',
]) test('explicitly processed or posted debit-card withdrawals retain their direction with ambiguous dollars', () => {
  const event = inspect(source);
  assert.equal(event.amount.evidence, 'ambiguous');
  assert.equal(event.direction, 'debit');
  assert.equal(event.status, 'posted');
  assert.equal(event.family, 'cash-withdrawal');
});

for (const source of [
  'If we processed a debit card withdrawal: $63.10 at CEDAR ATM, contact us.',
  'We have not processed a debit card withdrawal: $63.10 at CEDAR ATM.',
]) test('processed-withdrawal language remains unpostable when conditional or negated', () => {
  assert.notEqual(inspect(source).status, 'posted');
});

for (const predicate of ["We haven't processed", 'We haven’t processed', "Our bank hasn't processed", "We hadn't processed"]) {
  test(`a contraction cannot turn an unprocessed withdrawal into an automatic posting: ${predicate}`, () => {
    const source = `${predicate} a debit card withdrawal: USD63.10 at CEDAR ATM on 2026-10-09.`;
    const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'USD', activeMarket: 'AE',
      bestEffort: { enabled: true, country: 'US' }, fxLookup: () => null });
    assert.equal(session.parse(source, 'Huntington', null, undefined, Date.parse('2026-10-11T12:00:00Z')), null);
    assert.notEqual(inspect(source).status, 'posted');
  });
}

for (const qualifier of ["didn't get", "wasn't", "isn't", "wouldn't be", "couldn't be", "shouldn't be", "can't be", "won't be"]) {
  test(`a contracted qualification cannot establish a completed card charge: ${qualifier}`, () => {
    const source = `USD63.10 ${qualifier} charged to your card ending 2468 at CEDAR STORE on 2026-10-09.`;
    assert.notEqual(inspect(source).status, 'posted');
    const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'USD', activeMarket: 'AE',
      bestEffort: { enabled: true, country: 'US' }, fxLookup: () => null });
    assert.equal(session.parse(source, 'Huntington', null, undefined, Date.parse('2026-10-11T12:00:00Z')), null);
  });
}

test('a merchant containing a contraction cannot negate a separately completed withdrawal', () => {
  const event = inspect("We processed a debit card withdrawal: USD63.10 at HAVEN'T CAFE on 2026-10-09.");
  assert.equal(event.merchant.value, "HAVEN'T CAFE");
  assert.equal(event.status, 'posted');
  assert.equal(event.direction, 'debit');
});

test('an embedded identifier ending in a TSh alias is never a recovered monetary tail', () => {
  assert.equal(inspect('Bank notice Reference: AB125Tsh.').amount.value, null);
});

test('a refund processed for a named merchant preserves that merchant and excludes the balance', () => {
  const event = inspect('USD34.25 refund processed for ORCHARD TRAVEL on 2026-10-09. Available Balance: USD800.00. Ref: REF-ABC1357');
  exactMoney(event.amount, 'USD', '3425');
  assert.equal(event.merchant.value, 'ORCHARD TRAVEL');
  assert.equal(event.direction, 'credit');
  assert.equal(event.family, 'refund');
});

test('instruction-footer dates cannot conflict with a structured Arabic purchase date', () => {
  const event = inspect('شراء انترنت\nمبلغ:SAR46.80\nلدى:CEDAR BAKERY\nفي:2026-10-09 09:15\nFor offers on 2026-10-20 visit our app.');
  assert.equal(event.transactionDate.value, '2026-10-09');
});

for (const source of [
  'اشعار:رصيد غير كافي\nالعملية:POS\nمبلغ:46.80 SAR\nبطاقة:1357*;مدى\nفي:2026-10-09 09:15',
  'ننصح بعدم مشاركة الرمز لحمايتك من الاحتيال\nالرمز:424242\nمبلغ:SAR46.80\nلدى:CEDAR BAKERY',
  'Debit!\nAmt:USD125.60\nYour transaction was declined.',
  'Money sent successfully to CEDAR CLIENT. Amount Tsh 12,500 pending confirmation.',
  'If Cash Out of Tsh 12,500 from CEDAR AGENT is successful, you will receive a receipt.',
]) test('source-backed field layouts cannot erase rejection, authentication or conditional status', () => {
  const event = inspect(source);
  assert.notEqual(event.status, 'posted');
  const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'USD', activeMarket: 'AE',
    bestEffort: { enabled: false, country: 'US' }, fxLookup: () => null });
  assert.equal(session.parse(source, 'UNLISTED-BANK', null, undefined, Date.parse('2026-10-11T12:00:00Z')), null);
});

test('new source-unit and field recognition does not enable unproven-format automatic posting', () => {
  const source = 'Money sent successfully to CEDAR CLIENT. Amount Tsh 12,500. Total Charges Tsh 430.';
  const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'TZS', activeMarket: 'AE',
    bestEffort: { enabled: false, country: 'TZ' }, fxLookup: () => null });
  assert.equal(session.parse(source, 'UNLISTED-BANK', null, undefined, Date.parse('2026-10-11T12:00:00Z')), null);
});
