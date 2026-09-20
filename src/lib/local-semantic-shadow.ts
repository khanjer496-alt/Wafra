import {
  redactLocalSemanticText,
  type LocalParserFamily,
  type LocalSemanticSensitiveSpan,
} from '@/lib/local-semantic-model';
import {
  LOCAL_CANONICAL_PARSER_INDEX,
  LOCAL_PUBLIC_PARSER_HEAD,
} from '@/lib/local-semantic-bundle';
import {
  getLocalSemanticEncoder,
  localSemanticRuntimeStatus,
} from '@/lib/local-semantic-runtime';
import type { UniversalBankEvent, UniversalField } from '@/lib/universal-types';

export interface LocalSemanticShadowSnapshot {
  schemaVersion: 1;
  observed: number;
  modelUnavailable: number;
  eligible: number;
  canonicalAccepted: number;
  learnedAccepted: number;
  hybridAccepted: number;
  bothAccepted: number;
  modelAgreement: number;
  deterministicComparable: number;
  canonicalDeterministicAgreement: number;
  learnedDeterministicAgreement: number;
  hybridDeterministicAgreement: number;
  byDeterministicFamily: Record<string, number>;
  byCanonicalFamily: Record<string, number>;
  byLearnedFamily: Record<string, number>;
  byHybridFamily: Record<string, number>;
}

const state: LocalSemanticShadowSnapshot = {
  schemaVersion: 1,
  observed: 0,
  modelUnavailable: 0,
  eligible: 0,
  canonicalAccepted: 0,
  learnedAccepted: 0,
  hybridAccepted: 0,
  bothAccepted: 0,
  modelAgreement: 0,
  deterministicComparable: 0,
  canonicalDeterministicAgreement: 0,
  learnedDeterministicAgreement: 0,
  hybridDeterministicAgreement: 0,
  byDeterministicFamily: {},
  byCanonicalFamily: {},
  byLearnedFamily: {},
  byHybridFamily: {},
};

const increment = (bucket: Record<string, number>, key: string): void => {
  bucket[key] = (bucket[key] ?? 0) + 1;
};

export const localSemanticShadowSnapshot = (): LocalSemanticShadowSnapshot => ({
  ...state,
  byDeterministicFamily: { ...state.byDeterministicFamily },
  byCanonicalFamily: { ...state.byCanonicalFamily },
  byLearnedFamily: { ...state.byLearnedFamily },
  byHybridFamily: { ...state.byHybridFamily },
});

const parserFamily = (family: UniversalBankEvent['family']): LocalParserFamily | null => {
  if (family === 'purchase' || family === 'transfer' || family === 'cash-withdrawal' ||
      family === 'refund' || family === 'fee' || family === 'utility' ||
      family === 'recurring-payment' || family === 'statement' || family === 'balance' ||
      family === 'bill' || family === 'card-payment') return family;
  return null;
};

const addFieldSpans = <T>(
  output: LocalSemanticSensitiveSpan[],
  field: UniversalField<T>,
  kind: LocalSemanticSensitiveSpan['kind'],
): void => {
  for (const span of field.spans) output.push({ ...span, kind });
};

const nonOverlappingSpans = (spans: LocalSemanticSensitiveSpan[]): LocalSemanticSensitiveSpan[] => {
  const ranked = [...spans]
    .filter((span) => Number.isInteger(span.start) && Number.isInteger(span.end) && span.end > span.start)
    .sort((left, right) => left.start - right.start || right.end - left.end);
  const output: LocalSemanticSensitiveSpan[] = [];
  for (const span of ranked) {
    const previous = output[output.length - 1];
    if (previous && span.start < previous.end) continue;
    output.push(span);
  }
  return output;
};

