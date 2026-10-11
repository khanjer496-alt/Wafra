import { hasNonCompletedWording, isNotAutoPostableMoney } from '@/lib/best-effort-autopost';
import { dateOrderForCountry } from '@/lib/country';
import { currencyMinorUnits } from '@/lib/currency-metadata';
import type { FxQuote } from '@/lib/fx';
import { convertForeignConfirmation, quoteFitsDay } from '@/lib/fx-rates';
import { readBankMuscatCardPurchase } from '@/lib/gulf-neighbour-templates';
import { classifyMerchantDescription, parseSms, type ParsedSms } from '@/lib/sms-parser';
import type { BestEffortMarker, CategoryId } from '@/lib/types';
import { inspectUniversalBankEvent } from '@/lib/universal-parser';
import type { UniversalBankEvent } from '@/lib/universal-types';

/**
 * GULF NEIGHBOURS: QATAR, KUWAIT, BAHRAIN AND OMAN.
 *
 * These four countries have no consented real alerts, so nothing here is a
 * verified pack. What they share with the UAE/Saudi launch markets is the
 * alert LANGUAGE: the same English and Arabic families ("Purchase of KWD
 * 12.345 with card ending … at …", "… debited from A/C … Avl Bal …",
 * "تم خصم … رصيدك …"). So an alert from a recognised institution of one of
 * these markets is read by the SAME proven launch grammar (parseSms), never
 * by a new one, and only in the marked best-effort mode:
 *
 *  - the route is a single Gulf-neighbour market proven by an institution
 *    (sender or body); a brand that also banks elsewhere counts only with the
 *    market's own currency, never by name alone (alert-institution-grammars).
 *    Alerts with no recognised institution keep the generic policy unchanged;
 *  - the person's "Auto-add alerts from unverified bank formats" setting is on;
 *  - the shared non-completed wording guard (best-effort-autopost) and a
 *    limit-change guard find nothing; the alert states a completion verb, so
 *    a heading-only notice ("Card 1234 KWD 5.000 SHOP") is never booked;
 *  - the launch grammar reads ONE transaction whose money is exactly the
 *    market's own currency (route-scoped spellings such as KD, د.ك, QR or
 *    ريال عماني are rewritten to the ISO code first), and the independent
 *    universal reader, scoped to the same market, reads the same amount,
 *    agrees on direction and finds no failed/pending/OTP/promotion state;
 *  - a stated date is not in the future, and money in another currency than
 *    the ledger converts only with a dated rate already on the device.
 *
 * The posted row carries the `bestEffort` marker ("Auto-added — check").
 * Anything else from such an institution returns a Review decision: the
 * universal best-effort reader may NOT post it on its own, so "not fully
 * matched by the grammar" always means Review.
 *
 * The one exception is an exact per-bank certified template
 * (gulf-neighbour-templates.ts) from that bank's own SMS sender: it reads its
 * own fields and posts without the marker. The same guards still apply, and
 * the best-effort setting still gates it (outside AE/SA every SMS path does).
 */

export const GULF_NEIGHBOUR_CURRENCY = { QA: 'QAR', KW: 'KWD', BH: 'BHD', OM: 'OMR' } as const;
export type GulfNeighbourMarket = keyof typeof GULF_NEIGHBOUR_CURRENCY;

export const isGulfNeighbourMarket = (market: string | null | undefined): market is GulfNeighbourMarket =>
  !!market && Object.prototype.hasOwnProperty.call(GULF_NEIGHBOUR_CURRENCY, market);

const latinBeside = (token: string): RegExp =>
  new RegExp(String.raw`(?<![\p{L}\p{N}])${token}(?=\s{0,3}\d)|(?<=\d\s{0,3})${token}(?![\p{L}\p{N}])`, 'giu');
/**
 * "QR" is also the QR code ("Scan QR 3 times", "QR 123456 reference"), so it
 * is money only beside a two-decimal riyal figure ("QR 42.50", "42.50 QR").
 */
const QR_BESIDE_MONEY =
  /(?<![\p{L}\p{N}])QR(?=\s{0,3}\d{1,3}(?:,\d{3})*\.\d{2}(?!\d))|(?<=(?<![\d.,])\d{1,3}(?:,\d{3})*\.\d{2}\s{0,3})QR(?![\p{L}\p{N}])/giu;

/**
 * Route-scoped spellings of the market's own currency, rewritten to its ISO
 * code before the launch grammar reads the alert (the grammar knows ISO codes
 * but none of these). Applied ONLY after routing; the Latin abbreviations only
 * directly beside a figure, so "QR code" or a "BD" reference is never money.
 */
