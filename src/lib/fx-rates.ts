import {
  convertMinorUnits,
  currencyExponent,
  fetchReferenceQuote,
  isQuoteFor,
  originalMoneyFields,
  originalMoneyOf,
  type FxQuote,
  type MinorExponent,
  type OriginalMoney,
} from '@/lib/fx';
import type { Transaction } from '@/lib/types';
import type { UniversalBankEvent, UniversalMoney } from '@/lib/universal-types';

/**
 * DATED REFERENCE RATES, CACHED WITHOUT A NEW PRIVACY SURFACE.
 *
 * Quotes live in memory for the process, keyed by pair and requested day.
 * They are deliberately NOT written to unencrypted device storage: the set of
 * (currency, day) pairs a person looked up is a travel diary. The durable
 * cache is the encrypted ledger itself: every converted row already records
 * its rate, effective date and source, and `quoteFromLedger` reads it back.
 *
 * A quote is never synthesised. No rate means `null`, and callers keep the
 * original amount (Review) instead of posting a converted figure.
 */

const MAX_CACHED = 512;
const memory = new Map<string, FxQuote>();
const failures = new Map<string, number>();
/** A failed pair/day is not retried for this long, so a flaky network is not hammered. */
const FAILURE_BACKOFF_MS = 60_000;

const code = (value: string): string | null => {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
};
const validDay = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const keyOf = (base: string, quote: string, date: string): string => `${base}|${quote}|${date}`;

/** A provider rate older than this is not a transaction's rate. */
const MAX_QUOTE_AGE_DAYS = 7;

/**
 * Whether `quote` can be `day`'s rate: its effective date is that day or an
 * earlier publication day (weekends, holidays) at most a week before. A later
 * day's rate, or a stale one, is never used.
 */
