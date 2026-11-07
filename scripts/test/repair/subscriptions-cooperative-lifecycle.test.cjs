const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const pure = require('../../universal-test/load-ts.cjs').createLoader();

const today = new Date('2026-11-07T12:00:00Z');
const rows = () => Array.from({ length: 512 }, (_, i) => ({
  id: `synthetic-${i}`, title: `Shop ${i}`, category: 'shopping', type: 'expense',
  amountFils: 1000, date: '2026-10-01', accountId: 'bank',
}));

function harness() {
  let clock = 0;
  const queue = [];
  class SliceClock extends Date { static now() { clock += 10; return clock; } }
  const subscriptions = load(path.resolve(__dirname, '../../../src/lib/subscriptions.ts'), {
    '@/lib/format': pure('@/lib/format'), '@/lib/ledger': pure('@/lib/ledger'),
    '@/lib/foreground-history-priority': {
      waitForForegroundHistoryIdle: () => ({ then: (success, failure) => { queue.push({ success, failure }); } }),
    },
  }, { Date: SliceClock });
  const drain = async (rejectWait = false) => {
    const escaped = [];
    for (let turns = 0; queue.length; turns++) {
      assert.ok(turns < 100, 'the bounded synthetic projection must settle');
      const next = queue.shift();
      try {
        if (rejectWait) {
          rejectWait = false;
          if (!next.failure) throw new Error('missing scheduling rejection handler');
          next.failure(new Error('synthetic scheduling failure'));
        } else next.success();
      } catch (error) { escaped.push(error.message); }
    }
    await new Promise(resolve => setImmediate(resolve));
    return escaped;
  };
  return { subscriptions, drain, queue };
}

test('an asynchronous projection failure rejects every waiter and permits a fresh retry', async () => {
  const { subscriptions: s, drain } = harness();
  const input = rows(), dismissed = [];
  let poisoned = true;
  Object.defineProperty(input[180], 'title', { get() {
    if (poisoned) throw new Error('synthetic worker failure');
    return 'Shop 180';
  } });
  const results = [];
  const watch = promise => promise.then(() => results.push('resolved'), error => results.push(error.message));
  watch(s.detectSubscriptionsCooperatively(input, dismissed, today));
  watch(s.detectSubscriptionsCooperatively(input, dismissed, today));
  assert.deepEqual(await drain(), [], 'a later slice must reject its owned promise, not escape');
  assert.deepEqual(results, ['synthetic worker failure', 'synthetic worker failure']);
  assert.equal(s.subscriptionDetectionRunning(input, dismissed, today), false);
  poisoned = false;
  let retried;
  s.detectSubscriptionsCooperatively(input, dismissed, today).then(value => { retried = value; });
  assert.deepEqual(await drain(), []);
  assert.ok(Array.isArray(retried));
});

test('a rejected yield settles the query and does not poison the in-flight cache', async () => {
  const { subscriptions: s, drain } = harness();
  const input = rows(), dismissed = [];
  let failure;
  s.detectSubscriptionsCooperatively(input, dismissed, today).catch(error => { failure = error.message; });
  assert.deepEqual(await drain(true), []);
  assert.equal(failure, 'synthetic scheduling failure');
  assert.equal(s.subscriptionDetectionRunning(input, dismissed, today), false);
});

test('a finished empty projection is cached without a phantom in-flight job', async () => {
  const { subscriptions: s } = harness();
  const input = [], dismissed = [];
  const result = s.detectSubscriptionsCooperatively(input, dismissed, today);
  assert.equal(s.subscriptionDetectionRunning(input, dismissed, today), false);
  assert.deepEqual(Array.from(await result), []);
  assert.deepEqual(Array.from(s.peekSubscriptionDetection(input, dismissed, today)), []);
});

test('a cancelled view cannot cancel the shared projection still wanted by another caller', async () => {
  const { subscriptions: s, drain } = harness();
  const input = rows(), dismissed = [];
  let cancelled = false, left, right;
  s.detectSubscriptionsCooperatively(input, dismissed, today, undefined, undefined, () => cancelled).then(value => { left = value; });
  s.detectSubscriptionsCooperatively(input, dismissed, today).then(value => { right = value; });
  cancelled = true;
  assert.deepEqual(await drain(), []);
  assert.equal(left, null);
  assert.ok(Array.isArray(right));
});

test('a superseded projection with no remaining caller stops without caching a stale answer', async () => {
  const { subscriptions: s, drain } = harness();
  const input = rows(), next = rows(), dismissed = [];
  let cancelled = false, oldResult, newResult;
  s.detectSubscriptionsCooperatively(input, dismissed, today, undefined, undefined, () => cancelled).then(value => { oldResult = value; });
  cancelled = true;
  s.detectSubscriptionsCooperatively(next, dismissed, today).then(value => { newResult = value; });
  assert.deepEqual(await drain(), []);
  assert.equal(oldResult, null);
  assert.equal(s.peekSubscriptionDetection(input, dismissed, today), null);
  assert.ok(Array.isArray(newResult));
});

test('normal cooperative detection retains the synchronous recurring-charge result', async () => {
  const { subscriptions: s, drain } = harness();
  const input = rows().concat(['2026-09-01', '2026-10-01', '2026-11-01'].map((date, i) => ({
    id: `recurring-${i}`, title: 'Netflix', category: 'entertainment', type: 'expense',
    amountFils: 4900, date, accountId: 'bank',
  })));
  const expected = s.detectSubscriptions([...input], [], today);
  let actual;
  s.detectSubscriptionsCooperatively(input, [], today).then(value => { actual = value; });
  assert.deepEqual(await drain(), []);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  assert.ok(actual.some(row => row.title === 'Netflix'));
});
