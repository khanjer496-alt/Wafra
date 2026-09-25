'use strict';
/**
 * Score model readings (tagger spans or zero-shot LLM JSON) through the SHIPPED
 * deterministic gate src/lib/ai-alert-extractor.ts (gateAiAlert), next to the
 * current rules, with the same scorer as the phase-1 baseline. Metrics only.
 *
 *   node scripts/parser-ai/score-ai.cjs <rows.jsonl> <pred.jsonl> --engine tagger|llm
 *        [--json out] [--sweep] [--by language|country]
 *
 * Variants:
 *   rules        current pipeline (createLaunchAlertSession as capture calls it)
 *   aiPost       gate outcome 'post' only (language gates forced open, auto-post ON)
 *   hybrid       rules first; aiPost only where rules did not post (the proposed product)
 *   prefill      rows the gate would PREFILL into Review (outcome prefill|post) —
 *                reported as coverage and field accuracy; never a ledger row
 * --sweep evaluates the tagger at a grid of post thresholds and prints the
 * operating points (false-post rate vs coverage).
 */
const fs = require('node:fs');
const { createLoader } = require('../universal-test/load-ts.cjs');
const { runLedger, OBSERVED_AT } = require('./pipeline.cjs');
const { newBucket, scoreRow, summarize, sameAmount, sameCurrency } = require('./score.cjs');
const { COUNTRY_CURRENCY } = require('./schema.cjs');

const load = createLoader();
const gate = load('@/lib/ai-alert-extractor');
const country = load('@/lib/country');
const currencyMeta = load('@/lib/currency-metadata');

const read = (p) => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const fxStub = (base, quote, date) => ({ base, quote, rate: 1, date });

const findSpan = (body, text, label, from = 0) => {
  const t = (text ?? '').trim();
  if (!t) return null;
  let i = body.indexOf(t, from);
  if (i < 0) i = body.indexOf(t);
  if (i < 0) {
    const lower = body.toLowerCase();
    i = lower.indexOf(t.toLowerCase());
    if (i < 0) return null;
  }
  return { label, start: i, end: i + t.length, p: 1 };
};

