'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const dependencies = {
  '@/lib/ledger': require('./load-transfer-ledger.cjs').ledger,
  '@/lib/capture-source-identity': load(path.join(root, 'src/lib/capture-source-identity.ts')),
};
const patterns = load(path.join(root, 'src/lib/assistant-patterns.ts'), dependencies);
const now = new Date('2026-09-12T18:00:00Z');
const plain = value => JSON.parse(JSON.stringify(value));
const row = (id, date, amountFils, extra = {}) => ({ id, date, amountFils,
  title: 'Stream Service', accountId: 'bank', type: 'expense', category: 'software',
  source: 'sms', ...extra });
const monthly = (latest = 1200) => [row('june', '2026-06-01', 1000),
  row('july', '2026-07-01', 1000), row('august', '2026-08-01', 1000),
  row('september', '2026-09-01', latest)];

test('an established recurring charge increase cites the selected charge and stable earlier baseline', () => {
  const rows = monthly();
  const result = patterns.findRecurringChanges(rows, [rows[3]], now);
  assert.equal(result.length, 1);
  assert.deepEqual(plain(result[0].transactionIds), ['september']);
  assert.deepEqual(plain(result[0].baselineTransactionIds), ['june', 'july', 'august']);
  assert.equal(result[0].amountFils, 1200);
  assert.equal(result[0].baselineFils, 1000);
  assert.equal(result[0].deltaFils, 200);
  assert.equal(result[0].direction, 'increase');
  assert.match(result[0].reason, /charge/i);
});

test('recurring decreases, a repeated new amount and the exact 10 percent boundary are supported', () => {
  for (const [amount, direction] of [[800, 'decrease'], [900, 'decrease'], [1100, 'increase']]) {
    const rows = monthly(amount);
    const finding = patterns.findRecurringChanges(rows, [rows[3]], now)[0];
    assert.equal(finding.direction, direction);
    assert.equal(finding.deltaFils, amount - 1000);
  }
  const rows = monthly(1200);
  rows.unshift(row('may', '2026-05-01', 1000));
  rows[3].amountFils = 1200;
  assert.equal(patterns.findRecurringChanges(rows, [rows[4]], now)[0].baselineFils, 1000);
});

test('stable, sparse, irregular, unstable and dismissed histories do not imply a recurring change', () => {
  assert.equal(patterns.findRecurringChanges(monthly(1099), [monthly(1099)[3]], now).length, 0);
  assert.equal(patterns.findRecurringChanges(monthly(1000), [monthly(1000)[3]], now).length, 0);
  const sparse = monthly().slice(1);
  assert.equal(patterns.findRecurringChanges(sparse, [sparse[2]], now).length, 0);
  const irregular = monthly(); irregular[1].date = '2026-07-20';
  assert.equal(patterns.findRecurringChanges(irregular, [irregular[3]], now).length, 0);
  const unstable = monthly(); unstable[1].amountFils = 800;
  assert.equal(patterns.findRecurringChanges(unstable, [unstable[3]], now).length, 0);
  assert.equal(patterns.findRecurringChanges(monthly(), [monthly()[3]], now, [' stream   SERVICE ']).length, 0);
});

test('cadence accepts established weekly and yearly charges without requiring regional merchant names', () => {
  for (const dates of [['2026-08-11', '2026-08-18', '2026-08-25', '2026-09-01'],
    ['2023-09-01', '2024-09-01', '2025-09-01', '2026-09-01']]) {
    const rows = dates.map((date, i) => row(`cadence-${i}`, date, i === 3 ? 1200 : 1000,
      { title: 'Independent local service' }));
    assert.equal(patterns.findRecurringChanges(rows, [rows[3]], now).length, 1);
  }
});

test('a historical selected charge never uses later charges or a future dated entry', () => {
  const rows = monthly();
  const expected = plain(patterns.findRecurringChanges(rows, [rows[3]], now));
  rows.push(row('october', '2026-10-01', 1000), row('future-clock', '2026-08-03', 1,
    { ts: Date.parse('2026-09-20T12:00:00Z') }));
  assert.deepEqual(plain(patterns.findRecurringChanges(rows, [rows[3]], now)), expected);
  assert.equal(patterns.findRecurringChanges(rows, [rows[4]], now).length, 0);
});

