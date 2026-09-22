/**
 * The committed half of the Ask Wafra routing gate.
 *
 * `npm run eval:assistant-routing` is the measurement, and it cannot run here:
 * it needs the 35 MB encoder from the `local-ai-e5-v1` release, which is not in
 * the repository. So it is a report tool, like `bench:parser`.
 *
 * What runs on every commit is everything about the routing decision that does
 * NOT need the model: the registry is complete and read-only, every compiled
 * request passes the production validator, the gate honours the measured
 * thresholds exactly at their boundaries, and the index on disk agrees with the
 * registry. Those are the invariants a later change would break silently — a
 * new tool with no policy, a lowered threshold, an index regenerated against a
 * different encoder.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  LOCAL_SEMANTIC_PROTOTYPE_IDS,
  LOCAL_SEMANTIC_REGISTRY,
  LOCAL_SEMANTIC_THRESHOLDS,
  chooseLocalSemanticAssistantPlan,
  createLocalSemanticRetriever,
  gateLocalSemanticCandidate,
} = require('./build/local-semantic-model');
const { ASSISTANT_TOOL_CATALOG, isAssistantToolRequest } = require('./build/wafra-assistant-ai');
const { executeAssistantTool } = require('./build/wafra-assistant');

const ROOT = path.resolve(__dirname, '../..');
const anchors = require(path.join(ROOT, 'scripts/local-ai/assistant-anchors.js'));
const index = require(path.join(ROOT, 'assets/local-ai/assistant-prototype-index.e5.int8.json'));

let passed = 0;
let failed = 0;
const check = (name, body) => {
  try { body(); process.stdout.write(`✓ ${name}\n`); passed += 1; }
  catch (error) { process.stdout.write(`✗ ${name}\n  ${error.message}\n`); failed += 1; }
};
const checkAsync = async (name, body) => {
  try { await body(); process.stdout.write(`✓ ${name}\n`); passed += 1; }
  catch (error) { process.stdout.write(`✗ ${name}\n  ${error.message}\n`); failed += 1; }
};

const assistantIds = LOCAL_SEMANTIC_PROTOTYPE_IDS
  .filter((id) => LOCAL_SEMANTIC_REGISTRY[id].kind === 'assistant-intent');

// ---------------------------------------------------------------- registry

check('every assistant prototype names a tool the production validator knows', () => {
  const known = new Set(ASSISTANT_TOOL_CATALOG.map((entry) => entry.tool));
  for (const id of assistantIds) {
    const { tool } = LOCAL_SEMANTIC_REGISTRY[id];
    assert.ok(known.has(tool), `${id} maps to ${tool}, which is not in ASSISTANT_TOOL_CATALOG`);
  }
});

check('the registry and every definition in it are frozen', () => {
  assert.ok(Object.isFrozen(LOCAL_SEMANTIC_REGISTRY));
  for (const id of LOCAL_SEMANTIC_PROTOTYPE_IDS) {
    assert.ok(Object.isFrozen(LOCAL_SEMANTIC_REGISTRY[id]), `${id} is mutable`);
  }
});

check('no prototype maps to a tool that writes, edits or moves anything', () => {
  // The whole safety argument for routing on an embedding is that the worst
  // outcome is a wrong READ. If a mutating tool ever enters the catalog, this
  // fails before a prototype can reach it.
  const reading = /^(help|.*-total|.*-breakdown|subscriptions|compare-.*|top-.*|largest-.*|daily-average|net-income-spending|upcoming-payments|cash-outflow|month-forecast|historical-baseline|account-inventory|obligation-status|credit-card-settlement-summary|recurring-changes|unusual-charges|possible-duplicates|money-review|data-coverage)$/;
  for (const id of assistantIds) {
    assert.match(LOCAL_SEMANTIC_REGISTRY[id].tool, reading, `${id} routes to a tool this test cannot vouch for`);
  }
});

// ------------------------------------------------------- compiled requests

const bank = { id: 'bank-1', name: 'Everyday', kind: 'bank', openingFils: 0, color: '#000000' };
const card = { id: 'card-1', name: 'Platinum', kind: 'credit-card', openingFils: 0, color: '#111111' };
const tx = (id, date, title, fils, category, type = 'expense', accountId = 'bank-1') =>
  ({ id, date, title, amountFils: fils, category, type, accountId, source: 'sms' });
const state = {
  accounts: [bank, card],
  transactions: [
    tx('s1', '2026-09-02', 'Talabat', 3_200, 'dining'),
    tx('s2', '2026-09-09', 'ATM Withdrawal', 50_000, 'cash-withdrawal'),
    tx('s3', '2026-09-11', 'Netflix', 4_400, 'entertainment', 'expense', 'card-1'),
    tx('s4', '2026-09-01', 'Salary', 1_800_000, 'salary', 'income'),
    tx('s5', '2026-08-11', 'Netflix', 3_900, 'entertainment', 'expense', 'card-1'),
    tx('s6', '2026-07-11', 'Netflix', 3_900, 'entertainment', 'expense', 'card-1'),
  ],
  notSubscriptions: [], bills: [], cardDues: [],
};
const now = new Date('2026-09-20T12:00:00Z');
const PERIODS = [
  { mode: 'month', key: '2026-09' },
  { mode: 'year', year: 2026 },
  { mode: 'range', from: '2026-08-01', to: '2026-09-20' },
  { mode: 'all' },
];

// A retriever that returns a chosen prototype, so every policy can be compiled
// and executed without the encoder. The vectors are orthogonal unit basis
// vectors, which makes the score and margin exactly controllable.
const stubRetriever = (prototypeId, score, runnerUpScore) => Object.freeze({
  manifest: Object.freeze({
    schemaVersion: 1, modelVersion: 'stub', backend: 'onnxruntime-react-native',
    graphFormat: 'onnx', quantization: 'dynamic-int8',
    embeddingDimensions: 384, maximumCharacters: 1_000,
  }),
  async retrieve() { return { v: 1, prototypeId, score, runnerUpScore }; },
});

const compiled = new Map();
const compile = async (id, period) => {
  const key = `${id}|${period.mode}`;
  if (!compiled.has(key)) {
    compiled.set(key, await chooseLocalSemanticAssistantPlan({
      question: 'a question the deterministic planner could not read',
      deterministicRequest: { tool: 'help' },
      previousRequest: null,
      defaultPeriod: period,
      currentPeriod: { mode: 'month', key: '2026-09' },
      retriever: stubRetriever(id, 0.95, 0.5),
    }));
  }
  return compiled.get(key);
};

const policyChecks = async () => {
  await checkAsync('every argument policy compiles a request the validator accepts, in every period mode', async () => {
    for (const id of assistantIds) {
      for (const period of PERIODS) {
        const plan = await compile(id, period);
        assert.equal(plan.source, 'local-semantic',
          `${id} in period mode ${period.mode} fell back: ${plan.fallbackReason}`);
        assert.ok(isAssistantToolRequest(plan.request),
          `${id} in period mode ${period.mode} compiled a request the validator rejects`);
      }
    }
  });

  await checkAsync('a compiled request produces an answer, never an exception', async () => {
    for (const id of assistantIds) {
      const plan = await compile(id, { mode: 'month', key: '2026-09' });
      const answer = executeAssistantTool(state, plan.request, now);
      assert.equal(typeof answer.title, 'string');
      assert.ok(answer.title.length > 0, `${id} produced an untitled answer`);
    }
  });

  await checkAsync('a refused candidate always yields the deterministic request unchanged', async () => {
    const deterministicRequest = Object.freeze({ tool: 'help' });
    const plan = await chooseLocalSemanticAssistantPlan({
      question: 'a question no intent is near',
      deterministicRequest,
      previousRequest: null,
      defaultPeriod: { mode: 'month', key: '2026-09' },
      currentPeriod: { mode: 'month', key: '2026-09' },
      // Margin 0.02: below the measured gate, above nothing.
      retriever: stubRetriever(assistantIds[0], 0.95, 0.93),
    });
    assert.equal(plan.source, 'deterministic');
    assert.equal(plan.fallbackReason, 'low-margin');
    assert.equal(plan.request, deterministicRequest, 'the deterministic request must pass through by identity');
  });

  await checkAsync('an existing deterministic answer is never overridden, however confident the model', async () => {
    const deterministicRequest = Object.freeze({ tool: 'spending-total', period: { mode: 'month', key: '2026-09' } });
    const plan = await chooseLocalSemanticAssistantPlan({
      question: 'how much did I spend',
      deterministicRequest,
      previousRequest: null,
      defaultPeriod: { mode: 'month', key: '2026-09' },
      currentPeriod: { mode: 'month', key: '2026-09' },
      retriever: stubRetriever(assistantIds[0], 1, 0),
    });
    assert.equal(plan.source, 'deterministic');
    assert.equal(plan.fallbackReason, 'deterministic-plan-authoritative');
  });

  await checkAsync('a follow-up question never reaches the model', async () => {
    const plan = await chooseLocalSemanticAssistantPlan({
      question: 'what about last month',
      deterministicRequest: { tool: 'help' },
      previousRequest: { tool: 'spending-total', period: { mode: 'month', key: '2026-09' } },
      defaultPeriod: { mode: 'month', key: '2026-09' },
      currentPeriod: { mode: 'month', key: '2026-09' },
      retriever: stubRetriever(assistantIds[0], 1, 0),
    });
    assert.equal(plan.source, 'deterministic');
    assert.equal(plan.fallbackReason, 'conversation-context-present');
  });
};

// -------------------------------------------------- reaching the model at all

const { planAssistantQuestion } = require('./build/wafra-assistant');

const UNRECOGNIZED_HELP_KEYS = new Set(['tool', 'clarification', 'suggestions', 'unrecognized']);
/** The exact condition chooseLocalSemanticAssistantPlan requires. */
const reachesModel = (request) => {
  if (request.tool !== 'help') return false;
  const keys = Object.keys(request);
  if (keys.length === 1) return true;
  return request.unrecognized === true && keys.every((key) => UNRECOGNIZED_HELP_KEYS.has(key));
};
const plan = (question) => planAssistantQuestion(state, question, now, null, { mode: 'month', key: '2026-09' });

