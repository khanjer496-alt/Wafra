'use strict';
// Long / adversarial bodies for the timing check. They are not graded for
// correctness, only timed: a bank alert is a few hundred bytes, so anything
// that makes one parse slow at 4-8 KB is a denial-of-service risk on a
// phone scanning thousands of messages (quadratic regex scans were found by
// the round-1 english review: "A charge of $" + 4000 digits took 7.7 s).
const KB = 1024;
const fill = (unit, bytes) => unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes);

function adversarialRows() {
  const rows = [];
  const add = (id, country, ledger, body, sender = '') => rows.push({ id: `adv:${id}`, country, ledger, sender, body, kind: 'adversarial' });
  for (const size of [4 * KB, 8 * KB]) {
    const k = `${size / KB}k`;
    add(`digits-${k}`, 'US', 'USD', `A charge of $${fill('1', size)} at SHOP.`);
    add(`grouped-${k}`, 'US', 'USD', `You made a $${fill('1,', size)}00 purchase at SHOP.`);
    add(`repeat-${k}`, 'GB', 'GBP', fill('Purchase of £1.00 at SHOP. ', size));
    add(`merchant-${k}`, 'US', 'USD', `You made a $12.00 purchase at ${fill('A', size)}.`);
    add(`de-${k}`, 'DE', 'EUR', `Kartenzahlung über ${fill('1.', size)}00 EUR bei REWE.`);
    add(`ar-${k}`, 'SA', 'SAR', fill('تم خصم 10.00 ر.س من بطاقتك لدى SHOP. ', size), 'AlRajhiBank');
    add(`spaces-${k}`, 'AE', 'AED', `Purchase of AED 5.00${fill(' \n', size)}at SHOP`, 'ADCB');
    add(`punct-${k}`, 'FR', 'EUR', `Paiement de 12,00 € chez ${fill('.,;:', size)}`);
  }
  return rows;
}

module.exports = { adversarialRows };