const LOCAL_SPELLINGS: Readonly<Record<GulfNeighbourMarket, readonly RegExp[]>> = {
  QA: [/ر\.\s?ق\.?/gu, /ريال\s+قطري/gu, QR_BESIDE_MONEY],
  KW: [/د\.\s?ك\.?/gu, /دينار\s+كويتي/gu, latinBeside('KD')],
  BH: [/د\.\s?ب\.?/gu, /دينار\s+بحريني/gu, latinBeside('BD')],
  OM: [/ر\.\s?ع\.?/gu, /ريال\s+عماني/gu, latinBeside(String.raw`R\.O\.?`), latinBeside('RO')],
};

interface SpellingEdit { start: number; end: number; original: string }

/** Every local spelling in `source` (original offsets), earliest first, never overlapping. */
const spellingEdits = (source: string, market: GulfNeighbourMarket): SpellingEdit[] => {
  const found: SpellingEdit[] = [];
  for (const pattern of LOCAL_SPELLINGS[market]) {
    for (const match of source.matchAll(new RegExp(pattern.source, pattern.flags))) {
      const start = match.index!;
      const end = start + match[0].length;
      if (!found.some((edit) => start < edit.end && end > edit.start)) found.push({ start, end, original: match[0] });
    }
  }
  return found.sort((a, b) => a.start - b.start);
};

/** `source` with the chosen edits rewritten to the ISO code, plus each edit's span in the result. */
const applyEdits = (
  source: string, market: GulfNeighbourMarket, edits: readonly SpellingEdit[],
): { text: string; spans: { start: number; end: number }[] } => {
  const iso = GULF_NEIGHBOUR_CURRENCY[market];
  let text = '';
  let at = 0;
  const spans: { start: number; end: number }[] = [];
  for (const edit of edits) {
    text += source.slice(at, edit.start);
    spans.push({ start: text.length, end: text.length + iso.length });
    text += iso;
    at = edit.end;
  }
  return { text: text + source.slice(at), spans };
};

export const gulfNeighbourReadSource = (source: string, market: GulfNeighbourMarket): string =>
  applyEdits(source, market, spellingEdits(source, market)).text;

/**
 * A completion verb, English or Arabic. "Purchase of" is the launch grammar's
 * own completed-purchase phrase; a bare heading ("POS", "Card transaction",
 * "شراء بطاقة") is not.
 */
const COMPLETION = /\b(?:purchase\s+of|(?:was|has\s+been)\s+used\s+(?:for|at)|debited|credited|deducted|withdrawn|deposited|paid|spent|refunded|transferred|received|charged|was\s+successful)\b|تمت?\s+(?:عملية\s+)?(?:ال)?(?:خصم|إيداع|ايداع|تحويل|سداد|سحب|شراء|استرداد|قيد|إضافة|اضافة|دفع)/iu;

/**
 * Paying the card's own bill moves money between the person's accounts; it is
 * a card payment, never spending. ("Your card 1234 bill of KWD 120.500 has
 * been paid", "تم سداد فاتورة البطاقة …".)
 */
// Within one sentence: a full stop counts only when a digit follows (120.500).
const CARD_BILL_PAYMENT = /\bcard\b(?:[^.\n]|\.(?=\d)){0,40}\b(?:bill|dues?|outstanding|statement\s+balance)\b(?:[^.\n]|\.(?=\d)){0,60}\b(?:paid|settled|received)\b|\b(?:payment|repayment)\b(?:[^.\n]|\.(?=\d)){0,40}\b(?:towards|to|for)\s+(?:your\s+)?(?:credit\s+)?card\b|(?:سداد|تسديد|دفع)\s+(?:فاتورة\s+|مستحقات\s+)?(?:ال)?بطاق/iu;

/** A changed card or account limit is information, never a movement. */
const LIMIT_CHANGE = /\blimit\b[^.\n]{0,40}\b(?:increased|decreased|reduced|changed|updated|revised|enhanced|raised)\b|\b(?:increase|decrease|reduction|change)\s+(?:of|in|to)\s+(?:your\s+)?(?:credit\s+|card\s+)?limit\b|(?:رفع|زيادة|تخفيض|تعديل|تغيير)\s+(?:ال)?حد/iu;

const BLOCKING_ISSUES = new Set([
  'direction-conflict', 'multiple-event-adapter-required', 'authentication-not-posting',
  'authentication-or-otp', 'pending-not-posting', 'promotion-not-posting', 'settlement-adapter-required',
  'failed-not-posting',
]);
const POSTABLE_FAMILIES = new Set<UniversalBankEvent['family']>([
  'purchase', 'cash-withdrawal', 'refund', 'fee', 'utility', 'recurring-payment', 'transfer',
]);

export type GulfNeighbourRefusal =
  | 'disabled'
  | 'non-posting-wording'
  | 'card-payment'
  | 'not-posted'
  | 'no-completion-verb'
  | 'grammar-unmatched'
  | 'currency-mismatch'
  | 'readers-disagree'
  | 'future-dated'
  | 'fx-rate-unavailable'
  | 'invalid-money';

