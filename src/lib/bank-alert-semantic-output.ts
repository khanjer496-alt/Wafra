import type { AutomaticSemanticMeaning } from '@/lib/bank-alert-semantic-rules';
import type {
  AccountingMeaning,
  InterpretationEvidence,
} from '@/lib/bank-alert-semantic-types';
import type { ParsedCard, ParsedSms } from '@/lib/sms-parser';
import type { UnparsedLaunchSemanticReview } from '@/lib/unparsed-launch-alert';
import type { CategoryId } from '@/lib/types';

const STRUCTURAL_FEE_TITLES = new Set([
  'Bank fee',
  'Annual card fee',
  'Annual bank fee',
  'Account maintenance fee',
  'Overlimit fee',
  'Insufficient balance fee',
  'Late payment fee',
  'Overdraft fee',
  'Service charge',
  'VAT fee',
]);

export const meaningFromParsed = (parsed: ParsedSms): AccountingMeaning => {
  if (parsed.kind === 'billDue') return 'bill-due';
  if (parsed.kind === 'cardStatement') return 'card-statement';
  if (parsed.kind === 'cardPayment') return 'card-settlement';
  if (parsed.type === 'income') {
    if (parsed.categoryGuess === 'salary') return 'salary-income';
    if (parsed.categoryGuess === 'business') return 'business-income';
    if (/refund/i.test(parsed.merchant)) return 'refund';
    if (parsed.transferHint) return 'own-account-transfer';
    return 'generic-income';
  }
  if (parsed.transferHint) return 'own-account-transfer';
  if (parsed.paymentFlowSide === 'receipt' || parsed.categoryGuess === 'utilities') {
    return 'utility-payment';
  }
  if (parsed.categoryGuess === 'cash-withdrawal') return 'cash-withdrawal';
  if (STRUCTURAL_FEE_TITLES.has(parsed.merchant)) return 'fee';
  if (parsed.card && parsed.card.kind !== 'account') return 'card-purchase';
  if (/transfer/i.test(parsed.merchant)) return 'external-transfer';
  return parsed.card ? 'card-purchase' : 'purchase';
};

export const reviewEvidence = (
  review: UnparsedLaunchSemanticReview,
  trustedInstitution: boolean,
): InterpretationEvidence[] => [
  ...(trustedInstitution ? ['trusted-institution-sender' as const] : []),
  'posted-status',
  'single-local-amount',
  review.direction === 'credit' ? 'credit-direction' : 'debit-direction',
];

const EVIDENCE_BY_MEANING = {
  'salary-income': 'salary-language',
  'business-income': 'business-income-language',
  'credit-reversal': 'credit-reversal-language',
  'own-account-transfer': 'own-account-language',
  'external-transfer': 'external-transfer-language',
  'card-purchase': 'card-purchase-language',
  'card-settlement': 'card-settlement-language',
  'utility-payment': 'utility-payment-language',
  'cash-withdrawal': 'cash-withdrawal-language',
  refund: 'refund-language',
  fee: 'fee-language',
} as const satisfies Record<AutomaticSemanticMeaning, InterpretationEvidence>;

export const evidenceForMeaning = (
  meaning: AutomaticSemanticMeaning,
): InterpretationEvidence => EVIDENCE_BY_MEANING[meaning];

const amountFilsFrom = (review: UnparsedLaunchSemanticReview): number | null => {
  if (review.amount.exponent !== 2 || !/^\d{1,15}$/.test(review.amount.minorUnits)) return null;
  const amountFils = Number(review.amount.minorUnits);
  return Number.isSafeInteger(amountFils) && amountFils > 0 ? amountFils : null;
};

const parsedCardFrom = (review: UnparsedLaunchSemanticReview): ParsedCard | null => {
  if (!review.instrument?.last4) return null;
  return {
    last4: review.instrument.last4,
    kind: review.instrument.kind === 'account' ? 'account' : 'unknown',
  };
};

const feeMerchant = (source: string): string => {
  if (/\binsufficient balance|\bnsf\b/iu.test(source)) return 'Insufficient balance fee';
  if (/\boverlimit\b/iu.test(source)) return 'Overlimit fee';
  if (/\blate payment\b/iu.test(source)) return 'Late payment fee';
  if (/\boverdraft\b/iu.test(source)) return 'Overdraft fee';
  if (/\b(?:monthly|maintenance)\b/iu.test(source)) return 'Account maintenance fee';
  if (/\bannual\b/iu.test(source)) {
    return /\bcard\b/iu.test(source) ? 'Annual card fee' : 'Annual bank fee';
  }
  if (/\bservice charge\b|رسم خدم[هة]/iu.test(source)) return 'Service charge';
  return 'Bank fee';
};

