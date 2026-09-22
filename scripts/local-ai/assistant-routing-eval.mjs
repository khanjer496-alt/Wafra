/**
 * Score on-device Ask Wafra intent routing end to end.
 *
 *   node scripts/local-ai/assistant-routing-eval.mjs --model <dir>
 *
 * Runs the SHIPPING path, not a reconstruction of it: the real deterministic
 * planner decides first, the real `chooseLocalSemanticAssistantPlan` is
 * consulted only where the planner fell back to plain help, the real
 * `LOCAL_SEMANTIC_REGISTRY` resolves the prototype, the real
 * `isAssistantToolRequest` validates the compiled request, and the real
 * `executeAssistantTool` produces the answer. Thresholds come from
 * `LOCAL_SEMANTIC_THRESHOLDS`, so this measures what a user gets.
 *
 * The encoder is the pinned release artifact, hash-checked here exactly as the
 * app checks it, under `onnxruntime-web` rather than `onnxruntime-react-native`.
 * Same graph and same INT8 weights; a phone's arithmetic is not bit-identical to
 * x86, so treat scores as accurate to about 1e-3 rather than exactly.
 *
 * Corpus: `assistant-routing-eval.js`, held-out by construction — no row of it
 * appears in `assistant-anchors.js`, which the script asserts before scoring.
 *
 * THE NUMBER THAT DECIDES ANYTHING is `wrong tool`. A refusal costs the user a
 * rephrase. A wrong tool spends their attention on a correct calculation of
 * something they did not ask, and reads as an answer.
 */
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const require = createRequire(import.meta.url);

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const modelDir = flag('model');
if (!modelDir) {
  process.stderr.write(
    'assistant-routing-eval: --model <dir> is required (model.int8.onnx, tokenizer.json,\n' +
    'tokenizer_config.json from the local-ai-e5-v1 release; 35 MB, not committed).\n');
  process.exit(2);
}

const PINNED = {
  'model.int8.onnx': '70fd5ee627d2392c1f201c4045ca1c37991db28e80eab3401ebc34b540c4f9a1',
  'tokenizer.json': '40b7d6f2e0b8b58a8ac14294b122a41560c61db46515a5f05871811892fc5f60',
  'tokenizer_config.json': '606031684b9ac91d380bf254ee9027976904a22e0aa32423cf254f049bb957b2',
};
const MODEL_VERSION = 'e5-arb-32768@e1b3907e6c83#int8-70fd5ee627d2';
const DIMENSIONS = 384;
const MAX_TOKENS = 128;
const MAX_CHARS = 1_000;

for (const [name, sha] of Object.entries(PINNED)) {
  const file = path.join(modelDir, name);
  if (!fs.existsSync(file)) {
    process.stderr.write(`assistant-routing-eval: ${name} is not in ${modelDir}.\n`);
    process.exit(2);
  }
  const got = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (got !== sha) {
    process.stderr.write(`assistant-routing-eval: ${name} is not the pinned artifact (${got}).\n`);
    process.exit(1);
  }
}

const buildDir = path.join(ROOT, 'scripts/test/build');
if (!fs.existsSync(path.join(buildDir, 'local-semantic-model.js'))) {
  process.stderr.write('assistant-routing-eval: run bash scripts/test/build.sh first.\n');
  process.exit(2);
}
const {
  LOCAL_SEMANTIC_THRESHOLDS, chooseLocalSemanticAssistantPlan, createLocalSemanticRetriever,
} = require(path.join(buildDir, 'local-semantic-model.js'));
const { executeAssistantTool, planAssistantQuestion } = require(path.join(buildDir, 'wafra-assistant.js'));
const index = require(path.join(ROOT, 'assets/local-ai/assistant-prototype-index.e5.int8.json'));
const anchors = require(path.join(ROOT, 'scripts/local-ai/assistant-anchors.js'));
const heldOut = require(path.join(ROOT, 'scripts/local-ai/assistant-routing-eval.js'));

// A held-out set that leaked an anchor would score itself at cosine 1.0.
const anchorPhrasings = new Set();
for (const group of [...anchors, ...anchors.argumentDependent]) {
  for (const phrasing of group.phrasings) anchorPhrasings.add(phrasing.trim().toLowerCase());
}
const leaked = heldOut.filter((row) => anchorPhrasings.has(row.q.trim().toLowerCase()));
if (leaked.length) {
  process.stderr.write(
    `assistant-routing-eval: ${leaked.length} held-out row(s) also appear in assistant-anchors.js:\n` +
    leaked.map((row) => `  ${row.q}\n`).join('') + 'Refusing to score against its own anchors.\n');
  process.exit(1);
}

const ort = require('onnxruntime-web');
const { Tokenizer } = require(path.join(ROOT, 'node_modules/@huggingface/tokenizers/dist/tokenizers.cjs'));
const tokenizer = new Tokenizer(
  JSON.parse(fs.readFileSync(path.join(modelDir, 'tokenizer.json'), 'utf8')),
  JSON.parse(fs.readFileSync(path.join(modelDir, 'tokenizer_config.json'), 'utf8')),
);
const session = await ort.InferenceSession.create(path.join(modelDir, 'model.int8.onnx'), {
  graphOptimizationLevel: 'all', executionMode: 'sequential',
});
const int64 = (values) => new ort.Tensor('int64', values.map(BigInt), [1, values.length]);

