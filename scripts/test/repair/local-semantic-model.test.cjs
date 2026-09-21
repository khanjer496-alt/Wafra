'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
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

const documentedRegistry = JSON.parse(fs.readFileSync(path.join(
  root, 'docs/experiments/local-multilingual-encoder/prototype-registry.example.json',
), 'utf8')).prototypes;

const manifest = {
  schemaVersion: 1,
  modelVersion: 'minilm-l4-test@deadbeef',
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
    { id: 'parser.family.purchase', domain: 'parser-family', vector: [0, 0, 1, 0] },
    { id: 'parser.family.refund', domain: 'parser-family', vector: [0, 0, 0, 1] },
  ],
};

const createHarness = (vectors = {}, prototypeIndex = index) => {
  const calls = [];
  const encoder = {
    manifest,
    async encode(text) {
      calls.push(text);
      return vectors[text] ?? [0, 0, 0, 0];
    },
  };
  return { calls, retriever: semantic.createLocalSemanticRetriever(encoder, prototypeIndex) };
};

const parserHead = {
  schemaVersion: 1,
  modelVersion: manifest.modelVersion,
  embeddingDimensions: 4,
  scoreScale: 'softmax-probability',
  kind: 'linear-softmax-parser-family',
  classes: ['purchase', 'refund'],
  weights: [
    [4, 0, 0, 0],
    [0, 4, 0, 0],
  ],
  intercept: [0, 0],
  minimumProbability: 0.6,
  minimumMargin: 0.2,
  trainingEvidence: { privacySafeAnchorRows: 10, personalRowsUsedForTraining: 0 },
};

const createHeadHarness = (vectors = {}, head = parserHead, thresholds) => {
  const calls = [];
  const encoder = {
    manifest,
    async encode(text) {
      calls.push(text);
      return vectors[text] ?? [0, 0, 0, 0];
    },
  };
  return {
    calls,
    classifier: semantic.createLocalParserFamilyClassifier(encoder, head, thresholds),
  };
};

const baseEvent = () => ({
  version: 1,
  decision: 'review',
  family: 'unknown',
  status: 'posted',
  direction: 'debit',
  amount: {
    value: { currency: 'AED', exponent: 2, minorUnits: '2500' },
    evidence: 'explicit', spans: [{ start: 9, end: 18 }], alternatives: [], issues: [],
  },
  statementTotal: { value: null, evidence: 'missing', spans: [], alternatives: [], issues: [] },
  minimumDue: { value: null, evidence: 'missing', spans: [], alternatives: [], issues: [] },
  balance: { value: null, evidence: 'missing', spans: [], alternatives: [], issues: [] },
  creditLimit: { value: null, evidence: 'missing', spans: [], alternatives: [], issues: [] },
  merchant: { value: 'Cafe', evidence: 'explicit', spans: [{ start: 22, end: 26 }], alternatives: [], issues: [] },
  transactionDate: { value: null, evidence: 'missing', spans: [], alternatives: [], issues: [] },
  dueDate: { value: null, evidence: 'missing', spans: [], alternatives: [], issues: [] },
  statementDate: { value: null, evidence: 'missing', spans: [], alternatives: [], issues: [] },
  instrument: { value: null, evidence: 'missing', spans: [], alternatives: [], issues: [] },
  observations: [],
  issues: [],
});

test('typed registry stays identical to the reviewed experiment registry', () => {
  assert.equal(JSON.stringify(semantic.LOCAL_SEMANTIC_REGISTRY), JSON.stringify(documentedRegistry));
});

test('ONNX INT8 retriever rejects mismatched or unregistered prototype assets', () => {
  const encoder = { manifest, encode: async () => [1, 0, 0, 0] };
  assert.throws(() => semantic.createLocalSemanticRetriever(encoder, {
    ...index, modelVersion: 'other-version',
  }), /prototype-index-mismatch/);
  assert.throws(() => semantic.createLocalSemanticRetriever(encoder, {
    ...index, scoreScale: 'normalized-cosine',
  }), /prototype-index-mismatch/);
  assert.throws(() => semantic.createLocalSemanticRetriever(encoder, {
    ...index,
    prototypes: [...index.prototypes.slice(0, 3), {
      id: 'ask.hidden.amount-extractor', domain: 'assistant-intent', vector: [0, 0, 0, 1],
    }],
  }), /unregistered-prototype/);
  assert.throws(() => semantic.createLocalSemanticRetriever({
    manifest: { ...manifest, backend: 'javascript' }, encode: async () => [1, 0, 0, 0],
  }, index), /unsupported-runtime/);
  assert.throws(() => semantic.createLocalSemanticRetriever({
    manifest: { ...manifest, modelVersion: 7 }, encode: async () => [1, 0, 0, 0],
  }, { ...index, modelVersion: 7 }), /invalid-model-version/);
});

