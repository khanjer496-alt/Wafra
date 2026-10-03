'use strict';
/**
 * Build the fixed evaluation subsets for the zero-shot LLM comparison (phase 2, item J).
 * Writes JSONL rows to a SCRATCH directory (never the repository):
 *
 *   synth.jsonl   stratified sample of the phase-1 held-out synthetic TEST split (unseen templates)
 *   synth2.jsonl  stratified sample of the phase-2 generator's held-out test + held-out-author splits
 *   repo.jsonl    all labelled repo fixtures (independently authored)
 *   public.jsonl  public real samples (scripts/test/fixtures/public-real-samples.js) when present
 *   uae.jsonl     OPTIONAL private owner export (--uae <export.json>): stratified sample of weak labels;
 *                 stays in scratch, deleted after the run, aggregates only are ever reported
 *
 *   node scripts/parser-ai/llm/build-sets.cjs <outDir> [--n 700] [--uae file]
 */
const fs = require('node:fs');
const path = require('node:path');
const { generate } = require('../synth/generate.cjs');
const { buildRepoEvalSet } = require('../repo-eval-set.cjs');

function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic stratified sample: round-robin over (language, status) buckets. */
function stratified(rows, n, seed = 7) {
  const rnd = rngFrom(seed);
  const buckets = new Map();
  for (const r of rows) {
    const k = `${r.language}|${r.label.status}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  }
  for (const list of buckets.values()) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  }
  const out = [];
  const lists = [...buckets.keys()].sort().map((k) => buckets.get(k));
  for (let i = 0; out.length < n && lists.some((l) => l.length > i); i++) {
    for (const l of lists) if (l[i] && out.length < n) out.push(l[i]);
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const outDir = args[0];
  if (!outDir) throw new Error('usage: build-sets.cjs <outDir> [--n 700] [--uae file]');
  const n = args.includes('--n') ? Number(args[args.indexOf('--n') + 1]) : 700;
  const uae = args.includes('--uae') ? args[args.indexOf('--uae') + 1] : null;
  fs.mkdirSync(outDir, { recursive: true });
  const write = (name, rows) => {
    fs.writeFileSync(path.join(outDir, name), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return rows.length;
  };
  const counts = {};
  counts.synth = write('synth.jsonl', stratified(generate().filter((r) => r.split === 'test'), n));
  try {
    const { generateV2 } = require('../synth/generate-v2.cjs');
    const v2 = generateV2().filter((r) => r.split === 'test' || r.split === 'author');
    counts.synth2 = write('synth2.jsonl', stratified(v2, n, 11));
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
  }
  counts.repo = write('repo.jsonl', buildRepoEvalSet());
  try {
    const { buildPublicRealEvalSet } = require('../public-real-eval-set.cjs');
    counts.public = write('public.jsonl', buildPublicRealEvalSet());
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
  }
  if (uae) {
    const { buildPrivateUaeRows } = require('../private-uae.cjs');
    const rows = buildPrivateUaeRows(uae).map(({ tx, ...row }) => row);
    const pos = stratified(rows.filter((r) => r.weak === 'ledger'), Math.round(n * 0.7), 3);
    const neg = stratified(rows.filter((r) => r.weak !== 'ledger'), Math.round(n * 0.3), 5);
    counts.uae = write('uae.jsonl', [...pos, ...neg]);
  }
  console.log(JSON.stringify(counts));
}

if (require.main === module) main();
module.exports = { stratified };
