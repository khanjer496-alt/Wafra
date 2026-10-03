import type { CurrencyAliasMap } from '@/lib/alert-draft';
import type { CurrencyCode } from '@/lib/currency-metadata';

export type UniversalMarket =
  | 'US' | 'GB' | 'FR' | 'DE' | 'ES' | 'IT' | 'NL'
  | 'IN' | 'QA' | 'KW' | 'BH' | 'OM' | 'EG' | 'JO'
  | 'CA' | 'AU' | 'BR' | 'MX' | 'SG';

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
  /**
   * Market-scoped family vocabulary. These only widen family classification
   * inside this pack, so a word such as Spanish "compra" or Portuguese
   * "saque" never changes how another market's alerts are read.
   */
  purchaseTerms?: readonly string[];
  refundTerms?: readonly string[];
  cashTerms?: readonly string[];
  feeTerms?: readonly string[];
  /**
   * Extra words that label an adjacent amount as the transaction amount in the
   * structured universal money extractor, used only when an alert has been
   * routed to this market. First-wave packs leave this empty so their money
   * ownership is exactly the shared global vocabulary.
   */
  moneyLabels?: readonly string[];
}
