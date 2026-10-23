'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./load-ts.cjs').createLoader();
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { parseHistoricalMessageRecords } = load('@/lib/historical-import');
const { setActiveCountry } = load('@/lib/country');
const { setActiveMarket, setLedgerCurrency } = load('@/lib/markets');

// Money the alert itself says was taken back, voided or only approximately
// stated. Every body is synthetic, with fictional names and values; none is a
// consented real alert. A wrong booking is worse than a miss: each of these
// waits in Review, while the same wording without the take-back still books.
const observedAt = Date.parse('2026-10-12T12:00:00Z');

function session(country, currency) {
  setActiveMarket('ZZ'); setActiveCountry(country); setLedgerCurrency(currency, 2);
  return createLaunchAlertSession({ overrides: {}, pinnedCurrency: currency, activeMarket: 'ZZ',
    bestEffort: { enabled: true, country }, fxLookup: () => null, regionHint: country });
}
const seam = (body, sender, country, currency) => {
  const reader = session(country, currency);
  return reader.parseUnproven(body, sender, reader.inspect(body, sender), observedAt);
};
let historyId = 0;
const history = (body, country, currency) => {
  const reader = session(country, currency);
  historyId += 1;
  const id = String(historyId).padStart(64, '0');
  return parseHistoricalMessageRecords([JSON.stringify({ v: 1, id, text: body, receivedAt: new Date(observedAt).toISOString() })],
    {}, new Date(observedAt), new Set(), reader).parsed;
};
// A bank-like sender per country (credits from an unknown sender never book).
const SENDER = { GB: 'Monzo', US: 'Chase', IN: 'HDFCBK', ES: 'BBVA', IT: 'Intesa', PT: 'CGD', SE: 'Swedbank', FR: 'BNP', NL: 'ING', DE: 'Sparkasse', CA: 'RBC' };
const neverBooks = (country, currency, body) => {
  for (const sender of [SENDER[country], 'BANK', '']) assert.equal(seam(body, sender, country, currency), null, `sender ${JSON.stringify(sender)}`);
  assert.equal(history(body, country, currency).length, 0, 'History');
};

