import { inspectAlertDraft, type AlertDraft } from '@/lib/alert-draft';
import {
  inspectAlertEventEvidence,
  type AlertEventEvidence,
} from '@/lib/alert-event-evidence';
import {
  inspectAlertInstitutionGrammar,
  type AlertInstitutionGrammarReview,
} from '@/lib/alert-institution-grammars';
import { alertMarketPack } from '@/lib/alert-market-packs';
import type {
  AlertFamily,
  MoneyDirection,
  PostingStatus,
  UniversalMarket,
} from '@/lib/alert-market-pack-types';

export interface MarketAlertReview {
  market: UniversalMarket;
  decision: 'review' | 'refuse';
  status: PostingStatus;
  family: AlertFamily;
  direction: MoneyDirection;
  rail: string | null;
  moneyRoles: MoneyCandidateRole[];
  primaryCandidateIndex: number | null;
  institution: AlertInstitutionGrammarReview;
  eventEvidence: AlertEventEvidence;
  reasons: string[];
  draft: AlertDraft;
}

export interface MarketAlertContext {
  sender?: string | null;
}

export type MoneyCandidateRole = 'transaction' | 'balance' | 'limit' | 'due' | 'fee' | 'unknown';

const AUTHENTICATION = /\b(?:otp|one[ -]?time password|3d secure|3ds|verification code|security code|approve (?:this )?(?:payment|purchase)|fraud check)\b|رمز (?:التحقق|التأكيد)|كلمة المرور/i;
const FAILED = /\b(?:declined|failed|unsuccessful|rejected|not approved|insufficient funds|returned unpaid)\b|مرفوض(?:ة)?|فشل(?:ت)?|تعذر|असफल|अस्वीकृत/i;
const FUTURE = /\b(?:will be (?:debited|charged|deducted|collected)|will apply|pre[ -]?debit|collect request|payment request|scheduled|due on|payment due|upcoming|mandate (?:created|registered))\b|سيتم (?:خصم|سحب|تحصيل)|طلب تحصيل|مستحق|डेबिट किया जाएगा|भुगतान देय/i;
const STATEMENT = /\b(?:statement|minimum (?:amount )?due|amount due|payment due date|relevé|kontoauszug|extracto|estratto conto)\b|كشف حساب|الحد الأدنى المستحق/i;
const BALANCE = /\b(?:available balance|current balance|avl bal|available limit|credit limit|solde|kontostand|saldo)\b|الرصيد (?:الحالي|المتاح)|الحد (?:المتاح|الائتماني)/i;
const POSTED = /\b(?:spent|purchase(?:d)?|paid|debited|credited|received|sent|withdrawn|deposited|refund(?:ed)?|revers(?:al|ed)|completed|successful|charged|posted|débité|crédité|effectué|belastet|abgebucht|gutgeschrieben|bezahlt|cargado|abonado|pagado|addebitato|accreditato|afgeschreven|bijgeschreven|betaald)\b|تم (?:الخصم|الإيداع|الدفع|التحويل)|سحب|شراء|دفع|استرداد|डेबिट किया गया|क्रेडिट किया गया|जमा किया गया|भुगतान किया गया/i;
const CREDIT = /\b(?:credited|received|deposit(?:ed)?|refund(?:ed)?|revers(?:al|ed)|credited back|crédité|gutschrift|gutgeschrieben|abonado|accredito|accreditato|bijgeschreven|terugbetaling)\b|تم (?:الإيداع|رد)|استرداد|क्रेडिट|जमा/i;
const DEBIT = /\b(?:spent|purchase(?:d)?|paid|debited|withdrawn|charged|débité|belastet|abgebucht|cargado|pagado|addebitato|afgeschreven|betaald)\b|تم (?:الخصم|الدفع)|سحب|شراء|دفع|डेबिट|निकासी|भुगतान/i;
const REFUND = /\b(?:refund(?:ed)?|revers(?:al|ed)|credited back|remboursement|avoir|erstattung|devolución|reembolso|rimborso|storno|terugbetaling|correctieboeking)\b|استرداد|تم رد|धनवापसी|रिफंड/i;
const CASH = /\b(?:atm|cash machine|cash withdrawal|geldautomat|bargeldabhebung|retrait|retirada|prelievo|geldopname|aeps cash withdrawal)\b|صراف آلي|سحب نقدي|नकद निकासी|एटीएम निकासी/i;
const FEE = /\b(?:bank fee|service charge|annual fee|annual card fee|monthly fee|monthly account maintenance fee|maintenance fee|commission|overdraft fee|nsf fee|frais|cotisation|gebühr|entgelt|comisión|commissione|canone|kosten)\b|رسوم|عمولة/i;
const PURCHASE = /\b(?:purchase|card charged?|card(?:\s+(?:ending\s+)?\d{2,4})?\s+(?:was\s+)?charged|card payment|card used|paid|spent|paiement par carte|achat|kartenzahlung|kartenumsatz|compra con tarjeta|pagamento con carta|acquisto|pinbetaling|pasbetaling)\b|شراء|دفع بالبطاقة|कार्ड खरीद|कार्ड भुगतान|खरीद/i;

