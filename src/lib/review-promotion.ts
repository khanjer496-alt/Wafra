import { CATEGORIES, getCategory } from '@/lib/categories';
import { ledgerMoneySpec, type LedgerMoneySpec } from '@/lib/ledger-money';
import {
  pruneAlertReviewTray,
  resolveReviewAlert,
  type AlertReviewTrayState,
  type ReviewAlert,
  type ReviewTemplateRule,
} from '@/lib/alert-review-tray';
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
      /** Existing opposite SMS leg proven by this explicit own-transfer decision. */
      counterpartId?: string;
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

const transactionTime = (transaction: Transaction): number =>
  transaction.ts ?? Date.parse(`${transaction.date}T12:00:00Z`);

const ownTransferCounterpart = (
  state: AppState,
  item: ReviewAlert,
  input: PromoteReviewAlertInput,
  amountFils: number,
): string | undefined => {
  if (!input.betweenOwnAccounts || item.family !== 'transfer') return undefined;
  const oppositeType: TransactionType = {
    income: 'expense' as const,
    expense: 'income' as const,
  }[input.type];
  // Opposite bank alerts for one transfer arrive together. A multi-day amount
  // match is not identity—it can silently rewrite an unrelated payment.
  const windowMs = 15 * 60 * 1000;
  const candidates = state.transactions.filter((transaction) =>
    transaction.type === oppositeType && transaction.amountFils === amountFils &&
    transaction.accountId !== input.accountId && transaction.source === 'sms' &&
    !transaction.userEdited && !transaction.cardPaymentSide && !transaction.paymentFlowSide &&
    transaction.category !== 'salary' &&
    (transaction.isTransfer === true || transaction.category === 'other' ||
      /\b(?:transfer|remittance|account movement|savings)\b/i.test(transaction.title)) &&
    Number.isFinite(transactionTime(transaction)) &&
    Math.abs(transactionTime(transaction) - item.observedAt) <= windowMs);
  return candidates.length === 1 ? candidates[0].id : undefined;
};

const accountMatchesInstrument = (
  account: Account,
  instrument: { kind: 'card' | 'account' | 'wallet'; last4: string | null } | null,
): boolean => {
  if (!instrument?.last4 || !account.last4) return true;
  return instrument.last4 === account.last4;
};

const sameCorrection = (
  rule: ReviewTemplateRule,
  input: PromoteReviewAlertInput,
): boolean => rule.type === input.type && rule.title === input.title.trim() &&
  rule.category === input.category && rule.accountId === input.accountId &&
  rule.betweenOwnAccounts === input.betweenOwnAccounts;

const rememberTemplateRule = (
  tray: AlertReviewTrayState,
  item: ReviewAlert,
  input: PromoteReviewAlertInput,
  now: number,
): AlertReviewTrayState => {
  if (!item.templateKey) return tray;
  const previous = tray.templateRules.find((rule) => rule.templateKey === item.templateKey);
  const rule: ReviewTemplateRule = {
    templateKey: item.templateKey,
    market: item.market,
    institution: item.institution,
    direction: item.direction,
    family: item.family,
    type: input.type,
    title: input.title.trim(),
    category: input.category,
    accountId: input.accountId,
    betweenOwnAccounts: input.betweenOwnAccounts,
    confirmations: previous && sameCorrection(previous, input) ? previous.confirmations + 1 : 1,
    updatedAt: now,
  };
  return pruneAlertReviewTray({
    ...tray,
    templateRules: [...tray.templateRules.filter(
      (candidate) => candidate.templateKey !== item.templateKey,
    ), rule],
  }, now);
};

/** Return only a still-valid correction for the same sanitized alert shape. */
export const reviewTemplateRuleFor = (
  state: AppState,
  item: ReviewAlert,
): ReviewTemplateRule | null => {
  if (!item.templateKey) return null;
  const rule = state.reviewTray.templateRules.find(
    (candidate) => candidate.templateKey === item.templateKey,
  );
  if (!rule || rule.market !== item.market || rule.institution !== item.institution ||
    rule.direction !== item.direction || rule.family !== item.family ||
    rule.type !== (item.direction === 'credit' ? 'income' : 'expense') ||
    !state.accounts.some((account) => account.id === rule.accountId) ||
    !CATEGORIES.some((category) => category.id === rule.category && category.type === rule.type)) {
    return null;
  }
  return rule;
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

  const resolvedTray = resolveReviewAlert(state.reviewTray, item.id, 'added', now);
  const amountFils = Number(amount);
  return {
    outcome: 'added',
    counterpartId: ownTransferCounterpart(state, item, input, amountFils),
    ledgerMoney: state.ledgerMoney ?? expectedMoney,
    reviewTray: rememberTemplateRule(resolvedTray, item, input, now),
    transaction: {
      id: transactionId,
      type: input.type,
      amountFils,
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
