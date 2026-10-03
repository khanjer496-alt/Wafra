#!/usr/bin/env node
'use strict';
/**
 * Scores Ask Wafra question understanding on the held-out template split.
 *
 *   node scripts/parser-ai/ask/score-rules.cjs                      rules baseline on test
 *   node scripts/parser-ai/ask/score-rules.cjs --predictions p.jsonl rules + model + hybrid
 *   node scripts/parser-ai/ask/score-rules.cjs --oracle              gold spans as "model" (mapping sanity)
 *     [--data <dir>]           read <dir>/<split>.jsonl instead of regenerating
 *     [--split test|dev]       default test
 *     [--thresholds 0.5,0.8]   hybrid/model intent-probability thresholds
 *     [--write-oracle <file>]  write the oracle predictions as an example JSONL
 *     [--json <file>]          write all metrics as JSON
 *     [--errors <n>]           print n rule/hybrid errors per system
 *
 * Prediction line: { id, intent, intentP, spans: [{ label, start, end, text?, p? }] }.
 * The model never supplies a value: its intent and span offsets go through
 * src/lib/ai-ask-understanding.ts, which normalises the user's own words to
 * known category ids, period keys, 1..10 counts, ledger merchants and accounts.
 *
 * Rules = the shipping deterministic planner (planAssistantQuestion), loaded
 * from source via scripts/universal-test/load-ts.cjs.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createLoader } = require('../../universal-test/load-ts.cjs');
const questions = require('./questions.cjs');

const load = createLoader();
const assistant = load('@/lib/wafra-assistant');
const ask = load('@/lib/ai-ask-understanding');
const period = load('@/lib/period');

const NOW = questions.NOW;
const DEFAULT_PERIOD = period.currentMonthPeriod(NOW);

const TOOL_INTENT = {
  'spending-total': 'spending_total', 'merchant-breakdown': 'spending_total', 'category-breakdown': 'spending_total',
  'income-total': 'income_total', 'compare-periods': 'compare_periods', 'top-merchants': 'top_merchants',
  'top-categories': 'top_categories', 'largest-purchases': 'largest_purchases', 'daily-average': 'daily_average',
  'net-income-spending': 'net_income_spending', subscriptions: 'subscriptions', 'upcoming-payments': 'upcoming_payments',
  'unusual-charges': 'unusual_charges', 'possible-duplicates': 'possible_duplicates', 'recurring-changes': 'recurring_changes',
  'month-forecast': 'month_forecast', 'top-accounts': 'top_accounts', 'account-inventory': 'account_inventory',
  help: 'unknown',
};
const NO_PERIOD_INTENTS = new Set(['subscriptions', 'upcoming_payments', 'account_inventory', 'unknown']);

function parseArgs(argv) {
  const args = { split: 'test', thresholds: [0.5, 0.6, 0.7, 0.8, 0.9, 0.95], errors: 0 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = () => argv[++i];
    if (flag === '--data') args.data = next();
    else if (flag === '--split') args.split = next();
    else if (flag === '--predictions') args.predictions = next();
    else if (flag === '--oracle') args.oracle = true;
    else if (flag === '--write-oracle') args.writeOracle = next();
    else if (flag === '--json') args.json = next();
    else if (flag === '--errors') args.errors = Number(next());
    else if (flag === '--thresholds') args.thresholds = next().split(',').map(Number);
    else throw new Error(`unknown flag ${flag}`);
  }
  return args;
}

const readJsonl = (file) => fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));

/** A ledger that contains every generated merchant and account, so the rules can resolve them. */
function buildState() {
  const accounts = questions.ACCOUNTS.map((account) => ({ id: account.id, name: account.name, kind: account.kind, openingFils: 0, color: '#000000' }));
  const merchants = [...new Set(Object.values(questions.MERCHANTS).flat())];
  const transactions = [];
  merchants.forEach((title, index) => {
    for (const date of ['2026-07-04', '2026-08-06', '2026-09-08']) {
      transactions.push({ id: `tx-${index}-${date}`, date, title, amountFils: 1_000 + index * 10, category: 'shopping', type: 'expense',
        accountId: accounts[index % accounts.length].id, source: 'sms' });
    }
  });
  transactions.push({ id: 'salary-sep', date: '2026-09-01', title: 'Salary', amountFils: 500_000, category: 'salary', type: 'income', accountId: accounts[0].id, source: 'sms' });
  return { state: { accounts, transactions, bills: [], cardDues: [], notSubscriptions: [] }, merchants, accounts };
}

function resolveKey(key) {
  if (!key) return null;
  const resolved = ask.resolveAskPeriod(key, NOW);
  if (!resolved) throw new Error(`gold period key ${key} does not resolve`);
  return resolved;
}

