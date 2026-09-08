'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const load = require('../repair/load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const journey = load(path.join(root, 'src/lib/ios-setup-journey.ts'));
const history = load(path.join(root, 'src/lib/ios-history-traversal.ts'));
const account = (id, bankName, extra = {}) => ({ id, bankName, ...extra });
const row = (accountId, source = 'sms') => ({ accountId, source });

test('native no-input proof does not imply that a Message automation was configured', () => {
  assert.equal(journey.futureSetupConfigured('shortcut-proven', false), false);
  assert.equal(journey.futureSetupConfigured('not-added', true), false);
  assert.equal(journey.futureSetupConfigured('shortcut-proven', true), true);
  assert.equal(journey.futureSetupConfigured('first-alert-captured', true), true);
});
test('bank guidance comes only from stored bank identity with SMS transactions', () => {
  const actual = journey.detectedSetupBanks([
    account('a', 'FAB'), account('b', 'FAB'), account('c', 'ENBD'),
    account('d', 'ADCB', { archived: true }), account('e', undefined, { name: 'Guess Bank' }),
  ], [row('a'), row('b'), row('c', 'manual'), row('d'), row('e')]);
  assert.deepEqual([...actual], ['FAB']);
});
test('empty or unusual bank names cannot add controls or unbounded display text', () => {
  assert.deepEqual([...journey.detectedSetupBanks([
    account('a', ' '), account('b', 'Bad\u202eBank'), account('c', 'x'.repeat(101)),
  ], [row('a'), row('b'), row('c')])], []);
});
test('guidance is translated, is not a bank picker, and retains the history-capability caveat', () => {
  for (const language of ['en', 'ar']) {
    const copy = journey.iosSetupJourneyCopy(language);
    for (const value of Object.values(copy)) assert.ok(typeof value === 'string' && value.length > 0);
  }
  assert.notEqual(journey.iosSetupJourneyCopy('en').intro, journey.iosSetupJourneyCopy('ar').intro);
  assert.match(journey.iosSetupJourneyCopy('en').historyRequest, /coverage/);
  const screen = fs.readFileSync(path.join(root, 'src/app/ios-setup.tsx'), 'utf8');
  assert.ok(screen.indexOf("title={t('iosMessagePastTitle')}") < screen.indexOf("title={t('iosMessageFutureTitle')}"));
  assert.match(screen, /canFinishIosMessageSetup\(progress, setup\.readiness\)/);
});

function providerFor(rows) {
  const source = [...rows].sort((a, b) => b.receivedAtMs - a.receivedAtMs);
  const state = { stored: null, events: new Map(), commits: [], current: true, reads: 0 };
  const provider = {
    verifiedRangeContract: true,
    isCurrent: () => state.current,
    async read(window, limit) {
      state.reads++;
      const matches = source.filter((r) => r.receivedAtMs >= window.fromMs && r.receivedAtMs < window.untilMs);
      return { records: matches.slice(0, limit), exhaustive: matches.length <= limit };
    },
    async saveCheckpoint(next) { state.stored = structuredClone(next); },
    async commitPage(records, next) {
      for (const record of records) state.events.set(record.id, record);
      state.commits.push({ ids: records.map(r => r.id), coveredFromMs: next.coveredFromMs });
      state.stored = structuredClone(next);
    },
  };
  return { provider, state };
}
const runAll = async (provider, plan, options) => {
  let result;
  do { result = await history.traverseHistory(provider, plan, options); plan = result.checkpoint; }
  while (result.status === 'paused');
  return result;
};

