'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { createLocalReviewAdvisor } = load(path.resolve(__dirname, '../../../src/lib/local-semantic-review.ts'), {
  '@/lib/local-semantic-review-runtime': { evaluateLocalReviewWindow: async () => ({ kind: 'refused', reason: 'model-unavailable' }) },
});
const field = { value: { currency: 'AED', minorUnits: '4500', exponent: 2 }, evidence: 'explicit', alternatives: [] };
const event = { family: 'unknown', decision: 'review', status: 'posted', amount: field, issues: [] };
const item = { id: 'review_test_id_0001', sourceKey: 'source_test_key_01', observedAt: 12, expiresAt: 1e15, kind: 'universal', event };
const suggestion = { kind: 'parser-family-advisory', advisoryOnly: true, family: 'purchase', score: .96, margin: .7, prototypeId: 'parser.family.purchase' };
test('stores advisory separately, binds it to exact event and does not mutate money', async () => {
  const before = JSON.stringify(item);
  const advisor = createLocalReviewAdvisor(async () => suggestion);
  await advisor.enqueue(item, event, 'movement <money>');
  assert.equal(advisor.get(item).family, 'purchase');
  assert.equal(JSON.stringify(item), before);
  assert.equal(advisor.get({ ...item, event: { ...event, direction: 'credit' } }), null);
});
test('unsafe states, absent transaction money and known families never call model', async () => {
  let calls = 0;
  const advisor = createLocalReviewAdvisor(async () => { calls++; return suggestion; });
  for (const change of [{ status: 'failed' }, { status: 'future' }, { family: 'refund' }, { issues: ['settlement-adapter-required'] }, { amount: { evidence: 'missing', value: null, alternatives: [] } }]) {
    await advisor.enqueue(item, { ...event, ...change }, 'movement <money>');
  }
  assert.equal(calls, 0);
});
test('reset cancels pending result and prevents cross-generation reuse', async () => {
  let finish;
  const advisor = createLocalReviewAdvisor(() => new Promise(resolve => { finish = resolve; }));
  const pending = advisor.enqueue(item, event, 'movement <money>');
  await Promise.resolve();
  advisor.clear();
  finish(suggestion);
  await pending;
  assert.equal(advisor.get(item), null);
});
test('failure and uncertainty remain unavailable; expired entries never classify', async () => {
  const advisor = createLocalReviewAdvisor(async () => { throw new Error('offline'); });
  await advisor.enqueue(item, event, 'movement <money>');
  assert.equal(advisor.get(item).kind, 'unavailable');
  assert.equal(await advisor.enqueue({ ...item, expiresAt: 1 }, event, 'movement <money>'), undefined);
});
test('bounds queued inference, serializes work and never retains source in result', async () => {
  let release;
  let active = 0;
  let maximum = 0;
  let calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const advisor = createLocalReviewAdvisor(async () => {
    active++; maximum = Math.max(maximum, active); calls++;
    await gate; active--; return suggestion;
  });
  const jobs = [];
  for (let i = 0; i < 100; i++) jobs.push(advisor.enqueue({ ...item, id: 'review_' + i }, event, 'movement <money>'));
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  await Promise.all(jobs);
  assert.equal(calls, 50);
  assert.equal(maximum, 1);
  assert.ok(!JSON.stringify(advisor.get({ ...item, id: 'review_1' })).includes('<money>'));
});
test('runtime refuses disagreement and offline without requesting a model download', async () => {
  let ready = false;
  let calls = 0;
  let canonicalFamily = 'refund';
  const runtime = load(path.resolve(__dirname, '../../../src/lib/local-semantic-review-runtime.ts'), {
    '@/lib/local-semantic-bundle': { LOCAL_PUBLIC_PARSER_HEAD: {}, LOCAL_CANONICAL_PARSER_INDEX: {} },
    '@/lib/local-semantic-runtime': {
      localSemanticRuntimeStatus: () => ({ state: ready ? 'ready' : 'not-downloaded' }),
      getLocalSemanticEncoder: async () => { calls++; return { manifest: {}, encode: async () => [1, 0] }; },
    },
    '@/lib/local-semantic-model': {
      createLocalParserFamilyClassifier: () => ({}), createLocalSemanticRetriever: () => ({}),
      createLocalParserFamilyHeadAdvisory: async () => suggestion,
      createLocalParserFamilyAdvisory: async () => ({ ...suggestion, family: canonicalFamily }),
    },
  });
  assert.equal((await runtime.evaluateLocalReviewWindow(event, 'redacted', () => false)).kind, 'refused');
  assert.equal(calls, 0);
  ready = true;
  assert.equal((await runtime.evaluateLocalReviewWindow(event, 'redacted', () => false)).kind, 'refused');
  canonicalFamily = 'purchase';
  assert.equal((await runtime.evaluateLocalReviewWindow(event, 'redacted', () => false)).family, 'purchase');
  assert.equal((await runtime.evaluateLocalReviewWindow(event, 'redacted', () => true)).kind, 'refused');
  assert.equal(calls, 2);
});
test('a model informational family can never become an ordinary posting suggestion', async () => {
  const advisor = createLocalReviewAdvisor(async () => ({ ...suggestion, family: 'statement' }));
  await advisor.enqueue(item, event, 'movement <money>');
  assert.equal(advisor.get(item).kind, 'unavailable');
});