test('merchant, account and capture-instrument evidence cannot be pooled', () => {
  for (const extra of [{ title: 'Stream Service Premium' }, { accountId: 'second' },
    { captureInstrument: { kind: 'credit', last4: '1234', bankIdentity: 'bank' } }]) {
    const rows = monthly(); rows[0] = { ...rows[0], ...extra };
    assert.equal(patterns.findRecurringChanges(rows, [rows[3]], now).length, 0);
  }
  const rows = monthly(); rows[0].title = '  STREAM   service ';
  assert.equal(patterns.findRecurringChanges(rows, [rows[3]], now).length, 1);
});

const unusual = (amount = 4000) => [
  ...[1000, 1050, 950, 1000, 1000].map((value, i) => row(`prior-${i}`, `2026-08-0${i + 1}`, value)),
  row('large', '2026-09-01', amount),
];

test('an unusual charge needs five earlier comparable observations and exact evidence', () => {
  const rows = unusual();
  const findings = patterns.findUnusualCharges(rows, [rows[5]], now);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].baselineFils, 1000);
  assert.equal(findings[0].deltaFils, 3000);
  assert.deepEqual(plain(findings[0].baselineTransactionIds), rows.slice(0, 5).map(tx => tx.id));
  assert.equal(patterns.findUnusualCharges(rows.slice(1), [rows[5]], now).length, 0);
  assert.equal(patterns.findUnusualCharges(unusual(2999), [rows[5]], now).length, 0);
  assert.equal(patterns.findUnusualCharges(unusual(3000), [rows[5]], now).length, 1);
});

test('odd baseline windows keep median evidence in exact observed minor units', () => {
  const rows = [1000, 1000, 1000, 1001, 1001, 1001].map((amount, index) =>
    row(`median-${index}`, `2026-08-0${index + 1}`, amount));
  const latest = row('latest', '2026-09-01', 3003);
  const finding = patterns.findUnusualCharges([...rows, latest], [latest], now)[0];
  assert.equal(finding.baselineFils, 1001);
  assert.deepEqual(plain(finding.baselineTransactionIds), rows.slice(1).map(tx => tx.id));
  assert.equal(finding.deltaFils, 2002);
});

test('future, same-day, other merchant/account and later outliers cannot create or corrupt an unusual baseline', () => {
  const rows = unusual();
  const expected = plain(patterns.findUnusualCharges(rows, [rows[5]], now));
  const additions = [row('later', '2026-09-02', 999999), row('same-day', '2026-09-01', 999999),
    row('future', '2026-12-01', 999999)];
  assert.deepEqual(plain(patterns.findUnusualCharges([...rows, ...additions], [rows[5]], now)), expected);
  for (const extra of [{ title: 'Different Service' }, { accountId: 'other' }, { date: '2026-09-01' }]) {
    const mixed = rows.map(tx => tx.id === 'prior-0' ? { ...tx, ...extra } : tx);
    assert.equal(patterns.findUnusualCharges(mixed, [rows[5]], now).length, 0);
  }
});

test('unusual charges refuse stale history and cite only the preceding 180 days', () => {
  const rows = unusual();
  const old = rows.map(tx => tx.id === 'large' ? tx : { ...tx, date: tx.date.replace('2026', '2023') });
  assert.equal(patterns.findUnusualCharges(old, [old[5]], now).length, 0);
  const mixed = [...old.slice(0, 5), ...rows];
  // Give historical rows unique IDs; conflicting IDs deliberately cannot be evidence.
  mixed.splice(0, 5, ...old.slice(0, 5).map(tx => ({ ...tx, id: `old-${tx.id}` })));
  const finding = patterns.findUnusualCharges(mixed, [rows[5]], now)[0];
  assert.deepEqual(plain(finding.baselineTransactionIds), rows.slice(0, 5).map(tx => tx.id));
  assert.match(finding.reason, /preceding 180 days/);
});

const stamp = Date.parse('2026-09-01T12:00:00Z');
const duplicatePair = (extra = {}) => [row('first', '2026-09-01', 1000, { ts: stamp }),
  row('second', '2026-09-01', 1000, { ts: stamp + 60_000, ...extra })];

test('possible duplicate timestamp candidates cite both full charges without changing them', () => {
  const rows = duplicatePair(); const before = JSON.stringify(rows);
  const finding = patterns.findPossibleDuplicates(rows, [rows[1]], now)[0];
  assert.deepEqual(plain(finding.transactionIds), ['first', 'second']);
  assert.equal(finding.amountFils, 2000);
  assert.deepEqual(plain(finding.baselineTransactionIds), []);
  assert.match(finding.reason, /separate purchases/);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(patterns.findPossibleDuplicates(duplicatePair({ ts: stamp + 120_000 }), [rows[1]], now).length, 1);
  assert.equal(patterns.findPossibleDuplicates(duplicatePair({ ts: stamp + 120_001 }), [rows[1]], now).length, 0);
});

