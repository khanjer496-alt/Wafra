import {
  isIosApplePayReview,
  isProtectedIosCaptureReview,
  isUniversalReviewAlert,
  pruneAlertReviewTray,
  REVIEW_ALERT_CAP,
  usableWalletCardName,
  type ReviewEntry,
  type UniversalReviewAlert,
} from '@/lib/alert-review-tray';
import { categorySupportsType } from '@/lib/categories';
import { isApplePayWalletRow } from '@/lib/dedupe';
import { toISODate, transactionTime } from '@/lib/format';
import { planReviewPromotion } from '@/lib/review-promotion';
import type { Account, AppState, ApplePayCardLink, CategoryId, Transaction } from '@/lib/types';
import { canonicalUniversalSourceKey } from '@/lib/universal-import';
import { suggestUniversalCategory } from '@/lib/universal-categorization';

/**
 * iPhone "Quiet" Apple Pay capture: a Wallet card the user has confirmed once
 * posts its later purchases on its own.
 *
 * The link is Wallet's sanitized "Card or Pass" name → the account the user
 * chose when confirming that card's first captured purchase. It lives only in
 * the encrypted on-device ledger (never in a backup file) and is never
 * logged. Everything here is conservative: an unlinked or ambiguous card, a
 * missing card name, a deleted or archived account, another currency, a full
 * Review lane, or any sign that the purchase might already be in the ledger
 * leaves the purchase in Review exactly as before.
 */

export const MAX_APPLE_PAY_CARD_LINKS = 32;
/**
 * Bank SMS and bank-app notifications can lag a Wallet tap by minutes; the
 * same window the planner and Review use for a possible Apple Pay duplicate.
 * Inside it the same amount always asks, whatever the merchant text says.
 */
export const APPLE_PAY_AUTO_POST_OVERLAP_MS = 10 * 60_000;
/**
 * A bank alert can also arrive hours or days late. Within this window the same
 * amount still asks unless the two merchant texts clearly name different
 * shops. A needless question is cheap; a double count is not.
 */
export const APPLE_PAY_LATE_MATCH_MS = 3 * 24 * 60 * 60_000;

const ACCOUNT_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
/** Words that say nothing about which shop it was. */
const GENERIC_MERCHANT_WORDS = new Set([
  'card', 'cards', 'purchase', 'purchases', 'payment', 'payments', 'pay', 'apple', 'pos', 'debit', 'credit',
  'online', 'the', 'and', 'for', 'from', 'with', 'llc', 'ltd', 'inc', 'store', 'shop', 'uae', 'dxb', 'auh',
  'shj', 'dubai', 'riyadh', 'jeddah', 'transaction', 'spent', 'account',
]);

const merchantTokens = (value: string | null | undefined): string[] =>
  (value ?? '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ')
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token) && !GENERIC_MERCHANT_WORDS.has(token));

/**
 * True only when both texts name a shop and they share nothing: no common
 * word or word prefix. Missing or generic text ("Card purchase") never
 * conflicts, so it always counts as a possible match.
 */
export function merchantsConflict(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = merchantTokens(left);
  const b = merchantTokens(right);
  if (a.length === 0 || b.length === 0) return false;
  return !a.some((x) => b.some((y) => x.startsWith(y) || y.startsWith(x)));
}

/**
 * Whether a recorded purchase and a new one of the same amount may be the
 * same purchase: any merchant within ten minutes, or a merchant that does not
 * clearly differ within three days.
 */
export function mayBeSamePurchase(
  distanceMs: number,
  leftMerchant: string | null | undefined,
  rightMerchant: string | null | undefined,
): boolean {
  if (!Number.isFinite(distanceMs)) return false;
  const distance = Math.abs(distanceMs);
  if (distance <= APPLE_PAY_AUTO_POST_OVERLAP_MS) return true;
  return distance <= APPLE_PAY_LATE_MATCH_MS && !merchantsConflict(leftMerchant, rightMerchant);
}

/** Matching key: Wallet's own text, canonically composed. Case is kept. */
const cardKey = (cardOrPass: string): string => cardOrPass.normalize('NFC');

/** Drop malformed rows; one link per card (newest wins); bounded. */
export function normalizeApplePayCardLinks(value: unknown): ApplePayCardLink[] {
  if (!Array.isArray(value)) return [];
  const byCard = new Map<string, ApplePayCardLink>();
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const { cardOrPass, accountId, linkedAt, ambiguous } = row as Record<string, unknown>;
    if (!usableWalletCardName(cardOrPass) || typeof accountId !== 'string' || !ACCOUNT_ID_RE.test(accountId) ||
      typeof linkedAt !== 'number' || !Number.isSafeInteger(linkedAt) || linkedAt < 0) continue;
    const key = cardKey(cardOrPass);
    const prior = byCard.get(key);
    if (prior && prior.linkedAt > linkedAt) continue;
    byCard.delete(key);
    byCard.set(key, { cardOrPass, accountId, linkedAt, ...(ambiguous === true ? { ambiguous: true as const } : {}) });
  }
  return [...byCard.values()].sort((left, right) => left.linkedAt - right.linkedAt)
    .slice(-MAX_APPLE_PAY_CARD_LINKS);
}

