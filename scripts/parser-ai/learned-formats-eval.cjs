'use strict';
/**
 * Measures per-user format learning (src/lib/learned-alert-formats.ts) on the
 * synthetic multilingual generator.
 *
 * For every (template, sender) group the first 1 (then 2) POSTING messages are
 * "confirmed" with their TRUE labels. The learned store is then matched on
 *   - the remaining messages of the same group        → coverage + precision
 *   - every message of OTHER templates, same sender    → cross-template matches
 * A match is correct when amount, currency and direction all equal the truth
 * and the message is a posting one. Any match on a non-posting message (otp,
 * pending, declined, promo, balance, statement, request, future) is a false
 * match.
 *
 *   node scripts/parser-ai/learned-formats-eval.cjs [--generator v1|v2|path] [--seed n] [--json]
 * --generator defaults to v1 (synth/generate.cjs); v2 is synth/generate-v2.cjs;
 * a path to any module exporting generate() or generateV2() with the same row
 * shape also works. Every split (train/dev/test/author) is used.
 */
const path = require('node:path');
const { createLoader } = require('../universal-test/load-ts.cjs');

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const GENERATORS = { v1: path.join(__dirname, 'synth/generate.cjs'), v2: path.join(__dirname, 'synth/generate-v2.cjs') };
const generatorArg = arg('--generator', 'v1');
const generatorPath = GENERATORS[generatorArg] ?? path.resolve(process.cwd(), generatorArg);
const seed = args.includes('--seed') ? Number(arg('--seed')) : undefined;
const asJson = args.includes('--json');

const L = createLoader()('@/lib/learned-alert-formats');
const generatorModule = require(generatorPath);
const generate = generatorModule.generate ?? generatorModule.generateV2;
if (typeof generate !== 'function') throw new Error(`${generatorPath} exports neither generate() nor generateV2()`);
const rows = generate(seed === undefined ? {} : { seed });
const NOW = Date.parse('2026-09-25T12:00:00Z');
const LAUNCH = new Set(['AE', 'SA']);

const confirmationOf = (row) => ({
  amountMinor: row.label.amount.minor,
  currency: row.label.amount.currency,
  exponent: row.label.amount.exponent,
  direction: row.label.direction,
  merchant: row.label.merchant ?? null,
  date: row.label.date ?? null,
});
const isPosting = (row) => row.label.shouldPost && row.label.amount &&
  (row.label.direction === 'debit' || row.label.direction === 'credit');
const correct = (row, fields) => isPosting(row) &&
  String(fields.amountMinor) === String(row.label.amount.minor) &&
  fields.currency === row.label.amount.currency && fields.direction === row.label.direction;
const routed = (row) => (LAUNCH.has(row.country) ? row.country : null);

