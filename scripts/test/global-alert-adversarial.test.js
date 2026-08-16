const { performance } = require('perf_hooks');

const { inspectMarketAlert } = require('./build/alert-semantics');
const { routeAlertMarket } = require('./build/alert-market-detection');
const { createLaunchAlertSession } = require('./build/launch-alert-parser');
const corpus = require('./fixtures/global-alert-formats');
const {
  formattingMutations,
  postedFooterMutations,
} = require('./fixtures/global-alert-adversarial');

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, condition, detail) => {
  if (condition) {
    pass += 1;
    return;
  }
  fail += 1;
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

const sameOutcome = (review, expected) =>
  review.decision === expected.decision &&
  review.status === expected.status &&
  review.family === expected.family &&
  review.direction === expected.direction;

const exactExpectedMoney = (review, expected) => {
  const selected = review.primaryCandidateIndex === null
    ? review.draft.candidates[0]
    : review.draft.candidates[review.primaryCandidateIndex];
  return selected?.currency === expected.currency &&
    selected?.minorUnits === expected.minorUnits;
};

const cases = [];
for (const row of corpus) {
  for (const mutation of formattingMutations) {
    cases.push({ row, mutation, body: mutation.apply(row.body, row) });
  }
  if (row.expected.status === 'posted') {
    for (const mutation of postedFooterMutations) {
      cases.push({ row, mutation, body: mutation.apply(row.body, row) });
    }
  }
}

const startedAt = performance.now();
for (const testCase of cases) {
  const { row, mutation, body } = testCase;
  const review = inspectMarketAlert(body, row.market, { sender: row.sender });
  const label = `${row.id}/${mutation.id}`;
  ok(`${label}: accounting outcome is stable`, sameOutcome(review, row.expected),
    JSON.stringify({
      expected: row.expected,
      actual: {
        decision: review.decision,
        status: review.status,
        family: review.family,
        direction: review.direction,
      },
    }));
  ok(`${label}: exact money is stable`, exactExpectedMoney(review, row.expected),
    JSON.stringify(review.draft.candidates));
  ok(`${label}: institution remains grounded`,
    review.institution.decision === 'identified' &&
      review.institution.institution === row.institution,
    JSON.stringify(review.institution));
}

const markets = [...new Set(corpus.map((row) => row.market))].sort();
for (const market of markets) {
  const marketRows = corpus.filter((row) => row.market === market);
  const posted = marketRows.find((row) => row.expected.status === 'posted');
  const other = corpus.find((row) => row.market !== market && row.expected.status === 'posted');
  if (!posted || !other) continue;

  const route = routeAlertMarket({ source: posted.body, sender: posted.sender });
  ok(`${market}: exact issuer routes to one market`,
    route.decision === 'single' && route.market === market, JSON.stringify(route));

  const launch = createLaunchAlertSession({
    overrides: {},
    activeMarket: 'AE',
    pinnedCurrency: 'AED',
  });
  const inspection = launch.inspect(posted.body, posted.sender);
  ok(`${market}: worldwide alert never enters the UAE/Saudi launch parser`,
    inspection?.route.decision === 'single' &&
      inspection.route.market === market &&
      launch.parse(posted.body, posted.sender, inspection) === null,
    JSON.stringify(inspection?.route));

  const conflict = routeAlertMarket({ source: posted.body, sender: other.sender });
  ok(`${market}: conflicting foreign issuer is ambiguous`,
    conflict.decision === 'ambiguous' && conflict.market === null,
    JSON.stringify(conflict));
}

const hardNegatives = [
  {
    id: 'shared-eur-without-issuer', market: 'FR', sender: 'BANK',
    body: 'Card purchase EUR 19.99 was debited at SAMPLE SHOP.',
    assert: (route, review) => route.decision === 'ambiguous' && review === null,
  },
  {
    id: 'shared-usd-without-issuer', market: 'US', sender: 'BANK',
    body: 'Card purchase USD 19.99 was debited at SAMPLE SHOP.',
    assert: (route, review) => route.decision === 'ambiguous' && review === null,
  },
  {
    id: 'two-transaction-amounts', market: 'US', sender: 'CHASE',
    body: 'Chase Bank: Card purchases USD 10.00 and USD 20.00 were debited.',
    assert: (_route, review) => review?.decision === 'refuse' &&
      review.primaryCandidateIndex === null,
  },
  {
    id: 'failed-with-posting-words', market: 'GB', sender: 'BARCLAYS',
    body: 'Barclays: Card purchase GBP 42.10 was declined and not charged.',
    assert: (_route, review) => review?.decision === 'refuse' && review.status === 'failed',
  },
  {
    id: 'future-credit-is-not-income', market: 'US', sender: 'BANKOFAMERICA',
    body: 'Bank of America: Direct deposit USD 1,250.00 will be credited tomorrow.',
    assert: (_route, review) => review?.decision === 'refuse' && review.status === 'future',
  },
  {
    id: 'future-credit-fr', market: 'FR', sender: 'BNPPARIBAS',
    body: 'BNP Paribas : virement EUR 100,00 sera crédité demain.',
    assert: (_route, review) => review?.decision === 'refuse' && review.status === 'future',
  },
  {
    id: 'future-credit-de', market: 'DE', sender: 'DEUTSCHEBANK',
    body: 'Deutsche Bank: Überweisung EUR 100,00 wird morgen gutgeschrieben.',
    assert: (_route, review) => review?.decision === 'refuse' && review.status === 'future',
  },
  {
    id: 'future-credit-es', market: 'ES', sender: 'SANTANDER',
    body: 'Banco Santander: transferencia EUR 100,00 será abonado mañana.',
    assert: (_route, review) => review?.decision === 'refuse' && review.status === 'future',
  },
  {
    id: 'future-credit-it', market: 'IT', sender: 'INTESASANPAOLO',
    body: 'Intesa Sanpaolo: bonifico EUR 100,00 sarà accreditato domani.',
    assert: (_route, review) => review?.decision === 'refuse' && review.status === 'future',
  },
  {
    id: 'future-credit-nl', market: 'NL', sender: 'INGNL',
    body: 'ING Nederland: overboeking EUR 100,00 wordt morgen bijgeschreven.',
    assert: (_route, review) => review?.decision === 'refuse' && review.status === 'future',
  },
  {
    id: 'too-many-money-candidates', market: 'US', sender: 'CHASE',
    body: `Chase Bank: Card purchase ${Array.from({ length: 17 }, (_, index) =>
      `USD ${index + 1}.00`).join(' and ')} was debited.`,
    assert: (_route, review) => review?.decision === 'refuse' &&
      review.reasons.includes('too-many-money-candidates'),
  },
];

for (const negative of hardNegatives) {
  const universal = require('./build/alert-market-detection').inspectUniversalAlert({
    source: negative.body,
    sender: negative.sender,
  });
  ok(`${negative.id}: fails closed`, negative.assert(universal.route, universal.review),
    JSON.stringify(universal));
}

const elapsedMs = performance.now() - startedAt;
ok('adversarial corpus exercises every supported worldwide market', markets.length === 14,
  markets.join(','));
ok('adversarial corpus is substantial', cases.length >= 1_000, `${cases.length} cases`);

for (const failure of failures.slice(0, 40)) console.log(`✗ ${failure}`);
if (failures.length > 40) console.log(`… ${failures.length - 40} more failures`);
console.log(`\n${pass} passed, ${fail} failed · ${cases.length} mutated alerts · ${
  elapsedMs.toFixed(1)} ms`);
process.exit(fail ? 1 : 0);
