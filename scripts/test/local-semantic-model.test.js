/**
 * The reconstructed local-semantic module, pinned at its two contracts.
 *
 * `src/lib/local-semantic-model.ts` is a stand-in for a file that was never
 * committed (see its header). That makes these assertions more important than
 * usual, not less: they are what stops the stand-in drifting from the surface
 * its four consumers already depend on, and what will tell us whether the
 * recovered original still satisfies the same contracts when it lands.
 *
 * Two things matter here.
 *
 *   1. PRIVACY. `redactLocalSemanticText` is the boundary between a bank
 *      message and what gets embedded. Nothing identifying may survive it.
 *
 *   2. THE LITERAL `<money>`. `local-semantic-shadow.ts` finds the semantic
 *      window by searching the redacted text for that exact token. Change the
 *      placeholder spelling and the shadow silently stops producing windows —
 *      no error, just an evaluation that quietly measures nothing.
 *
 * The certification stub is pinned too, for the opposite reason: it must never
 * start returning a decision that grants automatic import.
 */
const {
  redactLocalSemanticText,
  createLocalSemanticRetriever,
  LOCAL_SEMANTIC_MODEL_PROVENANCE,
} = require('./build/local-semantic-model');
const { certifyUniversalTemplate } = require('./build/universal-template-certification');

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

/* ── Redaction ───────────────────────────────────────────────────────── */

const source = 'Purchase of AED 87.50 with card ending 4412 at CARREFOUR on 21/09/2026';
const spans = [
  { start: 12, end: 21, kind: 'money' },      // AED 87.50
  { start: 39, end: 43, kind: 'instrument' }, // 4412
  { start: 47, end: 56, kind: 'merchant' },   // CARREFOUR
  { start: 60, end: 70, kind: 'date' },       // 21/09/2026
];

const redacted = redactLocalSemanticText(source, spans);

ok('every span becomes its type placeholder',
  redacted === 'Purchase of <money> with card ending <instrument> at <merchant> on <date>',
  redacted);

ok('the literal <money> survives — local-semantic-shadow.ts searches for it',
  typeof redacted === 'string' && redacted.includes('<money>'));

ok('no digit from the source survives redaction',
  typeof redacted === 'string' && !/\d/u.test(redacted), redacted);

ok('the amount never survives',
  typeof redacted === 'string' && !redacted.includes('87.50'));

ok('the merchant never survives',
  typeof redacted === 'string' && !redacted.includes('CARREFOUR'));

ok('the card tail never survives',
  typeof redacted === 'string' && !redacted.includes('4412'));

// A reference or account number the deterministic pass did not claim is still
// identifying, and must not reach an embedding.
const withReference = redactLocalSemanticText(
  'Txn ref 998877665544 posted to account 1234567890',
  [],
);
ok('residual digit runs the spans missed are swept too',
  typeof withReference === 'string' && !/\d/u.test(withReference), withReference);

ok('Arabic-Indic digits are swept as well',
  !/[٠-٩]/u.test(redactLocalSemanticText('المبلغ ١٢٣٤٥٦ ريال', []) ?? ''));

// The callers pass non-overlapping spans, but a bad span must degrade safely
// rather than splice the string at a corrupted offset.
const overlapping = redactLocalSemanticText(source, [
  { start: 12, end: 21, kind: 'money' },
  { start: 15, end: 20, kind: 'merchant' },
]);
ok('an overlapping span is skipped, not spliced at a corrupt offset',
  typeof overlapping === 'string' && overlapping.startsWith('Purchase of <money>'),
  overlapping);

ok('a span outside the source is ignored',
  redactLocalSemanticText('short', [{ start: 0, end: 9_000, kind: 'money' }]) === 'short');

ok('an inverted span is ignored',
  redactLocalSemanticText('short', [{ start: 4, end: 1, kind: 'money' }]) === 'short');

ok('empty input is null, not an empty string',
  redactLocalSemanticText('', []) === null && redactLocalSemanticText('   ', []) === null);