// F1: a received credit the same message says was recalled, clawed back,
// charged back, reversed or otherwise taken back by the payer.
const TAKEN_BACK = [
  ['GB', 'GBP', 'You received £45.00 from JOHN SMITH. The sender has recalled this payment.'],
  ['GB', 'GBP', 'You received £45.00 from JOHN SMITH. This payment has been charged back.'],
  ['GB', 'GBP', 'You received £45.00 from JOHN SMITH. This payment was clawed back.'],
  ['GB', 'GBP', 'You received £45.00 from JOHN SMITH. Refunded to sender.'],
  ['GB', 'GBP', 'You received £45.00 from JOHN SMITH. Withdrawn by sender.'],
  ['GB', 'GBP', 'You received £45.00 from JOHN SMITH. This payment was undone.'],
  ['GB', 'GBP', 'You received £45.00 from JOHN SMITH. The sender retracted it.'],
  ['GB', 'GBP', 'You received £45.00 from JOHN SMITH. The money was taken back.'],
  ['GB', 'GBP', 'You received £45.00 from JOHN SMITH. Debited back to sender.'],
  ['GB', 'GBP', 'You received £45.00 from JOHN SMITH. To be credited.'],
  ['GB', 'GBP', 'You received £45.00 from JOHN SMITH. Payment under investigation.'],
  ['GB', 'GBP', 'You received £45.00 from JOHN SMITH. PAYMENT RECALLED.'],
  ['US', 'USD', 'You received a direct deposit of $1,250.00. This deposit was clawed back by the payer.'],
  ['US', 'USD', 'You received $45.00 from JOHN SMITH. The payer recalled it.'],
  ['IN', 'INR', 'INR 1,250.00 credited to a/c XX1234 by UPI. Payment recalled by remitter.'],
  ['ES', 'EUR', 'Has recibido una transferencia de 450,00 EUR de JUAN PEREZ. La transferencia ha sido revertida.'],
  ['IT', 'EUR', "Hai ricevuto un bonifico di 450,00 EUR da MARIO ROSSI. Il bonifico è stato richiamato dall'ordinante."],
  ['PT', 'EUR', 'Recebeu uma transferência de 450,00 EUR de JOAO SILVA. Transferência revertida.'],
  ['SE', 'SEK', 'Du har fått 450,00 kr från ANNA SVENSSON. Betalningen har återkallats.'],
  ['FR', 'EUR', "Virement reçu : 1 500,00 € de JEAN DUPONT. Ce virement a été rappelé par l'émetteur."],
  ['FR', 'EUR', 'Virement reçu : 1 500,00 € de JEAN DUPONT. Virement extourné.'],
  ['DE', 'EUR', 'Sie haben 450,00 EUR von ANNA MUSTER erhalten. Die Überweisung wurde zurückgerufen.'],
  ['NL', 'EUR', 'Storno: Je hebt 450,00 EUR ontvangen van JAN JANSEN'],
  // Review 4: the take-back read structurally, in any tense — the movement as
  // the subject of a take-back participle, or the object of a take-back verb.
  ['GB', 'GBP', 'You received £45.00 from JOHN SMITH. JOHN SMITH is recalling this payment.'],
  ['GB', 'GBP', 'You received £45.00 from JOHN SMITH. This payment was reclaimed by the sender.'],
  ['US', 'USD', 'You received $45.00 from JOHN SMITH with Zelle. Payment pulled back by sender.'],
  ['US', 'USD', 'You received $45.00 from JOHN SMITH. The transfer is being pulled back.'],
  ['US', 'USD', 'You received $45.00 from JOHN SMITH. The deposit has been reclaimed.'],
  ['US', 'USD', 'You received $45.00 from JOHN SMITH. The sender is reversing this transfer.'],
  ['US', 'USD', 'You received $45.00 from JOHN SMITH. The payment will be pulled back.'],
  ['US', 'USD', 'You received $45.00 from JOHN SMITH. The sender took back the money.'],
  // Review 5: the same structural reading in an all-capitals alert.
  ['GB', 'GBP', 'YOU RECEIVED £45.00 FROM JOHN SMITH. THIS PAYMENT HAS BEEN RECALLED BY THE SENDER.'],
  ['GB', 'GBP', 'YOU RECEIVED £45.00 FROM JOHN SMITH. JOHN SMITH IS RECALLING THIS PAYMENT.'],
  ['US', 'USD', 'YOU RECEIVED $45.00 FROM JOHN SMITH WITH ZELLE. PAYMENT PULLED BACK BY SENDER.'],
];
for (const [country, currency, body] of TAKEN_BACK) test(`taken-back credit waits in Review (${country}): ${body.slice(0, 60)}`, () => {
  neverBooks(country, currency, body);
});

// F2: "Storno:" before a card payment may void an authorisation that never
// moved money. Without wording that proves a credit it waits in Review.
const STORNO_LEAD = [
  ['DE', 'EUR', 'Storno: Kartenzahlung 27,15 EUR bei REWE'],
  ['NL', 'EUR', 'storno: Pinbetaling 18,45 EUR bij ALBERT HEIJN'],
  ['ES', 'EUR', 'storno: Compra de 45,00 EUR en ZARA'],
  ['IT', 'EUR', 'STORNO: Pagamento 30,00 EUR presso ESSELUNGA'],
];
for (const [country, currency, body] of STORNO_LEAD) test(`storno lead waits in Review (${country}): ${body}`, () => {
  neverBooks(country, currency, body);
});

