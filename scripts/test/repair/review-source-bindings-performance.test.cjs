'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const read = name => fs.readFileSync(path.join(root, 'src/lib', name), 'utf8');
function load(source, dependencies = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  Function('require', 'module', 'exports', output)(id => {
    assert.ok(Object.hasOwn(dependencies, id), `unexpected dependency ${id}`);
    return dependencies[id];
  }, module, module.exports);
  return module.exports;
}
const identity = load(read('capture-source-identity.ts'));
const currency = load(read('currency-metadata.ts'));
const money = load(read('ledger-money.ts'), { '@/lib/currency-metadata': currency });
const generic = load(read('generic-review-entry.ts'), { '@/lib/ledger-money': money });
const tray = load(read('alert-review-tray.ts'), {
  '@/lib/capture-source-identity': identity,
  '@/lib/generic-review-entry': generic,
  '@/lib/universal-import': { canonicalUniversalSourceKey: identity.canonicalCaptureSourceKey },
});
const source = read('review-source-bindings.ts');

// Frozen original conflict rules. The surrounding validation, twin selection
// and output normalization execute from actual source for both implementations.
const originalFilter = `  const accepted = chosen.filter((item) => {
    if (chosen.some((other) => other.legacySourceKey !== item.legacySourceKey &&
      (other.id === item.id ||
        canonicalUniversalSourceKey(other.sourceKey, other.observedAt) === canonicalUniversalSourceKey(item.sourceKey, item.observedAt)))) return false;
    const canonical = canonicalUniversalSourceKey(item.sourceKey, item.observedAt);
    if (state.reviewTray.pending.some((pending) =>
      (pending.sourceKey === item.legacySourceKey &&
        (pending.id !== item.legacyId || pending.observedAt !== item.observedAt)) ||
      (pending.sourceKey !== item.legacySourceKey &&
        (pending.id === item.id || canonicalUniversalSourceKey(pending.sourceKey, pending.observedAt) === canonical)))) return false;
    if (state.transactions.some((transaction) => transaction.smsKey !== item.legacySourceKey &&
      transaction.smsKey && isUsableCaptureSourceIdentity(transaction.smsKey, transaction.ts) &&
      canonicalUniversalSourceKey(transaction.smsKey, transaction.ts) === canonical)) return false;
    return true;
  });
`;
const indexedStart = source.indexOf('  // Index exact identities');
const filterStart = indexedStart >= 0 ? indexedStart : source.indexOf('  const accepted = chosen.filter(');
const filterEnd = source.indexOf('  if (!accepted.length)', filterStart);
assert.ok(filterStart >= 0 && filterEnd > filterStart);
const originalSource = source.slice(0, filterStart) + originalFilter + source.slice(filterEnd);
function bindingsModule(text = source) {
  const reads = { canonical: 0, usable: 0 };
  const api = load(text, {
    '@/lib/capture-source-identity': { ...identity,
      isUsableCaptureSourceIdentity(...args) { reads.usable++; return identity.isUsableCaptureSourceIdentity(...args); } },
    '@/lib/universal-import': { canonicalUniversalSourceKey(...args) {
      reads.canonical++; return identity.canonicalCaptureSourceKey(...args);
    } },
    '@/lib/alert-review-tray': tray,
  });
  return { ...api, reads };
}
const current = bindingsModule();
const reference = bindingsModule(originalSource);
const NOW = Date.UTC(2026, 8, 19, 12);
const hex = value => value.toString(16).padStart(64, '0');
const legacy = value => `arc1_${hex(value)}`;
const tuple = (value, patch = {}) => ({ legacySourceKey: legacy(value), legacyId: `ari1_${hex(value)}`,
  id: `ari1_${hex(value + 20_000)}`, sourceKey: `android_message_review_source_a${value}`, observedAt: NOW, ...patch });