const NEAR_BALANCE = /(?:available|current|closing|remaining)\s+balance|avl\s+bal|solde(?: disponible)?|kontostand|الرصيد (?:الحالي|المتاح)/i;
const NEAR_LIMIT = /(?:available|credit)\s+limit|الحد (?:المتاح|الائتماني)/i;
const NEAR_DUE = /(?:minimum (?:amount )?due|amount due|payment due|statement total|outstanding balance)|الحد الأدنى المستحق|المبلغ المستحق/i;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findTerm = (text: string, terms: readonly string[]): string | null => {
  for (const term of terms) {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}(?=$|[^\\p{L}\\p{N}])`, 'iu');
    if (pattern.test(text)) return term;
  }
  return null;
};

const moneyCandidateRole = (
  text: string,
  span: { start: number; end: number },
): MoneyCandidateRole => {
  const before = text.slice(Math.max(0, span.start - 48), span.start);
  const after = text.slice(span.end, Math.min(text.length, span.end + 32));
  const nearby = `${before} [amount] ${after}`;
  if (NEAR_LIMIT.test(nearby)) return 'limit';
  if (NEAR_DUE.test(nearby)) return 'due';
  if (NEAR_BALANCE.test(nearby)) return 'balance';
  if (FEE.test(nearby)) return 'fee';
  if (DEBIT.test(nearby) || CREDIT.test(nearby) || PURCHASE.test(nearby) ||
    CASH.test(nearby) || REFUND.test(nearby)) return 'transaction';
  return 'unknown';
};

const primaryCandidate = (roles: readonly MoneyCandidateRole[]): number | null => {
  const explicit = roles
    .map((role, index) => ({ role, index }))
    .filter(({ role }) => role === 'transaction' || role === 'fee');
  if (explicit.length === 1) return explicit[0].index;
  if (explicit.length > 1) return null;
  return roles.length === 1 && roles[0] === 'unknown' ? 0 : null;
};

const postingStatus = (
  text: string,
  postedTerms: readonly string[] = [],
  failedTerms: readonly string[] = [],
  futureTerms: readonly string[] = [],
): PostingStatus => {
  if (AUTHENTICATION.test(text)) return 'informational';
  if (FAILED.test(text) || findTerm(text, failedTerms)) return 'failed';
  if (FUTURE.test(text) || findTerm(text, futureTerms)) return 'future';
  const hasTransactionEvidence = POSTED.test(text) || Boolean(findTerm(text, postedTerms));
  if ((STATEMENT.test(text) || BALANCE.test(text)) && !hasTransactionEvidence) return 'informational';
  return hasTransactionEvidence ? 'posted' : 'unknown';
};

const moneyDirection = (
  text: string,
  debitTerms: readonly string[] = [],
  creditTerms: readonly string[] = [],
): MoneyDirection => {
  const accountCredit = /\bcredited to (?:your|the) (?:bank )?account\b/i.test(text);
  const accountDebit = /\bdebited from (?:your|the) (?:bank )?account\b/i.test(text);
  if (accountCredit !== accountDebit) return accountCredit ? 'credit' : 'debit';
  const credit = CREDIT.test(text) || Boolean(findTerm(text, creditTerms));
  const debit = DEBIT.test(text) || Boolean(findTerm(text, debitTerms));
  if (credit === debit) return 'unknown';
  return credit ? 'credit' : 'debit';
};

export const inspectMarketAlert = (
  source: string,
  market: UniversalMarket,
  context: MarketAlertContext = {},
): MarketAlertReview => {
  const pack = alertMarketPack(market);
  const draft = inspectAlertDraft(source, { currencyAliases: pack.currencyAliases });
  const text = draft.normalizedText.toLowerCase();
  const initialStatus = postingStatus(text, pack.postedTerms, pack.failedTerms, pack.futureTerms);
  const rail = findTerm(text, pack.rails);
  const transfer = findTerm(text, pack.transferTerms);
  const utility = findTerm(text, pack.utilityTerms);
  const recurring = findTerm(text, pack.recurringTerms);
  const moneyRoles = draft.candidates.map((candidate) => moneyCandidateRole(text, candidate.span));
  const primaryCandidateIndex = primaryCandidate(moneyRoles);
  const eventEvidence = inspectAlertEventEvidence(text, {
    recurringTerm: recurring,
    utilityTerm: utility,
    primaryCandidateIndex,
  });
  const lifecycleOnly = eventEvidence.scheduledDebit && [
    'created', 'modified', 'paused', 'resumed', 'cancelled', 'funds-released',
  ].includes(eventEvidence.scheduledDebit.event);
  const ungroundedExecution = eventEvidence.scheduledDebit?.event === 'executed' &&
    initialStatus !== 'posted';
  // Lifecycle verbs describe the instruction, not movement of money. Words
  // such as "setup successful" must not let a created mandate masquerade as a
  // successfully posted debit.
  const status = lifecycleOnly || ungroundedExecution ? 'informational' : initialStatus;
  const institution = inspectAlertInstitutionGrammar(
    draft.normalizedText,
    market,
    context.sender,
  );

  let family: AlertFamily = 'unknown';
  if (AUTHENTICATION.test(text)) family = 'authentication';
  else if (status === 'informational' && STATEMENT.test(text)) family = 'statement';
  else if (status === 'informational' && BALANCE.test(text)) family = 'balance';
  else if (REFUND.test(text)) family = 'refund';
  else if (CASH.test(text)) family = 'cash-withdrawal';
  else if (FEE.test(text) || eventEvidence.fee) family = 'fee';
  else if (status === 'posted' && utility) family = 'utility';
  else if (status === 'posted' && recurring) family = 'recurring-payment';
  else if (status === 'posted' && transfer) family = 'transfer';
  else if (PURCHASE.test(text)) family = 'purchase';

  const reasons = [...draft.reasons];
  if (status !== 'posted') reasons.push(`posting-status:${status}`);
  if (family === 'unknown') reasons.push('unknown-family');
  if (draft.candidates.length && primaryCandidateIndex === null) {
    reasons.push('no-unique-transaction-amount');
  }
  if (eventEvidence.scheduledDebit) {
    reasons.push(`scheduled-debit:${eventEvidence.scheduledDebit.event}`);
  }
  const decision = draft.decision === 'review' && status === 'posted' &&
    primaryCandidateIndex !== null ? 'review' : 'refuse';
  return {
    market,
    decision,
    status,
    family,
    direction: status === 'posted'
      ? moneyDirection(text, pack.debitTerms, pack.creditTerms)
      : 'none',
    rail,
    moneyRoles,
    primaryCandidateIndex,
    institution,
    eventEvidence,
    reasons: [...new Set(reasons)],
    draft,
  };
};
