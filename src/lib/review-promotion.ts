import { captureSourceTimeMatches, isUsableCaptureSourceIdentity } from '@/lib/capture-source-identity';
import { canonicalUniversalSourceKey, planConfirmedUniversalImport, type UniversalImportRefusal } from '@/lib/universal-import';
import type { FxQuote } from '@/lib/fx';
import { convertForeignConfirmation, quoteFitsDay, type ReferenceConversion } from '@/lib/fx-rates';
import { sanitizeUniversalReviewEvent } from '@/lib/generic-review-entry';
import type { UniversalMoney, UniversalInstrument } from '@/lib/universal-types';
import { categorySupportsType } from '@/lib/categories';
import { ledgerMoneySpec, migrateLegacyLedgerMoney, type LedgerMoneySpec } from '@/lib/ledger-money';
import { toISODate, transactionTime } from '@/lib/format';
import { isApplePayWalletRow } from '@/lib/dedupe';
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
  /**
   * The user's explicit, confirmed answer to a 'possible-duplicate' refusal:
   * this review is a separate purchase. Bound to the exact pending source the
   * user was shown; it never overrides exact source identity ('duplicate').
   */
  separatePurchase?: {
    confirmed: true;
    expectedSourceKey: string;
    expectedObservedAt: number;
  };
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
  | 'invalid-date'
  | 'possible-duplicate'
  | 'fx-rate-unavailable';

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

const APPLE_PAY_REVIEW_SOURCE = /^apple_pay_review_source_[a-f0-9]{32}$/;
/** Bank SMS/notification delivery can lag the Wallet observation by minutes. */
const APPLE_PAY_BANK_OVERLAP_MS = 10 * 60_000;
/** Two Wallet observations are separate events unless merchant and clock agree. */
const APPLE_PAY_WALLET_OVERLAP_MS = 120_000;

/** An Apple Pay row, unbound or already bound to one of its bank alerts. */
const isWalletPurchaseRow = (row: Transaction): boolean =>
  isApplePayWalletRow(row) || row.walletBound === true;

const normalizeMerchant = (value: string): string =>
  value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');

/**
 * Whether promoting this review could count one Apple Pay purchase twice.
 *
 * Only ever ASKS the user (the review stays pending); it never merges, so it
 * may be broad. Wallet merchant text rarely equals the bank's descriptor and
 * the bank alert can arrive minutes later, so a Wallet review against a bank
 * row, and any bank review against a Wallet row, compares account, amount,
 * expense direction and a ten-minute clock only. Two Wallet observations
 * carry distinct receipts, so they keep the strict merchant and two-minute
 * rule. A row without an event clock (a manual entry) is compared against
 * a Wallet review by account, amount, expense direction and local date: the
 * user may have typed the purchase before Wallet captured it.
 */
const possibleApplePayDuplicate = (
  transactions: readonly Transaction[],
  candidate: {
    type: TransactionType;
    accountId: string;
    amountFils: number;
    observedAt: number;
    /** Present only when the review being promoted is itself an Apple Pay capture. */
    walletMerchants: readonly string[] | null;
    /** The date the promotion would record; clockless rows compare by day. */
    date: string;
    /**
     * The planner already flagged this bank alert against a Wallet row on a
     * card it may be (possible-apple-pay-duplicate): compare Wallet rows on
     * any account, so choosing another account still asks first.
     */
    anyWalletAccount?: boolean;
    /** The Wallet row the planner flagged: same amount within ten minutes always asks. */
    walletRowId?: string;
  },
): boolean => {
  if (candidate.type !== 'expense' || !Number.isFinite(candidate.observedAt)) return false;
  const merchants = candidate.walletMerchants
    ? new Set(candidate.walletMerchants.map(normalizeMerchant).filter(Boolean))
    : null;
  const walletDays = merchants
    ? new Set([candidate.date, toISODate(new Date(candidate.observedAt))])
    : null;
  return transactions.some((existing) => {
    if (existing.type !== 'expense' || existing.amountFils !== candidate.amountFils) return false;
    const existingWallet = isWalletPurchaseRow(existing);
    if (existing.accountId !== candidate.accountId && existing.id !== candidate.walletRowId &&
      !(candidate.anyWalletAccount && !merchants && existingWallet)) return false;
    const timestamp = transactionTime(existing)?.getTime();
    if (timestamp === undefined || !Number.isFinite(timestamp)) {
      // Prompt-only: a clockless non-Wallet row on the same local day.
      return !!walletDays && !existingWallet && walletDays.has(existing.date);
    }
    const distance = Math.abs(timestamp - candidate.observedAt);
    if (existing.id === candidate.walletRowId) return distance <= APPLE_PAY_BANK_OVERLAP_MS;
    if (!merchants) return existingWallet && distance <= APPLE_PAY_BANK_OVERLAP_MS;
    if (!existingWallet) return distance <= APPLE_PAY_BANK_OVERLAP_MS;
    return distance <= APPLE_PAY_WALLET_OVERLAP_MS && merchants.has(normalizeMerchant(existing.title));
  });
};

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
 * The dated reference rate this promotion needs, or null when none is needed:
 * the money is already in the ledger's currency or the ledger has no currency
 * yet. The host fetches
 * it (two currency codes and a day leave the device, nothing else) and passes
 * the quote to planReviewPromotion; the planner never fetches.
 */