check('an Arabizi question reaches the on-device model', () => {
  // Arabizi writes letters as digits, so the planner's amount/date guard was
  // refusing the spelling of ordinary words and holding the whole register back
  // from the only model that reads it. One character used to decide it.
  for (const question of [
    'hal dafa3t el faatura', 'hal in5asam marratain', 'kam card 3indi',
    'kam sarafat 3ala akl', 'raje3 floosi', 'kam sahabt cash',
  ]) {
    assert.ok(reachesModel(plan(question)), `${question} is still locked out`);
  }
});

check('a question carrying a real amount, year or date still refuses deterministically', () => {
  // The other half of the same change: these must not become model-eligible,
  // because routing them to a default-period tool drops the constraint the
  // planner refused to guess about.
  for (const question of [
    'how much did I spend on 15 august', 'what did I spend in aed500',
    'spending on card4110', 'my total in 2026', 'how much did I spend between 1 and 5 september',
    'what did I spend in usd', 'spending over 500',
  ]) {
    assert.ok(!reachesModel(plan(question)), `${question} must stay deterministic`);
  }
});

check('the rank-limit shorthand still answers rather than refusing', () => {
  assert.equal(plan('top 3 merchants').tool, 'top-merchants');
});

check('the Arabizi clarification text is unchanged', () => {
  // Only the eligibility flag moved. A user sees exactly what they saw before.
  const before = plan('what did I spend in aed500');
  const after = plan('hal dafa3t el faatura');
  assert.equal(after.clarification, before.clarification);
});

