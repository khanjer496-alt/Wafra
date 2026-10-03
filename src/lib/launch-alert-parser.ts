import { inspectUniversalAlert, type UniversalAlertReview } from '@/lib/alert-market-detection';
import { hasUniversalInstitutionSender } from '@/lib/alert-institution-grammars';
import { activeCountryDateOrder, getActiveCountry } from '@/lib/country';
import { bestEffortAutoPostEnabled, decideBestEffortAutoPost, hasNonCompletedWording, sharedSymbolCurrencyForCountry } from '@/lib/best-effort-autopost';
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
import { isBnplProviderSource } from '@/lib/bnpl-providers';
import { nonPostingReason, parseSmsBatch, type ParsedSms } from '@/lib/sms-parser';
import type { CategoryId } from '@/lib/types';
import { CURRENCY_SYMBOL_CANDIDATES, currencyMinorUnits } from '@/lib/currency-metadata';
import { inspectUniversalBankEvent } from '@/lib/universal-parser';
import { suggestUniversalCategory } from '@/lib/universal-categorization';
import type { FxQuote } from '@/lib/fx';
import { cachedReferenceQuote, convertForeignConfirmation, quoteFitsDay } from '@/lib/fx-rates';
import type { UniversalBankEvent, UniversalField, UniversalMoney, UniversalParseContext } from '@/lib/universal-types';

type CurrencyAliasMap = NonNullable<UniversalParseContext['currencyAliases']>;

// Cheap supersets used only to decide whether market routing must run. The
// parser/reviewer remains the authority; matching one of these never imports.
export const REVIEW_MONEY_HINT = /\b(?:USD|GBP|EUR|INR|QAR|KWD|BHD|OMR|EGP|JOD|CAD|AUD|BRL|MXN|SGD|Rs\.?|KD|BD|RO|R\.O\.|LE|L\.E\.|JD)\b|[$€£₹]|ر\.ق|د\.ك|د\.ب|ر\.ع|ج\.م|د\.[أا]/iu;
const LAUNCH_MONEY_HINT = /\b(?:AED|Dhs?\.?|SAR|SR)\b|د\.?[إا]\.?|دراهم|درهم|ر\.?\s?س\.?|ريال/iu;

export const hasBankAlertMoneyHint = (source: string): boolean =>
  REVIEW_MONEY_HINT.test(source) || LAUNCH_MONEY_HINT.test(source) ||
  [...source.matchAll(/(?<![A-Z])([A-Z]{3})(?![A-Z])/giu)]
    .some((match) => currencyMinorUnits(match[1]) !== null) ||
  // Case-insensitive only for multi-letter symbols ("Ksh" for KSh): a short
  // one lower-cased is inside ordinary words ("users", "hours", "Sharma").
  Object.keys(CURRENCY_SYMBOL_CANDIDATES).some((symbol) => symbol.length >= 3
    ? source.toLowerCase().includes(symbol.toLowerCase()) : source.includes(symbol));

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
// Unicode-aware boundaries: `\b` treats an accented letter as a non-letter,
// so "effectué" and "payé" never matched and French alerts were dropped here.
const UNIVERSAL_POSTED_EVENT_HINT =
  /(?<![\p{L}\p{N}])(?:purchase|purchased|debit(?:ed)?|credit(?:ed)?|charged|charge\s+of|spent|paid|payment|received|refund(?:ed)?|reversal|withdraw(?:n|al)?|withdrew|made\s+an?|was\s+made|used\s+for|deposit(?:ed)?|transferr(?:ed|ing)|sent|realizad[oa]|efetuad[oa]|zrealizowana|consumo|realizaste|lastschrift|paiement|gerçekleşmiştir|gelmiştir|alışveriş\w*|havale|virement|reçu|pix|enviado|enviou|recebeu|recebido|transaksi|berhasil|kaartbetaling|voltooid|cash\s+(?:withdrawal|advance)|used\s+(?:for|at|on)|transaction|completed|processed|successful|successfully|approved|authori[sz]ed|settled|posted|débité|crédité|effectué|payé|payée|belastet|abgebucht|bezahlt|gutgeschrieben|cargado|pagado|abonado|addebitato|pagata|accreditato|afgeschreven|betaald|bijgeschreven)(?![\p{L}\p{N}])|(?:خصم|دفع|شراء|سحب|تحويل|ايداع|إيداع|استرداد|استرجاع|تمت|تم|ご利用|利用金額|消费|支付|승인|डेबिट|क्रेडिट)/iu;

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

