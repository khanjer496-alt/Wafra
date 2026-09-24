import { currencyMinorUnits } from '@/lib/currency-metadata';
import type { FxQuote } from '@/lib/fx';
import { convertForeignConfirmation, quoteFitsDay, type ReferenceConversion } from '@/lib/fx-rates';
import { nonPostingReason } from '@/lib/sms-parser';
import type { BestEffortMarker } from '@/lib/types';
import type { UniversalBankEvent, UniversalMoney } from '@/lib/universal-types';

/**
 * BEST-EFFORT AUTOMATIC POSTING FOR UNPROVEN BANK-ALERT FORMATS.
 *
 * Only the UAE and Saudi launch grammars (years of real-alert fixtures) and
 * the certified worldwide templates are PROVEN formats. Every other country
 * and message format is unproven: its grammar is either synthetic or the
 * bank-agnostic universal parser. By explicit product decision such an alert
 * may still be added automatically, but ONLY when this one policy says the
 * message proves a single completed money movement on its own. The row is
 * then marked (`bestEffort`) so the person can confirm, edit or undo it.
 *
 * Everything this function refuses goes to Review exactly as before. It never
 * widens the AE/SA launch parser or a certified template: callers must use it
 * only after those proven paths declined, and never for an alert routed to a
 * launch market (the mature parser's refusal there is deliberate evidence).
 *
 * Guardrails, all required:
 *  - the setting "Auto-add alerts from unverified bank formats" is on;
 *  - the universal parser reads status `posted` (never pending, future,
 *    failed, informational) and no wording in the text says otherwise
 *    (pending/hold/authorisation, request, declined/failed, reversed/
 *    cancelled, OTP/verification, promotion, statement/bill/due, scheduled);
 *  - a supported money-movement family whose direction matches its wording
 *    (purchases/fees/withdrawals/utilities/recurring are debits, refunds are
 *    credits, transfers must say which way) with no direction issue;
 *  - exactly one principal amount: no unresolved role, no second competing
 *    transaction figure (a balance or limit is role-separated and allowed);
 *  - an explicit currency: an ISO code or a symbol the parser proved, or a
 *    shared symbol (`$`, `¥`, `Rs`) resolved ONLY through the user's own
 *    country's currency — a `$` alert for a user in Germany stays in Review;
 *  - a transaction date that is not in the future;
 *  - foreign money converts with a dated rate already on the device (or the
 *    card's own charged figure); without one the alert waits in Review.
 * Duplicate protection is not repeated here: posted rows still pass the
 * import planner's duplicate guard and Wallet near-match holding.
 */

export type BestEffortRefusal =
  | 'disabled'
  | 'launch-market'
  | 'not-posted'
  | 'non-posting-wording'
  | 'unsupported-family'
  | 'direction-unclear'
  | 'amount-unclear'
  | 'competing-amounts'
  | 'currency-unclear'
  | 'future-dated'
  | 'ledger-currency-unknown'
  | 'fx-rate-unavailable'
  | 'invalid-money';

export type BestEffortDecision =
  | {
      outcome: 'post';
      /** Ledger-currency minor units (converted when the alert was foreign). */
      amountFils: number;
      /** Currency of amountFils: the ledger's, or the alert's own when unpinned. */
      currency: string;
      /** The alert's own money, after any country-resolved symbol. */
      original: UniversalMoney;
      /** Present only when foreign money was converted. */
      conversion: ReferenceConversion | null;
      /** Explicit date the alert states, never inferred. */
      date: string | null;
      marker: BestEffortMarker;
    }
  | { outcome: 'review'; reason: BestEffortRefusal };

