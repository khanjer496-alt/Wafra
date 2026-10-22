#!/usr/bin/env node
/**
 * Worldwide bank-alert launch evaluation.
 *
 * Evaluates accepted structured records at these SHIPPING code boundaries:
 *
 *  - android-sms: the LaunchAlertSession parser seam used by Android SMS
 *    inbox/delivery. This does not execute the collector or import planner.
 *  - ios-history: actual parseHistoricalMessageRecords with a synthetic v1
 *    envelope. iOS 26 Find Messages has no sender, so it stays senderless.
 *
 * Each row states whether a structured record may be accepted, with exact
 * native money and direction. A non-posting row forbids ANY accepted record,
 * unless it explicitly permits an exact typed obligation. A miss is safe;
 * only the real History path reports whether it reaches Review. Acceptance
 * here is not proof of final ledger mutation, delivery, or device behavior.
 *
 * Usage:
 *   node scripts/universal-launch-eval/evaluate.cjs [corpus.json ...] [--json] [--failures] [--path android-sms|ios-history]
 *
 * Requires the compiled modules in scripts/test/build (bash scripts/test/build.sh).
 * The corpus rows are synthetic text in each bank's published or commonly
 * reported format with fictional values. They are not consented real alerts
 * and never count toward the automatic-import gates in
 * docs/universal-parser-rollout.md.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('node:crypto');

const BUILD = process.env.WAFRA_TEST_BUILD_DIR || path.join(__dirname, '..', 'test', 'build');
const req = (name) => require(path.join(BUILD, name));

const { createLaunchAlertSession } = req('launch-alert-parser');
const { setActiveCountry } = req('country');
const { setLedgerCurrency, setActiveMarket, detectLaunchMarketFromSender } = req('markets');
const { parseHistoricalMessageRecords } = req('historical-import');
const { inspectUniversalBankEvent } = req('universal-parser');
const policy = req('best-effort-autopost');
const { currencyMinorUnits } = req('currency-metadata');

// A fixed observation time so "not in the future" is deterministic: 12 Oct
// 2026, 12:00 local. Rows dated after this are future-dated by construction.
const OBSERVED_AT = new Date(2026, 9, 12, 12, 0, 0).getTime();

const configure = (row) => {
  setActiveCountry(row.country);
  const exponent = currencyMinorUnits(row.ledger);
  setLedgerCurrency(row.ledger, exponent === 0 || exponent === 3 ? exponent : 2);
  setActiveMarket(row.country === 'AE' || row.country === 'SA' ? row.country : 'ZZ');
  policy.setBestEffortAutoPostEnabled(true);
  // Mirrors the app: the person's country and pinned ledger currency, the
  // default-on best-effort setting, and no FX rate on the device.
  return createLaunchAlertSession({
    overrides: {},
    pinnedCurrency: row.ledger,
    fxLookup: () => null,
    bestEffort: { enabled: true, country: row.country },
    regionHint: row.country,
  });
};

const androidSms = (row) => {
  const session = configure(row);
  const sender = row.sender ?? '';
  const worldwide = session.inspect(row.body, sender);
  const launch = detectLaunchMarketFromSender(sender);
  const parsed = launch
    ? session.parse(row.body, sender, worldwide, launch, OBSERVED_AT)
    : session.parseUnproven(row.body, sender, worldwide, OBSERVED_AT);
  const { raw: _raw, ...structured } = parsed ?? {};
  return { boundary: 'launch-alert-session', accepted: parsed ? [structured] : [], review: null };
};

const iosHistory = (row) => {
  const session = configure(row);
  // A fictional Apple Message identity exercises the real envelope validation
  // and import policy. A fresh seen set isolates rows; sender stays absent.
  const serialized = JSON.stringify({
    v: 1,
    id: createHash('sha256').update(`synthetic-launch-evaluation:${row.id}`).digest('hex'),
    text: row.body,
    receivedAt: new Date(OBSERVED_AT).toISOString(),
  });
  const result = parseHistoricalMessageRecords([serialized], {}, new Date(OBSERVED_AT), new Set(), session);
  if (result.invalidCount || result.parsed.length > 1) {
    throw new Error(`Unexpected synthetic History envelope outcome: invalid=${result.invalidCount}, accepted=${result.parsed.length}`);
  }
  return {
    boundary: 'historical-import',
    accepted: result.parsed,
    review: result.reviewCandidates.map((item) => ({
      family: item.kind === 'universal' ? item.event.family : item.family,
      observedAt: item.observedAt,
    })),
    counts: { total: result.totalCount, invalid: result.invalidCount, ignored: result.ignoredCount,
      declined: result.declined.length, duplicate: result.duplicateCount },
  };
};

const PATHS = { 'android-sms': androidSms, 'ios-history': iosHistory };
const runCapturePath = (row, name) => {
  if (!Object.hasOwn(PATHS, name)) throw new Error(`Unknown capture path: ${name}`);
  return PATHS[name](row);
};

/** Why the unproven seam refused, for triage only (never an import decision). */
const diagnose = (row, sender) => {
  configure(row);
  const event = inspectUniversalBankEvent(row.body, { sender, dateOrder: undefined });
  const decision = policy.decideBestEffortAutoPost({
    source: row.body, sender, event, enabled: true, country: row.country,
    routedMarket: null, launchSenderMarket: null, ledgerCurrency: row.ledger,
    ledgerExponent: currencyMinorUnits(row.ledger), observedAt: OBSERVED_AT, fxLookup: () => null,
  });
  const guards = [];
  if (policy.hasNonCompletedWording(row.body, null, sender)) guards.push('non-completed-wording');
  if (policy.isNotAutoPostableMoney(row.body)) guards.push('not-auto-postable-money');
  if (policy.hasLinkFromUnregisteredSender(row.body, sender)) guards.push('link-unregistered-sender');
  return {
    status: event.status, family: event.family, direction: event.direction, decision: event.decision,
    amount: event.amount.value ? `${event.amount.value.currency} ${event.amount.value.minorUnits}/${event.amount.value.exponent}` : event.amount.evidence,
    amountAlternatives: event.amount.alternatives.length,
    merchant: event.merchant.value,
    issues: event.issues,
    policy: decision.outcome === 'post' ? 'post' : decision.reason,
    guards,
  };
};