check('an Arabic question reaches the on-device model', () => {
  // The deterministic planner reads none of this register, which is the whole
  // reason a multilingual encoder is worth its bundle size.
  for (const question of [
    'كم صرفت هذا الشهر', 'ما هي اشتراكاتي', 'هل هناك معاملات مكررة', 'راجع أموالي',
  ]) {
    assert.ok(reachesModel(plan(question)), `${question} is not reaching the model`);
  }
});

// ---------------------------------------------------------------- the gate

check('the measured assistant thresholds are the ones in force', () => {
  // Changing either number changes what routes. `eval:assistant-routing` is the
  // only thing that can justify a new value; see the comment on the constant.
  assert.deepEqual(LOCAL_SEMANTIC_THRESHOLDS['assistant-intent'],
    { minimumScore: 0.72, minimumMargin: 0.04 });
  assert.deepEqual(LOCAL_SEMANTIC_THRESHOLDS['parser-family'],
    { minimumScore: 0.78, minimumMargin: 0.1 });
});

check('the gate is exact at the margin boundary', () => {
  const id = assistantIds[0];
  const at = (margin) => gateLocalSemanticCandidate(
    { v: 1, prototypeId: id, score: 0.9, runnerUpScore: 0.9 - margin }, 'assistant-intent');
  assert.equal(at(0.04).kind, 'accepted', 'a margin exactly at the threshold must pass');
  assert.equal(at(0.041).kind, 'accepted');
  assert.equal(at(0.039).kind, 'refused');
  assert.equal(at(0.039).reason, 'low-margin');
  // The worst out-of-scope margin measured on the held-out corpus, from
  // "delete all my transactions" landing on money-review.
  assert.equal(at(0.027).kind, 'refused', 'the measured adversarial tail must stay out');
});

