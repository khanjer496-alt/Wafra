'use strict';
// Launch-market money shapes (US, UK/Europe, Middle East): currency
// recognition and amount ownership. Synthetic text with fictional values
// only; no real alert body is copied here and no bank coverage is claimed.
const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./load-ts.cjs').createLoader();
const { extractUniversalMoney } = load('@/lib/universal-money');
const { inspectUniversalBankEvent } = load('@/lib/universal-parser');
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { setActiveCountry } = load('@/lib/country');
const { setActiveMarket, setLedgerCurrency } = load('@/lib/markets');

const money = (currency, minorUnits, exponent) => ({ currency, minorUnits, exponent });
const explicit = (field, expected, label = '') => {
  assert.equal(field.evidence, 'explicit', `${label} ${JSON.stringify(field)}`);
  assert.deepEqual(field.value, expected, label);
  assert.deepEqual(field.alternatives, [], label);
};
const readings = (field) => [...(field.value ? [field.value] : []), ...field.alternatives];
const notPrincipal = (field, minorUnits, label = '') =>
  assert.ok(!readings(field).some((value) => value.minorUnits === minorUnits) || field.evidence !== 'explicit',
    `${label} ${minorUnits} must not be the principal: ${JSON.stringify(field)}`);

/* ── Unique units: exact minor units ─────────────────────────────────── */
for (const [token, expected] of [
  ['129,00 zł', money('PLN', '12900', 2)],
  ['3 500,00 PLN', money('PLN', '350000', 2)],
  ['459,00 Kč', money('CZK', '45900', 2)],
  ['CHF 45.90', money('CHF', '4590', 2)],
  ['EUR12.40', money('EUR', '1240', 2)],
  ['€ 23,45', money('EUR', '2345', 2)],
  ['€2.750,00', money('EUR', '275000', 2)],
  ['1 234,56 EUR', money('EUR', '123456', 2)],
  ['1 234,56 EUR', money('EUR', '123456', 2)],
  ['1 234,56 EUR', money('EUR', '123456', 2)],
  ['-45,67 EUR', money('EUR', '-4567', 2)],
  ['+2.450,00 EUR', money('EUR', '245000', 2)],
  ['€ 38,87 €', money('EUR', '3887', 2)],
  ['3,000.00 جم', money('EGP', '300000', 2)],
  ['QAR 245.50', money('QAR', '24550', 2)],
  ['50,000 دينار عراقي', money('IQD', '50000000', 3)],
  ['IQD 1,250,000', money('IQD', '1250000000', 3)],
  ['KWD 1649.832', money('KWD', '1649832', 3)],
  ['BHD 12016.714', money('BHD', '12016714', 3)],
]) test(`exact launch-market amount: ${token}`, () => {
  const source = `Purchase ${token} at NORTH STAR MARKET`;
  const result = extractUniversalMoney(source);
  explicit(result.amount, expected, token);
  assert.equal(result.observations.length, 1, `${token} is one figure`);
});

/* ── Shared units: every reading kept, only the person's country chooses ─ */
for (const [token, currencies, minor, issues] of [
  ['$1,245.00', ['USD', 'CAD', 'AUD'], '124500', ['currency-symbol']],
  ['$1500', ['USD', 'CAD'], '150000', ['currency-symbol', 'currency-exponent']],
  ['42,35 $', ['USD', 'CAD'], '4235', ['currency-symbol']],
  ['245,00 kr', ['SEK', 'DKK', 'NOK'], '24500', ['currency-symbol']],
  ['45,00 kr.', ['SEK', 'DKK', 'NOK'], '4500', ['currency-symbol']],
  ['1.250,00 kr.', ['SEK', 'DKK', 'NOK'], '125000', ['currency-symbol']],
  ['150 kr', ['SEK', 'DKK', 'NOK'], '15000', ['currency-symbol', 'currency-exponent']],
  ['500.00 جنيه', ['EGP', 'SDG', 'SSP'], '50000', ['currency-symbol']],
]) test(`shared unit stays unresolved without a country: ${token}`, () => {
  const result = extractUniversalMoney(`Purchase ${token} at NORTH STAR MARKET`);
  assert.equal(result.amount.value, null);
  assert.equal(result.amount.evidence, 'ambiguous');
  assert.deepEqual(result.amount.issues, issues);
  for (const currency of currencies) {
    assert.ok(result.amount.alternatives.some((value) => value.currency === currency && value.minorUnits === minor &&
      value.exponent === 2), `${token} keeps ${currency} ${minor}`);
  }
});
test('dinar alone names no country; the Jordanian reading stays three-decimal and ambiguous', () => {
  const result = extractUniversalMoney('تم إيداع حوالة بمبلغ 75.000 دينار من NAME');
  assert.equal(result.amount.value, null);
  assert.ok(result.amount.issues.includes('currency-symbol'));
  assert.deepEqual(result.amount.alternatives.filter((value) => value.currency === 'JOD').map((value) => value.minorUnits).sort(),
    ['75000', '75000000']);
});
test('word-shaped units need a word boundary', () => {
  for (const source of ['حجم 500 ميغابايت', 'تم التسجيل 5 جمادى الأولى', 'Order Skr 500 confirmed', 'Ref KR 500 noted']) {
    assert.equal(extractUniversalMoney(source).observations.length, 0, source);
  }
});

