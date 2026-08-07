const {
  buildReferenceFxUpdates,
  convertOriginalMinorToLocalFils,
  fetchReferenceQuote,
  formatOriginalCurrency,
  referenceQuoteUrl,
} = require('./build/fx.js');
const {
  previewForeignActivity,
  summarizeForeignActivity,
} = require('./build/fx-summary.js');

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

  const roundedBreakdown = summarizeForeignActivity(
    ['USD', 'EUR', 'GBP'].map((currency, index) => ({
      ...base,
      id: `rounded-${currency}`,
      originalCurrency: currency,
      originalAmountMinor: 100 + index,
      amountFils: 149,
    })),
  );
  const preview = previewForeignActivity(roundedBreakdown, 2);
  ok(
    'foreign headline totals the whole-AED currency rows, not hidden fils',
    roundedBreakdown.totalLocalFils === 300,
    JSON.stringify(roundedBreakdown),
  );
  ok(
    'foreign preview exposes every omitted currency as a reconciling remainder',
    preview.groups.length === 2 &&
      preview.remainingCount === 1 &&
      preview.remainingLocalFils === 100 &&
      preview.groups.reduce((sum, group) => sum + Math.round(group.localFils / 100) * 100, 0) +
        preview.remainingLocalFils === preview.totalLocalFils,
    JSON.stringify(preview),
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
