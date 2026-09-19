'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const dependencyNames = [
  'capture-source-identity', 'cards', 'markets', 'dedupe', 'bill-alias', 'format', 'heal',
  'transfer-evidence', 'transfer-reconciliation', 'ledger', 'ledger-money', 'sms-parser',
];

function planner() {
  const dependencies = Object.fromEntries(dependencyNames.map(name =>
    [`@/lib/${name}`, require(`../build/${name}`)]));
  const identity = load(path.join(root, 'src/lib/capture-source-identity.ts'));
  let validations = 0;
  dependencies['@/lib/capture-source-identity'] = {
    ...identity,
    isUsableCaptureSourceIdentity(...args) {
      validations++;
      return identity.isUsableCaptureSourceIdentity(...args);
    },
  };
  return {
    plan: load(path.join(root, 'src/lib/import-plan.ts'), dependencies).buildImportPlan,
    validations: () => validations,
  };
}

const timestamp = Date.UTC(2026, 8, 1, 12);
function row(index, patch = {}) {
  const ts = timestamp - index * 60_000;
  return Object.freeze({
    id: `row-${index}`, smsKey: `ha${index + 1}t${ts}`, ts,
    date: new Date(ts).toISOString().slice(0, 10), source: 'sms', type: 'expense',
    title: 'Shop', category: 'other', amountFils: 1000, currency: 'AED', accountId: 'bank',
    ...patch,
  });
}
function state(transactions) {
  return {
    hydrated: true, transactions, accounts: [{ id: 'bank', name: 'Bank', kind: 'bank' }],
    budgets: [], bills: [], goals: [], cardDues: [], accountHints: {}, merchantOverrides: {},
    billAliases: {}, lastScanTs: 0, parserVersion: 47, marketId: 'AE',
    ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  };
}
function scanned(transaction, index = 0) {
  return {
    kind: 'transaction', type: transaction.type, merchant: transaction.title,
    categoryGuess: transaction.category, amountFils: transaction.amountFils, currency: 'AED',
    date: transaction.date, smsTs: transaction.ts, sourceEventId: `a${index + 1}`,
    channel: 'inbox', sender: 'ENBD',
  };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('repeated exact-source history pages do not revalidate the unchanged 14.7k ledger', () => {
  const h = planner();
  const transactions = Object.freeze(Array.from({ length: 14_773 }, (_, i) => row(i)));
  const ledger = state(transactions);
  const input = transactions.slice(0, 128).map(scanned);
  const firstStarted = performance.now();
  const first = h.plan(input, ledger, timestamp);
  const firstMs = performance.now() - firstStarted;
  const firstWork = h.validations();
  const nextStarted = performance.now();
  const again = h.plan(input, { ...ledger, lastScanTs: timestamp }, timestamp);
  const nextMs = performance.now() - nextStarted;
  assert.equal(first.txCount, 0);
  assert.equal(first.batch.updates.length, 0);
  assert.deepEqual(plain(again), plain(first));
  assert.ok(firstWork >= transactions.length, 'the initial snapshot is validated');
  assert.equal(h.validations() - firstWork, input.length,
    'only incoming identities require validation when the immutable ledger is unchanged');
  console.log(JSON.stringify({ scope: 'host exact-source planning only', rows: transactions.length,
    page: input.length, firstMs: +firstMs.toFixed(2), reusedMs: +nextMs.toFixed(2) }));
});

test('a healed or restored transaction array invalidates the cached source index', () => {
  const h = planner();
  const original = Object.freeze([row(0)]);
  const input = [scanned(original[0])];
  assert.equal(h.plan(input, state(original), timestamp).batch.updates.length, 0);
  const changed = Object.freeze([row(0, { id: 'restored-row', title: 'Old merchant' })]);
  const before = h.validations();
  const result = h.plan(input, state(changed), timestamp);
  assert.ok(h.validations() - before > input.length, 'replacement snapshot must be indexed');
  assert.deepEqual(plain(result), plain(planner().plan(input, state(changed), timestamp)));
  assert.equal(result.batch.updates[0]?.id, 'restored-row');
  assert.deepEqual(plain(h.plan(input, state(original), timestamp)),
    plain(planner().plan(input, state(original), timestamp)), 'cached indexes remain independent');
});

test('canonical collisions and malformed Android identities retain fresh-planner results', () => {
  const h = planner();
  const transactions = Object.freeze([
    row(0, { id: 'legacy-alias', smsKey: 'ha1', title: 'Old merchant' }),
    row(0, { id: 'canonical-alias', title: 'Old merchant' }),
    row(0, { id: 'wrong-time', smsKey: `ha1t${timestamp + 1}`, title: 'Old merchant' }),
    row(0, { id: 'malformed', smsKey: 'ha+1', title: 'Old merchant' }),
  ]);
  const ledger = state(transactions);
  const input = [scanned(row(0))];
  for (let run = 0; run < 3; run++) {
    const plan = h.plan(input, ledger, timestamp);
    assert.deepEqual(plain(plan), plain(planner().plan(input, ledger, timestamp)));
    assert.equal(plan.batch.updates[0]?.id, 'legacy-alias', 'collision order is unchanged');
  }
  const decline = [{ sourceEventId: 'a1', smsTs: timestamp, channel: 'inbox', reason: 'declined' }];
  const removed = h.plan([], ledger, timestamp, new Date(timestamp), decline);
  assert.deepEqual(plain(removed), plain(planner().plan([], ledger, timestamp, new Date(timestamp), decline)));
  assert.deepEqual(plain(removed.batch.updates.map(update => update.id)), ['canonical-alias']);
  assert.equal(h.plan(input, ledger, timestamp).batch.updates[0]?.id, 'legacy-alias',
    'planning a deletion must not mutate the cached index before a ledger commit');
});
