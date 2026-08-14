/**
 * The narrow contract between a local language model and Wafra.
 *
 * This is deliberately not a ParsedSms and cannot become a Transaction. The
 * deterministic parser keeps ownership of posting status, money, currency,
 * date, merchant and account. The model is evaluated only as a semantic
 * reader until a separately versioned model clears the release gate below.
 */

export const LOCAL_AI_CONTRACT_VERSION = 1;

export const LOCAL_AI_STATUSES = ['posted', 'non-posting', 'uncertain'] as const;
export const LOCAL_AI_KINDS = [
  'salary',
  'business-income',
  'purchase',
  'own-transfer',
  'external-transfer',
  'card-payment',
  'utility-payment',
  'bill-due',
  'cash-withdrawal',
  'refund',
  'fee',
  'unknown',
] as const;
export const LOCAL_AI_DIRECTIONS = ['debit', 'credit', 'none', 'uncertain'] as const;
export const LOCAL_AI_CONFIDENCES = ['high', 'medium', 'low'] as const;

export type LocalAiStatus = typeof LOCAL_AI_STATUSES[number];
export type LocalAiKind = typeof LOCAL_AI_KINDS[number];
export type LocalAiDirection = typeof LOCAL_AI_DIRECTIONS[number];
export type LocalAiConfidence = typeof LOCAL_AI_CONFIDENCES[number];

export interface LocalAiVerdict {
  status: LocalAiStatus;
  kind: LocalAiKind;
  direction: LocalAiDirection;
  confidence: LocalAiConfidence;
}

const exactKeys = ['confidence', 'direction', 'kind', 'status'];

/** Reject malformed, expanded, or free-text model output. */
export function parseLocalAiVerdict(value: unknown): LocalAiVerdict | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join('|') !== exactKeys.join('|')) return null;
  if (!LOCAL_AI_STATUSES.includes(row.status as LocalAiStatus) ||
    !LOCAL_AI_KINDS.includes(row.kind as LocalAiKind) ||
    !LOCAL_AI_DIRECTIONS.includes(row.direction as LocalAiDirection) ||
    !LOCAL_AI_CONFIDENCES.includes(row.confidence as LocalAiConfidence)) {
    return null;
  }
  return row as unknown as LocalAiVerdict;
}

export const LOCAL_AI_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'kind', 'direction', 'confidence'],
  properties: {
    status: { type: 'string', enum: LOCAL_AI_STATUSES },
    kind: { type: 'string', enum: LOCAL_AI_KINDS },
    direction: { type: 'string', enum: LOCAL_AI_DIRECTIONS },
    confidence: { type: 'string', enum: LOCAL_AI_CONFIDENCES },
  },
} as const;

export const LOCAL_AI_SYSTEM_PROMPT = `You classify bank alerts. Return JSON only.

Rules:
- posted: money actually moved or an ATM withdrawal completed.
- non-posting: OTP, authorization, decline, failure, reversal notice without a posted refund, balance/statement summary, bill due reminder, future/conditional/promotion.
- uncertain: the alert does not prove either state.
- salary requires explicit salary/payroll/wages credit evidence.
- business-income requires explicit merchant settlement/payout/proceeds credit evidence.
- own-transfer requires explicit evidence both accounts/wallets belong to the same customer. A beneficiary or ordinary transfer is external-transfer.
- card-payment means paying a credit-card balance, never a card purchase.
- bill-due is a reminder and non-posting. utility-payment is a completed utility/telecom bill payment.
- Ignore footer advertising and available/current balances.

Examples:
Alert: Salary AED 8,500 credited to your account.
{"status":"posted","kind":"salary","direction":"credit","confidence":"high"}
Alert: Your card was used for AED 42 at MARKET. Transfer between accounts in the app.
{"status":"posted","kind":"purchase","direction":"debit","confidence":"high"}
Alert: Credit card payment of AED 900 was debited from account 002.
{"status":"posted","kind":"card-payment","direction":"debit","confidence":"high"}
Alert: You may receive AED 1,000 after you register.
{"status":"non-posting","kind":"unknown","direction":"none","confidence":"high"}`;

export interface LocalAiBenchmarkCase {
  id: string;
  region: string;
  source: string;
  expected: Pick<LocalAiVerdict, 'status' | 'kind' | 'direction'>;
  safetyCritical: boolean;
}

