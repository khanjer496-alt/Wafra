import { inspectUniversalAlert, type UniversalAlertReview } from '@/lib/alert-market-detection';
import { hasUniversalInstitutionSender } from '@/lib/alert-institution-grammars';
import { activeCountryDateOrder } from '@/lib/country';
import {
  interpretBankAlert,
  type BankAlertInterpretation,
} from '@/lib/bank-alert-interpreter';
import {
  detectLaunchMarketFromAlert,
  detectLaunchMarketFromSender,
  getActiveMarket,
  ledgerCurrencyExponent,
  pinnedLedgerCurrencyCode,
} from '@/lib/markets';
import { parseSmsBatch, type ParsedSms } from '@/lib/sms-parser';
import type { CategoryId } from '@/lib/types';
import { CURRENCY_SYMBOL_CANDIDATES, currencyMinorUnits } from '@/lib/currency-metadata';
import { inspectUniversalBankEvent } from '@/lib/universal-parser';
import type { UniversalBankEvent } from '@/lib/universal-types';

// Cheap supersets used only to decide whether market routing must run. The
// parser/reviewer remains the authority; matching one of these never imports.
export const REVIEW_MONEY_HINT = /\b(?:USD|GBP|EUR|INR|QAR|KWD|BHD|OMR|EGP|JOD|Rs\.?|KD|BD|RO|R\.O\.|LE|L\.E\.|JD)\b|[$€£₹]|ر\.ق|د\.ك|د\.ب|ر\.ع|ج\.م|د\.[أا]/iu;
const LAUNCH_MONEY_HINT = /\b(?:AED|Dhs?\.?|SAR|SR)\b|د\.?[إا]\.?|دراهم|درهم|ر\.?\s?س\.?|ريال/iu;

export const hasBankAlertMoneyHint = (source: string): boolean =>
  REVIEW_MONEY_HINT.test(source) || LAUNCH_MONEY_HINT.test(source) ||
  [...source.matchAll(/(?<![A-Z])([A-Z]{3})(?![A-Z])/giu)]
    .some((match) => currencyMinorUnits(match[1]) !== null) ||
  Object.keys(CURRENCY_SYMBOL_CANDIDATES).some((symbol) => source.includes(symbol));

/**
 * Cheap evidence that a final money movement MAY have posted.
 *
 * The universal parser is deliberately broad and expensive (~0.7ms/call on the
 * 30k research corpus). Running it after every regional-parser miss made history
 * import spend most of its CPU proving ordinary bills/offers/service notices
 * were not postings. This gate is only a superset admission test: matching it
 * never imports anything; it merely earns the worldwide parser.
 *
 * Keep the verbs aligned with the universal language packs. A known worldwide
 * institution sender bypasses this vocabulary gate below, so an unfamiliar
 * bank phrasing from a supported institution still reaches the full parser.
 */
const UNIVERSAL_POSTED_EVENT_HINT =
  /\b(?:purchase|purchased|debit(?:ed)?|credit(?:ed)?|charged|spent|paid|payment|received|refund(?:ed)?|reversal|withdraw(?:n|al)?|transferr(?:ed|ing)|sent|cash\s+(?:withdrawal|advance)|used\s+(?:for|at|on)|transaction|completed|processed|successful|successfully|approved|authori[sz]ed|settled|posted|débité|crédité|effectué|payé|payée|belastet|abgebucht|bezahlt|gutgeschrieben|cargado|pagado|abonado|addebitato|pagata|accreditato|afgeschreven|betaald|bijgeschreven)\b|(?:خصم|دفع|شراء|سحب|تحويل|ايداع|إيداع|استرداد|استرجاع|تمت|تم)/iu;

// A small family of real bank field-list alerts has amount + instrument +
// merchant but no verb at all. The 30k Jev benchmark found one such rescued FAB
// family ("cards ... AED <amount> ... at/to ..."). Keep this narrow and only
// for a sender the mature regional router already recognises.
const UNIVERSAL_FIELD_LIST_HINT =
  /\bcards?\b[\s\S]{0,120}\bAED\b[^\d]{0,12}\d[\s\S]{0,120}\b(?:at|to)\b/iu;

const shouldTryUniversalPosting = (source: string, sender: string): boolean =>
  hasUniversalInstitutionSender(sender) ||
  UNIVERSAL_POSTED_EVENT_HINT.test(source) ||
  (!!detectLaunchMarketFromSender(sender) && UNIVERSAL_FIELD_LIST_HINT.test(source));

