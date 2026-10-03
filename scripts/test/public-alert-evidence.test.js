const { inspectMarketAlert } = require('./build/alert-semantics');
const { routeAlertMarket } = require('./build/alert-market-detection');
const { inspectUniversalBankEvent } = require('./build/universal-parser');
const { createLaunchAlertSession } = require('./build/launch-alert-parser');
const { dateOrderForCountry } = require('./build/country');
const evidence = require('./fixtures/public-alert-evidence');
const { formattingMutations, postedFooterMutations } = require('./fixtures/global-alert-adversarial');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
  if (condition) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const provenance = new Set(['standard-derived', 'community-derived']);
ok('public evidence uses only explicit Tier B/C provenance',
  evidence.every((row) => provenance.has(row.provenance) && row.sourceRef));
ok('public evidence contains no links, email addresses or long unmasked identifiers',
  evidence.every((row) => !/https?:\/\/|\b[^\s@]+@[^\s@]+\b|\b\d{9,}\b/iu.test(row.body)));

const secondWave = new Set(['CA', 'AU', 'BR', 'MX', 'SG']);
const counts = evidence.reduce((acc, row) => ({ ...acc, [row.market]: (acc[row.market] ?? 0) + 1 }), {});
ok('public evidence covers US and every second-wave market',
  counts.US === 27 && counts.CA === 2 && counts.AU === 3 && counts.BR === 1 && counts.MX === 3 && counts.SG === 2,
  JSON.stringify(counts));

// A known gap may only be wrong in the fail-closed direction.
ok('known gaps never make anything read as posted, reviewable or directed',
  evidence.every((row) => !row.knownGap || (
    Object.keys(row.knownGap).every((field) => ['family', 'status', 'decision', 'direction'].includes(field)) &&
    (!('status' in row.knownGap) || row.knownGap.status !== 'posted') &&
    (!('decision' in row.knownGap) || row.knownGap.decision === 'refuse') &&
    (!('direction' in row.knownGap) || row.knownGap.direction === 'none'))));

for (const row of evidence) {
  const universal = row.expected.engine === 'universal';
  const review = universal
    ? inspectUniversalBankEvent(row.body, { market: row.market, sender: row.sender })
    : inspectMarketAlert(row.body, row.market, { sender: row.sender });
  // `expected` is the true label; a documented knownGap pins today's safe
  // deviation so that any change (fix or regression) is noticed.
  const current = (field) => (row.knownGap && field in row.knownGap ? row.knownGap[field] : row.expected[field]);
  const expectedDecision = universal && current('decision') === 'refuse' ? 'ignore' : current('decision');
  for (const field of ['decision', 'status', 'family', 'direction']) {
    const expected = field === 'decision' ? expectedDecision : current(field);
    ok(`${row.id}: ${field}${row.knownGap && field in row.knownGap ? ' (known gap)' : ''}`, review[field] === expected,
      `${JSON.stringify(review[field])} != ${JSON.stringify(expected)}`);
  }

  // Second-wave rows must also resolve their own market from the alert alone
  // (sender, institution, ISO currency or a domestic rail), never from locale.
  if (secondWave.has(row.market)) {
    const route = routeAlertMarket({ source: row.body, sender: row.sender });
    ok(`${row.id}: routes to ${row.market} without a region hint`,
      route.decision === 'single' && route.market === row.market, JSON.stringify(route));
  }

  // Exact money, direction and date through the structured universal parser
  // in the routed market with that country's own date convention.
  if (row.expected.currency) {
    const event = inspectUniversalBankEvent(row.body, {
      market: row.market,
      sender: row.sender,
      dateOrder: dateOrderForCountry(row.market) ?? undefined,
    });
    ok(`${row.id}: universal amount is exact ISO money`,
      event.amount.evidence === 'explicit' &&
        event.amount.value?.currency === row.expected.currency &&
        event.amount.value?.minorUnits === row.expected.minorUnits,
      JSON.stringify(event.amount));
    ok(`${row.id}: universal status and direction agree with the market review`,
      current('status') === 'posted'
        ? event.status === 'posted' && event.direction === row.expected.direction
        : event.status !== 'posted',
      JSON.stringify({ status: event.status, direction: event.direction }));
    const date = event.transactionDate.evidence === 'explicit' ? event.transactionDate.value : null;
    ok(`${row.id}: transaction date is never guessed`,
      date === row.expected.transactionDate, JSON.stringify(event.transactionDate));
  }

  // Nothing that is not a completed posting may leave the launch parser as a
  // ledger row, whatever ledger it lands on.
  if (current('status') !== 'posted') {
    for (const pinnedCurrency of [null, 'USD', 'AED', 'CAD', 'AUD', 'BRL', 'MXN', 'SGD']) {
      const session = createLaunchAlertSession({
        overrides: {}, activeMarket: 'AE', pinnedCurrency, fxLookup: () => null,
      });
      const parsed = session.parse(row.body, row.sender, session.inspect(row.body, row.sender));
      ok(`${row.id}: non-posted evidence never becomes a ledger row (${pinnedCurrency ?? 'unpinned'})`,
        parsed === null, JSON.stringify(parsed));
    }
  }

  for (const mutation of formattingMutations) {
    const body = mutation.apply(row.body, row);
    const mutated = universal
      ? inspectUniversalBankEvent(body, { market: row.market, sender: row.sender })
      : inspectMarketAlert(body, row.market, { sender: row.sender });
    ok(`${row.id}/${mutation.id}: Tier D mutation preserves accounting meaning`,
      ['decision', 'status', 'family', 'direction'].every((field) => {
        const expected = field === 'decision' ? expectedDecision : current(field);
        return mutated[field] === expected;
      }),
      JSON.stringify({
        expected: row.expected,
        actual: {
          decision: mutated.decision,
          status: mutated.status,
          family: mutated.family,
          direction: mutated.direction,
        },
      }));
  }
  if (current('status') === 'posted') {
    for (const mutation of postedFooterMutations) {
      const body = mutation.apply(row.body, row);
      const mutated = universal
        ? inspectUniversalBankEvent(body, { market: row.market, sender: row.sender })
        : inspectMarketAlert(body, row.market, { sender: row.sender });
      ok(`${row.id}/${mutation.id}: posted public evidence survives unrelated boilerplate`,
        ['decision', 'status', 'family', 'direction'].every((field) => {
          const expected = field === 'decision' ? expectedDecision : current(field);
          return mutated[field] === expected;
        }),
        JSON.stringify({
          expected: row.expected,
          actual: {
            decision: mutated.decision,
            status: mutated.status,
            family: mutated.family,
            direction: mutated.direction,
          },
        }));
    }
  }
}

console.log(`\npublic-alert-evidence: ${pass} passed, ${fail} failed · ${evidence.length} Tier B/C fixtures`);
if (fail) process.exit(1);