export type GulfNeighbourDecision =
  | { outcome: 'not-applicable' }
  | { outcome: 'review'; reason: GulfNeighbourRefusal }
  | { outcome: 'post'; parsed: ParsedSms; templateId: string | null };

export interface GulfNeighbourInput {
  source: string;
  sender: string;
  /** The router's single market, or null. */
  routedMarket: string | null;
  /** The identified institution of that route, and whether the SMS sender itself proved it. */
  institution: { id: string; sender: boolean } | null;
  /** The person's best-effort setting. */
  enabled: boolean;
  /** Pinned ledger currency; a best-effort row is only ever written into one. */
  ledgerCurrency: string;
  ledgerExponent: number | null;
  observedAt?: number;
  fxLookup: (base: string, quote: string, date: string) => FxQuote | null;
  overrides?: Record<string, CategoryId>;
}

const localIsoDay = (epochMs: number | undefined): string | null => {
  if (epochMs === undefined || !Number.isFinite(epochMs)) return null;
  const day = new Date(epochMs);
  if (!Number.isFinite(day.getTime())) return null;
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
};

interface Reading {
  type: 'expense' | 'income';
  minorUnits: number;
  date: string | null;
  /** Row fields other than money. */
  row: Omit<ParsedSms, 'amountFils' | 'currency' | 'raw' | 'type'>;
  templateId: string | null;
}

/** The launch grammar's reading of the ISO-rewritten alert, money in the market's own currency only. */
const grammarReading = (
  read: string,
  own: string,
  input: GulfNeighbourInput,
): Reading | 'grammar-unmatched' | 'currency-mismatch' => {
  const parsed = parseSms(read, input.overrides ?? {}, {
    sender: input.sender, observedAt: input.observedAt, fxLookup: () => null,
  });
  if (!parsed || parsed.kind !== 'transaction') return 'grammar-unmatched';
  // The grammar reads the neighbour currency as FOREIGN money: its exact
  // original is the only figure taken. The offline-table conversion it also
  // produced is never used, and a local (AED/SAR) figure means another
  // reading entirely.
  if (parsed.originalCurrency !== own || parsed.fxSource !== 'fallback' ||
    parsed.originalExponent !== currencyMinorUnits(own) ||
    !Number.isSafeInteger(parsed.originalMinorUnits) || (parsed.originalMinorUnits ?? 0) <= 0) {
    return 'currency-mismatch';
  }
  const {
    amountFils: _amount, currency: _currency, raw: _raw, type,
    originalAmountMinor: _legacy, originalCurrency: _originalCurrency, originalMinorUnits,
    originalExponent: _exponent, fxRate: _rate, fxRateDate: _rateDate, fxSource: _source,
    // A balance quoted beside foreign money was converted with the offline
    // table; a bank name comes from the UAE registry. Neither applies here.
    snapshotFils: _snapshot, snapshotKind: _snapshotKind, bankHint: _bank,
    ...row
  } = parsed;
  return {
    type, minorUnits: originalMinorUnits!, date: parsed.date,
    row: { ...row, snapshotFils: null, snapshotKind: null }, templateId: null,
  };
};

const directionOf = (type: 'expense' | 'income'): 'debit' | 'credit' => type === 'expense' ? 'debit' : 'credit';