const subscriptionMerchant = (source: string): string | null => {
  const match = source.match(
    /(?:^|[.!?]\s*)(?:your\s+)?([\p{L}\p{N}][\p{L}\p{N} .&+_'’-]{1,47}?)\s+(?:(?:monthly|annual|yearly)\s+)?(?:subscription|membership)\b/iu,
  );
  if (!match) return null;
  const value = match[1].trim().replace(/\s+/gu, ' ');
  if (/^(?:a|an|the|my|your|new|monthly|annual|yearly)$/iu.test(value)) return null;
  return value.replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
};

const genericMerchant = (
  meaning: AutomaticSemanticMeaning,
  source: string,
  card: ParsedCard | null,
): string => {
  if (meaning === 'salary-income') return 'Salary';
  if (meaning === 'business-income') return 'Business income';
  if (meaning === 'credit-reversal') return 'Credit reversal';
  if (meaning === 'own-account-transfer') return 'Own account transfer';
  if (meaning === 'external-transfer') return 'Outgoing transfer';
  if (meaning === 'card-purchase') return subscriptionMerchant(source) ?? 'Card purchase';
  if (meaning === 'card-settlement') {
    return card?.last4 ? `Card •${card.last4} payment` : 'Card payment';
  }
  if (meaning === 'utility-payment') return 'Utility payment';
  if (meaning === 'cash-withdrawal') return 'ATM withdrawal';
  if (meaning === 'refund') return 'Refund';
  return feeMerchant(source);
};

const GENERIC_LEGACY_MERCHANT = new Set([
  'Incoming transfer',
  'Account credit',
  'Bank transfer',
  'Outgoing transfer',
  'Card purchase',
  'Card',
  'Bill payment',
]);

const categoryForMeaning = (meaning: AutomaticSemanticMeaning): CategoryId => {
  if (meaning === 'salary-income') return 'salary';
  if (meaning === 'business-income') return 'business';
  if (meaning === 'utility-payment') return 'utilities';
  if (meaning === 'cash-withdrawal') return 'cash-withdrawal';
  return 'other';
};

export const semanticParsed = (
  source: string,
  review: UnparsedLaunchSemanticReview,
  legacy: ParsedSms | null,
  meaning: AutomaticSemanticMeaning,
): ParsedSms | null => {
  const amountFils = amountFilsFrom(review);
  if (amountFils === null) return null;
  if (legacy && (legacy.amountFils !== amountFils || legacy.currency !== review.amount.currency)) {
    return null;
  }
  const type = review.direction === 'credit' ? 'income' as const : 'expense' as const;
  const parsedCard = legacy?.card ?? parsedCardFrom(review);
  const card = meaning === 'card-settlement' && parsedCard?.kind === 'unknown'
    ? { ...parsedCard, kind: 'credit' as const }
    : parsedCard;
  const fallbackMerchant = genericMerchant(meaning, source, card);
  const keepLegacyMerchant = legacy && !GENERIC_LEGACY_MERCHANT.has(legacy.merchant) &&
    meaning !== 'own-account-transfer' && meaning !== 'salary-income' &&
    meaning !== 'credit-reversal' && meaning !== 'refund' &&
    meaning !== 'cash-withdrawal' && meaning !== 'fee' &&
    meaning !== 'card-settlement';
  const merchant = legacy?.categoryPinned
    ? legacy.merchant
    : keepLegacyMerchant ? legacy.merchant : fallbackMerchant;
  const keepSpecificUtilityCategory = meaning === 'utility-payment' &&
    legacy?.categoryDeliberate === true &&
    (legacy.categoryGuess === 'utilities' || legacy.categoryGuess === 'telecom' ||
      legacy.categoryGuess === 'home-services');
  const keepSpecificPurchaseCategory = meaning === 'card-purchase' &&
    legacy?.categoryDeliberate === true;
  const keepSpecificTransferCategory = meaning === 'external-transfer' &&
    legacy?.categoryDeliberate === true && legacy.categoryGuess !== 'salary' &&
    legacy.categoryGuess !== 'business';
  const categoryGuess = legacy?.categoryPinned
    ? legacy.categoryGuess
    : keepSpecificUtilityCategory || keepSpecificPurchaseCategory || keepSpecificTransferCategory
      ? legacy.categoryGuess
      : categoryForMeaning(meaning);
  const categoryDeliberate = legacy?.categoryPinned ||
    (meaning === 'card-purchase' ? legacy?.categoryDeliberate === true : true);
  const cardPayment = meaning === 'card-settlement';
  const utilityPayment = meaning === 'utility-payment';
  const transferHint = meaning === 'own-account-transfer' || cardPayment;
  const base: ParsedSms = legacy ?? {
    kind: cardPayment ? 'cardPayment' : 'transaction',
    type,
    amountFils,
    currency: review.amount.currency,
    merchant,
    date: null,
    dueDay: null,
    minDueFils: null,
    card,
    reference: null,
    transferHint,
    snapshotFils: null,
    snapshotKind: null,
    categoryGuess,
    categoryDeliberate,
    raw: source,
  };
  return {
    ...base,
    kind: cardPayment ? 'cardPayment' : 'transaction',
    type,
    amountFils,
    currency: review.amount.currency,
    merchant,
    card,
    cardPaymentSide: cardPayment
      ? review.direction === 'credit' ? 'receipt' : 'debit'
      : undefined,
    paymentFlowSide: utilityPayment ? 'receipt' : undefined,
    transferHint,
    categoryGuess,
    categoryDeliberate,
    categoryPinned: legacy?.categoryPinned,
    raw: source,
  };
};
