import { currencyMinorUnits } from '@/lib/currency-metadata';
import { formatMinorUnits, type LedgerMoneySpec } from '@/lib/ledger-money';
import type { Transaction } from '@/lib/types';

/**
 * ONE REFERENCE-RATE SOURCE FOR EVERY LEDGER CURRENCY.
 *
 * Frankfurter v2 (https://frankfurter.dev) republishes dated official
 * reference rates from 98 central banks and official sources (the ECB plus,
 * for example, the Central Bank of the UAE, SAMA, the RBI and the BoJ). Its
 * currency list covers every spendable ISO 4217 code in currency-metadata.ts;
 * the only codes it lacks are fund/unit-of-account codes (BOV, CHE, CHW, CLF,
 * COU, MXV, USN, UYI, UYW) plus VED and XAD, none of which a card alert
 * charges in. No API key, no account, no quota.
 *
 * PRIVACY: a request carries exactly two ISO currency codes and one ISO date.
 * Never an amount, merchant, account, card, ledger or device identifier. The
 * provider states it does not log request URLs or IP addresses. See
 * docs/privacy-policy.md.
 *
 * NEVER INVENT A RATE: every converted row records the provider rate, the
 * provider's effective date and `fxSource: 'reference'`. When no rate can be
 * obtained the caller keeps the original and does not post a converted
 * amount (see fx-rates.ts and review-promotion.ts).
 */
export const FX_PROVIDER_NAME = 'Frankfurter reference rate';
export const FX_API_ORIGIN = 'https://api.frankfurter.dev';

export interface FxQuote {
  base: string;
  quote: string;
  /** Units of quote currency for one unit of base currency. */
  rate: number;
  /** Provider's effective ISO day (weekends can resolve to a prior working day). */
  date: string;
}

export interface FxUpdate {
  id: string;
  amountFils: number;
  fxRate: number;
  fxRateDate: string;
  fxSource: 'reference';
}

export type FxQuoteLoader = (base: string, quote: string, date: string) => Promise<FxQuote>;

export type MinorExponent = 0 | 2 | 3;

function currencyCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error('Invalid currency code');
  return code;
}

function isoDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid FX date');
  return value;
}

/** ISO 4217 exponent when this app can represent the currency exactly. */
export function currencyExponent(code: string): MinorExponent | null {
  const exponent = currencyMinorUnits(code);
  return exponent === 0 || exponent === 2 || exponent === 3 ? exponent : null;
}

export function referenceQuoteUrl(base: string, quote: string, date: string): string {
  return `${FX_API_ORIGIN}/v2/rate/${currencyCode(base)}/${currencyCode(quote)}?date=${isoDate(date)}`;
}

function readQuote(value: unknown, expectedBase: string, expectedQuote: string): FxQuote {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid FX response');
  const row = value as Partial<FxQuote>;
  const base = typeof row.base === 'string' ? row.base.toUpperCase() : '';
  const quote = typeof row.quote === 'string' ? row.quote.toUpperCase() : '';
  if (
    base !== expectedBase ||
    quote !== expectedQuote ||
    typeof row.rate !== 'number' ||
    !Number.isFinite(row.rate) ||
    row.rate <= 0 ||
    typeof row.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.date)
  ) {
    throw new Error('Invalid FX response');
  }
  return { base, quote, rate: row.rate, date: row.date };
}

/** A structurally valid quote for exactly this pair, or false. */
export function isQuoteFor(quote: unknown, base: string, target: string): quote is FxQuote {
  try {
    readQuote(quote, currencyCode(base), currencyCode(target));
    return true;
  } catch {
    return false;
  }
}

