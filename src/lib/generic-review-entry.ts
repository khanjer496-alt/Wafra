import { ledgerMoneySpec } from '@/lib/ledger-money';
import type {
  UniversalBankEvent, UniversalField, UniversalInstrument, UniversalMoney,
  UniversalMoneyObservation,
} from '@/lib/universal-types';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const oneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === 'string' && values.includes(value as T);
const families = ['purchase', 'transfer', 'cash-withdrawal', 'refund', 'fee', 'utility',
  'recurring-payment', 'statement', 'balance', 'authentication', 'unknown', 'bill', 'card-payment'] as const;
const roles = ['transaction', 'bill-due', 'statement-total', 'minimum-due', 'balance',
  'credit-limit', 'fee', 'unknown'] as const;

const money = (value: unknown): UniversalMoney | null => {
  if (!record(value) || typeof value.currency !== 'string' ||
    typeof value.minorUnits !== 'string' || !/^-?(?:0|[1-9]\d{0,39})$/.test(value.minorUnits) ||
    !Number.isInteger(value.exponent)) return null;
  const spec = ledgerMoneySpec(value.currency);
  if (!spec || value.currency !== spec.currency || value.exponent !== spec.exponent) return null;
  return { currency: value.currency, minorUnits: value.minorUnits, exponent: spec.exponent };
};
const instrument = (value: unknown): UniversalInstrument | null => {
  if (!record(value) || !oneOf(value.kind, ['card', 'account', 'wallet'] as const) ||
    (value.last4 !== null && (typeof value.last4 !== 'string' || !/^\d{4}$/.test(value.last4)))) return null;
  return { kind: value.kind, last4: typeof value.last4 === 'string' ? value.last4 : null };
};
const title = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 96 &&
  !/[\u0000-\u001F\u007F-\u009F]/u.test(value) ? value : null;
const date = (value: unknown): string | null => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
};

const field = <T>(input: unknown, sanitize: (value: unknown) => T | null): UniversalField<T> | null => {
  if (!record(input) || !oneOf(input.evidence, ['explicit', 'ambiguous', 'missing'] as const) ||
    !Array.isArray(input.alternatives) || input.alternatives.length > 16) return null;
  const value = input.value === null ? null : sanitize(input.value);
  if (input.value !== null && value === null) return null;
  const alternatives: T[] = [];
  for (const candidate of input.alternatives) {
    const accepted = sanitize(candidate);
    if (accepted === null) return null;
    alternatives.push(accepted);
  }
  if (input.evidence === 'missing' && (value !== null || alternatives.length > 0)) return null;
  if (input.evidence === 'explicit' && value === null) return null;
  if (input.evidence === 'ambiguous' && value === null && alternatives.length === 0) return null;
  // Coordinates and diagnostics can contain accidental source fragments at a
  // runtime boundary. Persist only facts, never those arbitrary containers.
  return { value, evidence: input.evidence, alternatives, spans: [], issues: [] };
};

/** Reconstruct bounded review facts; never persist a parser object by spreading it. */
export const sanitizeUniversalReviewEvent = (input: unknown): UniversalBankEvent | null => {
  if (!record(input) || input.version !== 1 || input.decision !== 'review' ||
    !oneOf(input.family, families) || input.family === 'authentication' ||
    !oneOf(input.status, ['posted', 'future', 'informational', 'unknown'] as const) ||
    !oneOf(input.direction, ['debit', 'credit', 'none', 'unknown'] as const) ||
    !Array.isArray(input.observations) || input.observations.length > 32) return null;
  const amount = field(input.amount, money);
  const statementTotal = field(input.statementTotal, money);
  const minimumDue = field(input.minimumDue, money);
  const balance = field(input.balance, money);
  const creditLimit = field(input.creditLimit, money);
  const merchant = field(input.merchant, title);
  const transactionDate = field(input.transactionDate, date);
  const dueDate = field(input.dueDate, date);
  const statementDate = field(input.statementDate, date);
  const capturedInstrument = field(input.instrument, instrument);
  if (!amount || !statementTotal || !minimumDue || !balance || !creditLimit || !merchant ||
    !transactionDate || !dueDate || !statementDate || !capturedInstrument) return null;
  const observations: UniversalMoneyObservation[] = [];
  for (const observation of input.observations) {
    if (!record(observation) || !oneOf(observation.role, roles)) return null;
    const accepted = field(observation.field, money);
    if (!accepted) return null;
    observations.push({ role: observation.role, field: accepted });
  }
  const monetaryFacts = [amount, statementTotal, minimumDue, balance, creditLimit,
    ...observations.map((observation) => observation.field)];
  if (!monetaryFacts.some((candidate) => candidate.value !== null || candidate.alternatives.length > 0)) {
    return null;
  }
  return {
    version: 1, decision: 'review', family: input.family, status: input.status,
    direction: input.direction, amount, statementTotal, minimumDue, balance, creditLimit,
    merchant, transactionDate, dueDate, statementDate, instrument: capturedInstrument,
    observations, issues: [],
  };
};