/** Synthetic, independently authored cases. No customer message is included. */
export const LOCAL_AI_BENCHMARK: readonly LocalAiBenchmarkCase[] = [
  {
    id: 'ae-salary', region: 'AE', safetyCritical: true,
    source: 'Salary of AED 8,500.00 has been credited to your account ending 002.',
    expected: { status: 'posted', kind: 'salary', direction: 'credit' },
  },
  {
    id: 'sa-salary-ar', region: 'SA', safetyCritical: true,
    source: 'تم إيداع راتب بقيمة ٧٥٠٠ ريال في حسابك.',
    expected: { status: 'posted', kind: 'salary', direction: 'credit' },
  },
  {
    id: 'in-salary', region: 'IN', safetyCritical: true,
    source: 'INR 75,000 salary credited to A/c XX4321 via NEFT.',
    expected: { status: 'posted', kind: 'salary', direction: 'credit' },
  },
  {
    id: 'ae-business-payout', region: 'AE', safetyCritical: true,
    source: 'Merchant settlement AED 1,250.00 credited to your account for delivered orders.',
    expected: { status: 'posted', kind: 'business-income', direction: 'credit' },
  },
  {
    id: 'us-card-purchase', region: 'US', safetyCritical: true,
    source: 'Your card ending 1234 was charged USD 20.00 at TARGET. Transfer money in our app.',
    expected: { status: 'posted', kind: 'purchase', direction: 'debit' },
  },
  {
    id: 'gb-own-transfer', region: 'GB', safetyCritical: true,
    source: 'GBP 500 moved from your current account 1102 to your savings account 8831.',
    expected: { status: 'posted', kind: 'own-transfer', direction: 'debit' },
  },
  {
    id: 'ae-external-transfer', region: 'AE', safetyCritical: true,
    source: 'Outward remittance AED 700.00 to beneficiary AHMED was debited from account 002.',
    expected: { status: 'posted', kind: 'external-transfer', direction: 'debit' },
  },
  {
    id: 'ae-card-payment', region: 'AE', safetyCritical: true,
    source: 'Credit card payment AED 1,405.00 was debited from your bank account ending 002.',
    expected: { status: 'posted', kind: 'card-payment', direction: 'debit' },
  },
  {
    id: 'fr-refund', region: 'FR', safetyCritical: true,
    source: 'Remboursement de 49,90 EUR crédité sur votre carte se terminant par 7788.',
    expected: { status: 'posted', kind: 'refund', direction: 'credit' },
  },
  {
    id: 'sa-atm-ar', region: 'SA', safetyCritical: true,
    source: 'تم سحب ٥٠٠ ريال نقداً من جهاز الصراف الآلي من حسابك.',
    expected: { status: 'posted', kind: 'cash-withdrawal', direction: 'debit' },
  },
  {
    id: 'ae-utility-paid', region: 'AE', safetyCritical: true,
    source: 'Your electricity bill payment of AED 313.95 has been processed successfully.',
    expected: { status: 'posted', kind: 'utility-payment', direction: 'debit' },
  },
  {
    id: 'de-bill-due', region: 'DE', safetyCritical: true,
    source: 'Ihre Kreditkartenabrechnung über 420,00 EUR ist am 25.08.2026 fällig.',
    expected: { status: 'non-posting', kind: 'bill-due', direction: 'none' },
  },
  {
    id: 'in-otp', region: 'IN', safetyCritical: true,
    source: 'OTP 381920 for INR 4,999 purchase. Do not share this code.',
    expected: { status: 'non-posting', kind: 'purchase', direction: 'none' },
  },
  {
    id: 'gb-declined', region: 'GB', safetyCritical: true,
    source: 'Your card payment of GBP 81.20 was declined. No money has left your account.',
    expected: { status: 'non-posting', kind: 'purchase', direction: 'none' },
  },
  {
    id: 'us-conditional-payout', region: 'US', safetyCritical: true,
    source: 'Earn seller proceeds: USD 1,250 credited to your account after you register.',
    expected: { status: 'non-posting', kind: 'unknown', direction: 'none' },
  },
  {
    id: 'ae-balance-only', region: 'AE', safetyCritical: true,
    source: 'Your available account balance is AED 9,822.14 as of today.',
    expected: { status: 'non-posting', kind: 'unknown', direction: 'none' },
  },
] as const;

export interface LocalAiBenchmarkRow {
  id: string;
  region: string;
  expected: LocalAiBenchmarkCase['expected'];
  actual: LocalAiVerdict | null;
  exact: boolean;
  safetyFailure: boolean;
}

export interface LocalAiBenchmarkResult {
  contractVersion: number;
  total: number;
  exact: number;
  safetyFailures: number;
  releaseEligible: boolean;
  rows: LocalAiBenchmarkRow[];
}

function unsafe(case_: LocalAiBenchmarkCase, actual: LocalAiVerdict | null): boolean {
  if (!case_.safetyCritical || !actual) return true;
  if (case_.expected.status !== 'posted' && actual.status === 'posted') return true;
  if (case_.expected.status === 'posted' && actual.status !== 'posted') return true;
  if (case_.expected.direction === 'debit' && actual.direction !== 'debit') return true;
  if (case_.expected.kind === 'external-transfer' && actual.kind === 'own-transfer') return true;
  if (case_.expected.kind === 'purchase' && actual.kind === 'card-payment') return true;
  return false;
}

export async function runLocalAiBenchmark(
  classify: (source: string) => Promise<LocalAiVerdict | null>,
  onProgress?: (completed: number, total: number) => void,
): Promise<LocalAiBenchmarkResult> {
  const rows: LocalAiBenchmarkRow[] = [];
  for (const case_ of LOCAL_AI_BENCHMARK) {
    let actual: LocalAiVerdict | null = null;
    try {
      actual = await classify(case_.source);
    } catch {
      actual = null;
    }
    const exact = actual !== null &&
      actual.status === case_.expected.status && actual.kind === case_.expected.kind &&
      actual.direction === case_.expected.direction;
    rows.push({
      id: case_.id,
      region: case_.region,
      expected: case_.expected,
      actual,
      exact,
      safetyFailure: unsafe(case_, actual),
    });
    onProgress?.(rows.length, LOCAL_AI_BENCHMARK.length);
  }
  const exact = rows.filter((row) => row.exact).length;
  const safetyFailures = rows.filter((row) => row.safetyFailure).length;
  return {
    contractVersion: LOCAL_AI_CONTRACT_VERSION,
    total: rows.length,
    exact,
    safetyFailures,
    // A model must be perfect on this small safety set before it can even be
    // considered for a larger held-out corpus. Passing does not auto-enable it.
    releaseEligible: exact === rows.length && safetyFailures === 0,
    rows,
  };
}