export interface BestEffortInput {
  source: string;
  event: UniversalBankEvent;
  /** The persisted setting; OFF restores review-first for unproven formats. */
  enabled: boolean;
  /** The user's ISO country (country.ts); resolves shared currency symbols only. */
  country: string | null;
  /** Market the router proved for this alert, when single. */
  routedMarket: string | null;
  /** Launch market proven by the sender, if any. */
  launchSenderMarket?: string | null;
  /** Ledger currency and exponent; null means not pinned yet. */
  ledgerCurrency: string | null;
  ledgerExponent: number | null;
  /** When the alert was observed (epoch ms), for future-date and rate-day checks. */
  observedAt?: number;
  /** Network-free dated rate lookup (rates already on this device). */
  fxLookup?: (base: string, quote: string, date: string) => FxQuote | null;
  /** Code-owned format prefix: 'universal' or 'semantic'. Never source text. */
  formatPrefix?: 'universal' | 'semantic';
}

/**
 * Official currency of countries whose currency shares a symbol with others.
 * Only these are needed: an unshared symbol (€, £, ₹, R$) is already proven
 * by the parser. Deliberately small and explicit; absent = no resolution.
 */
const SHARED_SYMBOL_COUNTRY_CURRENCY: Readonly<Record<string, string>> = {
  // `$`
  US: 'USD', PR: 'USD', GU: 'USD', VI: 'USD', AS: 'USD', MP: 'USD', EC: 'USD', SV: 'USD',
  CA: 'CAD', AU: 'AUD', NZ: 'NZD', SG: 'SGD', HK: 'HKD', MX: 'MXN', AR: 'ARS', CL: 'CLP', CO: 'COP',
  // `¥`
  JP: 'JPY', CN: 'CNY',
  // `Rs`
  IN: 'INR', PK: 'PKR', LK: 'LKR', NP: 'NPR', MU: 'MUR', SC: 'SCR',
};

/** Exposed for tests and the settings copy; never a general country→currency map. */
export const sharedSymbolCurrencyForCountry = (country: string | null | undefined): string | null =>
  (country && SHARED_SYMBOL_COUNTRY_CURRENCY[country.toUpperCase()]) || null;

const LAUNCH_MARKETS = new Set(['AE', 'SA']);

const POSTABLE_FAMILIES = new Set<UniversalBankEvent['family']>([
  'purchase', 'cash-withdrawal', 'refund', 'fee', 'utility', 'recurring-payment', 'transfer',
]);

const BLOCKING_ISSUES = new Set([
  'amount-role-unresolved',
  'posting-status-unresolved',
  'direction-unresolved',
  'direction-conflict',
  'multiple-event-adapter-required',
  'authentication-not-posting',
  'authentication-or-otp',
  'pending-not-posting',
  'promotion-not-posting',
  'settlement-adapter-required',
  'failed-not-posting',
]);

/**
 * Independent wording guard. The universal parser already classifies status;
 * this second, deliberately broad net refuses anything whose text says the
 * money has not (or not yet, or not really) moved. False refusals only cost a
 * Review tap; a false post costs trust. Covers English plus the first-wave
 * European languages, Portuguese and Arabic.
 */
