/**
 * The launch gate: can an engine be trusted to write money on a bank it has
 * never seen, and to stay silent on a message that is not a transaction?
 *
 *   node scripts/parser-benchmark/qualification.mjs
 *   node scripts/parser-benchmark/qualification.mjs --engine ./my-model.mjs
 *   node scripts/parser-benchmark/qualification.mjs --gate        # exit 1 on any unsafe import
 *   node scripts/parser-benchmark/qualification.mjs --json out.json
 *
 * WHY THIS IS SEPARATE FROM run.mjs
 *
 * `run.mjs` asks whether a candidate matches the shipped rules on the corpus
 * the rules were built against. That is a regression question, and an engine
 * can score 100% on it while being unusable in Brazil. This asks the other
 * question: held-out markets with no grammar, and messages that must never
 * produce a row at all.
 *
 * THE ONE NUMBER THAT DECIDES SHIPPABILITY
 *
 * `unsafe` — money the engine would write that the user did not spend. It is
 * not a rate and it is not traded off against coverage. The target is zero,
 * and an engine with one unsafe import at 95% coverage is worse than one with
 * zero at 15%, because the first silently corrupts a ledger and the second
 * merely asks more questions.
 *
 * Unsafe has two shapes and both count:
 *
 *   1. Posting a row for a message that is not a posted transaction — a
 *      declined card, an OTP, a fraud warning, an advertisement.
 *   2. Posting a row for a real transaction with the wrong money — wrong
 *      amount, wrong currency, or wrong direction. A credit booked as a debit
 *      is invented money twice over.
 *
 * WHAT THIS HARNESS CANNOT TELL YOU
 *
 * Every row in both corpora is `synthetic` / `near-real-template`: our
 * reconstruction of what we believe these banks send. Per
 * `scripts/test/fixtures/README.md` a synthetic row can never be evidence
 * that a bank or market is supported, so this report never marks anything
 * certifiable and says so in its own output. It is a DISQUALIFIER, not a
 * certificate: refusing to invent money is a property an engine either has or
 * does not, and a synthetic counter-example is enough to prove it does not.
 *
 * `validation/semantic-parser/FINDINGS.md` is why the gate is shaped this way.
 * A confidence threshold tuned to zero unsafe imports in-domain produced three
 * unsafe imports one dialect away, and two independently trained models agreed
 * at high confidence on every case where the first was confidently wrong. So
 * confidence is reported here, never trusted.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const BUILD = path.join(ROOT, 'scripts/test/build');
const require = createRequire(import.meta.url);

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const enginePath = flag('engine');
const jsonOut = flag('json');
const gate = has('gate');

if (!fs.existsSync(path.join(BUILD, 'sms-parser.js'))) {
  process.stderr.write('qualification: scripts/test/build is missing; building it now.\n');
  execFileSync('bash', [path.join(ROOT, 'scripts/test/build.sh')], { stdio: 'inherit' });
}

const heldOut = require(path.join(ROOT, 'scripts/test/fixtures/qualification-unseen-markets.js'));
const negatives = require(path.join(ROOT, 'scripts/test/fixtures/qualification-negatives.js'));

const engineUrl = enginePath === null
  ? path.join(HERE, 'engines/rules.mjs')
  : path.resolve(process.cwd(), enginePath);
const engine = await import(engineUrl);
const engineName = engine.name ?? path.basename(engineUrl);

/* ── Corpus freeze ───────────────────────────────────────────────────── */

/**
 * A qualification set that can be edited without anyone noticing is not a
 * qualification set. This hashes the bodies and their expectations, so a run
 * can be compared against a recorded digest and a quietly softened row shows
 * up as a different corpus rather than a better score.
 */
const digest = (rows, fields) => crypto.createHash('sha256').update(
  rows.map((row) => fields.map((f) => JSON.stringify(row[f] ?? null)).join('\u0000')).join('\u0001'),
).digest('hex').slice(0, 16);

const corpusDigest = {
  heldOut: digest(heldOut, ['id', 'market', 'body', 'expected']),
  negatives: digest(negatives, ['id', 'kind', 'reason', 'body']),
};

/* ── What "would write a row" means ──────────────────────────────────── */

const MOVES_MONEY = new Set(['debit', 'credit']);

/**
 * An engine result that, if the certification layer allowed it, would become a
 * ledger row: a reviewable decision, a posted state, a direction that moves
 * money, and an amount to move. Anything missing any of those cannot post, so
 * it cannot be unsafe.
 */
const postable = (got) => Boolean(
  got
  && got.decision === 'review'
  && got.status === 'posted'
  && MOVES_MONEY.has(got.direction)
  && got.minorUnits !== null && got.minorUnits !== undefined,
);

/** Truth: does this held-out row describe money that actually moved? */
const trulyPostable = (row) => Boolean(
  row.expected
  && row.expected.decision === 'review'
  && row.expected.status === 'posted'
  && MOVES_MONEY.has(row.expected.direction),
);