test('same usable captured event identity works without a guessed date-only timestamp', () => {
  const key = `h${'b'.repeat(64)}`;
  const rows = [row('first', '2026-09-01', 1000, { smsKey: key }),
    row('second', '2026-09-01', 1000, { smsKey: key })];
  assert.equal(patterns.findPossibleDuplicates(rows, rows, now).length, 1);
  assert.equal(patterns.findPossibleDuplicates(rows, [rows[0]], now).length, 1);
  assert.equal(patterns.findPossibleDuplicates(rows.map(tx => ({ ...tx, smsKey: 'ha1' })), rows, now).length, 0);
  const malformed = rows.map(tx => ({ ...tx, smsKey: 'ha1tbroken', ts: stamp }));
  assert.equal(patterns.findPossibleDuplicates(malformed, malformed, now).length, 0);
});

test('a reused capture identity cannot override widely contradictory posting dates or clocks', () => {
  const key = `h${'c'.repeat(64)}`;
  const rows = [row('first', '2026-08-01', 1000, { smsKey: key }),
    row('second', '2026-09-01', 1000, { smsKey: key })];
  assert.equal(patterns.findPossibleDuplicates(rows, rows, now).length, 0);
  const wrongClock = rows.map(tx => ({ ...tx, ts: stamp }));
  assert.equal(patterns.findPossibleDuplicates(wrongClock, wrongClock, now).length, 0);
  const midnight = [row('before-midnight', '2026-08-31', 1000,
    { ts: Date.parse('2026-08-31T23:59:30Z') }),
  row('after-midnight', '2026-09-01', 1000, { ts: Date.parse('2026-09-01T00:00:30Z') })];
  assert.equal(patterns.findPossibleDuplicates(midnight, [midnight[1]], now).length, 1);
});

test('date-only or manual equal purchases are not duplicates, even when entered together', () => {
  const rows = duplicatePair();
  for (const extra of [{ ts: undefined }, { source: 'manual' }, { source: undefined }]) {
    const manual = rows.map(tx => ({ ...tx, ...extra }));
    assert.equal(patterns.findPossibleDuplicates(manual, manual, now).length, 0);
  }
  const legacy = rows.map((tx, i) => ({ ...tx, ts: undefined, smsKey: `s${stamp + i * 60_000}-1000` }));
  assert.equal(patterns.findPossibleDuplicates(legacy, legacy, now).length, 1);
});

test('equal amount does not connect merchants, accounts, incompatible instruments or settlements', () => {
  for (const extra of [{ title: 'Stream Service Store' }, { accountId: 'other' }, { amountFils: 1001 },
    { type: 'income' }, { isTransfer: true }, { cardPaymentSide: 'receipt' },
    { paymentFlowSide: 'funding' }, { category: 'investing' },
    { captureInstrument: { kind: 'credit', last4: '1234' } },
    { transferDecision: { version: 1, ownership: 'external', decidedAt: stamp } }]) {
    const rows = duplicatePair(extra);
    assert.equal(patterns.findPossibleDuplicates(rows, rows, now).length, 0, JSON.stringify(extra));
  }
  const rows = duplicatePair().map((tx, i) => ({ ...tx,
    captureInstrument: { kind: i ? 'debit' : 'credit', last4: '1234', bankIdentity: 'bank' } }));
  assert.equal(patterns.findPossibleDuplicates(rows, rows, now).length, 0);
});

test('duplicate groups do not look beyond the selected transaction or chain over two minutes', () => {
  const rows = duplicatePair();
  assert.equal(patterns.findPossibleDuplicates(rows, [rows[0]], now).length, 0);
  rows.push(row('third', '2026-09-01', 1000, { ts: stamp + 180_000 }));
  const findings = patterns.findPossibleDuplicates(rows, rows, now);
  assert.equal(findings.length, 1);
  assert.deepEqual(plain(findings[0].transactionIds), ['first', 'second']);
  const cluster = Array.from({ length: 20 }, (_, i) => row(`item-${String(i).padStart(2, '0')}`,
    '2026-09-01', 1000, { ts: stamp }));
  const all = patterns.findPossibleDuplicates(cluster, cluster, now);
  assert.ok(all.every(finding => finding.transactionIds.length <= 8));
  const ids = all.flatMap(finding => plain(finding.transactionIds));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(plain(patterns.findPossibleDuplicates([...cluster].reverse(), cluster, now)), plain(all));
});

