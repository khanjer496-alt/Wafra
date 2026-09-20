'use strict';
/**
 * Baseline: run Wafra's shipping deterministic parser over the same bank-alert
 * fixtures the research extractor is measured on.
 *
 * "No regression versus current deterministic parser" is one of the acceptance
 * gates in WAFRA_S1_RESEARCH_HANDOFF.md, and it cannot be argued from memory.
 * This produces the number to compare against
 * results/amount-role-deterministic.json.
 *
 * Requires the transpiled modules: run `bash scripts/test/build.sh` first.
 *
 * Usage:
 *   node validation/semantic-parser/production_parser_baseline.cjs \
 *     > validation/semantic-parser/results/production-parser-baseline.json
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const BUILD = path.join(ROOT, 'scripts/test/build');
if (!fs.existsSync(path.join(BUILD, 'sms-parser.js'))) {
  console.error('missing scripts/test/build — run `bash scripts/test/build.sh` first');
  process.exit(2);
}

const { parseSms } = require(path.join(BUILD, 'sms-parser.js'));
const { withMarketPackForParsing, MARKETS } = require(path.join(BUILD, 'markets.js'));

const fixturesPath = path.join(__dirname, 'results/wafra-alert-fixtures.json');
if (!fs.existsSync(fixturesPath)) {
  console.error('missing results/wafra-alert-fixtures.json — run export_wafra_fixtures.cjs first');
  process.exit(2);
}
const { rows } = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));

// Scope matters, and getting it wrong invents a regression that is not there.
//
// The app ships market packs for AE and SA only. Handed a US or French alert it
// still parses, but converts the amount into the ledger currency — so comparing
// its AED output against a USD fixture measures FX conversion, not extraction.
// The global-alert-formats corpus says as much: those rows are explicitly not
// eligible for automatic import.
//
// So rows are split. In scope: the market has a pack. Out of scope: everything
// else, reported separately and never counted as a regression.
const SUPPORTED_MARKETS = new Set(MARKETS.map((market) => market.id));

const inScope = (row) => Boolean(row.market) && SUPPORTED_MARKETS.has(row.market);

const parseRow = (row) => {
  const attempt = () => parseSms(row.body, {}, { sender: row.institution || undefined });
  if (inScope(row)) {
    const withPack = withMarketPackForParsing(row.market, attempt);
    if (withPack !== null) return withPack;
  }
  return attempt();
};

const perRow = [];
const timings = [];
for (const row of rows) {
  const started = process.hrtime.bigint();
  let parsed = null;
  let error = null;
  try {
    parsed = parseRow(row);
  } catch (err) {
    error = String(err && err.message ? err.message : err);
  }
  timings.push(Number(process.hrtime.bigint() - started) / 1e6);

  const expected = row.expected;
  const isTransaction = Boolean(parsed) && parsed.kind === 'transaction';
  const gotMinor = isTransaction && parsed.amountFils != null ? String(parsed.amountFils) : null;
  const gotCurrency = isTransaction ? (parsed.currency ?? null) : null;

  const amountCorrect = gotMinor != null && gotMinor === expected.minorUnits;
  const currencyCorrect = gotCurrency != null && gotCurrency === expected.currency;
  const pickedDecoy = Boolean(
    gotMinor && expected.decoyMinorUnits && gotMinor === expected.decoyMinorUnits,
  );

  perRow.push({
    id: row.id,
    in_scope: inScope(row),
    corpus: row.corpus,
    market: row.market,
    status: expected.status,
    error,
    kind: parsed ? parsed.kind : null,
    selected: isTransaction && gotMinor != null,
    amount_correct: amountCorrect,
    currency_correct: currencyCorrect,
    picked_decoy: pickedDecoy,
    expected_minor: expected.minorUnits,
    got_minor: gotMinor,
    expected_currency: expected.currency,
    got_currency: gotCurrency,
    snapshot_kind: parsed ? (parsed.snapshotKind ?? null) : null,
    body: row.body.slice(0, 200),
  });
}

const summarize = (subset) => {
  const selected = subset.filter((r) => r.selected);
  const wrong = selected.filter((r) => !(r.amount_correct && r.currency_correct));
  return {
    n: subset.length,
    selected: selected.length,
    selection_rate: subset.length ? selected.length / subset.length : null,
    abstained: subset.length - selected.length,
    unsafe_selections: wrong.length,
    unsafe_amount_selections: selected.filter((r) => !r.amount_correct).length,
    picked_decoy: subset.filter((r) => r.picked_decoy).length,
    errors: subset.filter((r) => r.error).length,
    exact_amount_and_currency_coverage: subset.length
      ? subset.filter((r) => r.amount_correct && r.currency_correct).length / subset.length
      : null,
    failures: wrong.slice(0, 20),
  };
};

const sorted = timings.slice().sort((a, b) => a - b);
const report = {
  experiment: 'production-deterministic-parser-baseline',
  created: new Date().toISOString(),
  parser: 'src/lib/sms-parser.ts via scripts/test/build',
  corpus_note:
    'Wafra repository fixtures: privacy-safe near-real templates and ' +
    'standard-derived reconstructions, not consented customer evidence.',
  supported_markets: [...SUPPORTED_MARKETS],
  in_scope: summarize(perRow.filter((r) => r.in_scope)),
  out_of_scope: summarize(perRow.filter((r) => !r.in_scope)),
  all_rows: summarize(perRow),
  latency_ms: {
    mean: timings.reduce((a, b) => a + b, 0) / timings.length,
    p95: sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)],
    max: sorted[sorted.length - 1],
  },
  per_row: perRow,
};

process.stdout.write(JSON.stringify(report, null, 2));