check('the gate is exact at the score boundary', () => {
  const id = assistantIds[0];
  const at = (score) => gateLocalSemanticCandidate(
    { v: 1, prototypeId: id, score, runnerUpScore: score - 0.2 }, 'assistant-intent');
  assert.equal(at(0.72).kind, 'accepted');
  assert.equal(at(0.719).kind, 'refused');
  assert.equal(at(0.719).reason, 'low-score');
});

check('a caller may tighten a threshold but never loosen one', () => {
  const id = assistantIds[0];
  const candidate = { v: 1, prototypeId: id, score: 0.9, runnerUpScore: 0.85 };
  assert.equal(gateLocalSemanticCandidate(candidate, 'assistant-intent').kind, 'accepted');
  assert.equal(
    gateLocalSemanticCandidate(candidate, 'assistant-intent', { minimumMargin: 0.2 }).kind, 'refused',
    'a stricter margin must apply');
  assert.equal(
    gateLocalSemanticCandidate({ v: 1, prototypeId: id, score: 0.9, runnerUpScore: 0.88 },
      'assistant-intent', { minimumMargin: 0 }).kind, 'refused',
    'a looser margin must be ignored');
});

check('a parser-family id cannot be reached through the assistant domain', () => {
  const parserId = LOCAL_SEMANTIC_PROTOTYPE_IDS
    .find((id) => LOCAL_SEMANTIC_REGISTRY[id].kind === 'parser-family');
  const gated = gateLocalSemanticCandidate(
    { v: 1, prototypeId: parserId, score: 0.99, runnerUpScore: 0.1 }, 'assistant-intent');
  assert.equal(gated.kind, 'refused');
  assert.equal(gated.reason, 'unknown-or-invalid-prototype');
});

// --------------------------------------------------------------- the index

check('the committed index encodes only registered ids', () => {
  for (const prototype of index.prototypes) {
    const definition = LOCAL_SEMANTIC_REGISTRY[prototype.id];
    assert.ok(definition, `${prototype.id} is in the index but not the registry`);
    assert.equal(definition.kind, prototype.domain, `${prototype.id} has the wrong domain`);
  }
});

check('the committed index matches the anchors it was built from', () => {
  const encoded = new Map();
  for (const prototype of index.prototypes) {
    encoded.set(prototype.id, (encoded.get(prototype.id) ?? 0) + 1);
  }
  for (const group of anchors) {
    assert.equal(encoded.get(group.id), group.phrasings.length,
      `${group.id} has ${group.phrasings.length} phrasings but ${encoded.get(group.id)} vectors`);
  }
  assert.equal(encoded.size, anchors.length,
    'the index and the anchor file disagree on how many intents exist');
});