/** Canonical slot view of a request, comparable with the gold view. */
function requestSlots(request, accountNames) {
  const categories = [request.category, ...(request.categories ?? [])].filter(Boolean).sort();
  const merchants = [request.merchant, ...(request.merchants ?? [])].filter(Boolean).map((name) => name.toLowerCase()).sort();
  const accounts = (request.accountIds ?? []).map((id) => accountNames.get(id) ?? id).sort();
  const intent = TOOL_INTENT[request.tool] ?? `other:${request.tool}`;
  let limit = request.limit ?? null;
  if (request.tool === 'largest-purchases' && limit === 5) limit = null;
  return JSON.stringify({
    categories, merchants, accounts,
    period: NO_PERIOD_INTENTS.has(intent) || !request.period ? null : request.period,
    comparison: request.comparisonPeriod ?? null,
    topN: limit,
  });
}

function goldSlots(row) {
  const slots = row.slots;
  let topN = slots.topN ?? null;
  if (row.intent === 'largest_purchases' && topN === 5) topN = null;
  return JSON.stringify({
    categories: slots.category ? [slots.category] : [],
    merchants: slots.merchant ? [slots.merchant.toLowerCase()] : [],
    accounts: slots.account ? [slots.account] : [],
    period: NO_PERIOD_INTENTS.has(row.intent) ? null : (resolveKey(slots.period) ?? DEFAULT_PERIOD),
    comparison: resolveKey(slots.comparison),
    topN,
  });
}

function outcome(row, request, accountNames) {
  const predicted = request ? TOOL_INTENT[request.tool] ?? `other:${request.tool}` : 'unknown';
  const answered = predicted !== 'unknown';
  const intentOk = predicted === row.intent;
  const slotsOk = intentOk && (row.intent === 'unknown' || requestSlots(request, accountNames) === goldSlots(row));
  return { predicted, answered, intentOk, slotsOk };
}

function emptyBucket() {
  return { n: 0, inScope: 0, oos: 0, intentOk: 0, exact: 0, answeredInScope: 0, wrongTool: 0, wrongAnswer: 0, oosRefused: 0 };
}
function add(bucket, row, result) {
  bucket.n++;
  if (result.intentOk) bucket.intentOk++;
  if (row.intent === 'unknown') {
    bucket.oos++;
    if (!result.answered) bucket.oosRefused++;
  } else {
    bucket.inScope++;
    if (result.answered) bucket.answeredInScope++;
    if (result.slotsOk) bucket.exact++;
  }
  if (result.answered && !result.intentOk) bucket.wrongTool++;
  if (result.answered && !(result.intentOk && result.slotsOk)) bucket.wrongAnswer++;
}
function summarize(bucket) {
  const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
  return {
    n: bucket.n,
    intentAcc: pct(bucket.intentOk, bucket.n),
    slotExact: pct(bucket.exact, bucket.inScope),
    coverage: pct(bucket.answeredInScope, bucket.inScope),
    wrongTool: pct(bucket.wrongTool, bucket.n),
    wrongAnswer: pct(bucket.wrongAnswer, bucket.n),
    oosRefusal: pct(bucket.oosRefused, bucket.oos),
  };
}

function scoreSystem(rows, decide, accountNames, errorLimit, label) {
  const overall = emptyBucket();
  const byLanguage = {};
  const byIntent = {};
  const errors = [];
  for (const row of rows) {
    const request = decide(row);
    const result = outcome(row, request, accountNames);
    add(overall, row, result);
    add(byLanguage[row.language] ??= emptyBucket(), row, result);
    add(byIntent[row.intent] ??= emptyBucket(), row, result);
    if (errorLimit && result.answered && !(result.intentOk && result.slotsOk) && errors.length < errorLimit) {
      errors.push(`${row.id} [${row.intent} -> ${result.predicted}] ${row.question} :: ${JSON.stringify(request)}`);
    }
  }
  if (errors.length) console.error(`\n-- ${label}: first wrong answers --\n${errors.join('\n')}`);
  const map = (o) => Object.fromEntries(Object.entries(o).map(([key, bucket]) => [key, summarize(bucket)]));
  return { overall: summarize(overall), byLanguage: map(byLanguage), byIntent: map(byIntent) };
}

function oraclePredictions(rows) {
  return rows.map((row) => ({ id: row.id, intent: row.intent, intentP: 1, spans: row.spans.map((span) => ({ ...span, p: 1 })) }));
}