test('public-only parser head rejects mismatched, malformed, or personal-trained assets', () => {
  const encoder = { manifest, encode: async () => [1, 0, 0, 0] };
  for (const head of [
    { ...parserHead, modelVersion: 'other-version' },
    { ...parserHead, embeddingDimensions: 3 },
    { ...parserHead, classes: ['purchase', 'hidden-family'] },
    { ...parserHead, classes: ['purchase', 'purchase'] },
    { ...parserHead, weights: [[4, 0], [0, 4]] },
    { ...parserHead, intercept: [0] },
    { ...parserHead, minimumProbability: 1.1 },
    { ...parserHead, trainingEvidence: { privacySafeAnchorRows: 10, personalRowsUsedForTraining: 1 } },
  ]) {
    assert.throws(
      () => semantic.createLocalParserFamilyClassifier(encoder, head),
      /invalid-parser-family-head/,
    );
  }
});

test('public-only parser head returns only a gated closed semantic family', async () => {
  const safeText = 'Purchase <field> at <field> with card <digits>';
  const { classifier } = createHeadHarness({ [safeText]: [1, 0, 0, 0] });
  const candidate = await classifier.classify(safeText);
  assert.equal(candidate.family, 'purchase');
  assert.ok(candidate.probability > 0.98);
  assert.ok(candidate.runnerUpProbability < 0.02);
  assert.deepEqual(Object.keys(candidate).sort(), [
    'family', 'probability', 'runnerUpProbability', 'v',
  ]);

  const ambiguous = createHeadHarness({ ambiguous: [1, 1, 0, 0] }).classifier;
  assert.equal(await ambiguous.classify('ambiguous'), null,
    'low-margin head results must fail closed');

  const tightened = createHeadHarness(
    { safe: [1, 0, 0, 0] }, parserHead,
    { minimumProbability: 0.9999, minimumMargin: 0.99 },
  ).classifier;
  assert.equal(await tightened.classify('safe'), null,
    'runtime callers may tighten but not bypass the head-owned gate');
});

test('retrieval ranks only app-owned prototypes inside the requested domain', async () => {
  const { retriever } = createHarness({ spend: [0.99, 0.05, 0.01, 0] });
  const candidate = await retriever.retrieve('assistant-intent', 'spend');
  assert.equal(candidate.prototypeId, 'ask.spending.total.current-month');
  assert.ok(candidate.score > 0.99);
  assert.ok(candidate.runnerUpScore < 0.1);
  assert.deepEqual(Object.keys(candidate).sort(), ['prototypeId', 'runnerUpScore', 'score', 'v']);
});

test('multiple seed vectors aggregate by prototype ID before computing the margin', async () => {
  const multiSeedIndex = {
    ...index,
    prototypes: [
      { id: 'ask.spending.total.current-month', domain: 'assistant-intent', vector: [1, 0, 0, 0] },
      { id: 'ask.spending.total.current-month', domain: 'assistant-intent', vector: [0, 0, 1, 0] },
      { id: 'ask.subscriptions.active', domain: 'assistant-intent', vector: [0, 1, 0, 0] },
    ],
  };
  const { retriever } = createHarness({ paraphrase: [0, 0, 1, 0] }, multiSeedIndex);
  const candidate = await retriever.retrieve('assistant-intent', 'paraphrase');
  assert.equal(candidate.prototypeId, 'ask.spending.total.current-month');
  assert.equal(candidate.score, 1);
  assert.equal(candidate.runnerUpScore, 0,
    'the runner-up must be a different intent, not another spending seed vector');
});