// Minor: an approximate figure, or a number written in a convention the
// currency does not use, is never the exact amount.
const NOT_EXACT = [
  ['GB', 'GBP', 'You spent about £45.00 at TESCO'],
  ['GB', 'GBP', 'You spent approximately £45.00 at TESCO'],
  ['US', 'USD', 'You spent around $45.00 at TARGET'],
  ['US', 'USD', 'You spent ~$45.00 at TARGET'],
  ['DE', 'EUR', 'Kartenzahlung über ca. 27,15 EUR bei REWE'],
  ['US', 'USD', 'You spent $4,50 at STARBUCKS'],
  ['US', 'USD', 'You spent $1,00,000.00 at STARBUCKS'],
  ['GB', 'GBP', 'You spent £1.234,56 at TESCO'],
  // Review 4: more hedges, and a code or sign variant before a decimal comma.
  ['US', 'USD', 'You spent nearly $45.00 at TARGET'],
  ['US', 'USD', 'You spent an estimated $45.00 at TARGET'],
  ['US', 'USD', 'You spent up to $45.00 at TARGET'],
  ['US', 'USD', 'You spent roughly $45.00 at TARGET'],
  ['US', 'USD', 'You spent est. $45.00 at TARGET'],
  ['GB', 'GBP', 'Card purchase at TESCO about £12.00'],
  ['US', 'USD', 'You spent USD 4,50 at TARGET'],
  ['US', 'USD', 'You spent US$4,50 at TARGET'],
  ['CA', 'CAD', 'You spent C$4,50 at TIM HORTONS'],
  // Review 5: a function word breaks the capitalised name run before a hedge,
  // and every hedge reads the same in capitals.
  ['US', 'USD', 'CHASE: CARD PURCHASE AT STARBUCKS FOR APPROX USD 45.00 ON CARD 1234'],
  ['US', 'USD', 'CHASE: CARD PURCHASE AT STARBUCKS FOR ABOUT USD 45.00 ON CARD 1234'],
  ['US', 'USD', 'CARD PURCHASE OF ABOUT $45.00 AT STARBUCKS'],
  ['US', 'USD', 'PURCHASE AMOUNT APPROX $45.00 AT TARGET'],
  ['GB', 'GBP', 'YOU SPENT ABOUT £45.00 AT TESCO'],
  ['GB', 'GBP', 'YOU SPENT APPROXIMATELY £45.00 AT TESCO'],
  ['US', 'USD', 'YOU SPENT NEARLY $45.00 AT TARGET'],
  ['US', 'USD', 'YOU SPENT AN ESTIMATED $45.00 AT TARGET'],
  ['US', 'USD', 'YOU SPENT UP TO $45.00 AT TARGET'],
  ['US', 'USD', 'YOU SPENT ROUGHLY $45.00 AT TARGET'],
  ['US', 'USD', 'YOU SPENT EST. $45.00 AT TARGET'],
  ['US', 'USD', 'YOU SPENT ~$45.00 AT TARGET'],
  ['US', 'USD', 'YOU SPENT USD 4,50 AT TARGET'],
  // Review 5: a hedge AFTER the amount.
  ['US', 'USD', 'You spent $45.00 (approx.) at STARBUCKS'],
  ['US', 'USD', 'You spent $45.00 (approximately) at STARBUCKS'],
  ['US', 'USD', 'You spent $45.00 (est.) at STARBUCKS'],
  ['US', 'USD', 'You spent $45.00 (estimated) at STARBUCKS'],
  ['US', 'USD', 'You spent $45.00 approximately at STARBUCKS'],
  ['US', 'USD', 'You spent $45.00 or so at STARBUCKS'],
  ['US', 'USD', 'You spent $45.00 roughly at STARBUCKS'],
  ['US', 'USD', 'You spent $45.00~ at STARBUCKS'],
  ['US', 'USD', 'YOU SPENT $45.00 (APPROX.) AT STARBUCKS'],
  ['US', 'USD', 'YOU SPENT $45.00 (ESTIMATED) AT STARBUCKS'],
];
for (const [country, currency, body] of NOT_EXACT) test(`inexact amount waits in Review (${country}): ${body}`, () => {
  neverBooks(country, currency, body);
});