const NON_COMPLETED_WORDING: readonly RegExp[] = [
  // pending / holds / authorisations
  /\bpending\b|\bon\s+hold\b|\bhold\s+(?:placed|of|on|for)\b|\bpre-?auth(?:ori[sz](?:ation|ed))?\b|\bauthori[sz]ation\s+(?:hold|request|only)\b|\bblocked\s+amount\b|\bamount\s+(?:blocked|reserved)\b|\breserved\b|\bprocessing\b|\bin\s+progress\b|\bawaiting\b/iu,
  /\ben\s+attente\b|\bausstehend\b|\bvorgemerkt\b|\breserviert\b|\bpendiente\b|\bretenid[oa]\b|\bin\s+attesa\b|\bin\s+behandeling\b|\bgereserveerd\b|\bpendente\b|\bem\s+processamento\b|معلق|قيد\s+(?:المعالجة|التنفيذ)|محجوز/iu,
  // requests / collect / approval asks
  /\brequest(?:ed|s|ing)?\b|\bcollect\s+request\b|\bapprove\s+(?:this|the)\b|\bconfirm\s+(?:this|the|your)\s+(?:payment|transaction|purchase)\b|\bdemande\b|\banfrage\b|\bsolicitud\b|\brichiesta\b|\bverzoek\b|\bsolicita[çc][aã]o|طلب/iu,
  // declined / failed / unsuccessful
  /\bdeclin(?:e|ed|ing)\b|\bfail(?:ed|ure|s)?\b|\bunsuccessful\b|\bnot\s+(?:been\s+)?(?:processed|completed|successful|approved|authori[sz]ed)\b|\brejected\b|\binsufficient\b|\brefus(?:[ée]e?|ed)?(?!\p{L})|(?<!\p{L})[ée]chou[ée]|\babgelehnt\b|\bfehlgeschlagen\b|\brechazad[oa]\b|\brifiutat[oa]\b|\bnon\s+riuscit[oa]\b|\bgeweigerd\b|\bmislukt\b|\brecusad[oa]\b|\bnegad[oa]\b|مرفوض|رفض|فشل|لم\s+تتم/iu,
  // reversed / cancelled / void
  /\brevers(?:al|ed|e)\b|\bchargeback\b|\bcancel(?:l)?(?:ed|ation)\b|\bvoid(?:ed)?\b|\bannul[ée]|\bstorniert\b|\banulad[oa]\b|\bannullat[oa]\b|\bgeannuleerd\b|\bcancelad[oa]\b|عكس|إلغاء|الغاء|ملغ/iu,
  // OTP / verification / codes
  /\botp\b|\bone[-\s]?time\s+(?:pass(?:word|code)?|code|pin)\b|\bverification\s+code\b|\bsecurity\s+code\b|\bpasscode\b|\bdo\s+not\s+share\b|\bnever\s+share\b|\b2fa\b|\bverify\s+(?:this|the|your)\s+(?:transaction|payment|purchase)\b|\bcode\s+(?:de\s+)?(?:v[ée]rification|s[ée]curit[ée])|\bbest[äa]tigungscode\b|\bc[óo]digo\s+de\s+(?:verificaci[óo]n|seguran[çc]a|verifica[çc][aã]o)\b|\bcodice\s+(?:di\s+)?(?:verifica|sicurezza)\b|رمز\s+(?:التحقق|التفعيل)|كلمة\s+(?:المرور|السر)\s+لمرة/iu,
  // promotions
  /\bcashback\b|\bcash\s+back\b|\bdiscount\b|\b\d{1,3}\s?%\s*off\b|\boffers?\b|\bpromo(?:tion|code)?\b|\bvoucher\b|\bcoupon\b|\bwin\b|\bgiveaway\b|\bredeem\b|\bangebot\b|\brabatt\b|\bpromoci[óo]n\b|\bdescuento\b|\bsconto\b|\bkorting\b|\bdesconto\b|\bpromo[çc][aã]o|عرض|تخفيض/iu,
  // statements / bills / dues / reminders / balance-only
  /\bstatement\b|\bminimum\s+(?:amount\s+)?(?:due|payment)\b|\btotal\s+(?:amount\s+)?due\b|\bamount\s+due\b|\bdue\s+(?:date|on|by)\b|\bpayment\s+due\b|\bbill\s+(?:is\s+)?(?:due|generated|ready)\b|\breminder\b|\boverdue\b|\brelev[ée](?!\p{L})|\bkontoauszug\b|\bextracto\b|\bestratto\s+conto\b|\brekeningoverzicht\b|\bfatura\s+(?:fechada|vence)\b|كشف\s+(?:ال)?حساب|مستحق|تذكير|الحد\s+الأدنى/iu,
  // future / scheduled / mandates
  /\bwill\s+be\s+(?:debited|charged|deducted|paid|processed|collected|credited)\b|\bscheduled\b|\bupcoming\b|\bstanding\s+(?:instruction|order)\b|\bmandate\b|\bpre-?debit\b|\bauto-?pay\s+(?:set|scheduled|registered)\b|\bsera\s+(?:d[ée]bit[ée]|pr[ée]lev[ée])|\bwird\s+(?:abgebucht|belastet)\b|\bser[áa]\s+(?:cargad[oa]|debitad[oa])\b|\bsar[àa]\s+addebitat[oa]\b|\bwordt\s+afgeschreven\b|سيتم/iu,
];