/**
 * Remember one card's account. Wallet names are display names, so two cards
 * can share one ("Visa Debit"). A confirmation that would MOVE an existing
 * link to another account therefore marks the name ambiguous instead: its
 * purchases always ask in Review until the person forgets it. Invalid input
 * changes nothing.
 */
export function rememberApplePayCardLink(
  links: readonly ApplePayCardLink[] | undefined,
  cardOrPass: unknown,
  accountId: string,
  now: number,
): ApplePayCardLink[] {
  const current = normalizeApplePayCardLinks(links);
  if (!usableWalletCardName(cardOrPass) || !ACCOUNT_ID_RE.test(accountId) || !Number.isSafeInteger(now) || now < 0) {
    return current;
  }
  const key = cardKey(cardOrPass);
  const prior = current.find((link) => cardKey(link.cardOrPass) === key);
  const ambiguous = prior?.ambiguous === true || (!!prior && prior.accountId !== accountId);
  return normalizeApplePayCardLinks([
    ...current.filter((link) => cardKey(link.cardOrPass) !== key),
    { cardOrPass, accountId, linkedAt: Math.max(now, ...current.map((link) => link.linkedAt)),
      ...(ambiguous ? { ambiguous: true as const } : {}) },
  ]);
}

/** Forget one card. Its next purchase asks in Review again. */
export function forgetApplePayCardLink(
  links: readonly ApplePayCardLink[] | undefined,
  cardOrPass: string,
): ApplePayCardLink[] {
  const key = typeof cardOrPass === 'string' ? cardKey(cardOrPass) : null;
  return normalizeApplePayCardLinks(links).filter((link) => cardKey(link.cardOrPass) !== key);
}

/** The linked account only while it is unambiguous, exists and is not archived. */
export function linkedApplePayAccount(
  state: Pick<AppState, 'accounts' | 'applePayCardLinks'>,
  cardOrPass: unknown,
): Account | null {
  if (!usableWalletCardName(cardOrPass)) return null;
  const key = cardKey(cardOrPass);
  const link = normalizeApplePayCardLinks(state.applePayCardLinks).find((row) => cardKey(row.cardOrPass) === key);
  if (!link || link.ambiguous === true) return null;
  const account = state.accounts.find((row) => row.id === link.accountId);
  return account && account.archived !== true ? account : null;
}

/** The Apple Pay review a confirmation should remember, if any. */
export function applePayCardOfReview(item: ReviewEntry | undefined): string | null {
  if (!item || !isUniversalReviewAlert(item) || !isIosApplePayReview(item)) return null;
  return usableWalletCardName(item.walletCardOrPass) ? item.walletCardOrPass : null;
}

const reviewMoney = (item: ReviewEntry): { currency: string; minorUnits: string } | null => {
  if (isUniversalReviewAlert(item)) {
    const value = item.event.amount.value;
    return value && typeof value.minorUnits === 'string' ? value : null;
  }
  return item.amount ?? null;
};

const reviewMerchant = (item: ReviewEntry): string | null =>
  isUniversalReviewAlert(item) && item.event.merchant.evidence === 'explicit' ? item.event.merchant.value ?? null : null;

/**
 * Whether this purchase could already be in the ledger or waiting in Review.
 * Deliberately broader than Review's own prompt: any account, any source, and
 * bank rows up to three days apart unless the shops clearly differ. Another
 * Wallet tap is its own receipt, so only one within ten minutes asks. A false
 * positive only means the purchase asks first.
 */
function mayAlreadyBeRecorded(
  state: Pick<AppState, 'transactions' | 'reviewTray'>,
  item: UniversalReviewAlert,
  amountFils: number,
  currency: string,
  minorUnits: string,
  merchant: string,
): boolean {
  const day = toISODate(new Date(item.observedAt));
  const ledgerOverlap = state.transactions.some((row) => {
    if (row.type !== 'expense' || row.amountFils !== amountFils) return false;
    const time = transactionTime(row)?.getTime();
    if (time === undefined || !Number.isFinite(time)) return row.date === day;
    if (isApplePayWalletRow(row)) return Math.abs(time - item.observedAt) <= APPLE_PAY_AUTO_POST_OVERLAP_MS;
    return mayBeSamePurchase(time - item.observedAt, row.title, merchant);
  });
  if (ledgerOverlap) return true;
  return (state.reviewTray?.pending ?? []).some((entry) => {
    if (entry.id === item.id) return false;
    const money = reviewMoney(entry);
    return !!money && money.currency === currency && money.minorUnits === minorUnits &&
      mayBeSamePurchase(entry.observedAt - item.observedAt, reviewMerchant(entry), merchant);
  });
}

