'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { performance } = require('node:perf_hooks');
const ts = require('typescript');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const file = path.join(root, 'src/lib/transfer-reconciliation.ts');
const source = fs.readFileSync(file, 'utf8');
const dependencies = {
  '@/lib/markets': load(path.join(root, 'src/lib/markets.ts')),
  '@/lib/currency-metadata': load(path.join(root, 'src/lib/currency-metadata.ts')),
  '@noble/hashes/sha2.js': require('@noble/hashes/sha2.js'),
  '@noble/hashes/utils.js': require('@noble/hashes/utils.js'),
};
function coreFrom(text) {
  const output = ts.transpileModule(text, { fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((id) => {
    assert.ok(Object.hasOwn(dependencies, id), `unexpected dependency ${id}`);
    return dependencies[id];
  }, module, module.exports);
  return module.exports;
}

// Keep the prior exhaustive candidate search as an independent oracle. All
// other shipping validation, ownership, fingerprint and link code is shared.
const exhaustiveSearch = `
    const unresolvedBuckets = new Map<string, TransferRow[]>();
    for (const tx of unresolvedRows) {
      const key = JSON.stringify([moneyKey(tx), tx.type]);
      const bucket = unresolvedBuckets.get(key) ?? [];
      bucket.push(tx); unresolvedBuckets.set(key, bucket);
    }
    const possible = new Map<string, string[]>();
    const reverseCount = new Map<string, number>();
    for (const own of ownRows) {
      const opposite = own.type === 'income' ? 'expense' : 'income';
      const bucket = unresolvedBuckets.get(JSON.stringify([moneyKey(own), opposite])) ?? [];
      const at = movementTime(own)!;
      const candidates = bucket.filter(other => other.accountId !== own.accountId &&
        (sourceTime(own) !== undefined && sourceTime(other) !== undefined
          ? Math.abs(movementTime(other)! - at) <= 5 * 60_000
          : other.date === own.date));
      possible.set(own.id, candidates.map(row => row.id));
      for (const candidate of candidates) reverseCount.set(candidate.id, (reverseCount.get(candidate.id) ?? 0) + 1);
    }
`;
const begin = source.indexOf('    const unresolvedBuckets = new Map<');
const end = source.indexOf('    for (const own of ownRows) {\n      const candidates = possible.get', begin);
assert.ok(begin > 0 && end > begin, 'the reference must replace exactly the candidate enumeration');
const current = coreFrom(source);
const reference = coreFrom(source.slice(0, begin) + exhaustiveSearch + source.slice(end));
const accounts = [
  { id: 'a', name: 'Liv', bankName: 'Liv', last4: '1111', kind: 'bank', openingFils: 0 },
  { id: 'b', name: 'FAB', bankName: 'FAB', last4: '2222', kind: 'bank', openingFils: 0 },
  { id: 'card', name: 'ADCB', bankName: 'ADCB', last4: '3333', kind: 'card', cardType: 'credit', openingFils: 0 },
];
const START = Date.UTC(2026, 0, 1);
function row(id, day, own, extra = {}) {
  const at = START + day * 86_400_000 + (own ? 0 : 60_000);
  return { id, type: own ? 'expense' : 'income', amountFils: 10_000, category: 'other',
    accountId: own ? 'a' : 'b', title: own ? 'Own account transfer' : 'Incoming transfer',
    isTransfer: own, date: new Date(at).toISOString().slice(0, 10), ts: at,
    source: 'sms', smsKey: `s${at}-${id}`, ...extra };
}
// Preserve Map/Set iteration order as well as every value, link and signature.
const snapshot = (value) => JSON.stringify(value, (_, item) =>
  item instanceof Map ? [...item] : item instanceof Set ? [...item] : item);
function assertEquivalent(rows) {
  assert.equal(snapshot(current.reconcileTransfers(rows, accounts)), snapshot(reference.reconcileTransfers(rows, accounts)));
  assert.equal(snapshot(current.normalizeTransferLinks(rows, accounts)), snapshot(reference.normalizeTransferLinks(rows, accounts)));
  for (const transaction of rows) assert.equal(current.transferFingerprint(transaction), reference.transferFingerprint(transaction));
}
function paired(rows) {
  assertEquivalent(rows);
  return current.reconcileTransfers(rows, accounts).byId.get('own')?.counterpartId;
}

test('separated-day equal-amount history has a linear bound on source-clock reads', () => {
  const count = 1_000;
  let clockReads = 0;
  const rows = Array.from({ length: count }, (_, index) => {
    const transaction = row(`row-${index}`, Math.floor(index / 2), index % 2 === 0);
    const at = transaction.ts;
    Object.defineProperty(transaction, 'ts', { enumerable: true, get: () => { clockReads += 1; return at; } });
    return transaction;
  });
  const result = current.reconcileTransfers(rows, accounts);
  console.log(JSON.stringify({ scope: 'source-clock read count', rows: count, clockReads }));
  assert.equal(result.internalIds.size, count, 'the work bound must not be achieved by dropping matches');
  assert.ok(clockReads < count * 100, `${clockReads} clock reads exceeded the bounded per-row budget`);
});

test('exact clocks preserve the inclusive five-minute boundary across posting dates', () => {
  const own = row('own', 0, true, { ts: START + 23 * 3_600_000 + 58 * 60_000 });
  const arrival = row('arrival', 1, false, { ts: own.ts + 300_000 });
  assert.equal(paired([own, arrival]), 'arrival');
  assert.equal(paired([own, { ...arrival, ts: arrival.ts + 1 }]), undefined);
  assert.equal(paired([own, { ...arrival, ts: own.ts - 300_000 }]), 'arrival');
});

test('missing and invalid clocks retain same-date fallback, including SMS-key clocks', () => {
  for (const tsValue of [undefined, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const own = row('own', 0, true);
    const arrival = row('arrival', 0, false, { ts: tsValue, smsKey: 'no-source-clock' });
    assert.equal(paired([own, arrival]), 'arrival');
    assert.equal(paired([own, { ...arrival, date: '2026-01-02' }]), undefined);
    assert.equal(paired([{ ...own, ts: tsValue, smsKey: 'no-source-clock' }, row('arrival', 0, false, { ts: START + 40_000_000 })]), 'arrival');
  }
  assert.equal(paired([row('own', 0, true), row('arrival', 0, false, { ts: undefined, smsKey: `s${START + 300_001}-arrival` })]), undefined);
  // An explicitly invalid ts suppresses fallback to a valid clock-shaped key.
  assert.equal(paired([row('own', 0, true), row('arrival', 0, false, { ts: -1, smsKey: `s${START + 300_001}-arrival` })]), 'arrival');
});

test('mixed timed and untimed candidates and reverse collisions remain ambiguous', () => {
  const own = row('own', 0, true);
  const timed = row('timed', 0, false);
  const untimed = row('untimed', 0, false, { ts: undefined, smsKey: 'no-clock' });
  assert.equal(paired([own, timed, untimed]), undefined);
  assert.equal(paired([own, { ...own, id: 'second-own' }, timed]), undefined);
  assert.equal(paired([own, { ...untimed, accountId: 'a' }, timed]), 'timed');
  assert.equal(paired([own, { ...untimed, amountFils: 10_001 }, timed]), 'timed');
  assert.equal(paired([own, { ...untimed, originalCurrency: 'USD', originalAmountMinor: 100 }, timed]), 'timed');
});

test('randomized mixed ledgers preserve complete results, ordering and fingerprints against exhaustive search', () => {
  let seed = 0x71931;
  const random = (max) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let round = 0; round < 150; round += 1) {
    const rows = Array.from({ length: 80 }, (_, index) => {
      const transaction = row(`row-${index}`, random(8), !!random(2));
      if (random(3) === 0) { transaction.ts = undefined; transaction.smsKey = 'no-clock'; }
      if (random(8) === 0) transaction.ts = -1;
      if (random(6) === 0) transaction.date = `2026-01-0${random(8) + 1}`;
      if (random(6) === 0) transaction.accountId = 'a';
      if (random(5) === 0) transaction.amountFils += random(3) * 100;
      if (random(9) === 0) { transaction.originalCurrency = 'USD'; transaction.originalAmountMinor = 100; }
      if (random(8) === 0) transaction.transferDecision = { version: 1, ownership: 'external', decidedAt: START };
      if (random(6) === 0) { transaction.title = 'Coffee'; transaction.category = 'dining'; transaction.isTransfer = false; }
      if (random(8) === 0) Object.assign(transaction, { accountId: 'card', title: 'Card payment', type: 'income',
        cardPaymentSide: 'receipt', isTransfer: true, captureInstrument: { last4: '3333', kind: 'credit', bankIdentity: 'ADCB' } });
      return transaction;
    });
    assertEquivalent(rows);
    assertEquivalent([...rows].reverse());
  }
});

test('report matching-history timings without a machine-dependent pass threshold', () => {
  const result = { scope: 'desktop Node; 5,000 synthetic transfer rows; fingerprints unchanged' };
  for (const [name, core] of [['exhaustiveMs', reference], ['indexedMs', current]]) {
    const rows = Array.from({ length: 5_000 }, (_, index) => row(`row-${index}`, Math.floor(index / 2), index % 2 === 0));
    const start = performance.now();
    assert.equal(core.normalizeTransferLinks(rows, accounts), rows);
    result[name] = +(performance.now() - start).toFixed(2);
  }
  console.log(JSON.stringify(result));
});