const grade = (row, parsed) => {
  const expect = row.expect;
  let want = expect;
  if (!expect.post) {
    want = expect.acceptedObligation;
    if (want && (!['cardStatement', 'cardPayment'].includes(want.kind) ||
        !Number.isSafeInteger(want.amountMinor) || want.amountMinor < 0 ||
        !/^[A-Z]{3}$/.test(want.currency ?? '') ||
        want.card?.kind !== 'credit' || !/^\d{4}$/.test(want.card.last4) ||
        (want.kind === 'cardPayment' && !['receipt', 'debit'].includes(want.cardPaymentSide)))) {
      return { verdict: 'error', detail: 'An accepted obligation requires its exact kind, native money, credit-card kind and tail' };
    }
    if (!parsed) return { verdict: 'pass' };
    if (!want) return { verdict: 'false-post', detail: summarize(parsed) };
  }
  if (!parsed) return { verdict: 'miss' };
  const wantKind = want.kind ?? 'transaction';
  if (parsed.kind !== wantKind) return { verdict: 'wrong', detail: `kind ${parsed.kind} != ${wantKind}`, parsed: summarize(parsed) };
  if (parsed.currency !== (want.currency ?? row.ledger)) return { verdict: 'wrong', detail: `currency ${parsed.currency}`, parsed: summarize(parsed) };
  if (parsed.amountFils !== want.amountMinor) return { verdict: 'wrong', detail: `amount ${parsed.amountFils} != ${want.amountMinor}`, parsed: summarize(parsed) };
  if (want.type && parsed.type !== want.type) return { verdict: 'wrong', detail: `type ${parsed.type} != ${want.type}`, parsed: summarize(parsed) };
  if (want.card && (parsed.card?.kind !== want.card.kind || parsed.card?.last4 !== want.card.last4)) {
    return { verdict: 'wrong', detail: 'credit-card identity differs from the explicit expectation', parsed: summarize(parsed) };
  }
  if (want.cardPaymentSide && parsed.cardPaymentSide !== want.cardPaymentSide) {
    return { verdict: 'wrong', detail: `payment leg ${parsed.cardPaymentSide} != ${want.cardPaymentSide}`, parsed: summarize(parsed) };
  }
  if (want.transfer !== undefined && !!parsed.transferHint !== want.transfer) {
    return { verdict: 'pass', soft: `transferHint ${!!parsed.transferHint} != ${want.transfer}`, parsed: summarize(parsed) };
  }
  if (want.merchant) {
    const ok = String(parsed.merchant ?? '').toLowerCase().includes(String(want.merchant).toLowerCase());
    if (!ok) return { verdict: 'pass', soft: `merchant "${parsed.merchant}" lacks "${want.merchant}"`, parsed: summarize(parsed) };
  }
  return { verdict: 'pass', parsed: summarize(parsed) };
};

const summarize = (p) => p && ({
  kind: p.kind, type: p.type, amount: p.amountFils, currency: p.currency, merchant: p.merchant,
  date: p.date, category: p.categoryGuess, transfer: !!p.transferHint, marker: p.bestEffort?.format ?? null,
  card: p.card ?? null, cardPaymentSide: p.cardPaymentSide ?? null,
});

