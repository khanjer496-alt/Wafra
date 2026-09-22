import { isAssistantToolRequest } from '@/lib/wafra-assistant-ai';

import type { SourceSpan } from '@/lib/alert-draft';
import type { Period } from '@/lib/period';
import type { UniversalBankEvent } from '@/lib/universal-types';
import type { AssistantTool, AssistantToolRequest } from '@/lib/wafra-assistant';

export type LocalSemanticDomain = 'assistant-intent' | 'parser-family';

export type LocalSemanticFieldKind =
  | 'money'
  | 'merchant'
  | 'instrument'
  | 'date'
  | 'reference'
  | 'field';

export type LocalSemanticMerchantHint = 'fee' | 'refund' | 'atm';

export interface LocalSemanticSensitiveSpan extends SourceSpan {
  /**
   * The deterministic parser owns this role. The local model receives only a
   * typed placeholder, never the underlying value. Omit for legacy <field>.
   */
  kind?: LocalSemanticFieldKind;
  /** Preserve accounting semantics without exposing the merchant identity. */
  merchantHint?: LocalSemanticMerchantHint;
}

/**
 * Runtime-neutral description of the native model session. The eventual
 * onnxruntime-react-native loader implements this interface after it verifies
 * the downloaded artifacts and creates the tokenizer/encoder sessions.
 */
export interface LocalOnnxInt8ModelManifest {
  schemaVersion: 1;
  modelVersion: string;
  backend: 'onnxruntime-react-native';
  graphFormat: 'onnx';
  quantization: 'dynamic-int8';
  embeddingDimensions: number;
  maximumCharacters: number;
}

export interface LocalOnnxInt8TextEncoder {
  readonly manifest: LocalOnnxInt8ModelManifest;
  encode(text: string): Promise<ArrayLike<number>>;
}

export interface LocalSemanticPrototypeVector {
  id: string;
  domain: LocalSemanticDomain;
  vector: ArrayLike<number>;
}

/** Prototype vectors are generated offline with the exact pinned model. */
export interface LocalSemanticPrototypeIndex {
  schemaVersion: 1;
  modelVersion: string;
  embeddingDimensions: number;
  scoreScale: 'raw-cosine';
  aggregation: 'max-per-prototype-id';
  prototypes: readonly LocalSemanticPrototypeVector[];
}

export interface LocalSemanticCandidate {
  v: 1;
  prototypeId: string;
  score: number;
  runnerUpScore: number;
}

export interface LocalSemanticRetriever {
  readonly manifest: Readonly<LocalOnnxInt8ModelManifest>;
  retrieve(
    domain: LocalSemanticDomain,
    text: string,
    cancelled?: () => boolean,
  ): Promise<LocalSemanticCandidate | null>;
}

export interface LocalParserFamilyLinearHead {
  schemaVersion: 1;
  modelVersion: string;
  embeddingDimensions: number;
  scoreScale: 'softmax-probability';
  kind: 'linear-softmax-parser-family';
  classes: readonly LocalParserFamily[];
  weights: readonly (readonly number[])[];
  intercept: readonly number[];
  minimumProbability: number;
  minimumMargin: number;
  trainingEvidence?: Readonly<{
    privacySafeAnchorRows: number;
    personalRowsUsedForTraining: 0;
  }>;
}

export interface LocalParserFamilyHeadCandidate {
  v: 1;
  family: LocalParserFamily;
  probability: number;
  runnerUpProbability: number;
}

export interface LocalParserFamilyClassifier {
  readonly manifest: Readonly<LocalOnnxInt8ModelManifest>;
  classify(text: string, cancelled?: () => boolean): Promise<LocalParserFamilyHeadCandidate | null>;
}

export interface LocalParserFamilyHeadThresholds {
  minimumProbability: number;
  minimumMargin: number;
}

export interface LocalSemanticThresholds {
  minimumScore: number;
  minimumMargin: number;
}

