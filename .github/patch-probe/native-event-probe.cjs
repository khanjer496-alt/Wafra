'use strict';
// Temporary CI probe (side branch only): the native path's event reading for the own-account refund. Synthetic bodies only.
const repo = process.argv[2];
const load = require(`${repo}/scripts/universal-test/load-ts.cjs`).createLoader();
const country = load('@/lib/country');
const markets = load('@/lib/markets');
const { inspectGenericBankEventForReview } = load('@/lib/launch-alert-parser');
country.setActiveCountry('AE'); markets.setLedgerCurrency('AED', 2); markets.setActiveMarket('AE');
for (const [name, body] of [
  ['account dotted', 'Purchase amount of AED 250.00 at NOON.COM on your account ending 1234 has been refunded.'],
  ['account plain', 'Purchase amount of AED 250.00 at NOON on your account ending 1234 has been refunded.'],
  ['card dotted', 'Purchase amount of AED 250.00 at NOON.COM on your Debit Card ending 1234 has been refunded.'],
  ['account dotted www', 'Purchase amount of AED 250.00 at WWW.NOON.COM on your account ending 1234 has been refunded.'],
  ['account dotted to account', 'Purchase amount of AED 250.00 at NOON.COM on your account ending 1234 has been refunded to your account.'],
]) {
  let e = null;
  try { e = inspectGenericBankEventForReview(body, 'ENBD'); } catch (error) { e = { error: error.message }; }
  console.log(JSON.stringify({ name, decision: e?.decision, status: e?.status, direction: e?.direction, family: e?.family,
    amount: e?.amount?.value?.minorUnits, merchant: e?.merchant?.evidence === 'explicit' ? e.merchant.value : e?.merchant?.evidence,
    instrument: e?.instrument ? JSON.stringify(e.instrument).slice(0, 120) : null, reasons: e?.reasons ?? e?.evidence ?? null, error: e?.error }));
}
