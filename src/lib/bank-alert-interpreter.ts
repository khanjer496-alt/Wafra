import {
  automaticMeaning,
  isApplicationPurchaseOffer,
  isCompletedCashbackCredit,
  isExpectedFutureMoneyNotice,
  SEMANTIC_CANDIDATE_LANGUAGE,
} from '@/lib/bank-alert-semantic-rules';
import { readMerchantCategoryOverride } from '@/lib/categories';
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
import {
  ledgerCurrencyExponent,
  pinnedLedgerCurrencyCode,
  withMarketPackForParsing,
} from '@/lib/markets';
import {
  hasArabicRefundHeading,
  hasMalformedBankAmount,
  isInformationOnlyAlert,
  gluedSignContradicts,
  unsupportedReading,
  principalUnproven,
  hedgedPrincipal,
  isPurchaseRefundedNotice,
  refundGovernsPrincipal,
  amountIsOnlyABalance,
  withoutReversalFooters,
  reversalLeftUnproven,
  isNotSpendingOrIncomeShape,
  isUnregisteredCallBack,
  moneyNoticeKind,
  normalizeArabic,
  parseSms,
  type ParsedSms,
} from '@/lib/sms-parser';
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

/** Preserve an already-proven return of the purchase, not a reversed credit.
 * The card must directly precede the completed-return verb in the opening
 * purchase clause. "Credit Card" is an instrument, not money taken back.
 * parseSms still owns the amount, date, source and non-posting safeguards. */
const isCompletedCardPurchaseReturn = (source: string, legacy: ParsedSms): boolean =>
  legacy.kind === 'transaction' && legacy.type === 'income' &&
  legacy.categoryGuess === 'other' && !legacy.transferHint &&
  legacy.card !== null && legacy.card.kind !== 'account' &&
  (/^(?:your\s+)?(?:card\s+|pos\s+)?purchase\s+of\b(?:[^.\n]|\.(?=\d)){0,160}?\b(?:with|using|on)\s+(?:your\s+)?(?:(?:credit|debit|covered)\s+)?card\s+(?:ending(?:\s+with)?\s+)?[x*\d -]{4,32}\s+(?:has\s+been|was)\s+(?:successfully\s+)?(?:reversed|refunded)\b/iu.test(source) ||
    // The Liv/ENBD form names the purchase AMOUNT and its shop before the
    // card: "Purchase amount of AED 120.50 at NOON on your Credit Card ending
    // 1234 has been successfully refunded". Completed wording only.
    /^purchase\s+(?:amount|amt)\s+of\b(?:[^.\n]|\.(?=\d)){0,160}?\bon\s+your\s+(?:(?:credit|debit|covered|prepaid)\s+)?card(?:\s+(?:ending(?:\s+with)?\s+)?[x*\d -]{4,32})?\s+has\s+been\s+(?:successfully\s+|fully\s+)?refunded\b/iu.test(source)) &&
  !FUTURE_REFUND.test(source);
