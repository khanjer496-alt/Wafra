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

// --- roles-fields lane: fee/cost/tax fields, local amount labels, balance and
// limit vocabulary, CJK punctuation. Synthetic bodies with fictional values.
const roles = (source, context) => extractUniversalMoney(source, context).observations.map((row) => row.role);
for (const [source, expected] of [
  // Wallet fee fields print after a comma or a "charged/was" verb and are never the principal.
  ['Ksh800.00 sent to ANN. New M-PESA balance is Ksh1,950.00. Transaction cost, Ksh15.00.', ['transaction', 'balance', 'fee']],
  ['You have sent Ksh 1,200.00 to ANN. Your balance is Ksh 340.00. Cost Ksh 10.00.', ['transaction', 'balance', 'fee']],
  ['You have sent UGX 20,000 to ANN. Fee was UGX 500. Tax was UGX 100.', ['transaction', 'fee', 'fee']],
  ['Payment made for GHS 40.00 to ESI. Fee charged: GHS 0.40 TAX charged: GHS 0.00.', ['transaction', 'fee', 'fee']],
  ['Ksh2,000.00 paid. Transaction fee Ksh33.00 VAT Ksh5.00', ['transaction', 'fee', 'fee']],
  // Swahili / French / Spanish / Portuguese fee nouns, Unicode-bounded.
  ['Umetuma Tsh25,000.00 kwa ASHA. Ada ya muamala ni Tsh1,200.00.', ['transaction', 'fee']],
  ['Virement de 100,00 EUR effectue. Frais 2,00 EUR', ['transaction', 'fee']],
  ['Usted envio $60.000 al 3** *** 4512. Comision $500', ['transaction', 'fee']],
]) test(`fee/cost fields keep their own role: ${expected.join('+')} in "${source.slice(0, 40)}"`, () => {
  assert.deepEqual(roles(source), expected);
});
test('"purchase cost" and a tax verb inside a movement keep the movement label', () => {
  assert.deepEqual(roles('Your purchase cost $50.00 at SHOP'), ['transaction']);
  assert.deepEqual(roles('Tax $300.00 debited from your account'), ['transaction']);
  assert.deepEqual(roles('The cost of airtime is Ksh20.00'), ['unknown']);
});
test('a fee is never promoted over an unlabelled principal', () => {
  // PMWithdraw glued to the clock: the cost must not stand in for the cash movement.
  const withdrawn = extractUniversalMoney('Confirmed.on 18/9/26 at 6:15 PMWithdraw Ksh3,000.00 from 123456 - AGENT. New M-PESA balance is Ksh1,220.00. Transaction cost, Ksh53.00.');
  assert.deepEqual(withdrawn.observations.map((row) => row.role), ['transaction', 'balance', 'fee']);
  assert.equal(withdrawn.amount.value.minorUnits, '300000');
  const fee = extractUniversalMoney('Transaction cost, Ksh23.00. New M-PESA balance is Ksh1,100.00.');
  assert.deepEqual(fee.observations.map((row) => row.role), ['fee', 'balance']);
  const unlabelled = extractUniversalMoney('Notice Ksh3,000.00. Transaction cost, Ksh53.00.');
  assert.equal(unlabelled.amount.evidence, 'ambiguous');
});
for (const [source, expected] of [
  // Accent-final and local labels that ASCII \b never matched.
  ['Votre compte a été crédité de 8 500,00 MAD le 28/09. Solde: 9 120,40 MAD', ['transaction', 'balance']],
  ['Retrait DAB de 60,00 € le 18/09. Solde disponible : 512,08 €', ['transaction', 'balance']],
  ['Achat de 42,35 $ chez METRO', ['transaction']],
  ['Pagaste $ 6.430 en PEDIDOSYA con tu tarjeta', ['transaction']],
  ['ANA te envió $5,300.00 por SPEI', ['transaction']],
  ['Se abonaron $459.00 a tu tarjeta', ['transaction']],
  ['Retiro de efectivo por S/ 400.00 en cajero', ['transaction']],
  ['Giro en cajero automatico por $60.000 con tu Tarjeta', ['transaction']],
  ['Pix enviado com sucesso. Valor R$ 75,00 para JOAO. Conta final 45-X.', ['transaction']],
  ['Saque de R$ 400,00 realizado. Saldo disponivel: R$ 1.122,15', ['transaction', 'balance']],
  ['Você pagou R$ 89,90 para Centauro usando seu saldo', ['transaction']],
  ['INR 1,249.00 refunded to your card by AMAZON. Avl Lmt INR 98,751.00', ['transaction', 'credit-limit']],
  ['A credit of $29.99 from AMAZON was posted', ['transaction']],
  ['A GIRO deduction of SGD 156.40 was made', ['transaction']],
  ['Rek Anda telah dikredit Rp 6.750.000,00. Saldo Rp 8.912.400,00', ['transaction', 'balance']],
  ['Kamu udah bayar Rp28.000 ke Warung', ['transaction']],
  ['Pembayaran QRIS Berhasil Rp45.000 telah dibayarkan ke KOPI', ['transaction']],
  ['Kiasi cha TZS 150,000.00 kimetolewa. Salio: TZS 1,204,550.00', ['transaction', 'balance']],
  ['Maximum kartiniz ile SHELL PETROL ISTANBUL\'dan 1.250,00 TL harcama yapildi. Kullanilabilir limitiniz 18.750,00 TL.', ['transaction', 'credit-limit']],
  ['isyerinden 89,90 TL alisveris yapilmistir. Kalan limit: 14.210,10 TL', ['transaction', 'credit-limit']],
  ['Enpara hesabinizdan MEHMET adli aliciya 3.000,00 TL EFT gonderilmistir.', ['transaction']],
]) test(`local label vocabulary: ${source.slice(0, 48)}`, () => {
  assert.deepEqual(roles(source), expected);
});
for (const [source, expected] of [
  ['Avail.bal INR 5,000.00 Rs.250.00 debited', ['balance', 'transaction']],
  ['Rs.10000 deposited. Avlbl Amt:Rs.22345.67', ['transaction', 'balance']],
  ['Rs.799.00 debited. AvlBal:Rs12,345.67', ['transaction', 'balance']],
  ['Purchase THB 1,250.00 at SHOP. Avail. credit THB 48,750.00.', ['transaction', 'credit-limit']],
  ['Salio lako jipya ni Tsh63,400.00', ['balance']],
  ['Bakiyeniz 1.230,45 TL', ['balance']],
  ['Kalan limit 14.210 TL', ['credit-limit']],
  ['잔액 845,300원', ['balance']],
  ['可用餘額新台幣62,341元', ['balance']],
  ['ยอดคงเหลือ THB 12,345.67', ['balance']],
]) test(`balance and limit vocabulary stays informational: ${source.slice(0, 32)}`, () => {
  const result = extractUniversalMoney(source);
  assert.deepEqual(result.observations.map((row) => row.role), expected);
  if (expected.every((role) => role === 'balance' || role === 'credit-limit')) assert.equal(result.amount.evidence, 'missing');
});
test('loyalty points and running totals are aggregates, never a second transaction', () => {
  const points = extractUniversalMoney('649,99 TL tutarinda alisveris yapilmistir. Worldpuan: 3,25 TL.');
  assert.equal(points.amount.value.minorUnits, '64999');
  assert.ok(points.observations[1].field.issues.includes('aggregate-money-field'));
  const running = extractUniversalMoney('15,000원 승인\n누적523,400원');
  assert.ok(running.observations.at(-1).field.issues.includes('aggregate-money-field'));
});
test('fullwidth commas and Chinese punctuation separate monetary fields', () => {
  const result = extractUniversalMoney('支出(财付通-美团)45.80元，余额3,245.67元。');
  assert.deepEqual(result.observations.map((row) => row.role), ['transaction', 'balance']);
  assert.equal(result.amount.value.minorUnits, '4580');
  assert.equal(result.balance.value.minorUnits, '324567');
  const korean = extractUniversalMoney('출금200,000원\n잔액845,300원');
  assert.deepEqual(korean.observations.map((row) => row.role), ['transaction', 'balance']);
  assert.equal(korean.amount.value.minorUnits, '200000');
  assert.deepEqual(extractUniversalMoney('您尾号1234卡余额3,245.67元。').observations.map((row) => row.role), ['balance']);
});
test('an identifier or another currency\'s yuan-unit text is not recovered beside CJK words', () => {
  assert.notEqual(extractUniversalMoney('参考号AB金额58.00元').amount.evidence, 'explicit');
  assert.notEqual(extractUniversalMoney('参考编号金额58.00元').amount.evidence, 'explicit');
  // 新台幣…元 is Taiwan dollars; reading its figure as CNY would book the wrong currency.
  assert.notEqual(extractUniversalMoney('消費新台幣1,280元').amount.evidence, 'explicit');
  assert.notEqual(extractUniversalMoney('港幣50元').amount.evidence, 'explicit');
});
test('the Malaysian free-SMS marker RM0 is not money; a real zero amount still is', () => {
  const alert = extractUniversalMoney('RM0 Maybank: Your card ending 1234 has been charged RM59.90 at SHOPEE');
  assert.deepEqual(alert.observations.map((row) => row.role), ['transaction']);
  assert.equal(alert.amount.value.minorUnits, '5990');
  assert.equal(extractUniversalMoney('RM0 Maybank: Baki akaun RM2,145.30').observations.length, 1);
  // Only the opening marker is dropped: a later RM0 is an ordinary figure.
  assert.equal(extractUniversalMoney('Maybank: charged RM0 and RM5.00').observations.length, 2);
});
test('"new balance" is the account balance in a wallet receipt and a statement total beside due words', () => {
  assert.deepEqual(roles('You have sent UGX 50,000 to ANN. Your new balance: UGX 120,500.'), ['transaction', 'balance']);
  assert.deepEqual(roles('Statement ready. New balance $845.20, minimum payment $25.00 due 10/28/2026.'), ['statement-total', 'minimum-due']);
  assert.deepEqual(roles('Your new balance is $845.20. Pay by 10/28/2026 to avoid interest. Amount due $25.00'), ['statement-total', 'bill-due']);
});