/** Synchronous, network-free rate lookup used while parsing. */
export type ParseFxLookup = (base: string, quote: string, date: string) => FxQuote | null;

/**
 * The category and title an automatically posted worldwide row gets.
 *
 * Both posting seams below used to hard-code `other` for everything except
 * ATM and utility rows, so a Tesco, Spotify or REWE purchase posted in the
 * UK or Germany arrived uncategorized even though the worldwide merchant
 * vocabulary and brand table (universal-categorization.ts) already knew them,
 * and the SAME alert promoted from Review was categorized. One alert must get
 * one answer whichever door it came through, so this is the Review path's own
 * call. Transfers keep their structural title and stay uncategorized: whether
 * they are the user's own money is reconciliation's question, not a merchant's.
 */
const WORLD_SALARY_RE = /\b(?:salary|payroll|wages?|pay\s*cheque|paycheck|salaire|gehalt|lohn|salario|sueldo|n[óo]mina|sal[áa]rio|stipendio|salaris|maa[şs]|gaji)\b|راتب|رواتب|वेतन/iu;
const universalRowCategory = (
  source: string,
  event: UniversalBankEvent,
  overrides: Record<string, CategoryId>,
  market: string | null,
): { category: CategoryId; deliberate: boolean; merchant: string } => {
  const explicit = event.merchant.evidence === 'explicit' ? event.merchant.value?.trim() ?? '' : '';
  if (event.family === 'cash-withdrawal') return { category: 'cash-withdrawal', deliberate: true, merchant: explicit };
  // Salary is the one incoming transfer whose purpose the wording states.
  if (event.direction === 'credit' && event.family === 'transfer' && WORLD_SALARY_RE.test(source)) {
    return { category: 'salary', deliberate: true, merchant: 'Salary' };
  }
  if (event.family === 'transfer' || (event.direction !== 'debit' && event.direction !== 'credit')) {
    return { category: 'other', deliberate: false, merchant: explicit };
  }
  const type = event.direction === 'credit' ? 'income' as const : 'expense' as const;
  const suggestion = suggestUniversalCategory(event, { type, overrides, market: market ?? undefined });
  if (event.family === 'utility' && suggestion.needsReview) {
    return { category: 'utilities', deliberate: true, merchant: suggestion.merchant || explicit };
  }
  return {
    category: suggestion.category,
    deliberate: !suggestion.needsReview,
    merchant: explicit ? suggestion.merchant || explicit : '',
  };
};

/**
 * COUNTRY CONVENTIONS FOR MONEY WITHOUT AN ISO CODE.
 *
 * Both apply only when the PERSON's country states the convention; nothing
 * here reads the ledger currency, and no other country is affected.
 *  - South Africa prints the rand as a bare "R" ("R450.00 paid from Cheq
 *    a/c"). A letter on its own is not a currency anywhere else.
 *  - Indian UPI/IMPS/NEFT account alerts often state no currency at all
 *    ("A/C X1234 debited by 450.0 ... trf to ZOMATO"). Only that exact shape
 *    is read as rupees: an account reference, a payment rail, a debited/
 *    credited-by figure, and no other money in the text.
 */
const COUNTRY_CURRENCY_ALIASES: Readonly<Record<string, CurrencyAliasMap>> = {
  ZA: { R: ['ZAR'] },
};
const ZA_RAND_HINT = /(?<![\p{L}\p{N}])R\s?\d/u;
const IN_IMPLICIT_RUPEE_RE = /\b(debited|credited)\s+(by|for|with)\s+(?=\d[\d,]*(?:\.\d{1,2})?\b)/i;
const countryReadSource = (source: string, country: string | null): string => {
  if (country !== 'IN' || hasBankAlertMoneyHint(source)) return source;
  if (!/\b(?:a\/c|acct?|account)\b/i.test(source) || !/\b(?:upi|imps|neft|rtgs)\b/i.test(source)) return source;
  return source.replace(IN_IMPLICIT_RUPEE_RE, '$1 $2 INR ');
};
const countryMoneyHint = (source: string, country: string | null): boolean =>
  (country === 'ZA' && ZA_RAND_HINT.test(source)) || countryReadSource(source, country) !== source;

