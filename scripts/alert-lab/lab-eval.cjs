'use strict';
/**
 * Drives generated alerts through the SHIPPING capture boundaries and grades
 * them against their labels.
 *
 * Decisions come from scripts/universal-launch-eval/evaluate.cjs's own
 * `runCapturePath` (android-sms = LaunchAlertSession parse/parseUnproven by
 * sender route; ios-history = parseHistoricalMessageRecords, senderless), so
 * the lab and the synthetic launch eval can never disagree about how an alert
 * is run. The only thing added here is Android "would reach Review": the same
 * session's worldwide inspection decision, computed for unbooked positives.
 *
 * The report is a mergeable plain object so worker processes can each grade a
 * slice of markets and the parent can add them up.
 */
const fs = require('fs');
const path = require('path');
const { shortHash } = require('./lib/prng.cjs');

const PATHS = ['android-sms', 'ios-history'];

function createDriver(repo) {
  const build = path.join(repo, 'scripts', 'test', 'build');
  if (!fs.existsSync(path.join(build, 'launch-alert-parser.js'))) {
    throw new Error(`No compiled parser at ${build}. Run: bash ${path.join(repo, 'scripts/test/build.sh')}`);
  }
  process.env.WAFRA_TEST_BUILD_DIR = build;
  const own = path.join(__dirname, '..', 'universal-launch-eval', 'evaluate.cjs');
  const theirs = path.join(repo, 'scripts', 'universal-launch-eval', 'evaluate.cjs');
  const ev = require(fs.existsSync(theirs) ? theirs : own);
  const req = (name) => require(path.join(build, name));
  const { createLaunchAlertSession } = req('launch-alert-parser');
  const { setActiveCountry } = req('country');
  const { setLedgerCurrency, setActiveMarket, detectLaunchMarketFromSender } = req('markets');
  const { inspectUniversalBankEvent } = req('universal-parser');
  const policy = req('best-effort-autopost');
  const { currencyMinorUnits } = req('currency-metadata');
  const { inspectSourceFreeRefusedAlert } = req('auto-import');

  // Mirrors evaluate.cjs `configure` exactly (it is not exported).
  const configure = (row) => {
    setActiveCountry(row.country);
    const exponent = currencyMinorUnits(row.ledger);
    setLedgerCurrency(row.ledger, exponent === 0 || exponent === 3 ? exponent : 2);
    setActiveMarket(row.country === 'AE' || row.country === 'SA' ? row.country : 'ZZ');
    policy.setBestEffortAutoPostEnabled(true);
    return createLaunchAlertSession({
      overrides: {}, pinnedCurrency: row.ledger, fxLookup: () => null,
      bestEffort: { enabled: true, country: row.country }, regionHint: row.country,
    });
  };

  // Warm-up: the first parse on each path builds lazily compiled pattern
  // tables. Doing it here keeps that one-time cost out of per-input timings.
  for (const p of ['android-sms', 'ios-history']) {
    try { ev.runCapturePath({ id: 'warmup', country: 'US', ledger: 'USD', sender: '', body: 'You made a $1.00 purchase at SHOP.' }, p); } catch { /* timing only */ }
  }
  return {
    repo,
    run(row, pathName) {
      const capture = ev.runCapturePath(row, pathName);
      const accepted = capture.accepted[0] ?? null;
      const reviewed = pathName === 'ios-history' ? (capture.review?.length ?? 0) > 0 : null;
      return { accepted, reviewed, acceptedCount: capture.accepted.length };
    },
    // The app's own refusal policy for an Android inbox alert no parser
    // booked (src/lib/auto-import.ts): launch awaiting-rate and held-credit
    // paths, the worldwide inspection, the launch-review and generic fallbacks.
    androidReview(row) {
      const session = configure(row);
      const decision = inspectSourceFreeRefusedAlert({
        source: row.body, sender: row.sender ?? '', observedAt: ev.OBSERVED_AT, channel: 'inbox', session,
      });
      return decision.kind === 'review';
    },
    launchRoute: (sender) => detectLaunchMarketFromSender(sender),
    diagnose(row, pathName) {
      const sender = pathName === 'ios-history' ? '' : row.sender ?? '';
      configure(row);
      const event = inspectUniversalBankEvent(row.body, { sender, dateOrder: undefined });
      const decision = policy.decideBestEffortAutoPost({
        source: row.body, sender, event, enabled: true, country: row.country,
        routedMarket: null, launchSenderMarket: null, ledgerCurrency: row.ledger,
        ledgerExponent: currencyMinorUnits(row.ledger), observedAt: ev.OBSERVED_AT, fxLookup: () => null,
      });
      const guards = [];
      if (policy.hasNonCompletedWording(row.body, null, sender)) guards.push('non-completed-wording');
      if (policy.isNotAutoPostableMoney(row.body)) guards.push('not-auto-postable-money');
      if (policy.hasLinkFromUnregisteredSender(row.body, sender)) guards.push('link-unregistered-sender');
      return {
        launchRoute: detectLaunchMarketFromSender(sender),
        status: event.status, family: event.family, direction: event.direction, decision: event.decision,
        amount: event.amount.value ? `${event.amount.value.currency} ${event.amount.value.minorUnits}/${event.amount.value.exponent}` : event.amount.evidence,
        policy: decision.outcome === 'post' ? 'post' : decision.reason, guards, issues: event.issues,
      };
    },
  };
}

