'use strict';
/**
 * OFFLINE audit of the deterministic parser against Cloudflare's Clef decision
 * model (Workers AI, @cf/cloudflare/clef and clef-flash). Development tool
 * only: nothing here ships in the app, and Clef output never changes a parser
 * rule or a ledger row by itself.
 *
 * For each labelled row it asks Clef four closed questions (status, family,
 * direction, should-post), runs the current parser the way capture does
 * (pipeline.cjs), and reports per field: parser vs Clef accuracy against the
 * TRUE label, their agreement, Clef's calibration (Brier, ECE, reliability
 * bins), and two lists of row ids:
 *   leads          the parser is wrong and Clef is right with high confidence
 *   overconfident  Clef is wrong with high confidence
 *
 * PRIVACY: rows are sent to Cloudflare. Only the privacy-safe sets built into
 * the repository can be selected — repo fixtures, committed public samples
 * (never $PARSER_AI_PUBLIC_LOCAL rows) and synthetic alerts. There is no
 * option to read an export, inbox or the private UAE benchmark. The report
 * holds metrics and row ids only, never message text.
 *
 *   node --env-file-if-exists=.env.local scripts/parser-ai/clef-audit.cjs \
 *     [--sets repo,public,synth] [--model clef-flash|clef] [--limit N] \
 *     [--threshold 0.9] [--concurrency 4] [--cache file.jsonl] [--json out.json] [--dry-run]
 *
 * Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Workers AI read) unless
 * --dry-run, which runs the parser and builds every request without sending.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const { buildRepoEvalSet } = require('./repo-eval-set.cjs');
const { buildPublicRealEvalSet } = require('./public-real-eval-set.cjs');
const { generate } = require('./synth/generate.cjs');
const { runLedger, runExtraction } = require('./pipeline.cjs');
const {
  MODELS, QUESTIONS, buildClefRequest, readClefAnswers, newAudit, scoreClefRow, summarizeClefAudit,
} = require('./clef-audit-lib.cjs');

const SETS = {
  repo: () => buildRepoEvalSet(),
  public: () => buildPublicRealEvalSet({ localPath: null }).filter((r) => r.origin === 'committed'),
  synth: () => generate().filter((r) => r.split === 'test'),
};

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;

function parseArgs(argv) {
  const opts = {
    sets: ['repo', 'public'], model: 'clef-flash', limit: Infinity, threshold: 0.9, concurrency: 4,
    cache: null, json: null, dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    if (arg === '--sets') opts.sets = value().split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--model') opts.model = value();
    else if (arg === '--limit') opts.limit = Number(value());
    else if (arg === '--threshold') opts.threshold = Number(value());
    else if (arg === '--concurrency') opts.concurrency = Number(value());
    else if (arg === '--cache') opts.cache = value();
    else if (arg === '--json') opts.json = value();
    else if (arg === '--dry-run') opts.dryRun = true;
    else throw new Error(`unknown option ${arg}`);
  }
  for (const s of opts.sets) if (!SETS[s]) throw new Error(`unknown set ${s} (choose from ${Object.keys(SETS).join(', ')})`);
  if (!MODELS.includes(opts.model)) throw new Error(`--model must be one of ${MODELS.join(', ')}`);
  if (!(opts.limit > 0)) throw new Error('--limit must be positive');
  if (!(opts.threshold >= 0 && opts.threshold <= 1)) throw new Error('--threshold must be between 0 and 1');
  if (!(Number.isInteger(opts.concurrency) && opts.concurrency >= 1 && opts.concurrency <= 16)) {
    throw new Error('--concurrency must be an integer from 1 to 16');
  }
  return opts;
}

/** Evenly spaced, deterministic sample so a limit still covers every template. */
function sample(rows, limit) {
  if (rows.length <= limit) return rows;
  const step = rows.length / limit;
  return Array.from({ length: limit }, (_, i) => rows[Math.floor(i * step)]);
}

/** Parser's answer per audited field, in the label vocabulary. */
function parserView(row) {
  const extraction = runExtraction(row);
  const ledger = runLedger(row);
  return {
    status: extraction.status ?? 'unknown',
    family: extraction.family ?? 'non-posting',
    direction: extraction.direction ?? 'none',
    shouldPost: !!ledger.posted,
  };
}