/**
 * Measured, not chosen. `npm run eval:assistant-routing` scores the shipping
 * path over 127 held-out questions — 75 in scope, 52 out of it, none of them an
 * anchor — and the two gates behave nothing alike.
 *
 * `minimumScore` is inert for `assistant-intent` and cannot be made useful. In
 * scope the cosine runs 0.817 to 0.987; out of scope it runs 0.816 to 0.938. The
 * distributions overlap almost entirely, because E5 places any short question
 * near any short prototype: "what is the weather in dubai tomorrow" scores 0.87
 * against a financial intent. Any value above 0.817 starts discarding correct
 * routes without blocking a single wrong one, so this stays low deliberately.
 * It is kept as a floor against a degenerate vector, not as a relevance test.
 *
 * `minimumMargin` does all the work. It is not a confidence score — it asks
 * whether the nearest two intents are distinguishable at all, and on this corpus
 * that tracks correctness almost exactly. Ungated top-1 is only 32/57; the
 * margin discards very nearly the set it gets wrong:
 *
 *     margin   routed   correct   wrong   out-of-scope leaks
 *      0.08         2         2       0       0
 *      0.05         4         4       0       0
 *      0.04         9         9       0       0
 *      0.03        11        11       0       0
 *      0.02        15        15       0       2
 *      0.01        28        22       6       5
 *      0.00        57        32      25      35
 *
 * 0.08 was calibrated when ten intents were registered. With twenty-two the
 * space is denser and 0.08 routes almost nothing: the index expansion is worth
 * nothing without this change, and this change is unjustified without the index.
 *
 * 0.04 rather than 0.03 buys headroom over the worst out-of-scope margin
 * observed, 0.027 — "احذف كل معاملاتي" ("delete all my transactions") landing on
 * `money-review`, which is the vaguest intent and therefore the sink for any
 * imperative. Thirty-two adversarial rows in a financial register ("can i afford
 * a car", "set me a budget for dining", "why is my balance wrong") did not push
 * that tail any higher, so 0.04 sits about half again above a tail measured by
 * trying to break it, where 0.03 sat 0.003 above it. Coverage 9 vs 11 is the
 * price, and a refusal costs a rephrase while a wrong route spends the user's
 * attention on a correct answer to a question they did not ask.
 *
 * Nothing routed can move money or records: the registry maps every prototype to
 * a read-only tool in `ASSISTANT_TOOL_CATALOG` and the compiled request must pass
 * `isAssistantToolRequest`. A leak here is a wrong answer, never a wrong action.
 *
 * Re-run the evaluation before touching either number.
 */
export const LOCAL_SEMANTIC_THRESHOLDS: Readonly<Record<LocalSemanticDomain, LocalSemanticThresholds>> =
  Object.freeze({
    'assistant-intent': Object.freeze({ minimumScore: 0.72, minimumMargin: 0.04 }),
    'parser-family': Object.freeze({ minimumScore: 0.78, minimumMargin: 0.1 }),
  });

/**
 * Every policy must be fully determined by code. A prototype id says only which
 * question was asked; it never carries an argument, because the index is data
 * and a merchant name, category or account id chosen by a nearest-neighbour
 * search is a value the user never supplied. An intent whose tool NEEDS such an
 * argument therefore gets no prototype at all — see the argument-dependent
 * groups in `scripts/local-ai/assistant-anchors.js`.
 */
type AssistantPolicy =
  | 'no-arguments'
  | 'default-period'
  | 'current-calendar-month'
  | 'default-30-days'
  | 'default-period-default-limit'
  | 'default-period-typical-baseline'
  | 'cash-withdrawal-category';

interface AssistantPrototypeDefinition {
  kind: 'assistant-intent';
  tool: AssistantTool;
  policy: AssistantPolicy;
}

export type LocalParserFamily =
  | 'purchase'
  | 'transfer'
  | 'cash-withdrawal'
  | 'refund'
  | 'fee'
  | 'utility'
  | 'recurring-payment'
  | 'statement'
  | 'balance'
  | 'bill'
  | 'card-payment';

interface ParserPrototypeDefinition {
  kind: 'parser-family';
  family: LocalParserFamily;
}

type LocalSemanticPrototypeDefinition = AssistantPrototypeDefinition | ParserPrototypeDefinition;

