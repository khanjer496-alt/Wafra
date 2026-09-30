import { ledgerMoneySpec } from '@/lib/ledger-money';
import type { ParsedSms } from '@/lib/sms-parser';
import { missingUniversalField, type UniversalBankEvent, type UniversalField, type UniversalMoney } from '@/lib/universal-types';

/**
 * A proven statement or repayment keeps its accounting family in Review.
 * Notification capture lacks settlement replay identity, so these facts are
 * informational there; ordinary transaction confirmation must reject them.
 * Reconstruct from parser facts only, never from a raw-text spread.
 */
export function parsedObligationReviewEvent(
  parsed: Omit<ParsedSms, 'raw'>,
): UniversalBankEvent | null {
  const statement = parsed.kind === 'cardStatement';
  if ((!statement && parsed.kind !== 'cardPayment') ||
      !Number.isSafeInteger(parsed.amountFils) || parsed.amountFils < (statement ? 0 : 1)) return null;
  const money = ledgerMoneySpec(parsed.currency);
  if (!money) return null;
  const explicit = <T>(value: T): UniversalField<T> => ({
    value, evidence: 'explicit', alternatives: [], spans: [], issues: [],
  });
  const amount = explicit({ currency: money.currency, exponent: money.exponent,
    minorUnits: String(parsed.amountFils) });
  const minimum = statement && parsed.minDueFils !== null &&
    Number.isSafeInteger(parsed.minDueFils) && parsed.minDueFils >= 0 && parsed.minDueFils <= parsed.amountFils
    ? explicit({ currency: money.currency, exponent: money.exponent, minorUnits: String(parsed.minDueFils) })
    : missingUniversalField<UniversalMoney>();
  return {
    version: 1, decision: 'review', family: statement ? 'statement' : 'card-payment',
    status: statement ? 'informational' : 'posted',
    // ParsedSms uses an expense placeholder for both settlement legs; the
    // receipt/funding evidence, not that placeholder, identifies direction.
    direction: statement ? 'none' : parsed.cardPaymentSide === 'receipt' ? 'credit' :
      parsed.cardPaymentSide === 'debit' ? 'debit' : 'unknown',
    amount: statement ? missingUniversalField() : amount,
    statementTotal: statement ? amount : missingUniversalField(), minimumDue: minimum,
    balance: missingUniversalField(), creditLimit: missingUniversalField(), merchant: missingUniversalField(),
    transactionDate: !statement && parsed.date ? explicit(parsed.date) : missingUniversalField(),
    dueDate: statement && parsed.date ? explicit(parsed.date) : missingUniversalField(),
    statementDate: missingUniversalField(),
    instrument: parsed.card ? explicit({
      kind: parsed.card.kind === 'account' ? 'account' : 'card',
      last4: /^\d{4}$/.test(parsed.card.last4) ? parsed.card.last4 : null,
    }) : missingUniversalField(),
    observations: [{ role: statement ? 'statement-total' : 'transaction', field: amount },
      ...(minimum.value ? [{ role: 'minimum-due' as const, field: minimum }] : [])],
    issues: [],
  };
}

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