const summarize = (p) => p && ({
  kind: p.kind, type: p.type, amount: p.amountFils, currency: p.currency, merchant: p.merchant ?? null,
  original: p.originalCurrency ? `${p.originalCurrency} ${p.originalAmountMinor} @${p.fxRate} ${p.fxSource}` : undefined,
  date: p.date ?? null, last4: p.card?.last4 ?? null, transfer: !!p.transferHint, marker: p.bestEffort?.format ?? (p.market ? `launch:${p.market}` : null),
});

const firstToken = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .split(/[^\p{L}\p{N}&]+/u).find((t) => t.length >= 2) ?? '';

/**
 * A foreign-currency purchase may be booked in the ledger currency when the
 * record keeps the exact original money and states its conversion (the Gulf
 * launch grammar's labelled fallback rate). That is a conversion, not a wrong
 * amount — provided the original is the labelled money and the ledger figure
 * is the original times the stated rate.
 */
function convertedToLedger(label, accepted, ledger) {
  if (!ledger || label.currency === ledger || accepted.currency !== ledger) return false;
  if (accepted.originalCurrency !== label.currency || accepted.originalAmountMinor !== label.amountMinor) return false;
  if (!accepted.fxSource || !(accepted.fxRate > 0)) return false;
  const ledgerExp = { KWD: 3, BHD: 3, OMR: 3, JOD: 3, IQD: 0, JPY: 0 }[ledger] ?? 2;
  const expected = (label.amountMinor / 10 ** label.exponent) * accepted.fxRate * 10 ** ledgerExp;
  return Math.abs(accepted.amountFils - expected) <= Math.max(1, expected * 0.001);
}