test('FX fluctuations and allocated split amounts never become a local price or duplicate claim', () => {
  for (const extra of [{ originalCurrency: 'USD', originalAmountMinor: 1000, fxSource: 'bank' },
    { originalCurrency: 'JPY', originalAmountMinor: 1000 }, { fxSource: 'reference' },
    { splits: [{ category: 'software', amountFils: 500 }, { category: 'other', amountFils: 500 }] }]) {
    const recurring = monthly().map(tx => ({ ...tx, ...extra }));
    const uncommon = unusual().map(tx => ({ ...tx, ...extra }));
    const duplicates = duplicatePair().map(tx => ({ ...tx, ...extra }));
    assert.equal(patterns.findRecurringChanges(recurring, [recurring[3]], now).length, 0);
    assert.equal(patterns.findUnusualCharges(uncommon, [uncommon[5]], now).length, 0);
    assert.equal(patterns.findPossibleDuplicates(duplicates, duplicates, now).length, 0);
  }
});

test('native global zero/two/three decimal ledger units preserve exact amounts and thresholds', () => {
  for (const [currency, scale] of [['JPY', 1], ['USD', 100], ['KWD', 1000]]) {
    const rows = monthly().map(tx => ({ ...tx, title: `Service in ${currency}`,
      amountFils: tx.amountFils / 100 * scale }));
    const finding = patterns.findRecurringChanges(rows, [rows[3]], now)[0];
    assert.equal(finding.amountFils, 12 * scale);
    assert.equal(finding.baselineFils, 10 * scale);
    assert.equal(finding.deltaFils, 2 * scale);
    const small = unusual().map(tx => ({ ...tx, amountFils: tx.amountFils / 50 * scale }));
    assert.equal(patterns.findUnusualCharges(small, [small[5]], now)[0].deltaFils, 60 * scale);
    const same = duplicatePair().map(tx => ({ ...tx, amountFils: 10 * scale }));
    assert.equal(patterns.findPossibleDuplicates(same, same, now)[0].amountFils, 20 * scale);
  }
});

test('coverage reports disjoint omissions without claiming imported history is complete', () => {
  const rows = [row('ordinary', '2026-09-01', 1000),
    row('fx', '2026-09-01', 1000, { originalCurrency: 'USD' }),
    row('split', '2026-09-01', 1000, { splits: [{ category: 'other', amountFils: 1000 }] }),
    row('income', '2026-09-01', 1000, { type: 'income' }), row('future', '2027-01-01', 1000)];
  assert.deepEqual(plain(patterns.patternAnalysisCoverage(rows, now)), {
    eligibleCount: 1, skippedFxCount: 1, skippedSplitCount: 1, skippedOtherCount: 2,
  });
});

test('invalid money, conflicting record IDs and unknown merchants cannot supply pattern proof', () => {
  for (const amount of [0, -1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const rows = monthly(amount);
    assert.equal(patterns.findRecurringChanges(rows, [rows[3]], now).length, 0);
  }
  const rows = monthly(); rows.push({ ...rows[0] });
  assert.equal(patterns.findRecurringChanges(rows, [rows[3]], now).length, 0);
  for (const extra of [{ title: 'Card purchase' }, { accountId: '__unassigned-transaction__' },
    { date: '2026-02-30' }]) {
    const unknown = duplicatePair().map(tx => ({ ...tx, ...extra }));
    assert.equal(patterns.findPossibleDuplicates(unknown, unknown, now).length, 0);
  }
  const huge = duplicatePair().map(tx => ({ ...tx, amountFils: Number.MAX_SAFE_INTEGER }));
  assert.equal(patterns.findPossibleDuplicates(huge, huge, now).length, 0);
});

test('analysis is deterministic and never mutates frozen input records or arrays', () => {
  const rows = Object.freeze(monthly().map(tx => Object.freeze(tx)));
  const selected = Object.freeze([rows[3]]);
  const before = JSON.stringify(rows);
  const expected = plain(patterns.findRecurringChanges(rows, selected, now));
  assert.deepEqual(plain(patterns.findRecurringChanges([...rows].reverse(), selected, now)), expected);
  patterns.findUnusualCharges(rows, selected, now);
  patterns.findPossibleDuplicates(rows, selected, now);
  patterns.patternAnalysisCoverage(rows, now);
  assert.equal(JSON.stringify(rows), before);
});
