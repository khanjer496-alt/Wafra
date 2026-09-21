/**
 * Encode `assistant-anchors.js` into the prototype index the router reads.
 *
 *   node scripts/local-ai/build-assistant-index.mjs --model <dir> [--out <file>]
 *
 * `--model` is a directory holding the three artifacts the app downloads from
 * the `local-ai-e5-v1` release — `model.int8.onnx`, `tokenizer.json` and
 * `tokenizer_config.json`. They are NOT committed (35 MB), and this script
 * verifies their SHA-256 against the same constants
 * `src/lib/local-semantic-runtime.native.ts` pins, so an index can never be
 * built from a different encoder than the phone runs. A vector produced by a
 * different model is not wrong in any way you can see — it is simply in
 * another space, and every cosine after that is meaningless.
 *
 * The pooling here is `native.ts` line for line: truncate to 128 tokens, mean
 * over positions where attention_mask is 1, then L2-normalise. If those two
 * ever diverge, the index and the runtime stop agreeing and nothing reports it.
 *
 * Requires `onnxruntime-web` (`npm install --no-save onnxruntime-web`), which
 * is a devDependency of nothing — install it ad hoc when regenerating. The web
 * build is used rather than `onnxruntime-node` because it is pure WASM and
 * needs no platform-specific binary download. This is deliberately a build-time script and not
 * part of any test or CI path: the index is a committed artifact, reviewed like
 * any other change, not something regenerated silently.
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
const outPath = flag('out', path.join(ROOT, 'assets/local-ai/assistant-prototype-index.e5.int8.json'));
if (!modelDir) {
  process.stderr.write('build-assistant-index: --model <dir> is required.\n');
  process.exit(2);
}

/** The exact artifacts local-semantic-runtime.native.ts will accept. */
const PINNED = {
  'model.int8.onnx': { sha256: '70fd5ee627d2392c1f201c4045ca1c37991db28e80eab3401ebc34b540c4f9a1', bytes: 34_825_743 },
  'tokenizer.json': { sha256: '40b7d6f2e0b8b58a8ac14294b122a41560c61db46515a5f05871811892fc5f60', bytes: 2_406_512 },
  'tokenizer_config.json': { sha256: '606031684b9ac91d380bf254ee9027976904a22e0aa32423cf254f049bb957b2', bytes: 1_206 },
};
const MODEL_VERSION = 'e5-arb-32768@e1b3907e6c83#int8-70fd5ee627d2';
const DIMENSIONS = 384;
const MAX_TOKENS = 128;
const MAX_CHARS = 1_000;

for (const [name, want] of Object.entries(PINNED)) {
  const file = path.join(modelDir, name);
  if (!fs.existsSync(file)) {
    process.stderr.write(`build-assistant-index: ${name} is not in ${modelDir}.\n`);
    process.exit(2);
  }
  const bytes = fs.readFileSync(file);
  const got = crypto.createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== want.bytes || got !== want.sha256) {
    process.stderr.write(
      `build-assistant-index: ${name} does not match the pinned artifact.\n` +
      `  expected ${want.bytes} bytes / ${want.sha256}\n` +
      `  found    ${bytes.length} bytes / ${got}\n` +
      'Refusing to build an index against an encoder the app will not run.\n');
    process.exit(1);
  }
}

// onnxruntime-web, not -node: the Node package's postinstall fetches a
// platform-specific native binary and fails behind a proxy, while the web
// build is pure WASM and runs anywhere Node does. Same graph, same numbers.
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

