#!/usr/bin/env node
/**
 * Alert lab runner.
 *
 *   node scripts/alert-lab/run.cjs [--split dev|holdout|all] [--n N] [--seed S]
 *     [--market XX,YY] [--family purchase,...] [--neg K|all] [--inv K|all]
 *     [--path android-sms|ios-history] [--jobs J] [--repo <worktree>]
 *     [--json out.json] [--failures out.jsonl] [--strict] [--show N]
 *     [--no-android-review] [--manifest] [--gate] [--drift K]
 *
 * --n is positives per market x family (per split; --split all runs dev and
 * holdout separately and reports both). --repo is a checkout that has run
 * `bash scripts/test/build.sh`; default is the checkout this script lives in.
 * --strict exits 1 when any WRONG or FALSE-POST case occurs.
 * --drift K runs the template-drift suite (drift.cjs) instead: K label-
 * preserving variants per correctly-booked positive, survival per market x
 * family x operator, and any variant that books WRONG money.
 * --gate runs only the fixed sample of scripts/test/repair/alert-lab.test.cjs
 * and lists cases missing from (or fixed relative to) known-unsafe.json.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');

const DEFAULT_REPO = path.resolve(__dirname, '..', '..');

function parseArgs(argv) {
  const o = { split: 'dev', n: 10, seed: 'alert-lab', markets: null, families: null, neg: 3, inv: 2, paths: null, jobs: Math.max(1, Math.min(4, os.cpus().length - 1)),
    repo: DEFAULT_REPO, json: null, failures: null, strict: false, show: 25, androidReview: true, manifest: false, advBudget: 5000 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === '--split') o.split = next();
    else if (a === '--n') o.n = Number(next());
    else if (a === '--seed') o.seed = next();
    else if (a === '--market') o.markets = next().split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (a === '--family') o.families = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--neg') { const v = next(); o.neg = v === 'all' ? 'all' : Number(v); }
    else if (a === '--inv') { const v = next(); o.inv = v === 'all' ? 'all' : Number(v); }
    else if (a === '--path') o.paths = [next()];
    else if (a === '--jobs') o.jobs = Math.max(1, Number(next()));
    else if (a === '--repo') o.repo = path.resolve(next());
    else if (a === '--json') o.json = next();
    else if (a === '--failures') o.failures = next();
    else if (a === '--strict') o.strict = true;
    else if (a === '--show') o.show = Number(next());
    else if (a === '--no-android-review') o.androidReview = false;
    else if (a === '--manifest') o.manifest = true;
    else if (a === '--gate') o.gate = true;
    else if (a === '--adv-budget') o.advBudget = Number(next());
    else if (a === '--drift') o.drift = Number(next());
    else if (a === '--worker') o.worker = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!['dev', 'holdout', 'all'].includes(o.split)) throw new Error('--split must be dev, holdout or all');
  return o;
}

/** Generate and grade one split for some markets, in this process. */
function runSlice(o, split, markets) {
  const { generate, FAMILIES } = require('./generate.cjs');
  const { createDriver, evaluateRows } = require('./lab-eval.cjs');
  const driver = createDriver(o.repo);
  if (o.drift) {
    // Drift suite: positives only; specs are kept (non-enumerable) in-process.
    const { evaluateDrift } = require('./drift.cjs');
    const positives = generate({ split, n: o.n, seed: o.seed, markets, families: o.families ?? FAMILIES, neg: 0, inv: 0 });
    return evaluateDrift(driver, positives, { K: o.drift, seed: `${o.seed}:drift`, paths: o.paths ?? undefined });
  }
  const rows = generate({ split, n: o.n, seed: o.seed, markets, families: o.families ?? FAMILIES, neg: o.neg, inv: o.inv });
  return evaluateRows(driver, rows, { paths: o.paths ?? undefined, androidReview: o.androidReview, failureCap: o.failures ? 2 : 0 });
}

