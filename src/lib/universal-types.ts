import type { SourceSpan, CurrencyAliasMap } from '@/lib/alert-draft';
import type { AlertFamily, PostingStatus, MoneyDirection, UniversalMarket } from '@/lib/alert-market-pack-types';

export interface UniversalMoney {
  currency: string;
  minorUnits: string;
  exponent: number;
}

/** Values remain grounded in source spans; no raw message is retained here. */
export interface UniversalField<T> {
  value: T | null;
  evidence: 'explicit' | 'ambiguous' | 'missing';
  spans: SourceSpan[];
  alternatives: T[];
  issues: string[];
}

export type UniversalMoneyRole =
  | 'transaction' | 'bill-due' | 'statement-total' | 'minimum-due' | 'balance' | 'credit-limit' | 'fee' | 'unknown';

export interface UniversalMoneyObservation {
  role: UniversalMoneyRole;
  field: UniversalField<UniversalMoney>;
}

export interface UniversalInstrument {
  kind: 'card' | 'account' | 'wallet';
  last4: string | null;
}

export interface UniversalParseContext {
  /** An existing language/market pack assists interpretation; it is not required. */
  market?: UniversalMarket;
  sender?: string;
  /** Supply only a documented source convention or an explicit user choice. */
  dateOrder?: 'DMY' | 'MDY' | 'YMD';
  /** Documented source aliases, never aliases guessed from the ledger currency. */
  currencyAliases?: CurrencyAliasMap;
}

/**
 * A bank-independent review result. Informational facts have their own fields:
 * statements and balances can never masquerade as an ordinary payment.
 */
export interface UniversalBankEvent {
  version: 1;
  decision: 'review' | 'ignore';
  family: AlertFamily | 'bill' | 'card-payment';
  status: PostingStatus;
  direction: MoneyDirection;
  amount: UniversalField<UniversalMoney>;
  statementTotal: UniversalField<UniversalMoney>;
  minimumDue: UniversalField<UniversalMoney>;
  balance: UniversalField<UniversalMoney>;
  creditLimit: UniversalField<UniversalMoney>;
  merchant: UniversalField<string>;
  transactionDate: UniversalField<string>;
  dueDate: UniversalField<string>;
  statementDate: UniversalField<string>;
  instrument: UniversalField<UniversalInstrument>;
  observations: UniversalMoneyObservation[];
  issues: string[];
}

export const missingUniversalField = <T>(issue?: string): UniversalField<T> => ({
  value: null, evidence: 'missing', spans: [], alternatives: [], issues: issue ? [issue] : [],
});