const transaction = (value, patch = {}) => ({ id: `row-${value}`, smsKey: legacy(value), ts: NOW,
  amountFils: value + 100, type: 'expense', date: '2026-09-19', accountId: 'fixture',
  source: 'sms', title: 'Synthetic merchant', category: 'other', ...patch });
const pending = (value, patch = {}) => ({ kind: 'registered', id: `ari1_${hex(value)}`, sourceKey: legacy(value),
  observedAt: NOW, expiresAt: NOW + 10_000, channel: 'inbox', parserVersion: 1, market: 'AE', institution: 'fixture',
  grammar: { id: 'fixture-alert', version: 1, channel: 'bank-alert', status: 'experimental', provenance: 'launch-registry' },
  amount: { currency: 'AED', exponent: 2, minorUnits: '100' }, direction: 'debit', family: 'purchase', rail: null,
  instrument: null, ...patch });
const state = (transactions = [], pendingRows = [], tombstones = []) => ({ transactions,
  reviewTray: { ...tray.emptyAlertReviewTray(), pending: pendingRows, tombstones } });
const tombstone = sourceKey => ({ sourceKey, outcome: 'dismissed', resolvedAt: NOW - 1_000, expiresAt: NOW + 10_000 });
function equivalent(base, bindings, now = NOW) {
  const before = JSON.stringify([base, bindings]);
  const actual = current.reconcileReviewSourceBindings(base, bindings, now);
  const expected = reference.reconcileReviewSourceBindings(base, bindings, now);
  assert.deepEqual(actual, expected);
  assert.equal(JSON.stringify([base, bindings]), before, 'reconciliation never mutates inputs');
  if (!actual.changed) assert.equal(actual.reviewTray, base.reviewTray);
  return actual;
}

test('15,000 rows and 500 bindings perform bounded identity work and preserve all source updates', () => {
  const measured = bindingsModule();
  const base = state(Array.from({ length: 15_000 }, (_, i) => transaction(i)));
  const bindings = Array.from({ length: 500 }, (_, i) => tuple(i));
  const start = performance.now();
  const result = measured.reconcileReviewSourceBindings(base, bindings, NOW);
  console.log(JSON.stringify({ scenario: '15k ledger / 500 Android source bindings', ms: +(performance.now() - start).toFixed(2), ...measured.reads }));
  assert.equal(result.transactionKeyUpdates.length, bindings.length);
  assert.deepEqual(result.transactionKeyUpdates, bindings.map((binding, i) => ({ id: `row-${i}`, smsKey: `ha${i}t${NOW}` })));
  assert.ok(measured.reads.usable <= base.transactions.length, 'validate each ledger identity at most once');
  assert.ok(measured.reads.canonical <= base.transactions.length + bindings.length * 5, 'canonicalization must scale with ledger plus bindings');
});

test('exact conflict rules retain pending, tombstone, malformed, twin and reused-ID behavior', () => {
  const first = tuple(1), second = tuple(2);
  for (const bindings of [[first], [first, first], [first, { ...first, observedAt: NOW + 1 }],
    [first, { ...first, id: second.id }], [first, { ...first, sourceKey: second.sourceKey }],
    [first, second], [first, { ...second, id: first.id }], [first, { ...second, sourceKey: first.sourceKey }],
    [first, { ...second, sourceKey: first.sourceKey, observedAt: NOW + 1 }],
    [null, [], false, {}, { ...first, raw: 'synthetic forbidden property' }, { ...first, observedAt: NaN }],
    [first, { ...tuple(3), legacyId: 'wrong' }, { ...tuple(4), sourceKey: 'android_message_review_source_a0004' }]]) {
    for (const pendingRows of [[], [pending(1)], [pending(1), pending(1)], [pending(1, { id: second.id })],
      [pending(1, { observedAt: NOW + 1 })], [pending(3, { id: first.id })],
      [pending(3, { sourceKey: first.sourceKey })], [pending(1), pending(3, { sourceKey: `ha1t${NOW}` })]]) {
      for (const occupied of [[], [transaction(3, { smsKey: `ha1t${NOW}` })],
        [transaction(3, { smsKey: 'ha1', ts: NOW + 1 })], [transaction(3, { smsKey: `ha1t${NOW}`, ts: NOW + 1 })]]) {
        equivalent(state([transaction(1), transaction(2), ...occupied], pendingRows,
          [tombstone(legacy(1)), tombstone(`ha1t${NOW}`)]), bindings);
      }
    }
  }
});

