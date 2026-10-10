// Gulf neighbours: Qatar, Kuwait, Bahrain and Oman.
//
// Pins four things (see docs/universal-parser-rollout.md, "Gulf neighbours"):
//  1. money: a three-decimal own-currency figure ("KWD 12.345", "0.650 OMR")
//     is a decimal ONLY after a route to that market, never for another
//     currency, never for a comma, never for a two-decimal currency;
//  2. routing: a brand that also banks elsewhere routes only with the
//     market's own currency, and UAE launch senders keep their behaviour;
//  3. posting: a recognised institution's alert is read by the launch
//     grammar in marked best-effort mode, Bank Muscat's one documented
//     family by a certified template, everything else waits in Review;
//  4. never-post wording in English and Arabic.
// Fixtures: scripts/test/fixtures/gulf-neighbour-alert-fixtures.js (Wafra's own words).
'use strict';
const { inspectAlertDraft } = require('./build/alert-draft');
const { inspectMarketAlert } = require('./build/alert-semantics');
const { routeAlertMarket } = require('./build/alert-market-detection');
const { inspectAlertInstitutionGrammar } = require('./build/alert-institution-grammars');
const { inspectUniversalBankEvent } = require('./build/universal-parser');
const { createLaunchAlertSession } = require('./build/launch-alert-parser');
const { decideGulfNeighbourPosting, gulfNeighbourReadSource } = require('./build/gulf-neighbour-alerts');
const { readBankMuscatCardPurchase } = require('./build/gulf-neighbour-templates');
const { certifyUniversalTemplate } = require('./build/universal-template-certification');
const markets = require('./build/markets');
const country = require('./build/country');
const { POSTING, NEVER, OBSERVED } = require('./fixtures/gulf-neighbour-alert-fixtures');

let pass = 0;
let fail = 0;
function ok(name, condition, detail) {
  if (condition) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail)); }
}

const exponentOf = (currency) => (['KWD', 'BHD', 'OMR'].includes(currency) ? 3 : 2);
/** The production SMS decision for a non-launch sender: parseUnproven, or parse for a launch sender. */
const capture = (body, sender, cc, ledger, { enabled = true, fxLookup = () => null } = {}) => {
  markets.setActiveMarket(cc === 'AE' || cc === 'SA' ? cc : 'ZZ');
  markets.setLedgerCurrency(ledger, exponentOf(ledger));
  country.setActiveCountry(cc);
  try {
    const s = createLaunchAlertSession({ overrides: {}, regionHint: cc, pinnedCurrency: ledger, fxLookup,
      activeMarket: cc === 'AE' || cc === 'SA' ? cc : 'ZZ', bestEffort: { enabled, country: cc } });
    const launch = markets.detectLaunchMarketFromSender(sender);
    const inspection = s.inspect(body, sender);
    return launch ? s.parse(body, sender, inspection, launch, OBSERVED) : s.parseUnproven(body, sender, inspection, OBSERVED);
  } finally {
    markets.setLedgerCurrency(null); country.setActiveCountry(null); markets.setActiveMarket('AE');
  }
};
const primary = (review) => review.primaryCandidateIndex === null ? null : review.draft.candidates[review.primaryCandidateIndex];