/** Identical to local-semantic-runtime.native.ts. Keep them in step. */
const encode = async (text) => {
  const clean = text.trim().slice(0, MAX_CHARS);
  const encoded = tokenizer.encode(clean, { return_token_type_ids: true });
  const ids = encoded.ids.slice(0, MAX_TOKENS);
  const attention = encoded.attention_mask.slice(0, ids.length);
  const types = (encoded.token_type_ids ?? new Array(ids.length).fill(0)).slice(0, ids.length);
  const outputs = await session.run({
    input_ids: int64(ids), attention_mask: int64(attention), token_type_ids: int64(types),
  });
  const data = outputs.last_hidden_state.data;
  const pooled = new Float64Array(DIMENSIONS);
  let count = 0;
  for (let token = 0; token < ids.length; token += 1) {
    if (attention[token] !== 1) continue;
    count += 1;
    for (let dim = 0; dim < DIMENSIONS; dim += 1) pooled[dim] += data[token * DIMENSIONS + dim];
  }
  let norm = 0;
  for (let dim = 0; dim < DIMENSIONS; dim += 1) { pooled[dim] /= count; norm += pooled[dim] ** 2; }
  norm = Math.sqrt(norm);
  // Five decimals. These are unit vectors and the router's decisions turn on
  // margins around 0.02, so 1e-5 of quantisation is far below anything that
  // can change an answer — and it takes a third off a bundled asset.
  return [...pooled].map((value) => Number((value / norm).toFixed(5)));
};

const anchors = require(path.join(ROOT, 'scripts/local-ai/assistant-anchors.js'));

/**
 * `LOCAL_SEMANTIC_REGISTRY` in `src/lib/local-semantic-model.ts` is the code-owned
 * authority for which prototype ids mean anything, and it maps each one to a tool
 * AND an argument policy. A vector whose id is not in it is dead weight: the
 * runtime looks the id up, finds nothing, and refuses — correctly, because an
 * index is data and data does not get to invent an intent.
 *
 * So refuse to write it. Emitting 246 prototypes of which 58 are reachable
 * would look like a working index and behave like the old one, which is the
 * worst of both. Expanding the intent set means adding registry entries first,
 * with a deliberate policy for each, and that is a source change for review —
 * not something an asset regeneration can smuggle in.
 */
const registryPath = path.join(ROOT, 'scripts/test/build/local-semantic-model.js');
if (!fs.existsSync(registryPath)) {
  process.stderr.write(
    'build-assistant-index: scripts/test/build is missing; run bash scripts/test/build.sh first\n' +
    'so the prototype registry can be read.\n');
  process.exit(2);
}
const { LOCAL_SEMANTIC_REGISTRY } = require(registryPath);
const unknown = anchors
  .map((group) => group.id)
  .filter((id) => !Object.hasOwn(LOCAL_SEMANTIC_REGISTRY, id));
if (unknown.length) {
  process.stderr.write(
    `build-assistant-index: ${unknown.length} anchor id(s) are absent from ` +
    'LOCAL_SEMANTIC_REGISTRY, so the runtime would refuse every vector built from ' +
    'them:\n' + unknown.map((id) => `  ${id}\n`).join('') +
    '\nAdd a registry entry (tool + argument policy) in src/lib/local-semantic-model.ts\n' +
    'for each, or remove the anchor group. Refusing to write a partly-dead index.\n');
  process.exit(1);
}

const prototypes = [];
for (const group of anchors) {
  for (const phrasing of group.phrasings) {
    prototypes.push({ id: group.id, domain: 'assistant-intent', tool: group.tool, vector: await encode(phrasing) });
  }
  process.stderr.write(`  ${group.id.padEnd(40)} ${group.phrasings.length} phrasings\n`);
}

const index = {
  schemaVersion: 1,
  modelVersion: MODEL_VERSION,
  embeddingDimensions: DIMENSIONS,
  scoreScale: 'raw-cosine',
  aggregation: 'max-per-prototype-id',
  prototypes,
};
fs.writeFileSync(outPath, `${JSON.stringify(index)}\n`);
process.stderr.write(
  `\n${prototypes.length} prototypes over ${anchors.length} intents -> ${outPath}\n` +
  `${(fs.statSync(outPath).size / 1024).toFixed(0)} KiB\n`);
