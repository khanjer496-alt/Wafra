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
    setActiveMarket('SA') === true && formatAED(46520, { decimals: false }) === 'SAR 465');
  setActiveMarket('AE');

  setLedgerCurrency('AED');
  ok('a pack denominated in another currency is refused, not applied',
    setActiveMarket('SA') === false && getActiveMarket().id === 'AE');
  ok('so stored fils keep the currency they were recorded in',
    formatAED(46520, { decimals: false }) === 'AED 465');
  ok('and the refusal is visible before it is attempted',
    canSelectMarket('SA') === false && canSelectMarket('AE') === true);
  ok('a pack in the SAME currency is never refused',
    setActiveMarket('AE') === true && getActiveMarket().id === 'AE');

  // The screen calls "foreign" whatever is not the LEDGER's currency, so an
  // AED ledger sitting under an SA pack must not start filing its own money
  // as foreign activity.
  ok('the ledger currency, not the pack, decides what counts as foreign',
    ledgerCurrencyCode() === 'AED' &&
      summarizeForeignActivity(mixed).groups.map((g) => g.currency).join(',') === 'USD,SAR');

  // Erasing or restoring releases the pin on the same tick — there is no
  // stored field to migrate, so an emptied ledger is free to move country.
  setLedgerCurrency(null);
  ok('releasing the pin lets the country change through again',
    setActiveMarket('SA') === true && formatAED(46520, { decimals: false }) === 'SAR 465');
  setLedgerCurrency('SAR');
  ok('an SAR ledger pins SAR, not whichever pack shipped first',
    setActiveMarket('AE') === false && formatAED(46520, { decimals: false }) === 'SAR 465');
  setLedgerCurrency(null);
  setActiveMarket('AE');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