/* ── One message, one number format (three-decimal currencies) ──────── */
test('a decimal balance in the same currency settles the movement figure', () => {
  const result = extractUniversalMoney('Acct. 0465 has been debited with KWD 5.800 from SAMPLE COOP. Your Avl. balance is KWD 1,743.966');
  explicit(result.amount, money('KWD', '5800', 3)); explicit(result.balance, money('KWD', '1743966', 3));
  const ungrouped = extractUniversalMoney('A Trx using Card XXXX9915 from SAMPLE CORNER for JOD 2.750 on 20-Jun-2026. Available balance is JOD 1649.832.');
  explicit(ungrouped.amount, money('JOD', '2750', 3));
});
for (const [label, source] of [
  ['an ambiguous balance proves nothing', 'Your account has been debited with KWD 2.495 from SAMPLE CENTER. Your remaining balance is KWD 7.665'],
  ['another currency proves nothing', 'Your account has been debited with KWD 5.800 from SAMPLE SHOP. Card spend USD 1,234.50 this month'],
  ['a comma figure keeps its doubt', 'Your account has been debited with KWD 5,800 from SAMPLE SHOP. Your Avl. balance is KWD 1,743.966'],
  ['an Iraqi dot figure keeps its doubt', 'Your wallet was debited with IQD 12.500 at SAMPLE SHOP'],
  ['a leading-zero figure alone keeps its doubt', 'Your account was debited with OMR 0.650 at SAMPLE SHOP'],
]) test(`three-decimal figure stays ambiguous: ${label}`, () => {
  const result = extractUniversalMoney(source);
  assert.equal(result.amount.evidence, 'ambiguous', JSON.stringify(result.amount));
  assert.ok(result.amount.issues.includes('decimal-or-grouping'));
});
test('a sign after a currency-prefixed figure is not read past (direction belongs to the wording)', () => {
  for (const source of ['Purchase BHD 9.500-123 at SAMPLE CAFE', 'Purchase BHD 9.500-12 34 at SAMPLE CAFE',
    'SAMPLE CAFE Purchase Transaction from ACCOUNT020 BHD 9.500+ Your available balance is BHD 2,979.399',
    'SAMPLE CAFE Refund Transaction to ACCOUNT020 BHD 9.500- Your available balance is BHD 2,979.399']) {
    assert.equal(extractUniversalMoney(source).amount.value, null, source);
  }
});
test('only a three-digit fraction proves the decimal point; IQD never borrows proof', () => {
  for (const source of ['Debited IQD 12.500 at SAMPLE SHOP. Balance IQD 250.00', 'Debited KWD 5.800 at SAMPLE SHOP. Points KWD 12.5',
    'Debited IQD 12.500 at SAMPLE SHOP. Balance IQD 1,250.500']) {
    assert.equal(extractUniversalMoney(source).amount.evidence, 'ambiguous', source);
  }
});