test('Ask Wafra uses semantic fallback only for exact plain help on a fresh turn', async () => {
  const arabic = 'كم صرفت هذا الشهر؟';
  const { calls, retriever } = createHarness({ [arabic]: [0.99, 0.03, 0, 0] });
  const result = await semantic.chooseLocalSemanticAssistantPlan({
    question: arabic,
    deterministicRequest: { tool: 'help' },
    previousRequest: null,
    defaultPeriod: { mode: 'month', key: '2026-08' },
    currentPeriod: { mode: 'month', key: '2026-09' },
    retriever,
  });
  assert.equal(result.source, 'local-semantic');
  assert.equal(JSON.stringify(result.request), JSON.stringify({
    tool: 'spending-total', period: { mode: 'month', key: '2026-09' },
  }));
  assert.deepEqual(calls, [arabic]);

  const clarification = await semantic.chooseLocalSemanticAssistantPlan({
    question: 'Show spending over AED 500',
    deterministicRequest: { tool: 'help', clarification: 'Unsupported threshold condition.' },
    previousRequest: null,
    defaultPeriod: { mode: 'month', key: '2026-09' },
    currentPeriod: { mode: 'month', key: '2026-09' },
    retriever,
  });
  assert.equal(clarification.source, 'deterministic');
  assert.equal(clarification.fallbackReason, 'deterministic-plan-authoritative');
  assert.deepEqual(calls, [arabic], 'safety clarifications must not call the model');

  const contextual = await semantic.chooseLocalSemanticAssistantPlan({
    question: arabic,
    deterministicRequest: { tool: 'help' },
    previousRequest: { tool: 'subscriptions' },
    defaultPeriod: { mode: 'month', key: '2026-09' },
    currentPeriod: { mode: 'month', key: '2026-09' },
    retriever,
  });
  assert.equal(contextual.source, 'deterministic');
  assert.equal(contextual.fallbackReason, 'conversation-context-present');
  assert.deepEqual(calls, [arabic], 'contextual questions stay with the deterministic resolver');
});

test('candidate gates reject hidden fields and ambiguous similarity margins', async () => {
  assert.equal(
    JSON.stringify(semantic.gateLocalSemanticCandidate({
      v: 1, prototypeId: 'ask.subscriptions.active', score: 0.95, runnerUpScore: 0.2, amountFils: 100,
    }, 'assistant-intent')),
    JSON.stringify({ kind: 'refused', reason: 'malformed-candidate' }),
  );
  assert.equal(semantic.gateLocalSemanticCandidate({
    v: 1, prototypeId: 'ask.subscriptions.active', score: 0.6, runnerUpScore: 0.4,
  }, 'assistant-intent', { minimumScore: 0.1, minimumMargin: 0 }).reason, 'low-score',
  'callers may tighten the gate but cannot lower app-owned defaults');

  const { retriever } = createHarness({ ambiguous: [1, 0.95, 0, 0] });
  const result = await semantic.chooseLocalSemanticAssistantPlan({
    question: 'ambiguous', deterministicRequest: { tool: 'help' }, previousRequest: null,
    defaultPeriod: { mode: 'month', key: '2026-09' },
    currentPeriod: { mode: 'month', key: '2026-09' }, retriever,
  });
  assert.equal(result.source, 'deterministic');
  assert.equal(result.fallbackReason, 'low-margin');
});

test('parser result stays a separate advisory after deterministic money and status gates', async () => {
  const text = 'Purchase AED 25.00 at Cafe with card 1234567890123456';
  const { retriever } = createHarness({
    'Purchase <field> at <field> with card <digits>': [0, 0, 0.99, 0.03],
  });
  const event = baseEvent();
  const before = JSON.stringify(event);
  const result = await semantic.createLocalParserFamilyAdvisory({
    event,
    semanticText: text,
    sensitiveSpans: [{ start: 9, end: 18 }, { start: 22, end: 26 }],
    retriever,
  });
  assert.equal(result.kind, 'parser-family-advisory');
  assert.equal(result.advisoryOnly, true);
  assert.equal(result.family, 'purchase');
  assert.equal(JSON.stringify(event), before);
  assert.equal('amount' in result, false);
  assert.equal('status' in result, false);
  assert.equal('direction' in result, false);
});

test('public-only parser head stays advisory after the same deterministic finance gates', async () => {
  const text = 'Purchase AED 25.00 at Cafe with card 1234567890123456';
  const redacted = 'Purchase <field> at <field> with card <digits>';
  const { calls, classifier } = createHeadHarness({ [redacted]: [1, 0, 0, 0] });
  const event = baseEvent();
  const before = JSON.stringify(event);
  const result = await semantic.createLocalParserFamilyHeadAdvisory({
    event,
    semanticText: text,
    sensitiveSpans: [{ start: 9, end: 18 }, { start: 22, end: 26 }],
    classifier,
  });
  assert.equal(result.kind, 'parser-family-advisory');
  assert.equal(result.advisoryOnly, true);
  assert.equal(result.family, 'purchase');
  assert.equal(result.prototypeId, 'parser.family.purchase');
  assert.equal(JSON.stringify(event), before, 'semantic advice must not mutate deterministic facts');
  for (const forbidden of ['amount', 'currency', 'status', 'direction', 'accountId', 'sourceKey']) {
    assert.equal(forbidden in result, false, `head result must not expose ${forbidden}`);
  }
  assert.deepEqual(calls, [redacted]);
});

