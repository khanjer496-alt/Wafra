'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const nobleSha = require('@noble/hashes/sha2.js');
let shaCalls = 0;
const transfer = load(path.join(root, 'src/lib/transfer-reconciliation.ts'), {
  '@/lib/markets': load(path.join(root, 'src/lib/markets.ts')),
  '@/lib/currency-metadata': load(path.join(root, 'src/lib/currency-metadata.ts')),
  '@noble/hashes/sha2.js': {
    ...nobleSha,
    sha256: (...args) => {
      shaCalls += 1;
      return nobleSha.sha256(...args);
    },
  },
  '@noble/hashes/utils.js': require('@noble/hashes/utils.js'),
});

const accounts = [
  { id: 'a', name: 'A', kind: 'bank', bankName: 'FAB', last4: '1111' },
  { id: 'b', name: 'B', kind: 'bank', bankName: 'ADCB', last4: '2222' },
];
const rows = Array.from({ length: 512 }, (_, index) => ({
  id: `row-${index}`,
  type: index % 2 ? 'income' : 'expense',
  amountFils: 10_000 + index,
  accountId: index % 2 ? 'b' : 'a',
  title: index % 2 ? 'Incoming transfer' : 'Outgoing transfer',
  category: 'other',
  date: '2026-09-20',
  ts: 1_790_000_000_000 + index * 1_000,
  source: 'sms',
  smsKey: `s${1_790_000_000_000 + index * 1_000}-${index}`,
}));

test('unresolved candidates do not pay SHA cost just to be assessed', () => {
  transfer.reconcileTransfers(rows, accounts);
  assert.equal(shaCalls, 0, 'reconciliation fingerprints only rows that actually need durable link signatures');

  const edited = rows.slice();
  edited[177] = { ...edited[177], amountFils: edited[177].amountFils + 1, userEdited: true };
  transfer.reconcileTransfers(edited, accounts);
  assert.equal(shaCalls, 0, 'editing one unresolved candidate still does not hash the full candidate set');
});

test('durable transfer links hash only the linked rows and reuse immutable-row fingerprints', () => {
  const now = 1_790_000_000_000;
  const decided = [
    {
      ...rows[0],
      transferDecision: { version: 1, ownership: 'own', decidedAt: now, counterpartId: rows[1].id },
    },
    {
      ...rows[1],
      transferDecision: { version: 1, ownership: 'own', decidedAt: now, counterpartId: rows[0].id },
    },
  ];
  const leftSignature = transfer.transferFingerprint(decided[0]);
  const rightSignature = transfer.transferFingerprint(decided[1]);
  const linked = [
    {
      ...decided[0],
      transferMatch: {
        version: 1, counterpartId: decided[1].id, basis: 'user',
        signature: leftSignature, counterpartSignature: rightSignature,
      },
    },
    {
      ...decided[1],
      transferMatch: {
        version: 1, counterpartId: decided[0].id, basis: 'user',
        signature: rightSignature, counterpartSignature: leftSignature,
      },
    },
  ];
  const before = shaCalls;
  const normalized = transfer.normalizeTransferLinks(linked, accounts);
  assert.equal(shaCalls - before, 2, 'only the two rows receiving durable link signatures are hashed');
  assert.ok(normalized[0].transferMatch && normalized[1].transferMatch);

  const afterNormalize = shaCalls;
  transfer.reconcileTransfers(linked.slice(), accounts);
  assert.equal(shaCalls - afterNormalize, 0, 'new arrays containing the same immutable rows reuse cached fingerprints');
});

test('the exported fingerprint validator remains uncached for arbitrary caller input', () => {
  const before = shaCalls;
  transfer.transferFingerprint(rows[0]);
  transfer.transferFingerprint(rows[0]);
  assert.equal(shaCalls - before, 2);
});