function printTable(title, metrics) {
  console.log(`\n== ${title} ==`);
  const rows = [['overall', metrics.overall], ...Object.entries(metrics.byLanguage)];
  console.log('lang      n     intent%  slotEM%  cover%  wrongTool%  wrongAns%  oosRefuse%');
  for (const [name, m] of rows) {
    const f = (v) => String(v ?? '-').padStart(7);
    console.log(`${name.padEnd(8)} ${String(m.n).padStart(5)} ${f(m.intentAcc)}  ${f(m.slotExact)} ${f(m.coverage)}  ${f(m.wrongTool)}    ${f(m.wrongAnswer)}   ${f(m.oosRefusal)}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = args.data ? readJsonl(path.join(args.data, `${args.split}.jsonl`))
    : questions.generate().filter((row) => row.split === args.split);
  const { state, merchants, accounts } = buildState();
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const context = (threshold) => ({ now: NOW, defaultPeriod: DEFAULT_PERIOD, knownMerchants: merchants,
    knownAccounts: accounts.map(({ id, name }) => ({ id, name })), intentThreshold: threshold });

  const ruleCache = new Map();
  const rules = (row) => {
    if (!ruleCache.has(row.id)) ruleCache.set(row.id, assistant.planAssistantQuestion(state, row.question, NOW, null, DEFAULT_PERIOD));
    return ruleCache.get(row.id);
  };
  const results = { split: args.split, rows: rows.length, now: NOW.toISOString(), systems: {} };
  results.systems.rules = scoreSystem(rows, (row) => { const r = rules(row); return r.tool === 'help' ? null : r; }, accountNames, args.errors, 'rules');
  const notUnderstood = rows.filter((row) => ask.rulesDidNotUnderstand(rules(row))).length;
  results.rulesNotUnderstoodRate = Math.round((1000 * notUnderstood) / rows.length) / 10;
  printTable(`rules (planAssistantQuestion), ${args.split} split, ${rows.length} rows`, results.systems.rules);
  // Where the rules land: answered, "did not understand" (the only state the
  // model may act on) or a safety clarification (never overridden).
  const disposition = {};
  for (const row of rows) {
    const request = rules(row);
    const kind = request.tool !== 'help' ? 'answered' : ask.rulesDidNotUnderstand(request) ? 'notUnderstood' : 'clarified';
    const bucket = disposition[row.language] ??= { n: 0, answered: 0, notUnderstood: 0, clarified: 0 };
    bucket.n++; bucket[kind]++;
  }
  results.rulesDisposition = disposition;
  console.log('\nrules disposition (% of rows): answered / did-not-understand (model may act) / safety clarification (blocks model)');
  for (const [language, b] of Object.entries(disposition)) {
    const pct = (v) => (Math.round((1000 * v) / b.n) / 10).toFixed(1).padStart(5);
    console.log(`${language.padEnd(8)} ${pct(b.answered)} ${pct(b.notUnderstood)} ${pct(b.clarified)}`);
  }

  let predictions = null;
  if (args.oracle) predictions = oraclePredictions(rows);
  if (args.writeOracle) {
    fs.writeFileSync(args.writeOracle, oraclePredictions(rows).map((p) => JSON.stringify(p)).join('\n') + '\n');
    console.log(`\nwrote oracle predictions to ${args.writeOracle}`);
  }
  if (args.predictions) predictions = readJsonl(args.predictions);
  if (predictions) {
    const byId = new Map(predictions.map((p) => [p.id, p]));
    const missing = rows.filter((row) => !byId.has(row.id)).length;
    if (missing) console.log(`\n${missing} rows have no prediction (treated as refusal)`);
    const rawIntent = rows.filter((row) => byId.get(row.id)?.intent === row.intent).length;
    results.modelRawIntentAcc = Math.round((1000 * rawIntent) / rows.length) / 10;
    console.log(`\nmodel raw intent-head accuracy (argmax, no threshold): ${results.modelRawIntentAcc}%`);
    for (const threshold of args.thresholds) {
      const ctx = context(threshold);
      const model = scoreSystem(rows, (row) => ask.mapAskModelOutput(byId.get(row.id), row.question, ctx), accountNames, args.errors, `model@${threshold}`);
      const hybrid = scoreSystem(rows, (row) => {
        const decision = ask.understandAskQuestion(row.question, rules(row), byId.get(row.id) ?? null, ctx);
        return decision.request.tool === 'help' ? null : decision.request;
      }, accountNames, args.errors, `hybrid@${threshold}`);
      results.systems[`model@${threshold}`] = model;
      results.systems[`hybrid@${threshold}`] = hybrid;
      printTable(`model only, intentP >= ${threshold}`, model);
      printTable(`hybrid (rules first, model when rules did not understand), intentP >= ${threshold}`, hybrid);
    }
  }
  if (args.json) fs.writeFileSync(args.json, JSON.stringify(results, null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { requestSlots, goldSlots, buildState };
