import type { Transaction } from '@/lib/types';

/**
 * Where one ledger row came from, derived only from fields the row already
 * carries. It never guesses: a row without a capture marker is "by hand",
 * which is also how rows saved before `source` existed are defined
 * (types.ts: "Undefined = manual").
 *
 * No app imports beyond types, so the Home and Transactions test harnesses can
 * load it as-is.
 */
export type TransactionSourceKind =
  | 'bank-text'
  | 'notification'
  | 'apple-pay'
  | 'statement'
  | 'email'
  | 'manual';

/** Display order for filters and legends. */
export const TRANSACTION_SOURCE_KINDS: readonly TransactionSourceKind[] = [
  'bank-text', 'notification', 'apple-pay', 'statement', 'email', 'manual',
];

/**
 * The Apple Pay (Wallet) review identity. Kept in step with
 * dedupe.ts APPLE_PAY_REVIEW_SOURCE_KEY; a test asserts the two agree.
 */
export const APPLE_PAY_SOURCE_KEY = /^apple_pay_review_source_[a-f0-9]{32}$/;

type SourceFields = Pick<Transaction, 'source' | 'viaPush' | 'captureSource' | 'smsKey' | 'walletBound'>;

export function transactionSource(row: SourceFields): TransactionSourceKind {
  // Statement rows are coarser than a live capture (day-level time, bank
  // wording). Their provenance wins over any other flag they carry.
  if (row.captureSource === 'pdf' || row.captureSource === 'csv') return 'statement';
  if (row.captureSource === 'email') return 'email';
  if (row.source !== 'sms') return 'manual';
  // A Wallet record the user confirmed as the same purchase as a bank
  // Message carries that Message's identity (walletBound): it is a bank text.
  if (typeof row.smsKey === 'string' && APPLE_PAY_SOURCE_KEY.test(row.smsKey) && row.walletBound !== true) return 'apple-pay';
  if (row.viaPush === true) return 'notification';
  return 'bank-text';
}

/** Live captures: rows that arrived on their own from a bank text, app alert or Apple Pay. */
export function isLiveCapture(row: SourceFields): boolean {
  const kind = transactionSource(row);
  return kind === 'bank-text' || kind === 'notification' || kind === 'apple-pay';
}