const requestKey = (request) => crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex');

function loadCache(file) {
  const cache = new Map();
  if (!file || !fs.existsSync(file)) return cache;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const { key, response } = JSON.parse(line);
    cache.set(key, response);
  }
  return cache;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callClef(request, { accountId, token }) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/@cf/cloudflare/${request.model}`;
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return await res.json();
      // Status only: an error body can echo the request, which holds message text.
      lastError = new Error(`Workers AI HTTP ${res.status}`);
      if (res.status !== 429 && res.status < 500) break;
    } catch (error) {
      lastError = new Error(`Workers AI request failed: ${error.name}`);
    }
    if (attempt < MAX_ATTEMPTS) await sleep(1000 * 2 ** attempt);
  }
  throw lastError;
}

async function pool(items, size, worker) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      await worker(items[i], i);
    }
  }));
}

async function main(argv = process.argv.slice(2), env = process.env, log = console.log) {
  const opts = parseArgs(argv);
  const credentials = { accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_API_TOKEN };
  if (!opts.dryRun && (!credentials.accountId || !credentials.token)) {
    throw new Error('set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (e.g. in .env.local), or pass --dry-run');
  }

  const bySet = {};
  const rows = opts.sets.flatMap((name) => {
    const picked = sample(SETS[name](), opts.limit);
    bySet[name] = picked.length;
    return picked;
  });
  const cache = loadCache(opts.cache);
  const audit = newAudit();
  const failures = [];
  let sent = 0;
  let cached = 0;

  await pool(rows, opts.concurrency, async (row) => {
    const request = buildClefRequest(row, opts.model);
    const parser = parserView(row);
    if (opts.dryRun) return;
    const key = requestKey(request);
    let response = cache.get(key);
    if (response) cached += 1;
    else {
      try {
        response = await callClef(request, credentials);
      } catch (error) {
        failures.push({ id: row.id, error: error.message });
        return;
      }
      sent += 1;
      cache.set(key, response);
      if (opts.cache) fs.appendFileSync(opts.cache, JSON.stringify({ key, id: row.id, response }) + '\n');
    }
    let clef;
    try {
      clef = readClefAnswers(response);
    } catch (error) {
      failures.push({ id: row.id, error: error.message });
      return;
    }
    scoreClefRow(audit, row, parser, clef, opts.threshold);
  });

  if (opts.dryRun) {
    const summary = { dryRun: true, model: opts.model, rows: rows.length, sets: bySet, questions: Object.keys(QUESTIONS) };
    log(JSON.stringify(summary));
    return summary;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    model: `@cf/cloudflare/${opts.model}`,
    threshold: opts.threshold,
    sets: bySet,
    requests: { sent, cached, failed: failures.length },
    ...summarizeClefAudit(audit),
    failures,
  };
  if (opts.json) fs.writeFileSync(opts.json, JSON.stringify(report, null, 1) + '\n');

  log(`model ${report.model}  rows ${report.rows}  sent ${sent}  cached ${cached}  failed ${failures.length}`);
  for (const [field, s] of Object.entries(report.fields)) {
    log(`${field.padEnd(10)} n=${s.n}  parser=${s.parserAccuracy}  clef=${s.clefAccuracy}  agree=${s.agreement}  ` +
      `onlyClefRight=${s.onlyClefRight}  onlyParserRight=${s.onlyParserRight}  brier=${s.clefBrier}  ece=${s.clefEce}`);
  }
  log(`leads (parser wrong, Clef right, confidence >= ${opts.threshold}): ${report.leads.length}`);
  for (const lead of report.leads.slice(0, 25)) {
    log(`  ${lead.id}  ${lead.field}: label=${lead.label} parser=${lead.parser} clef=${lead.clef} (${lead.confidence})`);
  }
  log(`overconfident Clef errors: ${report.overconfident.length}`);
  return report;
}

if (require.main === module) {
  main().then((report) => {
    if (report.failures?.length) process.exitCode = 1;
  }, (error) => {
    console.error(`clef-audit: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main, parseArgs, sample };