test('no 30-day or 2,999-message ceiling: 12,000 messages over two years, newest batches first', async () => {
  const day = 86400000, start = Date.UTC(2024, 0, 1), end = start + 730 * day;
  const rows = Array.from({ length: 12000 }, (_, i) => ({ id: String(i), receivedAtMs: start + i * Math.floor(730 * day / 12000) }));
  const { provider, state } = providerFor(rows);
  const result = await runAll(provider, history.beginHistoryTraversal({ fromMs: start, untilMs: end }), { pageRecords: 50, maxQueries: 64 });
  assert.equal(result.status, 'complete'); assert.equal(state.events.size, 12000);
  assert.equal(result.checkpoint.checkedRecords, 12000);
  assert.equal(result.checkpoint.coveredFromMs, start);
  for (let i = 1; i < state.commits.length; i++) assert.ok(state.commits[i].coveredFromMs < state.commits[i - 1].coveredFromMs);
});
test('a query budget pauses without inventing completed coverage; persisted checkpoint resumes', async () => {
  const { provider, state } = providerFor(Array.from({ length: 200 }, (_, i) => ({ id: String(i), receivedAtMs: i })));
  const first = await history.traverseHistory(provider, history.beginHistoryTraversal({ fromMs: 0, untilMs: 200 }), { maxQueries: 3 });
  assert.equal(first.status, 'paused'); assert.ok(first.checkpoint.pending.length);
  const final = await runAll(provider, state.stored, { maxQueries: 3 });
  assert.equal(final.status, 'complete'); assert.equal(state.events.size, 200);
});
test('a dense same-millisecond boundary blocks instead of dropping the overflow', async () => {
  const { provider, state } = providerFor(Array.from({ length: 51 }, (_, i) => ({ id: String(i), receivedAtMs: 100 })));
  const result = await runAll(provider, history.beginHistoryTraversal({ fromMs: 0, untilMs: 200 }));
  assert.equal(result.status, 'blocked'); assert.equal(result.reason, 'dense-boundary');
  assert.equal(state.events.size, 0); assert.ok(result.checkpoint.pending.length);
});
test('date-boundary events appear exactly once and arrivals beyond the frozen snapshot are excluded', async () => {
  const rows = [0, 24, 25, 49, 50, 74, 75, 99, 100].map(n => ({ id: String(n), receivedAtMs: n }));
  const { provider, state } = providerFor(rows);
  const result = await runAll(provider, history.beginHistoryTraversal({ fromMs: 0, untilMs: 100 }), { pageRecords: 2 });
  assert.equal(result.status, 'complete'); assert.deepEqual([...state.events.keys()].sort(), rows.slice(0, -1).map(r => r.id).sort());
});
test('an unverified provider is not called; unknown truncation cannot claim completion', async () => {
  const { provider, state } = providerFor([]); provider.verifiedRangeContract = false;
  const plan = history.beginHistoryTraversal({ fromMs: 0, untilMs: 1 });
  assert.equal((await history.traverseHistory(provider, plan)).reason, 'unverified-provider');
  assert.equal(state.reads, 0);
  provider.verifiedRangeContract = true;
  provider.read = async () => ({ records: [], exhaustive: false });
  assert.equal((await history.traverseHistory(provider, plan)).reason, 'dense-boundary');
});
test('out-of-window, unsorted, duplicate or excessive provider records are rejected', async () => {
  for (const records of [
    [{ id: 'x', receivedAtMs: 10 }],
    [{ id: 'a', receivedAtMs: 1 }, { id: 'b', receivedAtMs: 2 }],
    [{ id: 'x', receivedAtMs: 2 }, { id: 'x', receivedAtMs: 1 }],
    Array.from({ length: 52 }, (_, i) => ({ id: String(i), receivedAtMs: 1 })),
  ]) {
    const { provider, state } = providerFor([]); provider.read = async () => ({ records, exhaustive: true });
    assert.equal((await history.traverseHistory(provider, history.beginHistoryTraversal({ fromMs: 0, untilMs: 10 }))).reason, 'invalid-page');
    assert.equal(state.events.size, 0);
  }
});
test('failed storage never advances progress and replay uses event identity', async () => {
  const { provider, state } = providerFor([{ id: 'a', receivedAtMs: 1 }]);
  const plan = history.beginHistoryTraversal({ fromMs: 0, untilMs: 10 });
  const commit = provider.commitPage; provider.commitPage = async () => { throw new Error('private-error'); };
  const failed = await history.traverseHistory(provider, plan);
  assert.equal(failed.reason, 'write-failed'); assert.deepEqual(failed.checkpoint, plan);
  provider.commitPage = commit; await history.traverseHistory(provider, failed.checkpoint);
  await history.traverseHistory(provider, plan);
  assert.equal(state.events.size, 1);
});
test('cancellation after reading does not commit or move a checkpoint', async () => {
  const { provider, state } = providerFor([{ id: 'a', receivedAtMs: 1 }]);
  const read = provider.read; provider.read = async (...args) => { const result = await read(...args); state.current = false; return result; };
  const plan = history.beginHistoryTraversal({ fromMs: 0, untilMs: 10 });
  const result = await history.traverseHistory(provider, plan);
  assert.equal(result.status, 'paused'); assert.deepEqual(result.checkpoint, plan); assert.equal(state.events.size, 0);
});
test('corrupt checkpoint gaps cannot masquerade as a completed range', () => {
  const plan = history.beginHistoryTraversal({ fromMs: 0, untilMs: 10 });
  assert.equal(history.validHistoryTraversal({ ...plan, pending: [] }), false);
  assert.equal(history.validHistoryTraversal({ ...plan, pending: [{ fromMs: 1, untilMs: 10 }] }), false);
});
test('persisted checkpoint contains no message bodies, senders or message identifiers', async () => {
  const { provider, state } = providerFor([{ id: 'sensitive-id', receivedAtMs: 1, body: 'secret-body', sender: 'secret-sender' }]);
  await history.traverseHistory(provider, history.beginHistoryTraversal({ fromMs: 0, untilMs: 10 }));
  const saved = JSON.stringify(state.stored);
  assert.doesNotMatch(saved, /sensitive-id|secret-body|secret-sender|body|sender/);
});

test('checkpoint metadata rejects unexpected source-bearing fields', () => {
  const plan = history.beginHistoryTraversal({ fromMs: 0, untilMs: 10 });
  assert.equal(history.validHistoryTraversal({ ...plan, body: 'private' }), false);
  assert.equal(history.validHistoryTraversal({ ...plan, scope: { ...plan.scope, sender: 'private' } }), false);
});
test('a split checkpoint write failure also preserves the original traversal boundary', async () => {
  const { provider } = providerFor(Array.from({ length: 51 }, (_, i) => ({ id: String(i), receivedAtMs: i })));
  provider.saveCheckpoint = async () => { throw new Error('private-storage-error'); };
  const plan = history.beginHistoryTraversal({ fromMs: 0, untilMs: 100 });
  const result = await history.traverseHistory(provider, plan);
  assert.equal(result.reason, 'write-failed'); assert.deepEqual(result.checkpoint, plan);
});