/** Temporary holds/charges are never a completed movement. */
const TEMPORARY_HOLD = /\btemporary\s+(?:authori[sz]ation|hold|charge|debit|block)\b|\bhold\s+amount\b/iu;
/**
 * "Authorised"/"authorisation" alone describes an approval, which may still be
 * released or change; only posted/completed/settled wording makes it money.
 */
const AUTHORISATION = /\bauthori[sz](?:ed|ation)\b/iu;
const COMPLETED = /\b(?:completed|posted|settled)\b/iu;

export const hasNonCompletedWording = (source: string): boolean =>
  nonPostingReason(source) !== null || NON_COMPLETED_WORDING.some((pattern) => pattern.test(source)) ||
  TEMPORARY_HOLD.test(source) || (AUTHORISATION.test(source) && !COMPLETED.test(source));

const localIsoDay = (epochMs: number | undefined): string | null => {
  if (epochMs === undefined || !Number.isFinite(epochMs)) return null;
  const day = new Date(epochMs);
  if (!Number.isFinite(day.getTime())) return null;
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
};

const directionMatchesFamily = (event: UniversalBankEvent): boolean => {
  if (event.direction !== 'debit' && event.direction !== 'credit') return false;
  if (event.family === 'refund') return event.direction === 'credit';
  if (event.family === 'transfer') return true;
  return event.direction === 'debit';
};

const validMoney = (money: UniversalMoney | null | undefined): money is UniversalMoney => {
  if (!money || typeof money.currency !== 'string' || !/^[A-Z]{3}$/.test(money.currency)) return false;
  const exponent = currencyMinorUnits(money.currency);
  if (exponent === null || exponent !== money.exponent) return false;
  if (typeof money.minorUnits !== 'string' || !/^[1-9]\d{0,15}$/.test(money.minorUnits)) return false;
  return Number.isSafeInteger(Number(money.minorUnits));
};

/**
 * The principal amount, or a refusal. A shared symbol resolves only through
 * the user's country, and only when that is the sole reason for ambiguity.
 */
const resolvePrincipalMoney = (
  event: UniversalBankEvent,
  country: string | null,
): UniversalMoney | 'amount-unclear' | 'currency-unclear' => {
  const field = event.amount;
  if (field.evidence === 'explicit') {
    if (field.alternatives.length !== 0 || !validMoney(field.value)) return 'amount-unclear';
    return field.value;
  }
  if (field.evidence !== 'ambiguous') return 'amount-unclear';
  // Only a currency-symbol ambiguity may be resolved. Any other doubt (two
  // numbers, a role question) stays with the person.
  const symbolOnly = field.issues.length > 0 &&
    field.issues.every((issue) => issue === 'currency-symbol' || issue === 'currency-exponent');
  if (!symbolOnly) return 'amount-unclear';
  const wanted = sharedSymbolCurrencyForCountry(country);
  if (!wanted) return 'currency-unclear';
  const options = [...(field.value ? [field.value] : []), ...field.alternatives]
    .filter((money) => money && money.currency === wanted);
  const distinct = new Set(options.map((money) => `${money.minorUnits}/${money.exponent}`));
  if (distinct.size !== 1 || !validMoney(options[0])) return 'currency-unclear';
  return options[0];
};