export const LOCAL_SEMANTIC_REGISTRY: Readonly<Record<string, LocalSemanticPrototypeDefinition>> = Object.freeze({
  'ask.help': Object.freeze({ kind: 'assistant-intent', tool: 'help', policy: 'no-arguments' }),
  'ask.spending.total.current-scope': Object.freeze({
    kind: 'assistant-intent', tool: 'spending-total', policy: 'default-period',
  }),
  'ask.spending.total.current-month': Object.freeze({
    kind: 'assistant-intent', tool: 'spending-total', policy: 'current-calendar-month',
  }),
  'ask.income.total.current-scope': Object.freeze({
    kind: 'assistant-intent', tool: 'income-total', policy: 'default-period',
  }),
  'ask.subscriptions.active': Object.freeze({
    kind: 'assistant-intent', tool: 'subscriptions', policy: 'no-arguments',
  }),
  'ask.upcoming.default-window': Object.freeze({
    kind: 'assistant-intent', tool: 'upcoming-payments', policy: 'default-30-days',
  }),
  'ask.top-merchants.current-scope': Object.freeze({
    kind: 'assistant-intent', tool: 'top-merchants', policy: 'default-period-default-limit',
  }),
  'ask.top-categories.current-scope': Object.freeze({
    kind: 'assistant-intent', tool: 'top-categories', policy: 'default-period-default-limit',
  }),
  'ask.duplicates.current-scope': Object.freeze({
    kind: 'assistant-intent', tool: 'possible-duplicates', policy: 'default-period',
  }),
  'ask.money-review.current-scope': Object.freeze({
    kind: 'assistant-intent', tool: 'money-review', policy: 'default-period',
  }),
  'ask.data-coverage.current-scope': Object.freeze({
    kind: 'assistant-intent', tool: 'data-coverage', policy: 'default-period',
  }),
  'ask.compare.periods': Object.freeze({
    kind: 'assistant-intent', tool: 'compare-periods', policy: 'default-period',
  }),
  'ask.largest-purchases': Object.freeze({
    kind: 'assistant-intent', tool: 'largest-purchases', policy: 'default-period-default-limit',
  }),
  'ask.daily-average': Object.freeze({
    kind: 'assistant-intent', tool: 'daily-average', policy: 'default-period',
  }),
  'ask.net-income-spending': Object.freeze({
    kind: 'assistant-intent', tool: 'net-income-spending', policy: 'default-period',
  }),
  'ask.cash-withdrawal.category': Object.freeze({
    kind: 'assistant-intent', tool: 'category-breakdown', policy: 'cash-withdrawal-category',
  }),
  'ask.month-forecast': Object.freeze({
    kind: 'assistant-intent', tool: 'month-forecast', policy: 'current-calendar-month',
  }),
  'ask.historical-baseline': Object.freeze({
    kind: 'assistant-intent', tool: 'historical-baseline', policy: 'default-period-typical-baseline',
  }),
  'ask.account-inventory': Object.freeze({
    kind: 'assistant-intent', tool: 'account-inventory', policy: 'no-arguments',
  }),
  'ask.top-accounts': Object.freeze({
    kind: 'assistant-intent', tool: 'top-accounts', policy: 'default-period-default-limit',
  }),
  'ask.credit-card-settlement-summary': Object.freeze({
    kind: 'assistant-intent', tool: 'credit-card-settlement-summary', policy: 'no-arguments',
  }),
  'ask.recurring-changes': Object.freeze({
    kind: 'assistant-intent', tool: 'recurring-changes', policy: 'default-period',
  }),
  'ask.unusual-charges': Object.freeze({
    kind: 'assistant-intent', tool: 'unusual-charges', policy: 'default-period',
  }),
  'parser.family.purchase': Object.freeze({ kind: 'parser-family', family: 'purchase' }),
  'parser.family.transfer': Object.freeze({ kind: 'parser-family', family: 'transfer' }),
  'parser.family.cash-withdrawal': Object.freeze({ kind: 'parser-family', family: 'cash-withdrawal' }),
  'parser.family.refund': Object.freeze({ kind: 'parser-family', family: 'refund' }),
  'parser.family.fee': Object.freeze({ kind: 'parser-family', family: 'fee' }),
  'parser.family.utility': Object.freeze({ kind: 'parser-family', family: 'utility' }),
  'parser.family.recurring-payment': Object.freeze({ kind: 'parser-family', family: 'recurring-payment' }),
  'parser.family.statement': Object.freeze({ kind: 'parser-family', family: 'statement' }),
  'parser.family.balance': Object.freeze({ kind: 'parser-family', family: 'balance' }),
  'parser.family.bill': Object.freeze({ kind: 'parser-family', family: 'bill' }),
  'parser.family.card-payment': Object.freeze({ kind: 'parser-family', family: 'card-payment' }),
});

export const LOCAL_SEMANTIC_PROTOTYPE_IDS = Object.freeze(Object.keys(LOCAL_SEMANTIC_REGISTRY));

export type LocalSemanticGateReason =
  | 'malformed-candidate'
  | 'unknown-or-invalid-prototype'
  | 'low-score'
  | 'low-margin';

export type LocalSemanticFallbackReason =
  | LocalSemanticGateReason
  | 'deterministic-plan-authoritative'
  | 'conversation-context-present'
  | 'invalid-question'
  | 'model-unavailable'
  | 'compiled-request-rejected'
  | 'event-not-reviewable'
  | 'event-not-a-posting-candidate'
  | 'deterministic-family-known'
  | 'deterministic-money-required'
  | 'unsafe-parser-state'
  | 'invalid-semantic-text';

type AcceptedCandidate = {
  kind: 'accepted';
  prototypeId: string;
  score: number;
  runnerUpScore: number;
  definition: LocalSemanticPrototypeDefinition;
};

type RefusedCandidate = { kind: 'refused'; reason: LocalSemanticGateReason };

