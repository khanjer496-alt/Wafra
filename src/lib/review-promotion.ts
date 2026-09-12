import { captureSourceTimeMatches, isUsableCaptureSourceIdentity } from '@/lib/capture-source-identity';
import { canonicalUniversalSourceKey, planConfirmedUniversalImport, type UniversalImportRefusal } from '@/lib/universal-import';
import { sanitizeUniversalReviewEvent } from '@/lib/generic-review-entry';
import type { UniversalMoney, UniversalInstrument } from '@/lib/universal-types';
import { categorySupportsType } from '@/lib/categories';
import { ledgerMoneySpec, type LedgerMoneySpec } from '@/lib/ledger-money';
import {
  isUniversalReviewAlert,
  prepareUniversalReviewAlert,
  REVIEW_ALERT_TTL_MS,
  pruneAlertReviewTray,
  resolveReviewAlert,
  type AlertReviewTrayState,
  type ReviewAlert,
  type ReviewEntry,
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
  universal?: {
    confirmed: true;
    postingStatus: 'posted';
    amount: UniversalMoney;
    instrument?: UniversalInstrument;
    /** Bind the displayed proposal to the still-authoritative pending source. */
    expectedSourceKey: string;
    expectedObservedAt: number;
  };
}

export type ReviewPromotionFailure = UniversalImportRefusal | 'source-changed'
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
      learnedNotificationPackage?: string;
    }
  | {
      outcome: 'duplicate';
      reviewTray: AlertReviewTrayState;
      learnedNotificationPackage?: string;
    }
  | { outcome: 'refused'; reason: ReviewPromotionFailure };

const validDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

// Selecting own-account movement confirms this row only. A coincident amount
// and clock cannot authorize rewriting another transaction; reconciliation
// needs independent bank evidence or a separate explicit user choice.