function gradePositive(label, accepted, reviewed, ledger = null) {
  if (!accepted) return { verdict: reviewed ? 'review' : 'miss' };
  const why = [];
  const fx = convertedToLedger(label, accepted, ledger);
  if (accepted.kind !== 'transaction') why.push(`kind ${accepted.kind}`);
  if (!fx && accepted.currency !== label.currency) why.push(`currency ${accepted.currency}≠${label.currency}`);
  if (!fx && accepted.amountFils !== label.amountMinor) why.push(`amount ${accepted.amountFils}≠${label.amountMinor}`);
  if (accepted.type !== label.direction) why.push(`direction ${accepted.type}≠${label.direction}`);
  if (why.length) return { verdict: 'wrong', detail: why.join(', ') };
  const soft = fx ? ['fx-converted'] : [];
  if (label.merchant && !String(accepted.merchant ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').includes(firstToken(label.merchant))) soft.push('merchant');
  if (label.last4 && accepted.card?.last4 && accepted.card.last4 !== label.last4) soft.push('last4');
  if (label.date && accepted.date && accepted.date !== label.date) soft.push('date');
  return { verdict: 'ok', soft };
}

function gradeNegative(label, accepted) {
  if (!accepted) return { verdict: 'held' };
  // Tolerated outcomes (generate.cjs NEG_ALLOWED): a typed reminder for the
  // stated sum, a credit-card payment, a transfer-flagged own-account move, or
  // the one direction that is correct for a P2P receipt/confirmation. The
  // money must still be the alert's own (or its stated FX original).
  const sameMoney = (a) => (accepted.currency === label.currency && a.amounts.includes(accepted.amountFils)) ||
    (accepted.originalCurrency === label.currency && a.amounts.includes(accepted.originalAmountMinor));
  for (const a of label.allowed ?? []) {
    if (accepted.kind !== a.kind) continue;
    if (a.type && accepted.type !== a.type) continue;
    if (a.transfer !== undefined && !!accepted.transferHint !== a.transfer) continue;
    if (sameMoney(a)) return { verdict: 'obligation' };
  }
  const detail = `${accepted.kind} ${accepted.type ?? ''} ${accepted.amountFils} ${accepted.currency}${accepted.transferHint ? ' transfer' : ''}`.replace(/  +/g, ' ').trim();
  if (accepted.kind === 'transaction' && (label.wrongTypes ?? []).includes(accepted.type)) return { verdict: 'wrong', detail: `direction ${accepted.type} on ${label.negType}: ${detail}` };
  // A typed reminder (not a ledger booking) read from a non-obligation
  // negative is reported separately; it is a wrong reminder, not wrong money.
  if (accepted.kind === 'billDue' || accepted.kind === 'cardStatement') return { verdict: 'reminder', detail };
  return { verdict: 'false-post', detail };
}

const sig = (r) => (r.accepted ? `${r.accepted.kind}|${r.accepted.type}|${r.accepted.amountFils}|${r.accepted.currency}` : 'none');

/** Identity of one (path, sender, body) case: its content, not its row id. */
const caseKey = (row, pathName) => `${pathName}|${shortHash(`${row.sender}\n${row.body}`)}`;

function emptyReport() {
  return { tally: {}, negTally: {}, invTally: {}, clusters: {}, unsafe: [], invViolations: [], failures: [], leaks: {}, rows: 0, cases: 0,
    timing: { slowest: [], over50: 0, totalMs: 0 } };
}

const SLOW_MS = 50;
/** Keep the five slowest (row, path) parses and count every one over 50 ms. */
function noteTiming(report, row, p, ms) {
  const t = report.timing;
  t.totalMs += ms;
  if (ms > SLOW_MS) t.over50 += 1;
  if (t.slowest.length < 5 || ms > t.slowest[t.slowest.length - 1].ms) {
    t.slowest.push({ ms: Math.round(ms * 10) / 10, id: row.id, path: p, bytes: Buffer.byteLength(row.body), body: row.body.slice(0, 120) });
    t.slowest.sort((a, b) => b.ms - a.ms);
    t.slowest.length = Math.min(5, t.slowest.length);
  }
}

/**
 * Time the adversarial long bodies on both paths (no grading), in a child
 * process with a per-case budget: a case that runs past `budgetMs` is killed
 * and reported as a timeout, then the child restarts at the next case.
 */
async function timeAdversarial(repo, paths = PATHS, budgetMs = 5000) {
  const { spawn } = require('child_process');
  const { adversarialRows } = require('./lib/adversarial.cjs');
  const total = adversarialRows().length * paths.length;
  const results = [];
  let next = 0;
  while (next < total) {
    next = await new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(__dirname, 'lib', 'timing-child.cjs'), repo, String(next), paths.join(',')], { stdio: ['ignore', 'pipe', 'inherit'] });
      let current = null;
      let timer = null;
      let buf = '';
      let done = next;
      const arm = () => { clearTimeout(timer); timer = setTimeout(() => child.kill('SIGKILL'), budgetMs); };
      child.stdout.on('data', (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const msg = JSON.parse(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
          if (msg.start !== undefined) { current = msg.start; arm(); } else if (msg.i !== undefined) { results.push(msg); done = msg.i + 1; current = null; clearTimeout(timer); }
        }
      });
      child.on('exit', () => {
        clearTimeout(timer);
        if (current !== null) {
          const cases = adversarialRows().flatMap((row) => paths.map((p) => ({ row, p })));
          const { row, p } = cases[current];
          results.push({ i: current, id: row.id, path: p, bytes: Buffer.byteLength(row.body), ms: budgetMs, timeout: true });
          done = current + 1;
        }
        resolve(done > next ? done : total);
      });
    });
  }
  return results;
}

