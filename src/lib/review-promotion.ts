import { getCategory } from '@/lib/categories';
import { ledgerMoneySpec, type LedgerMoneySpec } from '@/lib/ledger-money';
import { resolveReviewAlert, type AlertReviewTrayState } from '@/lib/alert-review-tray';
import type { Account, AppState, CategoryId, Transaction, TransactionType } from '@/lib/types';

export interface PromoteReviewAlertInput {
  reviewId: string;
  type: TransactionType;
  title: string;
  category: CategoryId;
  accountId: string;
  date: string;
  betweenOwnAccounts: boolean;
}

export type ReviewPromotionFailure =
  | 'not-found'
  | 'expired'
  | 'invalid-money'
  | 'currency-mismatch'
  | 'invalid-account'
  | 'instrument-mismatch'
  | 'invalid-category'
  | 'invalid-title'
  | 'invalid-date';

export type ReviewPromotionPlan =
  | {
      outcome: 'added';
      transaction: Transaction;
      reviewTray: AlertReviewTrayState;
      ledgerMoney: LedgerMoneySpec;
    }
  | {
      outcome: 'duplicate';
      reviewTray: AlertReviewTrayState;
    }
  | { outcome: 'refused'; reason: ReviewPromotionFailure };

const validDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const accountMatchesInstrument = (
  account: Account,
  instrument: { kind: 'card' | 'account' | 'wallet'; last4: string | null } | null,
): boolean => {
  if (!instrument?.last4 || !account.last4) return true;
  return instrument.last4 === account.last4;
};

/**
 * Plan one explicit review decision without touching React state or storage.
 * Review money is accepted only as the ledger's own exact currency/exponent;
 * cross-currency promotion needs a separate dated FX contract and is refused.
 */
export const planReviewPromotion = (
  state: AppState,
  input: PromoteReviewAlertInput,
  transactionId: string,
  now: number,
): ReviewPromotionPlan => {
  const item = state.reviewTray.pending.find((candidate) => candidate.id === input.reviewId);
  if (!item) return { outcome: 'refused', reason: 'not-found' };
  if (item.expiresAt <= now) return { outcome: 'refused', reason: 'expired' };

  const expectedMoney = ledgerMoneySpec(item.amount.currency);
  if (!expectedMoney || expectedMoney.exponent !== item.amount.exponent ||
    !/^[1-9]\d{0,39}$/.test(item.amount.minorUnits)) {
    return { outcome: 'refused', reason: 'invalid-money' };
  }
  let amount: bigint;
  try {
    amount = BigInt(item.amount.minorUnits);
  } catch {
    return { outcome: 'refused', reason: 'invalid-money' };
  }
  if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { outcome: 'refused', reason: 'invalid-money' };
  }
  if (state.ledgerMoney && (state.ledgerMoney.currency !== expectedMoney.currency ||
    state.ledgerMoney.exponent !== expectedMoney.exponent)) {
    return { outcome: 'refused', reason: 'currency-mismatch' };
  }

  const account = state.accounts.find((candidate) => candidate.id === input.accountId);
  if (!account) return { outcome: 'refused', reason: 'invalid-account' };
  if (!accountMatchesInstrument(account, item.instrument)) {
    return { outcome: 'refused', reason: 'instrument-mismatch' };
  }
  if (getCategory(input.category).type !== input.type) {
    return { outcome: 'refused', reason: 'invalid-category' };
  }
  const title = input.title.trim();
  if (!title || title.length > 80 || /[\u0000-\u001F\u007F]/u.test(title)) {
    return { outcome: 'refused', reason: 'invalid-title' };
  }
  if (!validDate(input.date)) return { outcome: 'refused', reason: 'invalid-date' };

  if (state.transactions.some((transaction) => transaction.smsKey === item.sourceKey)) {
    return {
      outcome: 'duplicate',
      reviewTray: resolveReviewAlert(state.reviewTray, item.id, 'duplicate', now),
    };
  }

  return {
    outcome: 'added',
    ledgerMoney: state.ledgerMoney ?? expectedMoney,
    reviewTray: resolveReviewAlert(state.reviewTray, item.id, 'added', now),
    transaction: {
      id: transactionId,
      type: input.type,
      amountFils: Number(amount),
      category: input.category,
      accountId: account.id,
      title,
      date: input.date,
      ts: item.observedAt,
      source: 'sms',
      smsKey: item.sourceKey,
      ...(item.channel === 'push' ? { viaPush: true } : {}),
      ...(input.betweenOwnAccounts ? { isTransfer: true } : {}),
      userEdited: true,
      titleEdited: true,
    },
  };
};