/** Exact money: the amount, its currency and its direction all correct. */
const moneyExact = (got, want) => Boolean(
  got && String(got.minorUnits) === String(want.minorUnits)
  && got.currency === want.currency
  && got.direction === want.direction,
);

/**
 * Markets Wafra has a grammar for. A held-out market must NOT be scored
 * through `reviewAlert`: that seam needs a market pack and throws without one,
 * so it would measure the absence of a pack rather than the engine.
 */
const PACKED_MARKETS = new Set([
  'US', 'GB', 'FR', 'DE', 'ES', 'IT', 'NL', 'IN', 'QA', 'KW', 'BH', 'OM', 'EG', 'JO',
]);

/**
 * Three outcomes, and they are not the same thing:
 *   an object   the engine read the message
 *   null        the engine deliberately refused — the safe answer
 *   { threw }   the engine crashed, which is a defect even when nothing posts
 */
const run = (row, market) => {
  const unknownMarket = !PACKED_MARKETS.has(market);
  const method = unknownMarket
    ? (engine.reviewUnknownMarket ? (body, ctx) => engine.reviewUnknownMarket(body, ctx) : null)
    : (engine.reviewAlert ? (body, ctx) => engine.reviewAlert(body, market, ctx) : null);
  if (!method) return { unsupported: true };
  try {
    return method(row.body, { sender: row.sender }) ?? null;
  } catch (error) {
    return { threw: error instanceof Error ? error.message.slice(0, 120) : 'unknown' };
  }
};

/* ── Section 1: held-out markets ─────────────────────────────────────── */

const heldOutReport = () => {
  if (!engine.reviewUnknownMarket && !engine.reviewAlert) {
    return { skipped: 'engine has neither reviewUnknownMarket nor reviewAlert' };
  }

  const perMarket = {};
  const unsafeRows = [];
  let postableTruth = 0;
  let safeAutomatic = 0;
  let reviewReached = 0;
  let statusRight = 0;
  let directionRight = 0;
  let amountRight = 0;
  let scored = 0;
  let threw = 0;
  let refused = 0;
  let unsupported = 0;

  for (const row of heldOut) {
    const market = row.market;
    perMarket[market] ??= { rows: 0, safe: 0, unsafe: 0, amountRight: 0 };
    perMarket[market].rows += 1;
    scored += 1;

    const got = run(row, market);
    if (got && got.unsupported) { unsupported += 1; continue; }
    if (got && got.threw) { threw += 1; continue; }
    // A null is a refusal, and a refusal is never unsafe. It still costs
    // coverage, which is what the coverage metrics below are for.
    if (got === null) refused += 1;

    const want = row.expected;
    const truth = trulyPostable(row);
    if (truth) postableTruth += 1;

    if (got && got.status === want.status) statusRight += 1;
    if (got && got.direction === want.direction) directionRight += 1;
    const money = got && moneyExact(got, want);
    if (money) { amountRight += 1; perMarket[market].amountRight += 1; }

    const wouldPost = postable(got);

    if (wouldPost && !truth) {
      unsafeRows.push({ id: row.id, market, why: 'posted a non-posting alert', got, want });
      perMarket[market].unsafe += 1;
    } else if (wouldPost && truth && !money) {
      unsafeRows.push({ id: row.id, market, why: 'posted with wrong money', got, want });
      perMarket[market].unsafe += 1;
    } else if (wouldPost && truth && money) {
      safeAutomatic += 1;
      perMarket[market].safe += 1;
    }

    // Reaching review at all is what stops a real transaction vanishing.
    if (truth && got && got.decision === 'review') reviewReached += 1;
  }

  return {
    rows: heldOut.length, scored, threw, refused, unsupported,
    markets: Object.keys(perMarket).length,
    postableTruth,
    safeAutomatic,
    unsafe: unsafeRows.length,
    unsafeRows: unsafeRows.slice(0, 20),
    perMarket,
    metrics: {
      safeAutomaticCoverage: pct(safeAutomatic, postableTruth),
      reviewCoverage: pct(reviewReached, postableTruth),
      postingStateAccuracy: pct(statusRight, scored),
      directionAccuracy: pct(directionRight, scored),
      amountAccuracy: pct(amountRight, scored),
    },
  };
};

/* ── Section 2: messages that must never post ────────────────────────── */

const negativeReport = () => {
  if (!engine.reviewUnknownMarket && !engine.reviewAlert) {
    return { skipped: 'engine has neither reviewUnknownMarket nor reviewAlert' };
  }

  const perKind = {};
  const leaked = [];
  const upstream = [];
  let refused = 0;
  let threw = 0;

  for (const row of negatives) {
    perKind[row.kind] ??= { rows: 0, refused: 0, leaked: 0 };
    perKind[row.kind].rows += 1;

    const got = run(row, row.market);
    if (got && got.unsupported) { continue; }
    if (got && got.threw) { threw += 1; refused += 1; perKind[row.kind].refused += 1; continue; }

    if (postable(got)) {
      // A row whose defence is upstream is still reported, but it is not the
      // semantic layer's failure and must not be counted as one.
      const defence = row.defence ?? 'semantic';
      leaked.push({ id: row.id, kind: row.kind, reason: row.reason, defence, got });
      perKind[row.kind].leaked += 1;
      if (defence !== 'semantic') upstream.push(row.id);
    } else {
      refused += 1;
      perKind[row.kind].refused += 1;
    }
  }

  return {
    rows: negatives.length, refused, threw,
    // Only rows this layer owes a refusal for count against it.
    unsafe: leaked.length - upstream.length,
    deferredToSourceTrust: upstream,
    leaked: leaked.slice(0, 20),
    perKind,
    metrics: { oodRejection: pct(refused, negatives.length) },
  };
};

