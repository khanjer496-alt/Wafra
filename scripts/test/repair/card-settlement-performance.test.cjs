// Run: /opt/homebrew/opt/node@22/bin/node --test scripts/test/repair/card-settlement-performance.test.cjs
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { performance } = require('node:perf_hooks');
const ts = require('typescript');
const { core, ledger, markets } = require('./load-transfer-ledger.cjs');
const file = path.resolve(__dirname, '../../../src/lib/cards.ts');
const source = fs.readFileSync(file, 'utf8');
const format = require('./load-typescript.cjs')(path.join(path.dirname(file), 'format.ts'), {
  '@/lib/arabic-sms': {}, '@/lib/ledger-money': {}, '@/lib/markets': markets, '@/lib/i18n': {},
});
const dependencies = {
  '@/lib/transfer-reconciliation': core,
  '@/lib/ledger': ledger, '@/lib/markets': markets,
  // These helpers are outside the settlement paths under test.
  '@/lib/balances': {}, '@/lib/i18n': {},
  '@/lib/format': format,
};
function load(text, date = Date) {
  const output = ts.transpileModule(text + '\nexports.observedPairs = preferredObservedPairs; exports.manualMatches = preferredManualMatches;', {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', 'Date', output)(id => {
    assert.ok(Object.hasOwn(dependencies, id), `unexpected dependency ${id}`);
    return dependencies[id];
  }, module, module.exports, date);
  return module.exports;
}
// Frozen pre-fix exhaustive matchers are an independent equivalence oracle.
// They exercise the same public pipeline, including manual receipt evidence.
const oldObserved = `function preferredObservedPairs(
  debits: Transaction[],
  receipts: Transaction[],
): [number, number][] {
  const memo = new Map<string, MatchScore>();
  const solve = (debitIndex: number, receiptIndex: number): MatchScore => {
    if (debitIndex >= debits.length || receiptIndex >= receipts.length) {
      return { count: 0, distance: 0, pairs: [] };
    }
    const key = debitIndex + ":" + receiptIndex;
    const cached = memo.get(key);
    if (cached) return cached;

    const distance = isoDayDistance(debits[debitIndex].date, receipts[receiptIndex].date);
    let best: MatchScore | null = null;
    if (distance <= OBSERVED_COLLAPSE_DAYS) {
      const tail = solve(debitIndex + 1, receiptIndex + 1);
      best = {
        count: tail.count + 1,
        distance: tail.distance + distance,
        pairs: [[debitIndex, receiptIndex], ...tail.pairs],
      };
    }
    const consider = (candidate: MatchScore) => {
      if (
        best === null ||
        candidate.count > best.count ||
        (candidate.count === best.count && candidate.distance < best.distance)
      ) best = candidate;
    };
    consider(solve(debitIndex + 1, receiptIndex));
    consider(solve(debitIndex, receiptIndex + 1));
    const resolved = best ?? { count: 0, distance: 0, pairs: [] };
    memo.set(key, resolved);
    return resolved;
  };
  return solve(0, 0).pairs;
}
`;
const oldManual = `function preferredManualMatches(rows: Transaction[]): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const byAmount = new Map<number, Transaction[]>();
  for (const row of rows) {
    const leg = settlementLeg(row);
    if (leg !== 'manual' && leg !== 'debit' && leg !== 'receipt') continue;
    const bucket = byAmount.get(row.amountFils) ?? [];
    bucket.push(row);
    byAmount.set(row.amountFils, bucket);
  }

  for (const amountRows of byAmount.values()) {
    const ordered = amountRows.slice().sort(
      (a, b) => a.date.localeCompare(b.date) || (a.ts ?? 0) - (b.ts ?? 0) || a.id.localeCompare(b.id),
    );
    const manuals = ordered.filter((row) => settlementLeg(row) === 'manual');
    const clusters = observedSettlementClusters(ordered);

    const memo = new Map<string, MatchScore>();
    const solve = (manualIndex: number, clusterIndex: number): MatchScore => {
      if (manualIndex >= manuals.length || clusterIndex >= clusters.length) {
        return { count: 0, distance: 0, pairs: [] };
      }
      const key = manualIndex + ":" + clusterIndex;
      const cached = memo.get(key);
      if (cached) return cached;
      const manual = manuals[manualIndex];
      const cluster = clusters[clusterIndex];
      const observed = [cluster.debit, cluster.receipt].filter(
        (row): row is Transaction => row !== undefined,
      );
      const distance = Math.min(...observed.map((row) => isoDayDistance(manual.date, row.date)));
      let best: MatchScore | null = null;
      if (distance <= ASSERTED_COLLAPSE_DAYS) {
        const tail = solve(manualIndex + 1, clusterIndex + 1);
        best = {
          count: tail.count + 1,
          distance: tail.distance + distance,
          pairs: [[manualIndex, clusterIndex], ...tail.pairs],
        };
      }
      const consider = (candidate: MatchScore) => {
        if (
          best === null ||
          candidate.count > best.count ||
          (candidate.count === best.count && candidate.distance < best.distance)
        ) best = candidate;
      };
      consider(solve(manualIndex + 1, clusterIndex));
      consider(solve(manualIndex, clusterIndex + 1));
      const resolved = best ?? { count: 0, distance: 0, pairs: [] };
      memo.set(key, resolved);
      return resolved;
    };

    for (const [manualIndex, clusterIndex] of solve(0, 0).pairs) {
      const manualId = manuals[manualIndex].id;
      const cluster = clusters[clusterIndex];
      if (cluster.debit) result.set(cluster.debit.id, manualId);
      if (cluster.receipt) result.set(cluster.receipt.id, manualId);
    }
  }
  return result;
}
`;

