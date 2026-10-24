import { learnFromConfirmation } from '@/lib/learned-alert-formats';
import { detectLaunchMarketFromAlert, detectLaunchMarketFromSender } from '@/lib/markets';
import type { ReviewShareCandidate } from '@/lib/alert-review-tray';
import { toSharedAlertShape, type SharedAlertShape } from '@/lib/shared-alert-formats';
import type { UniversalBankEvent } from '@/lib/universal-types';

/**
 * Sharing consent. `undefined` means the person never chose, which is ON; only
 * an explicit `false` (their choice, or a restored backup's) is off. Private
 * Mode overrides everything and never sends.
 */
export const sharesAlertFormats = (state: { shareAlertFormats?: boolean; privateMode?: boolean }): boolean =>
  state.shareAlertFormats !== false && state.privateMode !== true;

// Capture code runs outside React, so the store mirrors the effective consent
// here (like the best-effort auto-post flag). Off until the store has hydrated.
let sharingActive = false;
export const setAlertFormatSharingActive = (active: boolean): void => { sharingActive = active === true; };
export const isAlertFormatSharingActive = (): boolean => sharingActive;

/**
 * Non-Latin boilerplate that may stay as a literal. The name heuristic only
 * understands Latin capitalisation, so any other-script word outside this short
 * list refuses the shape (the relay's 3-person threshold is the second guard).
 */
const NON_LATIN_BOILERPLATE = new Set([
  'تم', 'شراء', 'خصم', 'إيداع', 'ايداع', 'تحويل', 'مبلغ', 'رصيد', 'بطاقة', 'بطاقتك', 'حساب', 'حسابك',
  'من', 'إلى', 'الى', 'في', 'بقيمة', 'لدى', 'عملية', 'الحالي', 'المتاح', 'على', 'عبر', 'بتاريخ',
]);
const NON_LATIN_LETTERS = /[\p{L}\p{M}]+/gu;
const hasUnlistedNonLatinWord = (literal: string): boolean => {
  for (const word of literal.match(NON_LATIN_LETTERS) ?? []) {
    if (/^\p{Script=Latin}+$/u.test(word.replace(/\p{M}/gu, ''))) continue;
    const plain = word.replace(/[\u064B-\u065F\u0670\u0640]/g, '');
    if (!NON_LATIN_BOILERPLATE.has(plain) && !NON_LATIN_BOILERPLATE.has(word)) return true;
  }
  return false;
};

/** Every family but these names a counterparty, so it needs a grounded merchant slot. */
const EXEMPT_FROM_MERCHANT_SLOT = new Set<string>(['cash-withdrawal', 'fee']);

export interface CandidateShareContext {
  country?: string | null;
  /** Override for tests; defaults to the mirrored store consent. */
  active?: boolean;
}

/**
 * While the alert text is still in memory, build the value-free shape for a
 * Review item the proven AE/SA parsers did not recognise. Returns only the
 * shape, its hash and the local reading it was built from; the text never
 * leaves this function. Null whenever consent is off, Private Mode is on, the
 * alert is an AE/SA launch alert, or the shape cannot be made safely.
 */
export function buildCandidateShareShape(
  source: string,
  sender: string | null,
  event: UniversalBankEvent,
  context: CandidateShareContext = {},
): ReviewShareCandidate | null {
  try {
    if (!(context.active ?? sharingActive)) return null;
    const amount = event.amount.evidence === 'explicit' ? event.amount.value : null;
    if (!amount || (event.direction !== 'debit' && event.direction !== 'credit')) return null;
    const amountMinor = Number(amount.minorUnits);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
    const launch = detectLaunchMarketFromAlert(source, sender ?? '') ?? detectLaunchMarketFromSender(sender ?? '');
    if (launch === 'AE' || launch === 'SA' || context.country === 'AE' || context.country === 'SA') return null;
    const merchant = event.merchant.evidence === 'explicit' && event.merchant.value &&
      source.includes(event.merchant.value) ? event.merchant.value : null;
    const date = event.transactionDate.evidence === 'explicit' ? event.transactionDate.value : null;
    const learned = learnFromConfirmation({
      source, sender, now: 0,
      confirmed: { amountMinor, currency: amount.currency, exponent: amount.exponent, direction: event.direction,
        merchant, date },
      context: { country: context.country ?? null, routedMarket: launch ?? null, launchRoute: false },
    });
    if (learned.ok === false) return null;
    const made = toSharedAlertShape(learned.template);
    if (made.ok === false) return null;
    // Counterparty words would otherwise survive as literals (the name check misses
    // lowercase and non-Latin names): require an exactly-grounded merchant slot.
    if (!EXEMPT_FROM_MERCHANT_SLOT.has(event.family) && !made.shape.tokens.some((token) => token.k === 'MER')) return null;
    if (made.shape.tokens.some((token) => token.k === 'L' && hasUnlistedNonLatinWord(token.v))) return null;
    return { shareShape: made.shape, shareHash: made.hash,
      shareBasis: { amountMinor, currency: amount.currency, direction: event.direction } };
  } catch {
    return null;
  }
}

/**
 * At confirmation: submit only when the item carries a candidate, the person
 * confirmed exactly the reading the shape was built from (a corrected amount,
 * currency or direction means the slots may be wrong), and consent is on now.
 */
export function shouldSubmitConfirmedShape(
  item: { shareShape?: SharedAlertShape; shareBasis?: ReviewShareCandidate['shareBasis'] },
  confirmed: { amountMinor: number; currency: string; direction: 'debit' | 'credit' },
  consent: { shareAlertFormats?: boolean; privateMode?: boolean },
): boolean {
  const basis = item.shareBasis;
  return !!item.shareShape && !!basis && sharesAlertFormats(consent) &&
    basis.amountMinor === confirmed.amountMinor && basis.currency === confirmed.currency &&
    basis.direction === confirmed.direction;
}