// Paired controls: the same movements without the take-back keep booking
// exactly as before, and so do merchant refunds and native number formats.
const STILL_BOOKS = [
  ['GB', 'GBP', 'You received £45.00 from JOHN SMITH.', 'income', 4500],
  ['US', 'USD', 'You received $45.00 from JOHN SMITH.', 'income', 4500],
  ['US', 'USD', 'You received a direct deposit of $1,250.00.', 'income', 125000],
  ['IN', 'INR', 'INR 1,250.00 credited to a/c XX1234 by UPI.', 'income', 125000],
  ['ES', 'EUR', 'Has recibido una transferencia de 450,00 EUR de JUAN PEREZ.', 'income', 45000],
  ['IT', 'EUR', 'Hai ricevuto un bonifico di 450,00 EUR da MARIO ROSSI.', 'income', 45000],
  ['PT', 'EUR', 'Recebeu uma transferência de 450,00 EUR de JOAO SILVA.', 'income', 45000],
  ['SE', 'SEK', 'Du har fått 450,00 kr från ANNA SVENSSON.', 'income', 45000],
  ['FR', 'EUR', 'Virement reçu : 1 500,00 € de JEAN DUPONT.', 'income', 150000],
  ['NL', 'EUR', 'Je hebt 450,00 EUR ontvangen van JAN JANSEN', 'income', 45000],
  ['GB', 'GBP', 'Refund of £45.00 from TESCO', 'income', 4500],
  ['US', 'USD', 'You received a refund of $25.00 from AMAZON.', 'income', 2500],
  ['ES', 'EUR', 'Reembolso de EUR 21,00 acreditado a su tarjeta 6612 de TIENDA MAR el 01/10/2026', 'income', 2100],
  ['DE', 'EUR', 'EDEKA hat Ihnen 105,96 EUR erstattet.', 'income', 10596],
  ['DE', 'EUR', 'Kartenzahlung 27,15 EUR bei REWE', 'expense', 2715],
  ['NL', 'EUR', 'Pinbetaling 18,45 EUR bij ALBERT HEIJN', 'expense', 1845],
  ['ES', 'EUR', 'Compra de 45,00 EUR en ZARA', 'expense', 4500],
  ['GB', 'GBP', 'You spent £45.00 at TESCO', 'expense', 4500],
  ['GB', 'GBP', 'You spent £1,234.56 at TESCO', 'expense', 123456],
  ['US', 'USD', 'You spent $1,234.56 at TARGET', 'expense', 123456],
  ['US', 'USD', 'You spent $4.50 at STARBUCKS', 'expense', 450],
  ['DE', 'EUR', 'Kartenzahlung 1.234,56 EUR bei REWE', 'expense', 123456],
  ['GB', 'GBP', 'You spent £5.00 at STORNOWAY CO-OP', 'expense', 500],
  ['GB', 'GBP', 'You spent £12.00 at ABOUT TIME CAFE', 'expense', 1200],
  // The new take-back words in a general rule or an imperative are no status of this movement.
  ['GB', 'GBP', "You spent £45.00 at TESCO. Card payments can't be undone, contact TESCO for a refund.", 'expense', 4500],
  ['GB', 'GBP', 'You received £45.00 from JOHN SMITH. Bank transfers cannot be recalled.', 'income', 4500],
  ['FR', 'EUR', 'Vous avez reçu un virement de 1 500,00 EUR de JEAN DUPONT. Rappelez-vous de vérifier votre solde.', 'income', 150000],
  ['US', 'USD', 'Purchase at AMAZON.CA $45.00 approved.', 'expense', 4500],
  // Review 4: a rule about payments in general, whatever the modal, and a
  // periodic credit of another kind, are no status of this movement.
  ['GB', 'GBP', 'You received £45.00 from JOHN SMITH. Payments can be undone within 30 minutes.', 'income', 4500],
  ['GB', 'GBP', 'You spent £45.00 at TESCO. Payments can be undone within 30 minutes.', 'expense', 4500],
  ['GB', 'GBP', 'You received £45.00 from JOHN SMITH. Faster Payments may be recalled only in cases of fraud.', 'income', 4500],
  ['GB', 'GBP', 'You received £45.00 from JOHN SMITH. Interest to be credited monthly.', 'income', 4500],
  ['US', 'USD', 'You received $45.00 from JOHN SMITH. If the sender recalls it, we will let you know.', 'income', 4500],
  ['US', 'USD', 'Cash withdrawn: $200.00 at ATM 1234. Funds withdrawn from your checking account.', 'expense', 20000],
  // A capitalised hedge inside the merchant name is the name.
  ['GB', 'GBP', 'Card purchase at ROUND ABOUT £12.00', 'expense', 1200],
  // A dot-decimal figure after a code or sign variant, and a native decimal comma.
  ['US', 'USD', 'You spent USD 4.50 at TARGET', 'expense', 450],
  ['US', 'USD', 'You spent US$4.50 at TARGET', 'expense', 450],
  ['CA', 'CAD', 'You spent C$4.50 at TIM HORTONS', 'expense', 450],
  ['DE', 'EUR', 'Kartenzahlung EUR 12,50 bei REWE', 'expense', 1250],
  ['SE', 'SEK', 'Kortköp SEK 312,00 hos BOKHANDELN', 'expense', 31200],
  // Review 5: the capitals counterparts of the controls above.
  ['GB', 'GBP', 'CARD PURCHASE AT ROUND ABOUT £12.00', 'expense', 1200],
  ['US', 'USD', 'CARD PURCHASE AT STARBUCKS FOR USD 45.00 ON CARD 1234', 'expense', 4500],
  ['GB', 'GBP', 'YOU RECEIVED £45.00 FROM JOHN SMITH. PAYMENTS CAN BE UNDONE WITHIN 30 MINUTES.', 'income', 4500],
  ['GB', 'GBP', 'YOU RECEIVED £45.00 FROM JOHN SMITH. FASTER PAYMENTS MAY BE RECALLED ONLY IN CASES OF FRAUD.', 'income', 4500],
  ['GB', 'GBP', 'YOU RECEIVED £45.00 FROM JOHN SMITH. INTEREST TO BE CREDITED MONTHLY.', 'income', 4500],
  ['GB', 'GBP', "YOU SPENT £45.00 AT TESCO. CARD PAYMENTS CAN'T BE UNDONE.", 'expense', 4500],
  ['US', 'USD', 'YOU SPENT USD 4.50 AT TARGET', 'expense', 450],
  // A parenthesis naming a tax is no hedge.
  ['GB', 'GBP', 'You spent £45.00 (incl. VAT) at TESCO', 'expense', 4500],
];
for (const [country, currency, body, type, amount] of STILL_BOOKS) test(`paired control still books (${country}): ${body.slice(0, 60)}`, () => {
  const parsed = seam(body, SENDER[country], country, currency);
  assert.ok(parsed, 'expected a booking');
  assert.equal(parsed.type, type);
  assert.equal(parsed.amountFils, amount);
  assert.equal(parsed.currency, currency);
});

