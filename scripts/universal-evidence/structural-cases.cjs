// Authored expected numbers, independent of production currency metadata.
// These are format stress tests, NOT specimens from 30 banks or countries.
const currencies = [
  ['USD',2],['CAD',2],['AUD',2],['NZD',2],['GBP',2],['EUR',2],['CHF',2],['PLN',2],['TRY',2],['BRL',2],
  ['MXN',2],['ARS',2],['ZAR',2],['NGN',2],['KES',2],['GHS',2],['INR',2],['PKR',2],['BDT',2],['LKR',2],
  ['SGD',2],['MYR',2],['THB',2],['PHP',2],['IDR',2],['HKD',2],['CNY',2],['JPY',0],['KRW',0],['KWD',3],
];
module.exports = () => currencies.flatMap(([currency, exponent]) => {
  const literal = exponent === 0 ? '1274' : exponent === 3 ? '12.740' : '12.74';
  const minorUnits = exponent === 0 ? '1274' : exponent === 3 ? '12740' : '1274';
  const balanceLiteral = exponent === 0 ? '9300' : exponent === 3 ? '93.000' : '93.00';
  const balanceMinor = exponent === 0 ? '9300' : exponent === 3 ? '93000' : '9300';
  const base = `Card purchase ${currency} ${literal} at CEDAR CAFE on 2026-09-05. Available balance ${currency} ${balanceLiteral}.`;
  const variants = {
    original: base, lowercase: base.toLowerCase(), uppercase: base.toUpperCase(),
    newline: base.replace('. Available', '.\nAvailable'),
    nbsp: base.replace(/ /g, '\u00a0'),
    arabicDigits: base.replace(/\d/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]),
  };
  return Object.entries(variants).map(([variant, body]) => ({ id: `structural-${currency}-${variant}`, currency, body,
    expected: { 'amount.value': { currency, minorUnits, exponent },
      'balance.value': { currency, minorUnits: balanceMinor, exponent },
      status: 'posted', direction: 'debit', 'transactionDate.value': '2026-09-05' } }));
});
