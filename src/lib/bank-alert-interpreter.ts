import {
  automaticMeaning,
  SEMANTIC_CANDIDATE_LANGUAGE,
} from '@/lib/bank-alert-semantic-rules';
import {
  evidenceForMeaning,
  meaningFromParsed,
  reviewEvidence,
  semanticParsed,
} from '@/lib/bank-alert-semantic-output';
import type {
  BankAlertInterpretation,
  InterpretBankAlertInput,
} from '@/lib/bank-alert-semantic-types';
import { withMarketPackForParsing } from '@/lib/markets';
import { normalizeArabic, parseSms, type ParsedSms } from '@/lib/sms-parser';
import {
  hasAffirmativeSettledMovement,
  inspectUnparsedLaunchAlert,
  inspectUnparsedLaunchSemantics,
  type UnparsedLaunchAlertDecision,
  type UnparsedLaunchSemanticDecision,
} from '@/lib/unparsed-launch-alert';

export type {
  AccountingMeaning,
  BankAlertInterpretation,
  InterpretationEvidence,
  InterpretBankAlertInput,
} from '@/lib/bank-alert-semantic-types';

const legacyResult = (
  parsed: ParsedSms,
  meaning = meaningFromParsed(parsed),
): BankAlertInterpretation => ({
  outcome: 'parsed',
  origin: 'legacy',
  parsed,
  meaning,
  evidence: ['legacy-parser'],
});

const GENERIC_PURCHASE_TITLES = new Set([
  'Card purchase',
  'Card payment',
  'Account debit',
  'Outgoing transfer',
  'Bank transfer',
  'Card',
]);

const isPostedCardPurchase = (source: string, legacy: ParsedSms): boolean =>
  legacy.kind === 'transaction' && legacy.type === 'expense' && legacy.card !== null &&
  legacy.card.kind !== 'account' &&
  legacy.categoryGuess !== 'cash-withdrawal' && legacy.categoryGuess !== 'utilities' &&
  legacy.categoryGuess !== 'telecom' && legacy.categoryGuess !== 'home-services' &&
  legacy.cardPaymentSide === undefined &&
  legacy.paymentFlowSide === undefined &&
  (/\b(?:card\b[^.\n]{0,56}\b(?:charged|used)|(?:card\s+|pos\s+)?purchase(?:d)?\b)\b|شراء|دفع بالبطاق[هة]/iu.test(source) ||
    (legacy.merchant === 'Card purchase' &&
      /\b(?:debited|charged)\b[^.\n]{0,56}\b(?:using|from)\s+(?:your\s+)?card\b/iu.test(source)));

const protectedCardPurchaseResult = (legacy: ParsedSms): BankAlertInterpretation => {
  if (!legacy.transferHint) return legacyResult(legacy, 'card-purchase');
  return {
    outcome: 'parsed',
    origin: 'semantic',
    parsed: { ...legacy, transferHint: false },
    meaning: 'card-purchase',
    evidence: ['legacy-parser', 'card-purchase-language'],
  };
};

const feePostingPrecedesVerb = (source: string): boolean => {
  const feeIndex = source.search(
    /\b(?:annual|monthly|maintenance|service|membership|renewal|overdraft|overlimit|late payment|insufficient balance|nsf)?\s*(?:card\s+|account\s+|bank\s+)?(?:fee|commission|charge)\b[\s\S]{0,80}\b(?:charged|debited|deducted)\b/iu,
  );
  if (feeIndex < 0) return false;
  const purchaseIndex = source.search(
    /\b(?:card\b[^.\n]{0,56}\b(?:charged|used)|(?:card\s+|pos\s+)?purchase(?:d)?\b)|شراء|دفع بالبطاق[هة]/iu,
  );
  return purchaseIndex < 0 || feeIndex <= purchaseIndex;
};

const isCompactCardCreditReturn = (source: string): boolean =>
  /\bcr\b/iu.test(source) && /\bcard\b/iu.test(source) &&
  /\b(?:pos|(?:card\s+)?pur)\b/iu.test(source);

const mistookInstrumentLast4ForAmount = (
  source: string,
  market: 'AE' | 'SA',
  legacy: ParsedSms | null,
): boolean => {
  const last4 = legacy?.card?.last4;
  if (!legacy || !last4 || legacy.amountFils !== Number(last4) * 100) return false;
  const currency = market === 'AE' ? 'AED' : 'SAR';
  const escapedLast4 = last4.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    String.raw`(?:\b(?:account|card|cc)|a\/?c)\b[^.\n]{0,24}\b${escapedLast4}\s+${currency}\s+[\d,.]+`,
    'iu',
  ).test(source);
};

const isUnpostedSalaryPromotion = (source: string, legacy: ParsedSms): boolean =>
  legacy.categoryGuess === 'salary' &&
  /\b(?:salary|payroll|wps)\b(?:[^.\n]|\.(?=\d)){0,48}\b(?:advance\s+)?offer\b|\bsalary\s+advance\b/iu.test(source) &&
  /\b(?:apply\s+(?:now|today)|switch|open\s+(?:an?\s+)?account|sign\s*up|join)\b/iu.test(source) &&
  !hasAffirmativeSettledMovement(source);

const semanticDecision = (
  source: string,
  market: 'AE' | 'SA',
  fallback: UnparsedLaunchAlertDecision,
  legacy: ParsedSms | null,
): UnparsedLaunchAlertDecision | UnparsedLaunchSemanticDecision => {
  if (fallback.outcome === 'review') return fallback;
  // parseSms returning a row proves a settled movement survived its stricter
  // future-clause gate. Semantic interpretation may therefore inspect the
  // real clause even when a separate future-looking footer is present. A
  // parser miss keeps the conservative blanket refusal.
  return legacy ? inspectUnparsedLaunchSemantics(source, market, true) : fallback;
};

