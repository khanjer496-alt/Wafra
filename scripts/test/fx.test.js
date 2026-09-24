const {
  buildReferenceFxUpdates,
  convertOriginalMinorToLocalFils,
  fetchReferenceQuote,
  formatOriginalCurrency,
  referenceQuoteUrl,
} = require('./build/fx.js');

let pass = 0;
let fail = 0;
function ok(name, condition, detail) {
  if (condition) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  ok(
    'dated quote URL encodes only a validated pair and day',
    referenceQuoteUrl('usd', 'aed', '2026-07-10') ===
      'https://api.frankfurter.dev/v2/rate/USD/AED?date=2026-07-10',
  );
  ok('minor-unit conversion rounds once', convertOriginalMinorToLocalFils(1999, 3.6725) === 7341);

  const fakeFetch = async (url, init) => {
    ok('quote requests JSON without ledger data', init.headers.accept === 'application/json');
    ok('quote URL contains no merchant or account', !String(url).includes('Careem'));
    return {
      ok: true,
      status: 200,
      json: async () => ({ base: 'USD', quote: 'AED', rate: 3.6725, date: '2026-07-09' }),
    };
  };
  const quote = await fetchReferenceQuote('USD', 'AED', '2026-07-10', fakeFetch);
  ok('provider effective date is retained', quote.date === '2026-07-09');
  ok('provider rate is validated', quote.rate === 3.6725);

  const base = {
    type: 'expense',
    category: 'travel',
    accountId: 'card',
    title: 'Hotel',
    date: '2026-07-10',
    amountFils: 1,
  };
  const txs = [
    {
      ...base,
      id: 'fallback',
      originalCurrency: 'USD',
      originalAmountMinor: 2000,
      fxSource: 'fallback',
    },
    {
      ...base,
      id: 'bank',
      originalCurrency: 'USD',
      originalAmountMinor: 2000,
      fxSource: 'bank',
      amountFils: 7400,
    },
    { ...base, id: 'local', amountFils: 1000 },
  ];
  let calls = 0;
  const updates = await buildReferenceFxUpdates(txs, 'AED', async (from, to, date) => {
    calls += 1;
    return { base: from, quote: to, date, rate: 3.6725 };
  });
  ok('only fallback conversions are revalued', updates.length === 1 && updates[0].id === 'fallback');
  ok('bank local equivalent is never overwritten', !updates.some((u) => u.id === 'bank'));
  ok('one pair/day makes one request', calls === 1);
  ok('updated local amount is exact to one fils', updates[0].amountFils === 7345);
  ok('currency formatting retains original code', /USD/.test(formatOriginalCurrency(2000, 'USD', 'en')));

  // ── Foreign means "not the local currency" ─────────────────────────────
  //
  // fx-summary.ts was absent from build.sh's module list, so nothing in the
  // gate compiled it, let alone ran it. Requiring it here is half the fix; the
  // other half is the comparison it never made. Every row carrying an
  // `originalCurrency` counted as foreign, including rows whose original
  // currency IS the local one — which the parser produces whenever a bank
  // states its own currency explicitly. The screen then printed the row's
  // stored `amountFils` (the LOCAL-currency figure) beside the original under
  // the same three letters: two numbers, both labelled SAR, that disagree.
  const { summarizeForeignActivity } = require('./build/fx-summary.js');
  const charge = (id, currency, originalMinor, amountFils) => ({
    id, type: 'expense', amountFils, category: 'shopping', accountId: 'a1',
    title: 'Charge', date: '2026-07-10', originalCurrency: currency,
    originalAmountMinor: originalMinor, fxSource: 'bank',
  });
  const mixed = [
    charge('usd', 'USD', 10000, 36725),
    charge('sar', 'SAR', 10000, 9790),
    charge('aed', 'AED', 10000, 10000),
  ];
  const underAE = summarizeForeignActivity(mixed, () => true, 'AED');
  ok('a charge in the local currency is not foreign activity',
    underAE.groups.map((g) => g.currency).join(',') === 'USD,SAR');
  ok('and it is not in the converted total either',
    underAE.totalLocalFils === 36725 + 9790);
  const underSA = summarizeForeignActivity(mixed, () => true, 'SAR');
  ok('switching the market moves which currency counts as local',
    underSA.groups.map((g) => g.currency).join(',') === 'USD,AED');
  ok('the local-currency comparison is case-insensitive',
    summarizeForeignActivity([charge('l', 'aed', 10000, 10000)], () => true, 'AED')
      .transactions.length === 0);
  // The default reads the LEDGER's currency, which with no money recorded is
  // the active market pack — what the screen relied on before the pin existed.
  const {
    canSelectMarket,
    getActiveMarket,
    ledgerCurrencyCode,
    setActiveMarket,
    setLedgerCurrency,
  } = require('./build/markets.js');
  setLedgerCurrency(null);
  setActiveMarket('SA');
  ok('with no argument the active market decides what is local',
    summarizeForeignActivity(mixed).groups.map((g) => g.currency).join(',') === 'USD,AED');
  setActiveMarket('AE');
  ok('and back again under the AE pack',
    summarizeForeignActivity(mixed).groups.map((g) => g.currency).join(',') === 'USD,SAR');
  // Everything the summary already did, still done.
  ok('groups still order by local value, largest first',
    underAE.groups[0].currency === 'USD' && underAE.groups[0].localFils === 36725);
  ok('conversion-quality counts still add up',
    underAE.bankQuotedCount === 2 && underAE.referenceCount === 0 && underAE.estimatedCount === 0);
  ok('transfers and income are still excluded',
    summarizeForeignActivity(
      [{ ...charge('t', 'USD', 10000, 36725), isTransfer: true },
       { ...charge('i', 'USD', 10000, 36725), type: 'income' }],
      () => true, 'AED',
    ).transactions.length === 0);

  // ── A country change must not relabel money nothing converted ──────────
  //
  // `marketId` answered two questions at once: which bank vocabulary the
  // parser matches, and what currency the stored fils ARE. Switching country
  // in Settings swapped both, and only the first is a preference — one USD
  // 100.00 charge stored as 36730 fils printed "AED 367" before the switch and
  // "SAR 367" after it, on the same untouched row. formatAED(46520) returned
  // "AED 465" under AE and "SAR 465" under SA with nothing converted in
  // between, and on this very screen that figure sits under a heading reading
  // "Converted total".
  //
  // Converting is not the fix: there is no per-row rate into the new currency,
  // a historical row's rate on its own day is not knowable offline, and the
  // pass would rewrite every figure the user ever recorded with no undo. So
  // the ledger pins its own currency and a differently-denominated pack is
  // refused. See markets.ts.
  const { formatAED } = require('./build/format.js');

  setLedgerCurrency(null);
  setActiveMarket('AE');
  ok('an empty ledger still follows the pack it picks',
    setActiveMarket('SA') === true && formatAED(46520, { decimals: false }) === 'SAR 465.20');
  setActiveMarket('AE');

  setLedgerCurrency('AED');
  ok('parser market can change independently from the ledger currency',
    setActiveMarket('SA') === true && getActiveMarket().id === 'SA');
  ok('changing parser market never relabels stored money',
    formatAED(46520, { decimals: false }) === 'AED 465.20');
  ok('both verified parser packs remain selectable with a global ledger',
    canSelectMarket('SA') === true && canSelectMarket('AE') === true);
  ok('switching back changes parser vocabulary only',
    setActiveMarket('AE') === true && getActiveMarket().id === 'AE');

  // The screen calls "foreign" whatever is not the LEDGER's currency, so an
  // AED ledger sitting under an SA pack must not start filing its own money
  // as foreign activity.
  ok('the ledger currency, not the pack, decides what counts as foreign',
    ledgerCurrencyCode() === 'AED' &&
      summarizeForeignActivity(mixed).groups.map((g) => g.currency).join(',') === 'USD,SAR');

  // Erasing or restoring releases the explicit ledger denomination. Until a
  // new currency is chosen, presentation follows the selected parser pack for
  // legacy compatibility only.
  setLedgerCurrency(null);
  ok('releasing the pin lets the country change through again',
    setActiveMarket('SA') === true && formatAED(46520, { decimals: false }) === 'SAR 465.20');
  setLedgerCurrency('SAR');
  ok('an SAR ledger stays SAR even while the AE parser pack is active',
    setActiveMarket('AE') === true && formatAED(46520, { decimals: false }) === 'SAR 465.20');
  setLedgerCurrency(null);
  setActiveMarket('AE');

  // ── Any ledger converts foreign spending with a recorded, dated rate ────
  //
  // The user decision: a USD, INR or EUR ledger accepts travel and online
  // spending in any currency the way AED/SAR ledgers always have — the
  // original amount and currency are kept, the ledger amount is converted
  // with a reference rate, and the rate, its date and its source are stored
  // on the row. No rate, no converted posting.
  const {
    convertMinorUnits,
    originalMoneyFields,
    originalMoneyOf,
  } = require('./build/fx.js');
  const fxRates = require('./build/fx-rates.js');

  ok('KWD 12.345 at 3.26 USD/KWD is USD 40.24 (third decimal kept, one rounding)',
    convertMinorUnits(12345, 3, 3.26, 2) === 4024);
  ok('JPY 1,500 at 0.0068 USD/JPY is USD 10.20 (zero-decimal original)',
    convertMinorUnits(1500, 0, 0.0068, 2) === 1020);
  ok('USD 19.99 into a zero-decimal JPY ledger rounds half-up once',
    convertMinorUnits(1999, 2, 147.25, 0) === 2944);
  ok('EUR 45.00 at 110.12 INR/EUR into an INR ledger is exact decimal arithmetic',
    convertMinorUnits(4500, 2, 110.12, 2) === 495540);
  ok('an exact half minor unit rounds up, not to a binary hair below',
    convertMinorUnits(50, 2, 0.01, 2) === 1 && convertMinorUnits(17, 2, 0.5, 2) === 9);
  ok('tiny e-notation rates still convert exactly',
    convertMinorUnits(1_000_000_000, 2, 1e-7, 2) === 100);
  ok('a conversion that rounds to nothing is refused, never posted as zero',
    (() => { try { convertMinorUnits(1, 2, 0.001, 2); return false; } catch { return true; } })());

  // Exponent-correct originals, with the legacy two-decimal field kept only
  // where it is exact so an older reader never misreads the amount.
  const kwd = originalMoneyFields({ currency: 'KWD', minorUnits: 12345, exponent: 3 });
  ok('KWD 12.345 is stored in thousandths with no inexact legacy figure',
    kwd.originalMinorUnits === 12345 && kwd.originalExponent === 3 && kwd.originalAmountMinor === undefined);
  const kwdRound = originalMoneyFields({ currency: 'KWD', minorUnits: 12340, exponent: 3 });
  ok('KWD 12.340 also keeps its exact legacy hundredths',
    kwdRound.originalAmountMinor === 1234 && kwdRound.originalMinorUnits === 12340);
  const jpy = originalMoneyFields({ currency: 'JPY', minorUnits: 1500, exponent: 0 });
  ok('JPY 1,500 is stored as 1500 yen, legacy as 150000 hundredths',
    jpy.originalMinorUnits === 1500 && jpy.originalExponent === 0 && jpy.originalAmountMinor === 150000);
  ok('a legacy row without an exponent is read exactly as it was written (two decimals)',
    JSON.stringify(originalMoneyOf({ originalCurrency: 'JPY', originalAmountMinor: 150000 })) ===
      JSON.stringify({ currency: 'JPY', minorUnits: 150000, exponent: 2 }) &&
    formatOriginalCurrency(150000, 'JPY', 'en') === 'JPY 1,500.00');
  ok('new originals format in their own exponent',
    formatOriginalCurrency(1500, 'JPY', 'en', 0) === 'JPY 1,500' &&
    formatOriginalCurrency(12345, 'KWD', 'ar', 3) === 'KWD 12.345');

  const legacyKwd = { ...base, id: 'legacy-kwd', originalCurrency: 'KWD', originalAmountMinor: 1235,
    fxSource: 'fallback', amountFils: 14700 };
  const newKwd = { ...base, id: 'new-kwd', originalCurrency: 'KWD', originalMinorUnits: 12345,
    originalExponent: 3, fxSource: 'fallback', amountFils: 14768 };
  const kwdUpdates = await buildReferenceFxUpdates([legacyKwd, newKwd], 'AED', async (from, to, date) =>
    ({ base: from, quote: to, date, rate: 11.95 }));
  ok('reference revaluation reads each row in its own exponent',
    kwdUpdates.find((u) => u.id === 'new-kwd')?.amountFils === 14752 &&
    kwdUpdates.find((u) => u.id === 'legacy-kwd')?.amountFils === 14758, JSON.stringify(kwdUpdates));

  // Existing AED-ledger foreign rows: summaries of legacy and new rows add
  // one currency at one exponent, and a legacy row is never rescaled wrongly.
  const legacyJpy = charge('lj', 'JPY', 150000, 3673);
  const newJpy = { ...charge('nj', 'JPY', 150000, 3673), originalMinorUnits: 1500, originalExponent: 0 };
  const newKwdCharge = { ...charge('nk', 'KWD', undefined, 14768), originalMinorUnits: 12345, originalExponent: 3 };
  delete newKwdCharge.originalAmountMinor;
  const summary = summarizeForeignActivity([legacyJpy, newJpy, charge('lk', 'KWD', 1235, 14700), newKwdCharge],
    () => true, 'AED');
  const jpyGroup = summary.groups.find((g) => g.currency === 'JPY');
  const kwdGroup = summary.groups.find((g) => g.currency === 'KWD');
  ok('legacy and exponent-correct JPY rows sum to JPY 3,000.00',
    jpyGroup.originalMinor === 300000 && jpyGroup.originalExponent === 2 &&
    formatOriginalCurrency(jpyGroup.originalMinor, 'JPY', 'en', jpyGroup.originalExponent) === 'JPY 3,000.00');
  ok('legacy KWD 12.35 and new KWD 12.345 sum at three decimals to KWD 24.695',
    kwdGroup.originalMinor === 24695 && kwdGroup.originalExponent === 3 && kwdGroup.count === 2);
  ok('the foreign screen works for any ledger: EUR on an INR ledger is foreign',
    summarizeForeignActivity([{ ...charge('e', 'EUR', 4500, 495540), fxSource: 'reference' }], () => true, 'INR')
      .groups[0]?.referenceCount === 1);

  // ── Gulf SMS parser: exponent-correct originals, card amount wins ───────
  const { parseSms } = require('./build/sms-parser.js');
  setLedgerCurrency('AED');
  setActiveMarket('AE');
  const kwdSms = parseSms('Purchase of KWD 12.345 at AVENUES MALL with your Credit Card ending 1234 on 05/09/2026.');
  ok('a KWD alert keeps all three decimals of its original',
    kwdSms?.originalCurrency === 'KWD' && kwdSms.originalMinorUnits === 12345 &&
    kwdSms.originalExponent === 3 && kwdSms.originalAmountMinor === undefined && kwdSms.fxSource === 'fallback',
    JSON.stringify(kwdSms));
  const jpySms = parseSms('Purchase of JPY 1,500 at LAWSON TOKYO with your Credit Card ending 1234 on 05/09/2026.');
  ok('a JPY alert stores 1500 yen with exponent 0 (and the exact legacy figure)',
    jpySms?.originalMinorUnits === 1500 && jpySms.originalExponent === 0 && jpySms.originalAmountMinor === 150000 &&
    jpySms.amountFils === 3673);
  const statedSms = parseSms('Purchase of KWD 12.345 (AED 148.20) at AVENUES MALL with your Credit Card ending 1234 on 05/09/2026.');
  ok('when the alert states both amounts the card-charged AED figure wins',
    statedSms?.amountFils === 14820 && statedSms.fxSource === 'bank' && statedSms.originalMinorUnits === 12345 &&
    Math.abs(statedSms.fxRate - 148.20 / 12.345) < 1e-9, JSON.stringify(statedSms));
  const usdSms = parseSms('Purchase of USD 20.00 at OPENAI with your Credit Card ending 1234 on 05/09/2026.');
  ok('existing two-decimal AED-ledger conversions are unchanged',
    usdSms?.amountFils === 7345 && usdSms.originalAmountMinor === 2000 && usdSms.fxRate === 3.6725 &&
    usdSms.fxSource === 'fallback');
  setLedgerCurrency(null);

  // ── Universal parser: convert on a pinned non-Gulf ledger ──────────────
  const { createLaunchAlertSession } = require('./build/launch-alert-parser.js');
  const eurQuote = { base: 'EUR', quote: 'INR', rate: 110.12, date: '2026-09-04' };
  const lookups = [];
  const inrSession = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'INR',
    fxLookup: (b, q, d) => { lookups.push(`${b}|${q}|${d}`); return b === 'EUR' && q === 'INR' ? eurQuote : null; } });
  const eurParsed = inrSession.parse('Card purchase EUR 45.00 at CAFE DE FLORE on 2026-09-05.', 'CARD-ALERT');
  ok('a EUR purchase on an INR ledger posts in INR with rate, date and source recorded',
    eurParsed?.currency === 'INR' && eurParsed.amountFils === 495540 && eurParsed.originalCurrency === 'EUR' &&
    eurParsed.originalMinorUnits === 4500 && eurParsed.fxRate === 110.12 && eurParsed.fxRateDate === '2026-09-04' &&
    eurParsed.fxSource === 'reference', JSON.stringify(eurParsed));
  ok('the parser asked for the transaction day only, never an amount', lookups[0] === 'EUR|INR|2026-09-05',
    JSON.stringify(lookups));
  const offlineSession = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'INR', fxLookup: () => null });
  ok('offline / no rate: nothing posts (the alert goes to Review instead)',
    offlineSession.parse('Card purchase EUR 45.00 at CAFE DE FLORE on 2026-09-05.', 'CARD-ALERT') === null);
  const usdInr = { base: 'USD', quote: 'INR', rate: 88.5, date: '2026-09-05' };
  const dualSession = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'INR', fxLookup: () => usdInr });
  const dual = dualSession.parse('Card purchase USD 12.00 (INR 1,003.50) at AMAZON US on 2026-09-05.', 'CARD-ALERT');
  ok('an alert stating both amounts posts the card-charged INR figure, not the reference conversion',
    dual?.amountFils === 100350 && dual.fxSource === 'bank' && dual.originalMinorUnits === 1200 &&
    dual.currency === 'INR', JSON.stringify(dual));
  const implausible = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'INR',
    fxLookup: () => ({ ...usdInr, rate: 8850 }) })
    .parse('Card purchase USD 12.00 (INR 1,003.50) at AMAZON US on 2026-09-05.', 'CARD-ALERT');
  ok('a stated figure no plausible rate explains is discarded for the reference conversion',
    implausible?.fxSource === 'reference' && implausible.amountFils === 10620000, JSON.stringify(implausible));
  ok('without a quote to sanity-check it, automatic capture does not trust a stated figure',
    offlineSession.parse('Card purchase USD 12.00 (INR 1,003.50) at AMAZON US on 2026-09-05.', 'CARD-ALERT') === null);
  const sameCurrency = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'EUR', fxLookup: () => null })
    .parse('Card purchase EUR 45.00 at CAFE DE FLORE on 2026-09-05.', 'CARD-ALERT');
  ok('ledger-currency money still posts without any rate',
    sameCurrency?.currency === 'EUR' && sameCurrency.amountFils === 4500 && sameCurrency.fxSource === undefined,
    JSON.stringify(sameCurrency));

  // ── Review promotion: universal foreign purchases convert ──────────────
  const { planReviewPromotion, reviewPromotionFxNeed } = require('./build/review-promotion.js');
  const { prepareUniversalReviewAlert, emptyAlertReviewTray } = require('./build/alert-review-tray.js');
  const { inspectUniversalBankEvent } = require('./build/universal-parser.js');
  const { ledgerMoneySpec } = require('./build/ledger-money.js');
  const NOW = Date.UTC(2026, 8, 5, 12);
  const reviewOf = (text) => prepareUniversalReviewAlert({
    id: 'universal_review_id_00001', sourceKey: 'android_message_review_source_a123',
    observedAt: NOW, channel: 'inbox', parserVersion: 32, event: inspectUniversalBankEvent(text),
  });
  const ledgerState = (item, currency) => ({
    hydrated: true, ledgerMoney: ledgerMoneySpec(currency),
    reviewTray: { ...emptyAlertReviewTray(), pending: [item] },
    accounts: [{ id: 'acc-1', name: 'Card', kind: 'card', openingFils: 0, color: '#000', last4: '1234' }],
    transactions: [{ id: 'seed', type: 'expense', amountFils: 100, category: 'other', accountId: 'acc-1',
      title: 'Seed', date: '2026-09-01' }],
    budgets: [], bills: [], cardDues: [], goals: [], merchantOverrides: {}, accountHints: {},
    trustedNotificationPackages: [], notSubscriptions: [], lastScanTs: 0, onboarded: true, privateMode: false,
    marketId: 'AE', language: 'en',
  });
  const confirmOf = (item, amount) => ({
    reviewId: item.id, type: 'expense', title: 'Shop', category: 'shopping', accountId: 'acc-1',
    date: '2026-09-05', betweenOwnAccounts: false,
    universal: { confirmed: true, postingStatus: 'posted', amount,
      expectedSourceKey: item.sourceKey, expectedObservedAt: item.observedAt },
  });
  const kwdItem = reviewOf('Card purchase KWD 12.345 at AVENUES on 2026-09-05.');
  const kwdMoney = { currency: 'KWD', minorUnits: '12345', exponent: 3 };
  const kwdState = ledgerState(kwdItem, 'USD');
  const kwdNeed = reviewPromotionFxNeed(kwdState, confirmOf(kwdItem, kwdMoney));
  ok('promotion asks the host for exactly one pair and day',
    JSON.stringify(kwdNeed) === JSON.stringify({ base: 'KWD', quote: 'USD', date: '2026-09-05' }));
  const kwdPlan = planReviewPromotion(kwdState, confirmOf(kwdItem, kwdMoney), 'tx-kwd', NOW + 1,
    { base: 'KWD', quote: 'USD', rate: 3.2488, date: '2026-09-05' });
  ok('KWD original on a USD ledger: 3 decimals preserved, USD 40.11 posted with its rate',
    kwdPlan.outcome === 'added' && kwdPlan.transaction.amountFils === 4011 &&
    kwdPlan.transaction.originalMinorUnits === 12345 && kwdPlan.transaction.originalExponent === 3 &&
    kwdPlan.transaction.originalAmountMinor === undefined && kwdPlan.transaction.fxSource === 'reference' &&
    kwdPlan.transaction.fxRateDate === '2026-09-05' && kwdPlan.ledgerMoney.currency === 'USD',
    JSON.stringify(kwdPlan));
  const jpyItem = reviewOf('Card purchase JPY 2400 at LAWSON on 2026-09-05.');
  const jpyPlan = planReviewPromotion(ledgerState(jpyItem, 'USD'),
    confirmOf(jpyItem, jpyItem.event.amount.value), 'tx-jpy', NOW + 1,
    { base: 'JPY', quote: 'USD', rate: 0.0068, date: '2026-09-05' });
  ok('JPY original (0 decimals) on a USD ledger converts to USD 16.32',
    jpyPlan.outcome === 'added' && jpyPlan.transaction.amountFils === 1632 &&
    jpyPlan.transaction.originalMinorUnits === 2400 && jpyPlan.transaction.originalExponent === 0,
    JSON.stringify(jpyPlan));
  const eurItem = reviewOf('Card purchase EUR 45.00 at CAFE DE FLORE on 2026-09-05.');
  const eurPlan = planReviewPromotion(ledgerState(eurItem, 'INR'),
    confirmOf(eurItem, eurItem.event.amount.value), 'tx-eur', NOW + 1, eurQuote);
  ok('EUR purchase on an INR ledger is converted with the recorded rate and source',
    eurPlan.outcome === 'added' && eurPlan.transaction.amountFils === 495540 &&
    eurPlan.transaction.fxRate === 110.12 && eurPlan.transaction.fxSource === 'reference' &&
    eurPlan.transaction.originalCurrency === 'EUR', JSON.stringify(eurPlan));
  ok('currency mismatch no longer refuses when convertible; without a rate the review stays',
    planReviewPromotion(ledgerState(eurItem, 'INR'), confirmOf(eurItem, eurItem.event.amount.value),
      'tx-eur-offline', NOW + 1, null).reason === 'fx-rate-unavailable');
  const dualItem = reviewOf('Card purchase USD 12.00 (INR 1,003.50) at AMAZON US on 2026-09-05.');
  const dualConfirm = confirmOf(dualItem, dualItem.event.amount.value);
  const dualPlan = planReviewPromotion(ledgerState(dualItem, 'INR'), dualConfirm, 'tx-dual', NOW + 1, usdInr);
  ok('a confirmed review stating both amounts records the card-charged INR figure, not the reference rate',
    dualPlan.outcome === 'added' && dualPlan.transaction.amountFils === 100350 &&
    dualPlan.transaction.fxSource === 'bank' && dualPlan.transaction.originalMinorUnits === 1200,
    JSON.stringify(dualPlan));
  ok('an unlabelled stated figure is not trusted without a rate to check it (review stays)',
    planReviewPromotion(ledgerState(dualItem, 'INR'), dualConfirm, 'tx-dual-offline', NOW + 1, null)
      .reason === 'fx-rate-unavailable');

  // ── iPhone currency-conflict rows convert when a rate exists ───────────
  const { convertCurrencyConflictRow } = require('./build/local-message-record.js');
  const conflict = {
    kind: 'parsed', market: 'AE', milestone: 'financial',
    row: { kind: 'transaction', type: 'expense', amountFils: 7345, currency: 'AED', merchant: 'ChatGPT',
      date: '2026-09-05', dueDay: null, minDueFils: null, card: null, reference: null, transferHint: false,
      snapshotFils: 500000, snapshotKind: 'balance', categoryGuess: 'software', smsTs: NOW,
      // The AED debit is bank-stated ("USD 20.00 (AED 73.45)"): a real debit.
      originalCurrency: 'USD', originalAmountMinor: 2000, fxRate: 3.6725, fxSource: 'bank' },
  };
  const aedUsd = { base: 'AED', quote: 'USD', rate: 0.2723, date: '2026-09-05' };
  const convertedRow = convertCurrencyConflictRow(conflict, { currency: 'USD', exponent: 2 }, aedUsd);
  ok('an AED purchase on a USD ledger converts the AED debit with the dated rate',
    convertedRow?.row.currency === 'USD' && convertedRow.row.amountFils === 2000 &&
    convertedRow.row.originalCurrency === 'AED' && convertedRow.row.originalMinorUnits === 7345 &&
    convertedRow.row.fxSource === 'reference' && convertedRow.row.fxRateDate === '2026-09-05',
    JSON.stringify(convertedRow));
  ok('its AED balance snapshot is dropped, never relabelled as USD',
    convertedRow?.row.snapshotFils === null && convertedRow.row.snapshotKind === null);
  ok('no rate, a wrong pair or a later day keeps the purchase in Review',
    convertCurrencyConflictRow(conflict, { currency: 'USD', exponent: 2 }, null) === null &&
    convertCurrencyConflictRow(conflict, { currency: 'USD', exponent: 2 }, { ...aedUsd, base: 'SAR' }) === null &&
    convertCurrencyConflictRow(conflict, { currency: 'USD', exponent: 2 }, { ...aedUsd, date: '2026-09-06' }) === null);
  ok('card payments are never converted here',
    convertCurrencyConflictRow({ ...conflict, row: { ...conflict.row, kind: 'cardPayment' } },
      { currency: 'USD', exponent: 2 }, aedUsd) === null);

  // ── Review findings: no estimate, fee or stray figure becomes the charge ─
  ok('an AED figure the Gulf parser ESTIMATED offline is never re-converted as if it were the debit',
    convertCurrencyConflictRow({ ...conflict, row: { ...conflict.row, fxSource: 'fallback' } },
      { currency: 'USD', exponent: 2 }, aedUsd) === null);
  const feeEvent = inspectUniversalBankEvent('Bank fee INR 120.00 charged. Card purchase USD 50.00 at BESTBUY on 2026-09-05.');
  const usdSel = { currency: 'USD', minorUnits: 5000, exponent: 2 };
  const feeOnline = fxRates.convertForeignConfirmation(feeEvent, usdSel, { currency: 'INR', exponent: 2 }, usdInr);
  ok('a ledger-currency fee in the same alert is not the charged amount',
    feeOnline.fxSource === undefined && feeOnline.fields?.fxSource === 'reference' && feeOnline.amountFils === 442500 &&
    fxRates.convertForeignConfirmation(feeEvent, usdSel, { currency: 'INR', exponent: 2 }, null) === 'fx-rate-unavailable',
    JSON.stringify(feeOnline));
  const ambiguousAlternatives = { amount: { value: null, evidence: 'ambiguous', spans: [], issues: [],
    alternatives: [{ currency: 'INR', minorUnits: '12000', exponent: 2 }, { currency: 'USD', minorUnits: '5000', exponent: 2 }] },
    observations: [] };
  ok('amount alternatives alone never supply a charged figure',
    fxRates.statedLedgerAmount(ambiguousAlternatives, 'INR', 2) === null);
  const offBand = { amount: { value: { currency: 'USD', minorUnits: '1200', exponent: 2 }, evidence: 'explicit',
    spans: [], issues: [], alternatives: [] },
    observations: [{ role: 'transaction', field: { value: { currency: 'INR', minorUnits: '140000', exponent: 2 },
      evidence: 'explicit', spans: [], issues: [], alternatives: [] } }] };
  const offBandResult = fxRates.convertForeignConfirmation(offBand, { currency: 'USD', minorUnits: 1200, exponent: 2 },
    { currency: 'INR', exponent: 2 }, usdInr);
  ok('a stated figure 1.3x away from the reference rate is not the card charge',
    offBandResult.fields?.fxSource === 'reference' && offBandResult.amountFils === 106200, JSON.stringify(offBandResult));
  ok('a quote older than a week, or from a later day, is not the purchase day\'s rate',
    !fxRates.quoteFitsDay({ ...usdInr, date: '2026-08-28' }, '2026-09-05') &&
    fxRates.quoteFitsDay({ ...usdInr, date: '2026-08-29' }, '2026-09-05') &&
    !fxRates.quoteFitsDay({ ...usdInr, date: '2026-09-06' }, '2026-09-05'));

  // ── Rate loading: privacy, cache, offline ──────────────────────────────
  fxRates.clearReferenceQuoteCache();
  const requested = [];
  const rateFetch = async (url) => {
    requested.push(String(url));
    return { ok: true, status: 200, json: async () => ({ base: 'EUR', quote: 'INR', rate: 110.12, date: '2026-09-04' }) };
  };
  const loaded = await fxRates.loadReferenceQuote('eur', 'inr', '2026-09-05', { fetchImpl: rateFetch });
  const again = await fxRates.loadReferenceQuote('EUR', 'INR', '2026-09-05', { fetchImpl: rateFetch });
  ok('a rate request carries only two currency codes and a day',
    requested.length === 1 && requested[0] === 'https://api.frankfurter.dev/v2/rate/EUR/INR?date=2026-09-05');
  ok('the quote is cached for the pair and day (no second request)',
    loaded?.rate === 110.12 && again?.date === '2026-09-04' &&
    fxRates.cachedReferenceQuote('EUR', 'INR', '2026-09-05')?.rate === 110.12);
  let offlineCalls = 0;
  const offline = async () => { offlineCalls += 1; throw new TypeError('Network request failed'); };
  const none = await fxRates.loadReferenceQuote('GBP', 'INR', '2026-09-05', { fetchImpl: offline, now: 1000 });
  const retry = await fxRates.loadReferenceQuote('GBP', 'INR', '2026-09-05', { fetchImpl: offline, now: 2000 });
  ok('offline resolves null (never an invented rate) and backs off',
    none === null && retry === null && offlineCalls === 1);
  const badPair = await fxRates.loadReferenceQuote('CHF', 'INR', '2026-09-05', {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ base: 'USD', quote: 'INR', rate: 88, date: '2026-09-05' }) }),
  });
  ok('a provider answer for another pair is rejected', badPair === null);
  ok('a rate the encrypted ledger recorded is reused without a request',
    fxRates.cachedReferenceQuote('EUR', 'USD', '2026-08-01', [
      { id: 'b', type: 'expense', amountFils: 1, category: 'other', accountId: 'a', title: 't', date: '2026-08-01',
        originalCurrency: 'EUR', originalAmountMinor: 100, fxRate: 1.25, fxSource: 'bank' },
      { id: 'r', type: 'expense', amountFils: 1, category: 'other', accountId: 'a', title: 't', date: '2026-08-01',
        originalCurrency: 'EUR', originalAmountMinor: 100, fxRate: 1.17, fxRateDate: '2026-07-31', fxSource: 'reference' },
    ])?.rate === 1.17);
  fxRates.clearReferenceQuoteCache();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