/* ── 1. Money: three decimals, both directions ─────────────────────────── */
{
  const routed = inspectAlertDraft('KWD 12.345 debited', { dotDecimalCurrencies: ['KWD'] }).candidates[0];
  const unrouted = inspectAlertDraft('KWD 12.345 debited').candidates[0];
  ok('routed KWD 12.345 is 12.345 KWD (12345 thousandths), never twelve thousand',
    routed.minorUnits === '12345' && routed.exponent === 3 && routed.ambiguities.length === 0, routed);
  ok('the same figure with no route keeps both readings for Review',
    unrouted.minorUnits === null && unrouted.ambiguities.includes('decimal-or-grouping'), unrouted);
  const usd = inspectAlertDraft('USD 1.250 debited', { dotDecimalCurrencies: ['KWD'] }).candidates[0];
  ok('another currency on a Kuwaiti route keeps its own ambiguity (USD 1.250)',
    usd.minorUnits !== '125' && usd.currency === 'USD' && usd.minorUnits === '125000', usd);
  const comma = inspectAlertDraft('KWD 12,500 debited', { dotDecimalCurrencies: ['KWD'] }).candidates[0];
  ok('a comma-written KWD figure stays ambiguous even when routed',
    comma.minorUnits === null && comma.ambiguities.includes('decimal-or-grouping'), comma);
  const repeated = inspectAlertDraft('KWD 1.234.500 debited', { dotDecimalCurrencies: ['KWD'] }).candidates[0];
  ok('repeated full stops stay ambiguous even when routed',
    !repeated || repeated.minorUnits === null, repeated);
  const grouped = inspectAlertDraft('KWD 1,234.500 debited', { dotDecimalCurrencies: ['KWD'] }).candidates[0];
  ok('KWD 1,234.500 is 1234500 thousandths', grouped.minorUnits === '1234500', grouped);

  const kw = primary(inspectMarketAlert('Card purchase KWD 12.345 was debited at SAMPLE SHOP', 'KW'));
  ok('the Kuwait pack reads KWD 12.345 as 12345 thousandths', kw?.minorUnits === '12345' && kw.exponent === 3, kw);
  const kd = primary(inspectMarketAlert('Card purchase KD 12.345 was debited at SAMPLE SHOP', 'KW'));
  ok('the Kuwait pack reads KD 12.345 the same way', kd?.currency === 'KWD' && kd.minorUnits === '12345', kd);
  const bh = primary(inspectMarketAlert('Card purchase BD 4.250 was debited at SAMPLE SHOP', 'BH'));
  ok('the Bahrain pack reads BD 4.250 as 4250 thousandths', bh?.currency === 'BHD' && bh.minorUnits === '4250', bh);
  const om = primary(inspectMarketAlert('Card purchase 0.650 OMR was debited at SAMPLE SHOP', 'OM'));
  ok('the Oman pack reads 0.650 OMR as 650 thousandths', om?.currency === 'OMR' && om.minorUnits === '650', om);
  const kwInBh = primary(inspectMarketAlert('Card purchase KWD 12.345 was debited at SAMPLE SHOP', 'BH'));
  ok('a Bahrain route does not settle a Kuwaiti dinar figure', kwInBh?.minorUnits !== '12345', kwInBh);
  const qa = primary(inspectMarketAlert('Card purchase QAR 12.345 was debited at SAMPLE SHOP', 'QA'));
  ok('a Qatar route never reads a three-digit tail as a riyal decimal', qa?.minorUnits !== '1234' && qa?.minorUnits !== '12345', qa);
  const qr = primary(inspectMarketAlert('Card purchase QR 150.00 was debited at SAMPLE SHOP', 'QA'));
  ok('QR 150.00 is QAR 15000 after a Qatar route', qr?.currency === 'QAR' && qr.minorUnits === '15000', qr);
  ok('"QR" with no figure is never money',
    inspectMarketAlert('Pay by QR at SAMPLE SHOP', 'QA').draft.candidates.length === 0);

  const eventOm = inspectUniversalBankEvent('تم خصم 0.650 OMR من حسابك لدى SAMPLE SHOP', { market: 'OM' });
  const eventNone = inspectUniversalBankEvent('تم خصم 0.650 OMR من حسابك لدى SAMPLE SHOP');
  ok('the universal reader routed to Oman makes 0.650 OMR explicit',
    eventOm.amount.evidence === 'explicit' && eventOm.amount.value?.minorUnits === '650', eventOm.amount);
  ok('the universal reader with no route keeps 0.650 OMR ambiguous',
    eventNone.amount.evidence === 'ambiguous', eventNone.amount);
  ok('route-scoped spellings are rewritten only beside a figure',
    gulfNeighbourReadSource('KD 5.000 at QR CODE CAFE', 'KW') === 'KWD 5.000 at QR CODE CAFE' &&
      gulfNeighbourReadSource('Pay by QR at SAMPLE', 'QA') === 'Pay by QR at SAMPLE' &&
      gulfNeighbourReadSource('50.000 دينار كويتي', 'KW') === '50.000 KWD' &&
      gulfNeighbourReadSource('ريال سعودي 50.00', 'QA') === 'ريال سعودي 50.00');
}

