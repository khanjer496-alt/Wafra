import { inspectAlertDraft, type CurrencyAliasMap } from '@/lib/alert-draft';
import type { InstitutionGrammarMetadata } from '@/lib/alert-institution-grammars';
import type { ReviewAlert } from '@/lib/alert-review-tray';
import { MARKETS } from '@/lib/markets';
import { nonPostingReason, normalizeArabic } from '@/lib/sms-parser';

export const UNPARSED_LAUNCH_REVIEW_VERSION = 1;

/**
 * Stable shape used only as input to a device-keyed fingerprint. Numbers and
 * contact-like material disappear before hashing; this normalized text itself
 * must never be persisted or returned by a relay.
 */
export const normalizeUnparsedLaunchTemplate = (source: string): string => source
  .normalize('NFKC')
  .toLocaleLowerCase('en-US')
  .replace(/https?:\/\/\S+|www\.\S+/giu, ' <url> ')
  .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, ' <email> ')
  .replace(/[+*x•·#\s-]*\d(?:[\d,.:\/\-*x•·#\s]*\d)?/giu, ' <n> ')
  .replace(/[^\p{L}<>]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export type UnparsedLaunchRefusal =
  | 'unknown-institution'
  | 'non-posting'
  | 'unclear-direction'
  | 'unclear-amount'
  | 'unsupported-currency';

export interface UnparsedLaunchAlertReview {
  parserVersion: number;
  market: 'AE' | 'SA';
  institution: string;
  grammar: InstitutionGrammarMetadata;
  amount: ReviewAlert['amount'];
  direction: ReviewAlert['direction'];
  family: ReviewAlert['family'];
  rail: string | null;
  instrument: ReviewAlert['instrument'];
}

export type UnparsedLaunchSemanticReview = Pick<
  UnparsedLaunchAlertReview,
  'amount' | 'direction' | 'family' | 'rail' | 'instrument'
>;

export type UnparsedLaunchSemanticDecision =
  | { outcome: 'review'; review: UnparsedLaunchSemanticReview }
  | { outcome: 'refuse'; reason: Exclude<UnparsedLaunchRefusal, 'unknown-institution'> };

export type UnparsedLaunchAlertDecision =
  | { outcome: 'review'; review: UnparsedLaunchAlertReview }
  | { outcome: 'refuse'; reason: UnparsedLaunchRefusal };

const AUTH_OR_FUTURE = /\b(?:otp|one[ -]?time|verification code|security code|approve|declined|failed|rejected|pending|processing|will be|scheduled|due(?:\s+on)?|statement|minimum due|offers?|cashbacks?|save\s+up\s+to|get\s+up\s+to|apply\s+(?:now|today)|eligible\s+for|(?:when|once|if)\s+(?:you\s+)?(?:are\s+)?(?:eligible|qualif(?:y|ied))|after\s+(?:(?:your\s+)?registration|you\s+(?:register|sign\s+up|open\s+(?:an?\s+)?account)|opening\s+(?:an?\s+)?account)|upon\s+(?:registration|sign[ -]?up|account\s+opening))\b|رمز (?:التحقق|التأكيد)|سيتم|مستحق|مرفوض|فشل|عرض/iu;
// Terse bank ledgers use CR/DR as verbs. They are accepted only beside a
// concrete account/card noun; a bare abbreviation in merchant or campaign
// text is not posting or direction evidence.
const COMPACT_LEDGER_CREDIT =
  /\b(?:account|a\/?c|card|cc)\b(?:[^.\n]|\.(?=\d)){0,48}\bcr\b|\bcr\b(?:[^.\n]|\.(?=\d)){0,48}\b(?:account|a\/?c|card|cc)\b/iu;
const COMPACT_LEDGER_DEBIT =
  /\b(?:account|a\/?c|card|cc)\b(?:[^.\n]|\.(?=\d)){0,48}\bdr\b|\bdr\b(?:[^.\n]|\.(?=\d)){0,48}\b(?:account|a\/?c|card|cc)\b/iu;
const COMPACT_ACCOUNT_CREDIT =
  /\bcredited\s+(?:to\s+)?(?:your\s+)?(?:account|a\/?c)\b/iu;
const COMPACT_LEDGER_POSTED = new RegExp(
  `${COMPACT_LEDGER_CREDIT.source}|${COMPACT_LEDGER_DEBIT.source}` +
    String.raw`|\b(?:atm|cash)\s+wdl\b|\b(?:card\s+)?pur\b(?:[^.\n]|\.(?=\d)){0,80}\bcard\b` +
    String.raw`|\b(?:ft|ibft)\b(?:[^.\n]|\.(?=\d)){0,96}\b(?:ben|beneficiary)\b(?:[^.\n]|\.(?=\d)){0,48}\b(?:success|successful|completed)\b`,
  'iu',
);
const AFFIRMATIVE_SETTLED_MOVEMENT =
  /\b(?:credited|deposited|received|debited|deducted|withdrawn|charged|purchased|paid|sent|transferred|moved|posted|completed|processed|successful|refunded|reversed|re-?credited)\b|\bpayment\s+applied\b|\b(?:has\s+been|was)\s+(?:applied|assessed)\b|تم (?:ايداع|استلام|ارسال|استقطاع|خصم|دفع|سداد|تحويل|تنفيذ|استرداد|رد|عكس|الخصم|الدفع|التحويل|التنفيذ)/iu;

/** Strong posting proof used when promotional/future language is present. */
export const hasAffirmativeSettledMovement = (source: string): boolean => {
  const bounded = normalizeArabic(source.slice(0, 4096).normalize('NFKC')).replace(/\s+/gu, ' ');
  return AFFIRMATIVE_SETTLED_MOVEMENT.test(bounded) || COMPACT_LEDGER_POSTED.test(bounded);
};
// A family word is not proof that money moved. In particular, a bare
// "salary AED ..." banner and "transfer offer" must never become ledger rows.
// Require a completed movement verb independently of direction/family.
const POSTED_MOVEMENT = /\b(?:credit\s+alert|credited|deposited|received|debited|deducted|withdrawn|cash withdrawal|charged|purchase(?:d)?|paid|sent|transferred|moved|posted|completed|processed|successful|refunded|reversed|re-?credited)\b|\bpayment\s+applied\s+to\s+(?:your\s+)?(?:credit|covered)\s+card\b|\b(?:has\s+been|was)\s+(?:applied|assessed)\b|\batm\s+wdl\b|تم (?:ايداع|استلام|ارسال|استقطاع|خصم|دفع|سداد|تحويل|تنفيذ|استرداد|رد|عكس|الخصم|الدفع|التحويل|التنفيذ)|اودع|خصم|سحب|شراء|استرداد|سداد|تحويل[^\n]{0,96}تم بنجاح/iu;
const CREDIT = /\bcredit\s+alert\b[^.\n]{0,96}\b(?:salary|payroll|wages|wps|monthly\s+pay|remuneration|emoluments?)\b|\b(?:account|a\/?c)\b[^.\n]{0,56}\b(?:has\s+been\s+|was\s+)?credited(?:\s+(?:with|by))?\b|\b(?:credited|deposited|received|salary|payroll|wages|wps|inward remittance|transferred|paid|posted)\b[^.\n]{0,80}\b(?:to|into|in)\s+(?:(?:your|the)\s+)?(?:[\p{L}&-]+\s+){0,3}(?:bank\s+)?(?:account|a\/?c)|\b(?:salary|payroll|wages|wps|monthly\s+pay|remuneration|emoluments?)\b[^.\n]{0,80}\b(?:credit(?:ed)?|deposited|received|paid|transferred|posted)\b|\b(?:refund(?:ed)?|reversed|credited back|re-?credited)\b[^\n]{0,80}\b(?:to|into|on)\s+(?:your\s+)?(?:account|a\/?c|card)\b|\b(?:credit|covered)\s+card\s+payment\b[\s\S]{0,40}\b(?:received|credited|posted|applied)\b|\bpayment\b[\s\S]{0,72}\b(?:received|credited|posted|applied)\b[\s\S]{0,40}\b(?:for|towards?|to)\b[\s\S]{0,32}\b(?:your\s+)?(?:credit|covered)\s+card\b|\b(?:credit|covered)\s+card\b[^.\n]{0,48}\bcredited\s+with\s+(?:a\s+)?payment\b|تم ايداع|تم (?:استرداد|رد)[^\n]{0,80}(?:الي|الى) (?:حسابك|بطاقتك)|تم استلام[^\n]{0,64}سداد[^\n]{0,48}بطاق[هة]|حوال[هة] وارد[هة]?|راتب|مرتب/iu;
const REFUND_CREDIT = /\b(?:refund|reversal|charge[ -]?back)\b[^\n]{0,96}\b(?:posted|credited|re-?credited|refunded|returned)?\s*(?:to|into|on)\s+(?:your\s+)?(?:account|a\/?c|card)\b|\b(?:cash withdrawal|utility payment|outgoing transfer|card purchase)\b[^\n]{0,96}\breversed\b[^\n]{0,64}\bcredited\s+(?:to|into)\s+(?:your\s+)?(?:account|a\/?c|card)\b|تم (?:استرداد|رد)[^\n]{0,80}(?:الي|الى) (?:حسابك|بطاقتك)|تم\s+عكس[^\n]{0,80}(?:تحويل|خصم|سحب)[^\n]{0,80}(?:اعاد[هة]|رد)[^\n]{0,40}(?:الي|الى)\s+حسابك/iu;
const REFUND_FOR_REVERSED_MOVEMENT = /\b(?:refund|re-?credit(?:ed)?)\b[^.\n]{0,96}\b(?:for|of|against)\s+(?:a\s+)?reversed\s+(?:purchase|transaction|charge|payment)\b/iu;
const DEBIT_FEE_REVERSAL_CREDIT =
  /\b(?:fee|commission|bank\s+charge|account\s+charge|card\s+charge)\b(?:[^.\n]|\.(?=\d)){0,96}\b(?:was\s+|has\s+been\s+)?reversed\b/iu;
const SALARY_PROCESSED_TO_ACCOUNT_CREDIT =
  /\b(?:salary|payroll|wages|wps|monthly\s+pay|remuneration|emoluments?)\b(?:[^.\n]|\.(?=\d)){0,80}\bprocessed\s+(?:to|into)\s+(?:your\s+)?(?:account|a\/?c)\b/iu;
const CREDIT_REVERSAL_DEBIT = /\b(?:salary|payroll|wages|wps|refund|credit(?:ed)?|deposit(?:ed)?|incoming (?:payment|transfer)|inward remittance)\b[^\n]{0,96}\b(?:was\s+|has\s+been\s+)?reversed\b|\brefund\b[^\n]{0,96}\breversed\b[^\n]{0,48}\bdebited\b|تم\s+عكس[^\n]{0,64}(?:راتب|مرتب|ايداع|استرداد)/iu;
const COMPACT_CREDIT_REVERSAL_DEBIT =
  /\b(?:sal(?:ary)?\s+pay|payroll|wps)\b(?:[^.\n]|\.(?=\d)){0,96}\bcr\b(?:[^.\n]|\.(?=\d)){0,96}\breversed\b/iu;
const COMPACT_DEBIT_REVERSAL_CREDIT =
  /\b(?:atm\s+wdl|cash\s+wdl|billpay|annual\s+fee|monthly\s+fee|maintenance\s+fee|commission|pos)\b(?:[^.\n]|\.(?=\d)){0,96}\bdr\b(?:[^.\n]|\.(?=\d)){0,96}\breversed\b/iu;
const DEBIT = /\b(?:debited|deducted|withdrawn|charged|purchase|paid|sent|moved)\b[^.\n]{0,80}\b(?:of|from|out\s+of|using|with|at|to)\b|\b(?:own|self)\s+(?:account\s+)?transfer\b[^\n]{0,120}\bfrom\b|\bfrom\s+(?:your|my)\s+(?:account|a\/?c)\b[\s\S]{0,96}\bto\s+(?:your\s+own|my\s+own|your|my|another\s+of\s+your|own)\s+(?:accounts?|a\/?c)\b|\btransfer\b[\s\S]{0,96}\bto\s+(?:a\s+)?beneficiary\b|\btransferred\s+between\s+(?:your|my|own)\s+accounts\b|\bcash withdrawal\b[^\n]{0,80}\b(?:from|at)\b|\btransferred\b[^.\n]{0,80}\b(?:from|out\s+of)\s+(?:your\s+)?(?:account|a\/?c)\b|\b(?:card|account|a\/?c)\b[^.\n]{0,48}\b(?:debited|charged|used)\b|\b(?:credit|covered)\s+card\b[^\n]{0,64}\bpayment\b[^\n]{0,48}\b(?:processed|completed|successful)\b|\b(?:electricity|water|utility|telecom|internet|mobile|gas)\s+(?:bill|account|payment)\b[^\n]{0,96}\b(?:paid|processed|completed|successful)\b|\bpaid\b[^\n]{0,80}\bfor\s+(?:an?\s+)?(?:electricity|water|utility|telecom|internet|mobile|gas)\s+(?:bill|account)\b|(?:\b(?:sewa|dewa|etisalat|du)\b|\be&(?=\s|$))[^\n]{0,96}\b(?:payment|bill|account)\b[^\n]{0,80}\b(?:paid|processed|completed|successful)\b|تحويل\s+بين\s+حساباتك[^\n]{0,96}تم\s+بنجاح|تم (?:الخصم|الدفع|التحويل|استقطاع|ارسال|خصم|دفع|سداد)|تم تحويل[^\n]{0,96}من حسابك|خصم|سحب|شراء/iu;
const EXPLICIT_OWN_DEBIT = /\bdebited\s+from\s+(?:your\s+)?(?:account|a\/?c)\b(?:[^.\n]|\.(?=\d)){0,112}\bcredited\s+to\s+(?:another\s+of\s+your|your\s+other|your\s+own)\s+(?:accounts?|a\/?c)\b/iu;
const COMPACT_OWN_DEBIT =
  /\bown\s+(?:account|a\/?c)\s+(?:transfer|trf)\b(?:[^.\n]|\.(?=\d)){0,96}\bdr\b(?:[^.\n]|\.(?=\d)){0,64}\b(?:account|a\/?c)\b(?:[^.\n]|\.(?=\d)){0,96}\bcr\b(?:[^.\n]|\.(?=\d)){0,64}\b(?:account|a\/?c)\b|\bdr\b(?:[^.\n]|\.(?=\d)){0,48}\b(?:account|a\/?c)\b(?:[^.\n]|\.(?=\d)){0,96}\bown\s+(?:account|a\/?c)\s+(?:transfer|trf)\b(?:[^.\n]|\.(?=\d)){0,96}\bcr\b(?:[^.\n]|\.(?=\d)){0,48}\b(?:account|a\/?c)\b/iu;
const EXPLICIT_EXTERNAL_DEBIT = /\bbeneficiary\b(?:[^.\n]|\.(?=\d)){0,96}\breceived\b(?:[^.\n]|\.(?=\d)){0,96}\bfrom\s+your\s+(?:account|a\/?c)\b|\bft\b(?:[^.\n]|\.(?=\d)){0,96}\bfrom\s+(?:your\s+)?(?:account|a\/?c)\b(?:[^.\n]|\.(?=\d)){0,96}\bto\s+(?:a\s+)?beneficiary\b/iu;
const EXPLICIT_FEE_DEBIT = /\b(?:fee|commission|charge)\b(?:[^.\n]|\.(?=\d)){0,96}\b(?:has\s+been\s+applied|was\s+assessed)\b|\b(?:has\s+been\s+applied|was\s+assessed)\b(?:[^.\n]|\.(?=\d)){0,96}\b(?:fee|commission|charge)\b/iu;
const EXPLICIT_ATM_DEBIT = /\batm\s+wdl\b(?:[^.\n]|\.(?=\d)){0,96}\b(?:db|debit(?:ed)?)\b(?:[^.\n]|\.(?=\d)){0,48}\bfrom\s+(?:your\s+)?(?:account|a\/?c)\b/iu;
const EXPLICIT_FOR_DEBIT = /\b(?:debited|deducted)\b(?:[^.\n]|\.(?=\d)){0,80}\bfor\b/iu;
const BALANCE_OR_DUE = /\b(?:available|current|remaining|closing)\s+(?:balance|limit)|\b(?:balance|credit limit|amount due|minimum due|statement total|outstanding)\b|الرصيد (?:الحالي|المتاح)|الحد (?:المتاح|الائتماني)|المبلغ المستحق/iu;
const MOVEMENT = /\b(?:credited|deposited|received|salary|payroll|wages|wps|monthly\s+pay|remuneration|emoluments?|posted|debited|deducted|withdrawn|cash withdrawal|charged|purchase|payment|paid|sent|transfer|transferred|moved|refund|refunded|re-?credited|reversed|bill payment|ft|atm\s+wdl|applied|assessed)\b|تم (?:ايداع|استلام|ارسال|استقطاع|خصم|دفع|سداد|تحويل|استرداد|رد|عكس|الخصم|الدفع|التحويل)|خصم|سحب|شراء|راتب|مرتب|سداد|استرداد|تحويل/iu;

const slug = (value: string): string => value
  .normalize('NFKC')
  .toLocaleLowerCase('en-US')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80);

const institutionFor = (
  sender: string,
): { market: 'AE' | 'SA'; name: string; id: string } | null => {
  const bounded = sender.slice(0, 256);
  const hits = MARKETS.flatMap((market) => market.banks
    .filter((bank) => bank.re.test(bounded))
    .map((bank) => ({ market: market.id as 'AE' | 'SA', name: bank.name, id: slug(bank.name) })));
  return hits.length === 1 ? hits[0] : null;
};

const candidateContext = (text: string, start: number, end: number): string =>
  text.slice(Math.max(0, start - 72), Math.min(text.length, end + 72));

const primaryMoney = (
  source: string,
  market: 'AE' | 'SA',
): UnparsedLaunchAlertReview['amount'] | null => {
  const localCurrency = market === 'AE' ? 'AED' : 'SAR';
  const aliases: CurrencyAliasMap = market === 'AE'
    ? { Dhs: ['AED'] as const, dirham: ['AED'] as const, dirhams: ['AED'] as const, 'درهم': ['AED'] as const, 'دراهم': ['AED'] as const }
    : { SR: ['SAR'] as const, riyal: ['SAR'] as const, riyals: ['SAR'] as const, 'ريال': ['SAR'] as const };
  const draft = inspectAlertDraft(source, { currencyAliases: aliases });
  const eligible = draft.candidates.filter((candidate) => {
    if (candidate.currency !== localCurrency || candidate.minorUnits === null ||
      candidate.exponent === null || !/^[1-9]\d{0,39}$/.test(candidate.minorUnits)) return false;
    const before = draft.normalizedText.slice(Math.max(0, candidate.span.start - 48), candidate.span.start);
    const after = draft.normalizedText.slice(candidate.span.end, candidate.span.end + 36);
    const instrumentLast4BeforeCurrency =
      /^\d{4}\s+(?:AED|SAR)$/iu.test(candidate.sourceText.trim()) &&
      /(?:\b(?:account|card|cc)|a\/?c)\s*$/iu.test(before) &&
      draft.candidates.some((other) => other !== candidate &&
        other.currency === localCurrency && other.minorUnits !== null);
    if (instrumentLast4BeforeCurrency) return false;
    // Labels immediately beside the figure are authoritative. A broader
    // window can contain the real movement from the previous sentence and
    // must not rescue a trailing "Available balance AED ..." decoy.
    if (BALANCE_OR_DUE.test(before) || /^\s*(?:available|current|remaining|closing)\s+(?:balance|limit)\b/iu.test(after)) {
      return false;
    }
    const context = candidateContext(draft.normalizedText, candidate.span.start, candidate.span.end);
    return MOVEMENT.test(context) || COMPACT_LEDGER_POSTED.test(context);
  });
  if (eligible.length !== 1) return null;
  const candidate = eligible[0];
  return {
    currency: localCurrency,
    minorUnits: candidate.minorUnits as string,
    exponent: candidate.exponent as number,
  };
};

const instrumentFrom = (source: string): ReviewAlert['instrument'] => {
  const card = source.match(/(?:\b(?:card(?:\s+no)?|cc)\b|بطاق[هة])[^.\n]{0,32}?(?:x{2,}|\*{2,}|ending(?:\s+with)?|last\s*4)?\s*(\d{4})\b/iu);
  if (card) return { kind: 'card', last4: card[1] };
  const account = source.match(/(?:\b(?:account|a\/?c)\b|حساب)[^.\n]{0,32}?(?:x{2,}|\*{2,}|ending(?:\s+with)?|last\s*4)?\s*(\d{4})\b/iu);
  return account ? { kind: 'account', last4: account[1] } : null;
};

const familyFrom = (source: string, direction: ReviewAlert['direction']): ReviewAlert['family'] => {
  if (/\b(?:refund|reversal|reversed)\b|استرداد/iu.test(source)) return 'refund';
  if (/\b(?:atm|cash withdrawal)\b|صراف|سحب نقدي/iu.test(source)) return 'cash-withdrawal';
  if (/\b(?:fee|commission|service charge)\b|رسوم|عمول[هة]/iu.test(source)) return 'fee';
  if (/\b(?:electricity|water|utility|telecom|mobile bill)\b|كهرباء|مياه|فاتور[هة]/iu.test(source)) return 'utility';
  if (direction === 'credit') return 'transfer';
  if (/\b(?:transfer|remittance|moved?\s+(?:from|out\s+of|to|into))\b|تحويل|حوال[هة]/iu.test(source)) return 'transfer';
  return 'purchase';
};

/**
 * Inspect only a launch-parser miss. The result contains no source or sender,
 * and can enter only the explicit review flow—never automatic import.
 */
export const inspectUnparsedLaunchSemantics = (
  source: string,
  market: 'AE' | 'SA',
  allowFutureFooter = false,
): UnparsedLaunchSemanticDecision => {
  const bounded = normalizeArabic(source.slice(0, 4096).normalize('NFKC')).replace(/\s+/gu, ' ');
  if (!bounded || nonPostingReason(bounded) || (!allowFutureFooter && AUTH_OR_FUTURE.test(bounded)) ||
    (!POSTED_MOVEMENT.test(bounded) && !COMPACT_LEDGER_POSTED.test(bounded))) {
    return { outcome: 'refuse', reason: 'non-posting' };
  }
  const refundForReversedMovement = REFUND_FOR_REVERSED_MOVEMENT.test(bounded);
  const creditReversalDebit = !refundForReversedMovement &&
    (CREDIT_REVERSAL_DEBIT.test(bounded) || COMPACT_CREDIT_REVERSAL_DEBIT.test(bounded));
  const refundCredit = !creditReversalDebit &&
    (refundForReversedMovement || REFUND_CREDIT.test(bounded) ||
      DEBIT_FEE_REVERSAL_CREDIT.test(bounded) || COMPACT_DEBIT_REVERSAL_CREDIT.test(bounded));
  const ownDebit = !refundCredit && (EXPLICIT_OWN_DEBIT.test(bounded) ||
    COMPACT_OWN_DEBIT.test(bounded) ||
    /\bfrom\s+(?:your\s+)?(?:account|a\/?c)\b(?:[^.\n]|\.(?=\d)){0,96}\bto\s+(?:another\s+account\s+of\s+yours|another\s+of\s+your\s+accounts?)\b/iu.test(bounded));
  const externalDebit = !refundCredit && (EXPLICIT_EXTERNAL_DEBIT.test(bounded) ||
    /\b(?:ben|beneficiary)\b(?:[^.\n]|\.(?=\d)){0,96}\bcr\b(?:[^.\n]|\.(?=\d)){0,96}\bfrom\s+(?:your\s+)?(?:account|a\/?c)\b|\bibft\b(?:[^.\n]|\.(?=\d)){0,96}\bfrom\s+(?:your\s+)?(?:account|a\/?c)\b(?:[^.\n]|\.(?=\d)){0,96}\bto\s+(?:a\s+)?(?:ben|beneficiary)\b/iu.test(bounded));
  const feeDebit = !refundCredit && EXPLICIT_FEE_DEBIT.test(bounded);
  const atmDebit = !refundCredit && EXPLICIT_ATM_DEBIT.test(bounded);
  const compactCashDebit = !refundCredit &&
    /\b(?:atm|cash)\s+wdl\b(?:[^.\n]|\.(?=\d)){0,96}\bfrom\s+(?:your\s+)?(?:account|a\/?c)\b/iu.test(bounded);
  const compactPurchaseDebit = !refundCredit &&
    /\b(?:card\s+)?pur\b(?:[^.\n]|\.(?=\d)){0,80}\bcard\b/iu.test(bounded);
  const forDebit = !refundCredit && EXPLICIT_FOR_DEBIT.test(bounded);
  const forcedDebit = creditReversalDebit || ownDebit || externalDebit || feeDebit ||
    atmDebit || compactCashDebit || compactPurchaseDebit || forDebit;
  const credit = !forcedDebit && (refundCredit || CREDIT.test(bounded) ||
    SALARY_PROCESSED_TO_ACCOUNT_CREDIT.test(bounded) || COMPACT_LEDGER_CREDIT.test(bounded) ||
    COMPACT_ACCOUNT_CREDIT.test(bounded));
  const debit = forcedDebit || (!refundCredit &&
    (DEBIT.test(bounded) || COMPACT_LEDGER_DEBIT.test(bounded)));
  if (credit === debit) return { outcome: 'refuse', reason: 'unclear-direction' };
  const amount = primaryMoney(bounded, market);
  if (!amount) return { outcome: 'refuse', reason: 'unclear-amount' };
  const direction = credit ? 'credit' as const : 'debit' as const;
  return {
    outcome: 'review',
    review: {
      amount,
      direction,
      family: familyFrom(bounded, direction),
      rail: null,
      instrument: instrumentFrom(bounded),
    },
  };
};

export const inspectUnparsedLaunchAlert = (
  source: string,
  sender: string,
): UnparsedLaunchAlertDecision => {
  const institution = institutionFor(sender);
  if (!institution) return { outcome: 'refuse', reason: 'unknown-institution' };
  const semantic = inspectUnparsedLaunchSemantics(source, institution.market);
  if (semantic.outcome === 'refuse') return semantic;
  const grammar: InstitutionGrammarMetadata = {
    id: `${institution.market.toLowerCase()}-${institution.id}-review-v1`,
    version: UNPARSED_LAUNCH_REVIEW_VERSION,
    channel: 'bank-alert',
    status: 'experimental',
    provenance: 'launch-registry',
  };
  return {
    outcome: 'review',
    review: {
      parserVersion: UNPARSED_LAUNCH_REVIEW_VERSION,
      market: institution.market,
      institution: institution.id,
      grammar,
      ...semantic.review,
    },
  };
};
