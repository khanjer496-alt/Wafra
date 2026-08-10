import type { CurrencyAliasMap } from '@/lib/alert-draft';
import type { CurrencyCode } from '@/lib/currency-metadata';

export type UniversalMarket =
  | 'US' | 'GB' | 'FR' | 'DE' | 'ES' | 'IT' | 'NL'
  | 'IN' | 'QA' | 'KW' | 'BH' | 'OM' | 'EG' | 'JO';

export type AlertFamily =
  | 'purchase'
  | 'transfer'
  | 'cash-withdrawal'
  | 'refund'
  | 'fee'
  | 'utility'
  | 'recurring-payment'
  | 'statement'
  | 'balance'
  | 'authentication'
  | 'unknown';

export type PostingStatus = 'posted' | 'future' | 'failed' | 'informational' | 'unknown';
export type MoneyDirection = 'debit' | 'credit' | 'none' | 'unknown';

export interface AlertMarketPack {
  market: UniversalMarket;
  currencies: readonly CurrencyCode[];
  currencyAliases: CurrencyAliasMap;
  rails: readonly string[];
  transferTerms: readonly string[];
  utilityTerms: readonly string[];
  recurringTerms: readonly string[];
  postedTerms?: readonly string[];
  failedTerms?: readonly string[];
  futureTerms?: readonly string[];
  debitTerms?: readonly string[];
  creditTerms?: readonly string[];
}