/**
 * A money field in the ledger currency, or null. An explicit figure must
 * already be in it; a shared symbol ($, Rs) resolves only through the
 * person's own country, exactly as the best-effort policy resolves it.
 */
const ledgerMinorOf = (
  field: UniversalField<UniversalMoney>,
  country: string | null,
  ledgerCurrency: string,
  ledgerExponent: number | null,
): number | null => {
  let money: UniversalMoney | null = null;
  if (field.evidence === 'explicit' && field.value && field.alternatives.length === 0) money = field.value;
  else if (field.evidence === 'ambiguous' && field.issues.length > 0 &&
    field.issues.every((issue) => issue === 'currency-symbol' || issue === 'currency-exponent')) {
    const wanted = sharedSymbolCurrencyForCountry(country);
    const options = [...(field.value ? [field.value] : []), ...field.alternatives].filter((m) => m.currency === wanted);
    if (new Set(options.map((m) => `${m.minorUnits}/${m.exponent}`)).size === 1) money = options[0];
  }
  if (!money || money.currency !== ledgerCurrency || (ledgerExponent !== null && money.exponent !== ledgerExponent)) return null;
  if (!/^[1-9]\d{0,15}$/.test(money.minorUnits)) return null;
  const minor = Number(money.minorUnits);
  return Number.isSafeInteger(minor) ? minor : null;
};

// Credit-card brands that never write the words "credit card" count too.
const CREDIT_CARD_WORDS = /\b(?:credit|charge|covered)\s+card\b|\bcredit\s*card\b|\bbarclaycard\b|\bamerican\s+express\b|\bamex\b|\bcapital\s+one\b|\bdiscover\s+card\b/iu;
/** Not a card obligation at all: a loan/EMI statement that merely mentions a card. */
const NOT_CARD_OBLIGATION = /\b(?:loan|emi|mortgage|finance|instal?ment\s+plan)\b/iu;
/** A statement that owes nothing, or is not (yet / any more) an open bill. */
const STATEMENT_NOT_OWED =
  /\b\d[\d,]*(?:\.\d+)?\s*cr\b|\bcredit\s+balance\b|\bno\s+payment\s+(?:is\s+)?(?:due|required)\b|(?<![\p{L}\p{N}])-\s*[$£€₹]?\s*\d|\bpaid\s+in\s+full\b|\bhas\s+been\s+paid\b|\bwill\s+be\s+(?:generated|issued)\b|\bso\s+far\b|\bunbilled\b|\bwas\s+due\b|\boverdue\b/iu;

/**
 * WORLDWIDE CARD STATEMENTS AND CARD PAYMENTS.
 *
 * The best-effort policy deliberately refuses these: a statement is an
 * obligation, not a movement, and a card payment is a settlement, not
 * spending or income. They used to stop in Review everywhere outside the
 * Gulf, so a US or Indian card never got its bill or its payment. They are
 * read here only when the alert proves the obligation on its own:
 *  - a statement needs a card (its last four, or credit-card wording), an
 *    explicit TOTAL and an explicit DUE DATE in the ledger currency; the
 *    minimum is kept only when it does not exceed the total;
 *  - a payment must be a completed card-payment family alert that names the
 *    card's last four, in the ledger currency;
 *  - any refusal, code challenge, hold or pending wording stops both.
 */
