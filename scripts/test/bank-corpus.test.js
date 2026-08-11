const { isDeepStrictEqual } = require('util');

const { parseSms } = require('./build/sms-parser');
const { setActiveMarket } = require('./build/markets');
const { inspectMarketAlert } = require('./build/alert-semantics');
const { runMarketBenchmark } = require('./build/alert-rollout');
const uaeCorpus = require('./fixtures/uae-bank-formats');
const saudiCorpus = require('./fixtures/saudi-bank-formats');
const globalCorpus = require('./fixtures/global-alert-formats');
const corpus = [...uaeCorpus, ...saudiCorpus];

let pass = 0;
let fail = 0;
function ok(name, condition, detail) {
  if (condition) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.log(`✗ ${name}${detail === undefined ? '' : ` — ${detail}`}`);
  }
}

const REQUIRED_BANKS = ['ENBD', 'ADCB', 'FAB', 'Mashreq', 'ADIB', 'RAKBANK', 'Liv', 'Wio'];
const EVIDENCE = new Set(['repository-redacted', 'public-redacted', 'synthetic-grammar-probe']);

const represented = new Set(uaeCorpus.map((row) => row.bank));
ok(
  'all eight product banks have an executable fixture',
  REQUIRED_BANKS.every((bank) => represented.has(bank)),
  REQUIRED_BANKS.filter((bank) => !represented.has(bank)).join(', '),
);
ok('fixture ids are unique', new Set(corpus.map((row) => row.id)).size === corpus.length);
ok(
  'every fixture declares its evidence quality',
  corpus.every((row) => EVIDENCE.has(row.evidence)),
);
ok(
  'synthetic wording is visibly quarantined',
  corpus.filter((row) => row.evidence === 'synthetic-grammar-probe').every((row) => row.bank === 'RAKBANK'),
);
ok(
  'Saudi acceptance rows are public/redacted and explicitly market-scoped',
  saudiCorpus.length > 0 && saudiCorpus.every(
    (row) => row.market === 'SA' && row.evidence === 'public-redacted',
  ),
);
ok(
  'every UAE acceptance row is explicitly market-scoped',
  uaeCorpus.length > 0 && uaeCorpus.every((row) => row.market === 'AE'),
);

const GLOBAL_MARKETS = ['US', 'GB', 'FR', 'DE', 'ES', 'IT', 'NL', 'IN', 'QA', 'KW', 'BH', 'OM', 'EG', 'JO'];
const GLOBAL_PROVENANCE = new Set(['standard-derived', 'synthetic']);
const GLOBAL_FAMILIES = [
  'purchase', 'transfer', 'cash-withdrawal', 'refund', 'fee', 'utility',
  'recurring-payment', 'statement', 'balance', 'authentication',
];
ok('representative global corpus has twelve core outcomes plus hard negatives',
  globalCorpus.length === GLOBAL_MARKETS.length * 12 + 20 && GLOBAL_MARKETS.every(
    (market) => globalCorpus.filter((row) => row.market === market).length >= 12,
  ), `${globalCorpus.length} rows`);
ok('representative global corpus ids are unique',
  new Set(globalCorpus.map((row) => row.id)).size === globalCorpus.length);
ok('global rows stay explicitly non-real and provenance-labelled',
  globalCorpus.every((row) => GLOBAL_PROVENANCE.has(row.provenance) &&
    row.basis === 'near-real-template' && row.sourceRef));
ok('global rows cover at least three institutions per market',
  GLOBAL_MARKETS.every((market) => new Set(
    globalCorpus.filter((row) => row.market === market).map((row) => row.institution),
  ).size >= 3));
ok('every market exercises all required single-alert families',
  GLOBAL_MARKETS.every((market) => {
    const families = new Set(globalCorpus.filter((row) => row.market === market)
      .map((row) => row.expected.family));
    return GLOBAL_FAMILIES.every((family) => families.has(family));
  }));
ok('global rows contain no links, email addresses, or long unmasked identifiers',
  globalCorpus.every((row) => !/https?:\/\/|\b[^\s@]+@[^\s@]+\b|\b\d{9,}\b/iu.test(row.body)));

for (const row of globalCorpus) {
  const review = inspectMarketAlert(row.body, row.market, { sender: row.sender });
  const candidate = review.draft.candidates[0] ?? null;
  ok(`${row.id}: institution`,
    review.institution.decision === 'identified' &&
      review.institution.institution === row.institution,
    JSON.stringify(review.institution));
  for (const field of ['decision', 'status', 'family', 'direction']) {
    ok(`${row.id}: ${field}`, review[field] === row.expected[field],
      `${JSON.stringify(review[field])} != ${JSON.stringify(row.expected[field])}`);
  }
  ok(`${row.id}: exact money`, candidate?.currency === row.expected.currency &&
    candidate?.minorUnits === row.expected.minorUnits,
  `${JSON.stringify(candidate)} != ${row.expected.currency} ${row.expected.minorUnits}`);
}

for (const market of GLOBAL_MARKETS) {
  const benchmark = runMarketBenchmark(market, globalCorpus.map((row) => ({
    id: row.id,
    market: row.market,
    institution: row.institution,
    channel: row.channel,
    sender: row.sender,
    templateVersion: row.sourceRef,
    split: 'authoring',
    provenance: row.provenance,
    source: row.body,
    expected: {
      decision: row.expected.decision,
      status: row.expected.status,
      family: row.expected.family,
      money: row.expected.status === 'posted' ? {
        currency: row.expected.currency,
        minorUnits: row.expected.minorUnits,
        direction: row.expected.direction,
      } : null,
    },
  })));
  ok(`${market}: representative rows cannot certify automatic import`,
    benchmark.stage === 'review' && benchmark.consentedRealFixtureCount === 0 &&
      benchmark.blockers.includes('not-enough-consented-real-fixtures'));
}

for (const row of corpus) {
  const selected = setActiveMarket(row.market);
  ok(`${row.bank}/${row.id}: selects ${row.market} market`, selected === true);
  const parsed = parseSms(row.body);
  setActiveMarket('AE');
  ok(`${row.bank}/${row.id}: parses`, parsed !== null);
  if (!parsed) continue;

  for (const [field, expected] of Object.entries(row.expect)) {
    const actual = parsed[field];
    ok(
      `${row.bank}/${row.id}: ${field}`,
      isDeepStrictEqual(actual, expected),
      `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`,
    );
  }

  // Android keeps the source only long enough to support parser-version
  // healing. The relay boundary strips this property before sealing/storing;
  // assert that the parser keeps it isolated in exactly one named field.
  ok(`${row.bank}/${row.id}: source body is isolated as raw`, parsed.raw === row.body);
  const { raw: discarded, ...structured } = parsed;
  ok(
    `${row.bank}/${row.id}: raw discard leaves no source-body field`,
    discarded === row.body && !Object.hasOwn(structured, 'raw'),
  );
  ok(
    `${row.bank}/${row.id}: structured payload does not contain the source body`,
    !JSON.stringify(structured).includes(row.body),
  );
}

const referenceCase = corpus.find((row) => row.id === 'fab-account-credit-with-reference');
const referenceParsed = referenceCase && parseSms(referenceCase.body);
ok(
  'masked account identity is distinct from the transaction reference',
  referenceParsed?.card?.kind === 'account' &&
    referenceParsed.card.last4 === '0001' &&
    referenceParsed.reference === 'XXOTTXXXX075',
);
ok(
  'a reference label never leaks into the merchant',
  referenceParsed?.merchant === 'Incoming transfer' && !/ref/i.test(referenceParsed.merchant),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