export function quoteFitsDay(quote: FxQuote | null | undefined, day: string): quote is FxQuote {
  if (!quote || !validDay(day) || !validDay(quote.date) || quote.date > day) return false;
  const age = (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${quote.date}T00:00:00Z`)) / 86_400_000;
  return age <= MAX_QUOTE_AGE_DAYS;
}

/** Remember a provider quote obtained for `requestedDate`. */
export function rememberReferenceQuote(requestedDate: string, quote: FxQuote): void {
  if (!validDay(requestedDate) || !isQuoteFor(quote, quote.base, quote.quote)) return;
  const key = keyOf(quote.base.toUpperCase(), quote.quote.toUpperCase(), requestedDate);
  memory.delete(key);
  memory.set(key, { base: quote.base.toUpperCase(), quote: quote.quote.toUpperCase(), rate: quote.rate, date: quote.date });
  failures.delete(key);
  while (memory.size > MAX_CACHED) memory.delete(memory.keys().next().value as string);
}

/** Test/erase hook: forget every cached quote. */
export function clearReferenceQuoteCache(): void {
  memory.clear();
  failures.clear();
}

/**
 * A rate this ledger already recorded for the same pair on the same day.
 * Only provider (`reference`) rows qualify: a bank-stated rate includes the
 * card's own markup and a fallback rate is an approximation.
 */
export function quoteFromLedger(
  transactions: readonly Transaction[] | undefined,
  baseInput: string,
  quoteInput: string,
  date: string,
): FxQuote | null {
  const base = code(baseInput);
  const quote = code(quoteInput);
  if (!base || !quote || !transactions || !validDay(date)) return null;
  for (const tx of transactions) {
    if (tx.fxSource !== 'reference' || tx.date !== date || tx.originalCurrency?.toUpperCase() !== base) continue;
    const candidate = { base, quote, rate: tx.fxRate, date: tx.fxRateDate };
    // A row whose date was edited after conversion no longer proves its rate.
    if (isQuoteFor(candidate, base, quote) && quoteFitsDay(candidate as FxQuote, date)) return candidate as FxQuote;
  }
  return null;
}

/**
 * Synchronous lookup for parsers and planners: memory first, then a rate the
 * encrypted ledger already recorded. Never touches the network.
 */
export function cachedReferenceQuote(
  baseInput: string,
  quoteInput: string,
  date: string,
  transactions?: readonly Transaction[],
): FxQuote | null {
  const base = code(baseInput);
  const quote = code(quoteInput);
  if (!base || !quote || base === quote || !validDay(date)) return null;
  const cached = memory.get(keyOf(base, quote, date));
  if (cached) return cached;
  return quoteFromLedger(transactions, base, quote, date);
}

export type AsyncFxQuoteLookup = (base: string, quote: string, date: string) => Promise<FxQuote | null>;

/**
 * Cached quote, else one network request (two codes and a day, nothing else).
 * Resolves `null` offline, on a provider error, or during the failure backoff.
 */
export async function loadReferenceQuote(
  baseInput: string,
  quoteInput: string,
  date: string,
  options: { fetchImpl?: typeof fetch; transactions?: readonly Transaction[]; now?: number } = {},
): Promise<FxQuote | null> {
  const base = code(baseInput);
  const quote = code(quoteInput);
  if (!base || !quote || base === quote || !validDay(date)) return null;
  const cached = cachedReferenceQuote(base, quote, date, options.transactions);
  if (cached) return cached;
  const key = keyOf(base, quote, date);
  const now = options.now ?? Date.now();
  const failedAt = failures.get(key);
  if (failedAt !== undefined && now - failedAt < FAILURE_BACKOFF_MS) return null;
  try {
    const fetched = await fetchReferenceQuote(base, quote, date, options.fetchImpl ?? fetch);
    rememberReferenceQuote(date, fetched);
    return fetched;
  } catch {
    failures.set(key, now);
    return null;
  }
}

export interface ReferenceConversion {
  amountFils: number;
  fields: Pick<Transaction, 'originalCurrency' | 'originalAmountMinor' | 'originalMinorUnits' |
    'originalExponent' | 'fxRate' | 'fxRateDate' | 'fxSource'>;
}

/**
 * Convert one exact foreign amount into ledger minor units with a recorded
 * provider quote, returning the row fields that make the conversion auditable.
 * Null when the quote is not for exactly this pair or the result is unusable.
 */
export function convertWithReferenceQuote(
  original: OriginalMoney,
  ledgerCurrency: string,
  ledgerExponent: MinorExponent,
  quote: FxQuote | null | undefined,
): ReferenceConversion | null {
  const target = code(ledgerCurrency);
  if (!target || !quote || !isQuoteFor(quote, original.currency, target)) return null;
  if (currencyExponent(original.currency) !== original.exponent) return null;
  try {
    const amountFils = convertMinorUnits(original.minorUnits, original.exponent, quote.rate, ledgerExponent);
    return {
      amountFils,
      fields: {
        ...originalMoneyFields(original),
        fxRate: quote.rate,
        fxRateDate: quote.date,
        fxSource: 'reference',
      },
    };
  } catch {
    return null;
  }
}

/**
 * THE CARD'S OWN FIGURE WINS.
 *
 * When the alert states both the foreign amount and the ledger-currency
 * amount actually charged, that charged amount is the money that left the
 * account (it includes the card's rate and markup). Record it with the
 * implied rate as `fxSource: 'bank'`; no reference rate is needed or used.
 */
export function bankStatedConversion(
  original: OriginalMoney,
  chargedLedgerMinor: number,
  ledgerExponent: MinorExponent,
): ReferenceConversion | null {
  if (!Number.isSafeInteger(chargedLedgerMinor) || chargedLedgerMinor <= 0) return null;
  if (currencyExponent(original.currency) !== original.exponent) return null;
  const rate = (chargedLedgerMinor / 10 ** ledgerExponent) / (original.minorUnits / 10 ** original.exponent);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  try {
    return {
      amountFils: chargedLedgerMinor,
      fields: { ...originalMoneyFields(original), fxRate: rate, fxSource: 'bank' },
    };
  } catch {
    return null;
  }
}

/**
 * The one ledger-currency amount the same alert states as the transaction
 * itself ("USD 12.00 (INR 1,003.50)"), or null. Balances, limits, dues and
 * fees are never charged amounts. Two different ledger figures prove nothing.
 *
 * A figure whose role the parser could not name (the parenthetical INR above
 * is 'unknown') counts only with `includeUnknownRole`, which callers set only
 * when a reference quote can sanity-check it.
 */
export const statedLedgerAmount = (
  event: Pick<UniversalBankEvent, 'amount' | 'observations'>,
  ledgerCurrency: string,
  ledgerExponent: number,
  options: { includeUnknownRole?: boolean } = {},
): number | null => {
  // Amount alternatives are NOT candidates: when no transaction figure was
  // proven the universal extractor fills them from fees and unlabelled
  // figures ("fee INR 120 ... USD 50.00"), none of which is the charge.
  const candidates: UniversalMoney[] = [
    ...(event.amount?.evidence === 'explicit' && event.amount.value ? [event.amount.value] : []),
    ...(Array.isArray(event.observations) ? event.observations : [])
      .filter((observation) => observation?.role === 'transaction' ||
        (options.includeUnknownRole === true && observation?.role === 'unknown'))
      .flatMap((observation) => [
        ...(observation.field?.value ? [observation.field.value] : []),
        ...(Array.isArray(observation.field?.alternatives) ? observation.field.alternatives : []),
      ]),
  ];
  const figures = new Set(candidates
    .filter((money) => money && money.currency === ledgerCurrency && money.exponent === ledgerExponent &&
      typeof money.minorUnits === 'string' && /^[1-9]\d{0,15}$/.test(money.minorUnits))
    .map((money) => money.minorUnits));
  if (figures.size !== 1) return null;
  const minor = Number([...figures][0]);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
};

/**
 * Convert a confirmed foreign amount into the ledger's money. The card's own
 * charged figure wins over any reference rate; otherwise a dated provider
 * quote for exactly this pair is required. Never a guessed rate.
 *
 * A stated ledger figure is only the charged amount when it could BE the
 * same money: with a quote in hand, a figure implying a rate outside
 * 0.8–1.25× of it (a cashback, a balance, a reference number, a merchant name
 * such as "INR 3 TRADING") is discarded and the reference conversion is used
 * instead. Card markups are a few percent; the band leaves room for fees and
 * a weekend rate, not for a different figure.
 * `requireQuoteForStated` makes the automatic path refuse a stated figure it
 * cannot sanity-check; a user-confirmed Review may accept it without one.
 */
export const convertForeignConfirmation = (
  /** Null for a single-amount (registered) review: nothing else was stated. */
  event: Pick<UniversalBankEvent, 'amount' | 'observations'> | null,
  selected: { currency: string; minorUnits: number; exponent: number },
  ledger: { currency: string; exponent: number },
  fxQuote: FxQuote | null | undefined,
  options: { requireQuoteForStated?: boolean } = {},
): ReferenceConversion | 'fx-rate-unavailable' | 'invalid-money' => {
  if (![0, 2, 3].includes(selected.exponent) || ![0, 2, 3].includes(ledger.exponent)) return 'invalid-money';
  const original = {
    currency: selected.currency,
    minorUnits: selected.minorUnits,
    exponent: selected.exponent as 0 | 2 | 3,
  };
  const ledgerExponent = ledger.exponent as 0 | 2 | 3;
  const quote = fxQuote && isQuoteFor(fxQuote, original.currency, ledger.currency) ? fxQuote : null;
  const charged = event
    ? statedLedgerAmount(event, ledger.currency, ledger.exponent, { includeUnknownRole: quote !== null })
    : null;
  if (charged !== null && (quote || !options.requireQuoteForStated)) {
    const stated = bankStatedConversion(original, charged, ledgerExponent);
    const ratio = stated && quote ? (stated.fields.fxRate as number) / quote.rate : 1;
    if (stated && ratio <= 1.25 && ratio >= 0.8) return stated;
    if (!stated && !quote) return 'invalid-money';
  }
  if (!quote) return 'fx-rate-unavailable';
  return convertWithReferenceQuote(original, ledger.currency, ledgerExponent, quote) ??
    'fx-rate-unavailable';
};

/** Re-export for callers that only need to read a stored original. */
export { originalMoneyOf };
