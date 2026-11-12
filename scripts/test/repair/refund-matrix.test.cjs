'use strict';
// Generated refund matrix (CEO 58078e1d item 2; oracle v2 accepted by the CEO 711485d5 and Change Reviewer 810c20ec,
// 583dcfd7), run as a RATCHET (CEO 080fa431). Every oracle row runs through parseSms, the launch session and the
// native bundle. The target:
//   - zero false income: no income where the oracle is not INCOME_*;
//   - zero lost genuine refunds: an INCOME_* row posts income of exactly its figure on parseSms and the session;
//   - native never books a debit on an INCOME_* row, never a credit on any other row, and never posts a REVIEW or
//     NO_POST row. Native 'ignore' on an INCOME_* row is allowed (it posts only when its event reader agrees) but is
//     counted against a ceiling, so a lost refund on native stays visible.
// REVIEW and NO_POST both mean "never auto-posts" here.
//
// Today's gaps are listed, per row and per path, in refund-matrix-known-gaps.json. This suite fails on:
//   - a NEW gap: a path that mismatches the oracle on a row the file does not list for that path;
//   - a CHANGED gap: a listed path whose wrong outcome is now a different wrong outcome;
//   - a STALE gap: a listed path that now matches the oracle (delete the entry: the file only shrinks);
//   - any class count in the file above CEILING below, and native ignored income above its ceiling.
// CEILING may only go DOWN. A change that raises any number in it, or adds an entry to the gap file, is a regression
// and must be rejected in review. The store gate needs CEILING.falseIncome at zero on every path.
//
// Set REFUND_MATRIX_REPORT=<file> to write every gap with counts, and REFUND_MATRIX_WRITE_GAPS=<file> to write the
// current gaps in the gap-file format after a fix (then lower CEILING to the new counts).
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

// Frozen ratchet. Each number is today's count of gap-file entries in that class on that path; it may only go down.
const CEILING = {
  falseIncome: { parseSms: 903, session: 911, native: 90 },
  wrongDirection: { parseSms: 42, session: 40, native: 0 },
  wrongAmount: { parseSms: 0, session: 0, native: 0 },
  lostIncome: { parseSms: 36, session: 36, native: 0 },
  droppedDebit: { parseSms: 207, session: 207, native: 0 },
  postedNotReview: { parseSms: 631, session: 652, native: 10 },
};
const NATIVE_IGNORED_INCOME_CEILING = 157;

const PATHS = ['parseSms', 'session', 'native'];
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
const isIncomeRow = (expected) => expected === 'INCOME_REFUND' || expected === 'INCOME_DEBIT';

// The class of a wrong outcome; null when the path agrees with the oracle.
function gapClass(expected, pathName, got) {
  const [kind, amount] = got.split(' ');
  const credit = kind === 'income' || kind === 'credit';
  const debit = kind === 'expense' || kind === 'debit';
  const posted = pathName === 'native' ? kind === 'credit' || kind === 'debit' : got !== 'none';
  if (isIncomeRow(expected)) {
    if (credit) return amount === '25000' ? null : 'wrongAmount';
    if (debit) return 'wrongDirection';
    return pathName === 'native' ? null : 'lostIncome'; // native 'ignore' is counted separately
  }
  if (credit) return 'falseIncome';
  if (expected === 'EXPENSE') {
    if (pathName === 'native') return null; // native may leave a debit to the app; it must never credit it
    if (debit) return amount === '25000' ? null : 'wrongAmount';
    return 'droppedDebit';
  }
  return posted ? 'postedNotReview' : null;
}

function judge(row) {
  const got = {
    parseSms: shape(parseSms(row.body, {}, { sender: 'ENBD', observedAt: at })),
    session: shape(session.parse(row.body, 'ENBD', session.inspect(row.body, 'ENBD'), undefined, at)),
    native: nativeShape(native(row.body)),
  };
  const gaps = {};
  for (const name of PATHS) if (gapClass(row.expected, name, got[name])) gaps[name] = got[name];
  const nativeIgnoredIncome = isIncomeRow(row.expected) && !/^(credit|debit) /.test(got.native);
  return { got, gaps, nativeIgnoredIncome };
}