async function runSplit(o, split) {
  const { MARKETS } = require('./inventory/markets.cjs');
  const { mergeReports, emptyReport } = require('./lab-eval.cjs');
  const markets = o.markets ?? MARKETS.map((m) => m.id);
  const jobs = Math.min(o.jobs, markets.length);
  if (jobs <= 1) return runSlice(o, split, markets);
  // Contiguous chunks merged in order, so cluster examples do not depend on --jobs.
  const size = Math.ceil(markets.length / jobs);
  const groups = Array.from({ length: jobs }, (_, i) => markets.slice(i * size, (i + 1) * size)).filter((g) => g.length);
  const parts = await Promise.all(groups.map((group) => new Promise((resolve, reject) => {
    const child = fork(__filename, ['--worker'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    child.once('message', (msg) => (msg.error ? reject(new Error(msg.error)) : resolve(msg.report)));
    child.once('error', reject);
    child.once('exit', (code) => { if (code) reject(new Error(`worker exited ${code}`)); });
    child.send({ o, split, markets: group });
  })));
  // Merge in market order so cluster examples are deterministic.
  if (o.drift) {
    const { mergeDrift, emptyDrift } = require('./drift.cjs');
    return parts.reduce((acc, r) => mergeDrift(acc, r), emptyDrift());
  }
  return parts.reduce((acc, r) => mergeReports(acc, r), emptyReport());
}

// --------------------------------------------------------------------------
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

function sumCells(cells) {
  const out = { pos: 0, ok: 0, review: 0, miss: 0, wrong: 0, soft: 0, neg: 0, held: 0, obligation: 0, reminder: 0, fp: 0, inv: 0, invViol: 0, invWrong: 0, negWrong: 0, error: 0 };
  for (const c of cells) for (const k of Object.keys(out)) out[k] += c[k] ?? 0;
  return out;
}

function printSplit(split, report, o) {
  const { MARKETS } = require('./inventory/markets.cjs');
  const { FAMILIES } = require('./generate.cjs');
  const paths = o.paths ?? ['android-sms', 'ios-history'];
  const lines = [];
  lines.push(`== split ${split}: ${report.rows} rows, ${report.cases} graded cases (seed ${o.seed}, n ${o.n}/market/family, neg ${o.neg}, inv ${o.inv}) ==`);
  const head = `${pad('mkt', 4)}` + paths.map((p) => ` | ${pad(p === 'android-sms' ? 'android-sms' : 'ios-history', 11)} ok/pos  rev  miss WRONG  FP/neg  inv✗/n`).join('');
  lines.push(head);
  const marketIds = MARKETS.map((m) => m.id).filter((id) => report.tally[id]);
  const totals = Object.fromEntries(paths.map((p) => [p, []]));
  for (const id of marketIds) {
    let line = pad(id, 4);
    for (const p of paths) {
      const c = sumCells(Object.values(report.tally[id][p] ?? {}));
      totals[p].push(c);
      line += ` | ${lpad(`${c.ok}/${c.pos}`, 9)} ${lpad(pct(c.ok, c.pos), 4)} ${lpad(c.review, 4)} ${lpad(c.miss, 5)} ${lpad(c.wrong + c.invWrong + c.negWrong + c.error || '.', 5)} ${lpad(`${c.fp || '.'}/${c.neg}`, 7)} ${lpad(`${c.invViol}/${c.inv}`, 7)}`;
    }
    lines.push(line);
  }
  let line = pad('ALL', 4);
  for (const p of paths) {
    const c = sumCells(totals[p]);
    line += ` | ${lpad(`${c.ok}/${c.pos}`, 9)} ${lpad(pct(c.ok, c.pos), 4)} ${lpad(c.review, 4)} ${lpad(c.miss, 5)} ${lpad(c.wrong + c.invWrong + c.negWrong + c.error || '.', 5)} ${lpad(`${c.fp || '.'}/${c.neg}`, 7)} ${lpad(`${c.invViol}/${c.inv}`, 7)}`;
  }
  lines.push(line);
  // Family breakdown across markets.
  lines.push(`by family (${paths.map((p) => p).join(' ; ')}: ok/pos WRONG FP)`);
  for (const fam of FAMILIES) {
    let l = `  ${pad(fam, 9)}`;
    for (const p of paths) {
      const c = sumCells(marketIds.map((id) => report.tally[id][p]?.[fam] ?? {}));
      l += ` | ${lpad(`${c.ok}/${c.pos}`, 9)} ${lpad(pct(c.ok, c.pos), 4)} W${c.wrong} FP${c.fp}`;
    }
    lines.push(l);
  }
  // Negatives by mutation type.
  const negTypes = [...new Set(paths.flatMap((p) => Object.keys(report.negTally[p] ?? {})))].sort();
  // One line per mutation kind: FALSE-POST/negatives per path, then WRONG
  // (wrong direction on thirdp2p/payeercpt) and tolerated outcomes.
  lines.push(`negatives by mutation (${paths.join(' + ')}: FALSE-POST/n, W=WRONG, tol=tolerated):`);
  const negLine = (t) => paths.map((p) => { const c = report.negTally[p]?.[t] ?? {}; return `${c.fp ?? 0}/${c.neg ?? 0}${c.wrong ? ` W${c.wrong}` : ''}${c.obligation ? ` tol${c.obligation}` : ''}`; }).join(' + ');
  for (let i = 0; i < negTypes.length; i += 4) lines.push(`  ${negTypes.slice(i, i + 4).map((t) => `${t} ${negLine(t)}`).join(' | ')}`);
  const tm = report.timing;
  if (tm) lines.push(`timing: ${report.cases} parses, mean ${(tm.totalMs / Math.max(1, report.cases)).toFixed(2)} ms, ${tm.over50} over 50 ms; slowest: ${tm.slowest.map((x) => `${x.ms}ms ${x.path} ${x.id} (${x.bytes}B)`).join('; ')}`);
  const invTypes = [...new Set(paths.flatMap((p) => Object.keys(report.invTally[p] ?? {})))].sort();
  lines.push(`invariance violations by mutation (lost/gained/changed): ${invTypes.map((t) => `${t} ${paths.map((p) => { const c = report.invTally[p]?.[t]; return c ? `${c.lost ?? 0}/${c.gained ?? 0}/${c.changed ?? 0}` : '-'; }).join('+')}`).join(', ')}`);
  const all = sumCells(paths.flatMap((p) => totals[p]));
  lines.push(`WRONG column = positives ${all.wrong} + invariance variants that newly book wrong money ${all.invWrong} + negatives booked in the forbidden direction ${all.negWrong} + runtime errors ${all.error}; typed reminders on negatives (not unsafe) ${all.reminder}; accepted obligations ${all.obligation}`);
  const leaks = Object.keys(report.leaks).length;
  if (leaks) lines.push(`note: ${leaks} inventory group(s) had no ${split} item and fell back to the full pool: ${Object.keys(report.leaks).slice(0, 8).join(', ')}${leaks > 8 ? ', …' : ''}`);
  return lines.join('\n');
}

function topClusters(report, k) {
  return Object.entries(report.clusters).sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0])).slice(0, k)
    .map(([key, c]) => ({ key, count: c.count, topTemplates: Object.entries(c.templates).sort((a, b) => b[1] - a[1]).slice(0, 3), example: c.example }));
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.manifest) {
    const { splitManifest } = require('./generate.cjs');
    const m = splitManifest();
    for (const [g, v] of Object.entries(m)) console.log(`${pad(g, 14)} dev ${lpad(v.dev.length, 4)}  holdout ${lpad(v.holdout.length, 4)}`);
    return;
  }
  if (o.gate) {
    // The exact sample the repair test grades; prints ratchet candidates.
    const { runGate, GATE } = require('./gate.cjs');
    const t0 = Date.now();
    const g = runGate(o.repo);
    console.log(`sampleHash ${g.sampleHash} (recorded ${g.recordedHash})`);
    console.log(`gate ${JSON.stringify(GATE)}: ${g.report.rows} rows, ${g.report.cases} cases, ${g.report.unsafe.length} unsafe, ${g.newUnsafe.length} not in known-unsafe.json, ${g.fixed.length} listed but now safe (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    for (const u of g.newUnsafe) console.log(JSON.stringify({ key: u.key, verdict: u.verdict, path: u.path, id: u.id, mutation: u.negType ?? u.invType ?? null, detail: u.detail, sender: u.sender, body: u.body }));
    for (const c of g.fixed) console.log(`fixed: ${c.key}`);
    process.exitCode = g.newUnsafe.length ? 1 : 0;
    return;
  }
  const splits = o.split === 'all' ? ['dev', 'holdout'] : [o.split];
  if (o.drift) return mainDrift(o, splits);
  const { createDriver } = require('./lab-eval.cjs');
  const driver = createDriver(o.repo); // validates the build early; also used for diagnosis
  const results = {};
  const started = Date.now();
  for (const split of splits) results[split] = await runSplit(o, split);
  const out = [];
  let unsafeCount = 0;
  const json = { meta: { seed: o.seed, n: o.n, neg: o.neg, inv: o.inv, markets: o.markets, families: o.families, repo: o.repo, paths: o.paths ?? ['android-sms', 'ios-history'] }, splits: {} };
  for (const split of splits) {
    const r = results[split];
    out.push(printSplit(split, r, o));
    const clusters = topClusters(r, 15);
    for (const c of clusters) {
      const ex = c.example;
      if (ex?.path) {
        try { c.diagnosis = driver.diagnose({ ...ex, country: ex.market, ledger: require('./inventory/markets.cjs').byId[ex.market].ledger, body: r.failures.find((f) => f.id === ex.id)?.body ?? ex.body }, ex.path); } catch { /* triage only */ }
      }
    }
    unsafeCount += r.unsafe.length;
    out.push(`top failure clusters (${split}):`);
    clusters.forEach((c, i) => {
      out.push(`  ${lpad(i + 1, 2)}. ${c.count}× ${c.key}${c.diagnosis ? `  [policy ${c.diagnosis.policy}; event ${c.diagnosis.status}/${c.diagnosis.family}/${c.diagnosis.direction}${c.diagnosis.guards.length ? `; guards ${c.diagnosis.guards.join(',')}` : ''}]` : ''}`);
      out.push(`      e.g. ${c.example.sender ? `[${c.example.sender}] ` : ''}${JSON.stringify(c.example.body).slice(0, 220)}`);
    });
    if (r.unsafe.length) {
      out.push(`UNSAFE (${split}): ${r.unsafe.length} case(s)`);
      for (const u of r.unsafe.slice(0, o.show)) {
        out.push(`  ${u.verdict} ${u.path} ${u.id}${u.negType ? ` (${u.negType})` : ''}${u.invType ? ` (inv ${u.invType})` : ''}: ${u.detail}; parsed ${u.parsed?.type ?? ''} ${u.parsed?.amount} ${u.parsed?.currency} via ${u.parsed?.marker}`);
        out.push(`      ${u.sender ? `[${u.sender}] ` : ''}${JSON.stringify(u.body).slice(0, 240)}`);
      }
      if (r.unsafe.length > o.show) out.push(`  … ${r.unsafe.length - o.show} more (use --json)`);
    } else out.push(`UNSAFE (${split}): none`);
    json.splits[split] = {
      tally: r.tally, negTally: r.negTally, invTally: r.invTally, leaks: r.leaks, rows: r.rows, cases: r.cases, timing: r.timing,
      clusters, unsafe: [...r.unsafe.filter((u) => u.verdict !== 'FALSE-POST'), ...r.unsafe.filter((u) => u.verdict === 'FALSE-POST').slice(0, 2000)], invViolations: r.invViolations.slice(0, 200),
    };
  }
  // Long-input timing: synthetic 4 KB / 8 KB adversarial bodies, both paths.
  const { timeAdversarial } = require('./lab-eval.cjs');
  const adv = (await timeAdversarial(o.repo, o.paths ?? undefined, o.advBudget)).sort((a, b) => b.ms - a.ms);
  out.push(`adversarial 4/8 KB bodies (${adv.length} parses, budget ${o.advBudget} ms each): slowest ${adv.slice(0, 5).map((x) => `${x.timeout ? '>' : ''}${x.ms}ms ${x.path} ${x.id}`).join('; ')}; over 50 ms: ${adv.filter((x) => x.ms > 50).length}; timeouts: ${adv.filter((x) => x.timeout).length}${adv.some((x) => x.error) ? `; errors ${adv.filter((x) => x.error).length}` : ''}`);
  json.adversarial = adv;
  out.push(`load average at end: ${os.loadavg().map((x) => x.toFixed(1)).join(' ')} (timings are wall-clock and inflate under load)`);
  out.push(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(out.join('\n'));
  if (o.json) {
    const { splitManifest } = require('./generate.cjs');
    const manifest = splitManifest();
    json.splitManifest = Object.fromEntries(Object.entries(manifest).map(([g, v]) => [g, { dev: v.dev.length, holdout: v.holdout.length, holdoutIds: v.holdout }]));
    fs.mkdirSync(path.dirname(path.resolve(o.json)), { recursive: true });
    fs.writeFileSync(o.json, JSON.stringify(json, null, 1));
  }
  if (o.failures) {
    fs.mkdirSync(path.dirname(path.resolve(o.failures)), { recursive: true });
    const lines = [];
    for (const split of splits) {
      for (const u of results[split].unsafe) lines.push(JSON.stringify({ split, ...u }));
      for (const f of results[split].failures) lines.push(JSON.stringify({ split, ...f }));
    }
    fs.writeFileSync(o.failures, `${lines.join('\n')}\n`);
  }
  process.exitCode = o.strict && unsafeCount ? 1 : 0;
}

// --------------------------------------------------------------------------
// Drift suite report.
async function mainDrift(o, splits) {
  const { MARKETS } = require('./inventory/markets.cjs');
  const { FAMILIES } = require('./generate.cjs');
  const paths = o.paths ?? ['android-sms', 'ios-history'];
  const started = Date.now();
  const out = [];
  const json = { meta: { mode: 'drift', K: o.drift, seed: o.seed, n: o.n, repo: o.repo, paths }, splits: {} };
  const surv = (c) => (c.n ? `${Math.round((100 * c.ok) / c.n)}%` : '-');
  const add = (acc, c) => { for (const k of ['n', 'ok', 'lost', 'wrong']) acc[k] = (acc[k] ?? 0) + (c[k] ?? 0); return acc; };
  const cells = (rep, fn) => { const res = []; for (const [m, byPath] of Object.entries(rep.tally)) for (const [p, byFam] of Object.entries(byPath)) for (const [f, byOp] of Object.entries(byFam)) for (const [op, c] of Object.entries(byOp)) res.push({ m, p, f, op, c }); return fn ? res.filter(fn) : res; };
  for (const split of splits) {
    const rep = await runSplit(o, split);
    out.push(`== drift ${split}: K ${o.drift} variants per correctly-booked positive (seed ${o.seed}, n ${o.n}/market/family), ${rep.variants} graded variants ==`);
    out.push(`${pad('mkt', 4)}${paths.map((p) => ` | ${pad(p, 11)} base ok/pos  survival (n)   WRONG`).join('')}`);
    const total = Object.fromEntries(paths.map((p) => [p, { base: {}, d: {} }]));
    for (const m of MARKETS.map((x) => x.id).filter((id) => rep.base[id])) {
      let line = pad(m, 4);
      for (const p of paths) {
        const b = rep.base[m][p] ?? { n: 0, ok: 0 };
        const d = cells(rep, (x) => x.m === m && x.p === p).reduce((acc, x) => add(acc, x.c), {});
        add(total[p].base, b); add(total[p].d, d);
        line += ` | ${lpad(`${b.ok}/${b.n}`, 9)}         ${lpad(surv(d), 4)} (${lpad(d.n ?? 0, 4)})  ${lpad(d.wrong || '.', 4)}`;
      }
      out.push(line);
    }
    out.push(pad('ALL', 4) + paths.map((p) => ` | ${lpad(`${total[p].base.ok}/${total[p].base.n}`, 9)}         ${lpad(surv(total[p].d), 4)} (${lpad(total[p].d.n ?? 0, 4)})  ${lpad(total[p].d.wrong || '.', 4)}`).join(''));
    out.push(`by family (${paths.join(' ; ')}): ${FAMILIES.map((f) => `${f} ${paths.map((p) => surv(cells(rep, (x) => x.f === f && x.p === p).reduce((a, x) => add(a, x.c), {}))).join('/')}`).join(', ')}`);
    const ops = [...new Set(cells(rep).map((x) => x.op))].sort();
    out.push(`by operator (${paths.join(' / ')} survival, n):`);
    for (let i = 0; i < ops.length; i += 5) out.push(`  ${ops.slice(i, i + 5).map((op) => { const per = paths.map((p) => cells(rep, (x) => x.op === op && x.p === p).reduce((a, x) => add(a, x.c), {})); return `${op} ${per.map(surv).join('/')} (${per.map((c) => c.n ?? 0).join('/')})${per.some((c) => c.wrong) ? ` W${per.map((c) => c.wrong ?? 0).join('/')}` : ''}`; }).join(' | ')}`);
    // Lowest-survival operator x market pairs (both paths pooled, n >= 10).
    const pairs = {};
    for (const x of cells(rep)) add(pairs[`${x.op}|${x.m}`] ??= {}, x.c);
    const lowest = Object.entries(pairs).filter(([, c]) => c.n >= 10).sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n || b[1].n - a[1].n).slice(0, 15);
    out.push('lowest survival (operator | market, both paths pooled, n >= 10), one lost example each:');
    for (const [key, c] of lowest) {
      const [op, m] = key.split('|');
      const ex = rep.examples[`${op}|${m}|android-sms`] ?? rep.examples[`${op}|${m}|ios-history`];
      out.push(`  ${surv(c).padStart(4)} (${c.ok}/${c.n}) ${op} | ${m}${ex ? `  [${ex.ops.join('+')}]` : ''}`);
      if (ex) out.push(`      ${JSON.stringify(ex.before).slice(0, 150)}
   -> ${JSON.stringify(ex.after).slice(0, 150)}`);
    }
    out.push(`drift WRONG (${split}): ${rep.wrong.length}`);
    for (const w of rep.wrong.slice(0, o.show)) out.push(`  ${w.path} ${w.id} [${w.ops.join('+')}]: ${w.detail}
      ${JSON.stringify(w.before).slice(0, 140)}
   -> ${JSON.stringify(w.after).slice(0, 140)}`);
    json.splits[split] = { base: rep.base, tally: rep.tally, wrong: rep.wrong, examples: rep.examples, variants: rep.variants };
  }
  out.push(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(out.join('\n'));
  if (o.json) { fs.mkdirSync(path.dirname(path.resolve(o.json)), { recursive: true }); fs.writeFileSync(o.json, JSON.stringify(json)); }
  process.exitCode = o.strict && Object.values(json.splits).some((x) => x.wrong.length) ? 1 : 0;
}

if (require.main === module) {
  if (process.argv.includes('--worker')) {
    process.once('message', ({ o, split, markets }) => {
      try {
        const report = runSlice(o, split, markets);
        process.send({ report }, () => process.exit(0));
      } catch (e) {
        process.send({ error: String(e && e.stack || e) }, () => process.exit(1));
      }
    });
  } else {
    main().catch((e) => { console.error(e && e.stack || e); process.exitCode = 2; });
  }
}

module.exports = { runSlice, parseArgs };