function evaluateRows(rows, { onlyPath = null } = {}) {
  const results = [];
  for (const row of rows) {
    for (const name of Object.keys(PATHS)) {
      if (onlyPath && name !== onlyPath) continue;
      // A row may restrict itself to one path (e.g. a sender-dependent rule).
      if (row.paths && !row.paths.includes(name)) continue;
      let capture;
      let parsed;
      let error = null;
      try {
        capture = runCapturePath(row, name);
        parsed = capture.accepted[0] ?? null;
      } catch (e) {
        parsed = null;
        error = String(e && e.stack || e);
      }
      const pathRow = row.expectByPath?.[name] ? { ...row, expect: row.expectByPath[name] } : row;
      const g = error ? { verdict: 'error', detail: error } : grade(pathRow, parsed);
      const out = { id: row.id, file: row.file, path: name, country: row.country, expectPost: !!pathRow.expect.post,
        boundary: capture?.boundary, acceptedCount: capture?.accepted.length ?? 0,
        reviewCount: capture?.review?.length ?? null, reviewFamilies: capture?.review?.map((item) => item.family) ?? null, ...g };
      if (g.verdict === 'miss' || g.verdict === 'false-post' || g.verdict === 'wrong') {
        out.diagnosis = diagnose(row, name === 'ios-history' ? '' : row.sender ?? '');
      }
      results.push(out);
    }
  }

  const tally = {};
  for (const r of results) {
    const key = r.path;
    tally[key] ??= { positives: 0, posted: 0, missed: 0, wrong: 0, negatives: 0, held: 0, acceptedObligations: 0, falsePosts: 0, errors: 0, soft: 0 };
    const t = tally[key];
    if (r.verdict === 'error') t.errors += 1;
    if (r.expectPost) {
      t.positives += 1;
      if (r.verdict === 'pass') t.posted += 1;
      if (r.verdict === 'miss') t.missed += 1;
      if (r.verdict === 'wrong') t.wrong += 1;
      if (r.soft) t.soft += 1;
    } else {
      t.negatives += 1;
      if (r.verdict === 'pass' && r.acceptedCount === 0) t.held += 1;
      if (r.verdict === 'pass' && r.acceptedCount > 0) t.acceptedObligations += 1;
      if (r.verdict === 'wrong') t.wrong += 1;
      if (r.verdict === 'false-post') t.falsePosts += 1;
    }
  }

  const byCountry = {};
  for (const r of results.filter((x) => x.path === 'android-sms')) {
    byCountry[r.country] ??= { pos: 0, ok: 0, neg: 0, fp: 0, wrong: 0 };
    const c = byCountry[r.country];
    if (r.expectPost) { c.pos += 1; if (r.verdict === 'pass') c.ok += 1; if (r.verdict === 'wrong') c.wrong += 1; }
    else { c.neg += 1; if (r.verdict === 'false-post') c.fp += 1; if (r.verdict === 'wrong') c.wrong += 1; }
  }

  return { results, tally, byCountry };
}

const loadCorpus = (corpusFiles) => corpusFiles.flatMap((file) => {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(data) ? data : data.rows;
  return list.map((row) => ({ ...row, file: path.basename(file) }));
});

module.exports = { evaluateRows, loadCorpus, runCapturePath, grade, OBSERVED_AT };

if (require.main === module) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const pathArgIndex = args.indexOf('--path');
  const onlyPath = pathArgIndex >= 0 ? args[pathArgIndex + 1] : null;
  const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--path');
  const corpusFiles = files.length
    ? files
    : fs.readdirSync(path.join(__dirname, 'corpus'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.join(__dirname, 'corpus', f));

  const rows = loadCorpus(corpusFiles);
  const { results, tally, byCountry } = evaluateRows(rows, { onlyPath });

  if (flags.has('--json')) {
    process.stdout.write(JSON.stringify({ tally, byCountry, results }, null, 2));
  } else {
    const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
    console.log(`rows: ${rows.length} from ${corpusFiles.length} file(s)`);
    for (const [name, t] of Object.entries(tally)) {
      console.log(`${name}: accepted positive records ${t.posted}/${t.positives} (${pct(t.posted, t.positives)}), ` +
        `wrong ${t.wrong}, unexpected accepted records ${t.falsePosts}/${t.negatives}, expected obligations ${t.acceptedObligations}, soft ${t.soft}, errors ${t.errors}`);
    }
    console.log('android-sms by country (posted/positives, false posts/negatives, wrong):');
    console.log(Object.entries(byCountry).sort().map(([c, v]) => `  ${c} ${v.ok}/${v.pos} fp ${v.fp}/${v.neg}${v.wrong ? ` wrong ${v.wrong}` : ''}`).join('\n'));
    if (flags.has('--failures')) {
      for (const r of results.filter((x) => x.verdict !== 'pass' || x.soft)) {
        console.log(JSON.stringify(r));
      }
    }
  }
  const unsafe = results.filter((r) => r.verdict === 'false-post' || r.verdict === 'wrong' || r.verdict === 'error');
  process.exitCode = flags.has('--strict') && unsafe.length ? 1 : 0;
}
