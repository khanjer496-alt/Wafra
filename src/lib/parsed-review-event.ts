import { ledgerMoneySpec } from '@/lib/ledger-money';
import type { ParsedSms } from '@/lib/sms-parser';
import type { UniversalBankEvent } from '@/lib/universal-types';

/**
 * The structured parser facts of one parsed transaction, restated as a
 * source-free Universal Review event. No raw source text or sender crosses
 * this boundary. Pure: shared by the capture collectors (auto-import) and the
 * import planner, which cannot depend on react-native.
 */
export function parsedTransactionReviewEvent(
  parsed: Omit<ParsedSms, 'raw'>,
): UniversalBankEvent | null {
  if (parsed.kind !== 'transaction' || !Number.isSafeInteger(parsed.amountFils) || parsed.amountFils <= 0) {
    return null;
  }
  const money = ledgerMoneySpec(parsed.currency);
  if (!money) return null;
  const missingField = () => ({
    value: null,
    evidence: 'missing' as const,
    alternatives: [],
    spans: [],
    issues: [],
  });
  const instrument = parsed.card
    ? {
        kind: parsed.card.kind === 'account' ? 'account' as const : 'card' as const,
        last4: /^\d{4}$/.test(parsed.card.last4) ? parsed.card.last4 : null,
      }
    : null;
  const amount = {
    currency: money.currency,
    minorUnits: String(parsed.amountFils),
    exponent: money.exponent,
  };
  const explicitAmount = {
    value: amount,
    evidence: 'explicit' as const,
    alternatives: [],
    spans: [],
    issues: [],
  };
  const merchant = parsed.merchant.trim();
  return {
    version: 1,
    decision: 'review',
    family: parsed.transferHint
      ? 'transfer'
      : parsed.categoryGuess === 'cash-withdrawal'
        ? 'cash-withdrawal'
        : parsed.type === 'income'
          ? 'unknown'
          : 'purchase',
    status: 'posted',
    direction: parsed.type === 'income' ? 'credit' : 'debit',
    amount: explicitAmount,
    statementTotal: missingField(),
    minimumDue: missingField(),
    balance: missingField(),
    creditLimit: missingField(),
    merchant: merchant
      ? { value: merchant, evidence: 'explicit', alternatives: [], spans: [], issues: [] }
      : missingField(),
    transactionDate: parsed.date
      ? { value: parsed.date, evidence: 'explicit', alternatives: [], spans: [], issues: [] }
      : missingField(),
    dueDate: missingField(),
    statementDate: missingField(),
    instrument: instrument
      ? { value: instrument, evidence: 'explicit', alternatives: [], spans: [], issues: [] }
      : missingField(),
    observations: [{ role: 'transaction', field: explicitAmount }],
    issues: [],
  };
}