const cell = (o, ...keys) => {
  let at = o;
  for (const k of keys.slice(0, -1)) at = at[k] ??= {};
  return at[keys[keys.length - 1]] ??= { pos: 0, ok: 0, review: 0, miss: 0, wrong: 0, soft: 0, neg: 0, held: 0, obligation: 0, reminder: 0, fp: 0, inv: 0, invViol: 0, invWrong: 0, negWrong: 0, error: 0 };
};

const clip = (s, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s);

function addCluster(report, key, row, extra, failureCap) {
  const c = report.clusters[key] ??= { count: 0, example: null, templates: {} };
  c.count += 1;
  const tpl = row.slots?.neg ?? row.slots?.tpl ?? (row.slots?.fields ? row.slots.fields[0] : null);
  if (tpl) c.templates[tpl] = (c.templates[tpl] ?? 0) + 1;
  if (!c.example) c.example = { id: row.id, market: row.market, sender: row.sender, body: row.body, ...extra };
  if (failureCap && (c.logged ?? 0) < failureCap) {
    c.logged = (c.logged ?? 0) + 1;
    report.failures.push({ cluster: key, id: row.id, market: row.market, sender: row.sender, body: row.body, label: row.label, ...extra });
  }
}

/**
 * Grade rows. Options: paths (subset), androidReview (compute Android Review
 * for unbooked positives; costs one more inspection each), failureCap (rows
 * per cluster kept for --failures).
 */
function evaluateRows(driver, rows, { paths = PATHS, androidReview = true, failureCap = 0 } = {}) {
  const report = emptyReport();
  const baseResults = new Map();
  report.rows = rows.length;
  for (const row of rows) {
    if (row.leaks) for (const l of row.leaks) report.leaks[l] = (report.leaks[l] ?? 0) + 1;
    for (const p of paths) {
      if (row.paths && !row.paths.includes(p)) continue;
      const t = cell(report.tally, row.market, p, row.family);
      let res;
      const t0 = process.hrtime.bigint();
      try {
        res = driver.run(row, p);
        noteTiming(report, row, p, Number(process.hrtime.bigint() - t0) / 1e6);
      } catch (e) {
        // A throw is never a pass: e.g. iPhone History refuses to return two
        // records for one message, which would be a double booking.
        t.error += 1;
        report.unsafe.push({ key: caseKey(row, p), verdict: 'ERROR', path: p, id: row.id, market: row.market, lang: row.lang, family: row.family,
          negType: row.negType, invType: row.invType, detail: String(e && e.message || e).slice(0, 200), sender: row.sender, body: row.body });
        addCluster(report, `error|${p}|${String(e && e.message || e).slice(0, 80)}`, row, { path: p }, failureCap);
        continue;
      }
      report.cases += 1;
      if (row.kind === 'positive' || row.kind === 'invariant') {
        if (res.reviewed === null && !res.accepted && androidReview) res.reviewed = driver.androidReview(row);
        const g = gradePositive(row.label, res.accepted, res.reviewed, row.ledger);
        if (row.kind === 'positive') {
          baseResults.set(`${row.id}|${p}`, res);
          t.pos += 1;
          t[g.verdict === 'ok' ? 'ok' : g.verdict] += 1;
          if (g.soft?.length) t.soft += 1;
          if (g.verdict !== 'ok') {
            addCluster(report, `${g.verdict}|${p}|${row.lang}|${row.family}|${row.layout}`, row, { path: p, detail: g.detail, parsed: summarize(res.accepted) }, failureCap);
          }
        } else {
          t.inv += 1;
          const it = cell(report.invTally, p, row.invType);
          it.inv += 1;
          const base = baseResults.get(`${row.baseId}|${p}`);
          if (base && sig(base) !== sig(res)) {
            const change = base.accepted && res.accepted ? 'changed' : base.accepted ? 'lost' : 'gained';
            t.invViol += 1; it.invViol += 1; it[change] = (it[change] ?? 0) + 1;
            const ex = { id: row.id, path: p, market: row.market, invType: row.invType, change, before: summarize(base.accepted), after: summarize(res.accepted), sender: row.sender, body: clip(row.body, 300) };
            if (report.invViolations.length < 400) report.invViolations.push(ex);
            addCluster(report, `invariance-${change}|${p}|${row.invType}|${row.lang}`, row, { path: p, before: ex.before, after: ex.after }, failureCap);
          }
        }
        // A variant that repeats its base's wrong booking is the same defect;
        // only a variant whose booking differs from its base is new.
        const repeatsBase = row.kind === 'invariant' && sig(baseResults.get(`${row.baseId}|${p}`) ?? {}) === sig(res);
        if (g.verdict === 'wrong' && !repeatsBase) {
          if (row.kind === 'invariant') t.invWrong += 1;
          report.unsafe.push({ key: caseKey(row, p), verdict: 'WRONG', path: p, id: row.id, market: row.market, lang: row.lang, family: row.family, layout: row.layout, invType: row.invType,
            detail: g.detail, label: { amountMinor: row.label.amountMinor, currency: row.label.currency, direction: row.label.direction }, parsed: summarize(res.accepted), sender: row.sender, body: row.body });
        }
      } else {
        const g = gradeNegative(row.label, res.accepted);
        t.neg += 1;
        if (g.verdict !== 'wrong') t[g.verdict === 'false-post' ? 'fp' : g.verdict] += 1;
        if (g.verdict === 'reminder') addCluster(report, `reminder|${p}|${row.negType}|${row.lang}`, row, { path: p, parsed: summarize(res.accepted) }, failureCap);
        const nt = cell(report.negTally, p, row.negType);
        nt.neg += 1;
        if (g.verdict === 'false-post') nt.fp += 1;
        if (g.verdict === 'wrong') { nt.wrong += 1; t.negWrong += 1; }
        if (g.verdict === 'wrong') {
          report.unsafe.push({ key: caseKey(row, p), verdict: 'WRONG', path: p, id: row.id, market: row.market, lang: row.lang, family: row.family, negType: row.negType,
            detail: g.detail, parsed: summarize(res.accepted), sender: row.sender, body: row.body });
          addCluster(report, `wrong|${p}|${row.negType}|${row.lang}`, row, { path: p, parsed: summarize(res.accepted) }, failureCap);
        }
        if (g.verdict === 'obligation') nt.obligation += 1;
        if (g.verdict === 'false-post') {
          report.unsafe.push({ key: caseKey(row, p), verdict: 'FALSE-POST', path: p, id: row.id, market: row.market, lang: row.lang, family: row.family, negType: row.negType,
            detail: g.detail, parsed: summarize(res.accepted), sender: row.sender, body: row.body });
          addCluster(report, `false-post|${p}|${row.negType}|${row.lang}`, row, { path: p, parsed: summarize(res.accepted) }, failureCap);
        }
      }
    }
  }
  return report;
}

