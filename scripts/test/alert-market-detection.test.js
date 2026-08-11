const {
  inferCaptureMarket,
  routeAlertMarket,
  inspectUniversalAlert,
} = require('./build/alert-market-detection.js');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail) => {
  if (condition) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name}`, detail ?? ''); }
};

const uaeAbroad = routeAlertMarket({
  source: 'Your card was charged USD 25.00 at NEW YORK STORE',
  sender: 'ADCB',
  regionHint: 'US',
});
ok('bank sender outranks region and foreign transaction currency',
  uaeAbroad.decision === 'single' && uaeAbroad.market === 'AE', JSON.stringify(uaeAbroad));

const india = inspectUniversalAlert({
  source: 'आपके HDFC Bank कार्ड से INR 1,250.00 डेबिट किया गया',
  sender: 'VM-HDFCBK',
  regionHint: 'AE',
});
ok('Indian DLT bank evidence overrides an expatriate region hint',
  india.route.market === 'IN' && india.review?.status === 'posted', JSON.stringify(india));

const germany = inspectUniversalAlert({
  source: 'EUR 24,90 wurde mit Ihrer Karte bezahlt und vom Konto abgebucht',
  regionHint: 'DE',
});
ok('compatible EUR plus localized grammar resolves Germany',
  germany.route.decision === 'single' && germany.route.market === 'DE' &&
    germany.review?.decision === 'review', JSON.stringify(germany));

const euroUnknown = routeAlertMarket({ source: 'Card payment EUR 24.90 completed' });
ok('EUR alone never invents a European country',
  euroUnknown.decision === 'ambiguous' && euroUnknown.market === null,
  JSON.stringify(euroUnknown));

const usForeignRegion = inspectUniversalAlert({
  source: 'Chase Bank: Card purchase USD 18.50 at TARGET completed',
  sender: 'CHASE',
  regionHint: 'DE',
});
ok('institution evidence overrides a conflicting European region hint',
  usForeignRegion.route.market === 'US' && usForeignRegion.review?.family === 'purchase',
  JSON.stringify(usForeignRegion));

const indiaNoRegion = routeAlertMarket({ source: 'UPI payment of INR 500.00 successful' });
ok('currency plus market-specific rail resolves India without a region hint',
  indiaNoRegion.decision === 'single' && indiaNoRegion.market === 'IN',
  JSON.stringify(indiaNoRegion));

const regionOnly = routeAlertMarket({
  source: 'Welcome to your new account',
  regionHint: 'GB',
});
ok('region hint alone cannot create a market route',
  regionOnly.decision === 'unknown' && regionOnly.market === null, JSON.stringify(regionOnly));

const overlappingHsbc = routeAlertMarket({
  source: 'HSBC: Card purchase GBP 18.50 completed',
  sender: 'HSBC',
  regionHint: 'GB',
});
ok('an overlapping international bank sender remains ambiguous',
  overlappingHsbc.decision === 'ambiguous' && overlappingHsbc.market === null,
  JSON.stringify(overlappingHsbc));

const senderBodyConflict = routeAlertMarket({
  source: 'Transfer to Bank of America completed for USD 20.00',
  sender: 'WELLSFARGO',
});
ok('sender and body institution conflict never picks a side',
  senderBodyConflict.decision === 'ambiguous' && senderBodyConflict.market === null,
  JSON.stringify(senderBodyConflict));

const unknown = routeAlertMarket({ source: 'Your verification code is 123456' });
ok('no region evidence remains unknown',
  unknown.decision === 'unknown' && unknown.market === null, JSON.stringify(unknown));

const privateResult = routeAlertMarket({
  source: 'Chase Bank: Card purchase USD 18.50 at TARGET completed',
  sender: 'CHASE-PRIVATE-123',
  regionHint: 'US',
});
ok('route result never retains source or sender',
  !JSON.stringify(privateResult).includes('TARGET') &&
    !JSON.stringify(privateResult).includes('PRIVATE'),
  JSON.stringify(privateResult));

const autoUs = inferCaptureMarket({
  regionHint: 'US',
  alerts: [{
    sourceKey: 'automatic_market_key_001', sender: 'CHASE',
    source: 'Chase Bank: Card purchase USD 18.50 at TARGET completed',
  }],
});
ok('one region/currency/sender-aligned alert resolves automatically',
  autoUs.decision === 'resolved' && autoUs.market === 'US', JSON.stringify(autoUs));

const autoIndia = inferCaptureMarket({
  regionHint: 'AE',
  alerts: [
    { sourceKey: 'automatic_market_key_002', sender: 'VM-HDFCBK', source: 'HDFC Bank UPI payment INR 500.00 successful' },
    { sourceKey: 'automatic_market_key_003', sender: 'VM-HDFCBK', source: 'HDFC Bank card purchase INR 250.00 completed' },
  ],
});
ok('two independent alerts resolve an expatriate market without asking',
  autoIndia.decision === 'resolved' && autoIndia.market === 'IN', JSON.stringify(autoIndia));

const duplicateEvidence = inferCaptureMarket({
  regionHint: 'AE',
  alerts: [
    { sourceKey: 'automatic_market_key_004', sender: 'VM-HDFCBK', source: 'HDFC Bank UPI payment INR 500.00 successful' },
    { sourceKey: 'automatic_market_key_004', sender: 'VM-HDFCBK', source: 'HDFC Bank UPI payment INR 500.00 successful' },
  ],
});
ok('a duplicate alert cannot manufacture consensus',
  duplicateEvidence.decision === 'provisional' && duplicateEvidence.market === 'IN',
  JSON.stringify(duplicateEvidence));

const regionProvisional = inferCaptureMarket({ regionHint: 'DE', alerts: [] });
ok('a fresh install uses region only as an unpinned provisional hint',
  regionProvisional.decision === 'provisional' && regionProvisional.market === 'DE',
  JSON.stringify(regionProvisional));

console.log(`\nalert-market-detection: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
