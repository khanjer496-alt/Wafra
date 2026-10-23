const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader } = require('./load-ts.cjs');
const load = createLoader();
const { inspectUniversalBankEvent: inspect } = load('@/lib/universal-parser');

// Integration round: controls the parallel lanes each covered for one
// language, extended to the other launch languages once their wording merged.
// Every body is synthetic (fictional banks, people, shops and values), modelled
// on alert-lab negatives that booked after the merge.

for (const [label, source] of [
  ['Arabic question joined to the movement',
    'Sample Bank: تم استخدام بطاقتك المنتهية بـ 5847 بمبلغ 10.510 BHD لدى كارفور، ألست أنت؟ الرصيد المتاح 332.524 BHD'],
  ['Arabic hedge "ربما"', 'ربما تم استخدام بطاقتك المنتهية بـ 4226 لعملية بمبلغ 100.000 OMR لدى SAMPLE MART.'],
  ['Arabic hedge "قد يكون"', 'قد يكون تم استخدام بطاقتك المنتهية بـ 4226 بمبلغ 100.000 OMR لدى SAMPLE MART.'],
  ['French payment still to accept', 'Sample Bank\nCAMILLE BERNARD vous a envoyé 164,05 EUR. Acceptez-le?'],
  ['Czech worked example', 'Sample Banka: Příklad: platba kartou 3 690,15 Kč u SAMPLE SHOP CZ.'],
  ['German worked example', 'Beispiel: Kartenzahlung 12,00 EUR bei SAMPLE MARKT.'],
  ['subscription renewal notice', 'A charge of QAR 701.46 at SAMPLE STREAM renews tomorrow.'],
  ['subscription renewal on a date', 'Your SAMPLE STREAM subscription of $9.99 renews on 10/20.'],
  ['warning sign on the movement itself', 'Has pagado 14,55 € en SAMPLE EATS ⚠️ Pago pendiente de confirmar'],
  ['Spanish worked example', 'Ejemplo: Compra de 23,40 EUR en SAMPLE TIENDA con tu tarjeta ·5678.'],
]) test(`never posted: ${label}`, () => {
  assert.notEqual(inspect(source, {}).status, 'posted');
});

for (const [label, source, direction] of [
  ['Arabic card use with a balance footer',
    'Sample Bank: تم استخدام بطاقتك المنتهية بـ 5847 بمبلغ 10.510 BHD لدى كارفور. الرصيد المتاح 332.524 BHD', 'debit'],
  ['Arabic card use, no footer', 'تم استخدام بطاقتك المنتهية بـ 4226 لعملية بمبلغ 100.000 OMR لدى SAMPLE MART.', 'debit'],
  ['French completed incoming transfer', 'Sample Bank\nCAMILLE BERNARD vous a envoyé 164,05 EUR.', 'credit'],
  ['Czech card payment', 'Sample Banka: platba kartou 3 690,15 Kč u SAMPLE SHOP CZ.', 'debit'],
  ['English separate "Not you?" footer', 'Your card ending 1234 was used for $45.00 at SAMPLE MART. Not you? Call 1-800-000-0000', 'debit'],
  ['completed charge with a later renewal mention', 'A charge of $9.99 at SAMPLE STREAM was made on your card ending 1234. Your plan renews monthly.', 'debit'],
  // Revolut heads its pocket balance with a warning sign; the purchase stands.
  ['warning sign on the balance line', 'Has pagado 14,55 € en SAMPLE EATS 🍽️ ⚠️ Saldo del Pocket EUR: 5,52 €', 'debit'],
  // "Exemplo" as a merchant word is a name, not a worked-example lead-in.
  ['merchant named after a lead-in word', 'Your card ending 1234 was used for $45.00 at EXEMPLO CAFE.', 'debit'],
]) test(`paired positive still reads as a posted ${direction}: ${label}`, () => {
  const event = inspect(source, {});
  assert.equal(event.status, 'posted');
  assert.equal(event.direction, direction);
});

// An e-mail address naming a launch bank is not that bank's registered SMS
// header: it must take the unproven route, where the call-back guard applies.
const { detectLaunchMarketFromSender } = load('@/lib/markets');
test('an e-mail sender is never a launch-bank sender', () => {
  assert.equal(detectLaunchMarketFromSender('alerts@samplebank-mail.com'), null);
  assert.equal(detectLaunchMarketFromSender('hsbc@alerts.example'), null);
  assert.equal(detectLaunchMarketFromSender('HSBC'), 'AE');
});
