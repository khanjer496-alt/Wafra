import type { UniversalBankEvent, UniversalField } from '@/lib/universal-types';

export interface UniversalFieldConfidence {
  amount: number;
  statementTotal: number;
  minimumDue: number;
  balance: number;
  creditLimit: number;
  merchant: number;
  transactionDate: number;
  dueDate: number;
  statementDate: number;
  instrument: number;
}

export interface UniversalEventConfidence {
  status: number;
  family: number;
  direction: number;
  fields: UniversalFieldConfidence;
  /** Conservative score for using the event without human review. */
  overall: number;
  /** False for anything that has unresolved posting/direction/money evidence. */
  automationSafe: boolean;
  reasons: string[];
}

const clamp = (value: number): number => Math.max(0, Math.min(1, Number(value.toFixed(3))));

/**
 * Translate Wafra's source-grounded evidence into a numeric confidence signal.
 *
 * This is deliberately deterministic. It is NOT a model probability and must
 * never be presented as one. The number answers how complete/unambiguous the
 * parser evidence is so product code can distinguish "we read this field" from
 * "we guessed/fell back" without rerunning any network model.
 */
export const confidenceForUniversalField = <T>(field: UniversalField<T>): number => {
  if (field.evidence === 'missing') return 0;
  if (field.evidence === 'ambiguous') {
    const alternatives = Math.max(1, field.alternatives.length);
    return clamp(Math.max(0.12, 0.42 - Math.min(0.24, (alternatives - 1) * 0.06) - field.issues.length * 0.04));
  }
  // Explicit source evidence starts high, then loses confidence only for
  // parser-detected quality issues. Source spans matter: an explicit value with
  // no source coordinate is structurally weaker than one we can point back to.
  const spanPenalty = field.spans.length > 0 ? 0 : 0.12;
  return clamp(0.99 - spanPenalty - Math.min(0.35, field.issues.length * 0.07));
};

const statusConfidence = (event: UniversalBankEvent): number => {
  if (event.status === 'unknown') return event.issues.includes('posting-status-unresolved') ? 0.16 : 0.28;
  if (event.issues.includes('direction-conflict') || event.issues.includes('multiple-event-adapter-required')) return 0.72;
  return event.status === 'posted' ? 0.96 : 0.98;
};

const familyConfidence = (event: UniversalBankEvent): number => {
  if (event.family === 'unknown') return 0.18;
  if (event.issues.includes('multiple-event-adapter-required')) return 0.62;
  return 0.95;
};

const directionConfidence = (event: UniversalBankEvent): number => {
  if (event.status !== 'posted' && event.direction === 'none') return 0.99;
  if (event.direction === 'unknown') return event.issues.includes('direction-conflict') ? 0.08 : 0.22;
  if (event.direction === 'none') return 0.35;
  return 0.97;
};

const minimum = (values: number[]): number => values.length ? Math.min(...values) : 0;

export const assessUniversalEventConfidence = (event: UniversalBankEvent): UniversalEventConfidence => {
  const fields: UniversalFieldConfidence = {
    amount: confidenceForUniversalField(event.amount),
    statementTotal: confidenceForUniversalField(event.statementTotal),
    minimumDue: confidenceForUniversalField(event.minimumDue),
    balance: confidenceForUniversalField(event.balance),
    creditLimit: confidenceForUniversalField(event.creditLimit),
    merchant: confidenceForUniversalField(event.merchant),
    transactionDate: confidenceForUniversalField(event.transactionDate),
    dueDate: confidenceForUniversalField(event.dueDate),
    statementDate: confidenceForUniversalField(event.statementDate),
    instrument: confidenceForUniversalField(event.instrument),
  };
  const status = statusConfidence(event);
  const family = familyConfidence(event);
  const direction = directionConfidence(event);
  const postedCore = [status, family, direction, fields.amount];
  const informationalCore = event.family === 'statement'
    ? [status, family, fields.statementTotal]
    : event.family === 'balance'
      ? [status, family, Math.max(fields.balance, fields.creditLimit)]
      : [status, family];
  const core = event.status === 'posted' ? postedCore : informationalCore;
  const overall = clamp(minimum(core));
  const reasons = [
    ...(fields.amount < 0.8 && event.status === 'posted' ? ['amount-low-confidence'] : []),
    ...(status < 0.8 ? ['status-low-confidence'] : []),
    ...(family < 0.8 ? ['family-low-confidence'] : []),
    ...(direction < 0.8 && event.status === 'posted' ? ['direction-low-confidence'] : []),
    ...(event.issues.includes('multiple-event-adapter-required') ? ['multiple-event-adapter-required'] : []),
    ...(event.issues.includes('settlement-adapter-required') ? ['settlement-adapter-required'] : []),
  ];
  const automationSafe = event.status === 'posted' && event.decision === 'review' &&
    overall >= 0.9 && reasons.length === 0;
  return { status, family, direction, fields, overall, automationSafe, reasons };
};

