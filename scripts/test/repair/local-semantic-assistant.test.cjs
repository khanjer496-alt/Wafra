'use strict';
/**
 * Ask Wafra's on-device semantic fallback (`local-semantic-assistant.native.ts`).
 *
 * The model may only run when the deterministic planner produced exact plain
 * Help for a fresh question, and it may only pick a closed app-owned tool that
 * the production request validator accepts. Every other path returns the
 * deterministic request unchanged, including runtime-not-ready and any throw.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const categories = load(path.join(root, 'src/lib/categories.ts'), {
  '@/lib/i18n': { getLanguage: () => 'en' },
});
const boundary = load(path.join(root, 'src/lib/wafra-assistant-ai.ts'), {
  '@/lib/categories': categories,
});
const semantic = load(path.join(root, 'src/lib/local-semantic-model.ts'), {
  '@/lib/wafra-assistant-ai': boundary,
});

const manifest = {
  schemaVersion: 1,
  modelVersion: 'e5-test@0000',
  backend: 'onnxruntime-react-native',
  graphFormat: 'onnx',
  quantization: 'dynamic-int8',
  embeddingDimensions: 4,
  maximumCharacters: 1000,
};
const index = {
  schemaVersion: 1,
  modelVersion: manifest.modelVersion,
  embeddingDimensions: 4,
  scoreScale: 'raw-cosine',
  aggregation: 'max-per-prototype-id',
  prototypes: [
    { id: 'ask.spending.total.current-month', domain: 'assistant-intent', vector: [1, 0, 0, 0] },
    { id: 'ask.subscriptions.active', domain: 'assistant-intent', vector: [0, 1, 0, 0] },
    { id: 'ask.help', domain: 'assistant-intent', vector: [0, 0, 1, 0] },
  ],
};

const period = { mode: 'month', key: '2026-08' };
const currentPeriod = { mode: 'month', key: '2026-09' };

function harness({ state = 'ready', vectors = {}, encodeThrows = false } = {}) {
  const calls = { encode: [], warm: 0 };
  const encoder = {
    manifest,
    async encode(text) {
      calls.encode.push(text);
      if (encodeThrows) throw new Error('boom');
      return vectors[text] ?? [0, 0, 0, 0];
    },
  };
  const runtime = {
    localSemanticRuntimeStatus: () => ({ state, modelVersion: manifest.modelVersion, error: null }),
    getLocalSemanticEncoder: async () => { calls.warm += 1; return encoder; },
  };
  const module = load(path.join(root, 'src/lib/local-semantic-assistant.native.ts'), {
    '@/lib/local-semantic-bundle': { LOCAL_ASSISTANT_PROTOTYPE_INDEX: index },
    '@/lib/local-semantic-model': semantic,
    '@/lib/local-semantic-runtime': runtime,
  });
  return { improve: module.improveAssistantRequestLocally, calls };
}

const help = { tool: 'help' };

test('a deterministic non-help plan is authoritative and never reaches the model', async () => {
  const { improve, calls } = harness();
  const deterministic = { tool: 'spending-total', period };
  const out = await improve({ question: 'how much did I spend', deterministicRequest: deterministic, defaultPeriod: period, currentPeriod });
  assert.equal(out, deterministic);
  assert.equal(calls.encode.length, 0);
});

test('conversation follow-ups keep the deterministic plan', async () => {
  const { improve, calls } = harness();
  const out = await improve({ question: 'and last month?', deterministicRequest: help, previousRequest: { tool: 'spending-total', period }, defaultPeriod: period, currentPeriod });
  assert.equal(out, help);
  assert.equal(calls.encode.length, 0);
});

test('a runtime that is not ready returns help unchanged and only warms the encoder', async () => {
  const { improve, calls } = harness({ state: 'not-downloaded' });
  const out = await improve({ question: 'كم صرفت هذا الشهر', deterministicRequest: help, defaultPeriod: period, currentPeriod });
  assert.equal(out, help);
  assert.equal(calls.encode.length, 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.warm, 1);
});

test('a ready runtime maps a confident closed intent to a compiled, validated tool request', async () => {
  const question = 'كم صرفت هذا الشهر';
  const { improve, calls } = harness({ vectors: { [question]: [0.99, 0.05, 0, 0] } });
  const out = await improve({ question, deterministicRequest: help, defaultPeriod: period, currentPeriod });
  assert.deepEqual(JSON.parse(JSON.stringify(out)), { tool: 'spending-total', period: currentPeriod });
  assert.ok(Object.isFrozen(out));
  assert.deepEqual(calls.encode, [question]);
});

test('a low-margin retrieval falls back to help rather than guessing a tool', async () => {
  const question = 'money stuff';
  const { improve } = harness({ vectors: { [question]: [0.7, 0.7, 0, 0] } });
  const out = await improve({ question, deterministicRequest: help, defaultPeriod: period, currentPeriod });
  assert.equal(out, help);
});

test('an encoder failure is swallowed into the deterministic plan', async () => {
  const { improve } = harness({ encodeThrows: true });
  const out = await improve({ question: 'what are my subscriptions', deterministicRequest: help, defaultPeriod: period, currentPeriod });
  assert.equal(out, help);
});

test('a cancelled question never runs the model', async () => {
  const { improve, calls } = harness();
  const out = await improve({ question: 'subscriptions', deterministicRequest: help, defaultPeriod: period, currentPeriod, cancelled: () => true });
  assert.equal(out, help);
  assert.equal(calls.encode.length, 0);
});

test('the model can never attach money, identifiers or free-form arguments', async () => {
  const question = 'subscriptions';
  const { improve } = harness({ vectors: { [question]: [0, 0.98, 0.02, 0] } });
  const out = await improve({ question, deterministicRequest: help, defaultPeriod: period, currentPeriod });
  assert.deepEqual(JSON.parse(JSON.stringify(out)), { tool: 'subscriptions' });
  assert.deepEqual(Object.keys(out), ['tool']);
});


test('production grounding can reject a confident prototype instead of accepting default arguments', async () => {
  const question = 'subscriptions for a mystery period';
  const { improve } = harness({ vectors: { [question]: [0, 0.98, 0.02, 0] } });
  const clarification = { tool: 'help', clarification: 'Please specify a supported period.' };
  const out = await improve({ question, deterministicRequest: help, defaultPeriod: period, currentPeriod, groundRequest: () => clarification });
  assert.equal(out.tool, 'help');
  assert.equal(out.clarification, clarification.clarification);
});

test('cancellation after retrieval prevents a result from being returned', async () => {
  const question = 'subscriptions';
  const { improve, calls } = harness({ vectors: { [question]: [0, 0.98, 0.02, 0] } });
  const out = await improve({ question, deterministicRequest: help, defaultPeriod: period, currentPeriod, cancelled: () => calls.encode.length > 0 });
  assert.equal(out, help);
});
