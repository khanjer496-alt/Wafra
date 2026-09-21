'use strict';
/**
 * Parser shadow mode over SMS history: windows are queued off the scan path
 * and scored later; nothing here can change an import decision. The queue
 * holds only redacted windows plus the deterministic family.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const bundle = require('../build/local-semantic-bundle.js');
const categories = load(path.join(root, 'src/lib/categories.ts'), {
  '@/lib/i18n': { getLanguage: () => 'en' },
});
const boundary = load(path.join(root, 'src/lib/wafra-assistant-ai.ts'), { '@/lib/categories': categories });
const semantic = load(path.join(root, 'src/lib/local-semantic-model.ts'), { '@/lib/wafra-assistant-ai': boundary });

const manifest = {
  schemaVersion: 1, modelVersion: bundle.LOCAL_CANONICAL_PARSER_INDEX.modelVersion,
  backend: 'onnxruntime-react-native', graphFormat: 'onnx', quantization: 'dynamic-int8',
  embeddingDimensions: 384, maximumCharacters: 1000,
};
const purchaseVector = bundle.LOCAL_CANONICAL_PARSER_INDEX.prototypes.find((row) => row.id === 'parser.family.purchase').vector;

function harness({ state = 'ready', fail = false } = {}) {
  const calls = { encode: [], warm: 0 };
  let runtimeState = state;
  const encoder = { manifest, async encode(text) { calls.encode.push(text); return Float32Array.from(purchaseVector); } };
  const runtime = {
    localSemanticRuntimeStatus: () => ({ state: runtimeState, modelVersion: manifest.modelVersion, error: null }),
    async getLocalSemanticEncoder() {
      calls.warm += 1;
      if (fail) throw new Error('local-semantic-runtime:retry-backoff');
      runtimeState = 'ready';
      return encoder;
    },
  };
  const shadow = load(path.join(root, 'src/lib/local-semantic-shadow.ts'), {
    '@/lib/local-semantic-model': semantic,
    '@/lib/local-semantic-bundle': bundle,
    '@/lib/local-semantic-runtime': runtime,
  });
  return { shadow, calls };
}

const field = (value, span) => ({ evidence: span ? 'explicit' : 'missing', value: value ?? null, alternatives: [], spans: span ? [span] : [], issues: [] });
const source = 'Purchase of AED 87.50 with card ending 4412 at CARREFOUR on 21/09/2026. Available balance AED 1,200.00';
const event = {
  decision: 'review', status: 'posted', family: 'purchase', direction: 'debit', issues: [], observations: [],
  amount: field({ currency: 'AED', minorUnits: '8750', exponent: 2 }, { start: 12, end: 21 }),
  statementTotal: field(), minimumDue: field(), balance: field(null, { start: 90, end: 102 }), creditLimit: field(),
  merchant: field('CARREFOUR', { start: 47, end: 56 }), instrument: field('4412', { start: 39, end: 43 }),
  transactionDate: field('2026-09-21', { start: 60, end: 70 }), dueDate: field(), statementDate: field(),
};

test('the redacted window carries no amount, merchant, card tail or date', () => {
  const { shadow } = harness();
  const window = shadow.buildLocalParserSemanticWindow(source, event);
  assert.ok(window.includes('<money>'), window);
  for (const leak of ['87.50', 'CARREFOUR', '4412', '21/09/2026', '1,200']) assert.ok(!window.includes(leak), `${leak} leaked: ${window}`);
});

test('queued SMS windows are scored later without blocking, and agreement is counted', async () => {
  const { shadow, calls } = harness();
  shadow.queueLocalSemanticParserShadow(source, event);
  shadow.queueLocalSemanticParserShadow(source, event);
  await shadow.flushLocalSemanticParserShadow();
  const snap = shadow.localSemanticShadowSnapshot();
  assert.equal(snap.observed, 2);
  assert.equal(snap.eligible, 2);
  assert.equal(snap.queued, 0);
  assert.equal(snap.queueDropped, 0);
  assert.equal(calls.encode.length, 2);
  assert.equal(snap.deterministicComparable, 2);
  assert.equal(snap.canonicalAccepted, 2);
  assert.equal(snap.canonicalDeterministicAgreement, 2);
  assert.equal(snap.byCanonicalFamily.purchase, 2);
  for (const text of calls.encode) assert.ok(!text.includes('CARREFOUR') && !text.includes('87.50'));
});

test('a runtime that is not ready is warmed by the drain and every queued window is still scored', async () => {
  const { shadow, calls } = harness({ state: 'not-downloaded' });
  for (let i = 0; i < 5; i += 1) shadow.queueLocalSemanticParserShadow(source, event);
  await shadow.flushLocalSemanticParserShadow();
  assert.ok(calls.warm >= 1);
  assert.equal(calls.encode.length, 5);
  assert.equal(shadow.localSemanticShadowSnapshot().modelUnavailable, 0);
});

test('a failed or backing-off runtime releases the queue and counts it unavailable', async () => {
  const { shadow, calls } = harness({ state: 'failed', fail: true });
  for (let i = 0; i < 3; i += 1) shadow.queueLocalSemanticParserShadow(source, event);
  await shadow.flushLocalSemanticParserShadow();
  const snap = shadow.localSemanticShadowSnapshot();
  assert.equal(snap.modelUnavailable, 3);
  assert.equal(snap.queued, 0);
  assert.equal(calls.encode.length, 0);
});

test('ineligible events (non-review, missing money) are observed but never queued', async () => {
  const { shadow, calls } = harness();
  shadow.queueLocalSemanticParserShadow(source, { ...event, decision: 'ignore' });
  shadow.queueLocalSemanticParserShadow(source, { ...event, amount: field() });
  await shadow.flushLocalSemanticParserShadow();
  const snap = shadow.localSemanticShadowSnapshot();
  assert.equal(snap.observed, 2);
  assert.equal(snap.eligible, 0);
  assert.equal(calls.encode.length, 0);
});
