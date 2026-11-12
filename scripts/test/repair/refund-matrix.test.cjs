'use strict';
// Generated refund matrix (CEO 58078e1d item 2; oracle v2 accepted by the CEO 711485d5 and Change Reviewer 810c20ec,
// 583dcfd7). Every oracle row runs through parseSms, the launch session and the native bundle. The bar:
//   - zero false income: no income where the oracle is not INCOME_*;
//   - zero lost genuine refunds: an INCOME_* row posts income of exactly its figure on parseSms and the session;
//   - native never books a debit on an INCOME_* row, never a credit on any other row, and never posts a REVIEW or
//     NO_POST row. Native 'ignore' on an INCOME_* row is allowed (it posts only when its event reader agrees) but is
//     counted and reported, so a lost refund on native stays visible.
// REVIEW and NO_POST both mean "never auto-posts" here. Set REFUND_MATRIX_REPORT=<file> to write every mismatch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const markets = load('@/lib/markets');
const country = load('@/lib/country');
const { parseSms } = load('@/lib/sms-parser');
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { buildOracleRows } = require('./refund-matrix-oracle.cjs');

const at = Date.parse('2026-11-05T10:00:00Z');
const root = path.resolve(__dirname, '../../..');
const resources = path.join(root, 'modules/wafra-live-capture/ios/Resources');
const meta = JSON.parse(fs.readFileSync(path.join(resources, 'WafraBackgroundParser.meta.json')));
const sandbox = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(resources, 'WafraBackgroundParser.js'), 'utf8'), sandbox);
const native = (body) => JSON.parse(sandbox.wafraNativeAlertParse(JSON.stringify({ v: 1, body, sender: 'ENBD', observedAt: at,
  context: { v: 1, country: 'AE', parserMarket: 'AE', ledgerMoney: { currency: 'AED', exponent: 2 }, sourceHash: meta.sourceHash } })));

country.setActiveCountry('AE');
markets.setActiveMarket('AE');
markets.setLedgerCurrency('AED', 2);
const session = createLaunchAlertSession({ overrides: {}, activeMarket: 'AE', pinnedCurrency: 'AED',
  bestEffort: { enabled: true, country: 'AE' } });

const shape = (p) => (p ? `${p.kind === 'transaction' ? p.type : p.kind} ${p.amountFils}` : 'none');
const nativeShape = (n) => (n.route === 'parsed' ? `${n.notification.direction} ${n.notification.amount?.minorUnits}` : n.route);
function judge(row) {
  const p = parseSms(row.body, {}, { sender: 'ENBD', observedAt: at });
  const s = session.parse(row.body, 'ENBD', session.inspect(row.body, 'ENBD'), undefined, at);
  const n = native(row.body);
  const problems = [];
  let nativeIgnoredIncome = false;
  const income = row.expected === 'INCOME_REFUND' || row.expected === 'INCOME_DEBIT';
  if (income) {
    for (const [name, got] of [['parseSms', p], ['session', s]]) {
      if (!(got?.kind === 'transaction' && got.type === 'income' && got.amountFils === 25000)) problems.push(`${name} ${shape(got)}`);
    }
    if (n.route === 'parsed' && !(n.notification.direction === 'credit' && n.notification.amount?.minorUnits === '25000')) {
      problems.push(`native ${nativeShape(n)}`);
    }
    if (n.route !== 'parsed') nativeIgnoredIncome = true;
  } else if (row.expected === 'EXPENSE') {
    for (const [name, got] of [['parseSms', p], ['session', s]]) {
      if (!(got?.kind === 'transaction' && got.type === 'expense' && got.amountFils === 25000)) problems.push(`${name} ${shape(got)}`);
    }
    if (n.route === 'parsed' && n.notification.direction === 'credit') problems.push(`native ${nativeShape(n)}`);
  } else {
    for (const [name, got] of [['parseSms', p], ['session', s]]) if (got) problems.push(`${name} ${shape(got)}`);
    if (n.route === 'parsed') problems.push(`native ${nativeShape(n)}`);
  }
  return { problems, nativeIgnoredIncome, got: { parseSms: shape(p), session: shape(s), native: nativeShape(n) } };
}

const rows = buildOracleRows();
const groups = new Map();
for (const row of rows) {
  const key = `${row.lang} ${row.rule.split(' ')[0]} ${row.expected}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}
const report = { total: rows.length, mismatches: [], nativeIgnoredIncome: 0, incomeRows: 0 };
for (const [key, list] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
  test(`refund matrix ${key} (${list.length} cases)`, (t) => {
    const failures = [];
    let ignored = 0;
    for (const row of list) {
      const verdict = judge(row);
      if (verdict.nativeIgnoredIncome) ignored++;
      if (verdict.problems.length) {
        failures.push(`${row.id} ${verdict.problems.join('; ')} | ${row.body}`);
        report.mismatches.push({ id: row.id, rule: row.rule, expected: row.expected, case: row.case, body: row.body, ...verdict.got });
      }
    }
    if (row0Income(list)) {
      report.incomeRows += list.length;
      report.nativeIgnoredIncome += ignored;
      t.diagnostic(`native ignored ${ignored} of ${list.length} income rows`);
    }
    assert.equal(failures.length, 0, `${failures.length} of ${list.length} mismatch the oracle:\n${failures.slice(0, 8).join('\n')}`);
  });
}
function row0Income(list) { return list[0].expected === 'INCOME_REFUND' || list[0].expected === 'INCOME_DEBIT'; }
test('refund matrix report', () => {
  if (process.env.REFUND_MATRIX_REPORT) fs.writeFileSync(process.env.REFUND_MATRIX_REPORT, JSON.stringify(report, null, 1));
  assert.ok(report.total >= 500, 'at least 500 generated cases');
});