/** Pooling identical to local-semantic-runtime.native.ts and the index builder. */
const encoder = Object.freeze({
  manifest: Object.freeze({
    schemaVersion: 1, modelVersion: MODEL_VERSION, backend: 'onnxruntime-react-native',
    graphFormat: 'onnx', quantization: 'dynamic-int8',
    embeddingDimensions: DIMENSIONS, maximumCharacters: MAX_CHARS,
  }),
  async encode(text) {
    const clean = text.trim().slice(0, MAX_CHARS);
    if (!clean) throw new Error('empty-input');
    const encoded = tokenizer.encode(clean, { return_token_type_ids: true });
    const ids = encoded.ids.slice(0, MAX_TOKENS);
    const attention = encoded.attention_mask.slice(0, ids.length);
    const types = (encoded.token_type_ids ?? new Array(ids.length).fill(0)).slice(0, ids.length);
    const outputs = await session.run({
      input_ids: int64(ids), attention_mask: int64(attention), token_type_ids: int64(types),
    });
    const data = outputs.last_hidden_state.data;
    const pooled = new Float32Array(DIMENSIONS);
    let count = 0;
    for (let token = 0; token < ids.length; token += 1) {
      if (attention[token] !== 1) continue;
      count += 1;
      for (let dim = 0; dim < DIMENSIONS; dim += 1) pooled[dim] += data[token * DIMENSIONS + dim];
    }
    let norm = 0;
    for (let dim = 0; dim < DIMENSIONS; dim += 1) { pooled[dim] /= count; norm += pooled[dim] ** 2; }
    norm = Math.sqrt(norm);
    for (let dim = 0; dim < DIMENSIONS; dim += 1) pooled[dim] /= norm;
    return pooled;
  },
});

const retriever = createLocalSemanticRetriever(encoder, index);

// A ledger with enough shape that every tool can produce a real answer, so a
// route is scored on the tool it reached rather than on empty data.
const bank = { id: 'bank-1', name: 'Everyday', kind: 'bank', openingFils: 0, color: '#000000' };
const card = { id: 'card-1', name: 'Platinum', kind: 'credit-card', openingFils: 0, color: '#111111' };
const tx = (id, date, title, fils, category, type = 'expense', accountId = 'bank-1') =>
  ({ id, date, title, amountFils: fils, category, type, accountId, source: 'sms' });
const state = {
  accounts: [bank, card],
  transactions: [
    tx('s1', '2026-09-02', 'Talabat', 3_200, 'dining'),
    tx('s2', '2026-09-05', 'Talabat', 2_100, 'dining'),
    tx('s3', '2026-09-06', 'Carrefour', 18_400, 'groceries'),
    tx('s4', '2026-09-09', 'ATM Withdrawal', 50_000, 'cash-withdrawal'),
    tx('s5', '2026-09-11', 'Netflix', 4_400, 'entertainment', 'expense', 'card-1'),
    tx('s6', '2026-09-01', 'Salary', 1_800_000, 'salary', 'income'),
    tx('s7', '2026-08-05', 'Talabat', 2_600, 'dining'),
    tx('s8', '2026-08-11', 'Netflix', 3_900, 'entertainment', 'expense', 'card-1'),
    tx('s9', '2026-08-14', 'Carrefour', 16_100, 'groceries'),
    tx('s10', '2026-07-11', 'Netflix', 3_900, 'entertainment', 'expense', 'card-1'),
    tx('s11', '2026-07-03', 'Carrefour', 15_500, 'groceries'),
    tx('s12', '2026-07-02', 'Salary', 1_800_000, 'salary', 'income'),
  ],
  notSubscriptions: [], bills: [], cardDues: [],
};
const now = new Date('2026-09-20T12:00:00Z');
const defaultPeriod = { mode: 'month', key: '2026-09' };
const currentPeriod = { mode: 'month', key: '2026-09' };

const buckets = {
  deterministicCorrect: [], deterministicOther: [],
  routedCorrect: [], routedWrong: [], refused: [],
  outRefused: [], outRouted: [],
};
let totalMs = 0;