const CANDIDATE_KEYS = new Set(['v', 'prototypeId', 'score', 'runnerUpScore']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean =>
  Object.keys(value).length === allowed.size && Object.keys(value).every((key) => allowed.has(key));

const validScore = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= -1 && value <= 1;

const safeThresholds = (
  domain: LocalSemanticDomain,
  thresholds?: Partial<LocalSemanticThresholds>,
): LocalSemanticThresholds => {
  const defaults = LOCAL_SEMANTIC_THRESHOLDS[domain];
  const requestedMinimumScore = typeof thresholds?.minimumScore === 'number' &&
    Number.isFinite(thresholds.minimumScore) && thresholds.minimumScore >= -1 && thresholds.minimumScore <= 1
    ? thresholds.minimumScore : defaults.minimumScore;
  const requestedMinimumMargin = typeof thresholds?.minimumMargin === 'number' &&
    Number.isFinite(thresholds.minimumMargin) && thresholds.minimumMargin >= 0 && thresholds.minimumMargin <= 2
    ? thresholds.minimumMargin : defaults.minimumMargin;
  return {
    minimumScore: Math.max(defaults.minimumScore, requestedMinimumScore),
    minimumMargin: Math.max(defaults.minimumMargin, requestedMinimumMargin),
  };
};

/** Rejects extra fields so a model cannot attach money, status, or identifiers. */
export function gateLocalSemanticCandidate(
  candidate: unknown,
  domain: LocalSemanticDomain,
  thresholds?: Partial<LocalSemanticThresholds>,
): AcceptedCandidate | RefusedCandidate {
  if (!isRecord(candidate) || !exactKeys(candidate, CANDIDATE_KEYS) || candidate.v !== 1 ||
      typeof candidate.prototypeId !== 'string' || !candidate.prototypeId || candidate.prototypeId.length > 120 ||
      !validScore(candidate.score) || !validScore(candidate.runnerUpScore) ||
      candidate.runnerUpScore > candidate.score) {
    return { kind: 'refused', reason: 'malformed-candidate' };
  }
  const definition = LOCAL_SEMANTIC_REGISTRY[candidate.prototypeId];
  if (!definition || definition.kind !== domain) {
    return { kind: 'refused', reason: 'unknown-or-invalid-prototype' };
  }
  const limits = safeThresholds(domain, thresholds);
  if (candidate.score < limits.minimumScore) return { kind: 'refused', reason: 'low-score' };
  if (candidate.score - candidate.runnerUpScore < limits.minimumMargin) {
    return { kind: 'refused', reason: 'low-margin' };
  }
  return Object.freeze({
    kind: 'accepted',
    prototypeId: candidate.prototypeId,
    score: candidate.score,
    runnerUpScore: candidate.runnerUpScore,
    definition,
  });
}

const configurationError = (reason: string): Error => new Error(`local-semantic-model:${reason}`);

const normalizeVector = (vector: ArrayLike<number>, dimensions: number): Float32Array | null => {
  if (!vector || vector.length !== dimensions) return null;
  const output = new Float32Array(dimensions);
  let squaredNorm = 0;
  for (let index = 0; index < dimensions; index += 1) {
    const value = Number(vector[index]);
    if (!Number.isFinite(value)) return null;
    output[index] = value;
    squaredNorm += value * value;
  }
  if (!Number.isFinite(squaredNorm) || squaredNorm <= 1e-12) return null;
  const inverseNorm = 1 / Math.sqrt(squaredNorm);
  for (let index = 0; index < dimensions; index += 1) output[index] *= inverseNorm;
  return output;
};

const dot = (left: Float32Array, right: Float32Array): number => {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) total += left[index] * right[index];
  return Math.max(-1, Math.min(1, total));
};

/**
 * Converts an ONNX encoder into a bounded nearest-prototype retriever. It keeps
 * only app-owned normalized prototype vectors and never stores source text,
 * token IDs, or query embeddings after a call finishes.
 */