const parseSemanticReview = (
  source: string,
  market: 'AE' | 'SA',
  fallback: UnparsedLaunchAlertDecision,
  decision: Extract<UnparsedLaunchSemanticDecision, { outcome: 'review' }> |
    Extract<UnparsedLaunchAlertDecision, { outcome: 'review' }>,
  legacy: ParsedSms | null,
): BankAlertInterpretation | null => {
  if ('market' in decision.review && decision.review.market !== market) return null;
  const trustedInstitution = 'market' in decision.review;
  const evidence = reviewEvidence(decision.review, trustedInstitution);
  const meaning = automaticMeaning(source, decision.review, legacy);
  if (!meaning) {
    if (!legacy && trustedInstitution && fallback.outcome === 'review') {
      return {
        outcome: 'review',
        meaning: fallback.review.direction === 'credit' ? 'generic-income' : 'unknown',
        review: fallback.review,
        evidence,
      };
    }
    return null;
  }
  const legacyMeaning = legacy ? meaningFromParsed(legacy) : null;
  // Merchant names and promotional footers are untrusted free text. A card
  // purchase already tied to a specific shop cannot become a salary, own
  // transfer, ATM withdrawal, fee or card settlement merely because that shop
  // (or a later footer) contains one of those words.
  if (legacy && meaning !== 'card-purchase' && isPostedCardPurchase(source, legacy) &&
    !(meaning === 'fee' && feePostingPrecedesVerb(source)) &&
    !(meaning === 'refund' && decision.review.direction === 'credit' &&
      isCompactCardCreditReturn(source))) {
    return protectedCardPurchaseResult(legacy);
  }
  if (legacy && legacy.kind !== 'transaction' &&
    !(legacy.kind === 'cardPayment' && meaning === 'card-settlement')) {
    return legacyResult(legacy, legacyMeaning ?? meaningFromParsed(legacy));
  }
  const expectedType = decision.review.direction === 'credit' ? 'income' : 'expense';
  const expectedCardSide = decision.review.direction === 'credit' ? 'receipt' : 'debit';
  const needsNormalization = meaning === 'own-account-transfer' ||
    (meaning === 'external-transfer' && legacy?.transferHint === true) ||
    (meaning === 'utility-payment' && legacy?.paymentFlowSide !== 'receipt') ||
    (meaning === 'card-purchase' && legacy !== null &&
      GENERIC_PURCHASE_TITLES.has(legacy.merchant)) ||
    (meaning === 'card-settlement' &&
      (legacy?.type !== expectedType || legacy.cardPaymentSide !== expectedCardSide));
  if (legacy && legacyMeaning === meaning && !needsNormalization) {
    return legacyResult(legacy, meaning);
  }
  const parsed = semanticParsed(source, decision.review, legacy, meaning);
  if (!parsed || (!legacy && !trustedInstitution)) return null;
  return {
    outcome: 'parsed',
    origin: 'semantic',
    parsed,
    meaning,
    evidence: [...evidence, evidenceForMeaning(meaning)],
  };
};

const finalFallback = (
  fallback: UnparsedLaunchAlertDecision,
  legacy: ParsedSms | null,
): BankAlertInterpretation => {
  if (legacy) return legacyResult(legacy);
  if (fallback.outcome === 'review') {
    return {
      outcome: 'review',
      meaning: fallback.review.direction === 'credit' ? 'generic-income' : 'unknown',
      review: fallback.review,
      evidence: reviewEvidence(fallback.review, true),
    };
  }
  return {
    outcome: 'refuse',
    meaning: 'unknown',
    reason: fallback.reason,
    evidence: [],
  };
};

/**
 * Deep launch interpretation seam.
 *
 * Existing parser results are the baseline. Independent semantic evidence may
 * correct a closed set of self-proving accounting meanings, but never the
 * parser's amount/currency. Future, failed, statement, due-only, unknown-credit
 * and multi-money alerts remain non-posting or review. A new automatic row also
 * requires exact launch-institution sender evidence; sender-free semantics may
 * only correct a row the legacy parser already intended to import.
 */
export const interpretBankAlert = ({
  source,
  sender,
  market,
  overrides = {},
}: InterpretBankAlertInput): BankAlertInterpretation => {
  const legacy = withMarketPackForParsing(market, () =>
    parseSms(source, overrides, { sender }));
  // In a compact field list, "A/C 1234 AED 7,500" contains a currency-suffix
  // shape that the legacy parser may read as AED 1,234. Treat that specific
  // structural collision as no legacy result; the semantic inspector still
  // requires one unambiguous movement amount and a trusted institution.
  const usableLegacy = mistookInstrumentLast4ForAmount(source, market, legacy) ? null : legacy;
  const semanticText = normalizeArabic(source).replace(/\s+/gu, ' ');
  if (usableLegacy && !SEMANTIC_CANDIDATE_LANGUAGE.test(semanticText)) {
    return legacyResult(usableLegacy);
  }
  const fallback = inspectUnparsedLaunchAlert(source, sender);
  // A legacy salary label inside an acquisition offer is not proof that money
  // moved. Keep this narrow: real bank alerts often use field-list purchase
  // headings plus promotional footers and must retain their legacy result.
  if (usableLegacy && fallback.outcome === 'refuse' &&
    isUnpostedSalaryPromotion(source, usableLegacy)) {
    return finalFallback(fallback, null);
  }
  const decision = semanticDecision(source, market, fallback, usableLegacy);
  if (decision.outcome === 'review') {
    const semantic = parseSemanticReview(source, market, fallback, decision, usableLegacy);
    if (semantic) return semantic;
  }
  return finalFallback(fallback, usableLegacy);
};
