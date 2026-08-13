import { inspectAlertDraft, type CurrencyAliasMap } from '@/lib/alert-draft';
import type { InstitutionGrammarMetadata } from '@/lib/alert-institution-grammars';
import type { ReviewAlert } from '@/lib/alert-review-tray';
import { MARKETS } from '@/lib/markets';
import { nonPostingReason } from '@/lib/sms-parser';

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

export type UnparsedLaunchAlertDecision =
  | { outcome: 'review'; review: UnparsedLaunchAlertReview }
  | { outcome: 'refuse'; reason: UnparsedLaunchRefusal };

const AUTH_OR_FUTURE = /\b(?:otp|one[ -]?time|verification code|security code|approve|declined|failed|rejected|pending|processing|will be|scheduled|due(?:\s+on)?|statement|minimum due|offer|cashback offer)\b|رمز (?:التحقق|التأكيد)|سيتم|مستحق|مرفوض|فشل/iu;
const CREDIT = /\b(?:credited|deposited|received|salary|payroll|wages|wps|inward remittance|transferred|paid|posted)\b[^.\n]{0,80}\b(?:to|into)\s+(?:(?:your|the)\s+)?(?:[\p{L}&-]+\s+){0,3}(?:bank\s+)?(?:account|a\/?c)|\b(?:salary|payroll|wages|wps)\b[^.\n]{0,80}\b(?:credit(?:ed)?|deposited|received|paid|transferred|posted)\b|تم (?:إيداع|تحويل)|حوال[هة] وارد[هة]?|راتب|مرتب/iu;
const DEBIT = /\b(?:debited|deducted|withdrawn|charged|spent|purchase|paid|sent|moved)\b[^.\n]{0,80}\b(?:from|out\s+of|using|with|at|to)\b|\bcash withdrawal\b[^\n]{0,80}\b(?:from|at)\b|\btransferred\b[^.\n]{0,80}\b(?:from|out\s+of)\s+(?:your\s+)?(?:account|a\/?c)\b|\b(?:card|account|a\/?c)\b[^.\n]{0,48}\b(?:debited|charged|used)\b|تم (?:الخصم|الدفع|التحويل)|خصم|سحب|شراء/iu;
const BALANCE_OR_DUE = /\b(?:available|current|remaining|closing)\s+(?:balance|limit)|\b(?:balance|credit limit|amount due|minimum due|statement total|outstanding)\b|الرصيد (?:الحالي|المتاح)|الحد (?:المتاح|الائتماني)|المبلغ المستحق/iu;
const MOVEMENT = /\b(?:credited|deposited|received|salary|payroll|wages|wps|posted|debited|deducted|withdrawn|cash withdrawal|charged|spent|purchase|paid|sent|transferred|moved|refund)\b|تم (?:إيداع|الخصم|الدفع|التحويل)|خصم|سحب|شراء|راتب|مرتب/iu;

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
    // Labels immediately beside the figure are authoritative. A broader
    // window can contain the real movement from the previous sentence and
    // must not rescue a trailing "Available balance AED ..." decoy.
    if (BALANCE_OR_DUE.test(before) || /^\s*(?:available|current|remaining|closing)\s+(?:balance|limit)\b/iu.test(after)) {
      return false;
    }
    const context = candidateContext(draft.normalizedText, candidate.span.start, candidate.span.end);
    return MOVEMENT.test(context);
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
  const card = source.match(/\b(?:card(?:\s+no)?|بطاق[هة])[^.\n]{0,32}?(?:x{2,}|\*{2,}|ending(?:\s+with)?|last\s*4)?\s*(\d{4})\b/iu);
  if (card) return { kind: 'card', last4: card[1] };
  const account = source.match(/\b(?:account|a\/?c|حساب)[^.\n]{0,32}?(?:x{2,}|\*{2,}|ending(?:\s+with)?|last\s*4)?\s*(\d{4})\b/iu);
  return account ? { kind: 'account', last4: account[1] } : null;
};

const familyFrom = (source: string, direction: ReviewAlert['direction']): ReviewAlert['family'] => {
  if (direction === 'credit') return 'transfer';
  if (/\b(?:atm|cash withdrawal)\b|صراف|سحب نقدي/iu.test(source)) return 'cash-withdrawal';
  if (/\b(?:refund|reversal|reversed)\b|استرداد/iu.test(source)) return 'refund';
  if (/\b(?:fee|commission|service charge)\b|رسوم|عمول[هة]/iu.test(source)) return 'fee';
  if (/\b(?:electricity|water|utility|telecom|mobile bill)\b|كهرباء|مياه|فاتور[هة]/iu.test(source)) return 'utility';
  if (/\b(?:transfer|remittance|moved?\s+(?:from|out\s+of|to|into))\b|تحويل|حوال[هة]/iu.test(source)) return 'transfer';
  return 'purchase';
};

/**
 * Inspect only a launch-parser miss. The result contains no source or sender,
 * and can enter only the explicit review flow—never automatic import.
 */
export const inspectUnparsedLaunchAlert = (
  source: string,
  sender: string,
): UnparsedLaunchAlertDecision => {
  const institution = institutionFor(sender);
  if (!institution) return { outcome: 'refuse', reason: 'unknown-institution' };
  const bounded = source.slice(0, 4096).normalize('NFKC');
  if (!bounded || nonPostingReason(bounded) || AUTH_OR_FUTURE.test(bounded)) {
    return { outcome: 'refuse', reason: 'non-posting' };
  }
  const credit = CREDIT.test(bounded);
  const debit = DEBIT.test(bounded);
  if (credit === debit) return { outcome: 'refuse', reason: 'unclear-direction' };
  const amount = primaryMoney(bounded, institution.market);
  if (!amount) return { outcome: 'refuse', reason: 'unclear-amount' };
  const direction = credit ? 'credit' as const : 'debit' as const;
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
      amount,
      direction,
      family: familyFrom(bounded, direction),
      rail: null,
      instrument: instrumentFrom(bounded),
    },
  };
};