export function createLocalSemanticRetriever(
  encoder: LocalOnnxInt8TextEncoder,
  index: LocalSemanticPrototypeIndex,
): LocalSemanticRetriever {
  const manifest = encoder?.manifest;
  if (!manifest || manifest.schemaVersion !== 1 || manifest.backend !== 'onnxruntime-react-native' ||
      manifest.graphFormat !== 'onnx' || manifest.quantization !== 'dynamic-int8') {
    throw configurationError('unsupported-runtime');
  }
  if (typeof encoder.encode !== 'function') throw configurationError('missing-encoder');
  if (typeof manifest.modelVersion !== 'string' || !manifest.modelVersion || manifest.modelVersion.length > 160) {
    throw configurationError('invalid-model-version');
  }
  if (!Number.isInteger(manifest.embeddingDimensions) || manifest.embeddingDimensions < 2 ||
      manifest.embeddingDimensions > 4096) throw configurationError('invalid-embedding-dimensions');
  if (!Number.isInteger(manifest.maximumCharacters) || manifest.maximumCharacters < 32 ||
      manifest.maximumCharacters > 4096) throw configurationError('invalid-input-bound');
  if (!index || index.schemaVersion !== 1 || index.modelVersion !== manifest.modelVersion ||
      index.embeddingDimensions !== manifest.embeddingDimensions || index.scoreScale !== 'raw-cosine' ||
      index.aggregation !== 'max-per-prototype-id' || !Array.isArray(index.prototypes) ||
      index.prototypes.length < 2 || index.prototypes.length > 256) {
    throw configurationError('prototype-index-mismatch');
  }

  const prepared = index.prototypes.map((prototype) => {
    if (!prototype || typeof prototype.id !== 'string' || !prototype.id || prototype.id.length > 120) {
      throw configurationError('invalid-prototype-id');
    }
    const definition = LOCAL_SEMANTIC_REGISTRY[prototype.id];
    if (!definition || definition.kind !== prototype.domain) throw configurationError('unregistered-prototype');
    const vector = normalizeVector(prototype.vector, manifest.embeddingDimensions);
    if (!vector) throw configurationError('invalid-prototype-vector');
    return Object.freeze({ id: prototype.id, domain: prototype.domain, vector });
  });

  const frozenManifest = Object.freeze({ ...manifest });
  return Object.freeze({
    manifest: frozenManifest,
    async retrieve(domain: LocalSemanticDomain, text: string, cancelled: () => boolean = () => false) {
      const clean = typeof text === 'string' ? text.trim() : '';
      if (!clean || clean.length > frozenManifest.maximumCharacters || cancelled()) return null;
      const domainPrototypes = prepared.filter((prototype) => prototype.domain === domain);
      // Several seed phrases may represent one app-owned prototype ID. A margin
      // has meaning only between distinct IDs, not between two phrasings of the
      // same intent, so fail closed until this domain has two classes.
      if (new Set(domainPrototypes.map((prototype) => prototype.id)).size < 2) return null;
      let encoded: ArrayLike<number>;
      try {
        encoded = await encoder.encode(clean);
      } catch {
        return null;
      }
      if (cancelled()) return null;
      const query = normalizeVector(encoded, frozenManifest.embeddingDimensions);
      if (!query) return null;
      const bestScoreByPrototype = new Map<string, number>();
      for (const prototype of domainPrototypes) {
        const score = dot(query, prototype.vector);
        const previous = bestScoreByPrototype.get(prototype.id);
        if (previous === undefined || score > previous) bestScoreByPrototype.set(prototype.id, score);
      }
      const ranked = [...bestScoreByPrototype]
        .map(([prototypeId, score]) => ({ prototypeId, score }))
        .sort((left, right) => right.score - left.score || left.prototypeId.localeCompare(right.prototypeId));
      const best = ranked[0], runnerUp = ranked[1];
      return Object.freeze({
        v: 1 as const,
        prototypeId: best.prototypeId,
        score: best.score,
        runnerUpScore: runnerUp.score,
      });
    },
  });
}

const parserFamilySet = new Set<LocalParserFamily>([
  'purchase', 'transfer', 'cash-withdrawal', 'refund', 'fee', 'utility',
  'recurring-payment', 'statement', 'balance', 'bill', 'card-payment',
]);

const safeProbability = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

const safeParserHeadThresholds = (
  head: LocalParserFamilyLinearHead,
  thresholds?: Partial<LocalParserFamilyHeadThresholds>,
): LocalParserFamilyHeadThresholds => {
  const probability = safeProbability(thresholds?.minimumProbability)
    ? thresholds!.minimumProbability! : head.minimumProbability;
  const margin = safeProbability(thresholds?.minimumMargin)
    ? thresholds!.minimumMargin! : head.minimumMargin;
  return {
    minimumProbability: Math.max(head.minimumProbability, probability),
    minimumMargin: Math.max(head.minimumMargin, margin),
  };
};

const validateParserFamilyHead = (
  manifest: LocalOnnxInt8ModelManifest,
  head: LocalParserFamilyLinearHead,
): void => {
  if (!head || head.schemaVersion !== 1 || head.kind !== 'linear-softmax-parser-family' ||
      head.scoreScale !== 'softmax-probability' || head.modelVersion !== manifest.modelVersion ||
      head.embeddingDimensions !== manifest.embeddingDimensions ||
      !Array.isArray(head.classes) || head.classes.length < 2 || head.classes.length > 11 ||
      new Set(head.classes).size !== head.classes.length ||
      head.classes.some((family) => !parserFamilySet.has(family)) ||
      !Array.isArray(head.weights) || head.weights.length !== head.classes.length ||
      !Array.isArray(head.intercept) || head.intercept.length !== head.classes.length ||
      !safeProbability(head.minimumProbability) || !safeProbability(head.minimumMargin) ||
      head.minimumMargin > 1) {
    throw configurationError('invalid-parser-family-head');
  }
  for (const row of head.weights) {
    if (!Array.isArray(row) || row.length !== manifest.embeddingDimensions ||
        row.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
      throw configurationError('invalid-parser-family-head');
    }
  }
  if (head.intercept.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw configurationError('invalid-parser-family-head');
  }
  const evidence = head.trainingEvidence;
  if (evidence && (!Number.isInteger(evidence.privacySafeAnchorRows) || evidence.privacySafeAnchorRows < 1 ||
      evidence.personalRowsUsedForTraining !== 0)) {
    throw configurationError('invalid-parser-family-head');
  }
};

