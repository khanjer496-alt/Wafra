'use strict';
/** The tester-triggered inbox shadow pass: bounded, single-flight, ledger-free. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');

function harness({ eventFor = () => ({ decision: 'review' }), dropped = () => 0, store = new Map(), schedule } = {}) {
  const policy = load(path.join(root, 'src/lib/local-semantic-background-policy.ts'));
  policy.setLocalSemanticAppActive(true);
  const queued = [];
  const module = load(path.join(root, 'src/lib/local-semantic-inbox-shadow.ts'), {
    '@/lib/local-semantic-background-policy': policy,
    '@/lib/launch-alert-parser': {
      hasBankAlertMoneyHint: (body) => /AED|USD/.test(body),
      inspectGenericBankEventForReview: (body, sender) => eventFor(body, sender),
    },
    '@/lib/local-semantic-shadow': { queueLocalSemanticParserShadow: (body, event) => queued.push({ body, event }) },
    '@/lib/sms-parser': { nonPostingReason: (body) => (/OTP/.test(body) ? 'security-challenge' : null) },
    '../../modules/sms-reader': {},
    '@react-native-async-storage/async-storage': { __esModule: true, default: {
      getItem: async (key) => store.get(key) ?? null,
      setItem: async (key, value) => { store.set(key, value); },
    } },
  }, schedule ? { setTimeout: schedule } : {});
  return { module, queued, store, policy };
}

const inbox = (count) => Array.from({ length: count }, (_, i) => ({
  id: count - i, date: 1_800_000_000_000 - i * 1000, address: i % 3 === 0 ? 'HSBC' : 'FRIEND',
  body: i % 3 === 0 ? `AED ${i}.00 spent at SHOP ${i}` : i % 3 === 1 ? `hey are you coming ${i}` : `OTP AED 12 code ${i}`,
}));

const readerFor = (rows, calls) => async (beforeDate, beforeId, max) => {
  calls.push({ beforeDate, beforeId, max });
  return rows.filter((r) => r.date < beforeDate || (r.date === beforeDate && r.id < beforeId)).slice(0, max);
};

test('walks the whole inbox newest-first and queues only money-bearing, non-OTP bodies', async () => {
  const { module, queued } = harness();
  const rows = inbox(450); const calls = [];
  const result = await module.runLocalSemanticInboxShadow(readerFor(rows, calls));
  assert.equal(result.state, 'complete');
  assert.equal(result.checked, 450);
  assert.equal(result.eligible, 150);
  assert.equal(queued.length, 150);
  assert.ok(queued.every((q) => /AED/.test(q.body) && !/OTP/.test(q.body)));
  assert.ok(calls.length >= 3);
});

test('respects the check bound and reports it', async () => {
  const { module } = harness();
  const result = await module.runLocalSemanticInboxShadow(readerFor(inbox(1000), []), { maxChecked: 300 });
  assert.equal(result.checked, 300);
});

test('stops as soon as the shadow queue starts dropping', async () => {
  let drops = 0;
  const { module } = harness({ dropped: () => drops });
  const rows = inbox(1000); const calls = [];
  const result = await module.runLocalSemanticInboxShadow(async (b, i, m) => { const p = await readerFor(rows, calls)(b, i, m); drops += 1; return p; }, { queueDropped: () => drops });
  assert.equal(result.state, 'stopped');
  assert.ok(result.checked <= 200);
});

test('a second call while running joins the first instead of starting another walk', async () => {
  const { module } = harness();
  const rows = inbox(400); const calls = [];
  const first = module.runLocalSemanticInboxShadow(readerFor(rows, calls));
  const second = module.runLocalSemanticInboxShadow(readerFor(rows, calls));
  assert.equal(first, second);
  await first;
  assert.equal(module.localSemanticInboxShadowStatus().state, 'complete');
});

test('a reader failure ends the pass as failed without throwing', async () => {
  const { module } = harness();
  const result = await module.runLocalSemanticInboxShadow(async () => { throw new Error('provider'); });
  assert.equal(result.state, 'failed');
});


test('a finished pass is persisted and reported again after a restart', async () => {
  const store = new Map();
  const first = harness({ store });
  await first.module.runLocalSemanticInboxShadow(readerFor(inbox(30), []));
  const second = harness({ store });
  await second.module.hydrateLocalSemanticInboxShadow();
  const status = second.module.localSemanticInboxShadowStatus();
  assert.equal(status.state, 'complete');
  assert.equal(status.checked, 30);
  assert.equal(status.eligible, 10);
});

test('inactive transition cancels within a page before further parsing or reads', async () => {
  let checked = 0;
  const h = harness({ eventFor: () => { if (++checked === 2) h.policy.setLocalSemanticAppActive(false); return { decision: 'review' }; } });
  const calls = [];
  const result = await h.module.runLocalSemanticInboxShadow(readerFor(inbox(400), calls));
  assert.equal(result.state, 'stopped');
  assert.equal(checked, 2);
  assert.equal(calls.length, 1);
  assert.ok(result.checked < 200);
});

test('an existing page honors a cancelled scan before processing its first row', async () => {
  const h = harness();
  const result = await h.module.runLocalSemanticInboxShadow(async () => {
    h.policy.cancelLocalSemanticBackgroundWork();
    return inbox(200);
  });
  assert.equal(result.state, 'stopped');
  assert.equal(result.checked, 0);
  assert.equal(h.queued.length, 0);
});

test('an inactive pass releases single-flight state so a later active QA pass can start', async () => {
  const h = harness();
  h.policy.setLocalSemanticAppActive(false);
  const calls = [];
  assert.equal((await h.module.runLocalSemanticInboxShadow(readerFor(inbox(3), calls))).state, 'stopped');
  assert.equal(calls.length, 0);
  h.policy.setLocalSemanticAppActive(true);
  assert.equal((await h.module.runLocalSemanticInboxShadow(readerFor(inbox(3), calls))).state, 'complete');
  assert.equal(calls.length, 1);
});


test('preprocessing yields after five rows so queued lifecycle cancellation can interrupt a large page', async () => {
  let yields = 0;
  const h = harness({ schedule: callback => {
    yields++;
    h.policy.cancelLocalSemanticBackgroundWork();
    callback();
    return 1;
  } });
  const result = await h.module.runLocalSemanticInboxShadow(readerFor(inbox(200), []));
  assert.equal(result.state, 'stopped');
  assert.ok(result.checked > 0 && result.checked <= 5);
  assert.equal(yields, 1);
});