/** "…and will be refunded", "will be credited back": a refund not yet made. */
const FUTURE_REFUND = /\bwill\s+be\s+(?:refunded|reversed|credited)\b/iu;

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
const interpretBankAlertInner = ({
  source,
  sender,
  market,
  overrides = {},
  observedAt,
}: InterpretBankAlertInput): BankAlertInterpretation => {
  if (isExpectedFutureMoneyNotice(source)) {
    return { outcome: 'refuse', meaning: 'unknown', reason: 'non-posting', evidence: [] };
  }
  // Help text and available-limit information quote a figure that did not
  // move; "شراء معلومة: ب 450.00 SR هو الحد المتاح" must not be rebuilt as a
  // purchase from its "شراء" heading once parseSms has refused it.
  if (isInformationOnlyAlert(source)) {
    return { outcome: 'refuse', meaning: 'unknown', reason: 'non-posting', evidence: [] };
  }
  // A figure inside a negated, questioned, requested, conditional or
  // promotional clause, or a body whose only figures are balances, moved no
  // money ("Did you make a AED 168.06 purchase at NOON? Reply YES or NO").
  // parseSms refuses it; the semantic fallback must not rebuild the purchase
  // from the same words for a trusted sender.
  if (moneyNoticeKind(source) || isUnregisteredCallBack(source, sender)) {
    return { outcome: 'refuse', meaning: 'unknown', reason: 'non-posting', evidence: [] };
  }
  // A refused legacy parse is not permission to reconstruct the same money
  // through semantic fallback. Every launch result is a two-decimal AED/SAR
  // amount, including results created without a legacy row.
  const pinnedCurrency = pinnedLedgerCurrencyCode();
  if (pinnedCurrency && (pinnedCurrency !== (market === 'AE' ? 'AED' : 'SAR') ||
    ledgerCurrencyExponent() !== 2)) {
    return { outcome: 'refuse', meaning: 'unknown', reason: 'unsupported-currency', evidence: [] };
  }
  if (withMarketPackForParsing(market, () => hasMalformedBankAmount(source, sender))) {
    return { outcome: 'refuse', meaning: 'unknown', reason: 'unclear-amount', evidence: [] };
  }
  const legacy = withMarketPackForParsing(market, () =>
    parseSms(source, overrides, { sender, observedAt }));
  // A bill that arrived, or the payee confirming it received YOUR payment,
  // that parseSms refused (sms-parser notSpendingOrIncome) is never rebuilt
  // here as income or a purchase. Card-bill payments and own-account moves
  // may still be read as a card settlement / own transfer: see the exported
  // wrapper below.
  const notSpending = isNotSpendingOrIncomeShape(source);
  if (!legacy && (notSpending === 'bill-received' || notSpending === 'payee-receipt')) {
    return { outcome: 'refuse', meaning: 'unknown', reason: 'non-posting', evidence: [] };
  }
  // Application/financing copy may be appended to a real purchase alert. The
  // mature regional parser gets first right of refusal: only a message that it
  // did NOT prove as a posting may be suppressed by this sales-offer shape.
  if (!legacy && isApplicationPurchaseOffer(source) && !hasAffirmativeSettledMovement(source)) {
    return { outcome: 'refuse', meaning: 'unknown', reason: 'non-posting', evidence: [] };
  }
  // In a compact field list, "A/C 1234 AED 7,500" contains a currency-suffix
  // shape that the legacy parser may read as AED 1,234. Treat that specific
  // structural collision as no legacy result; the semantic inspector still
  // requires one unambiguous movement amount and a trusted institution.
  const capturedLegacy = mistookInstrumentLast4ForAmount(source, market, legacy) ? null : legacy;
  // Keep the explicit offset name, so an unrelated equal-value outgoing
  // transfer cannot consume this credit through generic transfer pairing.
  const cashback = capturedLegacy && isCompletedCashbackCredit(source, capturedLegacy);
  const cashbackCategory = cashback ? readMerchantCategoryOverride(overrides, 'Cashback', 'income') : undefined;
  const usableLegacy = cashback && capturedLegacy
    ? { ...capturedLegacy, merchant: 'Cashback', ...(cashbackCategory ? {
        categoryGuess: cashbackCategory, categoryDeliberate: true, categoryPinned: true as const,
      } : {}) }
    : capturedLegacy;
  const semanticText = normalizeArabic(source).replace(/\s+/gu, ' ');
  if (usableLegacy && isCompletedCardPurchaseReturn(semanticText, usableLegacy)) {
    return legacyResult(usableLegacy, 'refund');
  }
  // "Your purchase of AED 50.00 at NOON has been refunded" / "… تم استردادها":
  // parseSms read the completed refund; the purchase words are not debit evidence.
  if (usableLegacy?.kind === 'transaction' && usableLegacy.type === 'income' && (isPurchaseRefundedNotice(source, usableLegacy.amountFils) ||
    // (A refund naming the PURCHASE it refunds: the semantic reader would take
    // that purchase word as the direction.)
    (refundGovernsPrincipal(source, usableLegacy.amountFils) === 'completed' &&
      /\bpurchase|(?<![\u0621-\u064A])(?:ال)?شراء/iu.test(semanticText)))) {
    return legacyResult(usableLegacy, 'refund');
  }
  // A purchase the bank says WILL be refunded or credited back has not moved
  // money yet. Whatever parseSms read from it, the purchase words in the same
  // sentence are not independent debit evidence: the semantic reader used to
  // rebuild "has been reversed and will be refunded" as money OUT. Review at
  // most, as for the Arabic refund notice below.
  if (usableLegacy?.kind === 'transaction' && usableLegacy.type === 'income' &&
    FUTURE_REFUND.test(semanticText) && /\b(?:purchase|refund|revers)/iu.test(semanticText)) {
    const pending = inspectUnparsedLaunchAlert(source, sender);
    return pending.outcome === 'review'
      ? finalFallback(pending, null)
      : { outcome: 'refuse', meaning: 'unknown', reason: 'non-posting', evidence: [] };
  }
  // A Saudi refund heading over a purchase field list. parseSms already proved
  // the completed refund (its forecast/request guards run first); the purchase
  // word beneath the heading is not independent debit evidence.
  if (usableLegacy?.kind === 'transaction' && usableLegacy.type === 'income' &&
    hasArabicRefundHeading(source)) {
    return legacyResult(usableLegacy, 'refund');
  }
  // The same shapes with a legacy row (a payee receipt read as the outgoing
  // payment it is, a transfer-flagged own move): semantics must not re-read
  // the payee's name ("CONTOSO INC PAYROLL received your payment") as income.
  if (usableLegacy && notSpending) return legacyResult(usableLegacy);
  if (usableLegacy && !SEMANTIC_CANDIDATE_LANGUAGE.test(semanticText)) {
    return legacyResult(usableLegacy);
  }
  const fallback = inspectUnparsedLaunchAlert(source, sender);
  // parseSms refused a refund-headed alert because an unfinished notice sits
  // under the heading. The purchase word beneath the heading is the purchase
  // being refunded, so the fallback must never rebuild it as money OUT:
  // Review at most.
  if (!usableLegacy && hasArabicRefundHeading(source)) {
    return fallback.outcome === 'review'
      ? finalFallback(fallback, null)
      : { outcome: 'refuse', meaning: 'unknown', reason: 'non-posting', evidence: [] };
  }
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

/**
 * A card-bill payment or an own-account move (sms-parser
 * isNotSpendingOrIncomeShape) is posted only as what it is: a card
 * settlement, or a transfer-flagged own-account move. Any other reading of
 * the same words (a utility payment, a purchase, income) waits in Review.
 */
/**
 * A semantic reading whose amount is only a balance figure in the alert ("…
 * الرصيد الائتماني المتاح SAR 610.92" read as a 610.92 purchase). The legacy
 * parser's own figure is trusted: "Credit from BALANCE STUDIO: SAR 820.66
 * refunded" names a merchant, not a balance.
 */
const fallbackReadABalance = (input: InterpretBankAlertInput, amountMinor: number): boolean => {
  if (!amountIsOnlyABalance(input.source, amountMinor)) return false;
  const legacy = withMarketPackForParsing(input.market, () =>
    parseSms(input.source, input.overrides ?? {}, { sender: input.sender, observedAt: input.observedAt }));
  return !legacy || legacy.amountFils !== amountMinor;
};
export const interpretBankAlert = (input: InterpretBankAlertInput): BankAlertInterpretation => {
  // A reversal help/conditional footer never changes the movement it follows;
  // see reversalLeftUnproven for the reversal wording left after it.
  const withoutFooters = withoutReversalFooters(input.source);
  if (withoutFooters !== input.source) return interpretBankAlert({ ...input, source: withoutFooters });
  const result = interpretBankAlertInner(input);
  if (result.outcome !== 'parsed') return result;
  if (reversalLeftUnproven(input.source, result.parsed)) {
    return { outcome: 'refuse', meaning: 'unknown', reason: 'non-posting', evidence: [] };
  }
  // The bank's own sign on the figure ("163.39 SAR+") outranks a semantic
  // re-reading of the same words, exactly as it outranks parseSms.
  if (gluedSignContradicts(input.source, result.parsed) ||
    unsupportedReading(input.source, result.parsed, input.sender) ||
    (result.parsed.kind === 'transaction' && fallbackReadABalance(input, result.parsed.amountFils)) ||
    // A semantic re-reading is held to the same two-figure proof as parseSms
    // ("Purchase of USD 100.00 … AED 20,000.00 spending room left").
    principalUnproven(input.source, result.parsed) || hedgedPrincipal(input.source, result.parsed)) {
    return { outcome: 'refuse', meaning: 'unknown', reason: 'non-posting', evidence: [] };
  }
  const shape = isNotSpendingOrIncomeShape(input.source);
  if (shape === 'card-bill' && result.meaning !== 'card-settlement' && result.parsed.kind !== 'cardPayment' &&
    !result.parsed.transferHint) {
    return { outcome: 'refuse', meaning: 'unknown', reason: 'non-posting', evidence: [] };
  }
  if (shape === 'own-move' && result.meaning !== 'own-account-transfer' && !result.parsed.transferHint) {
    return { outcome: 'refuse', meaning: 'unknown', reason: 'non-posting', evidence: [] };
  }
  return result;
};
