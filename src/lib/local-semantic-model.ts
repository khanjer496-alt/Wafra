/**
 * ⚠️ RECONSTRUCTED PLUMBING HARNESS — NOT THE BENCHMARKED MODULE ⚠️
 *
 * `7115f29` landed the four local-semantic runtime files, the three bundled
 * JSON assets and the `local-ai-e5-v1` release, but this module — which all
 * four import — was never committed. It does not exist in any ref or any
 * commit in this repository's history (`git log --all --diff-filter=A` finds
 * nothing; `git rev-list --all --objects` finds no such blob). Without it
 * Metro cannot resolve `redactLocalSemanticText` or
 * `createLocalSemanticRetriever`, so no Android or iOS bundle can be built at
 * all — which blocks the on-device runtime verification entirely.
 *
 * This file exists to unblock exactly that: building an APK, downloading and
 * hash-verifying the encoder, and proving ONNX inference, latency, memory and
 * thermal behaviour on a real phone. It is a REPLACEMENT FOR A LOST FILE,
 * written from the API surface its consumers pin, not a copy of the original.
 *
 * WHAT THIS MEANS FOR MEASUREMENTS
 *
 * The types and the retriever are mechanical and safe. `redactLocalSemanticText`
 * is NOT: it builds the semantic window that gets embedded, so it is the single
 * function whose exact behaviour moves shadow-mode numbers. Any accuracy figure
 * produced by a build containing this file is a figure for THIS redaction, not
 * for the one behind the ~93% held-out-bank result. Do not attribute shadow
 * output from such a build to that evaluation, and do not promote a build
 * containing this file past shadow mode.
 *
 * `LOCAL_SEMANTIC_MODEL_PROVENANCE` below is surfaced in the diagnostics export
 * so a build carrying this harness can always be told apart from one carrying
 * the recovered original. Restoring the real module should replace this file
 * wholesale and flip that constant back to 'original'.
 *
 * Privacy contract this module is responsible for (unchanged from the original
 * intent, as documented by its callers): no raw source text survives the return
 * value of `redactLocalSemanticText`. Deterministic money, merchant, instrument
 * and date spans are replaced with type placeholders before anything is
 * embedded, and nothing here writes, stores or transmits source text.
 */

import type { SourceSpan } from '@/lib/alert-draft';

/**
 * Whether the local semantic model module is the original or this stand-in.
 * Read by `diagnostic-export.ts` so a diagnostics bundle states which one the
 * build carried. Flip to 'original' only when this file is replaced by the
 * recovered implementation.
 */
export const LOCAL_SEMANTIC_MODEL_PROVENANCE = 'reconstructed-plumbing-harness' as const;

/**
 * Families the parser side of the semantic layer can name. The first six are
 * the classes the shipped linear head predicts and the canonical centroid
 * index holds; the rest are deterministic families the shadow comparison maps
 * through without the model ever predicting them.
 */
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

/** A deterministic field location in the source, tagged with what it holds. */
export interface LocalSemanticSensitiveSpan extends SourceSpan {
  kind: 'money' | 'merchant' | 'instrument' | 'date';
}

export interface LocalOnnxInt8ModelManifest {
  schemaVersion: 1;
  modelVersion: string;
  backend: 'onnxruntime-react-native';
  graphFormat: 'onnx';
  quantization: 'dynamic-int8';
  embeddingDimensions: number;
  /** Input is truncated to this many characters before tokenization. */
  maximumCharacters: number;
}

export interface LocalOnnxInt8TextEncoder {
  readonly manifest: LocalOnnxInt8ModelManifest;
  /** L2-normalized mean-pooled sentence embedding. */
  encode(text: string): Promise<Float32Array>;
}

export interface LocalSemanticPrototype {
  id: string;
  domain: string;
  vector: readonly number[];
}

export interface LocalSemanticPrototypeIndex {
  schemaVersion: 1;
  modelVersion: string;
  embeddingDimensions: number;
  scoreScale: 'raw-cosine';
  aggregation: 'max-per-prototype-id';
  prototypes: readonly LocalSemanticPrototype[];
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
  /** Below this top-class probability the prediction is not accepted. */
  minimumProbability: number;
  /** Below this top-two probability gap the prediction is not accepted. */
  minimumMargin: number;
  trainingEvidence: {
    privacySafeAnchorRows: number;
    personalRowsUsedForTraining: number;
  };
}