/**
 * Creates a tiny closed-set semantic family classifier on top of the shared
 * local encoder. The head owns no finance fields: it consumes one normalized
 * embedding and returns only a family plus calibrated probabilities.
 */
export function createLocalParserFamilyClassifier(
  encoder: LocalOnnxInt8TextEncoder,
  head: LocalParserFamilyLinearHead,
  thresholds?: Partial<LocalParserFamilyHeadThresholds>,
): LocalParserFamilyClassifier {
  const manifest = encoder?.manifest;
  if (!manifest || manifest.schemaVersion !== 1 || manifest.backend !== 'onnxruntime-react-native' ||
      manifest.graphFormat !== 'onnx' || manifest.quantization !== 'dynamic-int8') {
    throw configurationError('unsupported-runtime');
  }
  if (typeof encoder.encode !== 'function') throw configurationError('missing-encoder');
  if (typeof manifest.modelVersion !== 'string' || !manifest.modelVersion || manifest.modelVersion.length > 160 ||
      !Number.isInteger(manifest.embeddingDimensions) || manifest.embeddingDimensions < 2 ||
      manifest.embeddingDimensions > 4096 || !Number.isInteger(manifest.maximumCharacters) ||
      manifest.maximumCharacters < 32 || manifest.maximumCharacters > 4096) {
    throw configurationError('invalid-model-manifest');
  }
  validateParserFamilyHead(manifest, head);
  const limits = safeParserHeadThresholds(head, thresholds);
  const frozenManifest = Object.freeze({ ...manifest });

  return Object.freeze({
    manifest: frozenManifest,
    async classify(text: string, cancelled: () => boolean = () => false) {
      const clean = typeof text === 'string' ? text.trim() : '';
      if (!clean || clean.length > frozenManifest.maximumCharacters || cancelled()) return null;
      let encoded: ArrayLike<number>;
      try {
        encoded = await encoder.encode(clean);
      } catch {
        return null;
      }
      if (cancelled()) return null;
      const vector = normalizeVector(encoded, frozenManifest.embeddingDimensions);
      if (!vector) return null;

      const logits = head.weights.map((row, classIndex) => {
        let total = head.intercept[classIndex];
        for (let index = 0; index < vector.length; index += 1) total += row[index] * vector[index];
        return total;
      });
      const maximum = Math.max(...logits);
      const exponents = logits.map((value) => Math.exp(value - maximum));
      const denominator = exponents.reduce((sum, value) => sum + value, 0);
      if (!Number.isFinite(denominator) || denominator <= 0) return null;
      const ranked = exponents
        .map((value, index) => ({ index, probability: value / denominator }))
        .sort((left, right) => right.probability - left.probability || left.index - right.index);
      const best = ranked[0], runnerUp = ranked[1];
      if (best.probability < limits.minimumProbability ||
          best.probability - runnerUp.probability < limits.minimumMargin) return null;
      return Object.freeze({
        v: 1 as const,
        family: head.classes[best.index],
        probability: best.probability,
        runnerUpProbability: runnerUp.probability,
      });
    },
  });
}

const copyPeriod = (period: Period): Period => {
  switch (period.mode) {
    case 'month': return { mode: 'month', key: period.key };
    case 'year': return { mode: 'year', year: period.year };
    case 'range': return { mode: 'range', from: period.from, to: period.to };
    case 'all': return { mode: 'all' };
  }
};

const compileAssistantDefinition = (
  definition: AssistantPrototypeDefinition,
  defaultPeriod: Period,
  currentPeriod: Period,
): unknown => {
  switch (definition.policy) {
    case 'no-arguments':
      return { tool: definition.tool };
    case 'default-period':
      return { tool: definition.tool, period: copyPeriod(defaultPeriod) };
    case 'current-calendar-month':
      return { tool: definition.tool, period: copyPeriod(currentPeriod) };
    case 'default-30-days':
      return { tool: definition.tool, withinDays: 30 };
    case 'default-period-default-limit':
      return { tool: definition.tool, period: copyPeriod(defaultPeriod), limit: 5 };
    // `historical-baseline` refuses without a baseline, and the four choices
    // answer different questions. The anchored phrasings all ask the same one
    // ("is this normal for me", "what do I usually spend"), so the typical
    // month is the policy — a code decision recorded here, not a model's.
    case 'default-period-typical-baseline':
      return { tool: definition.tool, period: copyPeriod(defaultPeriod), baseline: 'typical-month' };
    // The one category a question can name unambiguously without any lookup:
    // asking about cash withdrawn is asking about `cash-withdrawal`, which is a
    // Wafra category id. Every other category has to be resolved from the words
    // the user typed, which is the deterministic planner's job.
    case 'cash-withdrawal-category':
      return { tool: definition.tool, period: copyPeriod(defaultPeriod), category: 'cash-withdrawal' };
  }
};

const UNRECOGNIZED_HELP_KEYS = new Set(['tool', 'clarification', 'suggestions', 'unrecognized']);