/* ── 2. Routing ──────────────────────────────────────────────────────────── */
{
  const route = (source, sender) => routeAlertMarket({ source, sender });
  ok('QNB with QAR routes Qatar', route('Purchase of QAR 15.00 at SAMPLE SHOP', 'QNB').market === 'QA');
  ok('QNB with EGP is never Qatar (QNB Egypt)', route('Purchase of EGP 250.00 at SAMPLE SHOP', 'QNB').market !== 'QA');
  ok('NBK with KWD routes Kuwait', route('Purchase of KWD 1.500 at SAMPLE SHOP', 'NBK').market === 'KW');
  ok('NBK with EGP is never Kuwait (NBK Egypt)', route('Purchase of EGP 250.00 at SAMPLE SHOP', 'NBK').market !== 'KW');
  ok('KFH with BHD is never Kuwait', route('Purchase of BHD 1.500 at SAMPLE SHOP', 'KFH').market !== 'KW');
  ok('a Kuwait Finance House body with BHD routes Bahrain',
    route('Kuwait Finance House: BHD 4.250 debited from A/C XX1234 at SAMPLE SHOP.', '').market === 'BH');
  ok('a Kuwait Finance House body with KWD routes Kuwait',
    route('Kuwait Finance House: KWD 4.250 debited from A/C XX1234 at SAMPLE SHOP.', '').market === 'KW');
  ok('BBK with KWD is never Bahrain', route('Purchase of KWD 1.500 at SAMPLE SHOP', 'BBK').market !== 'BH');
  ok('Ahli United Bank body alone is not Bahraini evidence',
    inspectAlertInstitutionGrammar('Ahli United Bank: EGP 250.00 debited.', 'BH').decision === 'unknown');
  ok('HSBC Oman body with OMR is Omani evidence',
    inspectAlertInstitutionGrammar('HSBC Oman: OMR 4.250 debited.', 'OM').institution === 'hsbc-oman');
  // Citi sends as "CITI" in the US and the Gulf: Gulf-neighbour money is not a US alert.
  ok('a CITI alert in BHD is not routed to the US by sender name',
    route('Purchase of BHD 4.250 with card ending 1234 at SAMPLE SHOP.', 'CITI').market !== 'US');
  ok('a Citibank alert in KWD is not routed to the US by sender name',
    route('Purchase of KWD 4.250 with card ending 1234 at SAMPLE SHOP.', 'Citibank').market !== 'US');
  ok('a CITI alert in USD still routes to the US',
    route('Purchase of USD 4.25 with card ending 1234 at SAMPLE SHOP.', 'CITI').market === 'US');
  ok('a CITI alert stating both USD and QAR keeps its US route',
    route('Purchase of USD 4.25 (QAR 15.47) with card ending 1234 at SAMPLE SHOP.', 'CITI').market === 'US');
  ok('a StanChart sender with QAR is not a Qatari institution (no route by name)',
    route('Purchase of QAR 42.50 with card ending 1234 at SAMPLE SHOP.', 'StanChart').decision !== 'single');
  ok('an HSBC sender alone is never Omani evidence',
    inspectAlertInstitutionGrammar('OMR 4.250 debited.', 'OM', 'HSBC').decision === 'unknown');
  for (const [market, name, currency, institution] of [
    ['QA', 'Doha Bank', 'QAR 15.00', 'doha-bank'], ['QA', 'Masraf Al Rayan', 'QAR 15.00', 'masraf-al-rayan'],
    ['QA', 'Dukhan Bank', 'QAR 15.00', 'dukhan-bank'], ['KW', 'Gulf Bank', 'KWD 1.500', 'gulf-bank-kuwait'],
    ['KW', 'Burgan Bank', 'KWD 1.500', 'burgan-bank'], ['KW', 'Warba Bank', 'KWD 1.500', 'warba-bank'],
    ['KW', 'Commercial Bank of Kuwait', 'KWD 1.500', 'commercial-bank-of-kuwait'],
    ['BH', 'Bahrain Islamic Bank', 'BHD 1.500', 'bahrain-islamic-bank'], ['BH', 'Ahli United Bank', 'BHD 1.500', 'ahli-united-bank'],
    ['OM', 'National Bank of Oman', 'OMR 1.500', 'national-bank-of-oman'], ['OM', 'Bank Nizwa', 'OMR 1.500', 'bank-nizwa'],
  ]) {
    const result = inspectAlertInstitutionGrammar(`${name}: ${currency} debited from A/C XX1234.`, market);
    ok(`${market}: ${name} is a body identity`, result.institution === institution, result);
  }
  // UAE launch senders keep their route and behaviour (pinned, unchanged).
  for (const sender of ['ADIB', 'Mashreq', 'EmiratesNBD', 'FAB', 'ADCB']) {
    ok(`${sender} stays a UAE launch sender`, markets.detectLaunchMarketFromSender(sender) === 'AE');
  }
  const adibQar = capture('Purchase of QAR 150.00 with Debit Card ending 1234 at SAMPLE MARKET on 05/10/2026.', 'ADIB', 'AE', 'AED');
  ok('pinned: an ADIB QAR purchase on an AED ledger posts as before (launch grammar, AED 151.34, unmarked)',
    adibQar?.amountFils === 15134 && adibQar.currency === 'AED' && adibQar.originalCurrency === 'QAR' && !adibQar.bestEffort, adibQar);
  const mashreqKwd = capture('Purchase of KWD 12.345 with Debit Card ending 1234 at SAMPLE SHOP on 05/10/2026.', 'Mashreq', 'KW', 'KWD');
  ok('pinned: a Mashreq KWD purchase on a KWD ledger is not posted (launch senders are never best-effort)', mashreqKwd === null, mashreqKwd);
}