function replaceFunction(text, name, next, replacement) {
  const start = text.indexOf(`function ${name}(`);
  const end = text.indexOf(`\nfunction ${next}(`, start);
  assert.ok(start >= 0 && end > start);
  return text.slice(0, start) + replacement + text.slice(end);
}
const referenceSource = replaceFunction(replaceFunction(source,
  'preferredObservedPairs', 'observedSettlementClusters', oldObserved),
  'preferredManualMatches', 'collapseSettlementLegsWithEvidence', oldManual);
const current = load(source);
const reference = load(referenceSource + '\nfunction isoDayDistance(a, b) { return Math.abs(Date.parse(a + \'T12:00:00Z\') - Date.parse(b + \'T12:00:00Z\')) / 86_400_000; }');
const accounts = [{ id: 'card', name: 'Credit card', cardType: 'credit', kind: 'card', openingFils: 0 }];
const day = offset => new Date(Date.UTC(2000, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10);
function row(id, offset, side, extra = {}) {
  return { id, accountId: 'card', date: day(offset), ts: offset * 86_400_000,
    title: 'Card payment', type: 'income', category: 'other', amountFils: 100_000,
    isTransfer: true, source: side === 'manual' ? 'manual' : 'sms',
    ...(side === 'debit' || side === 'receipt' ? { cardPaymentSide: side } : {}), ...extra };
}
function state(rows, dues = []) { return { accounts, transactions: rows, cardDues: dues }; }
const snapshot = value => JSON.stringify(value, (_, item) => item instanceof Map ? [...item] : item);
function assertEquivalent(rows) {
  assert.equal(snapshot(current.cardPaymentRows(state(rows))), snapshot(reference.cardPaymentRows(state(rows))));
  const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date) || (a.ts ?? 0) - (b.ts ?? 0) || a.id.localeCompare(b.id));
  const debits = ordered.filter(r => r.cardPaymentSide === 'debit');
  const receipts = ordered.filter(r => r.cardPaymentSide === 'receipt');
  assert.deepEqual(current.observedPairs(debits, receipts), reference.observedPairs(debits, receipts));
  assert.equal(snapshot(current.manualMatches(ordered)), snapshot(reference.manualMatches(ordered)));
}

test('6,000 debit alerts plus an unrelated receipt return without overflowing the call stack', () => {
  const rows = Array.from({ length: 6_000 }, (_, i) => row(`debit-${i}`, i * 2, 'debit'));
  rows.push(row('receipt', 20_000, 'receipt'));
  assert.equal(current.cardPaymentRows(state(rows)).length, rows.length);
  rows[rows.length - 1] = { ...rows.at(-1), date: rows.at(-2).date };
  assert.equal(current.cardPaymentRows(state(rows)).length, rows.length - 1, 'one valid late match also traverses the iterative matcher');
});

