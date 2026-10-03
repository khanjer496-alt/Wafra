import { isUniversalReviewAlert, type ReviewEntry } from '@/lib/alert-review-tray';

/**
 * Why one Review item is waiting, as one reason the card can say in a sentence.
 *
 * Everything here reads structured fields the tray already keeps; the queue
 * stores no message text, so no reason quotes or paraphrases the alert. The
 * order is the order of consequence: an explicit attention flag (possible
 * duplicate or replay) outranks a currency the ledger cannot hold, which
 * outranks "not a payment", which outranks an unclear amount or merchant.
 */
export type ReviewReason =
  | 'apple-pay-duplicate'
  | 'notification-replay'
  | 'currency'
  | 'not-a-payment'
  | 'amount-choice'
  | 'amount-missing'
  | 'merchant-unsure'
  | 'unfamiliar-app'
  | 'confirm';

export function reviewReason(item: ReviewEntry, facts: {
  /** `isOrdinaryUniversalPosting(event)` for a universal item; ignored otherwise. */
  ordinaryPosting: boolean;
  /** Distinct plausible transaction amounts (`reviewMoneyChoices`), universal items only. */
  amountChoices: number;
}): ReviewReason {
  if (item.attentionReason === 'possible-apple-pay-duplicate') return 'apple-pay-duplicate';
  if (item.attentionReason === 'possible-notification-replay') return 'notification-replay';
  if (isUniversalReviewAlert(item)) {
    if (item.currencyConflict === true) return 'currency';
    if (!facts.ordinaryPosting) return 'not-a-payment';
    if (facts.amountChoices > 1) return 'amount-choice';
    if (facts.amountChoices === 0) return 'amount-missing';
    if (item.event.merchant.evidence !== 'explicit' || !item.event.merchant.value) return 'merchant-unsure';
  }
  if (item.sourceClass === 'financial-candidate') return 'unfamiliar-app';
  return 'confirm';
}

/** Merchant name only when the alert stated it explicitly; never inferred. */
export function reviewMerchant(item: ReviewEntry): string | null {
  if (!isUniversalReviewAlert(item)) return null;
  const merchant = item.event.merchant;
  return merchant.evidence === 'explicit' && merchant.value ? merchant.value : null;
}

/** "Not a purchase" is only the right words for something that claimed to be one. */
export function reviewIsPurchase(item: ReviewEntry): boolean {
  return isUniversalReviewAlert(item) ? item.event.family === 'purchase' : item.family === 'purchase';
}