/* ── Ownership: balances, limits and thresholds are never the principal ─ */
for (const [source, amount, balance] of [
  ['Platnosc karta *4321 kwota 45,99 PLN SAMPLE SKLEP 1234 POZNAN 12.09.2026 15:33. Dostepne: 2 345,67 PLN',
    money('PLN', '4599', 2), money('PLN', '234567', 2)],
  ['Przelew przych. kwota 3 500,00 PLN od SAMPLE SP. Z O.O.; tyt: WYNAGRODZENIE; Dost. 5 600,12 PLN',
    money('PLN', '350000', 2), money('PLN', '560012', 2)],
  ['Compra de 25,40 EUR no cartao ****1234 em SAMPLE LOJA, 14/09 13:22. Saldo disp: 1.234,56 EUR',
    money('EUR', '2540', 2), money('EUR', '123456', 2)],
  ['Prélèvement de 39,99 EUR SAMPLE SA effectué le 05/09/2026 sur votre compte ***5521. Solde : 1 234,56 EUR',
    money('EUR', '3999', 2), money('EUR', '123456', 2)],
  ['Retrait DAB de 60,00 € le 18/09/2026 sur le compte ***1234. Solde disponible : 512,08 €',
    money('EUR', '6000', 2), money('EUR', '51208', 2)],
  ['تم سحب مبلغ 3,000.00 جم من ماكينة الصراف باستخدام بطاقتك المنتهية بـ 4321. الرصيد المتاح 8,750.25 جم',
    money('EGP', '300000', 2), money('EGP', '875025', 2)],
  ['تم خصم 220.80 جم من بطاقة الائتمان رقم 9888 عند SAMPLE STORE المتاح 26,032.76 جم',
    money('EGP', '22080', 2), money('EGP', '2603276', 2)],
  ['ATM withdrawal of €200.00 from your account ending 3390. Available balance: €1,312.55.',
    money('EUR', '20000', 2), money('EUR', '131255', 2)],
  ['Salary credit of QAR 17,000.00 to your Current Account XX***XX0015 Your new available balance is QAR 30,966.05',
    money('QAR', '1700000', 2), money('QAR', '3096605', 2)],
  ['Du hast 23,80 EUR bei SAMPLE AI bezahlt. Guthaben EUR 2.775,04', money('EUR', '2380', 2), money('EUR', '277504', 2)],
]) test(`movement and balance own separate figures: ${source.slice(0, 40)}`, () => {
  const result = extractUniversalMoney(source);
  explicit(result.amount, amount, source); explicit(result.balance, balance, source);
  assert.ok(!result.amount.issues.includes('amount-role-unresolved'));
});
test('Arabic balance labels: رصيدك الحالي and الرصيد المتوفر', () => {
  const wallet = extractUniversalMoney('تم استلام مبلغ 500.00 جنيه من رقم 01098765432 بنجاح، رصيدك الحالي 1,345.50 جنيه. رقم العملية 012345678901');
  assert.deepEqual(wallet.observations.map((row) => row.role), ['transaction', 'balance']);
  assert.ok(!readings(wallet.amount).some((value) => /1098765432|12345678901/.test(value.minorUnits)));
  const jordan = extractUniversalMoney('تم إيداع حوالة بمبلغ 75.000 دينار من NAME. الرصيد المتوفر 587.300 دينار');
  assert.deepEqual(jordan.observations.map((row) => row.role), ['transaction', 'balance']);
});
test('"dost" labels a balance only as its own word', () => {
  const result = extractUniversalMoney('Przelew 45,99 PLN dostępny w aplikacji');
  assert.ok(!result.observations.some((row) => row.role === 'balance'));
});
test('a figure printed between two symbols still lists beside a second one', () => {
  const result = extractUniversalMoney('Paid € 38,87 € and € 12,00 € at SAMPLE SHOP');
  assert.ok(result.amount.issues.includes('multiple-money-fields'), JSON.stringify(result.amount));
});
for (const source of ['Sie haben 38,87 € und 12,00 € bei SAMPLE MARKT bezahlt.',
  'تم خصم 5.00 جم و 220.80 جم من بطاقة الائتمان رقم 9888 عند SAMPLE STORE المتاح 26,032.76 جم']) {
  test(`a postfixed verb after a list keeps both figures: ${source.slice(0, 30)}`, () => {
    assert.ok(extractUniversalMoney(source).amount.issues.includes('multiple-money-fields'));
  });
}
test('a posting verb between two bare figures is claimed by neither alone', () => {
  const result = extractUniversalMoney('USD 24.90 debited USD 500.00 balance');
  notPrincipal(result.amount, '50000');
  assert.notEqual(result.amount.evidence, 'explicit');
});
for (const source of [
  'Chase: Your transaction of $25.00 at SAMPLE CAFE was more than the $0.01 limit in your Alerts settings.',
  'Chase: A $45.67 debit card transaction to SAMPLE CAFE on 10/02/2026 is greater than your $3.00 limit in your Alerts settings.',
]) test(`an alert threshold is never the amount: ${source.slice(7, 40)}`, () => {
  const result = extractUniversalMoney(source);
  assert.equal(result.amount.alternatives.filter((value) => value.currency === 'USD').length, 1);
  notPrincipal(result.amount, '1'); notPrincipal(result.amount, '300');
  assert.ok(result.observations.some((row) => row.field.issues.includes('aggregate-money-field')));
});

