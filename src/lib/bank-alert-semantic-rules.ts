import { normalizeArabic, type ParsedSms } from '@/lib/sms-parser';
import type { UnparsedLaunchSemanticReview } from '@/lib/unparsed-launch-alert';

export type AutomaticSemanticMeaning =
  | 'salary-income'
  | 'business-income'
  | 'credit-reversal'
  | 'own-account-transfer'
  | 'external-transfer'
  | 'card-purchase'
  | 'card-settlement'
  | 'utility-payment'
  | 'cash-withdrawal'
  | 'refund'
  | 'fee';

const SALARY_LANGUAGE =
  /\b(?:salar(?:y|ies)|payroll|wages?|wps)(?:\s+(?:payment|credit|transfer))?\b|\b(?:sal(?:ary)?\s+pay|monthly\s+pay|remuneration|emoluments?)\b|راتب|الراتب|مرتب|رواتب|اجر شهري|اجور|مستحقات راتب/iu;
const OWN_ACCOUNT_LANGUAGE =
  /\b(?:own|self)\s+(?:(?:account|a\/?c)\s+)?(?:transfer|trf)\b(?:[^.\n]|\.(?=\d)){0,96}\b(?:debited|credited|completed|processed|successful|dr|cr)\b|\bdr\b(?:[^.\n]|\.(?=\d)){0,48}\b(?:account|a\/?c)\b(?:[^.\n]|\.(?=\d)){0,96}\bown\s+(?:account|a\/?c)\s+(?:transfer|trf)\b(?:[^.\n]|\.(?=\d)){0,96}\bcr\b(?:[^.\n]|\.(?=\d)){0,48}\b(?:account|a\/?c)\b|\btransferred\s+between\s+(?:your|my|own)\s+accounts\b|\btransfer\s+between\s+(?:your|my|own)\s+accounts\b(?:[^.\n]|\.(?=\d)){0,96}\b(?:completed|processed|successful)\b|\bfrom\s+(?:your|my)\s+(?:account|a\/?c)\b[^.\n]{0,96}\bto\s+(?:your\s+own|my\s+own|your|my|another\s+of\s+your|own)\s+(?:accounts?|a\/?c)\b|\bfrom\s+(?:your\s+)?(?:account|a\/?c)\b(?:[^.\n]|\.(?=\d)){0,96}\bto\s+(?:another\s+account\s+of\s+yours|another\s+of\s+your\s+accounts?)\b|\bmoved?\s+from\s+(?:your|my)\s+(?:account|a\/?c)\b[^.\n]{0,96}\b(?:to|into)\s+(?:your\s+own|my\s+own|your|my|another\s+of\s+your|own)\s+(?:accounts?|a\/?c)\b|\bdebited\s+from\s+(?:your\s+)?(?:account|a\/?c)\b[^.\n]{0,112}\bcredited\s+to\s+(?:another\s+of\s+your|your\s+other|your\s+own)\s+(?:accounts?|a\/?c)\b|\b(?:account|a\/?c)\b(?:[^.\n]|\.(?=\d)){0,64}\bcredited\b(?:[^.\n]|\.(?=\d)){0,96}\bfrom\s+(?:your\s+)?(?:own|other)\s+(?:account|a\/?c)\b|\breceived\b(?:[^.\n]|\.(?=\d)){0,96}\bfrom\s+(?:your\s+)?(?:own|other)\s+(?:account|a\/?c)\b|تحويل\s+(?:بين\s+حساباتك|بين\s+حساباتي)[\s\S]{0,72}تم\s+بنجاح|تم\s+تحويل[\s\S]{0,80}من\s+حسابك[\s\S]{0,80}(?:الي|الى)\s+حسابك/iu;