export const reviewPromotionFxNeed = (
  state: AppState,
  input: Pick<PromoteReviewAlertInput, 'reviewId' | 'date' | 'universal'>,
): { base: string; quote: string; date: string } | null => {
  const item = state.reviewTray.pending.find((candidate) => candidate.id === input.reviewId);
  if (!item || !validDate(input.date)) return null;
  let ledger: LedgerMoneySpec | null;
  try {
    ledger = migrateLegacyLedgerMoney(state);
  } catch {
    return null;
  }
  if (!ledger) return null;
  const money = isUniversalReviewAlert(item) ? input.universal?.amount : item.amount;
  if (!money || typeof money.currency !== 'string' || money.currency === ledger.currency) return null;
  // Requested even when the alert states the charged ledger amount: the quote
  // is what sanity-checks that figure. A failed request still lets the
  // user-confirmed stated amount post.
  return { base: money.currency, quote: ledger.currency, date: input.date };
};

/**
 * Plan one explicit review decision without touching React state or storage.
 * Money in the ledger's own currency posts as-is. Foreign money is converted:
 * the card's stated ledger amount wins, otherwise the caller's dated provider
 * quote is required and recorded on the row. Without one the review stays
 * pending ('fx-rate-unavailable'); no rate is ever guessed.
 */