const sensitiveSpans = (event: UniversalBankEvent): LocalSemanticSensitiveSpan[] => {
  const spans: LocalSemanticSensitiveSpan[] = [];
  addFieldSpans(spans, event.amount, 'money');
  addFieldSpans(spans, event.statementTotal, 'money');
  addFieldSpans(spans, event.minimumDue, 'money');
  addFieldSpans(spans, event.balance, 'money');
  addFieldSpans(spans, event.creditLimit, 'money');
  addFieldSpans(spans, event.merchant, 'merchant');
  addFieldSpans(spans, event.instrument, 'instrument');
  addFieldSpans(spans, event.transactionDate, 'date');
  addFieldSpans(spans, event.dueDate, 'date');
  addFieldSpans(spans, event.statementDate, 'date');
  return nonOverlappingSpans(spans);
};

const movementLanguage = /\b(?:purchase|payment|paid|spent|debit(?:ed)?|credit(?:ed)?|transfer(?:red)?|salary|refund(?:ed)?|reversal|withdrawal|atm|fee|commission|bill)\b|شراء|خصم|إيداع|ايداع|تحويل|راتب|سحب|استرداد|رسوم|عمولة|دفع/iu;

/**
 * Build the same bank-invariant semantic shape used by the offline experiments:
 * deterministic fields are redacted first, then the bounded clause around the
 * transaction amount is selected. No raw source survives the return value.
 */
export function buildLocalParserSemanticWindow(
  source: string,
  event: UniversalBankEvent,
): string | null {
  const redacted = redactLocalSemanticText(source, sensitiveSpans(event));
  if (!redacted) return null;
  const moneyAt = redacted.indexOf('<money>');
  if (moneyAt < 0) return null;
  const boundaries = [...redacted.matchAll(/[\n\r;!?]|\.(?!\d)/gu)].map((match) => match.index ?? -1);
  const before = boundaries.filter((value) => value >= 0 && value < moneyAt).pop() ?? -1;
  const after = boundaries.find((value) => value > moneyAt) ?? redacted.length;
  let start = before + 1;
  let end = Math.min(redacted.length, after + 1);
  let window = redacted.slice(start, end).trim();
  if (!movementLanguage.test(window)) {
    const previous = boundaries.filter((value) => value >= 0 && value < start - 1).pop() ?? -1;
    if (end - (previous + 1) <= 280) {
      start = previous + 1;
      window = redacted.slice(start, end).trim();
    }
  }
  return window
    .replace(/^\s*from\s+[\p{L}\p{N}& ._-]{2,32}:\s*/iu, '')
    .replace(/\b(?:your\s+)?(?:available|current|remaining)\s+(?:balance|limit)\b[\s\S]*$/iu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 320) || null;
}

const HYBRID_FAMILIES: readonly LocalParserFamily[] = Object.freeze([
  'purchase', 'transfer', 'cash-withdrawal', 'refund', 'fee', 'utility',
]);
const canonicalThreshold = { minimumScore: 0.72, minimumMargin: 0.015 } as const;

const softmax = (values: readonly number[]): number[] => {
  const max = Math.max(...values);
  const exponents = values.map((value) => Math.exp(value - max));
  const total = exponents.reduce((sum, value) => sum + value, 0);
  return exponents.map((value) => value / total);
};

const dot = (left: ArrayLike<number>, right: ArrayLike<number>): number => {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) total += Number(left[index]) * Number(right[index]);
  return total;
};

