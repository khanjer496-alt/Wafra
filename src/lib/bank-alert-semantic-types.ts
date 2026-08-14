import type { ParsedSms } from '@/lib/sms-parser';
import type {
  UnparsedLaunchAlertReview,
  UnparsedLaunchRefusal,
} from '@/lib/unparsed-launch-alert';
import type { CategoryId } from '@/lib/types';

export type AccountingMeaning =
  | 'salary-income'
  | 'business-income'
  | 'generic-income'
  | 'credit-reversal'
  | 'own-account-transfer'
  | 'external-transfer'
  | 'card-purchase'
  | 'card-settlement'
  | 'utility-payment'
  | 'cash-withdrawal'
  | 'refund'
  | 'fee'
  | 'bill-due'
  | 'card-statement'
  | 'purchase'
  | 'unknown';

export type InterpretationEvidence =
  | 'legacy-parser'
  | 'trusted-institution-sender'
  | 'posted-status'
  | 'single-local-amount'
  | 'credit-direction'
  | 'debit-direction'
  | 'salary-language'
  | 'business-income-language'
  | 'credit-reversal-language'
  | 'own-account-language'
  | 'external-transfer-language'
  | 'card-purchase-language'
  | 'card-settlement-language'
  | 'utility-payment-language'
  | 'cash-withdrawal-language'
  | 'refund-language'
  | 'fee-language';

export type BankAlertInterpretation =
  | {
      outcome: 'parsed';
      origin: 'legacy' | 'semantic';
      parsed: ParsedSms;
      meaning: AccountingMeaning;
      evidence: readonly InterpretationEvidence[];
    }
  | {
      outcome: 'review';
      meaning: AccountingMeaning;
      review: UnparsedLaunchAlertReview;
      evidence: readonly InterpretationEvidence[];
    }
  | {
      outcome: 'refuse';
      meaning: 'unknown';
      reason: UnparsedLaunchRefusal;
      evidence: readonly InterpretationEvidence[];
    };

export interface InterpretBankAlertInput {
  source: string;
  sender: string;
  market: 'AE' | 'SA';
  overrides?: Record<string, CategoryId>;
}
