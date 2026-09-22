/**
 * Score a candidate parsing engine against the shipped rule parser.
 *
 * The point of this harness is to make "should Wafra run a model on the phone
 * instead of / alongside the rules?" an answerable question rather than an
 * opinion. A candidate is only worth shipping if it beats the rules on the
 * labelled corpora WITHOUT inventing money on the unlabelled one, and does it
 * inside the latency the import path already promises. Those are four
 * separate measurements and a single accuracy percentage hides all of them.
 *
 *   node scripts/parser-benchmark/run.mjs
 *   node scripts/parser-benchmark/run.mjs --engine ./my-model.mjs --json out.json
 *   node scripts/parser-benchmark/run.mjs --baseline baseline.json
 *
 * Engine contract — a module exporting any of:
 *   name, description                     strings
 *   parseLedger(message, ctx)             -> ParsedSms | null    (AE/SA ledger)
 *   reviewAlert(message, market, ctx)     -> AlertReview | null   (all markets)
 * A section whose method is missing is reported as not-implemented, never as
 * a zero — a candidate that only classifies categories should not look like
 * one that reads every amount wrong.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const BUILD = path.join(ROOT, 'scripts/test/build');
const require = createRequire(import.meta.url);

/* ── Arguments ───────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
};

const enginePath = flag('engine');
const jsonOut = flag('json');
const baselinePath = flag('baseline');
const only = flag('section');

/* ── The build the corpora and the default engine both need ──────────── */

if (!fs.existsSync(path.join(BUILD, 'sms-parser.js'))) {
  process.stderr.write('parser-benchmark: scripts/test/build is missing; building it now.\n');
  execFileSync('bash', [path.join(ROOT, 'scripts/test/build.sh')], { stdio: 'inherit' });
}

const { corpusMessages } = require(path.join(ROOT, 'scripts/test/corpus-messages.cjs'));
const uaeRows = require(path.join(ROOT, 'scripts/test/fixtures/uae-bank-formats.js'));
const saudiRows = require(path.join(ROOT, 'scripts/test/fixtures/saudi-bank-formats.js'));
const globalRows = require(path.join(ROOT, 'scripts/test/fixtures/global-alert-formats.js'));

// A --engine path is the caller's, so it resolves against their cwd. The
// default is this harness's own baseline engine and resolves against the
// harness, which is why the two cases are not one line.
const engineUrl = enginePath === null
  ? path.join(HERE, 'engines/rules.mjs')
  : path.resolve(process.cwd(), enginePath);
const engine = await import(engineUrl);
const engineName = engine.name ?? path.basename(engineUrl);

/* ── Reporting ───────────────────────────────────────────────────────── */

const sections = [];
const pct = (n, d) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);
const wanted = (id) => !only || only === id;

const section = (id, title, body) => {
  if (!wanted(id)) return;
  const result = body();
  if (result) sections.push({ id, title, ...result });
};

/**
 * A field comparison that treats "the fixture does not pin this" as a pass.
 * `expect` blocks pin what the bank wording can actually prove; scoring an
 * engine against an absent expectation would reward it for guessing.
 */
const fieldMatch = (expected, actual) => {
  if (expected === undefined) return null;
  if (expected === null) return actual === null || actual === undefined;
  if (typeof expected === 'object') return JSON.stringify(actual) === JSON.stringify(expected);
  return actual === expected;
};

/* ── 1. Labelled AE/SA ledger rows, field by field ───────────────────── */

const LEDGER_FIELDS = ['kind', 'type', 'amountFils', 'currency', 'merchant', 'date',
  'card', 'reference', 'transferHint', 'snapshotFils', 'snapshotKind', 'dueDay',
  'minDueFils', 'category'];

section('ledger', 'Labelled AE/SA ledger rows', () => {
  if (!engine.parseLedger) return { skipped: 'engine has no parseLedger' };
  const rows = [...uaeRows, ...saudiRows];
  let checked = 0;
  let matched = 0;
  const failures = [];
  for (const row of rows) {
    const got = engine.parseLedger(row.body, {
      market: row.market ?? 'AE', sender: row.sender,
    });
    for (const field of LEDGER_FIELDS) {
      const want = row.expect?.[field];
      const verdict = fieldMatch(want, field === 'category' ? got?.categoryGuess : got?.[field]);
      if (verdict === null) continue;
      checked += 1;
      if (verdict) matched += 1;
      else failures.push(`${row.id}.${field}: ${JSON.stringify(
        field === 'category' ? got?.categoryGuess : got?.[field])} != ${JSON.stringify(want)}`);
    }
  }
  return { rows: rows.length, checked, matched, accuracy: pct(matched, checked), failures };
});