// Review eligibility needs financial-alert context, not merely a currency in
// a personal conversation. None of these words grants automatic import.
const GENERIC_BANK_CONTEXT = /\b(?:(?:credit|debit|covered|prepaid|charge)\s+card|card\s+(?:purchase|payment|ending|number|no\b)|(?:your|available|current)\s+(?:account|balance|credit)|bank\s+(?:alert|account|fee|transfer|statement|notification)|(?:minimum|total)\s+(?:amount\s+)?due|(?:account|a\/?c)\s+(?:ending|number|no\b)|iban|swift|sepa|upi|neft|imps|statement|paiement\s+par\s+carte|kartenzahlung|kontoauszug|compra\s+con\s+tarjeta|pagamento\s+con\s+carta|rekeningoverzicht)\b|بطاق[هة]|حساب|رصيد|كشف\s+حساب|فاتور[هة]/iu;

export const hasGenericBankAlertContext = (source: string, sender = ''): boolean =>
  GENERIC_BANK_CONTEXT.test(source) || detectLaunchMarketFromSender(sender) !== null ||
  hasUniversalInstitutionSender(sender);

/** Generic evidence augments misses in every country; it is always review-only. */
export const inspectGenericBankEventForReview = (
  source: string,
  sender = '',
): UniversalBankEvent | null => {
  if (!hasGenericBankAlertContext(source, sender)) return null;
  const event = inspectUniversalBankEvent(source, { sender, dateOrder: activeCountryDateOrder() });
  if (event.decision !== 'review') return null;
  const hasGroundedMoney =
    event.amount.evidence !== 'missing' ||
    event.observations.some((observation) => observation.field.evidence !== 'missing');
  if (event.status === 'unknown' && event.family === 'unknown' &&
    event.instrument.evidence !== 'explicit' && !hasGroundedMoney) return null;
  return event;
};

/**
 * Promote only a self-proving universal event.
 *
 * This is the bank-agnostic production seam: no bank/sender registry is
 * required. The universal parser must prove one posted amount, one direction,
 * and an unambiguous ISO currency. Anything involving transfer ownership,
 * card settlement, statements, balances, bills/future events, authentication,
 * promotions, or unresolved fields remains in Review.
 */
const parseUniversalPostedEvent = (
  source: string,
  sender: string,
  pinnedCurrency: string | null,
  pinnedExponent: number | null,
): ParsedSms | null => {
  const event = inspectUniversalBankEvent(source, { sender, dateOrder: activeCountryDateOrder() });
  if (event.decision !== 'review' || event.status !== 'posted') return null;
  if (event.direction !== 'debit' && event.direction !== 'credit') return null;
  if (!['purchase', 'cash-withdrawal', 'refund', 'fee', 'utility', 'recurring-payment'].includes(event.family)) {
    return null;
  }
  if (event.amount.evidence !== 'explicit' || !event.amount.value) return null;
  const money = event.amount.value;
  if (pinnedCurrency && pinnedCurrency !== money.currency) return null;
  if (pinnedExponent !== null && pinnedExponent !== money.exponent) return null;
  const exponent = currencyMinorUnits(money.currency);
  if (exponent === null || exponent !== money.exponent || !/^\d+$/.test(money.minorUnits)) return null;
  const amountFils = Number(money.minorUnits);
  if (!Number.isSafeInteger(amountFils) || amountFils <= 0) return null;
  const blockedIssues = new Set([
    'amount-role-unresolved',
    'posting-status-unresolved',
    'direction-unresolved',
    'direction-conflict',
    'multiple-event-adapter-required',
    'authentication-not-posting',
    'pending-not-posting',
    'promotion-not-posting',
    'settlement-adapter-required',
    'failed-not-posting',
  ]);
  if (event.issues.some((issue) => blockedIssues.has(issue))) return null;

  const instrument = event.instrument.evidence === 'explicit' ? event.instrument.value : null;
  const card = instrument ? {
    last4: instrument.last4 ?? '',
    kind: instrument.kind === 'account' ? 'account' as const : 'unknown' as const,
  } : null;
  const merchant = event.merchant.evidence === 'explicit' && event.merchant.value
    ? event.merchant.value
    : event.family === 'cash-withdrawal'
      ? 'ATM withdrawal'
      : event.family === 'refund'
        ? 'Refund'
        : event.direction === 'credit'
          ? 'Incoming transfer'
          : 'Account debit';
  const categoryGuess: CategoryId =
    event.family === 'cash-withdrawal' ? 'cash-withdrawal' :
      event.family === 'utility' ? 'utilities' : 'other';

  return {
    kind: 'transaction',
    type: event.direction === 'credit' ? 'income' : 'expense',
    amountFils,
    currency: money.currency,
    merchant,
    date: event.transactionDate.evidence === 'explicit' ? event.transactionDate.value : null,
    dueDay: null,
    minDueFils: null,
    card: card && card.last4 ? card : null,
    reference: null,
    transferHint: false,
    snapshotFils: null,
    snapshotKind: null,
    categoryGuess,
    categoryDeliberate: event.family === 'cash-withdrawal' || event.family === 'utility',
    raw: source.trim(),
  };
};