const hybridPrediction = (embedding: ArrayLike<number>) => {
  if (embedding.length !== 384) return null;
  const canonicalScores = HYBRID_FAMILIES.map((family) => {
    const prototype = LOCAL_CANONICAL_PARSER_INDEX.prototypes.find(
      (row) => row.id === `parser.family.${family}`,
    );
    return prototype ? dot(embedding, prototype.vector) : -1;
  });
  const canonicalProbabilities = softmax(canonicalScores.map((score) => score / 0.035));
  const learnedLogits = LOCAL_PUBLIC_PARSER_HEAD.classes.map((family, classIndex) =>
    dot(embedding, LOCAL_PUBLIC_PARSER_HEAD.weights[classIndex]) + LOCAL_PUBLIC_PARSER_HEAD.intercept[classIndex]);
  const learnedClassProbabilities = softmax(learnedLogits);
  const learnedByFamily = new Map<LocalParserFamily, number>();
  LOCAL_PUBLIC_PARSER_HEAD.classes.forEach((family, index) => learnedByFamily.set(family, learnedClassProbabilities[index]));
  const hybrid = HYBRID_FAMILIES.map((family, index) =>
    0.9 * canonicalProbabilities[index] + 0.1 * (learnedByFamily.get(family) ?? 0));
  const ranked = hybrid.map((probability, index) => ({ family: HYBRID_FAMILIES[index], probability }))
    .sort((left, right) => right.probability - left.probability);
  const canonicalRanked = canonicalScores.map((score, index) => ({ family: HYBRID_FAMILIES[index], score }))
    .sort((left, right) => right.score - left.score);
  const learnedRanked = [...learnedByFamily].map(([family, probability]) => ({ family, probability }))
    .sort((left, right) => right.probability - left.probability);
  return {
    hybrid: ranked[0], hybridMargin: ranked[0].probability - ranked[1].probability,
    canonical: canonicalRanked[0], canonicalMargin: canonicalRanked[0].score - canonicalRanked[1].score,
    learned: learnedRanked[0], learnedMargin: learnedRanked[0].probability - learnedRanked[1].probability,
  };
};

/**
 * Shadow-only: never returns a transaction mutation or import decision. It
 * stores only aggregate family counters and agreement counts, never source
 * text, embeddings, amounts, identifiers or timestamps.
 */
export async function observeLocalSemanticParserShadow(
  source: string,
  event: UniversalBankEvent,
): Promise<void> {
  state.observed += 1;
  if (event.decision !== 'review' || (event.status !== 'posted' && event.status !== 'unknown') ||
      event.amount.evidence === 'missing') return;
  const semanticText = buildLocalParserSemanticWindow(source, event);
  if (!semanticText) return;
  state.eligible += 1;
  if (localSemanticRuntimeStatus().state !== 'ready') {
    state.modelUnavailable += 1;
    void getLocalSemanticEncoder().catch(() => undefined);
    return;
  }
  try {
    const encoder = await getLocalSemanticEncoder();
    const prediction = hybridPrediction(await encoder.encode(semanticText));
    if (!prediction) return;
    const canonicalAccepted = prediction.canonical.score >= canonicalThreshold.minimumScore &&
      prediction.canonicalMargin >= canonicalThreshold.minimumMargin
      ? prediction.canonical.family : null;
    const learnedAccepted = prediction.learned.probability >= LOCAL_PUBLIC_PARSER_HEAD.minimumProbability &&
      prediction.learnedMargin >= LOCAL_PUBLIC_PARSER_HEAD.minimumMargin
      ? prediction.learned.family : null;
    // Shadow gate: require a decisive hybrid distribution. This does not grant
    // import authority; it only controls which predictions count as accepted
    // in source-free diagnostics.
    const hybridAccepted = prediction.hybrid.probability >= 0.55 && prediction.hybridMargin >= 0.1
      ? prediction.hybrid.family : null;
    if (canonicalAccepted) {
      state.canonicalAccepted += 1;
      increment(state.byCanonicalFamily, canonicalAccepted);
    }
    if (learnedAccepted) {
      state.learnedAccepted += 1;
      increment(state.byLearnedFamily, learnedAccepted);
    }
    if (hybridAccepted) {
      state.hybridAccepted += 1;
      increment(state.byHybridFamily, hybridAccepted);
    }
    if (canonicalAccepted && learnedAccepted) {
      state.bothAccepted += 1;
      if (canonicalAccepted === learnedAccepted) state.modelAgreement += 1;
    }
    const deterministic = parserFamily(event.family);
    if (deterministic) {
      state.deterministicComparable += 1;
      increment(state.byDeterministicFamily, deterministic);
      if (canonicalAccepted === deterministic) state.canonicalDeterministicAgreement += 1;
      if (learnedAccepted === deterministic) state.learnedDeterministicAgreement += 1;
      if (hybridAccepted === deterministic) state.hybridDeterministicAgreement += 1;
    }
  } catch {
    state.modelUnavailable += 1;
  }
}