check('the argument-dependent anchors are deliberately absent from the index', () => {
  // These tools refuse without a merchant, an arbitrary category, or a card.
  // A prototype cannot carry one, so encoding them would route a question to a
  // tool that then has nothing to answer about.
  const encoded = new Set(index.prototypes.map((prototype) => prototype.id));
  for (const group of anchors.argumentDependent) {
    assert.ok(!encoded.has(group.id), `${group.id} must not be encoded`);
    assert.ok(!Object.hasOwn(LOCAL_SEMANTIC_REGISTRY, group.id), `${group.id} must not be registered`);
  }
  assert.ok(anchors.argumentDependent.length > 0, 'the argument-dependent list went missing');
});

check('the index is built against the encoder the app will actually load', () => {
  const runtime = fs.readFileSync(path.join(ROOT, 'src/lib/local-semantic-runtime.native.ts'), 'utf8');
  const pinned = runtime.match(/MODEL_VERSION\s*=\s*'([^']+)'/);
  assert.ok(pinned, 'local-semantic-runtime.native.ts no longer declares MODEL_VERSION');
  assert.equal(index.modelVersion, pinned[1],
    'the index was built against a different encoder than the runtime pins');
  assert.equal(index.embeddingDimensions, 384);
  assert.equal(index.scoreScale, 'raw-cosine');
  assert.equal(index.aggregation, 'max-per-prototype-id');
});

check('the index stays inside the retriever\'s own prototype ceiling', () => {
  // createLocalSemanticRetriever throws prototype-index-mismatch above 256, and
  // it throws at CONSTRUCTION — Ask Wafra would lose the model entirely rather
  // than degrade. 211 today, so an intent of average size still fits.
  assert.ok(index.prototypes.length >= 2, 'a single-class index cannot produce a margin');
  assert.ok(index.prototypes.length <= 256,
    `${index.prototypes.length} prototypes exceeds the retriever's ceiling of 256`);
});

check('the retriever accepts the committed index against the real manifest', () => {
  const runtime = fs.readFileSync(path.join(ROOT, 'src/lib/local-semantic-runtime.native.ts'), 'utf8');
  const modelVersion = runtime.match(/MODEL_VERSION\s*=\s*'([^']+)'/)[1];
  const retriever = createLocalSemanticRetriever(Object.freeze({
    manifest: Object.freeze({
      schemaVersion: 1, modelVersion, backend: 'onnxruntime-react-native',
      graphFormat: 'onnx', quantization: 'dynamic-int8',
      embeddingDimensions: 384, maximumCharacters: 1_000,
    }),
    async encode() { return new Float32Array(384).fill(1 / Math.sqrt(384)); },
  }), index);
  assert.ok(retriever.manifest);
});

check('every committed vector is a usable unit vector', () => {
  for (const prototype of index.prototypes) {
    assert.equal(prototype.vector.length, 384, `${prototype.id} has the wrong dimension`);
    let squared = 0;
    for (const value of prototype.vector) {
      assert.ok(Number.isFinite(value), `${prototype.id} holds a non-finite component`);
      squared += value * value;
    }
    // The builder rounds to five decimals, which moves the norm by far less
    // than the margins the gate turns on.
    assert.ok(Math.abs(Math.sqrt(squared) - 1) < 1e-3,
      `${prototype.id} is not normalised (norm ${Math.sqrt(squared).toFixed(6)})`);
  }
});

check('no two intents share a prototype vector', () => {
  // Two identical vectors under different ids would make the margin between
  // them exactly zero forever, and neither could ever route.
  const byVector = new Map();
  for (const prototype of index.prototypes) {
    const key = prototype.vector.join(',');
    const existing = byVector.get(key);
    assert.ok(existing === undefined || existing === prototype.id,
      `${prototype.id} and ${existing} share a vector`);
    byVector.set(key, prototype.id);
  }
});

policyChecks().then(() => {
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  if (failed) process.exit(1);
}, (error) => {
  process.stdout.write(`\nthe routing checks threw outside a case: ${error.stack}\n`);
  process.exit(1);
});
