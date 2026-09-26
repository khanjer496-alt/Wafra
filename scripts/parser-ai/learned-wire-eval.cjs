'use strict';
/**
 * End-to-end measurement of learned bank formats THROUGH THE WIRED CAPTURE
 * PATH (learned-format-capture.ts), not the pure module: every message runs
 * the production session (parse / parseUnproven, as historical-import.ts
 * calls them) and, when nothing posts, the shared refusal pipeline
 * (auto-import.ts inspectSourceFreeRefusedAlert). A Review item carrying a
 * learning draft is "confirmed" with the message's TRUE label, exactly as the
 * store does on "Confirm and add" (learnedStoreAfterConfirmation).
 *
 * Per (template, sender) group, in order, it counts:
 *   rules      rows the rules/best-effort policy posted (learning never runs)
 *   prefill    later rows pre-filled as "Recognised format" (+ fields correct)
 *   post       later rows auto-added with the learned marker (+ correct)
 *   falseHits  learned prefill/post on a NON-posting row (otp, pending, …)
 * Metrics only; no message text is printed. Requires the compiled build:
 *   bash scripts/test/build.sh && node scripts/parser-ai/learned-wire-eval.cjs [--generator v1|v2] [--limit n]
 */
const path = require('node:path');

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const build = path.resolve(__dirname, '../test/build');
const req = (name) => require(path.join(build, name));
const { createLaunchAlertSession } = req('launch-alert-parser.js');
const { inspectSourceFreeRefusedAlert } = req('auto-import.js');
const C = req('learned-format-capture.js');
const L = req('learned-alert-formats.js');
const markets = req('markets.js');
const country = req('country.js');
const grammars = req('alert-institution-grammars.js');
const { currencyMinorUnits } = req('currency-metadata.js');
const { COUNTRY_CURRENCY } = require('./schema.cjs');

const generator = arg('--generator', 'v2');
const mod = require(path.join(__dirname, generator === 'v1' ? 'synth/generate.cjs' : 'synth/generate-v2.cjs'));
const rows = (mod.generate ?? mod.generateV2)({});
const limit = Number(arg('--limit', '0')) || Infinity;
const OBSERVED_AT = Date.parse('2026-09-25T12:00:00Z');
const fxStub = (base, quote, date) => ({ base, quote, rate: 1, date });

const isPosting = (row) => row.label.shouldPost && row.label.amount &&
  (row.label.direction === 'debit' || row.label.direction === 'credit');

const groups = new Map();
for (const row of rows) {
  const key = `${row.template}\u0001${row.sender}\u0001${row.country}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}

const out = { groups: 0, rows: 0, rules: 0, reviewItems: 0, drafts: 0, learned: 0, prefill: 0, prefillCorrect: 0,
  post: 0, postCorrect: 0, falseHits: 0, negativesAfterLearning: 0 };
let processed = 0;
for (const group of groups.values()) {
  if (processed >= limit) break;
  processed += 1;
  const code = group[0].country;
  const currency = COUNTRY_CURRENCY[code] ?? null;
  if (!currency) continue;
  out.groups += 1;
  markets.setLedgerCurrency(currency, currencyMinorUnits(currency) ?? 2);
  country.setActiveCountry(code === 'ZZ' ? null : code);
  markets.setActiveMarket(code === 'SA' ? 'SA' : 'AE');
  let store = L.emptyLearnedFormatStore();
  C.setLearnedFormatCaptureState({ store, autoPost: true, privateMode: false });
  for (const row of group) {
    out.rows += 1;
    const sender = row.sender ?? '';
    const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: currency, fxLookup: fxStub,
      bestEffort: { enabled: true, country: code === 'ZZ' ? null : code } });
    const inspection = session.inspect(row.body, sender);
    const foreignIssuer = !markets.detectLaunchMarketFromSender(sender) && grammars.hasUniversalInstitutionSender(sender);
    const foreignRoute = inspection?.route.decision === 'single' &&
      inspection.route.market !== 'AE' && inspection.route.market !== 'SA';
    const parsed = foreignIssuer || foreignRoute
      ? session.parseUnproven(row.body, sender, inspection, OBSERVED_AT)
      : session.parse(row.body, sender, inspection, undefined, OBSERVED_AT);
    const learnedNow = store.templates.some((t) => !t.blocked);
    if (learnedNow && !isPosting(row)) out.negativesAfterLearning += 1;
    if (parsed?.bestEffort?.format?.startsWith('learned:')) {
      out.post += 1;
      if (!isPosting(row)) { out.falseHits += 1; continue; }
      const direction = parsed.type === 'income' ? 'credit' : 'debit';
      const original = parsed.originalMinorUnits ?? parsed.amountFils;
      if (String(original) === String(row.label.amount.minor) && direction === row.label.direction) out.postCorrect += 1;
      continue;
    }
    if (parsed) { out.rules += 1; continue; }
    const decision = inspectSourceFreeRefusedAlert({ source: row.body, sender, observedAt: OBSERVED_AT, channel: 'inbox', session });
    if (decision.kind !== 'review') continue;
    out.reviewItems += 1;
    const { candidate } = decision;
    if (candidate.suggestedBy === 'learned') {
      out.prefill += 1;
      if (!isPosting(row)) { out.falseHits += 1; continue; }
      const value = candidate.event.amount.value;
      if (value && value.minorUnits === String(row.label.amount.minor) && value.currency === row.label.amount.currency &&
        candidate.event.direction === row.label.direction) out.prefillCorrect += 1;
    }
    if (!candidate.learn || !isPosting(row)) continue;
    out.drafts += 1;
    // "Confirm and add" with the true reading (the person's answer).
    const next = C.learnedStoreAfterConfirmation(store, candidate, {
      direction: row.label.direction,
      amount: { currency: row.label.amount.currency, minorUnits: String(row.label.amount.minor), exponent: row.label.amount.exponent },
      date: row.label.date ?? candidate.event.transactionDate.value ?? '',
    }, OBSERVED_AT);
    if (next) {
      out.learned += 1;
      store = next;
      C.setLearnedFormatCaptureState({ store, autoPost: true, privateMode: false });
    }
  }
}
markets.setLedgerCurrency(null);
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(2)}%` : 'n/a');
console.log(JSON.stringify({
  generator, ...out,
  prefillPrecision: pct(out.prefillCorrect, out.prefill),
  postPrecision: pct(out.postCorrect, out.post),
  falseHitRateOnNegatives: pct(out.falseHits, out.negativesAfterLearning),
}, null, 2));