/** One decision for an alert that may belong to a Gulf neighbour. Pure: no storage, no network. */
export function decideGulfNeighbourPosting(input: GulfNeighbourInput): GulfNeighbourDecision {
  const review = (reason: GulfNeighbourRefusal): GulfNeighbourDecision => ({ outcome: 'review', reason });
  const market = isGulfNeighbourMarket(input.routedMarket) ? input.routedMarket : null;
  // Only an alert a recognised institution routed here takes this path; any
  // other alert keeps the generic unproven-format policy it had before.
  if (!market || !input.institution) return { outcome: 'not-applicable' };
  if (!input.enabled) return review('disabled');
  // The same smishing-link, fraud-prompt and not-a-new-movement gate as the
  // generic best-effort policy and certified templates.
  if (hasNonCompletedWording(input.source, null, input.sender) || isNotAutoPostableMoney(input.source) ||
    LIMIT_CHANGE.test(input.source)) return review('non-posting-wording');
  if (CARD_BILL_PAYMENT.test(input.source)) return review('card-payment');

  const own = GULF_NEIGHBOUR_CURRENCY[market];
  const exponent = currencyMinorUnits(own)!;
  const edits = spellingEdits(input.source, market);
  const rewritten = applyEdits(input.source, market, edits);
  const read = rewritten.text;
  const event = inspectUniversalBankEvent(read, {
    sender: input.sender, market, dateOrder: dateOrderForCountry(market) ?? undefined,
  });
  // The grammar reads a copy where ONLY spellings the universal reader used
  // as money (the amount, a balance) are ISO codes. A spelling it did not
  // read as money ("at BD 12 STORE") is part of a name and stays as written,
  // so the merchant comes from the original text.
  const moneySpans = event.observations
    .filter((observation) => observation.role !== 'unknown')
    .flatMap((observation) => observation.field.spans);
  const grammarRead = applyEdits(input.source, market, edits.filter((_edit, index) => {
    const span = rewritten.spans[index];
    return moneySpans.some((money) => span.start < money.end && span.end > money.start);
  })).text;
  if (event.decision !== 'review' || event.status !== 'posted' ||
    ['statement', 'balance', 'authentication', 'bill', 'card-payment'].includes(event.family) ||
    event.issues.some((issue) => BLOCKING_ISSUES.has(issue))) {
    return review('not-posted');
  }

  let reading: Reading;
  const template = market === 'OM' && input.institution.id === 'bank-muscat'
    ? readBankMuscatCardPurchase(input.source)
    : null;
  if (template) {
    const classified = classifyMerchantDescription(template.merchant, 'expense', null);
    reading = {
      type: 'expense', minorUnits: template.minorUnits, date: template.date,
      row: {
        kind: 'transaction', merchant: classified.merchant, date: template.date, dueDay: null, minDueFils: null,
        card: { last4: template.last4, kind: 'account' }, reference: null, transferHint: false,
        snapshotFils: null, snapshotKind: null, categoryGuess: classified.categoryGuess,
        categoryDeliberate: classified.categoryDeliberate,
      },
      // Certified only when Bank Muscat's own sender id delivered it.
      templateId: input.institution.sender ? template.templateId : null,
    };
  } else {
    if (!COMPLETION.test(read)) return review('no-completion-verb');
    const grammar = grammarReading(grammarRead, own, input);
    if (typeof grammar === 'string') return review(grammar);
    reading = grammar;
  }

  // Two independent readers must agree on the money and the direction.
  const universal = event.amount.evidence === 'explicit' ? event.amount.value : null;
  if (!universal || universal.currency !== own || universal.exponent !== exponent ||
    universal.minorUnits !== String(reading.minorUnits)) {
    return review('readers-disagree');
  }
  const direction = directionOf(reading.type);
  if (event.direction !== direction && event.direction !== 'unknown') return review('readers-disagree');
  if (template && (event.family !== 'purchase' || event.direction !== 'debit')) return review('readers-disagree');

  const stated = event.transactionDate.evidence === 'explicit' ? event.transactionDate.value : null;
  if (stated && reading.date && stated !== reading.date) return review('readers-disagree');
  const date = reading.date ?? stated;
  const today = localIsoDay(input.observedAt);
  if (date !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (today !== null && date > today))) {
    return review('future-dated');
  }

  let amountFils = reading.minorUnits;
  let fx: Partial<ParsedSms> = {};
  if (input.ledgerCurrency !== own) {
    const ledgerExponent = input.ledgerExponent;
    if (ledgerExponent !== 0 && ledgerExponent !== 2 && ledgerExponent !== 3) return review('invalid-money');
    const day = date ?? today;
    if (!day) return review('fx-rate-unavailable');
    const quote = input.fxLookup(own, input.ledgerCurrency, day);
    const converted = convertForeignConfirmation(
      event, { currency: own, minorUnits: reading.minorUnits, exponent },
      { currency: input.ledgerCurrency, exponent: ledgerExponent },
      quoteFitsDay(quote, day) ? quote : null, { requireQuoteForStated: true },
    );
    if (converted === 'fx-rate-unavailable') return review('fx-rate-unavailable');
    if (converted === 'invalid-money') return review('invalid-money');
    amountFils = converted.amountFils;
    fx = converted.fields;
  } else if (input.ledgerExponent !== null && input.ledgerExponent !== exponent) {
    return review('invalid-money');
  }
  if (!Number.isSafeInteger(amountFils) || amountFils <= 0) return review('invalid-money');

  // Code-owned marker family: the grammar's own structural reading first.
  const family = reading.row.categoryGuess === 'cash-withdrawal' ? 'cash-withdrawal'
    : reading.row.transferHint ? 'transfer'
      : POSTABLE_FAMILIES.has(event.family) ? event.family
        : reading.type === 'income' ? 'transfer' : 'purchase';
  const marker: BestEffortMarker = { v: 1, format: `universal:${family}:${direction}`, market };
  const parsed: ParsedSms = {
    ...reading.row,
    kind: 'transaction',
    type: reading.type,
    amountFils,
    currency: input.ledgerCurrency,
    ...fx,
    date,
    ...(reading.templateId ? {} : { bestEffort: marker }),
    raw: input.source.trim(),
  };
  return { outcome: 'post', parsed, templateId: reading.templateId };
}