/**
 * Only Help that recognised nothing may reach the model: exact plain Help, or
 * the planner's "didn't understand" clarification, which it marks
 * `unrecognized`. Every other Help (a named merchant that was not found, an
 * unsupported condition, a safety refusal) stays deterministic.
 */
const isExactPlainHelp = (request: AssistantToolRequest): boolean => {
  if (request.tool !== 'help') return false;
  const keys = Object.keys(request);
  if (keys.length === 1) return true;
  return (request as { unrecognized?: unknown }).unrecognized === true &&
    keys.every((key) => UNRECOGNIZED_HELP_KEYS.has(key));
};

const freezeCompiledAssistantRequest = (request: AssistantToolRequest): AssistantToolRequest => {
  const period = (request as unknown as Record<string, unknown>).period;
  if (isRecord(period)) Object.freeze(period);
  return Object.freeze(request);
};

export type LocalSemanticAssistantPlan =
  | {
      source: 'deterministic';
      request: AssistantToolRequest;
      fallbackReason: LocalSemanticFallbackReason;
    }
  | {
      source: 'local-semantic';
      request: AssistantToolRequest;
      prototypeId: string;
      score: number;
      margin: number;
    };

/**
 * Optional Ask Wafra fallback. Call planAssistantQuestion first and pass its
 * result here. Only exact plain help from a fresh question can reach the model;
 * every compiled request must then pass the existing production validator.
 */
export async function chooseLocalSemanticAssistantPlan(input: {
  question: string;
  deterministicRequest: AssistantToolRequest;
  previousRequest?: AssistantToolRequest | null;
  defaultPeriod: Period;
  currentPeriod: Period;
  retriever: LocalSemanticRetriever;
  thresholds?: Partial<LocalSemanticThresholds>;
  cancelled?: () => boolean;
}): Promise<LocalSemanticAssistantPlan> {
  const deterministic = (fallbackReason: LocalSemanticFallbackReason): LocalSemanticAssistantPlan => ({
    source: 'deterministic', request: input.deterministicRequest, fallbackReason,
  });
  if (!isExactPlainHelp(input.deterministicRequest)) return deterministic('deterministic-plan-authoritative');
  if (input.previousRequest) return deterministic('conversation-context-present');
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (!question || question.length > 1_000) return deterministic('invalid-question');
  let candidate: LocalSemanticCandidate | null;
  try {
    candidate = await input.retriever.retrieve('assistant-intent', question, input.cancelled);
  } catch {
    return deterministic('model-unavailable');
  }
  if (!candidate) return deterministic('model-unavailable');
  const gated = gateLocalSemanticCandidate(candidate, 'assistant-intent', input.thresholds);
  if (gated.kind !== 'accepted') return deterministic(gated.reason);
  const definition = gated.definition as AssistantPrototypeDefinition;
  const compiled = compileAssistantDefinition(definition, input.defaultPeriod, input.currentPeriod);
  if (!isAssistantToolRequest(compiled)) return deterministic('compiled-request-rejected');
  return Object.freeze({
    source: 'local-semantic',
    request: freezeCompiledAssistantRequest(compiled),
    prototypeId: gated.prototypeId,
    score: gated.score,
    margin: gated.score - gated.runnerUpScore,
  });
}

const localSemanticSpanToken = (span: LocalSemanticSensitiveSpan): string | null => {
  const kind = span.kind ?? 'field';
  if (kind === 'money') return '<money>';
  if (kind === 'instrument') return '<instrument>';
  if (kind === 'date') return '<date>';
  if (kind === 'reference') return '<reference>';
  if (kind === 'merchant') {
    if (span.merchantHint === 'fee') return '<fee>';
    if (span.merchantHint === 'refund') return '<refund>';
    if (span.merchantHint === 'atm') return '<atm>';
    if (span.merchantHint !== undefined) return null;
    return '<merchant>';
  }
  if (kind === 'field' && span.merchantHint === undefined) return '<field>';
  return null;
};

/** Redacts only deterministic spans supplied by the parser/caller. */
export function redactLocalSemanticText(
  source: string,
  sensitiveSpans: readonly LocalSemanticSensitiveSpan[],
): string | null {
  if (typeof source !== 'string' || !source.trim() || source.length > 4_096 ||
      !Array.isArray(sensitiveSpans) || sensitiveSpans.length > 64) return null;
  const spans = sensitiveSpans.map((span) => ({
    start: span.start,
    end: span.end,
    token: localSemanticSpanToken(span),
  }));
  for (const span of spans) {
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 ||
        span.end <= span.start || span.end > source.length || span.token === null) return null;
  }
  spans.sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < spans.length; index += 1) {
    if (spans[index].start < spans[index - 1].end) return null;
  }
  let redacted = source;
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const span = spans[index];
    redacted = `${redacted.slice(0, span.start)} ${span.token} ${redacted.slice(span.end)}`;
  }
  return redacted
    .replace(/\p{N}{4,}/gu, '<digits>')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 1_000);
}