const groups = new Map();
for (const row of rows) {
  const key = `${row.template}\u0001${row.sender}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}
const bySender = new Map();
for (const row of rows) {
  if (!bySender.has(row.sender)) bySender.set(row.sender, []);
  bySender.get(row.sender).push(row);
}

function blank() {
  return {
    groups: 0, learnedGroups: 0, refusals: {},
    remaining: 0, sameShape: 0, sameShapeMatched: 0, matched: 0, posted: 0, prefilled: 0, correctMatches: 0,
    crossChecked: 0, crossMatches: 0, crossWrong: 0,
    nonPostingChecked: 0, nonPostingFalse: 0,
  };
}

function run(k) {
  const total = blank();
  const byLang = {};
  const lang = (name) => (byLang[name] ??= blank());
  const examples = [];
  for (const group of groups.values()) {
    const posting = group.filter(isPosting);
    if (!posting.length) continue;
    const first = group[0];
    const stats = [total, lang(first.language)];
    for (const s of stats) s.groups++;
    let store = L.emptyLearnedFormatStore();
    const confirmed = posting.slice(0, k);
    let learnedAny = false;
    for (const row of confirmed) {
      const result = L.recordLearnedConfirmation(store, {
        source: row.body, sender: row.sender, confirmed: confirmationOf(row),
        context: { country: row.country, routedMarket: routed(row) }, now: NOW,
      });
      if (result.ok) { store = result.store; learnedAny = true; }
      else for (const s of stats) s.refusals[result.reason] = (s.refusals[result.reason] ?? 0) + 1;
    }
    if (learnedAny) for (const s of stats) s.learnedGroups++;
    const confirmedIds = new Set(confirmed.map((row) => row.id));
    const match = (row) => L.matchLearnedFormat(row.body, row.sender, store, { postThreshold: 2, now: NOW, routedMarket: routed(row) });
    // Same template, remaining messages.
    for (const row of posting) {
      if (confirmedIds.has(row.id)) continue;
      for (const s of stats) s.remaining++;
      if (!learnedAny) continue;
      const hit = match(row);
      // Ceiling: would this message itself have induced an already-learned shape?
      const own = L.learnFromConfirmation({ source: row.body, sender: row.sender, confirmed: confirmationOf(row),
        context: { country: row.country, routedMarket: routed(row) }, now: NOW });
      const same = own.ok && store.templates.some((template) => template.id === own.template.id && template.currency === own.template.currency);
      if (same) for (const s of stats) { s.sameShape++; if (hit.kind !== 'none') s.sameShapeMatched++; }
      if (hit.kind === 'none') continue;
      const good = correct(row, hit.fields);
      for (const s of stats) {
        s.matched++;
        if (hit.kind === 'post') s.posted++; else s.prefilled++;
        if (good) s.correctMatches++;
      }
      if (!good && examples.length < 12) examples.push({ kind: 'same-template', template: row.template, body: row.body, got: hit.fields, truth: row.label });
    }
    if (!learnedAny) continue;
    // Other templates, same sender (including every non-posting template).
    for (const row of bySender.get(first.sender)) {
      if (row.template === first.template) continue;
      const hit = match(row);
      const rowStats = [total, lang(row.language)];
      for (const s of rowStats) {
        s.crossChecked++;
        if (!isPosting(row)) s.nonPostingChecked++;
      }
      if (hit.kind === 'none') continue;
      const good = correct(row, hit.fields);
      for (const s of rowStats) {
        s.crossMatches++;
        if (!good) s.crossWrong++;
        if (!isPosting(row)) s.nonPostingFalse++;
      }
      if (!good && examples.length < 12) examples.push({ kind: 'cross-template', learnedFrom: first.template, template: row.template, body: row.body, got: hit.fields, truth: row.label });
    }
  }
  return { total, byLang, examples };
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
const summarise = (s) => ({
  groups: s.groups,
  learnedGroups: s.learnedGroups,
  coverage: pct(s.matched, s.remaining),
  sameShareOfRemaining: pct(s.sameShape, s.remaining),
  coverageOfSameShape: pct(s.sameShapeMatched, s.sameShape),
  postCoverage: pct(s.posted, s.remaining),
  precision: pct(s.correctMatches, s.matched),
  matched: s.matched, remaining: s.remaining,
  crossTemplateMatches: s.crossMatches, crossTemplateWrong: s.crossWrong, crossChecked: s.crossChecked,
  nonPostingFalseMatches: s.nonPostingFalse, nonPostingChecked: s.nonPostingChecked,
  refusals: s.refusals,
});

const report = { generator: path.relative(process.cwd(), generatorPath), rows: rows.length, groups: groups.size };
for (const k of [1, 2]) {
  const { total, byLang, examples } = run(k);
  report[`after${k}`] = {
    total: summarise(total),
    byLanguage: Object.fromEntries(Object.entries(byLang).sort().map(([name, s]) => [name, summarise(s)])),
    wrongExamples: examples,
  };
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`rows ${report.rows}, (template,sender) groups ${report.groups}, generator ${report.generator}`);
  for (const k of [1, 2]) {
    const r = report[`after${k}`];
    const t = r.total;
    console.log(`\n== after ${k} confirmation(s) ==`);
    console.log(`TOTAL learned ${t.learnedGroups}/${t.groups} groups | coverage ${t.coverage} (post ${t.postCoverage}) of ${t.remaining} | same-shape ${t.sameShareOfRemaining}, matched ${t.coverageOfSameShape} of those | precision ${t.precision} of ${t.matched} | cross-template matches ${t.crossTemplateMatches} (wrong ${t.crossTemplateWrong}) of ${t.crossChecked} | non-posting false ${t.nonPostingFalseMatches}/${t.nonPostingChecked}`);
    console.log(`refusals ${JSON.stringify(t.refusals)}`);
    for (const [name, s] of Object.entries(r.byLanguage)) {
      console.log(`  ${name.padEnd(8)} learned ${String(s.learnedGroups).padStart(3)}/${String(s.groups).padEnd(3)} coverage ${s.coverage.padStart(6)} post ${s.postCoverage.padStart(6)} precision ${s.precision.padStart(6)} (${s.matched}) same-shape-cov ${s.coverageOfSameShape} cross ${s.crossTemplateMatches}/${s.crossTemplateWrong} nonpost-false ${s.nonPostingFalseMatches}`);
    }
    for (const example of r.wrongExamples.slice(0, 6)) console.log('  WRONG', JSON.stringify(example));
  }
}