test('public-only parser head never runs before hard deterministic eligibility gates', async () => {
  const { calls, classifier } = createHeadHarness({ safe: [1, 0, 0, 0] });
  for (const [event, reason] of [
    [{ ...baseEvent(), decision: 'ignore' }, 'event-not-reviewable'],
    [{ ...baseEvent(), family: 'purchase' }, 'deterministic-family-known'],
    [{ ...baseEvent(), status: 'future' }, 'event-not-a-posting-candidate'],
    [{ ...baseEvent(), issues: ['authentication-not-posting'] }, 'unsafe-parser-state'],
    [{ ...baseEvent(), amount: { value: null, evidence: 'missing', spans: [], alternatives: [], issues: [] } },
      'deterministic-money-required'],
  ]) {
    const result = await semantic.createLocalParserFamilyHeadAdvisory({
      event, semanticText: 'safe', sensitiveSpans: [], classifier,
    });
    assert.equal(result.kind, 'refused');
    assert.equal(result.reason, reason);
  }
  assert.deepEqual(calls, [], 'ineligible events must never reach the local model');
});

test('parser model cannot override known families, hard negatives, or missing money', async () => {
  const { calls, retriever } = createHarness({ safe: [0, 0, 1, 0] });
  for (const [event, reason] of [
    [{ ...baseEvent(), family: 'purchase' }, 'deterministic-family-known'],
    [{ ...baseEvent(), status: 'future' }, 'event-not-a-posting-candidate'],
    [{ ...baseEvent(), issues: ['authentication-not-posting'] }, 'unsafe-parser-state'],
    [{ ...baseEvent(), amount: { value: null, evidence: 'missing', spans: [], alternatives: [], issues: [] } },
      'deterministic-money-required'],
  ]) {
    const result = await semantic.createLocalParserFamilyAdvisory({
      event, semanticText: 'safe', sensitiveSpans: [], retriever,
    });
    assert.equal(result.kind, 'refused');
    assert.equal(result.reason, reason);
  }
  assert.deepEqual(calls, [], 'ineligible parser events must never reach inference');
});

test('semantic redaction accepts deterministic non-overlapping spans and masks identifiers', () => {
  const source = 'Purchase AED 125.50 at Cafe with card 1234567890123456';
  assert.equal(semantic.redactLocalSemanticText(source, [
    { start: source.indexOf('AED'), end: source.indexOf('AED') + 'AED 125.50'.length },
    { start: source.indexOf('Cafe'), end: source.indexOf('Cafe') + 'Cafe'.length },
  ]), 'Purchase <field> at <field> with card <digits>');
  assert.equal(semantic.redactLocalSemanticText(source, [
    { start: 3, end: 10 }, { start: 8, end: 12 },
  ]), null);
});

test('typed semantic redaction preserves grammar while hiding sensitive values', () => {
  const source = 'Payment of AED 125.50 to Cafe with Credit Card ending 1234567890123456 on 21/09/2026';
  const money = source.indexOf('AED 125.50');
  const merchant = source.indexOf('Cafe');
  const card = source.indexOf('1234567890123456');
  const date = source.indexOf('21/09/2026');
  assert.equal(semantic.redactLocalSemanticText(source, [
    { start: money, end: money + 'AED 125.50'.length, kind: 'money' },
    { start: merchant, end: merchant + 'Cafe'.length, kind: 'merchant' },
    { start: card, end: card + '1234567890123456'.length, kind: 'instrument' },
    { start: date, end: date + '21/09/2026'.length, kind: 'date' },
  ]), 'Payment of <money> to <merchant> with Credit Card ending <instrument> on <date>');

  const feeSource = 'AED 0.05 at Value Added Tax fee';
  const feeMerchant = feeSource.indexOf('Value Added Tax fee');
  assert.equal(semantic.redactLocalSemanticText(feeSource, [
    { start: 0, end: 'AED 0.05'.length, kind: 'money' },
    { start: feeMerchant, end: feeMerchant + 'Value Added Tax fee'.length,
      kind: 'merchant', merchantHint: 'fee' },
  ]), '<money> at <fee>');
});