/* ── 2. Labelled global semantic rows ────────────────────────────────── */

const GLOBAL_FIELDS = ['decision', 'status', 'family', 'direction', 'currency', 'minorUnits'];

section('global', 'Labelled global alert rows', () => {
  if (!engine.reviewAlert) return { skipped: 'engine has no reviewAlert' };
  let checked = 0;
  let matched = 0;
  let institutions = 0;
  const failures = [];
  for (const row of globalRows) {
    const got = engine.reviewAlert(row.body, row.market, { sender: row.sender }) ?? {};
    if (got.institution === row.institution) institutions += 1;
    for (const field of GLOBAL_FIELDS) {
      const want = row.expected?.[field];
      if (want === undefined) continue;
      checked += 1;
      if (got[field] === want) matched += 1;
      else failures.push(`${row.id}.${field}: ${JSON.stringify(got[field])} != ${JSON.stringify(want)}`);
    }
  }
  return {
    rows: globalRows.length, checked, matched, accuracy: pct(matched, checked),
    institutionAccuracy: pct(institutions, globalRows.length), failures,
  };
});

/* ── 3. Divergence from the shipped rules over the unlabelled corpus ──── */

/**
 * The 961-message corpus has no ground truth, so this is NOT scored as
 * accuracy. It is scored as disagreement with 6,500 lines of rules that 76
 * suites already hold in place, split by what the disagreement would cost a
 * user. `posts-where-rules-refuse` is the dangerous column: every row in it
 * is money the app would show that it does not show today, and a marketing
 * SMS reading as a AED 250 purchase is worse than no reading at all.
 */
section('divergence', 'Divergence from the shipped rules (961 unlabelled messages)', () => {
  if (!engine.parseLedger) return { skipped: 'engine has no parseLedger' };
  const rules = require(path.join(BUILD, 'sms-parser'));
  const { withMarketPackForParsing } = require(path.join(BUILD, 'markets'));
  const corpus = corpusMessages();
  const buckets = {
    'posts-where-rules-refuse': [],
    'refuses-where-rules-post': [],
    'different-money': [],
    'different-merchant-or-date': [],
  };
  let agreed = 0;
  for (const raw of corpus) {
    const base = withMarketPackForParsing('AE', () => rules.parseSms(raw));
    const got = engine.parseLedger(raw, { market: 'AE' });
    const sample = raw.replace(/\s+/g, ' ').slice(0, 110);
    if (!base && !got) { agreed += 1; continue; }
    if (!base && got) { buckets['posts-where-rules-refuse'].push(sample); continue; }
    if (base && !got) { buckets['refuses-where-rules-post'].push(sample); continue; }
    if (base.amountFils !== got.amountFils || base.currency !== got.currency ||
        base.type !== got.type || base.kind !== got.kind) {
      buckets['different-money'].push(
        `${base.kind}/${base.type} ${base.amountFils} -> ${got.kind}/${got.type} ${got.amountFils} | ${sample}`);
      continue;
    }
    if (base.merchant !== got.merchant || base.date !== got.date) {
      buckets['different-merchant-or-date'].push(
        `"${base.merchant}"/${base.date} -> "${got.merchant}"/${got.date} | ${sample}`);
      continue;
    }
    agreed += 1;
  }
  const diverged = Object.values(buckets).reduce((n, b) => n + b.length, 0);
  return {
    messages: corpus.length, agreed, diverged, agreement: pct(agreed, corpus.length),
    buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
    failures: Object.entries(buckets).flatMap(
      ([k, v]) => v.slice(0, 5).map((s) => `${k}: ${s}`)),
  };
});

/* ── 4. Latency, against the budget the import path already promises ─── */