const words = load('@/lib/ai-alert-words');
const numVals = (t) => {
  const d = t.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/[٫]/g, '.').replace(/[٬\s'’]/g, '');
  const out = new Set();
  const m = d.match(/^(.*?)([.,])(\d{1,3})$/);
  out.add(Number(d.replace(/[.,]/g, '')));
  if (m) out.add(Number(`${m[1].replace(/[.,]/g, '')}.${m[3]}`));
  return [...out].filter(Number.isFinite);
};
/**
 * Locate the LLM's amount in the text. Exact substring first; otherwise the
 * UNIQUE number token in the body whose value equals the LLM's number (LLMs
 * rewrite "32,70" as "32.70"). The gate still re-grounds the span.
 */
function findAmount(body, text) {
  const exact = findSpan(body, text, 'AMT');
  if (exact) return exact;
  const t = (text ?? '').replace(/[^\d.,٠-٩٫٬]/g, '');
  if (!/\d|[٠-٩]/.test(t)) return null;
  const want = numVals(t.includes('.') && t.includes(',') ? t.replace(/,/g, '') : t);
  const hits = words.alertWords(body).filter((w) => /^[\d٠-٩]/.test(w.text) && numVals(w.text).some((v) => want.includes(v)));
  return hits.length === 1 ? { label: 'AMT', start: hits[0].start, end: hits[0].end, p: 1 } : null;
}

/** Zero-shot LLM JSON → engine-agnostic prediction (spans located in the text; no probabilities). */
function fromLlm(row, pred) {
  const spans = [];
  const amt = findAmount(row.body, pred.amountText);
  if (amt) spans.push(amt);
  const cur = findSpan(row.body, pred.currencyText, 'CUR', amt ? Math.max(0, amt.start - 8) : 0);
  if (cur) spans.push(cur);
  const mer = findSpan(row.body, pred.merchant, 'MER');
  if (mer) spans.push(mer);
  const date = findSpan(row.body, pred.dateText, 'DATE');
  if (date) spans.push(date);
  return {
    engine: 'llm', modelVersion: 'llm', status: pred.status, statusP: 1, family: pred.family, familyP: 1,
    direction: pred.direction, directionP: 1, spans,
  };
}

const fromTagger = (row, pred) => ({ engine: 'tagger', modelVersion: 'tagger', ...pred, spans: pred.spans ?? [] });

let DROP_SENDER = false;
function context(row) {
  const cc = row.country === 'ZZ' ? null : row.country;
  const cur = COUNTRY_CURRENCY[row.country] ?? null;
  return {
    sender: DROP_SENDER ? '' : row.sender ?? '', country: cc, routedMarket: null,
    ledgerCurrency: cur, ledgerExponent: cur ? currencyMeta.currencyMinorUnits(cur) : null,
    observedAt: OBSERVED_AT, fxLookup: fxStub, dateOrder: country.dateOrderForCountry(cc) ?? undefined,
    autoPostEnabled: true, bestEffortEnabled: true, evaluationLanguageGate: () => true,
  };
}

const AI_FAMILY = { purchase: 'purchase', refund: 'refund', transfer: 'transfer', salary: 'salary', fee: 'fee', withdrawal: 'withdrawal', 'bill-payment': 'bill-payment', 'card-payment': 'card-payment' };

function toLedger(result) {
  if (result.outcome !== 'post') return { posted: false, reason: result.outcome === 'refuse' ? result.reason : result.blockers.join(',') };
  const f = result.fields;
  return {
    posted: true, amount: { minor: f.money.minorUnits, currency: f.money.currency }, direction: f.direction,
    merchant: f.merchant, date: f.date, family: AI_FAMILY[f.family] ?? f.family,
  };
}

function scoreSet(rows, preds, engine, thresholds, keys = ['all']) {
  const byId = new Map(preds.map((p) => [p.id, p]));
  const V = { rules: {}, aiPost: {}, hybrid: {} };
  const pre = { rows: 0, shouldPost: 0, prefilledPos: 0, prefilledNeg: 0, neg: 0, amountOk: 0, dirOk: 0, merOk: 0, merN: 0, allOk: 0 };
  const reasons = {};
  const falsePostIds = [];
  let ms = [];
  for (const row of rows) {
    const p = byId.get(row.id);
    if (!p) continue;
    if (p.ms) ms.push(p.ms);
    const prediction = engine === 'llm' ? fromLlm(row, p) : fromTagger(row, p);
    let result;
    try { result = gate.gateAiAlert(row.body, prediction, context(row), thresholds); }
    catch (e) { result = { outcome: 'refuse', reason: `error:${e.message}` }; }
    const rules = row._rules ??= runLedger(row);
    const ai = toLedger(result);
    const hybrid = rules.posted ? rules : ai;
    const key = result.outcome === 'refuse' ? `refuse:${result.reason}` : result.outcome === 'prefill' ? `prefill:${result.blockers[0]}` : 'post';
    reasons[key] = (reasons[key] ?? 0) + 1;
    if (ai.posted && !row.label.shouldPost) falsePostIds.push(row.id);
    for (const k of keys) {
      const bucketKey = k === 'all' ? 'all' : `${k}:${row[k]}`;
      scoreRow(V.rules[bucketKey] ??= newBucket(), row, rules, null);
      scoreRow(V.aiPost[bucketKey] ??= newBucket(), row, ai, null);
      scoreRow(V.hybrid[bucketKey] ??= newBucket(), row, hybrid, null);
    }
    // Prefill: what a Review card would show (rules did not post).
    if (!rules.posted) {
      pre.rows++;
      const L = row.label;
      const prefilled = result.outcome !== 'refuse';
      if (L.shouldPost) {
        pre.shouldPost++;
        if (prefilled) {
          pre.prefilledPos++;
          const f = result.fields;
          const money = { minor: f.money.minorUnits, currency: f.money.currency };
          const amountOk = !L.amount || (sameAmount(money, L.amount) && sameCurrency(money, L.amount));
          if (amountOk) pre.amountOk++;
          if (f.direction === L.direction) pre.dirOk++;
          if (L.merchant) { pre.merN++; if ((f.merchant ?? '').toLowerCase().trim() === L.merchant.toLowerCase().trim()) pre.merOk++; }
          if (amountOk && f.direction === L.direction) pre.allOk++;
        }
      } else {
        pre.neg++;
        if (prefilled) pre.prefilledNeg++;
      }
    }
  }
  const r = (a, b) => (b ? Number((a / b).toFixed(4)) : null);
  const out = {};
  for (const [v, buckets] of Object.entries(V)) out[v] = Object.fromEntries(Object.entries(buckets).map(([k, b]) => [k, summarize(b)]));
  ms.sort((a, b) => a - b);
  out.prefill = {
    rulesMissedShouldPost: pre.shouldPost, prefillCoverage: r(pre.prefilledPos, pre.shouldPost),
    amountCurrencyCorrect: r(pre.amountOk, pre.prefilledPos), directionCorrect: r(pre.dirOk, pre.prefilledPos),
    amountAndDirectionCorrect: r(pre.allOk, pre.prefilledPos), merchantExact: r(pre.merOk, pre.merN),
    nonPostingPrefilled: r(pre.prefilledNeg, pre.neg), nonPostingRowsSeen: pre.neg,
  };
  out.gateOutcomes = reasons;
  out.falsePostIds = falsePostIds.slice(0, 50);
  out.latencyMs = ms.length ? { p50: ms[Math.floor(ms.length / 2)], p95: ms[Math.floor(ms.length * 0.95)] } : null;
  return out;
}

const brief = (s) => s && ({ n: s.n, recall: s.ledger.autoPostRecall, falsePost: s.ledger.falsePostRate, fp: s.ledger.falsePosts,
  precision: s.ledger.postedPrecision, e2e: s.ledger.endToEnd });

function main() {
  const args = process.argv.slice(2);
  const [rowsPath, predPath] = args;
  const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const engine = opt('--engine') ?? 'tagger';
  // --no-sender: measure model agreement on AE/SA data the shipped gate would never read.
  DROP_SENDER = args.includes('--no-sender');
  const by = opt('--by');
  const rows = read(rowsPath);
  const preds = read(predPath);
  const keys = by ? ['all', ...by.split(',')] : ['all'];
  const base = { ...gate.DEFAULT_AI_THRESHOLDS };
  const report = { rows: rows.length, engine, thresholds: base, ...scoreSet(rows, preds, engine, base, keys) };
  if (args.includes('--sweep') && engine === 'tagger') {
    report.sweep = [];
    for (const t of [0.9, 0.95, 0.98, 0.99, 0.995, 0.999]) {
      const th = { ...base, postStatus: t, postDirection: t, postFamily: Math.min(t, 0.99), postAmount: Math.min(t, 0.99) };
      const s = scoreSet(rows, preds, engine, th);
      report.sweep.push({ t, aiPost: brief(s.aiPost.all), hybrid: brief(s.hybrid.all) });
    }
  }
  const json = opt('--json');
  if (json) fs.writeFileSync(json, JSON.stringify(report, null, 1) + '\n');
  for (const v of ['rules', 'aiPost', 'hybrid']) console.log(v.padEnd(7), JSON.stringify(brief(report[v].all)));
  console.log('prefill', JSON.stringify(report.prefill));
  console.log('gate', JSON.stringify(report.gateOutcomes));
  if (report.sweep) for (const s of report.sweep) console.log('sweep', JSON.stringify(s));
  if (by) for (const [k, s] of Object.entries(report.hybrid)) if (k !== 'all') console.log(' ', k.padEnd(14), 'rules', JSON.stringify(brief(report.rules[k])), 'hybrid', JSON.stringify(brief(s)));
}

if (require.main === module) main();
module.exports = { scoreSet, fromLlm, context };