// Refunds that say the money was "returned to your account" keep their
// current reading (they wait in Review today and must not start booking).
for (const [country, currency, body] of [
  ['GB', 'GBP', 'Refund: £45.00 from TESCO has been returned to your account.'],
  // (A take-back of THIS payment stays a doubt even with a modal.)
  ['GB', 'GBP', 'You received £45.00 from JOHN SMITH. This payment may be reversed.'],
  ['US', 'USD', 'A refund of $25.00 from AMAZON was returned to your account.'],
]) test(`returned-to-account refund keeps its reading (${country}): ${body.slice(0, 60)}`, () => {
  neverBooks(country, currency, body);
});

// Minor: a figure after the merchant is never part of its name.
test('a trailing figure is trimmed from a German merchant name', () => {
  const parsed = seam('Kartenzahlung 27,15 EUR bei REWE 1.234,56', 'Sparkasse', 'DE', 'EUR');
  if (parsed) {
    assert.equal(parsed.amountFils, 2715);
    assert.equal(parsed.merchant, 'REWE');
  }
});
for (const [body, merchant] of [
  ['You spent £5.00 at STORE 1234', 'STORE 1234'],
  ['Kartenzahlung 27,15 EUR bei 7-ELEVEN', '7-ELEVEN'],
]) test(`a store number stays in the merchant name: ${merchant}`, () => {
  const parsed = seam(body, body.includes('£') ? 'Monzo' : 'Sparkasse', body.includes('£') ? 'GB' : 'DE', body.includes('£') ? 'GBP' : 'EUR');
  assert.ok(parsed);
  assert.ok(String(parsed.merchant).includes(merchant), parsed.merchant);
});