function mergeReports(a, b) {
  const out = a;
  const addCell = (x, y) => { for (const k of Object.keys(y)) x[k] = (x[k] ?? 0) + y[k]; };
  const deep = (x, y, depth) => {
    for (const k of Object.keys(y)) {
      if (depth === 0) { x[k] ??= {}; addCell(x[k], y[k]); } else { x[k] ??= {}; deep(x[k], y[k], depth - 1); }
    }
  };
  deep(out.tally, b.tally, 2);
  deep(out.negTally, b.negTally, 1);
  deep(out.invTally, b.invTally, 1);
  for (const [k, c] of Object.entries(b.clusters)) {
    const mine = out.clusters[k];
    if (!mine) { out.clusters[k] = c; continue; }
    mine.count += c.count;
    for (const [t, n] of Object.entries(c.templates)) mine.templates[t] = (mine.templates[t] ?? 0) + n;
  }
  out.unsafe.push(...b.unsafe);
  out.invViolations.push(...b.invViolations.slice(0, Math.max(0, 400 - out.invViolations.length)));
  out.failures.push(...b.failures);
  for (const [k, n] of Object.entries(b.leaks)) out.leaks[k] = (out.leaks[k] ?? 0) + n;
  out.rows += b.rows; out.cases += b.cases;
  out.timing.totalMs += b.timing.totalMs; out.timing.over50 += b.timing.over50;
  out.timing.slowest = [...out.timing.slowest, ...b.timing.slowest].sort((x, y) => y.ms - x.ms).slice(0, 5);
  return out;
}

module.exports = { createDriver, evaluateRows, mergeReports, emptyReport, timeAdversarial, gradePositive, gradeNegative, caseKey, summarize, PATHS };