/* ── Labelled principals ─────────────────────────────────────────────── */
for (const source of [
  'Neuer Umsatz / Betrag: -45,67 EUR / SAMPLE MARKT 4412',
  'Zahlungseingang auf Ihrem Konto ***5678: +2.450,00 EUR von SAMPLE GMBH',
  'Platnosc karta kwota 45,99 PLN SAMPLE SKLEP',
  'Płatność BLIK na kwotę 129,00 zł w SAMPLE.PL została zrealizowana.',
  'Crdt Amnt: $8.19 from SAMPLE CO',
  'Amt: $138.00 at SAMPLE CO',
  'Payment Amount: $185.28 to SAMPLE CO',
  'Purchase amount: $42.10 at SAMPLE CO',
  'Amount: 78.90 EUR at SAMPLE CO',
  'Desjardins : Achat de 42,35 $ chez SAMPLE MARCHE',
  'Un dépôt de paie de 1 850,00 $ a été effectué dans votre compte',
  'Köp 245,00 kr SAMPLE BUTIK, kort ****1234',
  'Platba kartou 459,00 Kč / SAMPLE PRAHA / karta *1234, 03.10.2026',
  'UBS Card: Transaktion CHF 45.90 bei SAMPLE ZUERICH',
  'Betaald: € 23,45 aan SAMPLE WINKEL 1403 Amsterdam',
  'Er is € 2.750,00 bijgeschreven op je rekening',
  'Bank: A credit of $29.99 from SAMPLE.COM was posted to your card ending 7788',
  'Your credit card 5815 was used at SAMPLE.COM for $20.00 on 01/12/2024.',
  'Bank: Electronic draft of $418.80 for account 8130 was deducted on 09/27/2021.',
]) test(`a labelled figure owns the principal role: ${source.slice(0, 40)}`, () => {
  const result = extractUniversalMoney(source);
  assert.equal(result.observations.length, 1, source);
  assert.equal(result.observations[0].role, 'transaction', source);
  assert.ok(!result.amount.issues.includes('amount-role-unresolved'), source);
});

test('"refunded" labels the figure before it, never a converted quote after it', () => {
  const before = extractUniversalMoney('-$123.45 was refunded to Amex ••1234');
  assert.deepEqual(before.observations.map((row) => row.role), ['transaction']);
  const quote = extractUniversalMoney('Purchase amount of THB 340.00 at SAMPLE STORE on your Debit Card ending 1234 has been refunded AED 37.40 to your card account. Avl Bal is AED 9,001.00.');
  assert.deepEqual(quote.observations.map((row) => row.role), ['transaction', 'unknown', 'balance']);
  assert.deepEqual(quote.observations[0].field.value, money('THB', '34000', 2));
});

/* ── Bilingual duplicates: one principal, never two competing ───────── */
const muscat = 'Your Debit Card XXXX1234 has been used for OMR 4.200 at SAMPLE HYPERMARKET on 14/09/2026 20:11. Avl Bal OMR 230.500 / ' +
  'تم استخدام بطاقتكم XXXX1234 بمبلغ 4.200 ر.ع لدى SAMPLE HYPERMARKET بتاريخ 14/09/2026. الرصيد المتاح 230.500 ر.ع';
