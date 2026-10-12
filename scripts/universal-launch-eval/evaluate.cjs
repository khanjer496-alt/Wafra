#!/usr/bin/env node
/**
 * Worldwide bank-alert launch evaluation.
 *
 * Drives the SHIPPING parser through the same two entry points the app uses
 * for a bank alert outside the UAE/Saudi launch grammar:
 *
 *  - android-sms: Android SMS inbox/delivery (auto-import.ts scanInbox). A
 *    UAE/Saudi sender takes `parse`, every other sender `parseUnproven`.
 *  - ios-history: the iPhone Messages History import (historical-import.ts).
 *    iOS 26 Find Messages exposes no sender, so the record is senderless.
 *
 * Each row states what a correct app does with the alert: post it (with the
 * exact amount, ledger currency, income/expense and, optionally, a merchant)
 * or not post it (OTP, decline, promotion, pending hold, bill, balance...).
 * A miss is not a failure of safety: it means the alert waits in Review. A
 * false post IS a safety failure, and so is a wrong amount or direction.
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

const BUILD = path.join(__dirname, '..', 'test', 'build');
const req = (name) => require(path.join(BUILD, name));

const { createLaunchAlertSession } = req('launch-alert-parser');
const { setActiveCountry } = req('country');
const { setLedgerCurrency, setActiveMarket, detectLaunchMarketFromSender } = req('markets');
const { hasUniversalInstitutionSender } = req('alert-institution-grammars');
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
  return launch
    ? session.parse(row.body, sender, worldwide, launch, OBSERVED_AT)
    : session.parseUnproven(row.body, sender, worldwide, OBSERVED_AT);
};

const iosHistory = (row) => {
  const session = configure(row);
  const sender = '';
  const inspection = session.inspect(row.body, sender);
  const foreignIssuer = !detectLaunchMarketFromSender(sender) && hasUniversalInstitutionSender(sender);
  const foreignRoute = inspection?.route.decision === 'single' &&
    inspection.route.market !== 'AE' && inspection.route.market !== 'SA';
  const result = foreignIssuer || foreignRoute
    ? session.parseUnproven(row.body, sender, inspection, OBSERVED_AT)
    : session.parse(row.body, sender, inspection, undefined, OBSERVED_AT);
  if (!result) return null;
  const bestEffortAccepted = !!result.bestEffort && result.kind === 'transaction' && result.currency === row.ledger;
  if (!bestEffortAccepted && (result.bestEffort || (result.currency !== 'AED' && result.currency !== 'SAR'))) {
    // historical-import.ts sends this to its refusal inspector (Review), except
    // a card statement/payment in the ledger currency, which it keeps.
    if (result.kind !== 'transaction' && result.currency === row.ledger) return result;
    return null;
  }
  return result;
};

const PATHS = { 'android-sms': androidSms, 'ios-history': iosHistory };

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
  if (!expect.post) {
    if (!parsed) return { verdict: 'pass' };
    // A card statement or card-bill payment is an obligation/settlement row,
    // never income or spending; a non-posting row may legitimately yield one.
    if (parsed.kind !== 'transaction') return { verdict: 'pass', soft: `obligation ${parsed.kind}`, parsed: summarize(parsed) };
    return { verdict: 'false-post', detail: summarize(parsed) };
  }
  if (!parsed) return { verdict: 'miss' };
  const wantKind = expect.kind ?? 'transaction';
  if (parsed.kind !== wantKind) return { verdict: 'wrong', detail: `kind ${parsed.kind} != ${wantKind}`, parsed: summarize(parsed) };
  if (parsed.currency !== (expect.currency ?? row.ledger)) return { verdict: 'wrong', detail: `currency ${parsed.currency}`, parsed: summarize(parsed) };
  if (parsed.amountFils !== expect.amountMinor) return { verdict: 'wrong', detail: `amount ${parsed.amountFils} != ${expect.amountMinor}`, parsed: summarize(parsed) };
  if (expect.type && parsed.type !== expect.type) return { verdict: 'wrong', detail: `type ${parsed.type} != ${expect.type}`, parsed: summarize(parsed) };
  if (expect.transfer !== undefined && !!parsed.transferHint !== expect.transfer) {
    return { verdict: 'pass', soft: `transferHint ${!!parsed.transferHint} != ${expect.transfer}`, parsed: summarize(parsed) };
  }
  if (expect.merchant) {
    const ok = String(parsed.merchant ?? '').toLowerCase().includes(String(expect.merchant).toLowerCase());
    if (!ok) return { verdict: 'pass', soft: `merchant "${parsed.merchant}" lacks "${expect.merchant}"`, parsed: summarize(parsed) };
  }
  return { verdict: 'pass', parsed: summarize(parsed) };
};

const summarize = (p) => p && ({
  kind: p.kind, type: p.type, amount: p.amountFils, currency: p.currency, merchant: p.merchant,
  date: p.date, category: p.categoryGuess, transfer: !!p.transferHint, marker: p.bestEffort?.format ?? null,
});

function evaluateRows(rows, { onlyPath = null } = {}) {
  const results = [];
  for (const row of rows) {
    for (const [name, run] of Object.entries(PATHS)) {
      if (onlyPath && name !== onlyPath) continue;
      // A row may restrict itself to one path (e.g. a sender-dependent rule).
      if (row.paths && !row.paths.includes(name)) continue;
      let parsed;
      let error = null;
      try {
        parsed = run(row);
      } catch (e) {
        parsed = null;
        error = String(e && e.stack || e);
      }
      const g = error ? { verdict: 'error', detail: error } : grade(row, parsed);
      const out = { id: row.id, file: row.file, path: name, country: row.country, expectPost: !!row.expect.post, ...g };
      if (g.verdict === 'miss' || g.verdict === 'false-post' || g.verdict === 'wrong') {
        out.diagnosis = diagnose(row, name === 'ios-history' ? '' : row.sender ?? '');
      }
      results.push(out);
    }
  }

  const tally = {};
  for (const r of results) {
    const key = r.path;
    tally[key] ??= { positives: 0, posted: 0, missed: 0, wrong: 0, negatives: 0, held: 0, falsePosts: 0, errors: 0, soft: 0 };
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
      if (r.verdict === 'pass') t.held += 1;
      if (r.verdict === 'false-post') t.falsePosts += 1;
    }
  }

  const byCountry = {};
  for (const r of results.filter((x) => x.path === 'android-sms')) {
    byCountry[r.country] ??= { pos: 0, ok: 0, neg: 0, fp: 0, wrong: 0 };
    const c = byCountry[r.country];
    if (r.expectPost) { c.pos += 1; if (r.verdict === 'pass') c.ok += 1; if (r.verdict === 'wrong') c.wrong += 1; }
    else { c.neg += 1; if (r.verdict === 'false-post') c.fp += 1; }
  }

  return { results, tally, byCountry };
}

const loadCorpus = (corpusFiles) => corpusFiles.flatMap((file) => {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(data) ? data : data.rows;
  return list.map((row) => ({ ...row, file: path.basename(file) }));
});

module.exports = { evaluateRows, loadCorpus, OBSERVED_AT };

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
      console.log(`${name}: recall ${t.posted}/${t.positives} (${pct(t.posted, t.positives)}), ` +
        `wrong ${t.wrong}, false posts ${t.falsePosts}/${t.negatives}, soft ${t.soft}, errors ${t.errors}`);
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
