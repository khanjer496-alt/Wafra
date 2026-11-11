#!/usr/bin/env node
'use strict';
/**
 * CI-only paired parse benchmark. It never ships and changes no runtime code.
 *
 *   benchmark.cjs run       --root DIR --label NAME --corpus FILE --out FILE
 *       One fresh process = one run: load the parser of the source tree at DIR,
 *       parse the fixed corpus twice (pass 1 = cold, includes JIT warm-up like
 *       the CI gate; pass 2 = warm steady state) and write per-message times.
 *   benchmark.cjs profile   --root DIR --label NAME --corpus FILE --out FILE.cpuprofile
 *       One warm-up pass, then a V8 sampling profile (100 us) of one warm pass only,
 *       so module loading and TypeScript transpile are not in the profile.
 *   benchmark.cjs aggregate --dir DIR --corpus FILE --out REPORT.md [--profiles DIR]
 *       Combine all runs of a job into one Markdown report.
 *
 * Every tree is loaded by the SAME loader (TypeScript transpileModule, CommonJS,
 * ES2022) from the SAME node_modules, so only src/lib differs between labels.
 * The call timed is parseSms(text), exactly what the 5,000-message CI gate times.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
    else args._.push(argv[i]);
  }
  return args;
}

function readCorpus(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function loadParser(root) {
  const ts = require(path.join(process.cwd(), 'node_modules', 'typescript'));
  const Module = require('module');
  const libDir = path.join(root, 'src', 'lib');
  const stub = path.join(__dirname, 'empty-module.cjs');
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function resolve(request, parent, isMain, options) {
    if (request === '@/components/ui/icon.types') return stub;
    if (request.startsWith('@/lib/')) request = path.join(libDir, request.slice('@/lib/'.length));
    return originalResolve.call(this, request, parent, isMain, options);
  };
  require.extensions['.ts'] = function compileTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const out = ts.transpileModule(source, {
      fileName: filename,
      reportDiagnostics: false,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
      },
    });
    module._compile(out.outputText, filename);
  };
  const t0 = process.hrtime.bigint();
  const parser = require(path.join(libDir, 'sms-parser.ts'));
  const loadMs = Number(process.hrtime.bigint() - t0) / 1e6;
  if (typeof parser.parseSms !== 'function') throw new Error(`parseSms missing in ${root}`);
  return { parseSms: parser.parseSms, parserVersion: parser.PARSER_VERSION, loadMs };
}

function pass(parseSms, rows) {
  const ns = new Array(rows.length);
  const recognized = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const t0 = process.hrtime.bigint();
    const result = parseSms(rows[i].text);
    const t1 = process.hrtime.bigint();
    ns[i] = Number(t1 - t0);
    recognized[i] = result ? 1 : 0;
  }
  return { ns, recognized, totalMs: ns.reduce((s, v) => s + v, 0) / 1e6 };
}

function envInfo() {
  const cpus = os.cpus();
  return { node: process.version, v8: process.versions.v8, platform: `${os.platform()} ${os.release()}`,
    cpu: cpus[0] ? cpus[0].model : 'unknown', cpuCount: cpus.length, memGB: Math.round(os.totalmem() / 2 ** 30) };
}

function runCommand(args) {
  const rows = readCorpus(args.corpus);
  const loaded = loadParser(path.resolve(args.root));
  const passes = [];
  passes.push({ name: 'cold', ...pass(loaded.parseSms, rows) });
  passes.push({ name: 'warm', ...pass(loaded.parseSms, rows) });
  fs.writeFileSync(args.out, JSON.stringify({ label: args.label, root: args.root, parserVersion: loaded.parserVersion,
    loadMs: loaded.loadMs, messages: rows.length, env: envInfo(), passes }));
}

function profileCommand(args) {
  const inspector = require('inspector');
  const rows = readCorpus(args.corpus);
  const loaded = loadParser(path.resolve(args.root));
  pass(loaded.parseSms, rows); // warm-up, not profiled
  const session = new inspector.Session();
  session.connect();
  const post = (method, params) => new Promise((resolve, reject) =>
    session.post(method, params || {}, (error, result) => (error ? reject(error) : resolve(result))));
  (async () => {
    await post('Profiler.enable');
    await post('Profiler.setSamplingInterval', { interval: 100 });
    await post('Profiler.start');
    pass(loaded.parseSms, rows);
    const { profile } = await post('Profiler.stop');
    fs.writeFileSync(args.out, JSON.stringify(profile));
  })().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exit(1); });
}

// ── aggregation ─────────────────────────────────────────────────────────────
const sum = (a) => a.reduce((s, v) => s + v, 0);
function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
const sortNum = (a) => [...a].sort((x, y) => x - y);
const median = (a) => quantile(sortNum(a), 0.5);
const fmt = (v, d = 1) => Number.isFinite(v) ? v.toFixed(d) : 'n/a';
const us = (ns) => ns / 1000;

function messageStats(nsArray) {
  const sorted = sortNum(nsArray);
  return { p50: us(quantile(sorted, 0.5)), p95: us(quantile(sorted, 0.95)), p99: us(quantile(sorted, 0.99)),
    mean: us(sum(nsArray) / nsArray.length), totalMs: sum(nsArray) / 1e6 };
}

function aggregate(args) {
  const rows = readCorpus(args.corpus);
  const files = fs.readdirSync(args.dir).filter((f) => /^run-.*\.json$/.test(f)).sort();
  const runs = files.map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(args.dir, f), 'utf8')) }));
  const labels = [...new Set(runs.map((r) => r.label))];
  const base = args.baseline || labels[0];
  const byLabel = Object.fromEntries(labels.map((l) => [l, runs.filter((r) => r.label === l)]));
  const lines = [];
  const out = (s = '') => lines.push(s);

  out('## Environment (one CI job, one runner)');
  out('');
  const env = runs[0].env;
  out(`Node ${env.node} (V8 ${env.v8}), ${env.platform}, ${env.cpu} x ${env.cpuCount}, ${env.memGB} GB. Corpus: ${rows.length} fixed synthetic messages (${rows.filter((r) => r.lang === 'en').length} EN, ${rows.filter((r) => r.lang === 'ar').length} AR). Timer: process.hrtime around each parseSms call.`);
  out('');
  out('| Label | Runs | Parser version | Load+compile ms (median) |');
  out('|---|---|---|---|');
  for (const l of labels) {
    out(`| ${l} | ${byLabel[l].length} | ${byLabel[l][0].parserVersion} | ${fmt(median(byLabel[l].map((r) => r.loadMs)), 0)} |`);
  }
  out('');

  const passNames = ['cold', 'warm'];
  const perRunStats = {};
  for (const l of labels) {
    perRunStats[l] = {};
    for (const name of passNames) {
      perRunStats[l][name] = byLabel[l].map((r) => messageStats(r.passes.find((p) => p.name === name).ns));
    }
  }

  for (const name of passNames) {
    out(`## Per-message time and total, ${name === 'cold' ? 'pass 1 (cold: includes JIT warm-up, like the CI gate)' : 'pass 2 (warm: steady state)'}`);
    out('');
    out('Median across runs, with the min-max range across runs in brackets. Microseconds per message.');
    out('');
    out(`| Label | p50 us | p95 us | p99 us | mean us | Total ms for ${rows.length} (range) | Total vs ${base} |`);
    out('|---|---|---|---|---|---|---|');
    const baseTotals = perRunStats[base][name].map((s) => s.totalMs);
    for (const l of labels) {
      const s = perRunStats[l][name];
      const col = (key) => `${fmt(median(s.map((x) => x[key])), key === 'p50' || key === 'mean' ? 1 : 1)} (${fmt(Math.min(...s.map((x) => x[key])))}-${fmt(Math.max(...s.map((x) => x[key])))})`;
      const totals = s.map((x) => x.totalMs);
      // Paired by round: run i of every label was executed in the same rotation block.
      const ratios = totals.map((t, i) => (baseTotals[i] ? t / baseTotals[i] : NaN)).filter(Number.isFinite);
      out(`| ${l} | ${col('p50')} | ${col('p95')} | ${col('p99')} | ${col('mean')} | ${fmt(median(totals), 0)} (${fmt(Math.min(...totals), 0)}-${fmt(Math.max(...totals), 0)}) | ${l === base ? '1.00x' : `${fmt(median(ratios), 2)}x (${fmt(Math.min(...ratios), 2)}-${fmt(Math.max(...ratios), 2)})`} |`);
    }
    out('');
  }

  // Pooled per-message warm time = median over runs of that message's time.
  const pooled = {};
  const recognized = {};
  for (const l of labels) {
    const warm = byLabel[l].map((r) => r.passes.find((p) => p.name === 'warm'));
    pooled[l] = rows.map((_, i) => median(warm.map((p) => p.ns[i])));
    recognized[l] = warm[0].recognized;
  }

  out('## Recognition (does each parser read the corpus?)');
  out('');
  out('| Label | Recognised | Of | Share |');
  out('|---|---|---|---|');
  for (const l of labels) {
    const n = sum(recognized[l]);
    out(`| ${l} | ${n} | ${rows.length} | ${fmt((100 * n) / rows.length, 1)}% |`);
  }
  out('');
  const differing = rows.filter((_, i) => labels.some((l) => recognized[l][i] !== recognized[base][i])).length;
  out(`Messages whose recognised/not-recognised outcome differs between labels: ${differing}.`);
  out('');

  const shapes = [...new Set(rows.map((r) => r.shape))];
  const shapeRows = shapes.map((shape) => {
    const idx = rows.map((r, i) => (r.shape === shape ? i : -1)).filter((i) => i >= 0);
    const entry = { shape, count: idx.length };
    for (const l of labels) {
      const times = idx.map((i) => pooled[l][i]);
      entry[l] = { mean: us(sum(times) / times.length), p95: us(quantile(sortNum(times), 0.95)),
        recognized: sum(idx.map((i) => recognized[l][i])) };
    }
    return entry;
  });
  const focus = args.focus || labels[labels.length - 1];
  out(`## Slowest 10 message shapes (warm, mean us per message, by ${focus})`);
  out('');
  out(`| # | Shape | n | ${labels.map((l) => `${l} mean us`).join(' | ')} | ${focus} vs ${base} | ${focus} p95 us | Recognised ${focus}/${base} |`);
  out(`|---|---|---|${labels.map(() => '---').join('|')}|---|---|---|`);
  [...shapeRows].sort((a, b) => b[focus].mean - a[focus].mean).slice(0, 10).forEach((s, k) => {
    out(`| ${k + 1} | ${s.shape} | ${s.count} | ${labels.map((l) => fmt(s[l].mean)).join(' | ')} | ${fmt(s[focus].mean / s[base].mean, 2)}x | ${fmt(s[focus].p95)} | ${s[focus].recognized}/${s[base].recognized} |`);
  });
  out('');
  out(`## All shapes, ${focus} against ${base} (warm mean us per message; sorted by ratio)`);
  out('');
  out(`| Shape | n | ${base} | ${focus} | Ratio | Recognised ${base} | Recognised ${focus} |`);
  out('|---|---|---|---|---|---|---|');
  [...shapeRows].sort((a, b) => b[focus].mean / b[base].mean - a[focus].mean / a[base].mean).forEach((s) => {
    out(`| ${s.shape} | ${s.count} | ${fmt(s[base].mean)} | ${fmt(s[focus].mean)} | ${fmt(s[focus].mean / s[base].mean, 2)}x | ${s[base].recognized} | ${s[focus].recognized} |`);
  });
  out('');

  const order = pooled[focus].map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 10);
  out(`## Ten slowest single messages under ${focus} (warm, median across runs)`);
  out('');
  out(`| # | ${focus} us | ${base} us | Shape | Message (first 90 chars) |`);
  out('|---|---|---|---|---|');
  order.forEach(([v, i], k) => {
    out(`| ${k + 1} | ${fmt(us(v))} | ${fmt(us(pooled[base][i]))} | ${rows[i].shape} | ${JSON.stringify(rows[i].text.slice(0, 90))} |`);
  });
  out('');

  const byLang = ['en', 'ar'].map((lang) => {
    const idx = rows.map((r, i) => (r.lang === lang ? i : -1)).filter((i) => i >= 0);
    return { lang, n: idx.length, ...Object.fromEntries(labels.map((l) => [l, us(sum(idx.map((i) => pooled[l][i])) / idx.length)])) };
  });
  out('## By language (warm mean us per message)');
  out('');
  out(`| Language | n | ${labels.join(' | ')} |`);
  out(`|---|---|${labels.map(() => '---').join('|')}|`);
  byLang.forEach((b) => out(`| ${b.lang} | ${b.n} | ${labels.map((l) => fmt(b[l])).join(' | ')} |`));
  out('');

  if (args.profiles && fs.existsSync(args.profiles)) profileSection(args, labels, out);
  fs.writeFileSync(args.out, `${lines.join('\n')}\n`);
}

function profileSection(args, labels, out) {
  out('## Where the time goes (V8 CPU profile, one warm pass per label, self time by function)');
  out('');
  out('Sampling profile (V8 inspector, 100 us interval) of one warm pass after a warm-up pass; module loading is excluded. Self time share of the profile, merged by function name and file.');
  out('');
  for (const l of labels) {
    const file = fs.readdirSync(args.profiles).find((f) => f === `${l}.cpuprofile`);
    if (!file) continue;
    const prof = JSON.parse(fs.readFileSync(path.join(args.profiles, file), 'utf8'));
    const nodes = new Map(prof.nodes.map((n) => [n.id, n]));
    const self = new Map();
    let total = 0;
    prof.samples.forEach((id, i) => {
      const dt = prof.timeDeltas[i] || 0;
      total += dt;
      const n = nodes.get(id);
      const cf = n.callFrame;
      const url = cf.url ? cf.url.split('/src/lib/').pop().split('/').pop() : '(native)';
      const key = `${cf.functionName || '(anonymous)'} @ ${url}`;
      self.set(key, (self.get(key) || 0) + dt);
    });
    out(`### ${l} (profile total ${fmt(total / 1000, 0)} ms)`);
    out('');
    out('| # | Function @ file | Self ms | Share |');
    out('|---|---|---|---|');
    [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([key, dt], k) => {
      out(`| ${k + 1} | ${key} | ${fmt(dt / 1000)} | ${fmt((100 * dt) / total)}% |`);
    });
    out('');
  }
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
if (command === 'run') runCommand(args);
else if (command === 'profile') profileCommand(args);
else if (command === 'aggregate') aggregate(args);
else {
  process.stderr.write('usage: benchmark.cjs run|profile|aggregate (see header)\n');
  process.exit(2);
}