test('the English and Arabic halves state one movement and one balance', () => {
  const routed = extractUniversalMoney(muscat, { moneyMarket: 'OM' });
  explicit(routed.amount, money('OMR', '4200', 3)); explicit(routed.balance, money('OMR', '230500', 3));
  assert.deepEqual(routed.observations.map((row) => row.role), ['transaction', 'balance']);
  // Unrouted, the figure keeps its one honest doubt and a single span, which
  // the policy's own-country three-decimal rule can then settle.
  const unrouted = extractUniversalMoney(muscat);
  assert.deepEqual(unrouted.amount.issues, ['decimal-or-grouping']);
  assert.equal(unrouted.amount.spans.length, 1);
  assert.equal(inspectUniversalBankEvent(muscat).issues.includes('multiple-event-adapter-required'), false);
});
for (const [label, source] of [
  ['two equal payments in one language', 'Sent OMR 4.200 to SAMPLE A and sent OMR 4.200 to SAMPLE B'],
  ['different figures in two languages', 'Your card was used for OMR 4.200 at SAMPLE SHOP / تم استخدام بطاقتكم بمبلغ 5.300 ر.ع لدى SAMPLE SHOP'],
  ['a purchase beside an Arabic refund of the same figure', 'Purchase OMR 4.200 at SAMPLE A. استرداد بمبلغ 4.200 ر.ع من SAMPLE B'],
  ['a purchase and an Arabic refund across a delimiter', 'Purchase OMR 4.200 at SAMPLE A / استرداد بمبلغ 4.200 ر.ع من SAMPLE A'],
  ['an Arabic half naming another party', 'Transfer sent OMR 50.000 to SAMPLE A / تحويل بمبلغ OMR 50.000 الى SAMPLE B'],
  ['an Arabic half with an extra figure', 'Your card was used for OMR 4.200 at SAMPLE SHOP / تم استخدام بطاقتكم بمبلغ 4.200 ر.ع لدى SAMPLE SHOP ورسوم 0.500 ر.ع'],
]) test(`not merged: ${label}`, () => {
  const result = extractUniversalMoney(source);
  assert.ok(result.amount.issues.includes('multiple-money-fields'), JSON.stringify(result.amount));
});

/* ── Identifiers are never money ─────────────────────────────────────── */
for (const [source, count] of [
  ['Card ending 4455 used for EUR12.40 at SAMPLE STORES 3051 DUBLIN on 12/09/26 13:05.', 1],
  ['Köp 245,00 kr SAMPLE BUTIK 118 46 STOCKHOLM, kort ****1234 12.09.2026', 1],
  ['تم تحويل مبلغ 50,000 دينار عراقي الى الرقم 07801234567 بنجاح. رقم العملية 12345678', 1],
  ['BenefitPay / You have received BHD 20.000 from SAMPLE NAME. Ref: 260918123456', 1],
]) test(`phone numbers, tails, postcodes, references and dates stay out: ${source.slice(0, 40)}`, () => {
  assert.equal(extractUniversalMoney(source).observations.length, count);
});

