'use strict';
// The All-time Transactions list asks up to five transfer questions of every row in each of two passes (the
// transfer-id sweep and the projection). Outside a pass each question re-ran the row's regex checks; inside
// withTransferRowCache the verdict is computed once per row object and dropped when the pass ends.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { core, ledger } = require('./load-transfer-ledger.cjs');

const root = path.resolve(__dirname, '../../..');
const NOW = Date.parse('2026-09-08T10:00:00Z');

/** A row whose `title` reads are counted: the transfer verdict reads it, so reads measure verdict work. */
function countedRow(id, title = 'Carrefour') {
  let reads = 0;
  const row = { id, accountId: 'bank', type: 'expense', amountFils: 10000, category: 'groceries',
    source: 'sms', date: '2026-09-08', ts: NOW };
  Object.defineProperty(row, 'title', { enumerable: true, get() { reads += 1; return title; }, set(value) { title = value; } });
  return { row, reads: () => reads, reset: () => { reads = 0; } };
}

const askFiveQuestions = (row) => {
  ledger.isTransfer(row); core.isTransferCandidate(row); core.transferDeclined(row);
  ledger.isTransfer(row); core.isTransferCandidate(row);
};

test('outside a pass every question redoes the row work; inside the row cache the verdict is computed once', () => {
  const plain = countedRow('plain');
  askFiveQuestions(plain.row);
  const outside = plain.reads();
  assert.ok(outside > 1, `without a pass the title is read again for each question (${outside})`);

  const cached = countedRow('cached');
  core.withTransferRowCache(() => askFiveQuestions(cached.row));
  const inside = cached.reads();
  assert.ok(inside < outside, `a pass reads it fewer times (${inside} < ${outside})`);
  const single = countedRow('single');
  core.withTransferRowCache(() => core.isTransferCandidate(single.row));
  assert.equal(inside, single.reads(), 'five questions cost what one question costs');
});

test('the verdict never outlives the pass: a row changed afterwards is judged afresh', () => {
  const probe = countedRow('probe', 'Coffee');
  core.withTransferRowCache(() => assert.equal(core.isTransferCandidate(probe.row), false));
  probe.reset();
  probe.row.title = 'Transfer to my savings account';
  probe.row.transferEvidence = undefined;
  const after = core.isTransferCandidate(probe.row);
  assert.ok(probe.reads() >= 1, 'a new call outside the pass recomputes from the row, not from the finished pass');
  const fresh = countedRow('fresh', 'Transfer to my savings account');
  assert.equal(after, core.withTransferRowCache(() => core.isTransferCandidate(fresh.row)), 'same answer as a clean pass on the changed row');
});

test('a nested pass reuses the outer one and the cache is gone after an exception', () => {
  const nested = countedRow('nested');
  core.withTransferRowCache(() => { core.isTransferCandidate(nested.row); core.withTransferRowCache(() => core.isTransferCandidate(nested.row)); });
  const once = nested.reads();
  const single = countedRow('once');
  core.withTransferRowCache(() => core.isTransferCandidate(single.row));
  assert.equal(once, single.reads(), 'the inner pass shares the outer memo');
  assert.throws(() => core.withTransferRowCache(() => { throw new Error('boom'); }), /boom/);
  const after = countedRow('after');
  core.isTransferCandidate(after.row); core.isTransferCandidate(after.row);
  assert.ok(after.reads() >= 2, 'a throwing pass leaves no memo behind');
});

test('the Transactions screen runs both whole-ledger passes inside the row cache', () => {
  const screen = fs.readFileSync(path.join(root, 'src/app/transactions.tsx'), 'utf8');
  assert.match(screen, /const kindNeedsIds = appliedFilters\.kind === 'transfers' \|\| appliedFilters\.kind === 'review';/);
  assert.match(screen, /const \{ transferIds, reviewIds \} = useMemo\(\(\) => !kindNeedsIds \? \{ transferIds: NO_IDS, reviewIds: NO_IDS \} : withTransferRowCache\(\(\) => \{/);
  assert.match(screen, /\}\), \[kindNeedsIds, state\.transactions, internal, separateTransferIds, pendingTransferIds\]\);/);
  assert.match(screen, /const projection = useMemo\(\(\) => withTransferRowCache\(\(\) => projectTransactionFilter\(filterIndex, appliedFilters, filterOptions\)\)/);
  assert.match(screen, /withTransferRowCache \} from '@\/lib\/transfer-reconciliation'/);
});

test('only the Transfers and Needs review chips read the transfer-id sets', () => {
  const filter = fs.readFileSync(path.join(root, 'src/lib/transaction-filter.ts'), 'utf8');
  const readers = [...filter.matchAll(/options\.(transferIds|reviewIds)/g)].map((m) => m[0]);
  assert.deepEqual(readers, ['options.transferIds', 'options.reviewIds']);
  assert.match(filter, /kind === 'transfers' && !options\.transferIds\?\.has/);
  assert.match(filter, /kind === 'review' && !options\.reviewIds\?\.has/);
});