test('6,000 manual payments plus an unrelated bank observation do not overflow', () => {
  const rows = Array.from({ length: 6_000 }, (_, i) => row(`manual-${i}`, i * 10, 'manual'));
  rows.push(row('receipt', 70_000, 'receipt'));
  assert.equal(current.cardPaymentRows(state(rows)).length, rows.length);
  rows[rows.length - 1] = { ...rows.at(-1), date: rows.at(-2).date };
  assert.equal(current.cardPaymentRows(state(rows)).length, rows.length - 1, 'one valid late match also traverses the iterative matcher');
});

test('separated monthly payments perform bounded date parsing while retaining every movement', () => {
  let reads = 0;
  class CountedDate extends Date { static parse(value) { reads += 1; return Date.parse(value); } }
  const measured = load(source, CountedDate);
  const count = 800;
  const rows = Array.from({ length: count }, (_, i) => [row(`d-${i}`, i * 30, 'debit'), row(`r-${i}`, i * 30 + 1, 'receipt')]).flat();
  const start = performance.now();
  assert.equal(measured.cardPaymentRows(state(rows)).length, count);
  console.log(JSON.stringify({ scenario: '800 monthly paired payments, desktop Node', ms: +(performance.now() - start).toFixed(2), dateParseReads: reads }));
  assert.ok(reads < rows.length * 20, `${reads} parses exceeded the bounded per-alert work budget`);
});

test('one payment settles only the first of two overlapping statements', () => {
  const dues = [{ id: 'july', accountId: 'card', dueDate: '2026-07-25', totalDueFils: 100_000, minDueFils: 5_000, paidFils: 0 },
    { id: 'august', accountId: 'card', dueDate: '2026-08-20', totalDueFils: 80_000, minDueFils: 4_000, paidFils: 0 }];
  const rows = [row('debit', 0, 'debit', { date: '2026-07-15' }), row('receipt', 0, 'receipt', { date: '2026-07-16' })];
  const s = state(rows, dues);
  assert.equal(current.duePaidFils(s, dues[0]), 100_000);
  assert.equal(current.duePaidFils(s, dues[1]), 0);
  assert.equal(current.dueWithStatus(s, dues[1], new Date('2026-07-20T12:00:00Z')).remainingFils, 80_000);
});

test('inclusive windows, cardinality, skew and ties retain the exhaustive result', () => {
  for (const sides of [['debit', 'receipt'], ['manual', 'receipt'], ['manual', 'debit']]) {
    for (const dates of [[0, 1, 1, 2], [0, 6, 7, 8], [0, 1, 7, 8], [0, 0, 1, 1], [0, 2, 1, 1], [0, 30, 1, 31]]) {
      assertEquivalent([row('a', dates[0], sides[0]), row('b', dates[1], sides[0]), row('c', dates[2], sides[1]), row('d', dates[3], sides[1])]);
    }
  }
});

test('an earlier unmatched observation preserves the later-candidate tie preference', () => {
  const debits = [row('d0', 30, 'debit'), row('d1', 30, 'debit')];
  const receipts = [row('r0', 0, 'receipt'), row('r1', 30, 'receipt')];
  assert.deepEqual(current.observedPairs(debits, receipts), [[1, 1]]);
  assertEquivalent([...debits, ...receipts]);
  assertEquivalent([row('m0', 30, 'manual'), row('m1', 30, 'manual'), ...receipts]);
});

test('invalid dates remain unmatched without changing the remaining tie order', () => {
  assertEquivalent([row('d0', 30, 'debit'), row('d1', 30, 'debit'),
    row('r0', 0, 'receipt', { date: 'not-a-date' }), row('r1', 30, 'receipt')]);
  assertEquivalent([row('manual', 30, 'manual'), row('debit', 30, 'debit'),
    row('invalid', 30, 'receipt', { date: 'not-a-date' })]);
});

test('randomized mixed histories preserve complete payment rows and exact matching ties', () => {
  let seed = 0x834975;
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) % max; };
  const sides = ['debit', 'receipt', 'manual', 'unsided'];
  for (let round = 0; round < 500; round += 1) {
    const rows = Array.from({ length: 4 + random(28) }, (_, i) => row(`row-${i}`, random(80), sides[random(4)], {
      ts: random(4), amountFils: 100_000 + random(3) * 100,
      ...(random(8) === 0 ? { cashOutDate: day(random(80)) } : {}),
    }));
    assertEquivalent(rows);
    assertEquivalent([...rows].reverse());
  }
});