export const planReviewPromotion = (
  state: AppState,
  input: PromoteReviewAlertInput,
  transactionId: string,
  now: number,
  fxQuote?: FxQuote | null,
): ReviewPromotionPlan => {
  const item = state.reviewTray.pending.find((candidate) => candidate.id === input.reviewId);
  if (!item) return { outcome: 'refused', reason: 'not-found' };
  if (!captureSourceTimeMatches(item.sourceKey, item.observedAt)) return { outcome: 'refused', reason: 'source-changed' };
  if (item.expiresAt <= now) return { outcome: 'refused', reason: 'expired' };
  const separate = input.separatePurchase;
  if (separate && (separate.confirmed !== true || separate.expectedSourceKey !== item.sourceKey ||
    separate.expectedObservedAt !== item.observedAt)) {
    return { outcome: 'refused', reason: 'source-changed' };
  }
  const separatePurchaseConfirmed = separate !== undefined;
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
    const sanitized = sanitizeUniversalReviewEvent(item.event);
    if (!sanitized) return { outcome: 'refused', reason: 'invalid-event' };
    // A learned format's or an on-device model's direction is a suggestion the
    // person may correct on the Review screen; the amount stays grounded.
    const event = item.suggestedBy === 'learned' || item.suggestedBy === 'ai'
      ? { ...sanitized, direction: 'unknown' as const } : sanitized;
    // The UI supplies choices only. Bind identity/timing here and re-plan on
    // the current ledger; no UI-supplied batch or cached import is trusted.
    const planned = planConfirmedUniversalImport(state, event, {
      confirmed: confirmation.confirmed, postingStatus: confirmation.postingStatus,
      amount: confirmation.amount, instrument: confirmation.instrument,
      direction: input.type === 'income' ? 'credit' : 'debit',
      accountId: input.accountId, title: input.title, category: input.category,
      date: input.date, sourceKey: item.sourceKey, observedAt: item.observedAt,
      betweenOwnAccounts: input.betweenOwnAccounts,
    }, fxQuote);
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
    // Apple Pay's observation UUID cannot identify the bank's SMS for the
    // same purchase. Check the authoritative ledger after money/account
    // validation, and retain the review until the user resolves the overlap.
    // No automatic merge is authorized here. The only override is the user's
    // explicit, confirmed "Add as a separate purchase" for this exact pending
    // source (separatePurchase), which adds one row and resolves the review.
    const walletReview = item.channel === 'push' && APPLE_PAY_REVIEW_SOURCE.test(item.sourceKey);
    if (!separatePurchaseConfirmed && possibleApplePayDuplicate(state.transactions, {
      type: transaction.type, accountId: transaction.accountId, amountFils: transaction.amountFils,
      observedAt: item.observedAt,
      walletMerchants: walletReview ? [transaction.title, event.merchant.value ?? ''] : null,
      date: transaction.date,
      anyWalletAccount: item.attentionReason === 'possible-apple-pay-duplicate',
      walletRowId: item.attentionReason === 'possible-apple-pay-duplicate' ? item.walletTransactionId : undefined,
    })) return { outcome: 'refused', reason: 'possible-duplicate' };
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
  let conversion: ReferenceConversion | null = null;
  if (state.ledgerMoney && (state.ledgerMoney.currency !== expectedMoney.currency ||
    state.ledgerMoney.exponent !== expectedMoney.exponent)) {
    if (state.ledgerMoney.currency === expectedMoney.currency) {
      return { outcome: 'refused', reason: 'currency-mismatch' };
    }
    // A registered (launch-pack) review carries one amount only, so a dated
    // provider quote is the only honest conversion.
    const converted = convertForeignConfirmation(null, {
      currency: expectedMoney.currency, minorUnits: Number(amount), exponent: expectedMoney.exponent,
    }, state.ledgerMoney, quoteFitsDay(fxQuote, input.date) ? fxQuote : null);
    if (converted === 'fx-rate-unavailable' || converted === 'invalid-money') {
      return { outcome: 'refused', reason: converted };
    }
    conversion = converted;
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

  const amountFils = conversion ? conversion.amountFils : Number(amount);
  if (!separatePurchaseConfirmed && possibleApplePayDuplicate(state.transactions, {
    type: input.type, accountId: account.id, amountFils, observedAt: item.observedAt, walletMerchants: null,
    date: input.date,
    anyWalletAccount: item.attentionReason === 'possible-apple-pay-duplicate',
    walletRowId: item.attentionReason === 'possible-apple-pay-duplicate' ? item.walletTransactionId : undefined,
  })) return { outcome: 'refused', reason: 'possible-duplicate' };

  const resolvedTray = resolveReviewAlert(state.reviewTray, item.id, 'added', now);
  return {
    outcome: 'added',
    ledgerMoney: state.ledgerMoney ?? expectedMoney,
    reviewTray: rememberTemplateRule(resolvedTray, item, input, now),
    ...(learnedNotificationPackage ? { learnedNotificationPackage } : {}),
    transaction: {
      id: transactionId,
      type: input.type,
      amountFils,
      ...(conversion ? conversion.fields : {}),
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

/**
 * The identity move "Already recorded" applies to one Wallet row: exactly
 * `smsKey` (the Message's source identity), `viaPush: false` and the durable
 * `walletBound` marker. The row's clock, date, title, account, category and
 * amount are untouched.
 */
export interface WalletDuplicateBinding {
  id: string;
  smsKey: string;
  viaPush: false;
  walletBound: true;
}

/**
 * "Already recorded" on a possible Apple Pay duplicate: move the bank alert's
 * exact source identity onto the Wallet row it was flagged against, the same
 * identity-only move the strict automatic binding makes. The user's title,
 * account, category and date are untouched. A later rescan of that alert then
 * finds the row by exact identity, independent of the Review tray's record.
 *
 * Only a bank Message binds: it can be re-read by a later history import or
 * inbox rescan. A notification is one-shot (never re-read), so binding it
 * would gain nothing and would hide the Wallet row from the SMS that usually
 * follows; it keeps the tombstone only. Android provider keys embed their own
 * clock and are never moved onto a Wallet row.
 *
 * Returns null (tombstone only) unless the flagged row is still an unbound
 * Wallet expense of the same amount within the ten-minute window and no
 * other row already owns the alert's identity.
 */
export const walletDuplicateBinding = (
  state: Pick<AppState, 'reviewTray' | 'transactions'>,
  reviewId: string,
): WalletDuplicateBinding | null => {
  const item = state.reviewTray.pending.find((candidate) => candidate.id === reviewId);
  if (!item || !isUniversalReviewAlert(item) || item.attentionReason !== 'possible-apple-pay-duplicate' ||
    !item.walletTransactionId || item.channel === 'push' ||
    !captureSourceTimeMatches(item.sourceKey, item.observedAt)) return null;
  const amount = item.event.amount.value;
  if (item.event.amount.evidence !== 'explicit' || !amount || !/^[1-9]\d{0,15}$/.test(amount.minorUnits)) return null;
  const row = state.transactions.find((transaction) => transaction.id === item.walletTransactionId);
  if (!row || !isApplePayWalletRow(row) || row.type !== 'expense' ||
    row.amountFils !== Number(amount.minorUnits) || !Number.isFinite(row.ts) ||
    Math.abs(row.ts! - item.observedAt) > APPLE_PAY_BANK_OVERLAP_MS) return null;
  const smsKey = canonicalUniversalSourceKey(item.sourceKey, item.observedAt);
  // Clock-free identities only: Apple's GUID digest or the timestamp s-key.
  if (!/^h[a-f0-9]{64}$/.test(smsKey) && !/^s\d{10,16}-[1-9]\d{0,15}$/.test(smsKey)) return null;
  if (state.transactions.some((transaction) => transaction.smsKey &&
    isUsableCaptureSourceIdentity(transaction.smsKey, transaction.ts) &&
    canonicalUniversalSourceKey(transaction.smsKey, transaction.ts) === smsKey)) return null;
  return { id: row.id, smsKey, viaPush: false, walletBound: true };
};