ok('text with no spans is returned intact',
  redactLocalSemanticText('salary credited', []) === 'salary credited');

ok('movement language is preserved — it is the whole semantic signal',
  redactLocalSemanticText('Refund of AED 10 from ACME', [{ start: 10, end: 16, kind: 'money' }])
    === 'Refund of <money> from ACME');

/* ── Retriever ───────────────────────────────────────────────────────── */

const unit = (values) => {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => value / norm);
};
const dimensions = 4;
const encoderFor = (vector, modelVersion = 'test-model') => ({
  manifest: {
    schemaVersion: 1,
    modelVersion,
    backend: 'onnxruntime-react-native',
    graphFormat: 'onnx',
    quantization: 'dynamic-int8',
    embeddingDimensions: dimensions,
    maximumCharacters: 1000,
  },
  encode: async () => Float32Array.from(vector),
});
const index = {
  schemaVersion: 1,
  modelVersion: 'test-model',
  embeddingDimensions: dimensions,
  scoreScale: 'raw-cosine',
  aggregation: 'max-per-prototype-id',
  prototypes: [
    { id: 'a', domain: 'test', vector: unit([1, 0, 0, 0]) },
    { id: 'a', domain: 'test', vector: unit([0.9, 0.1, 0, 0]) }, // same id, weaker
    { id: 'b', domain: 'test', vector: unit([0, 1, 0, 0]) },
  ],
};

(async () => {
  const retriever = createLocalSemanticRetriever(encoderFor(unit([1, 0, 0, 0])), index);
  const matches = await retriever.retrieve('anything');

  ok('max-per-prototype-id collapses duplicate ids to one row',
    matches.length === 2, JSON.stringify(matches));

  ok('the best vector represents its id',
    Math.abs(matches[0].score - 1) < 1e-6, JSON.stringify(matches[0]));

  ok('matches come back ranked by score',
    matches[0].id === 'a' && matches[1].id === 'b');

  ok('an orthogonal prototype scores ~0, not ~1',
    Math.abs(matches[1].score) < 1e-6, String(matches[1].score));

  ok('limit is honoured',
    (await retriever.retrieve('anything', 1)).length === 1);

  // A model whose embeddings mean something different must never be scored
  // against an index built for another one.
  let mismatched = false;
  try {
    createLocalSemanticRetriever(encoderFor(unit([1, 0, 0, 0]), 'other-model'), index);
  } catch { mismatched = true; }
  ok('a model-version mismatch is refused, not silently scored', mismatched);

  let wrongDimensions = false;
  try {
    createLocalSemanticRetriever(encoderFor(unit([1, 0, 0, 0])), { ...index, embeddingDimensions: 384 });
  } catch { wrongDimensions = true; }
  ok('a dimension mismatch is refused', wrongDimensions);

  /* ── The certification stub must stay fail-closed ──────────────────── */

  const certification = certifyUniversalTemplate({
    market: 'GB',
    institution: 'Example Bank',
    source: 'anything at all',
    event: { decision: 'review', family: 'purchase' },
    rail: null,
    allowSemanticGeneralization: true,
  });

  ok('the certification stub never grants automatic import',
    certification.decision !== 'automatic' && certification.decision !== 'semantic-generalized',
    certification.decision);

  ok('...even when semantic generalization is authorized',
    certification.decision === 'review', certification.decision);

  ok('it names itself as unrecovered rather than looking like a real verdict',
    certification.reason === 'certification-module-not-recovered' && certification.templateId === null);

  /* ── Provenance ───────────────────────────────────────────────────── */

  ok('the build declares which local-semantic module it carries',
    LOCAL_SEMANTIC_MODEL_PROVENANCE === 'reconstructed-plumbing-harness' ||
    LOCAL_SEMANTIC_MODEL_PROVENANCE === 'original',
    String(LOCAL_SEMANTIC_MODEL_PROVENANCE));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
