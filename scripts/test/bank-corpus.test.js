const { isDeepStrictEqual } = require('util');

const { parseSms } = require('./build/sms-parser');
const { setActiveMarket } = require('./build/markets');
const uaeCorpus = require('./fixtures/uae-bank-formats');
const saudiCorpus = require('./fixtures/saudi-bank-formats');
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