/** Fetch one dated public reference rate; no ledger or user identifier is sent. */
export async function fetchReferenceQuote(
  baseInput: string,
  quoteInput: string,
  date: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 6_000,
): Promise<FxQuote> {
  const base = currencyCode(baseInput);
  const quote = currencyCode(quoteInput);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(referenceQuoteUrl(base, quote, date), {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`FX request failed (${response.status})`);
    return readQuote(await response.json(), base, quote);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The shortest decimal spelling of a positive finite rate as an exact
 * integer mantissa and power-of-ten scale: 3.6725 -> 36725 / 10^4. The
 * provider publishes decimal rates, and JavaScript's shortest round-trip
 * spelling reproduces them exactly, so no binary artefact enters the money.
 */
function decimalRate(rate: number): { digits: bigint; scale: number } {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid FX rate');
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/i.exec(String(rate));
  if (!match) throw new Error('Invalid FX rate');
  const fraction = match[2] ?? '';
  let scale = fraction.length - Number(match[3] ?? 0);
  let digits = BigInt(`${match[1]}${fraction}`);
  if (scale < 0) {
    digits *= 10n ** BigInt(-scale);
    scale = 0;
  }
  if (digits <= 0n) throw new Error('Invalid FX rate');
  return { digits, scale };
}

/**
 * Convert integer minor units of one currency into integer minor units of
 * another with ONE decimal half-up rounding, using exact integer arithmetic.
 *
 *   ledgerMinor = originalMinor × rate × 10^ledgerExp / 10^originalExp
 *
 * so KWD 12.345 (12345, exp 3) at 3.26 USD/KWD is USD 40.24 (4024, exp 2) and
 * JPY 1,500 (1500, exp 0) at 0.0068 USD/JPY is USD 10.20 (1020, exp 2).
 */
export function convertMinorUnits(
  originalMinor: number,
  originalExponent: MinorExponent,
  rate: number,
  ledgerExponent: MinorExponent,
): number {
  if (!Number.isSafeInteger(originalMinor) || originalMinor <= 0) {
    throw new Error('Invalid original amount');
  }
  if (![0, 2, 3].includes(originalExponent) || ![0, 2, 3].includes(ledgerExponent)) {
    throw new Error('Unsupported currency exponent');
  }
  const { digits, scale } = decimalRate(rate);
  const numerator = BigInt(originalMinor) * digits * 10n ** BigInt(ledgerExponent);
  const denominator = 10n ** BigInt(scale + originalExponent);
  const result = (numerator * 2n + denominator) / (denominator * 2n);
  if (result <= 0n || result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Converted amount out of range');
  }
  return Number(result);
}

/** Legacy two-decimal-to-two-decimal conversion (AED/SAR ledgers). */
export function convertOriginalMinorToLocalFils(originalMinor: number, rate: number): number {
  if (!Number.isSafeInteger(originalMinor) || originalMinor <= 0) {
    throw new Error('Invalid original amount');
  }
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid FX rate');
  // Both values use two decimal minor units, so they cancel: minor × rate.
  return Math.round(originalMinor * rate);
}

/** The original charge, in its own currency's exact minor units. */
export interface OriginalMoney {
  currency: string;
  minorUnits: number;
  exponent: MinorExponent;
}

/**
 * HOW A STORED ORIGINAL AMOUNT IS READ.
 *
 * Before exponent-correct originals, every foreign figure was stored in
 * `originalAmountMinor` as major × 100 whatever its currency: JPY 1,500 was
 * 150000 and KWD 12.345 was 1235 (third decimal lost). Those rows carry no
 * `originalExponent`, and that ABSENCE is the marker: they are read as two
 * decimals forever, exactly as they were written. No history is rewritten.
 *
 * New rows record `originalMinorUnits` + `originalExponent` in the currency's
 * own ISO exponent, and still write the legacy two-decimal field whenever the
 * value is exactly representable there (all two-decimal currencies, JPY, and
 * three-decimal amounts ending in 0). That keeps an older build, a restored
 * backup or a relay reader that only knows `originalAmountMinor` reading the
 * same money instead of misreading KWD 12.345 as KWD 123.45.
 */
export function originalMoneyOf(
  tx: Pick<Transaction, 'originalCurrency' | 'originalAmountMinor' | 'originalMinorUnits' | 'originalExponent'>,
): OriginalMoney | null {
  const currency = typeof tx.originalCurrency === 'string' ? tx.originalCurrency.toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  if (
    tx.originalExponent !== undefined &&
    (tx.originalExponent === 0 || tx.originalExponent === 2 || tx.originalExponent === 3) &&
    Number.isSafeInteger(tx.originalMinorUnits) && (tx.originalMinorUnits ?? 0) > 0
  ) {
    return { currency, minorUnits: tx.originalMinorUnits!, exponent: tx.originalExponent };
  }
  if (Number.isSafeInteger(tx.originalAmountMinor) && (tx.originalAmountMinor ?? 0) > 0) {
    return { currency, minorUnits: tx.originalAmountMinor!, exponent: 2 };
  }
  return null;
}

/** The persisted original fields for one exact foreign amount. */
export function originalMoneyFields(money: OriginalMoney): Pick<Transaction,
  'originalCurrency' | 'originalAmountMinor' | 'originalMinorUnits' | 'originalExponent'> {
  const currency = currencyCode(money.currency);
  if (!Number.isSafeInteger(money.minorUnits) || money.minorUnits <= 0 ||
    ![0, 2, 3].includes(money.exponent)) throw new Error('Invalid original amount');
  let legacy: number | undefined;
  if (money.exponent === 2) legacy = money.minorUnits;
  else if (money.exponent === 0) legacy = money.minorUnits * 100;
  else if (money.minorUnits % 10 === 0) legacy = money.minorUnits / 10;
  return {
    originalCurrency: currency,
    ...(legacy !== undefined && Number.isSafeInteger(legacy) ? { originalAmountMinor: legacy } : {}),
    originalMinorUnits: money.minorUnits,
    originalExponent: money.exponent,
  };
}

/**
 * Revalue only rows whose parser had to use its embedded offline fallback.
 * A bank-quoted local equivalent is authoritative and is never overwritten.
 *
 * Unique pair/day requests are bounded per pass so importing years of travel
 * does not turn one screen open into hundreds of network calls.
 */
export async function buildReferenceFxUpdates(
  transactions: Transaction[],
  localCurrency: string,
  load: FxQuoteLoader = fetchReferenceQuote,
  maxQuotes = 16,
  ledgerExponent: MinorExponent = 2,
): Promise<FxUpdate[]> {
  const quoteCurrency = currencyCode(localCurrency);
  const pending = transactions.flatMap((tx) => {
    if (tx.fxSource !== 'fallback') return [];
    const original = originalMoneyOf(tx);
    return original && original.currency !== quoteCurrency ? [{ tx, original }] : [];
  });
  const keys = [
    ...new Set(pending.map(({ tx, original }) => `${original.currency}|${isoDate(tx.date)}`)),
  ].slice(0, Math.max(0, maxQuotes));
  const quotes = await Promise.all(
    keys.map(async (key) => {
      const [base, date] = key.split('|');
      try {
        const quote = await load(base, quoteCurrency, date);
        return [key, isQuoteFor(quote, base, quoteCurrency) ? quote : null] as const;
      } catch {
        return [key, null] as const;
      }
    }),
  );
  const byKey = new Map(quotes);
  const updates: FxUpdate[] = [];
  for (const { tx, original } of pending) {
    const quote = byKey.get(`${original.currency}|${isoDate(tx.date)}`);
    if (!quote) continue;
    let amountFils: number;
    try {
      amountFils = convertMinorUnits(original.minorUnits, original.exponent, quote.rate, ledgerExponent);
    } catch {
      continue;
    }
    updates.push({
      id: tx.id,
      amountFils,
      fxRate: quote.rate,
      fxRateDate: quote.date,
      fxSource: 'reference',
    });
  }
  return updates;
}

/**
 * "USD 20.00", "JPY 1,500", "KWD 12.345": the code plus the amount in the
 * currency's own exponent, Latin digits in both languages like every other
 * figure in the app. `exponent` defaults to two for legacy rows.
 */
export function formatOriginalCurrency(
  amountMinor: number,
  currency: string,
  _language: 'en' | 'ar',
  exponent: MinorExponent = 2,
): string {
  const code = currencyCode(currency);
  const spec = { schemaVersion: 2, currency: code, exponent } as LedgerMoneySpec;
  return `${code} ${formatMinorUnits(amountMinor, spec, { decimals: true })}`;
}