export interface LocalSemanticMatch {
  id: string;
  domain: string;
  score: number;
}

export interface LocalSemanticRetriever {
  readonly index: LocalSemanticPrototypeIndex;
  retrieve(text: string, limit?: number): Promise<LocalSemanticMatch[]>;
}

const PLACEHOLDER: Record<LocalSemanticSensitiveSpan['kind'], string> = {
  money: '<money>',
  merchant: '<merchant>',
  instrument: '<instrument>',
  date: '<date>',
};

/**
 * Residual digit runs the deterministic spans did not claim — an unparsed
 * account number, a reference, a masked PAN tail. They carry no family signal
 * and must not reach an embedding, so they collapse to a single placeholder.
 *
 * RECONSTRUCTION NOTE: the span replacement above is pinned by the callers
 * (`local-semantic-shadow.ts` searches the result for the literal `<money>`).
 * This residual sweep is not pinned by anything — it is this file's reading of
 * the module's stated privacy contract, and is one of the places the original
 * may have behaved differently.
 */
const DIGIT = '0-9\\u0660-\\u0669\\u06F0-\\u06F9';
const RESIDUAL_RUN = new RegExp(`[${DIGIT}][${DIGIT}.,-]*`, 'gu');
const DIGIT_ONLY = new RegExp(`[${DIGIT}]`, 'gu');
/** A run is identifying once it carries this many digits; below it is a quantity. */
const RESIDUAL_MINIMUM_DIGITS = 4;

/**
 * Replace deterministic field spans with type placeholders, so what gets
 * embedded describes the shape of a message rather than one person's money.
 *
 * Spans must be non-overlapping; callers guarantee this. Any that overlap a
 * span already applied is skipped rather than allowed to corrupt the offsets.
 * Returns null when nothing usable survives.
 */
export function redactLocalSemanticText(
  source: string,
  spans: readonly LocalSemanticSensitiveSpan[],
): string | null {
  if (typeof source !== 'string' || source.length === 0) return null;
  const ordered = [...spans]
    .filter((span) =>
      Number.isInteger(span.start) && Number.isInteger(span.end) &&
      span.start >= 0 && span.end <= source.length && span.end > span.start)
    .sort((left, right) => left.start - right.start);

  let output = '';
  let cursor = 0;
  for (const span of ordered) {
    if (span.start < cursor) continue;
    output += source.slice(cursor, span.start) + PLACEHOLDER[span.kind];
    cursor = span.end;
  }
  output += source.slice(cursor);

  const swept = output.replace(RESIDUAL_RUN, (run) =>
    (run.match(DIGIT_ONLY)?.length ?? 0) >= RESIDUAL_MINIMUM_DIGITS ? '<number>' : run);
  return swept.trim() || null;
}

const cosine = (left: ArrayLike<number>, right: ArrayLike<number>): number => {
  if (left.length !== right.length) return -1;
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += Number(left[index]) * Number(right[index]);
  }
  return dot;
};

/**
 * Rank an index's prototypes against a piece of text. Both the encoder output
 * and the shipped prototype vectors are unit length, so the dot product is the
 * cosine the index declares as its `raw-cosine` score scale. `aggregation` is
 * `max-per-prototype-id`: several vectors may share an id, and the best one
 * represents it.
 */
export function createLocalSemanticRetriever(
  encoder: LocalOnnxInt8TextEncoder,
  index: LocalSemanticPrototypeIndex,
): LocalSemanticRetriever {
  if (index.embeddingDimensions !== encoder.manifest.embeddingDimensions) {
    throw new Error('local-semantic-model:dimension-mismatch');
  }
  if (index.modelVersion !== encoder.manifest.modelVersion) {
    throw new Error('local-semantic-model:model-version-mismatch');
  }
  return Object.freeze({
    index,
    async retrieve(text: string, limit = 5): Promise<LocalSemanticMatch[]> {
      const embedding = await encoder.encode(text);
      const best = new Map<string, LocalSemanticMatch>();
      for (const prototype of index.prototypes) {
        const score = cosine(embedding, prototype.vector);
        const previous = best.get(prototype.id);
        if (!previous || score > previous.score) {
          best.set(prototype.id, { id: prototype.id, domain: prototype.domain, score });
        }
      }
      return [...best.values()]
        .sort((left, right) => right.score - left.score)
        .slice(0, Math.max(0, limit));
    },
  });
}