const accountMatchesInstrument = (
  account: Account,
  instrument: { kind: 'card' | 'account' | 'wallet'; last4: string | null } | null,
): boolean => {
  if (!instrument) return true;
  if (instrument.last4 && account.last4 && instrument.last4 !== account.last4) return false;
  if (instrument.kind === 'card') return account.kind === 'card';
  if (instrument.kind === 'account') return account.kind === 'bank';
  return instrument.kind === 'wallet' && account.kind !== 'card';
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
  item: ReviewEntry,
): ReviewTemplateRule | null => {
  if (isUniversalReviewAlert(item) || !item.templateKey) return null;
  const rule = state.reviewTray.templateRules.find(
    (candidate) => candidate.templateKey === item.templateKey,
  );
  if (!rule || rule.market !== item.market || rule.institution !== item.institution ||
    rule.direction !== item.direction || rule.family !== item.family ||
    rule.type !== (item.direction === 'credit' ? 'income' : 'expense') ||
    !state.accounts.some((account) => account.id === rule.accountId) ||
    !categorySupportsType(rule.category, rule.type)) {
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
  if (!captureSourceTimeMatches(item.sourceKey, item.observedAt)) return { outcome: 'refused', reason: 'source-changed' };
  if (item.expiresAt <= now) return { outcome: 'refused', reason: 'expired' };
  const learnedNotificationPackage = item.channel === 'push' &&
    item.sourceClass === 'financial-candidate' &&
    typeof item.sourcePackage === 'string' &&
    /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(item.sourcePackage)
    ? item.sourcePackage
    : undefined;

  if (isUniversalReviewAlert(item)) {
    if (!prepareUniversalReviewAlert(item) || !Number.isSafeInteger(item.expiresAt) ||
      item.expiresAt <= item.observedAt || item.expiresAt > now + REVIEW_ALERT_TTL_MS) {
      return { outcome: 'refused', reason: 'invalid-event' };
    }
    if (input.type !== 'expense' && input.type !== 'income') {
      return { outcome: 'refused', reason: 'confirmation-required' };
    }
    const confirmation = input.universal;
    if (!confirmation || confirmation.confirmed !== true || confirmation.postingStatus !== 'posted') {
      return { outcome: 'refused', reason: 'confirmation-required' };
    }
    if (confirmation.expectedSourceKey !== item.sourceKey ||
      confirmation.expectedObservedAt !== item.observedAt) {
      return { outcome: 'refused', reason: 'source-changed' };
    }
    const event = sanitizeUniversalReviewEvent(item.event);
    if (!event) return { outcome: 'refused', reason: 'invalid-event' };
    // The UI supplies choices only. Bind identity/timing here and re-plan on
    // the current ledger; no UI-supplied batch or cached import is trusted.
    const planned = planConfirmedUniversalImport(state, event, {
      confirmed: confirmation.confirmed, postingStatus: confirmation.postingStatus,
      amount: confirmation.amount, instrument: confirmation.instrument,
      direction: input.type === 'income' ? 'credit' : 'debit',
      accountId: input.accountId, title: input.title, category: input.category,
      date: input.date, sourceKey: item.sourceKey, observedAt: item.observedAt,
      betweenOwnAccounts: input.betweenOwnAccounts,
    });
    if (planned.outcome === 'refused') return planned;
    if (planned.outcome === 'duplicate') return {
      outcome: 'duplicate',
      reviewTray: resolveReviewAlert(state.reviewTray, item.id, 'duplicate', now),
      ...(learnedNotificationPackage ? { learnedNotificationPackage } : {}),
    };
    const transaction = planned.batch.transactions[0];
    const money = planned.batch.importMoney;
    if (planned.batch.transactions.length !== 1 || !transaction || !money) {
      return { outcome: 'refused', reason: 'invalid-event' };
    }
    return {
      outcome: 'added', ledgerMoney: money,
      transaction: { ...transaction, id: transactionId,
        ...(item.channel === 'push' ? { viaPush: true } : {}) },
      // Generic evidence never teaches a registered automatic template.
      reviewTray: resolveReviewAlert(state.reviewTray, item.id, 'added', now),
      ...(learnedNotificationPackage ? { learnedNotificationPackage } : {}),
    };
  }

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
  if (!categorySupportsType(input.category, input.type)) {
    return { outcome: 'refused', reason: 'invalid-category' };
  }
  const title = input.title.trim();
  if (!title || title.length > 80 || /[\u0000-\u001F\u007F]/u.test(title)) {
    return { outcome: 'refused', reason: 'invalid-title' };
  }
  if (!validDate(input.date)) return { outcome: 'refused', reason: 'invalid-date' };

  const sourceKey = canonicalUniversalSourceKey(item.sourceKey, item.observedAt);
  if (state.transactions.some((transaction) => transaction.smsKey &&
    isUsableCaptureSourceIdentity(transaction.smsKey, transaction.ts) &&
    canonicalUniversalSourceKey(transaction.smsKey, transaction.ts) === sourceKey)) {
    return {
      outcome: 'duplicate',
      reviewTray: resolveReviewAlert(state.reviewTray, item.id, 'duplicate', now),
      ...(learnedNotificationPackage ? { learnedNotificationPackage } : {}),
    };
  }

  const resolvedTray = resolveReviewAlert(state.reviewTray, item.id, 'added', now);
  const amountFils = Number(amount);
  return {
    outcome: 'added',
    ledgerMoney: state.ledgerMoney ?? expectedMoney,
    reviewTray: rememberTemplateRule(resolvedTray, item, input, now),
    ...(learnedNotificationPackage ? { learnedNotificationPackage } : {}),
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
      smsKey: sourceKey,
      ...(item.channel === 'push' ? { viaPush: true } : {}),
      ...(input.betweenOwnAccounts ? { isTransfer: true } : {}),
      ...(item.family === 'transfer' || input.betweenOwnAccounts ? { transferDecision: {
        version: 1 as const, ownership: input.betweenOwnAccounts ? 'own' as const : 'external' as const, decidedAt: now,
      } } : {}),
      userEdited: true,
      titleEdited: true,
    },
  };
};
