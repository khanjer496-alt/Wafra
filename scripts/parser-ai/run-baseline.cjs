'use strict';
/**
 * Score the CURRENT deterministic parser on (1) the labelled repo-fixture eval
 * set and (2) the held-out-template synthetic test split.
 *
 *   node scripts/parser-ai/run-baseline.cjs [--json out.json] [--split test]
 *
 * Output contains metrics only — never message text.
 */
const fs = require('node:fs');
const { buildRepoEvalSet } = require('./repo-eval-set.cjs');
const { generate } = require('./synth/generate.cjs');
const { runLedger, runExtraction } = require('./pipeline.cjs');
const { newBucket, scoreRow, summarize } = require('./score.cjs');

function evaluate(rows, keys) {
  const groups = { overall: { all: newBucket() } };
  for (const key of keys) groups[key] = {};
  const statusFalsePosts = {};
  const ms = [];
  for (const row of rows) {
    const t0 = process.hrtime.bigint();
    const ledger = runLedger(row);
    const t1 = process.hrtime.bigint();
    const extraction = runExtraction(row);
    ms.push(Number(t1 - t0) / 1e6);
    scoreRow(groups.overall.all, row, ledger, extraction);
    for (const key of keys) {
      const value = key === 'status' ? row.label.status : key === 'family' ? row.label.family : row[key] ?? 'n/a';
      scoreRow(groups[key][value] ??= newBucket(), row, ledger, extraction);
    }
    if (!row.label.shouldPost && ledger.posted) statusFalsePosts[row.label.status] = (statusFalsePosts[row.label.status] ?? 0) + 1;
  }
  ms.sort((a, b) => a - b);
  const out = {};
  for (const [key, buckets] of Object.entries(groups)) {
    out[key] = Object.fromEntries(Object.entries(buckets).map(([k, b]) => [k, summarize(b)]));
  }
  out.falsePostsByStatus = statusFalsePosts;
  out.ledgerLatencyMs = { p50: Number(ms[Math.floor(ms.length / 2)].toFixed(2)), p95: Number(ms[Math.floor(ms.length * 0.95)].toFixed(2)) };
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
  const split = args.includes('--split') ? args[args.indexOf('--split') + 1] : 'test';
  const repo = buildRepoEvalSet();
  const synth = generate().filter((r) => r.split === split);
  const report = {
    generatedAt: new Date().toISOString(),
    pipeline: 'createLaunchAlertSession (historical-import routing, best-effort ON, ledger = local currency) + inspectUniversalBankEvent',
    repoFixtures: { rows: repo.length, ...evaluate(repo, ['source', 'country', 'language', 'status']) },
    syntheticHeldOut: { split, rows: synth.length, templates: new Set(synth.map((r) => r.template)).size,
      ...evaluate(synth, ['country', 'language', 'event', 'status', 'family']) },
  };
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1) + '\n');
  const brief = (s) => ({ n: s.n, recall: s.ledger.autoPostRecall, falsePost: s.ledger.falsePostRate, precision: s.ledger.postedPrecision,
    e2e: s.ledger.endToEnd, xAmount: s.extraction.amount.acc, xStatus: s.extraction.status.acc, xMerchant: s.extraction.merchantStrict.acc });
  console.log('repo', JSON.stringify(brief(report.repoFixtures.overall.all)));
  console.log('synth', JSON.stringify(brief(report.syntheticHeldOut.overall.all)));
  for (const [k, s] of Object.entries(report.syntheticHeldOut.language)) console.log(' lang', k, JSON.stringify(brief(s)));
  console.log(' falsePostsByStatus', JSON.stringify(report.syntheticHeldOut.falsePostsByStatus));
  return report;
}

if (require.main === module) main();
module.exports = { evaluate };