const knownText = fs.readFileSync(path.join(__dirname, 'refund-matrix-known-gaps.json'), 'utf8');
const knownFile = JSON.parse(knownText);
const known = knownFile.gaps;
const rows = buildOracleRows();
const rowById = new Map(rows.map((row) => [row.id, row]));
const groups = new Map();
for (const row of rows) {
  const key = `${row.lang} ${row.rule.split(' ')[0]} ${row.expected}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}

const current = {};
const report = { total: rows.length, gaps: [], nativeIgnoredIncome: 0, incomeRows: 0, counts: {}, falseIncomeByLang: {} };
for (const [key, list] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
  test(`refund matrix ${key} (${list.length} cases)`, (t) => {
    const failures = [];
    let ignored = 0;
    for (const row of list) {
      const verdict = judge(row);
      if (verdict.nativeIgnoredIncome) ignored++;
      const listed = known[row.id] || {};
      if (listed.expected && listed.expected !== row.expected) failures.push(`${row.id} oracle now ${row.expected}, gap file says ${listed.expected}`);
      for (const name of PATHS) {
        const gotGap = verdict.gaps[name];
        const listedGap = listed[name];
        if (gotGap && !listedGap) failures.push(`${row.id} NEW ${name} ${gotGap} (${gapClass(row.expected, name, gotGap)}) | ${row.body}`);
        else if (gotGap && listedGap !== gotGap) failures.push(`${row.id} CHANGED ${name} ${listedGap} -> ${gotGap} | ${row.body}`);
        else if (!gotGap && listedGap) failures.push(`${row.id} STALE ${name} now ${verdict.got[name]}: delete it from the gap file`);
      }
      if (Object.keys(verdict.gaps).length) {
        current[row.id] = { expected: row.expected, ...verdict.gaps };
        report.gaps.push({ id: row.id, rule: row.rule, expected: row.expected, case: row.case, body: row.body, ...verdict.got });
        for (const name of PATHS) {
          if (!verdict.gaps[name] || gapClass(row.expected, name, verdict.gaps[name]) !== 'falseIncome') continue;
          const lane = `${row.lang} ${name}`;
          report.falseIncomeByLang[lane] = (report.falseIncomeByLang[lane] || 0) + 1;
        }
      }
    }
    if (isIncomeRow(list[0].expected)) {
      report.incomeRows += list.length;
      report.nativeIgnoredIncome += ignored;
      t.diagnostic(`native ignored ${ignored} of ${list.length} income rows`);
    }
    assert.equal(failures.length, 0, `${failures.length} ratchet failures in ${list.length} rows:\n${failures.slice(0, 8).join('\n')}`);
  });
}

function classCounts(gaps) {
  const counts = Object.fromEntries(Object.keys(CEILING).map((cls) => [cls, { parseSms: 0, session: 0, native: 0 }]));
  for (const entry of Object.values(gaps)) {
    for (const name of PATHS) if (entry[name]) counts[gapClass(entry.expected, name, entry[name])][name]++;
  }
  return counts;
}

test('refund matrix gap file only lists oracle rows, in canonical form', () => {
  for (const [id, entry] of Object.entries(known)) {
    const row = rowById.get(id);
    assert.ok(row, `${id} is not an oracle row`);
    assert.equal(entry.expected, row.expected, `${id} expected`);
    const paths = Object.keys(entry).filter((k) => k !== 'expected');
    assert.ok(paths.length > 0 && paths.every((k) => PATHS.includes(k)), `${id} lists no path or an unknown one`);
    for (const name of paths) assert.ok(gapClass(entry.expected, name, entry[name]), `${id} ${name} ${entry[name]} is not a gap`);
  }
  assert.equal(knownText, formatGapFile(knownFile.about, known), 'gap file is not sorted one entry per line (write it with REFUND_MATRIX_WRITE_GAPS)');
});

test('refund matrix ratchet: no class grows above its frozen ceiling', () => {
  const counts = classCounts(known);
  for (const [cls, byPath] of Object.entries(CEILING)) {
    for (const name of PATHS) {
      assert.ok(counts[cls][name] <= byPath[name], `${cls} on ${name}: ${counts[cls][name]} gap entries > ceiling ${byPath[name]}`);
    }
  }
  assert.ok(report.nativeIgnoredIncome <= NATIVE_IGNORED_INCOME_CEILING,
    `native ignored ${report.nativeIgnoredIncome} income rows > ceiling ${NATIVE_IGNORED_INCOME_CEILING}`);
});

test('refund matrix report', (t) => {
  report.counts = classCounts(current);
  const falseIncome = PATHS.map((name) => `${name} ${report.counts.falseIncome[name]}`).join(', ');
  t.diagnostic(`false income (store gate needs 0 on every path): ${falseIncome}; by language ${JSON.stringify(report.falseIncomeByLang)}`);
  t.diagnostic(`native ignored ${report.nativeIgnoredIncome} of ${report.incomeRows} income rows`);
  if (process.env.REFUND_MATRIX_REPORT) fs.writeFileSync(process.env.REFUND_MATRIX_REPORT, JSON.stringify(report, null, 1));
  if (process.env.REFUND_MATRIX_WRITE_GAPS) fs.writeFileSync(process.env.REFUND_MATRIX_WRITE_GAPS, formatGapFile(knownFile.about, current));
  assert.ok(report.total >= 500, 'at least 500 generated cases');
});

// One entry per line, sorted by id, so a fix shows up as deleted lines.
function formatGapFile(about, gaps) {
  const ids = Object.keys(gaps).sort();
  const lines = ids.map((id, i) => `  ${JSON.stringify(id)}: ${JSON.stringify(gaps[id])}${i < ids.length - 1 ? ',' : ''}`);
  return `{\n "about": ${JSON.stringify(about)},\n "gaps": {\n${lines.join('\n')}\n }\n}\n`;
}
module.exports = { formatGapFile };