/**
 * Exactly one principal figure. Balance/limit/due observations are separate
 * roles and allowed; a second transaction figure or an unlabelled one is not,
 * except a figure in the ledger currency beside a foreign charge (the card's
 * own converted amount), which the FX path validates against a dated rate.
 */
const hasCompetingAmounts = (
  event: UniversalBankEvent,
  principal: UniversalMoney,
  ledgerCurrency: string | null,
): boolean => {
  const principalRoles = event.family === 'fee' ? new Set(['transaction', 'fee']) : new Set(['transaction']);
  const statedLedger = (money: UniversalMoney | null): boolean =>
    !!money && !!ledgerCurrency && principal.currency !== ledgerCurrency && money.currency === ledgerCurrency;
  let principals = 0;
  for (const observation of event.observations) {
    const value = observation.field.value;
    if (observation.role === 'unknown') {
      if (statedLedger(value)) continue;
      return true;
    }
    if (!principalRoles.has(observation.role)) continue;
    if (statedLedger(value)) continue;
    principals += 1;
    const others = [...observation.field.alternatives, ...(value ? [value] : [])]
      .filter((money) => !(money.currency === principal.currency && money.minorUnits === principal.minorUnits))
      .filter((money) => !statedLedger(money));
    // A symbol ambiguity lists every candidate currency for the same figure.
    if (others.some((money) => money.minorUnits !== principal.minorUnits &&
      currencyMinorUnits(money.currency) === principal.exponent)) return true;
  }
  return principals !== 1;
};

const LAUNCH_ROUTE = (market: string | null | undefined): boolean => !!market && LAUNCH_MARKETS.has(market);

/** The single decision for an unproven format. Pure: no storage, no network. */
export function decideBestEffortAutoPost(input: BestEffortInput): BestEffortDecision {
  const review = (reason: BestEffortRefusal): BestEffortDecision => ({ outcome: 'review', reason });
  const { event } = input;
  if (!input.enabled) return review('disabled');
  if (LAUNCH_ROUTE(input.routedMarket) || LAUNCH_ROUTE(input.launchSenderMarket ?? null)) {
    return review('launch-market');
  }
  if (!event || event.version !== 1 || event.decision !== 'review' || event.status !== 'posted') {
    return review('not-posted');
  }
  if (typeof input.source !== 'string' || hasNonCompletedWording(input.source)) {
    return review('non-posting-wording');
  }
  if (!POSTABLE_FAMILIES.has(event.family)) return review('unsupported-family');
  if (!directionMatchesFamily(event)) return review('direction-unclear');
  if (event.issues.some((issue) => BLOCKING_ISSUES.has(issue))) {
    return review(event.issues.some((issue) => issue.startsWith('direction')) ? 'direction-unclear' : 'not-posted');
  }

  const principal = resolvePrincipalMoney(event, input.country);
  if (typeof principal === 'string') return review(principal);
  if (hasCompetingAmounts(event, principal, input.ledgerCurrency)) return review('competing-amounts');

  const observedDay = localIsoDay(input.observedAt);
  const date = event.transactionDate.evidence === 'explicit' ? event.transactionDate.value : null;
  if (date !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return review('future-dated');
    if (observedDay && date > observedDay) return review('future-dated');
  }

  const originalMinor = Number(principal.minorUnits);
  let amountFils = originalMinor;
  let currency = principal.currency;
  let conversion: ReferenceConversion | null = null;
  if (input.ledgerCurrency && input.ledgerCurrency !== principal.currency) {
    const exponent = input.ledgerExponent;
    if (exponent !== 0 && exponent !== 2 && exponent !== 3) return review('invalid-money');
    const day = date ?? observedDay;
    if (!day) return review('fx-rate-unavailable');
    const quote = input.fxLookup ? input.fxLookup(principal.currency, input.ledgerCurrency, day) : null;
    const converted = convertForeignConfirmation(
      event,
      { currency: principal.currency, minorUnits: originalMinor, exponent: principal.exponent },
      { currency: input.ledgerCurrency, exponent },
      quoteFitsDay(quote, day) ? quote : null,
      { requireQuoteForStated: true },
    );
    if (converted === 'fx-rate-unavailable') return review('fx-rate-unavailable');
    if (converted === 'invalid-money') return review('invalid-money');
    conversion = converted;
    amountFils = converted.amountFils;
    currency = input.ledgerCurrency;
  } else if (input.ledgerCurrency && input.ledgerExponent !== null &&
    input.ledgerExponent !== principal.exponent) {
    return review('invalid-money');
  }
  if (!Number.isSafeInteger(amountFils) || amountFils <= 0) return review('invalid-money');

  const market = input.routedMarket && /^[A-Z]{2}$/.test(input.routedMarket)
    ? input.routedMarket
    : input.country && /^[A-Z]{2}$/.test(input.country) ? input.country : 'ZZ';
  return {
    outcome: 'post',
    amountFils,
    currency,
    original: principal,
    conversion,
    date,
    marker: {
      v: 1,
      format: `${input.formatPrefix ?? 'universal'}:${event.family}:${event.direction}`,
      market,
    },
  };
}

