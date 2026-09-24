const assert = require('assert');
const {
  inferCaptureMarket,
  routeAlertMarket,
  inspectUniversalAlert,
} = require('./build/alert-market-detection.js');
const { createLaunchAlertSession, REVIEW_MONEY_HINT } = require('./build/launch-alert-parser.js');
const { detectLaunchMarketFromSender } = require('./build/markets.js');
const uaeFixtures = require('./fixtures/uae-bank-formats.js');
const saudiFixtures = require('./fixtures/saudi-bank-formats.js');

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

for (const [market, source] of [
  ['CA', 'Interac e-Transfer CAD 20.00 was credited to your account.'],
  ['AU', 'Osko AUD 20.00 was credited to your account.'],
  ['BR', 'Pix BRL 20,00 creditado na sua conta.'],
  ['MX', 'SPEI MXN 20.00 abonado en tu cuenta.'],
  ['SG', 'PayNow SGD 20.00 was credited to your account.'],
]) {
  const route = routeAlertMarket({ source });
  ok(`${market}: unique currency plus local rail resolves without locale guessing`,
    route.decision === 'single' && route.market === market, JSON.stringify(route));
}

// A domestic rail without that market's own currency, or a second-wave
// currency without a rail/institution, never invents a route.
for (const source of [
  'PayNow USD 20.00 was credited to your account.',
  'Card purchase CAD 20.00 completed at SAMPLE SHOP.',
  'Card purchase SGD 20.00 completed at SAMPLE SHOP.',
]) {
  const route = routeAlertMarket({ source });
  ok(`second-wave evidence alone stays unresolved: ${source}`,
    route.decision !== 'single', JSON.stringify(route));
}

// Multinational brands shared with a supported market need country-qualified
// evidence; otherwise a US/Spanish alert could be read in a second-wave market.
for (const [source, sender, expected] of [
  ['TD Bank: Card purchase USD 20.00 at SAMPLE completed', 'TDBANK', null],
  ['BMO: Card purchase USD 20.00 at SAMPLE completed', 'BMO', null],
  ['BBVA compra con tarjeta EUR 14,20 en EJEMPLO cargado.', 'BBVA', 'ES'],
  ['BBVA México compra con tarjeta MXN 14.20 en EJEMPLO.', 'BBVAMEXICO', 'MX'],
  ['Scotiabank: compra MXN 200.00 en TIENDA.', '', null],
  ['TD Canada Trust: CAD 20.00 debited from your account.', 'TDCANADATRUST', 'CA'],
  ['DBS Bank India: INR 500.00 debited from a/c XX12 via UPI to SWIGGY', 'AD-DBSBNK-S', 'IN'],
]) {
  const route = routeAlertMarket({ source, sender });
  ok(`shared brand routing stays country-qualified: ${source}`,
    expected === null
      ? !['CA', 'AU', 'BR', 'MX', 'SG'].includes(route.market)
      : route.decision === 'single' && route.market === expected,
    JSON.stringify(route));
}

// First-wave routes are unchanged by the new currencies/rails.
for (const [source, sender, market] of [
  ['Chase Bank: Card purchase USD 18.50 at TARGET completed', 'CHASE', 'US'],
  ['UPI payment of INR 500.00 successful', '', 'IN'],
  ['EUR 24,90 wurde mit Ihrer Karte bezahlt und vom Konto abgebucht', '', 'DE'],
]) {
  const route = routeAlertMarket({ source, sender });
  ok(`first-wave route unchanged: ${market}`,
    route.decision === 'single' && route.market === market, JSON.stringify(route));
}
ok('a UAE alert quoting a CAD merchant name keeps its Gulf sender route',
  routeAlertMarket({ source: 'AED 250.00 spent at CAD 3 TRADING LLC with Credit Card 1234', sender: 'ADCB' }).market === 'AE');