for (const row of heldOut) {
  const deterministicRequest = planAssistantQuestion(state, row.q, now, null, defaultPeriod);
  const startedAt = process.hrtime.bigint();
  const plan = await chooseLocalSemanticAssistantPlan({
    question: row.q, deterministicRequest, previousRequest: null,
    defaultPeriod, currentPeriod, retriever,
  });
  totalMs += Number(process.hrtime.bigint() - startedAt) / 1e6;

  if (plan.source === 'deterministic' && plan.fallbackReason === 'deterministic-plan-authoritative') {
    const got = deterministicRequest.tool;
    (got === row.tool ? buckets.deterministicCorrect : buckets.deterministicOther)
      .push({ ...row, got, clarification: deterministicRequest.clarification });
    continue;
  }
  if (plan.source === 'deterministic') {
    (row.tool ? buckets.refused : buckets.outRefused).push({ ...row, reason: plan.fallbackReason });
    continue;
  }
  // Routed. Prove the compiled request actually answers, not just validates.
  let answer = null;
  try { answer = executeAssistantTool(state, plan.request, now); } catch (error) { answer = { title: `THREW: ${error.message}`, body: '' }; }
  const record = {
    ...row, got: plan.request.tool, prototypeId: plan.prototypeId,
    score: plan.score, margin: plan.margin, title: answer.title,
  };
  if (!row.tool) buckets.outRouted.push(record);
  else (plan.request.tool === row.tool ? buckets.routedCorrect : buckets.routedWrong).push(record);
}

const inScope = heldOut.filter((row) => row.tool).length;
const outScope = heldOut.length - inScope;
const reachedModel = buckets.routedCorrect.length + buckets.routedWrong.length + buckets.refused.length;
const pct = (n, of) => of ? `${((n / of) * 100).toFixed(1)}%` : 'n/a';
const line = (label, value) => process.stdout.write(`  ${label.padEnd(44)}${value}\n`);

process.stdout.write('\nAsk Wafra local intent routing — held-out corpus\n');
process.stdout.write(`${'-'.repeat(72)}\n`);
line('encoder', MODEL_VERSION);
line('index', `${index.prototypes.length} prototypes over ${new Set(index.prototypes.map((p) => p.id)).size} intents`);
line('gate', `score >= ${LOCAL_SEMANTIC_THRESHOLDS['assistant-intent'].minimumScore}, margin >= ${LOCAL_SEMANTIC_THRESHOLDS['assistant-intent'].minimumMargin}`);
line('held-out rows', `${heldOut.length} (${inScope} in scope, ${outScope} out of scope)`);
line('mean latency per question', `${(totalMs / heldOut.length).toFixed(1)} ms (x86 CPU)`);

process.stdout.write('\nIn scope — the deterministic planner answered first\n');
line('correct tool, no model consulted', `${buckets.deterministicCorrect.length} / ${inScope}  (${pct(buckets.deterministicCorrect.length, inScope)})`);
line('other tool, model never consulted', `${buckets.deterministicOther.length}`);

process.stdout.write('\nIn scope — reached the local model\n');
line('reached the model', `${reachedModel} / ${inScope}  (${pct(reachedModel, inScope)})`);
line('routed, correct tool', `${buckets.routedCorrect.length}  (${pct(buckets.routedCorrect.length, reachedModel)} of those reaching it)`);
line('routed, WRONG tool', `${buckets.routedWrong.length}`);
line('refused -> clarification', `${buckets.refused.length}`);

process.stdout.write('\nOut of scope — routing anything here is a failure\n');
line('refused (correct)', `${buckets.outRefused.length} / ${outScope}  (${pct(buckets.outRefused.length, outScope)})`);
line('ROUTED (wrong)', `${buckets.outRouted.length}`);

process.stdout.write('\nEnd-to-end answer rate in scope\n');
const answered = buckets.deterministicCorrect.length + buckets.routedCorrect.length;
line('answered with the right tool', `${answered} / ${inScope}  (${pct(answered, inScope)})`);
line('wrong tool, any path', `${buckets.deterministicOther.length + buckets.routedWrong.length}`);

const show = (title, rows, render) => {
  if (!rows.length) return;
  process.stdout.write(`\n${title}\n`);
  for (const row of rows) process.stdout.write(`  ${render(row)}\n`);
};
show('WRONG TOOL after routing', buckets.routedWrong, (r) =>
  `${r.q}\n    wanted ${r.tool}, got ${r.got} via ${r.prototypeId} (score ${r.score.toFixed(3)}, margin ${r.margin.toFixed(3)})`);
show('OUT OF SCOPE but routed', buckets.outRouted, (r) =>
  `${r.q}\n    -> ${r.got} via ${r.prototypeId} (score ${r.score.toFixed(3)}, margin ${r.margin.toFixed(3)}) "${r.title}"`);
show('Refused (in scope) — the user must rephrase', buckets.refused, (r) =>
  `${r.reason.padEnd(26)} ${r.q}  [wanted ${r.tool}]`);
show('Answered deterministically with another tool', buckets.deterministicOther, (r) =>
  `${r.q}\n    wanted ${r.tool}, got ${r.got}${r.clarification ? ` — "${r.clarification}"` : ''}`);

const unsafe = buckets.routedWrong.length + buckets.outRouted.length;
process.stdout.write(`\n${'-'.repeat(72)}\n`);
process.stdout.write(unsafe === 0
  ? 'VERDICT PASS — nothing routed to a tool the question did not ask for.\n'
  : `VERDICT FAIL — ${unsafe} question(s) reached the wrong tool.\n`);
process.exit(unsafe === 0 ? 0 : 1);