const BUSINESS_INCOME_LANGUAGE =
  /\b(?:merchant|business|seller|vendor|restaurant|platform|marketplace|aggregator|acquirer|sales?|pos)\s+(?:earnings|payout|settlement|proceeds|disbursement)\b|\b(?:talabat|deliveroo|careem|uber\s+eats|noon\s+food)\s+(?:earnings|payout|settlement|proceeds|disbursement)\b|\b(?:delivery|courier|rider|driver)\s+(?:partner\s+)?earnings\b|\bproceeds\s+from\s+(?:sales|orders|deliveries|merchant activity)\b|\bbusiness\s+income\b|\binvoice(?:\s+(?:no\.?|number|#)?\s*[a-z0-9-]+)?\s+(?:was\s+)?(?:paid|settled)\b|\bpayment\s+(?:for|against)\s+invoice\b|تسوي[هة]\s+(?:تاجر|مبيعات)|ايرادات\s+(?:مبيعات|طلبات)|ارباح\s+(?:توصيل|متجر)/iu;
const REFUND_LANGUAGE =
  /\b(?:refund(?:ed)?(?!\s+(?:policy|policies|terms|rules|offer))|revers(?:al|ed)|charge[ -]?back|credited back|re-?credited)\b|استرداد|استرجاع|تم رد|اعاد[هة] المبلغ/iu;
const COMPACT_RETURNED_DEBIT_LANGUAGE =
  /\b(?:atm\s+wdl|cash\s+wdl|billpay|annual\s+fee|monthly\s+fee|maintenance\s+fee|commission|pos)\b(?:[^.\n]|\.(?=\d)){0,64}\bcr\b|\bcr\b(?:[^.\n]|\.(?=\d)){0,64}\b(?:atm\s+wdl|cash\s+wdl|billpay|annual\s+fee|monthly\s+fee|maintenance\s+fee|commission|pos)\b/iu;
const CREDIT_REVERSAL_LANGUAGE =
  /\b(?:salary|sal(?:ary)?\s+pay|payroll|wages|wps|refund|credit(?:ed)?|deposit(?:ed)?|incoming (?:payment|transfer)|inward remittance)\b[\s\S]{0,96}\b(?:was\s+|has\s+been\s+)?reversed\b|تم\s+عكس[\s\S]{0,64}(?:راتب|مرتب|ايداع|استرداد)/iu;
const CASH_WITHDRAWAL_LANGUAGE =
  /\b(?:atm\b[\s\S]{0,40}\b(?:withdraw\w*|wdl)|cash\s+wdl\b|cash\s+withdrawal\b[\s\S]{0,32}(?:\b(?:aed|sar|dhs?)\b|\d)|withdraw\w*\b[\s\S]{0,40}\b(?:atm|cash machine))\b|تم\s+سحب\s+نقدي[\s\S]{0,32}(?:\b(?:aed|sar)\b|\d)|سحب[\s\S]{0,32}(?:صراف|جهاز الصراف)/iu;
const FEE_LANGUAGE =
  /\b(?:bank|account|card|annual|monthly|maintenance|service|membership|renewal|overdraft|overlimit|late payment|insufficient balance|nsf)\s+(?:fee|charge)\b|\b(?:fee|commission)\b(?:[^.\n]|\.(?=\d)){0,56}\b(?:charged|debited|deducted|dr)\b|رسوم|عمول[هة]/iu;
const CARD_SETTLEMENT_LANGUAGE =
  /\b(?:payment|amount)\b[\s\S]{0,80}\b(?:to|towards?|against|for)\b[\s\S]{0,40}\b(?:credit|covered)\s+card\b|\b(?:debited|deducted|paid)\b[\s\S]{0,96}\b(?:to|towards?|against|for)\b[\s\S]{0,40}\b(?:credit|covered)\s+card\b[\s\S]{0,40}\bpayment\b|\b(?:credit|covered)\s+card\b[\s\S]{0,64}\bpayment\b[\s\S]{0,64}\b(?:received|credited|posted|applied|debited|deducted|paid|processed|completed|successful)\b|\bpayment\b[\s\S]{0,64}\b(?:received|credited|posted|applied)\b[\s\S]{0,40}\b(?:to\s+)?(?:your\s+)?(?:credit|covered)\s+card\b|\b(?:credit|covered)\s+card\b[\s\S]{0,40}\bcredited\s+with\s+(?:a\s+)?payment\b|\b(?:cc|card)\s+p(?:ay|y)?mt\b|\bcc\b[^.\n]{0,48}\bcard\s+p(?:ay|y)?mt\b|(?:استلام[\s\S]{0,48})?سداد[\s\S]{0,64}(?:للبطاق[هة]|بطاق[هة])\s+(?:ال)?ا?يتماني[هة]/iu;
const UTILITY_PAYMENT_LANGUAGE =
  /\b(?:electricity|water|utility|telecom|internet|mobile|gas)\s+(?:bill|account|payment)\b|\bpaid\b[^.\n]{0,80}\bfor\s+(?:an?\s+)?(?:electricity|water|utility|telecom|internet|mobile|gas)\s+(?:bill|account)\b|(?:\b(?:sewa|dewa|etisalat|du)\b|\be&(?=\s|$))[^.\n]{0,72}\b(?:bill|account|consumer|payment|paid|processed)\b|\b(?:bill|utility)\s+(?:payment|pymt)\b|\bbillpay\b|فاتور[هة]\s+(?:كهرباء|مياه|هاتف|انترنت|غاز)/iu;
const EXTERNAL_TRANSFER_LANGUAGE =
  /\b(?:sent|transferred|remitted)\b[^.\n]{0,96}\bto\s+(?!(?:your|my|own)\s+(?:account|a\/?c)\b)|\b(?:funds?|bank|instant|money)?\s*transfer\b(?:[^.\n]|\.(?=\d)){0,96}\bto\s+(?:a\s+)?beneficiary\b|\b(?:funds?|bank|instant|money)\s+transfer\b(?:[^.\n]|\.(?=\d)){0,96}\bto\s+(?!(?:your|my|own)\s+(?:account|a\/?c)\b)|\b(?:ben|beneficiary)\b(?:[^.\n]|\.(?=\d)){0,96}\b(?:received|cr)\b(?:[^.\n]|\.(?=\d)){0,96}\bfrom\s+your\s+(?:account|a\/?c)\b|\b(?:ft|ibft|trf)\b(?:[^.\n]|\.(?=\d)){0,96}\b(?:dr\b(?:[^.\n]|\.(?=\d)){0,48})?(?:from\s+)?(?:your\s+)?(?:account|a\/?c)\b(?:[^.\n]|\.(?=\d)){0,96}\b(?:to\s+)?(?:a\s+)?(?:ben|beneficiary)\b|\b(?:account|a\/?c)\b(?:[^.\n]|\.(?=\d)){0,48}\bdr\b(?:[^.\n]|\.(?=\d)){0,80}\b(?:ft|ibft|trf)\b(?:[^.\n]|\.(?=\d)){0,64}\b(?:ben|beneficiary)\b|\boutward\s+remittance\b|(?:تحويل|ارسال)[^\n]{0,80}(?:صادر|الي\s+(?:ال)?مستفيد)/iu;
const CARD_PURCHASE_LANGUAGE =
  /\b(?:card\s+purchase|purchase(?:d)?|card\b[^.\n]{0,40}\b(?:used|charged)|(?:subscription|membership)\b(?:[^.]|\.\d){0,64}\bcharged\s+(?:to|on)\s+(?:your\s+)?card|pos\s+(?:purchase|transaction)|pos\b(?:[^.\n]|\.(?=\d)){0,64}\bdr\b(?:[^.\n]|\.(?=\d)){0,48}\bcard\b|card\b(?:[^.\n]|\.(?=\d)){0,48}\bdr\b(?:[^.\n]|\.(?=\d)){0,80}\bpos\b|(?:card\s+)?pur\b(?:[^.\n]|\.(?=\d)){0,80}\bcard\b)\b|شراء|دفع بالبطاق[هة]/iu;

export const SEMANTIC_CANDIDATE_LANGUAGE = new RegExp([
  SALARY_LANGUAGE.source,
  BUSINESS_INCOME_LANGUAGE.source,
  CREDIT_REVERSAL_LANGUAGE.source,
  OWN_ACCOUNT_LANGUAGE.source,
  EXTERNAL_TRANSFER_LANGUAGE.source,
  CARD_PURCHASE_LANGUAGE.source,
  CARD_SETTLEMENT_LANGUAGE.source,
  UTILITY_PAYMENT_LANGUAGE.source,
  CASH_WITHDRAWAL_LANGUAGE.source,
  REFUND_LANGUAGE.source,
  COMPACT_RETURNED_DEBIT_LANGUAGE.source,
  FEE_LANGUAGE.source,
].join('|'), 'iu');

const matchIndex = (pattern: RegExp, source: string): number => pattern.exec(source)?.index ?? Infinity;

export const automaticMeaning = (
  source: string,
  review: UnparsedLaunchSemanticReview,
  legacy: ParsedSms | null,
): AutomaticSemanticMeaning | null => {
  // A bank may choose prose, field-list or multi-line layout for the same
  // words. Layout is not accounting evidence, so rules see collapsed
  // whitespace while the original source remains untouched in ParsedSms.
  const semanticText = normalizeArabic(source).replace(/\s+/gu, ' ');
  const credit = review.direction === 'credit';
  const debit = review.direction === 'debit';
  if (debit && CREDIT_REVERSAL_LANGUAGE.test(semanticText)) return 'credit-reversal';
  if (credit && (REFUND_LANGUAGE.test(semanticText) ||
    (COMPACT_RETURNED_DEBIT_LANGUAGE.test(semanticText) &&
      !BUSINESS_INCOME_LANGUAGE.test(semanticText)))) return 'refund';
  if (credit && SALARY_LANGUAGE.test(semanticText)) return 'salary-income';
  if (credit && BUSINESS_INCOME_LANGUAGE.test(semanticText)) return 'business-income';
  if (OWN_ACCOUNT_LANGUAGE.test(semanticText)) return 'own-account-transfer';
  const hasCreditCard =
    (review.instrument?.kind === 'card' && review.instrument.last4) ||
    (legacy?.card?.kind === 'credit' && legacy.card.last4);
  const cardSettlementIndex = hasCreditCard
    ? matchIndex(CARD_SETTLEMENT_LANGUAGE, semanticText)
    : Infinity;
  if (debit && cardSettlementIndex < Infinity) {
    const debitSpecialists: [number, AutomaticSemanticMeaning][] = [
      [matchIndex(CASH_WITHDRAWAL_LANGUAGE, semanticText), 'cash-withdrawal'],
      [matchIndex(FEE_LANGUAGE, semanticText), 'fee'],
      [matchIndex(UTILITY_PAYMENT_LANGUAGE, semanticText), 'utility-payment'],
    ];
    const firstSpecialist = debitSpecialists
      .filter(([index]) => index < cardSettlementIndex)
      .sort(([left], [right]) => left - right)[0];
    if (firstSpecialist) return firstSpecialist[1];
  }
  if (cardSettlementIndex < Infinity) return 'card-settlement';
  if (debit && CASH_WITHDRAWAL_LANGUAGE.test(semanticText)) return 'cash-withdrawal';
  if (debit && FEE_LANGUAGE.test(semanticText)) return 'fee';
  if (debit && UTILITY_PAYMENT_LANGUAGE.test(semanticText)) return 'utility-payment';
  if (debit && EXTERNAL_TRANSFER_LANGUAGE.test(semanticText)) return 'external-transfer';
  if (debit && CARD_PURCHASE_LANGUAGE.test(semanticText)) return 'card-purchase';
  return null;
};