/* ── 3. Posting tiers ─────────────────────────────────────────────────────── */
for (const row of POSTING) {
  const parsed = capture(row.text, row.sender, row.market, row.ledger);
  const tierOk = row.expect === 'certified' ? parsed && !parsed.bestEffort
    : parsed?.bestEffort?.market === row.market && /^universal:[a-z-]+:(?:debit|credit)$/.test(parsed.bestEffort.format);
  ok(`${row.id} (${row.provenance}): ${row.expect} ${row.type} ${row.minor} ${row.ledger}`,
    parsed?.kind === 'transaction' && tierOk && parsed.type === row.type && parsed.amountFils === row.minor &&
      parsed.currency === row.ledger && parsed.date === row.date &&
      (row.merchant === undefined || parsed.merchant === row.merchant) &&
      (row.last4 === undefined || parsed.card?.last4 === row.last4) &&
      parsed.originalCurrency === undefined && parsed.snapshotFils === null, parsed);
}
{
  const [kw] = POSTING;
  ok('the best-effort setting off sends a neighbour alert to Review',
    capture(kw.text, kw.sender, kw.market, kw.ledger, { enabled: false }) === null);
  const bm = POSTING.find((row) => row.id === 'om-bm1-suffix');
  ok('the setting off also holds a certified Bank Muscat alert (SMS outside AE/SA)',
    capture(bm.text, bm.sender, bm.market, bm.ledger, { enabled: false }) === null);
  ok('a KWD alert on an AED ledger with no dated rate waits in Review',
    capture(kw.text, kw.sender, 'AE', 'AED') === null);
  const rate = { base: 'KWD', quote: 'AED', rate: 11.95, date: '2026-10-05' };
  const converted = capture(kw.text, kw.sender, 'AE', 'AED', { fxLookup: (b, q) => (b === 'KWD' && q === 'AED' ? rate : null) });
  ok('with a dated rate it posts in AED, marked, keeping KWD 12.345 exactly',
    converted?.currency === 'AED' && converted.amountFils === 14752 && converted.originalCurrency === 'KWD' &&
      converted.originalMinorUnits === 12345 && converted.originalExponent === 3 && converted.fxSource === 'reference' &&
      !!converted.bestEffort, converted);
  // Bank Muscat's template with no sender is not certified: no route at all.
  ok('a Bank Muscat-shaped alert with no sender is not posted (no route)',
    capture(bm.text, '', bm.market, bm.ledger) === null);
  // An extra sentence breaks the exact template; the grammar may still read it, marked.
  const tail = capture(`${bm.text} للاستفسار اتصل بنا`, bm.sender, bm.market, bm.ledger);
  ok('a Bank Muscat alert with extra text is never certified', !tail || !!tail.bestEffort, tail);
  ok('the template refuses an invalid calendar date',
    readBankMuscatCardPurchase(bm.text.replace('2026/10/02', '2026/02/30')) === null);
  ok('the template refuses a two-decimal amount',
    readBankMuscatCardPurchase(bm.text.replace('0.750 OMR', '0.75 OMR')) === null);
  ok('the template refuses a currency on both sides',
    readBankMuscatCardPurchase(bm.text.replace('0.750 OMR', 'OMR 0.750 OMR')) === null);
  // Direct policy: a route with no recognised institution is not this path's.
  ok('no recognised institution leaves the generic policy in charge',
    decideGulfNeighbourPosting({ source: kw.text, sender: '', routedMarket: 'KW', institution: null, enabled: true,
      ledgerCurrency: 'KWD', ledgerExponent: 3, observedAt: OBSERVED, fxLookup: () => null }).outcome === 'not-applicable');
  ok('a non-neighbour route is not this path\'s',
    decideGulfNeighbourPosting({ source: kw.text, sender: 'NBK', routedMarket: 'EG', institution: { id: 'x', sender: true },
      enabled: true, ledgerCurrency: 'KWD', ledgerExponent: 3, observedAt: OBSERVED, fxLookup: () => null }).outcome === 'not-applicable');
}
{
  // Certification registry: the Bank Muscat rule is exact and institution-scoped.
  const bm = POSTING.find((row) => row.id === 'om-bm1-prefix');
  const certify = (source, institution) => certifyUniversalTemplate({
    market: 'OM', institution, source, event: inspectUniversalBankEvent(source, { market: 'OM' }),
  });
  const certified = certify(bm.text, 'bank-muscat');
  ok('OM-BM-1 certifies at Bank Muscat', certified.decision === 'automatic' &&
    certified.templateId === 'om-bank-muscat-card-purchase-v1', certified);
  ok('OM-BM-1 never certifies for another Omani bank', certify(bm.text, 'bank-dhofar').decision !== 'automatic');
  ok('OM-BM-1 never certifies with text after the balance',
    certify(`${bm.text} عرض خاص`, 'bank-muscat').decision !== 'automatic');
}

/* ── 4. Never-post wording (English and Arabic) ──────────────────────────── */
for (const row of NEVER) {
  const parsed = capture(row.text, row.sender, row.market, row.ledger);
  ok(`never posted: ${row.id}`, parsed === null, parsed);
}

console.log(`\ngulf-neighbour-alerts: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