test('500 randomized binding histories exactly match frozen conflict rules in both input orders', () => {
  let seed = 0x53afe01;
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let round = 0; round < 500; round++) {
    const size = 1 + random(14);
    const bindings = Array.from({ length: size + random(12) }, () => {
      const value = random(size);
      const item = tuple(value, { id: `ari1_${hex(20_000 + random(size))}`,
        sourceKey: `android_message_review_source_a${random(size)}`, observedAt: NOW + random(3) });
      if (random(6) === 0) item.extra = 'reject';
      if (random(10) === 0) item.observedAt = NaN;
      return item;
    });
    const transactions = Array.from({ length: size + random(15) }, (_, i) => transaction(i, {
      smsKey: random(3) ? legacy(random(size)) : `ha${random(size)}t${NOW + random(3)}`, ts: NOW + random(3),
    }));
    const pendingRows = Array.from({ length: random(8) }, () => pending(random(size), {
      ...(random(3) ? {} : { sourceKey: `android_message_review_source_a${random(size)}` }),
      ...(random(3) ? {} : { id: `ari1_${hex(20_000 + random(size))}` }), observedAt: NOW + random(3),
    }));
    const tombstones = Array.from({ length: random(6) }, () => tombstone(random(2) ? legacy(random(size)) : `ha${random(size)}t${NOW + random(3)}`));
    const base = state(transactions, pendingRows, tombstones);
    equivalent(base, bindings);
    equivalent(base, [...bindings].reverse());
  }
});

// Execute the actual reducer switch. No React/native dependencies or unrelated
// actions are evaluated; setReviewTray has no external runtime dependencies.
const storeSource = ts.createSourceFile('store.tsx', read('store.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const reduceNode = storeSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'reduceState');
assert.ok(reduceNode);
const { reduceState } = load(reduceNode.getText(storeSource) + '\nexports.reduceState = reduceState;');
test('setReviewTray uses first update per ID, preserves unrelated rows and applies updates in linear work', () => {
  const transactions = Array.from({ length: 15_000 }, (_, i) => transaction(i));
  let idReads = 0;
  const updates = Array.from({ length: 500 }, (_, i) => ({
    get id() { idReads++; return `row-${i}`; }, smsKey: `ha${i}t${NOW}`,
  }));
  updates.push({ id: 'row-0', smsKey: 'must-not-win' });
  const initial = { ...state(transactions), trustedNotificationPackages: ['com.fixture.existing'] };
  const result = reduceState(initial, { type: 'setReviewTray', reviewTray: initial.reviewTray,
    sourceKeyUpdates: updates, learnedNotificationPackage: 'com.fixture.bank' });
  assert.equal(result.transactions[0].smsKey, `ha0t${NOW}`);
  assert.equal(result.transactions[499].smsKey, `ha499t${NOW}`);
  assert.equal(result.transactions[500], transactions[500]);
  assert.equal(transactions[0].smsKey, legacy(0));
  assert.equal(result.transactions.length, transactions.length);
  assert.deepEqual(result.transactions.map(({ smsKey, ...row }) => row), transactions.map(({ smsKey, ...row }) => row));
  assert.deepEqual(result.trustedNotificationPackages, ['com.fixture.existing', 'com.fixture.bank']);
  assert.ok(idReads <= updates.length * 3, `update ID reads must be linear, got ${idReads}`);
  assert.equal(reduceState(initial, { type: 'setReviewTray', reviewTray: initial.reviewTray }).transactions, transactions);
});