export interface LaunchAlertSession {
  inspect(source: string, sender: string): UniversalAlertReview | null;
  parse(
    source: string,
    sender: string,
    inspection?: UniversalAlertReview | null,
    forcedMarket?: string,
    observedAt?: number,
  ): ParsedSms | null;
  detectedMarket(): 'AE' | 'SA' | null;
}

/**
 * One ordered capture session's launch-parser policy.
 *
 * Keeping routing, global-issuer refusal and the single Gulf-market lock here
 * lets the phone scanner and the private corpus audit execute exactly the same
 * decision. The session is intentionally stateful: once a corpus establishes
 * UAE or Saudi, a conflicting alert cannot silently switch money systems.
 */
export const createLaunchAlertSession = ({
  overrides,
  regionHint = null,
  pinnedCurrency = pinnedLedgerCurrencyCode(),
  activeMarket = getActiveMarket().id,
}: {
  overrides: Record<string, CategoryId>;
  regionHint?: string | null;
  pinnedCurrency?: string | null;
  activeMarket?: string;
}): LaunchAlertSession => {
  const actualPinned = pinnedLedgerCurrencyCode();
  const pinnedExponent = pinnedCurrency
    ? pinnedCurrency === actualPinned
      ? ledgerCurrencyExponent()
      : currencyMinorUnits(pinnedCurrency)
    : null;
  let sessionMarket: 'AE' | 'SA' | null =
    pinnedCurrency === 'AED' ? 'AE' : pinnedCurrency === 'SAR' ? 'SA' : null;
  let detected: 'AE' | 'SA' | null = null;

  const inspect = (source: string, sender: string): UniversalAlertReview | null => {
    if (!REVIEW_MONEY_HINT.test(source)) return null;
    // A launch-tested issuer can quote any foreign transaction currency. Its
    // exact sender evidence already outranks that currency, and the universal
    // result cannot change the launch parser's decision. Avoid walking every
    // worldwide institution grammar for the common UAE/Saudi foreign-card
    // path; unknown and overlapping senders still take the full safe route.
    if (detectLaunchMarketFromSender(sender) && !hasUniversalInstitutionSender(sender)) return null;
    try {
      return inspectUniversalAlert({ source, sender, regionHint });
    } catch {
      return null;
    }
  };

  // Internal evidence adapter for the mature Gulf grammar. It is deliberately
  // not exposed on LaunchAlertSession: callers get one parser (`parse`) in
  // every country. Regional knowledge enriches that one decision instead of
  // becoming a second parser API with different behavior.
  const parseRegionalEvidence = (
    source: string,
    sender: string,
    inspection: UniversalAlertReview | null = null,
    forcedMarket?: string,
    observedAt?: number,
  ): Extract<BankAlertInterpretation, { outcome: 'parsed' }> | null => {
    if (pinnedCurrency && pinnedCurrency !== 'AED' && pinnedCurrency !== 'SAR') return null;
    // Most phone inbox rows are ordinary conversations, OTP-free service
    // notices, delivery updates, etc. On an AED/SAR ledger the old path still
    // ran the full launch-bank grammar over every one of them because the
    // active market supplied a default even when the message carried no money
    // or banking evidence. During a 10k-message history import that is a large
    // amount of pure CPU work. Fail fast only when BOTH broad evidence gates
    // are absent. Known launch/global institution senders remain eligible via
    // hasGenericBankAlertContext even when an unusual template omits currency.
    const moneyHint = hasBankAlertMoneyHint(source);
    // Automatic ledger rows always need an explicit monetary value. Sender
    // identity alone is enough for Review routing, but it cannot manufacture an
    // amount. In the 30k corpus 1,981 regional-interpreter calls had no money
    // evidence and not one produced a parsed row, so keep them out of the hot
    // auto-parse path and let the refusal/review seam handle them.
    if (!moneyHint) return null;
    if (
      inspection?.route.decision === 'single' &&
      inspection.route.market !== 'AE' &&
      inspection.route.market !== 'SA'
    ) return null;
    const routed = forcedMarket === 'AE' || forcedMarket === 'SA'
      ? forcedMarket
      : inspection?.route.decision === 'single' &&
          (inspection.route.market === 'AE' || inspection.route.market === 'SA')
        ? inspection.route.market
        : detectLaunchMarketFromAlert(source, sender);
    if (moneyHint && !routed) return null;
    const desired = routed ?? sessionMarket ?? activeMarket;
    if (desired !== 'AE' && desired !== 'SA') return null;
    if (sessionMarket && desired !== sessionMarket) return null;
    const interpretation = interpretBankAlert({
      source,
      sender,
      market: desired,
      overrides,
      observedAt,
    });
    const result = interpretation.outcome === 'parsed' ? interpretation : null;
    if (result && routed) {
      sessionMarket ??= routed;
      detected = routed;
    }
    return result;
  };

  const parse = (
    source: string,
    sender: string,
    inspection: UniversalAlertReview | null = null,
    forcedMarket?: string,
    observedAt?: number,
  ): ParsedSms | null => {
    const local = parseRegionalEvidence(source, sender, inspection, forcedMarket, observedAt)?.parsed ?? null;
    if (local) return local;
    // The worldwide parser is intentionally broader and therefore more
    // expensive. Ordinary conversations, delivery updates and generic service
    // SMS must not pay that cost after the launch parser already failed fast.
    // Money evidence OR bank-alert context is sufficient to preserve the
    // bank-agnostic universal seam for unknown institutions and countries.
    // Same rule for the worldwide parser: without explicit money it cannot
    // create a valid ledger row. Bank context is still consumed by the review
    // pipeline after this function returns null.
    if (!hasBankAlertMoneyHint(source)) return null;
    if (!shouldTryUniversalPosting(source, sender)) return null;
    /**
     * ONE PUBLIC PARSER, WITH A MATURE LOCAL EVIDENCE PACK.
     *
     * On AED/SAR ledgers the AE/SA deterministic grammar has years of
     * high-specificity bank/biller/statement knowledge. If that pack refuses a
     * message, the broader worldwide grammar may still inspect it for Review,
     * but it must not silently resurrect the same message as a brand-new
     * posting. The 30k UAE corpus proved why: doing so recovered 197 rows but
     * introduced 139 high-confidence non-posting false positives, dominated by
     * temporary holds and promotions.
     *
     * This is not a second user-facing parser. LaunchAlertSession.parse remains
     * the single production entry point. The AE/SA pack is simply stronger
     * evidence inside that parser. A positively routed non-Gulf institution is
     * still allowed to use universal posting even when the user's current
     * device/region is Gulf.
     */
    const universalRouteIsNonGulf =
      inspection?.route.decision === 'single' &&
      inspection.route.market !== 'AE' &&
      inspection.route.market !== 'SA';
    const gulfLedger = pinnedCurrency === 'AED' || pinnedCurrency === 'SAR';
    const launchSenderMarket = detectLaunchMarketFromSender(sender);
    // A single ordered capture/history session cannot change Gulf markets
    // through the broad universal fallback after regional evidence already
    // locked it. Without this guard, 50 UAE messages could establish AE and a
    // later Saudi sender could bypass that lock only because the mature Saudi
    // adapter correctly refused to switch sessionMarket.
    if (sessionMarket && launchSenderMarket && launchSenderMarket !== sessionMarket) return null;
    if (gulfLedger && (launchSenderMarket === 'AE' || launchSenderMarket === 'SA')) return null;
    if (gulfLedger && !universalRouteIsNonGulf) return null;
    return parseUniversalPostedEvent(source, sender, pinnedCurrency, pinnedExponent);
  };

  return { inspect, parse, detectedMarket: () => detected };
};

/**
 * Manual paste uses the same money and semantic policy as capture. Pasted
 * text supplies no authenticated sender: body mentions may route an alert,
 * but never manufacture the issuer evidence needed for global review.
 * Retain the batch parser's bilingual-restatement deduplication.
 */
export const parsePastedBankAlerts = (
  text: string,
  overrides: Record<string, CategoryId>,
  onRefused?: (source: string) => void,
): ParsedSms[] => {
  const session = createLaunchAlertSession({ overrides });
  return parseSmsBatch(text, overrides, (source) => {
    // Paste has no authenticated issuer. Keep the mature AED/SAR deterministic
    // path automatic, but do not turn a structurally valid worldwide amount
    // into unattended money with no sender evidence. Refused global blocks are
    // handed to the caller's Review flow instead.
    const launchMarket = detectLaunchMarketFromAlert(source, '');
    const parsed = launchMarket
      ? session.parse(source, '', session.inspect(source, ''), launchMarket)
      : null;
    if (!parsed) onRefused?.(source);
    return parsed;
  });
};