section('latency', 'Latency', () => {
  if (!engine.parseLedger) return { skipped: 'engine has no parseLedger' };
  const corpus = corpusMessages();
  // One untimed pass so JIT warm-up is not charged to the first messages.
  for (const raw of corpus) engine.parseLedger(raw, { market: 'AE' });
  const times = [];
  for (const raw of corpus) {
    const t0 = process.hrtime.bigint();
    engine.parseLedger(raw, { market: 'AE' });
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  const at = (q) => Math.round(times[Math.min(times.length - 1, Math.floor(times.length * q))] * 1000) / 1000;

  // The bulk figure the invariants suite pins: a 5,000-message import, which
  // is above the product's acceptance target, must stay bounded.
  const bulk = Array.from({ length: 5000 }, (_, i) => corpus[i % corpus.length]);
  const t0 = process.hrtime.bigint();
  for (const raw of bulk) engine.parseLedger(raw, { market: 'AE' });
  const bulkMs = Math.round(Number(process.hrtime.bigint() - t0) / 1e6);

  return {
    p50Ms: at(0.5), p95Ms: at(0.95), maxMs: Math.round(times[times.length - 1] * 1000) / 1000,
    over25ms: times.filter((t) => t > 25).length,
    bulk5000Ms: bulkMs,
    budgets: { perMessageMs: 25, bulk5000Ms: 1500 },
    withinBudget: times.every((t) => t <= 25) && bulkMs < 1500,
  };
});

/* ── Output ──────────────────────────────────────────────────────────── */

const report = {
  engine: engineName,
  description: engine.description ?? null,
  node: process.version,
  ranAt: new Date().toISOString(),
  sections,
};

const baseline = baselinePath ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : null;
const baseSection = (id) => baseline?.sections.find((s) => s.id === id);
const delta = (id, key, value) => {
  const was = baseSection(id)?.[key];
  if (typeof was !== 'number' || typeof value !== 'number') return '';
  const d = Math.round((value - was) * 10) / 10;
  return d === 0 ? '  (=)' : `  (${d > 0 ? '+' : ''}${d} vs ${baseline.engine})`;
};

console.log(`\nengine: ${engineName}${engine.description ? ` — ${engine.description}` : ''}`);
if (baseline) console.log(`baseline: ${baseline.engine} (${baseline.ranAt})`);

for (const s of sections) {
  console.log(`\n── ${s.title} ──`);
  if (s.skipped) { console.log(`  not implemented by this engine (${s.skipped})`); continue; }
  if (s.id === 'ledger' || s.id === 'global') {
    console.log(`  ${s.matched}/${s.checked} pinned fields over ${s.rows} rows` +
      `  =  ${s.accuracy}%${delta(s.id, 'accuracy', s.accuracy)}`);
    if (s.institutionAccuracy !== undefined) {
      console.log(`  institution identified: ${s.institutionAccuracy}%` +
        `${delta(s.id, 'institutionAccuracy', s.institutionAccuracy)}`);
    }
  }
  if (s.id === 'divergence') {
    console.log(`  agrees with the shipped rules on ${s.agreed}/${s.messages}` +
      `  =  ${s.agreement}%${delta(s.id, 'agreement', s.agreement)}`);
    for (const [k, v] of Object.entries(s.buckets)) {
      console.log(`    ${String(v).padStart(4)}  ${k}${k === 'posts-where-rules-refuse' && v > 0 ? '   <-- invented money risk' : ''}`);
    }
  }
  if (s.id === 'latency') {
    console.log(`  p50 ${s.p50Ms}ms   p95 ${s.p95Ms}ms   max ${s.maxMs}ms   over 25ms: ${s.over25ms}`);
    console.log(`  5,000-message import: ${s.bulk5000Ms}ms (budget ${s.budgets.bulk5000Ms}ms)`);
    console.log(`  within budget: ${s.withinBudget ? 'yes' : 'NO'}`);
  }
  for (const f of (s.failures ?? []).slice(0, 8)) console.log(`    ! ${f}`);
  if ((s.failures?.length ?? 0) > 8) console.log(`    ... ${s.failures.length - 8} more`);
}

if (jsonOut) {
  fs.writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nwrote ${jsonOut}`);
}
console.log('');