/* ── Paired non-posting controls on the new grammars stay unbooked ──── */
const observedAt = Date.parse('2026-10-12T12:00:00Z');
function parseAs(country, currency, exponent, body, sender = 'SAMPLEBANK') {
  setActiveMarket('ZZ'); setActiveCountry(country); setLedgerCurrency(currency, exponent);
  const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: currency, activeMarket: 'ZZ',
    bestEffort: { enabled: true, country }, fxLookup: () => null });
  return session.parseUnproven(body, sender, session.inspect(body, sender), observedAt);
}
for (const [country, currency, exponent, body] of [
  ['PL', 'PLN', 2, 'Płatność BLIK na kwotę 129,00 zł w SAMPLE.PL została odrzucona.'],
  ['PL', 'PLN', 2, 'Płatność kartą kwota 45,99 PLN SAMPLE SKLEP oczekuje na autoryzację.'],
  ['DE', 'EUR', 2, 'Betrag: 45,67 EUR wird am 20.10.2026 von Ihrem Konto abgebucht.'],
  ['DE', 'EUR', 2, 'Ihre Kartenzahlung über 45,67 EUR bei SAMPLE MARKT wurde abgelehnt.'],
  ['FR', 'EUR', 2, 'Achat de 42,35 EUR chez SAMPLE refusé.'],
  ['FR', 'EUR', 2, 'Votre code de vérification est 482913 pour l\'achat de 42,35 EUR chez SAMPLE.'],
  ['SE', 'SEK', 2, 'Köp 245,00 kr SAMPLE BUTIK nekades.'],
  ['DK', 'DKK', 2, 'Mette Hansen anmoder om 1.250,00 kr. via MobilePay.'],
  ['US', 'USD', 2, 'A credit of $29.99 from SAMPLE.COM is pending and may take 3 days to post.'],
  ['US', 'USD', 2, 'Did you make a charge of $45.67 at SAMPLE CAFE? Reply YES or NO.'],
  ['US', 'USD', 2, 'If your credit card 5815 was used at SAMPLE.COM for $20.00, call us.'],
  ['US', 'USD', 2, 'Your $45.67 charge at SAMPLE CAFE was not approved.'],
  ['US', 'USD', 2, 'Get 5% back: spend $500.00 at SAMPLE STORE this month. Offer ends soon.'],
  ['EG', 'EGP', 2, 'رمز التحقق 482913 لعملية شراء بمبلغ 3,000.00 جم لدى SAMPLE STORE. لا تشاركه مع أحد'],
  ['EG', 'EGP', 2, 'سيتم خصم مبلغ 3,000.00 جم من حسابك بتاريخ 20/10/2026'],
  ['IQ', 'IQD', 3, 'طلب منك NAME تحويل مبلغ 50,000 دينار عراقي. اضغط للموافقة'],
  ['OM', 'OMR', 3, 'Your Debit Card XXXX1234 transaction for OMR 4.200 at SAMPLE SHOP was declined. Avl Bal OMR 230.500'],
  ['KW', 'KWD', 3, 'Acct. 0465 will be debited with KWD 5.800 for SAMPLE COOP on 20/10/2026. Your Avl. balance is KWD 1,743.966'],
  ['EG', 'EGP', 2, 'تم رفض عملية خصم 220.80 جم من بطاقة الائتمان رقم 9888 عند SAMPLE STORE المتاح 26,032.76 جم'],
  ['EG', 'EGP', 2, 'هل قمت بخصم 220.80 جم من بطاقة الائتمان رقم 9888 عند SAMPLE STORE؟'],
  ['OM', 'OMR', 3, 'Purchase OMR 4.200 at SAMPLE A. استرداد بمبلغ 4.200 ر.ع من SAMPLE B'],
  ['OM', 'OMR', 3, 'Your Debit Card XXXX1234 has been used for OMR 4.200 at SAMPLE SHOP pending authorisation / تم استخدام بطاقتكم XXXX1234 بمبلغ 4.200 ر.ع لدى SAMPLE SHOP'],
  ['BH', 'BHD', 3, 'SAMPLE CAFE Purchase Transaction from ACCOUNT020 BHD 9.500+ Your available balance is BHD 2,979.399'],
  ['BH', 'BHD', 3, 'SAMPLE CAFE Refund Transaction to ACCOUNT020 BHD 9.500- Your available balance is BHD 2,979.399'],
]) test(`non-posting control stays unbooked: ${body.slice(0, 48)}`, () => {
  assert.equal(parseAs(country, currency, exponent, body), null);
});

/* ── End to end: the money read here reaches the ledger exactly ─────── */
for (const [country, currency, exponent, body, minor] of [
  ['EG', 'EGP', 2, 'تم خصم 220.80 جم من بطاقة الائتمان رقم 9888 عند SAMPLE STORE المتاح 26,032.76 جم', 22080],
]) test(`booked with the exact principal, never the balance: ${body.slice(0, 40)}`, () => {
  const row = parseAs(country, currency, exponent, body);
  assert.ok(row, 'expected a booked row');
  assert.equal(row.currency, currency); assert.equal(row.amountFils, minor); assert.equal(row.type, 'expense');
});
