import type { Transaction } from '@/lib/types';

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

function currencyCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error('Invalid currency code');
  return code;
}

function isoDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid FX date');
  return value;
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

export function convertOriginalMinorToLocalFils(originalMinor: number, rate: number): number {
  if (!Number.isSafeInteger(originalMinor) || originalMinor <= 0) {
    throw new Error('Invalid original amount');
  }
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid FX rate');
  // Both values use two decimal minor units, so they cancel: minor × rate.
  return Math.round(originalMinor * rate);
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
): Promise<FxUpdate[]> {
  const quoteCurrency = currencyCode(localCurrency);
  const pending = transactions.filter(
    (tx) =>
      tx.fxSource === 'fallback' &&
      typeof tx.originalCurrency === 'string' &&
      tx.originalCurrency !== quoteCurrency &&
      Number.isSafeInteger(tx.originalAmountMinor) &&
      (tx.originalAmountMinor ?? 0) > 0,
  );
  const keys = [
    ...new Set(
      pending.map((tx) => `${currencyCode(tx.originalCurrency!)}|${isoDate(tx.date)}`),
    ),
  ].slice(0, Math.max(0, maxQuotes));
  const quotes = await Promise.all(
    keys.map(async (key) => {
      const [base, date] = key.split('|');
      try {
        return [key, await load(base, quoteCurrency, date)] as const;
      } catch {
        return [key, null] as const;
      }
    }),
  );
  const byKey = new Map(quotes);
  const updates: FxUpdate[] = [];
  for (const tx of pending) {
    const key = `${currencyCode(tx.originalCurrency!)}|${isoDate(tx.date)}`;
    const quote = byKey.get(key);
    if (!quote || tx.originalAmountMinor === undefined) continue;
    updates.push({
      id: tx.id,
      amountFils: convertOriginalMinorToLocalFils(tx.originalAmountMinor, quote.rate),
      fxRate: quote.rate,
      fxRateDate: quote.date,
      fxSource: 'reference',
    });
  }
  return updates;
}

export function formatOriginalCurrency(
  amountMinor: number,
  currency: string,
  language: 'en' | 'ar',
): string {
  return new Intl.NumberFormat(language === 'ar' ? 'ar-AE' : 'en-AE', {
    style: 'currency',
    currency: currencyCode(currency),
    currencyDisplay: 'code',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}
