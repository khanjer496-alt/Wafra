'use strict';
/**
 * Measure the AI second opinion (src/lib/ai-alert-verifier.ts). Metrics only.
 *
 *   node scripts/parser-ai/verifier-eval.cjs <rows.jsonl> <tagger-pred.jsonl> [--inject] [--json out]
 *
 * Default: over rows the CURRENT rules posted — flag rate (flags / posted),
 * flag precision (flags where the rules reading is wrong vs the label), recall
 * of rule errors, and 'review' flags on rules false posts.
 * --inject (synthetic): pretend the rules read every row; correct readings for
 * should-post rows, plus injected errors (direction flip, amount x10, currency
 * swap) and non-posting rows 'posted' — reports false-flag rate on correct
 * readings and catch rate per injected error type.
 */
const fs = require('node:fs');
const { createLoader } = require('../universal-test/load-ts.cjs');
const { runLedger } = require('./pipeline.cjs');

const load = createLoader();
const V = load('@/lib/ai-alert-verifier');
const read = (p) => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const r4 = (a, b) => (b ? Number((a / b).toFixed(4)) : null);

function main() {
  const args = process.argv.slice(2);
  const [rowsPath, predPath] = args;
  const inject = args.includes('--inject');
  const json = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
  const preds = new Map(read(predPath).map((p) => [p.id, { engine: 'tagger', modelVersion: 't', ...p }]));
  const rows = read(rowsPath).filter((r) => preds.has(r.id));
  const out = {};
  if (inject) {
    const t = { correct: 0, correctFlagged: 0 };
    const kinds = { direction: [0, 0], amount: [0, 0], currency: [0, 0], nonPosting: [0, 0] };
    rows.forEach((row, i) => {
      const p = preds.get(row.id);
      const L = row.label;
      if (L.shouldPost && L.amount) {
        const truth = { minorUnits: L.amount.minor, currency: L.amount.currency, direction: L.direction };
        t.correct++;
        if (V.verifyRulesReading(row.body, truth, p, row.country).verdict !== 'agree') t.correctFlagged++;
        const kind = ['direction', 'amount', 'currency'][i % 3];
        const bad = kind === 'direction' ? { ...truth, direction: truth.direction === 'debit' ? 'credit' : 'debit' }
          : kind === 'amount' ? { ...truth, minorUnits: String(BigInt(truth.minorUnits) * 10n) }
            : { ...truth, currency: truth.currency === 'USD' ? 'EUR' : 'USD' };
        kinds[kind][1]++;
        if (V.verifyRulesReading(row.body, bad, p, row.country).verdict !== 'agree') kinds[kind][0]++;
      } else if (!L.shouldPost && L.amount) {
        kinds.nonPosting[1]++;
        const fake = { minorUnits: L.amount.minor, currency: L.amount.currency, direction: 'debit' };
        if (V.verifyRulesReading(row.body, fake, p, row.country).verdict === 'review') kinds.nonPosting[0]++;
      }
    });
    out.inject = { correctReadings: t.correct, falseFlagRate: r4(t.correctFlagged, t.correct),
      catchRate: Object.fromEntries(Object.entries(kinds).map(([k, [a, b]]) => [k, { n: b, caught: r4(a, b) }])) };
  } else {
    const t = { posted: 0, flagged: 0, review: 0, check: 0, wrong: 0, flaggedWrong: 0, falsePosts: 0, falsePostsReview: 0, byReason: {} };
    for (const row of rows) {
      const rules = runLedger(row);
      if (!rules.posted) continue;
      t.posted++;
      const L = row.label;
      const reading = { minorUnits: rules.amount.minor, currency: rules.amount.currency, direction: rules.direction };
      const v = V.verifyRulesReading(row.body, reading, preds.get(row.id), row.country);
      const wrong = !L.shouldPost || L.direction !== rules.direction ||
        (L.amount && (L.amount.minor !== rules.amount.minor || L.amount.currency !== rules.amount.currency));
      if (wrong) t.wrong++;
      if (!L.shouldPost) t.falsePosts++;
      if (v.verdict !== 'agree') {
        t.flagged++;
        t[v.verdict]++;
        if (wrong) t.flaggedWrong++;
        for (const reason of v.reasons) t.byReason[reason] = (t.byReason[reason] ?? 0) + 1;
        if (!L.shouldPost && v.verdict === 'review') t.falsePostsReview++;
      }
    }
    out.onRulesPosted = { posted: t.posted, flagRate: r4(t.flagged, t.posted), review: t.review, check: t.check,
      flagPrecision: r4(t.flaggedWrong, t.flagged), ruleErrors: t.wrong, ruleErrorRecall: r4(t.flaggedWrong, t.wrong),
      ruleFalsePosts: t.falsePosts, falsePostsSentToReview: t.falsePostsReview, byReason: t.byReason };
  }
  if (json) fs.writeFileSync(json, JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify(out));
}

if (require.main === module) main();