function pct(n, d) { return d === 0 ? null : Math.round((n / d) * 1000) / 10; }

/* ── Report ──────────────────────────────────────────────────────────── */

const heldOutResult = heldOutReport();
const negativeResult = negativeReport();

const unsafeTotal = (heldOutResult.unsafe ?? 0) + (negativeResult.unsafe ?? 0);
const autoAttempts = (heldOutResult.safeAutomatic ?? 0) + unsafeTotal;

const out = [];
const w = (line = '') => out.push(line);

w(`\nQualification — ${engineName}`);
if (engine.description) w(`  ${engine.description}`);
w(`  corpus  held-out ${corpusDigest.heldOut} · negatives ${corpusDigest.negatives}`);
w(`  NOT A CERTIFICATE: every row is synthetic/near-real-template, so nothing here`);
w(`  can make a bank or market eligible for automatic import. It can only disqualify.`);

w(`\n── Held-out markets (no grammar exists for any of these) ──`);
if (heldOutResult.skipped) {
  w(`  not implemented: ${heldOutResult.skipped}`);
} else {
  const m = heldOutResult.metrics;
  w(`  ${heldOutResult.rows} rows across ${heldOutResult.markets} markets`);
  w(`    refused outright         ${heldOutResult.refused}/${heldOutResult.scored}   (safe, but no coverage)`);
  if (heldOutResult.threw) w(`    CRASHED                  ${heldOutResult.threw}   (a defect even though nothing posts)`);
  w(`    posting-state accuracy   ${m.postingStateAccuracy}%`);
  w(`    direction accuracy       ${m.directionAccuracy}%`);
  w(`    amount+currency accuracy ${m.amountAccuracy}%`);
  w(`    review coverage          ${m.reviewCoverage}%   (real transactions that reach the user)`);
  w(`    safe automatic coverage  ${m.safeAutomaticCoverage}%   (postable AND money exact)`);
  w(`    unsafe                   ${heldOutResult.unsafe}`);
}

w(`\n── Must never post (OOD / security / marketing / non-financial) ──`);
if (negativeResult.skipped) {
  w(`  not implemented: ${negativeResult.skipped}`);
} else {
  w(`  ${negativeResult.rows} rows`);
  w(`    OOD rejection            ${negativeResult.metrics.oodRejection}%`);
  w(`    unsafe (semantic layer)  ${negativeResult.unsafe}`);
  if (negativeResult.deferredToSourceTrust?.length) {
    w(`    deferred to source trust ${negativeResult.deferredToSourceTrust.length}   (${negativeResult.deferredToSourceTrust.join(', ')})`);
    w(`      these read as genuine debit alerts by wording alone; the sender and`);
    w(`      the link are what give them away, so sourceClass owes the refusal.`);
  }
  for (const [kind, k] of Object.entries(negativeResult.perKind)) {
    w(`      ${kind.padEnd(16)} ${String(k.refused).padStart(3)}/${String(k.rows).padEnd(3)} refused${k.leaked ? `   ${k.leaked} LEAKED` : ''}`);
  }
}

w(`\n── Gate ──`);
w(`  unsafe imports           ${unsafeTotal}`);
w(`  auto-import precision    ${autoAttempts === 0 ? 'n/a (never auto-imports)' : `${pct(heldOutResult.safeAutomatic ?? 0, autoAttempts)}%`}`);
w(`  VERDICT                  ${unsafeTotal === 0 ? 'PASS — no invented money on this set' : `FAIL — ${unsafeTotal} unsafe`}`);

for (const row of (heldOutResult.unsafeRows ?? [])) {
  w(`    unsafe ${row.id} (${row.market}) — ${row.why}`);
}
for (const row of (negativeResult.leaked ?? [])) {
  w(`    leaked ${row.id} [${row.kind}/${row.reason}, defence=${row.defence}] — ${row.got?.currency ?? '?'} ${row.got?.minorUnits ?? '?'}`);
}
w();

process.stdout.write(out.join('\n'));

if (jsonOut) {
  fs.writeFileSync(jsonOut, `${JSON.stringify({
    engine: engineName, corpusDigest,
    heldOut: heldOutResult, negatives: negativeResult,
    gate: { unsafe: unsafeTotal, pass: unsafeTotal === 0 },
    certifiable: false,
  }, null, 2)}\n`);
}

if (gate && unsafeTotal > 0) process.exit(1);