export type LocalParserFamilyAdvisoryResult =
  | {
      kind: 'parser-family-advisory';
      advisoryOnly: true;
      prototypeId: string;
      family: LocalParserFamily;
      score: number;
      margin: number;
    }
  | { kind: 'refused'; reason: LocalSemanticFallbackReason };

const UNSAFE_PARSER_ISSUES = new Set([
  'authentication-not-posting',
  'pending-not-posting',
  'failed-not-posting',
  'promotion-not-posting',
  'multiple-event-adapter-required',
  'settlement-adapter-required',
]);

const hasGroundedTransactionMoney = (event: UniversalBankEvent): boolean =>
  event.amount.evidence !== 'missing' &&
  (event.amount.value !== null || event.amount.alternatives.length > 0);

/**
 * Produces a separate parser-family advisory. It cannot modify the event and is
 * only available when deterministic parsing already admitted a reviewable,
 * unknown-family transaction with grounded money.
 */
export async function createLocalParserFamilyAdvisory(input: {
  event: UniversalBankEvent;
  semanticText: string;
  sensitiveSpans: readonly LocalSemanticSensitiveSpan[];
  retriever: LocalSemanticRetriever;
  thresholds?: Partial<LocalSemanticThresholds>;
  cancelled?: () => boolean;
}): Promise<LocalParserFamilyAdvisoryResult> {
  const refused = (reason: LocalSemanticFallbackReason): LocalParserFamilyAdvisoryResult =>
    ({ kind: 'refused', reason });
  if (!input.event || input.event.decision !== 'review') return refused('event-not-reviewable');
  if (input.event.status !== 'posted' && input.event.status !== 'unknown') {
    return refused('event-not-a-posting-candidate');
  }
  if (input.event.family !== 'unknown') return refused('deterministic-family-known');
  if (!hasGroundedTransactionMoney(input.event)) return refused('deterministic-money-required');
  if (input.event.issues.some((issue) => UNSAFE_PARSER_ISSUES.has(issue))) return refused('unsafe-parser-state');
  const semanticText = redactLocalSemanticText(input.semanticText, input.sensitiveSpans);
  if (!semanticText) return refused('invalid-semantic-text');
  let candidate: LocalSemanticCandidate | null;
  try {
    candidate = await input.retriever.retrieve('parser-family', semanticText, input.cancelled);
  } catch {
    return refused('model-unavailable');
  }
  if (!candidate) return refused('model-unavailable');
  const gated = gateLocalSemanticCandidate(candidate, 'parser-family', input.thresholds);
  if (gated.kind !== 'accepted') return refused(gated.reason);
  const definition = gated.definition as ParserPrototypeDefinition;
  return Object.freeze({
    kind: 'parser-family-advisory',
    advisoryOnly: true,
    prototypeId: gated.prototypeId,
    family: definition.family,
    score: gated.score,
    margin: gated.score - gated.runnerUpScore,
  });
}

/**
 * Public-only linear-head variant of the parser advisory. It shares every
 * deterministic eligibility/redaction gate with the prototype path, but uses
 * the calibrated closed-set head instead of nearest-prototype retrieval.
 */
export async function createLocalParserFamilyHeadAdvisory(input: {
  event: UniversalBankEvent;
  semanticText: string;
  sensitiveSpans: readonly LocalSemanticSensitiveSpan[];
  classifier: LocalParserFamilyClassifier;
  cancelled?: () => boolean;
}): Promise<LocalParserFamilyAdvisoryResult> {
  const refused = (reason: LocalSemanticFallbackReason): LocalParserFamilyAdvisoryResult =>
    ({ kind: 'refused', reason });
  if (!input.event || input.event.decision !== 'review') return refused('event-not-reviewable');
  if (input.event.status !== 'posted' && input.event.status !== 'unknown') {
    return refused('event-not-a-posting-candidate');
  }
  if (input.event.family !== 'unknown') return refused('deterministic-family-known');
  if (!hasGroundedTransactionMoney(input.event)) return refused('deterministic-money-required');
  if (input.event.issues.some((issue) => UNSAFE_PARSER_ISSUES.has(issue))) return refused('unsafe-parser-state');
  const semanticText = redactLocalSemanticText(input.semanticText, input.sensitiveSpans);
  if (!semanticText) return refused('invalid-semantic-text');
  let candidate: LocalParserFamilyHeadCandidate | null;
  try {
    candidate = await input.classifier.classify(semanticText, input.cancelled);
  } catch {
    return refused('model-unavailable');
  }
  if (!candidate) return refused('low-score');
  return Object.freeze({
    kind: 'parser-family-advisory',
    advisoryOnly: true,
    prototypeId: `parser.family.${candidate.family}`,
    family: candidate.family,
    score: candidate.probability,
    margin: candidate.probability - candidate.runnerUpProbability,
  });
}