export interface LinkedApplePayPlan {
  /** New ledger rows, one per posted review, newest first. */
  transactions: Transaction[];
  /** The tray with each posted review resolved as 'added' (its replay barrier). */
  reviewTray: AppState['reviewTray'];
  ledgerMoney: AppState['ledgerMoney'];
  /** Review ids that posted; every other item belongs in Review as before. */
  postedIds: string[];
}

export interface LinkedApplePayOptions {
  /** Title for a purchase Wallet sent without a merchant (localized by the caller). */
  fallbackTitle?: string;
}

/**
 * Decide which freshly captured Apple Pay reviews may post on their own and
 * build their rows through the same promotion planner a manual confirmation
 * uses, against the authoritative state. Pure: nothing is written.
 */
export function planLinkedApplePayPosts(
  state: AppState,
  items: readonly ReviewEntry[],
  now: number,
  nextTransactionId: () => string,
  options: LinkedApplePayOptions = {},
): LinkedApplePayPlan {
  let working: AppState = state;
  const transactions: Transaction[] = [];
  const postedIds: string[] = [];
  const seen = new Set<string>();
  for (const candidate of items) {
    const card = applePayCardOfReview(candidate);
    if (!card || !isUniversalReviewAlert(candidate) || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    const item = candidate;
    if (!Number.isSafeInteger(item.observedAt) || !Number.isSafeInteger(item.expiresAt) || item.expiresAt <= now) continue;
    const account = linkedApplePayAccount(working, card);
    if (!account) continue;
    const ledger = working.ledgerMoney;
    const money = item.event.amount.evidence === 'explicit' ? item.event.amount.value : null;
    // Another currency needs a dated rate and the person's eye: Review.
    if (!ledger || !money || money.currency !== ledger.currency || money.exponent !== ledger.exponent ||
      !/^[1-9]\d{0,15}$/.test(money.minorUnits)) continue;
    const amountFils = Number(money.minorUnits);
    if (!Number.isSafeInteger(amountFils)) continue;
    // A replay or an earlier decision for this exact receipt keeps its own path.
    const key = canonicalUniversalSourceKey(item.sourceKey, item.observedAt);
    const tray = pruneAlertReviewTray(working.reviewTray, now);
    if (tray.tombstones.some((entry) => canonicalUniversalSourceKey(entry.sourceKey) === key) ||
      tray.pending.some((entry) => entry.id === item.id ||
        canonicalUniversalSourceKey(entry.sourceKey, entry.observedAt) === key)) continue;
    // Promotion briefly holds the item in the protected lane. At its cap the
    // tray's prune would cut a review without a trace, so a full lane asks.
    if (tray.pending.filter(isProtectedIosCaptureReview).length >= REVIEW_ALERT_CAP) continue;
    const merchant = item.event.merchant.evidence === 'explicit' ? item.event.merchant.value?.trim() ?? '' : '';
    if (mayAlreadyBeRecorded(working, item, amountFils, money.currency, money.minorUnits, merchant)) continue;
    const title = merchant || options.fallbackTitle?.trim() || '';
    if (!title) continue;
    const suggestion = suggestUniversalCategory(item.event, { type: 'expense', overrides: working.merchantOverrides });
    const category: CategoryId = !suggestion.needsReview && categorySupportsType(suggestion.category, 'expense')
      ? suggestion.category : 'other';
    const plan = planReviewPromotion(
      { ...working, reviewTray: { ...tray, pending: [...tray.pending, item] } },
      {
        reviewId: item.id,
        type: 'expense',
        title,
        category,
        accountId: account.id,
        date: toISODate(new Date(item.observedAt)),
        betweenOwnAccounts: false,
        universal: {
          confirmed: true,
          postingStatus: 'posted',
          amount: money,
          expectedSourceKey: item.sourceKey,
          expectedObservedAt: item.observedAt,
        },
      },
      nextTransactionId(),
      now,
      null,
    );
    if (plan.outcome !== 'added') continue;
    const row = plan.transaction;
    if (row.type !== 'expense' || row.accountId !== account.id || row.amountFils !== amountFils) continue;
    // The resolved tray must hold exactly the reviews it held before, plus
    // this receipt's 'added' barrier. Anything else (a review cut, or no
    // barrier to acknowledge the record behind) and the purchase asks.
    const before = new Set(tray.pending.map((entry) => entry.id));
    const after = plan.reviewTray.pending.map((entry) => entry.id);
    if (after.length !== before.size || after.some((id) => !before.has(id)) ||
      !plan.reviewTray.tombstones.some((entry) => entry.outcome === 'added' &&
        canonicalUniversalSourceKey(entry.sourceKey) === key)) continue;
    working = {
      ...working,
      ledgerMoney: plan.ledgerMoney,
      reviewTray: plan.reviewTray,
      transactions: [row, ...working.transactions],
    };
    transactions.unshift(row);
    postedIds.push(item.id);
  }
  return { transactions, reviewTray: working.reviewTray, ledgerMoney: working.ledgerMoney, postedIds };
}