const universalCardObligation = (
  source: string,
  event: UniversalBankEvent,
  ledgerCurrency: string,
  ledgerExponent: number | null,
  country: string | null,
  observedAt?: number,
): Omit<ParsedSms, 'raw' | 'bestEffort'> | null => {
  if (event.decision !== 'review' || nonPostingReason(source)) return null;
  if (NOT_CARD_OBLIGATION.test(source) || !CREDIT_CARD_WORDS.test(source)) return null;
  const today = localIsoDay(observedAt);
  if (event.status === 'failed' || event.issues.some((issue) =>
    issue === 'authentication-not-posting' || issue === 'pending-not-posting' || issue === 'failed-not-posting')) return null;
  const instrument = event.instrument.evidence === 'explicit' ? event.instrument.value : null;
  const last4 = instrument?.kind === 'card' && instrument.last4 && /^\d{4}$/.test(instrument.last4) ? instrument.last4 : null;
  if (event.family === 'statement') {
    if (STATEMENT_NOT_OWED.test(source)) return null;
    // Some issuers call the statement total just "Balance" ("Your statement
    // is ready. Balance £845.20, minimum payment £25.00 due by ..."). Only in
    // a statement ANNOUNCEMENT that also states a minimum is that balance the
    // amount owed; anywhere else "balance" is headroom or cash.
    const announced = /\bstatement\b[^.\n]{0,40}\b(?:is\s+)?(?:ready|available|generated|issued)\b/iu.test(source);
    const plainBalance = !/\b(?:available|avail|avl|remaining|current)\.?\s+(?:credit\s+)?(?:bal(?:ance)?|limit)\b/iu.test(source);
    const total = ledgerMinorOf(event.statementTotal, country, ledgerCurrency, ledgerExponent) ??
      (event.statementTotal.evidence === 'missing' && announced && plainBalance && event.minimumDue.evidence !== 'missing'
        ? ledgerMinorOf(event.balance, country, ledgerCurrency, ledgerExponent) : null);
    const due = event.dueDate.evidence === 'explicit' ? event.dueDate.value : null;
    if (!total || !due || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return null;
    // A due date already behind the alert is a reminder about an old bill.
    if (today && due < today) return null;
    const minimum = ledgerMinorOf(event.minimumDue, country, ledgerCurrency, ledgerExponent);
    const issued = event.statementDate.evidence === 'explicit' ? event.statementDate.value : null;
    return {
      kind: 'cardStatement', type: 'expense', amountFils: total, currency: ledgerCurrency,
      merchant: last4 ? `Card •${last4}` : 'Card statement',
      date: due, dueDay: Number(due.slice(8)),
      minDueFils: minimum !== null && minimum <= total ? minimum : null,
      card: last4 ? { last4, kind: 'credit' } : null,
      ...(issued && /^\d{4}-\d{2}-\d{2}$/.test(issued) && issued < due ? { statementDate: issued } : {}),
      reference: null, transferHint: false, snapshotFils: null, snapshotKind: null,
      categoryGuess: 'other', categoryDeliberate: true,
    };
  }
  if (event.family === 'card-payment' && event.status === 'posted' && last4 &&
    (event.direction === 'credit' || event.direction === 'debit')) {
    // The same completed-money guard every other worldwide posting passes:
    // reversed, processing, scheduled or auto-debit-later payments are not paid.
    if (hasNonCompletedWording(source)) return null;
    const amount = ledgerMinorOf(event.amount, country, ledgerCurrency, ledgerExponent);
    if (!amount) return null;
    const date = event.transactionDate.evidence === 'explicit' ? event.transactionDate.value : null;
    if (date && today && date > today) return null;
    const receipt = event.direction === 'credit';
    return {
      kind: 'cardPayment', type: receipt ? 'income' : 'expense', amountFils: amount, currency: ledgerCurrency,
      merchant: `Card •${last4} payment`, date, dueDay: null, minDueFils: null,
      card: { last4, kind: 'credit' }, cardPaymentSide: receipt ? 'receipt' : 'debit',
      reference: null, transferHint: true, snapshotFils: null, snapshotKind: null,
      categoryGuess: 'other', categoryDeliberate: true,
    };
  }
  return null;
};

const localIsoDay = (epochMs: number | undefined): string | null => {
  if (epochMs === undefined || !Number.isFinite(epochMs)) return null;
  const day = new Date(epochMs);
  if (!Number.isFinite(day.getTime())) return null;
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
};

/**
 * STRICT, UNMARKED universal posting for UAE/Saudi evidence only.
 *
 * Used by parse() when the sender or route is a launch market (AE/SA) but the
 * launch grammar declined and the ledger is not Gulf. This is the behaviour
 * that shipped before the best-effort policy existed, kept unchanged so a
 * UAE/Saudi sender is never treated as an "unverified format": no marker, and
 * the best-effort setting does not apply.
 *
 * This is the bank-agnostic production seam: no bank/sender registry is
 * required. The universal parser must prove one posted amount, one direction,
 * and an unambiguous ISO currency. Anything involving transfer ownership,
 * card settlement, statements, balances, bills/future events, authentication,
 * promotions, or unresolved fields remains in Review.
 */
const parseUniversalLaunchStrict = (
  source: string,
  sender: string,
  pinnedCurrency: string | null,
  pinnedExponent: number | null,
  fxLookup: ParseFxLookup,
  observedAt?: number,
  overrides: Record<string, CategoryId> = {},
  market: string | null = null,
): ParsedSms | null => {
  const event = inspectUniversalBankEvent(source, { sender, dateOrder: activeCountryDateOrder() });
  if (event.decision !== 'review' || event.status !== 'posted') return null;
  if (event.direction !== 'debit' && event.direction !== 'credit') return null;
  if (!['purchase', 'cash-withdrawal', 'refund', 'fee', 'utility', 'recurring-payment'].includes(event.family)) {
    return null;
  }
  if (event.amount.evidence !== 'explicit' || !event.amount.value) return null;
  const money = event.amount.value;
  const exponent = currencyMinorUnits(money.currency);
  if (exponent === null || exponent !== money.exponent || !/^\d+$/.test(money.minorUnits)) return null;
  const originalMinor = Number(money.minorUnits);
  if (!Number.isSafeInteger(originalMinor) || originalMinor <= 0) return null;
  const transactionDay = event.transactionDate.evidence === 'explicit' ? event.transactionDate.value : null;
  /**
   * FOREIGN MONEY ON A PINNED LEDGER IS CONVERTED, NEVER RELABELLED.
   *
   * A USD ledger receiving "EUR 45.00 spent at ..." posts the ledger-currency
   * equivalent and keeps EUR 45.00 on the row. The card's own charged ledger
   * figure wins when the alert states one; otherwise only a dated provider
   * rate ALREADY KNOWN on this device may convert (parsing never touches the
   * network). With neither, this returns null exactly as before and the alert
   * reaches Review, where promotion fetches the rate or keeps it pending.
   */
  let amountFils = originalMinor;
  let currency = money.currency;
  let fx: Partial<ParsedSms> = {};
  if (pinnedCurrency && pinnedCurrency !== money.currency) {
    if (pinnedExponent !== 0 && pinnedExponent !== 2 && pinnedExponent !== 3) return null;
    const day = transactionDay ?? localIsoDay(observedAt);
    if (!day) return null;
    const quote = fxLookup(money.currency, pinnedCurrency, day);
    const converted = convertForeignConfirmation(event, {
      currency: money.currency, minorUnits: originalMinor, exponent,
    }, { currency: pinnedCurrency, exponent: pinnedExponent },
    quoteFitsDay(quote, day) ? quote : null, { requireQuoteForStated: true });
    if (converted === 'fx-rate-unavailable' || converted === 'invalid-money') return null;
    amountFils = converted.amountFils;
    currency = pinnedCurrency;
    fx = converted.fields;
  } else if (pinnedExponent !== null && pinnedExponent !== money.exponent) {
    return null;
  }
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
  const classified = universalRowCategory(source, event, overrides, market);
  const merchant = classified.merchant
    ? classified.merchant
    : event.family === 'cash-withdrawal'
      ? 'ATM withdrawal'
      : event.family === 'refund'
        ? 'Refund'
        : event.direction === 'credit'
          ? 'Incoming transfer'
          : 'Account debit';
  const categoryGuess: CategoryId = classified.category;

  return {
    kind: 'transaction',
    type: event.direction === 'credit' ? 'income' : 'expense',
    amountFils,
    currency,
    ...fx,
    merchant,
    date: transactionDay,
    dueDay: null,
    minDueFils: null,
    card: card && card.last4 ? card : null,
    reference: null,
    transferHint: false,
    snapshotFils: null,
    snapshotKind: null,
    categoryGuess,
    categoryDeliberate: classified.deliberate,
    raw: source.trim(),
  };
};

interface UnprovenPostingContext {
  enabled: boolean;
  country: string | null;
  routedMarket: string | null;
  /** Launch (AE/SA) sender evidence; the policy then refuses unconditionally. */
  launchSenderMarket: string | null;
  overrides?: Record<string, CategoryId>;
}

/**
 * Promote only a self-proving universal event — an UNPROVEN format.
 *
 * This is the bank-agnostic production seam: no bank/sender registry is
 * required. Whether it may post is decided by exactly one policy,
 * decideBestEffortAutoPost (best-effort-autopost.ts): one completed amount,
 * one direction, an explicit (or country-resolved) currency, no non-posting
 * wording, no competing figure, and a dated rate for foreign money. Anything
 * else (statements, balances, bills/future events, authentication,
 * promotions, unresolved fields) stays in Review. Every row produced here
 * carries the `bestEffort` marker so the person can check it.
 *
 * FOREIGN MONEY ON A PINNED LEDGER IS CONVERTED, NEVER RELABELLED. The card's
 * own charged ledger figure wins when the alert states one; otherwise only a
 * dated provider rate ALREADY KNOWN on this device may convert (parsing never
 * touches the network). With neither, this returns null and the alert reaches
 * Review, where promotion fetches the rate or keeps it pending.
 */
const parseUniversalPostedEvent = (
  source: string,
  sender: string,
  pinnedCurrency: string | null,
  pinnedExponent: number | null,
  fxLookup: ParseFxLookup,
  observedAt: number | undefined,
  context: UnprovenPostingContext,
): ParsedSms | null => {
  // The setting is checked before the (comparatively expensive) inspection.
  if (!context.enabled) return null;
  // A best-effort row is only ever written in the pinned ledger currency; an
  // unpinned ledger waits for Review (or a proven alert) to choose it.
  if (!pinnedCurrency) return null;
  const readSource = countryReadSource(source, context.country);
  const aliases = context.country ? COUNTRY_CURRENCY_ALIASES[context.country] : undefined;
  const event = inspectUniversalBankEvent(readSource, {
    sender, dateOrder: activeCountryDateOrder(),
    ...(aliases ? { currencyAliases: aliases } : {}),
  });
  // `$` resolves through the issuer's routed market first, as the policy does.
  const obligation = universalCardObligation(readSource, event, pinnedCurrency, pinnedExponent,
    context.routedMarket ?? context.country, observedAt);
  if (obligation) {
    return {
      ...obligation,
      bestEffort: { v: 1, format: `universal:${event.family}:${event.direction}`, market: context.routedMarket ?? context.country ?? 'ZZ' },
      raw: source.trim(),
    };
  }
  const decision = decideBestEffortAutoPost({
    source: readSource,
    event,
    enabled: context.enabled,
    country: context.country,
    routedMarket: context.routedMarket,
    launchSenderMarket: context.launchSenderMarket,
    ledgerCurrency: pinnedCurrency,
    ledgerExponent: pinnedExponent,
    observedAt,
    fxLookup,
  });
  if (decision.outcome !== 'post') return null;

  const instrument = event.instrument.evidence === 'explicit' ? event.instrument.value : null;
  const card = instrument ? {
    last4: instrument.last4 ?? '',
    kind: instrument.kind === 'account' ? 'account' as const : 'unknown' as const,
  } : null;
  const transfer = event.family === 'transfer';
  // Transfer ownership is a separate reconciliation question: keep the
  // structural title so a recipient name cannot turn it into spending.
  const classified = universalRowCategory(source, event, context.overrides ?? {}, context.routedMarket ?? context.country);
  const merchant = transfer
    ? classified.category === 'salary' ? 'Salary' : event.direction === 'credit' ? 'Incoming transfer' : 'Outgoing transfer'
    : classified.merchant
      ? classified.merchant
      : event.family === 'cash-withdrawal'
        ? 'ATM withdrawal'
        : event.family === 'refund'
          ? 'Refund'
          : event.direction === 'credit'
            ? 'Incoming transfer'
            : 'Account debit';
  const categoryGuess: CategoryId = classified.category;

  return {
    kind: 'transaction',
    type: event.direction === 'credit' ? 'income' : 'expense',
    amountFils: decision.amountFils,
    currency: decision.currency,
    ...(decision.conversion ? decision.conversion.fields : {}),
    bestEffort: decision.marker,
    merchant,
    date: decision.date,
    dueDay: null,
    minDueFils: null,
    card: card && card.last4 ? card : null,
    reference: null,
    // A salary credit is income whose purpose the wording states; marking it
    // a transfer stored it with isTransfer and kept it out of Income entirely.
    transferHint: transfer && classified.category !== 'salary',
    snapshotFils: null,
    snapshotKind: null,
    categoryGuess,
    categoryDeliberate: classified.deliberate,
    raw: source.trim(),
  };
};

/**
 * A sender name some Gulf bank shares with the same institution elsewhere.
 *
 * HSBC sends as "HSBC" in the UAE and in the UK. The router already sees
 * this and reports the sender as overlapping, with a non-Gulf market among
 * the candidates. When that happens on a non-Gulf ledger and the alert's own
 * money is not AED/SAR, the name is not UAE evidence: treating it as one sent
 * a UK customer's GBP salary down the strict Gulf fallback, which refused it.
 * A Gulf-only name (FAB, ADCB) is never overlapping and stays launch evidence.
 */
const sharedSenderOutsideGulf = (
  source: string,
  inspection: UniversalAlertReview | null,
  pinnedCurrency: string | null,
): boolean =>
  !!pinnedCurrency && pinnedCurrency !== 'AED' && pinnedCurrency !== 'SAR' &&
  detectLaunchMarketFromAlert(source, '') === null &&
  inspection?.route.decision === 'ambiguous' &&
  inspection.route.candidates.some((candidate) => candidate.market !== 'AE' && candidate.market !== 'SA');

export interface LaunchAlertSession {
  inspect(source: string, sender: string): UniversalAlertReview | null;
  parse(
    source: string,
    sender: string,
    inspection?: UniversalAlertReview | null,
    forcedMarket?: string,
    observedAt?: number,
  ): ParsedSms | null;
  /**
   * Unproven-format posting ONLY (never the AE/SA launch grammar). For capture
   * channels that were review-only for non-launch senders: the result, when
   * any, carries the `bestEffort` marker; null means Review as before.
   */
  parseUnproven(
    source: string,
    sender: string,
    inspection?: UniversalAlertReview | null,
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
  fxLookup = (base, quote, date) => cachedReferenceQuote(base, quote, date),
  bestEffort = { enabled: bestEffortAutoPostEnabled(), country: getActiveCountry() },
}: {
  overrides: Record<string, CategoryId>;
  regionHint?: string | null;
  pinnedCurrency?: string | null;
  activeMarket?: string;
  /** Network-free dated rate lookup; defaults to rates already fetched this session. */
  fxLookup?: ParseFxLookup;
  /** Unproven-format policy inputs; defaults mirror the persisted setting and country. */
  bestEffort?: { enabled: boolean; country: string | null };
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
    // A BNPL provider's restatement of a bank card charge (see
    // bnpl-providers.ts). The regional path already refuses it; the
    // worldwide fallback below must not resurrect it on an unpinned ledger.
    if (isBnplProviderSource(sender)) return null;
    const local = parseRegionalEvidence(source, sender, inspection, forcedMarket, observedAt)?.parsed ?? null;
    if (local) return local;
    // The worldwide parser is intentionally broader and therefore more
    // expensive. Ordinary conversations, delivery updates and generic service
    // SMS must not pay that cost after the launch parser already failed fast.
    // Money evidence OR bank-alert context is sufficient to preserve the
    // bank-agnostic universal seam for unknown institutions and countries.
    // Same rule for the worldwide parser: without explicit money it cannot
    // create a valid ledger row. Bank context is still consumed by the review
    // pipeline after this function returns null. The person's own country
    // may supply money a bare "R" or a currency-less UPI alert states.
    if (!hasBankAlertMoneyHint(source) && !countryMoneyHint(source, bestEffort.country)) return null;
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
    // See sharedSenderOutsideGulf: a multinational sender name is not UAE
    // evidence for a non-Gulf alert on a non-Gulf ledger.
    const namedLaunchMarket = detectLaunchMarketFromSender(sender);
    const launchSenderMarket = namedLaunchMarket &&
      !sharedSenderOutsideGulf(source, inspection, pinnedCurrency) ? namedLaunchMarket : null;
    // A single ordered capture/history session cannot change Gulf markets
    // through the broad universal fallback after regional evidence already
    // locked it. Without this guard, 50 UAE messages could establish AE and a
    // later Saudi sender could bypass that lock only because the mature Saudi
    // adapter correctly refused to switch sessionMarket.
    if (sessionMarket && launchSenderMarket && launchSenderMarket !== sessionMarket) return null;
    if (gulfLedger && (launchSenderMarket === 'AE' || launchSenderMarket === 'SA')) return null;
    if (gulfLedger && !universalRouteIsNonGulf) return null;
    const routedMarket = inspection?.route.decision === 'single' ? inspection.route.market : null;
    // UAE/Saudi evidence (sender or route) is never an "unverified format":
    // keep the strict, unmarked seam that shipped before, independent of the
    // best-effort setting.
    if (launchSenderMarket === 'AE' || launchSenderMarket === 'SA' ||
      routedMarket === 'AE' || routedMarket === 'SA') {
      return parseUniversalLaunchStrict(source, sender, pinnedCurrency, pinnedExponent, fxLookup, observedAt,
        overrides, launchSenderMarket ?? routedMarket);
    }
    return parseUniversalPostedEvent(source, sender, pinnedCurrency, pinnedExponent, fxLookup, observedAt, {
      enabled: bestEffort.enabled,
      country: bestEffort.country,
      routedMarket,
      launchSenderMarket: null,
      overrides,
    });
  };

  const parseUnproven = (
    source: string,
    sender: string,
    inspection: UniversalAlertReview | null = null,
    observedAt?: number,
  ): ParsedSms | null => {
    if (!bestEffort.enabled) return null;
    // Same rule as parse(): an SMS from a BNPL provider's sender ID reaches
    // this path (it is no launch-bank sender) and must not post as an
    // "unverified format" either.
    if (isBnplProviderSource(sender)) return null;
    if (!hasBankAlertMoneyHint(source) && !countryMoneyHint(source, bestEffort.country)) return null;
    if (!shouldTryUniversalPosting(source, sender)) return null;
    const routedMarket = inspection?.route.decision === 'single' ? inspection.route.market : null;
    // Same rule as parse(): see sharedSenderOutsideGulf.
    const namedLaunchMarket = detectLaunchMarketFromSender(sender);
    const launchSenderMarket = namedLaunchMarket &&
      !sharedSenderOutsideGulf(source, inspection, pinnedCurrency) ? namedLaunchMarket : null;
    // AE/SA formats are PROVEN: when the mature grammar refused one, or the
    // alert is routed there, that refusal is the evidence. Never best-effort.
    if (launchSenderMarket || routedMarket === 'AE' || routedMarket === 'SA') return null;
    const gulfLedger = pinnedCurrency === 'AED' || pinnedCurrency === 'SAR';
    if (gulfLedger && routedMarket === null) return null;
    // A best-effort row must never make an import batch mixed-currency.
    if (!pinnedCurrency) return null;
    return parseUniversalPostedEvent(source, sender, pinnedCurrency, pinnedExponent, fxLookup, observedAt, {
      enabled: bestEffort.enabled,
      country: bestEffort.country,
      routedMarket,
      launchSenderMarket,
      overrides,
    });
  };

  return { inspect, parse, parseUnproven, detectedMarket: () => detected };
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
