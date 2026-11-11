'use strict';
// A ledger edit replaces the transactions array, so the Transactions screen's
// transfer separation is recomputed on every edit; its answer is almost always
// the same ids. keepEqualSeparation hands back the PREVIOUS object when nothing
// changed (so state, memos and cells downstream skip their second pass) and the
// new one as soon as anything differs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const { keepEqualSeparation, sameTransferSeparation } = load(path.join(root, 'src/lib/transfer-separation.ts'));

const separation = (over = {}) => ({
  separateTransferIds: new Set(['t1', 't2', 't3']),
  reviewTransferIds: new Set(['t3']),
  pendingTransferIds: new Set(['t9']),
  separatedPartnerIds: new Map([['t1', 't2'], ['t2', 't1']]),
  ...over,
});

test('an equal answer in new Sets and a new Map keeps the previous object', () => {
  const previous = separation();
  assert.equal(keepEqualSeparation(previous, separation()), previous);
  assert.equal(sameTransferSeparation(previous, separation()), true);
});

test('the very same object, and no previous answer, are handled', () => {
  const only = separation();
  assert.equal(keepEqualSeparation(only, only), only);
  const first = separation();
  assert.equal(keepEqualSeparation(null, first), first);
  assert.equal(keepEqualSeparation(undefined, first), first);
});

test('any difference in any field returns the new answer', () => {
  const previous = separation();
  const changes = {
    'an id added to the separated rows': { separateTransferIds: new Set(['t1', 't2', 't3', 't4']) },
    'a separated id replaced (same size)': { separateTransferIds: new Set(['t1', 't2', 't5']) },
    'a review id removed': { reviewTransferIds: new Set() },
    'a pending id replaced (same size)': { pendingTransferIds: new Set(['t8']) },
    'a pair added': { separatedPartnerIds: new Map([['t1', 't2'], ['t2', 't1'], ['t3', 't4'], ['t4', 't3']]) },
    'a partner changed (same keys)': { separatedPartnerIds: new Map([['t1', 't3'], ['t2', 't1']]) },
    'a partner key replaced (same size)': { separatedPartnerIds: new Map([['t1', 't2'], ['t9', 't1']]) },
  };
  for (const [label, override] of Object.entries(changes)) {
    const next = separation(override);
    assert.equal(keepEqualSeparation(previous, next), next, label);
    assert.equal(sameTransferSeparation(previous, next), false, label);
  }
});

test('the kept object is the earlier one, so a later change is still compared against what is shown', () => {
  const first = separation();
  const second = keepEqualSeparation(first, separation());
  const third = keepEqualSeparation(second, separation({ reviewTransferIds: new Set(['t3', 't2']) }));
  assert.notEqual(third, first);
  assert.deepEqual([...third.reviewTransferIds].sort(), ['t2', 't3']);
});

test('the Transactions screen keeps the previous separation in both places it is produced', () => {
  const screen = fs.readFileSync(path.join(root, 'src/app/transactions.tsx'), 'utf8');
  assert.match(screen, /import \{ keepEqualSeparation, type TransferSeparation \} from '@\/lib\/transfer-separation';/);
  // The per-ledger cache keeps the earlier value when the recomputed one is equal...
  assert.match(screen, /const value = keepEqualSeparation\(separateTransferCache\?\.value, computed\);\s*separateTransferCache = \{ transactions, accounts, reconciliation, value \};\s*return value;/);
  // ...and the hook's setState bails out on an equal answer.
  assert.match(screen, /setSeparation\(\(previous\) => keepEqualSeparation\(previous, next\)\);/);
  assert.doesNotMatch(screen, /setSeparation\(separationFor\(input, reconciliation\)\)/);
});