// A bare `$` is dollar evidence only inside the market it was routed to.
{
  const ca = inspectUniversalAlert({ source: 'RBC: Card purchase $20.00 at SAMPLE SHOP was charged.', sender: 'RBC' });
  const us = inspectUniversalAlert({ source: 'Chase Bank: Card purchase $20.00 at SAMPLE SHOP was charged.', sender: 'CHASE' });
  const mx = inspectUniversalAlert({ source: 'Banorte: compra $1,250.00 SUPERMERCADO. Tarjeta terminación 1234.', sender: 'BANORTE' });
  const primary = (inspection) => inspection.review?.draft.candidates[inspection.review.primaryCandidateIndex ?? -1];
  ok('$ in a Canada-routed alert is CAD', primary(ca)?.currency === 'CAD' && primary(ca)?.minorUnits === '2000', JSON.stringify(primary(ca)));
  ok('$ in a US-routed alert is still USD', primary(us)?.currency === 'USD' && primary(us)?.minorUnits === '2000', JSON.stringify(primary(us)));
  ok('$ in a Mexico-routed alert is MXN', primary(mx)?.currency === 'MXN' && primary(mx)?.minorUnits === '125000', JSON.stringify(primary(mx)));
  const unrouted = routeAlertMarket({ source: 'Card purchase $20.00 at SAMPLE SHOP was charged.', regionHint: 'en-CA' });
  ok('a bare $ with only a Canadian region hint never routes', unrouted.decision !== 'single', JSON.stringify(unrouted));
}

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

ok('launch sender routing is exact and refuses overlapping or unknown identities',
  detectLaunchMarketFromSender('ADCB') === 'AE' &&
    detectLaunchMarketFromSender('ALRAJHI') === 'SA' &&
    detectLaunchMarketFromSender('ADCB ALRAJHI') === null &&
    detectLaunchMarketFromSender('CAPITALONE') === null);

// Differential safety gate for the launch-sender fast path. The reference
// deliberately forces the full universal inspection that capture used before
// the optimization; every parsed field must remain deeply identical.
const differentialCases = [
  ...uaeFixtures.map((fixture) => ({
    source: fixture.body,
    sender: fixture.bank,
    activeMarket: 'AE',
  })),
  ...saudiFixtures.map((fixture) => ({
    source: fixture.body,
    sender: fixture.bank,
    activeMarket: 'SA',
  })),
  {
    source: 'Chase Bank: Card purchase USD 18.50 at TARGET completed',
    sender: 'CHASE',
    activeMarket: 'AE',
  },
  {
    source: 'BNP Paribas: Paiement par carte débité de EUR 12,34 chez CAFE',
    sender: 'BNPPARIBAS',
    activeMarket: 'AE',
  },
  {
    source: 'ADCB: Purchase of USD 9.99 (AED 36.70) at APPLE with card ending 1234',
    sender: 'ADCB',
    activeMarket: 'AE',
  },
  {
    source: 'HSBC UK: Card purchase GBP 18.50 completed',
    sender: 'HSBC',
    activeMarket: 'AE',
  },
];
let differentialMatch = true;
let differentialFailure = '';
for (const row of differentialCases) {
  const fast = createLaunchAlertSession({ overrides: {}, activeMarket: row.activeMarket });
  const reference = createLaunchAlertSession({ overrides: {}, activeMarket: row.activeMarket });
  const fastInspection = fast.inspect(row.source, row.sender);
  const referenceInspection = REVIEW_MONEY_HINT.test(row.source)
    ? inspectUniversalAlert({ source: row.source, sender: row.sender, regionHint: null })
    : null;
  const actual = fast.parse(row.source, row.sender, fastInspection);
  const expected = reference.parse(row.source, row.sender, referenceInspection);
  try {
    assert.deepStrictEqual(actual, expected);
  } catch (error) {
    differentialMatch = false;
    differentialFailure = `${row.sender}: ${error.message}`;
    break;
  }
}
ok('optimized launch routing preserves every parser output field',
  differentialMatch, differentialFailure);

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