/* ── Setting mirror ─────────────────────────────────────────────────────────
 * The persisted AppState flag is mirrored here (like country.ts) so parser
 * sessions created deep in capture pipelines honour it without threading the
 * store through every native adapter. Undefined in storage means ON: the
 * product default chosen for unproven formats. */
let bestEffortEnabled = true;

export function setBestEffortAutoPostEnabled(enabled: boolean | undefined): void {
  bestEffortEnabled = enabled !== false;
}

export function bestEffortAutoPostEnabled(): boolean {
  return bestEffortEnabled;
}

/** Bounded, durable identities of rows the person undid; rescans never re-add them. */
export const BEST_EFFORT_UNDO_CAP = 2000;

/**
 * The observation-time identity of one best-effort reading: time, ledger
 * currency and exact amount. Including the money means an undo can never
 * suppress a different movement that merely shares the timestamp.
 */
export const bestEffortObservationKey = (
  ts: number | undefined,
  currency: string | null | undefined,
  amountFils: number,
): string | null =>
  typeof ts === 'number' && Number.isFinite(ts) && typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) &&
    Number.isSafeInteger(amountFils) && amountFils > 0
    ? `t${ts}:${currency}${amountFils}`
    : null;

/** Every identity a rescan of the same alert could plan the row under. */
export const bestEffortUndoKeys = (
  row: { smsKey?: string; ts?: number; amountFils: number },
  ledgerCurrency: string | null | undefined,
): string[] => {
  const keys = new Set<string>();
  if (typeof row.smsKey === 'string' && row.smsKey) keys.add(row.smsKey);
  const observed = bestEffortObservationKey(row.ts, ledgerCurrency, row.amountFils);
  if (observed) keys.add(observed);
  return [...keys];
};

/** Tombstones for every marked row among `removed` (undo, delete, batch undo, account delete). */
export const tombstonesForRemoved = (
  existing: readonly string[] | undefined,
  removed: readonly { bestEffort?: unknown; smsKey?: string; ts?: number; amountFils: number }[],
  ledgerCurrency: string | null | undefined,
): string[] | undefined => {
  const keys = removed.filter((row) => row.bestEffort).flatMap((row) => bestEffortUndoKeys(row, ledgerCurrency));
  return keys.length > 0 ? appendBestEffortUndo(existing, keys) : undefined;
};

export const appendBestEffortUndo = (existing: readonly string[] | undefined, keys: readonly string[]): string[] => {
  const next = [...(existing ?? []).filter((key) => !keys.includes(key)), ...keys];
  return next.length > BEST_EFFORT_UNDO_CAP ? next.slice(next.length - BEST_EFFORT_UNDO_CAP) : next;
};
