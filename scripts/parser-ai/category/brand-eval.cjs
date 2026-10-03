'use strict';
/**
 * Rules vs rules+curated-brand-table, on two descriptor sets:
 *   1. phase-1 labelled merchants (merchants.cjs, 691 rows) — the table was
 *      NOT fitted to these; they are a second, independent check.
 *   2. brand-test-descriptors.cjs — brand names rendered through statement
 *      noise, ~30% deliberately out-of-table merchants.
 *
 * "before" calls categorizeMerchant the way run-category.cjs does (market only
 * for AE/SA), which the brand table never touches. "after" passes the row's
 * country as the market, which is what enables the fallback. Phase-1 GENERIC
 * rows use ZZ: a non-AE/SA user whose country the table has no block for, so
 * only GLOBAL (ungated) patterns can apply.
 *
 *   node scripts/parser-ai/category/brand-eval.cjs [--json out.json] [--misses]
 */
const fs = require('node:fs');
const { createLoader } = require('../../universal-test/load-ts.cjs');
const { MERCHANTS } = require('./merchants.cjs');
const { DESCRIPTORS } = require('./brand-test-descriptors.cjs');

const load = createLoader();
const { categorizeMerchant } = load('@/lib/universal-categorization');
const { brandTableStats } = load('@/lib/brand-categories');

const run = (merchant, market) => categorizeMerchant({ merchant, type: 'expense', meaning: 'purchase', market });
const resolved = (r) => r.source !== 'unresolved' && r.category !== 'other';

function evaluate(rows, marketOf) {
  const stat = () => ({ n: 0, before: 0, after: 0, beforeCov: 0, afterCov: 0, beforeCovOk: 0, afterCovOk: 0, brandFired: 0, brandOk: 0, changedResolved: 0 });
  const by = { all: stat() };
  const misses = [];
  for (const row of rows) {
    const country = row.country;
    const before = run(row.descriptor, country === 'AE' || country === 'SA' ? country : undefined);
    const after = run(row.descriptor, marketOf(country));
    const fired = after.reason === 'curated-brand-table';
    const groups = [by.all, by[country] ??= stat()];
    if (row.inTable !== undefined) groups.push(by[row.inTable ? 'inTable' : 'outOfTable'] ??= stat());
    if (row.inTable === false) groups.push(by[row.lookalike ? 'outLookalike' : 'outPlain'] ??= stat());
    for (const s of groups) {
      s.n += 1;
      if (before.category === row.category) s.before += 1;
      if (after.category === row.category) s.after += 1;
      if (resolved(before)) { s.beforeCov += 1; if (before.category === row.category) s.beforeCovOk += 1; }
      if (resolved(after)) { s.afterCov += 1; if (after.category === row.category) s.afterCovOk += 1; }
      if (fired) { s.brandFired += 1; if (after.category === row.category) s.brandOk += 1; }
      // The fallback must never alter a result the rules already produced.
      if (resolved(before) && (after.category !== before.category || after.source !== before.source)) s.changedResolved += 1;
    }
    if (fired && after.category !== row.category) misses.push({ kind: 'brand-wrong', country, descriptor: row.descriptor, want: row.category, got: after.category, inTable: row.inTable });
    else if (!resolved(after) && row.inTable) misses.push({ kind: 'in-table-unresolved', country, descriptor: row.descriptor, want: row.category });
  }
  const r = (a, b) => (b ? Number((a / b).toFixed(4)) : null);
  const summary = Object.fromEntries(Object.entries(by).map(([k, s]) => [k, {
    n: s.n,
    accuracy: { before: r(s.before, s.n), after: r(s.after, s.n) },
    coverage: { before: r(s.beforeCov, s.n), after: r(s.afterCov, s.n) },
    precision: { before: r(s.beforeCovOk, s.beforeCov), after: r(s.afterCovOk, s.afterCov) },
    brandFired: s.brandFired, brandPrecision: r(s.brandOk, s.brandFired), brandWrong: s.brandFired - s.brandOk,
    changedResolved: s.changedResolved,
  }]));
  return { summary, misses };
}

function print(title, { summary }) {
  console.log(`\n== ${title}`);
  const line = (k, s) => `${k.padEnd(10)} n=${String(s.n).padStart(4)}  acc ${s.accuracy.before}->${s.accuracy.after}  cov ${s.coverage.before}->${s.coverage.after}  prec ${s.precision.before}->${s.precision.after}  brand fired ${s.brandFired} (prec ${s.brandPrecision}, wrong ${s.brandWrong})  changedResolved ${s.changedResolved}`;
  for (const [k, s] of Object.entries(summary)) console.log(line(k, s));
}

function main() {
  const args = process.argv.slice(2);
  const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
  const phase1 = evaluate(MERCHANTS, (c) => (c === 'GENERIC' ? 'ZZ' : c));
  const heldOut = evaluate(DESCRIPTORS, (c) => c);
  const stats = brandTableStats();
  console.log('brand table:', { patterns: stats.patterns, gated: stats.gated, countries: stats.countries.length });
  print('phase-1 merchants.cjs', phase1);
  print('brand-test-descriptors.cjs', heldOut);
  const out = heldOut.summary.outOfTable;
  if (out) {
    console.log(`\nout-of-table false categorisation by brand layer: ${out.brandWrong}/${out.n} = ${(out.brandWrong / out.n).toFixed(4)} (fired on ${out.brandFired})`);
    for (const key of ['outPlain', 'outLookalike']) {
      const s = heldOut.summary[key];
      if (s) console.log(`  ${key}: ${s.brandWrong}/${s.n} = ${(s.brandWrong / s.n).toFixed(4)} wrong (fired on ${s.brandFired})`);
    }
  }
  if (args.includes('--misses')) {
    for (const [name, res] of [['phase-1', phase1], ['held-out', heldOut]]) {
      console.log(`\n-- ${name} misses`);
      for (const m of res.misses) console.log(JSON.stringify(m));
    }
  }
  const totalChanged = phase1.summary.all.changedResolved + heldOut.summary.all.changedResolved;
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ stats, phase1: phase1.summary, heldOut: heldOut.summary }, null, 1) + '\n');
  if (totalChanged) { console.error(`FAIL: ${totalChanged} rule-resolved rows changed`); process.exitCode = 1; }
}

if (require.main === module) main();
module.exports = { evaluate };
