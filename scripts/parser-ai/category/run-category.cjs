'use strict';
/**
 * Merchant -> category: current rule vocabulary vs a char-n-gram linear model.
 *
 * Rules: universal-categorization.categorizeMerchant (AE/SA market-aware).
 * Model: hashed char 2-5-grams + word unigrams, multinomial logistic
 * regression (SGD), 5-fold cross-validation GROUPED BY BRAND so no brand is in
 * both training and evaluation. Hybrid: rules when they resolve, model otherwise.
 *
 *   node scripts/parser-ai/category/run-category.cjs [--json out.json]
 */
const fs = require('node:fs');
const { MERCHANTS } = require('./merchants.cjs');
const { categorize } = require('../pipeline.cjs');

const DIM = 1 << 18;
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % DIM;
}
function features(descriptor) {
  const text = descriptor.toLowerCase().replace(/\d+/g, '0').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const f = new Map();
  const add = (k) => { const i = hash(k); f.set(i, (f.get(i) ?? 0) + 1); };
  for (const w of text.split(' ')) {
    if (!w) continue;
    add(`w:${w}`);
    const p = ` ${w} `;
    for (let n = 2; n <= 5; n++) for (let i = 0; i + n <= p.length; i++) add(`c:${p.slice(i, i + n)}`);
  }
  const norm = Math.sqrt([...f.values()].reduce((a, v) => a + v * v, 0)) || 1;
  return [...f.entries()].map(([i, v]) => [i, v / norm]);
}

function train(rows, labels, { epochs = 40, lr = 0.5, l2 = 1e-5 } = {}) {
  const K = labels.length;
  const W = Array.from({ length: K }, () => new Float32Array(DIM));
  const b = new Float32Array(K);
  const data = rows.map((r) => ({ x: features(r.descriptor), y: labels.indexOf(r.category) }));
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let e = 0; e < epochs; e++) {
    for (let i = data.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [data[i], data[j]] = [data[j], data[i]]; }
    const rate = lr / (1 + e * 0.1);
    for (const { x, y } of data) {
      const z = new Float64Array(K);
      for (let k = 0; k < K; k++) { let s = b[k]; for (const [i, v] of x) s += W[k][i] * v; z[k] = s; }
      const m = Math.max(...z); let sum = 0;
      for (let k = 0; k < K; k++) { z[k] = Math.exp(z[k] - m); sum += z[k]; }
      for (let k = 0; k < K; k++) {
        const g = z[k] / sum - (k === y ? 1 : 0);
        b[k] -= rate * g;
        for (const [i, v] of x) W[k][i] -= rate * (g * v + l2 * W[k][i]);
      }
    }
  }
  return (descriptor) => {
    const x = features(descriptor);
    const z = labels.map((_, k) => { let s = b[k]; for (const [i, v] of x) s += W[k][i] * v; return s; });
    const m = Math.max(...z); const e = z.map((v) => Math.exp(v - m)); const s = e.reduce((a, v) => a + v, 0);
    let best = 0; for (let k = 1; k < K; k++) if (e[k] > e[best]) best = k;
    return { category: labels[best], p: e[best] / s };
  };
}

function main() {
  const args = process.argv.slice(2);
  const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
  const labels = [...new Set(MERCHANTS.map((m) => m.category))].sort();
  const groups = [...new Set(MERCHANTS.map((m) => m.group))].sort();
  const foldOf = (g) => { let h = 0; for (const c of g) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 5; };
  const preds = new Map();
  const t0 = Date.now();
  for (let fold = 0; fold < 5; fold++) {
    const tr = MERCHANTS.filter((m) => foldOf(m.group) !== fold);
    const te = MERCHANTS.filter((m) => foldOf(m.group) === fold);
    const model = train(tr, labels);
    for (const m of te) preds.set(m, model(m.descriptor));
  }
  const trainMs = Date.now() - t0;
  const stat = () => ({ n: 0, rules: 0, rulesCovered: 0, rulesCoveredOk: 0, model: 0, hybrid: 0, modelConf: 0, modelConfOk: 0 });
  const by = { all: stat() };
  const confusions = {};
  for (const m of MERCHANTS) {
    const rule = categorize(m.descriptor, m.country === 'AE' || m.country === 'SA' ? m.country : undefined);
    const resolved = rule.source !== 'unresolved' && rule.category !== 'other';
    const model = preds.get(m);
    const hybrid = resolved ? rule.category : model.category;
    for (const s of [by.all, by[m.country] ??= stat()]) {
      s.n += 1;
      if (rule.category === m.category) s.rules += 1;
      if (resolved) { s.rulesCovered += 1; if (rule.category === m.category) s.rulesCoveredOk += 1; }
      if (model.category === m.category) s.model += 1;
      if (hybrid === m.category) s.hybrid += 1;
      if (model.p >= 0.6) { s.modelConf += 1; if (model.category === m.category) s.modelConfOk += 1; }
    }
    if (resolved && rule.category !== m.category) {
      const k = `${m.category}->${rule.category}`; confusions[k] = (confusions[k] ?? 0) + 1;
    }
  }
  const r = (a, b) => (b ? Number((a / b).toFixed(4)) : null);
  const summary = Object.fromEntries(Object.entries(by).map(([k, s]) => [k, {
    n: s.n,
    rulesAccuracy: r(s.rules, s.n), rulesCoverage: r(s.rulesCovered, s.n), rulesPrecision: r(s.rulesCoveredOk, s.rulesCovered),
    modelAccuracy: r(s.model, s.n), modelConfidentCoverage: r(s.modelConf, s.n), modelConfidentPrecision: r(s.modelConfOk, s.modelConf),
    hybridAccuracy: r(s.hybrid, s.n),
  }]));
  const report = { merchants: MERCHANTS.length, brands: groups.length, categories: labels.length, folds: 5, trainMsTotal: trainMs,
    summary, topRuleConfusions: Object.entries(confusions).sort((a, b) => b[1] - a[1]).slice(0, 10) };
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1) + '\n');
  console.log(JSON.stringify(report.summary.all), report.topRuleConfusions);
  for (const [k, s] of Object.entries(summary)) if (k !== 'all') console.log(k, s.n, 'rules', s.rulesAccuracy, 'cov', s.rulesCoverage, 'model', s.modelAccuracy, 'hybrid', s.hybridAccuracy);
  return report;
}

if (require.main === module) main();
