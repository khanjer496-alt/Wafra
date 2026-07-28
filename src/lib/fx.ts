/**
 * Multi-currency money and live FX.
 *
 * The rest of the app says "fils" and means AED: an integer that is 1/100 of a
 * dirham. That shorthand is fine while every figure is AED, and it breaks the
 * moment a second currency appears, because 1/100 is not the minor unit of
 * every currency — the Kuwaiti dinar has 1000 fils to the dinar and the yen
 * has no subdivision at all. So everything here travels as a Money: an integer
 * in THAT currency's own minor units, carried together with its code. A bare
 * integer is meaningless without the code and must never be passed between the
 * two, which is why there is no `fromFils(n)` helper — the caller has to say
 * which currency it is holding.
 *
 * Nothing in this file imports Expo, React Native, or any other module: it is
 * transpiled and run under plain Node by scripts/test/fx.test.js, and the
 * network call is injected by the caller rather than made here, so the whole
 * conversion path stays testable without a device or a socket.
 */

/** ISO 4217 identity of a currency, plus how the app renders it. */
export interface Currency {
  code: string;
  /** Native symbol, for the compact UI. Lists and rows use the code instead. */
  symbol: string;
  /**
   * ISO 4217 minor-unit exponent: how many decimal places the currency has,
   * and therefore what one integer minor unit is worth. 2 for the dirham
   * (fils), 3 for the Gulf dinars, 0 for the yen. Getting this wrong is a
   * factor-of-1000 error on a KWD amount, not a rounding difference.
   */
  digits: 0 | 2 | 3;
  name: string;
}

function def(code: string, symbol: string, digits: 0 | 2 | 3, name: string): Currency {
  return { code, symbol, digits, name };
}

/**
 * The currencies a UAE resident actually meets: the whole GCC (all pegged to
 * the dollar, so conversions between them are exact), the region next door,
 * the majors that online subscriptions bill in, and the home currencies of
 * the country's largest expatriate communities — a remittance to Kerala or
 * Karachi is the single biggest line in many users' months.
 *
 * This set is a superset of the codes sms-parser.ts recognises in a message.
 * It has to be: the parser can hand us any code from its own table, and a
 * code that reaches conversion without a definition here is dropped rather
 * than assumed to be 2-decimal.
 */
export const CURRENCIES: Readonly<Record<string, Currency>> = Object.freeze({
  // GCC — every one of these is pegged to the dollar (see PEGGED_PER_USD).
  AED: def('AED', 'د.إ', 2, 'UAE Dirham'),
  SAR: def('SAR', 'ر.س', 2, 'Saudi Riyal'),
  QAR: def('QAR', 'ر.ق', 2, 'Qatari Riyal'),
  KWD: def('KWD', 'د.ك', 3, 'Kuwaiti Dinar'),
  BHD: def('BHD', 'د.ب', 3, 'Bahraini Dinar'),
  OMR: def('OMR', 'ر.ع', 3, 'Omani Rial'),
  // Wider region.
  JOD: def('JOD', 'د.ا', 3, 'Jordanian Dinar'),
  EGP: def('EGP', 'E£', 2, 'Egyptian Pound'),
  LBP: def('LBP', 'ل.ل', 2, 'Lebanese Pound'),
  TRY: def('TRY', '₺', 2, 'Turkish Lira'),
  // Majors.
  USD: def('USD', '$', 2, 'US Dollar'),
  EUR: def('EUR', '€', 2, 'Euro'),
  GBP: def('GBP', '£', 2, 'Pound Sterling'),
  CHF: def('CHF', 'CHF', 2, 'Swiss Franc'),
  CAD: def('CAD', 'C$', 2, 'Canadian Dollar'),
  AUD: def('AUD', 'A$', 2, 'Australian Dollar'),
  NZD: def('NZD', 'NZ$', 2, 'New Zealand Dollar'),
  JPY: def('JPY', '¥', 0, 'Japanese Yen'),
  CNY: def('CNY', '¥', 2, 'Chinese Yuan'),
  HKD: def('HKD', 'HK$', 2, 'Hong Kong Dollar'),
  SGD: def('SGD', 'S$', 2, 'Singapore Dollar'),
  // South Asia.
  INR: def('INR', '₹', 2, 'Indian Rupee'),
  PKR: def('PKR', '₨', 2, 'Pakistani Rupee'),
  LKR: def('LKR', 'Rs', 2, 'Sri Lankan Rupee'),
  BDT: def('BDT', '৳', 2, 'Bangladeshi Taka'),
  NPR: def('NPR', 'रू', 2, 'Nepalese Rupee'),
  // South-East and East Asia.
  PHP: def('PHP', '₱', 2, 'Philippine Peso'),
  IDR: def('IDR', 'Rp', 2, 'Indonesian Rupiah'),
  MYR: def('MYR', 'RM', 2, 'Malaysian Ringgit'),
  THB: def('THB', '฿', 2, 'Thai Baht'),
  KRW: def('KRW', '₩', 0, 'South Korean Won'),
  VND: def('VND', '₫', 0, 'Vietnamese Dong'),
  // Africa and elsewhere.
  ZAR: def('ZAR', 'R', 2, 'South African Rand'),
  KES: def('KES', 'KSh', 2, 'Kenyan Shilling'),
  NGN: def('NGN', '₦', 2, 'Nigerian Naira'),
  MAD: def('MAD', 'د.م', 2, 'Moroccan Dirham'),
  RUB: def('RUB', '₽', 2, 'Russian Ruble'),
});

export const SUPPORTED_CODES: string[] = Object.keys(CURRENCIES);

/** The currency definition for a code, or null when we don't carry it. */
export function getCurrency(code: string): Currency | null {
  return CURRENCIES[code?.toUpperCase?.() ?? ''] ?? null;
}

export function isSupported(code: string): boolean {
  return getCurrency(code) !== null;
}

/** An amount in `code`'s own minor units. Always an integer; may be negative. */
export interface Money {
  code: string;
  minor: number;
}

export function money(code: string, minor: number): Money {
  return { code: code.toUpperCase(), minor: Math.round(minor) };
}

// ── rounding ───────────────────────────────────────────────────────────────

/**
 * Half away from zero, the rule banks settle on.
 *
 * Two properties matter more than the third decimal place. First, the result
 * depends only on the magnitude, so a refund converts to exactly the amount
 * the original charge converted to and the pair nets to zero — with half-even
 * or half-up, a −0.005 and a +0.005 round to magnitudes that differ by one
 * minor unit and leave a phantom fil behind forever. Second, it agrees with
 * what the UAE banks print: USD 42.00 at the peg is 154.245 dirhams and every
 * statement calls that AED 154.25.
 *
 * The epsilon exists because binary floating point cannot hold most decimal
 * products exactly: 1.005 × 100 evaluates to 100.49999999999999, and rounding
 * that on its face gives 100 for a number that is 100.5 in decimal. Anything
 * within a nanounit of the .5 boundary is treated as being on it.
 */
function roundMinor(value: number): number {
  if (!Number.isFinite(value)) return NaN;
  const abs = Math.abs(value);
  const whole = Math.floor(abs);
  const rounded = abs - whole >= 0.5 - 1e-9 ? whole + 1 : whole;
  return value < 0 ? -rounded : rounded;
}

function pow10(digits: number): number {
  return digits === 0 ? 1 : digits === 2 ? 100 : 1000;
}

/** Decimal places of a currency; unknown codes are refused, never defaulted. */
export function minorDigits(code: string): number | null {
  return getCurrency(code)?.digits ?? null;
}

/** 42.00 → 4200 for AED, → 42000 for KWD, → 42 for JPY. */
export function toMinor(major: number, code: string): number | null {
  const c = getCurrency(code);
  if (!c || !Number.isFinite(major)) return null;
  return roundMinor(major * pow10(c.digits));
}

/** The inverse of toMinor. Lossy by nature — for display and arithmetic only. */
export function toMajor(minor: number, code: string): number | null {
  const c = getCurrency(code);
  if (!c) return null;
  return minor / pow10(c.digits);
}

/**
 * User-typed text to Money. Mirrors parseAmountToFils in format.ts (strip
 * everything that isn't a digit, a dot or a leading minus) but honours the
 * currency's own exponent, so "12.345" is 12345 minor units of KWD and 1235
 * of AED.
 */
export function parseMoney(text: string, code: string): Money | null {
  if (!getCurrency(code)) return null;
  const negative = /^\s*-/.test(text);
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  const minor = toMinor(negative ? -value : value, code);
  return minor === null ? null : { code: code.toUpperCase(), minor };
}

function groupThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * "AED 1,234.56", "KWD 1.234", "JPY 1,500".
 *
 * format.ts cannot do this: formatAmount hard-codes /100 and a two-digit
 * remainder, which is right for the dirham and silently wrong for every
 * three-decimal and zero-decimal currency. Rather than widen a function the
 * whole app depends on, foreign amounts render here and AED keeps using
 * formatAED — the two agree digit for digit on 2-decimal currencies.
 *
 * This is the one place an unknown code is tolerated rather than refused: it
 * falls back to two decimals and prints the code as given. Arithmetic on a
 * currency we can't define is a bug and returns null everywhere else, but a
 * render path that throws takes a screen down over a label.
 */
export function formatMoney(
  amount: Money,
  opts?: { decimals?: boolean; symbol?: boolean; prefix?: boolean },
): string {
  const c = getCurrency(amount.code);
  const digits = c?.digits ?? 2;
  const unit = pow10(digits);
  const abs = Math.abs(Math.round(amount.minor));
  const whole = Math.floor(abs / unit);
  const fraction = abs % unit;
  const showDecimals = digits > 0 && (opts?.decimals ?? fraction !== 0);
  const sign = amount.minor < 0 ? '-' : '';
  const body = `${sign}${groupThousands(whole)}${
    showDecimals ? `.${String(fraction).padStart(digits, '0')}` : ''
  }`;
  if (opts?.prefix === false) return body;
  return `${opts?.symbol && c ? c.symbol : amount.code} ${body}`;
}

// ── rates ──────────────────────────────────────────────────────────────────

/**
 * Every table in this module is quoted as units per 1 US dollar, and cross
 * rates are derived from it. The base is the dollar and not the dirham for
 * two reasons: every free rate feed publishes USD-based tables, and the whole
 * GCC is pegged to the dollar, so a AED↔SAR or AED↔OMR conversion resolves
 * through two exact constants instead of round-tripping through a floating
 * quote that drifts by the day.
 *
 * This mirrors UNITS_PER_USD in sms-parser.ts, which the parser uses to
 * rescue a foreign-currency-only message. That table is deliberately a frozen
 * approximation compiled into the parser — the parser must work with no
 * network and no state — while this one is refreshed. Both are USD-based and
 * both agree on the pegs, so a message the parser converted and the same
 * amount converted here can never disagree by more than one feed's drift.
 */
export const FX_BASE = 'USD';

/**
 * Currencies whose dollar rate is set by law, not by a market.
 *
 * The dirham has been pegged at 3.6725 to the dollar by the UAE Central Bank
 * since 1997 and the riyal at 3.75 since 1986. These are the reason the app
 * can promise a correct AED figure with the radio off: a pegged pair needs no
 * feed, never expires, and is not allowed to be overwritten by whatever a
 * free endpoint happens to print for it — a provider that returns 3.68 for
 * the dirham is wrong, and taking its word would put a 0.07% error into every
 * dollar purchase in the app.
 */
export const PEGGED_PER_USD: Readonly<Record<string, number>> = Object.freeze({
  AED: 3.6725,
  SAR: 3.75,
  QAR: 3.64,
  OMR: 0.3845,
  BHD: 0.376,
  JOD: 0.709,
  USD: 1,
});

/** The dirham peg, named because half the app's arithmetic ends here. */
export const AED_PER_USD = PEGGED_PER_USD.AED;

export function isPegged(code: string): boolean {
  return code.toUpperCase() in PEGGED_PER_USD;
}

export type RateOrigin = 'seed' | 'network' | 'peg';

export interface RateTable {
  /** Always FX_BASE. Present so a stored table can be validated on read. */
  base: string;
  /** Units of each currency per 1 unit of base. */
  rates: Readonly<Record<string, number>>;
  /**
   * When the PROVIDER published these, in epoch ms — not when we fetched
   * them. A daily feed fetched five minutes ago can still be twenty hours
   * old, and staleness is a property of the numbers, not of the download.
   */
  asOf: number;
  origin: RateOrigin;
}

/**
 * The table with no feed behind it: the pegs alone, timestamped at zero.
 * Conversions inside the GCC and to or from the dollar work off this table
 * forever, which is the floor the offline path degrades to.
 */
export const PEG_TABLE: RateTable = Object.freeze({
  base: FX_BASE,
  rates: PEGGED_PER_USD,
  asOf: 0,
  origin: 'peg' as const,
});

/**
 * Build-time snapshot, shipped so the first launch converts something sane
 * before any network call. It is stale the day it ships — that is fine and
 * expected, and it is exactly why a quote carries where its rate came from.
 */
export const SEED_RATES: RateTable = Object.freeze({
  base: FX_BASE,
  origin: 'seed' as const,
  asOf: Date.UTC(2026, 6, 28),
  rates: Object.freeze({
    ...PEGGED_PER_USD,
    KWD: 0.309929,
    EGP: 50.716815,
    LBP: 89500,
    TRY: 47.366122,
    EUR: 0.878802,
    GBP: 0.751907,
    CHF: 0.818475,
    CAD: 1.411472,
    AUD: 1.430712,
    NZD: 1.731131,
    JPY: 163.722491,
    CNY: 6.774553,
    HKD: 7.841757,
    SGD: 1.291024,
    INR: 95.938043,
    PKR: 277.859092,
    LKR: 335.955163,
    BDT: 123.444652,
    NPR: 153.49532,
    PHP: 61.738893,
    IDR: 18067.504285,
    MYR: 4.085367,
    THB: 33.623749,
    KRW: 1467.334302,
    VND: 26235.491408,
    ZAR: 16.756548,
    KES: 129.489677,
    NGN: 1364.031772,
    MAD: 9.366234,
    RUB: 77.98517,
  }),
});

/**
 * How old a floating rate may be before the UI has to say so. The free feeds
 * publish once a day; 36 hours allows one missed publish without crying wolf
 * about a rate that is still perfectly good.
 */
export const RATE_FRESH_MS = 36 * 60 * 60 * 1000;

export function rateAgeMs(table: RateTable, now = Date.now()): number {
  return Math.max(0, now - table.asOf);
}

/** True when the table's floating rates are past the freshness window. */
export function isStale(table: RateTable, now = Date.now()): boolean {
  return rateAgeMs(table, now) > RATE_FRESH_MS;
}

/** Whether a refresh is worth attempting — call before spending a request. */
export function shouldRefresh(table: RateTable, now = Date.now()): boolean {
  return isStale(table, now);
}

export interface RateQuote {
  from: string;
  to: string;
  /** Units of `to` per 1 unit of `from`, in MAJOR units. */
  rate: number;
  /**
   * Where the number came from. 'peg' is a legal constant and never ages;
   * 'live' is inside the freshness window; 'stale' is older than that and the
   * UI is expected to label it ("rate from 3 days ago").
   *
   * There is no way to get a converted amount out of this module without also
   * getting this field, which is the whole point: an amount can be wrong, but
   * it can never be wrong SILENTLY.
   */
  basis: 'peg' | 'live' | 'stale';
  /** Publish time of the table the rate came from; 0 for a peg. */
  asOf: number;
  ageMs: number;
}

function pegQuote(from: string, to: string, rate: number): RateQuote {
  return { from, to, rate, basis: 'peg', asOf: 0, ageMs: 0 };
}

/**
 * The rate to turn `from` into `to`, or null when either code is unknown to
 * us or missing from the table.
 *
 * A pair that is pegged on both legs is answered from the constants and never
 * touches the table, so AED→USD, AED→SAR and OMR→BHD keep working with an
 * empty cache, a year-old cache, or no network since install.
 */
export function rateFor(
  from: string,
  to: string,
  table: RateTable = SEED_RATES,
  now = Date.now(),
): RateQuote | null {
  const a = from?.toUpperCase?.();
  const b = to?.toUpperCase?.();
  if (!a || !b || !isSupported(a) || !isSupported(b)) return null;
  if (a === b) return pegQuote(a, b, 1);
  if (a in PEGGED_PER_USD && b in PEGGED_PER_USD) {
    return pegQuote(a, b, PEGGED_PER_USD[b] / PEGGED_PER_USD[a]);
  }
  if (table.base !== FX_BASE) return null;
  const perA = a in PEGGED_PER_USD ? PEGGED_PER_USD[a] : table.rates[a];
  const perB = b in PEGGED_PER_USD ? PEGGED_PER_USD[b] : table.rates[b];
  if (!isUsableRate(perA) || !isUsableRate(perB)) return null;
  const age = rateAgeMs(table, now);
  return {
    from: a,
    to: b,
    rate: perB / perA,
    basis: age > RATE_FRESH_MS ? 'stale' : 'live',
    asOf: table.asOf,
    ageMs: age,
  };
}

export interface Conversion {
  /** The result, in `to`'s own minor units. */
  amount: Money;
  /** The original, unchanged — handy for "USD 42.00 ≈ AED 154.25" rows. */
  from: Money;
  quote: RateQuote;
}

/**
 * Convert between currencies in integer minor units.
 *
 * The two exponents are part of the arithmetic, not an afterthought: a KWD
 * minor unit is a thousandth and an AED minor unit a hundredth, so the ratio
 * of the exponents rides along with the rate. Doing this in major units and
 * converting to minor at the end would round twice.
 *
 * Returns null when the pair cannot be quoted at all. Callers must handle it
 * — showing the original foreign amount untouched is always better than
 * showing a converted figure nobody can stand behind.
 */
export function convert(
  amount: Money,
  to: string,
  table: RateTable = SEED_RATES,
  now = Date.now(),
): Conversion | null {
  const quote = rateFor(amount.code, to, table, now);
  const fromDigits = minorDigits(amount.code);
  const toDigits = minorDigits(to);
  if (!quote || fromDigits === null || toDigits === null) return null;
  if (!Number.isFinite(amount.minor)) return null;
  const scaled = amount.minor * quote.rate * (pow10(toDigits) / pow10(fromDigits));
  const minor = roundMinor(scaled);
  if (!Number.isFinite(minor)) return null;
  return { amount: { code: quote.to, minor }, from: amount, quote };
}

/** convert() when the caller only wants the number and already knows the pair. */
export function convertMinor(
  minor: number,
  from: string,
  to: string,
  table: RateTable = SEED_RATES,
  now = Date.now(),
): number | null {
  return convert({ code: from, minor }, to, table, now)?.amount.minor ?? null;
}

// ── merging a fetched table into the cached one ────────────────────────────

function isUsableRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Pure reducer: fold a freshly fetched table into the cached one.
 *
 * The rules, and what each is defending against:
 * - An older or equal `asOf` is ignored outright. Two refreshes can land out
 *   of order (a retry that overtakes the request it retried), and letting the
 *   loser win would walk the cache backwards.
 * - Codes we don't carry are dropped. The feed publishes ~160 of them plus,
 *   on some endpoints, several hundred crypto tickers; storing all of that
 *   would bloat every state write for currencies no screen can select.
 * - Non-numeric, zero, negative and non-finite values are dropped rather than
 *   allowed to poison a conversion. `null` for a suspended currency is a real
 *   thing feeds do.
 * - A code missing from the incoming set keeps its cached value. The feeds
 *   publish every code at once, so a gap means a provider hiccup on that one
 *   currency, and a value one publish cycle old beats no value at all.
 * - The pegs are re-asserted last and always win. See PEGGED_PER_USD.
 */
export function mergeRateTable(cached: RateTable | null, incoming: RateTable | null): RateTable {
  const base = cached && cached.base === FX_BASE ? cached : SEED_RATES;
  if (!incoming || incoming.base !== FX_BASE || !Number.isFinite(incoming.asOf)) return base;
  if (incoming.asOf <= base.asOf) return base;

  const merged: Record<string, number> = { ...base.rates };
  let accepted = 0;
  for (const code of SUPPORTED_CODES) {
    const value = incoming.rates[code];
    if (!isUsableRate(value)) continue;
    merged[code] = value;
    accepted++;
  }
  // A response that carried nothing we understand is not a newer table, it is
  // a broken one — keeping its timestamp would mark the cache fresh while its
  // numbers stayed exactly as old as before.
  if (accepted === 0) return base;
  Object.assign(merged, PEGGED_PER_USD);
  return { base: FX_BASE, rates: merged, asOf: incoming.asOf, origin: incoming.origin };
}

// ── the feed ───────────────────────────────────────────────────────────────

/**
 * open.er-api.com, the free tier of exchangerate-api.com: no API key, no
 * registration, no per-key rate limit to leak into the binary, CORS-open, and
 * — the reason it beats the ECB-backed alternatives like Frankfurter — it
 * publishes AED, SAR, PKR, EGP and the rest of the GCC. The ECB set has about
 * thirty currencies and no dirham at all, which makes it useless here.
 *
 * It publishes once a day, which is why RATE_FRESH_MS is measured in hours
 * rather than minutes, and it needs no key so nothing secret ships in the app.
 */
export const FX_ENDPOINT = 'https://open.er-api.com/v6/latest/USD';

/**
 * The injected fetcher. The caller owns the network — it supplies something
 * that resolves to parsed JSON and rejects or throws on any failure — so this
 * module stays a pure function of its inputs and the tests need no sockets.
 */
export type FxFetcher = (url: string) => Promise<unknown>;

function ratesFromRecord(raw: Record<string, unknown>): Record<string, number> {
  const rates: Record<string, number> = {};
  for (const code of SUPPORTED_CODES) {
    const value = raw[code] ?? raw[code.toLowerCase()];
    if (isUsableRate(value)) rates[code] = value;
  }
  return rates;
}

/**
 * Read a provider payload into a RateTable, or null if it isn't one.
 *
 * Two shapes are understood: the open.er-api.com envelope, and the
 * jsDelivr-hosted currency-api shape ({ date, usd: { aed: 3.6725, ... } })
 * which is the obvious drop-in if the primary endpoint ever dies. Supporting
 * both here means switching feeds is a one-line change to FX_ENDPOINT with no
 * new parsing code and no new tests.
 *
 * `receivedAt` is only a fallback for a payload that carries no publish time.
 * Dating an undated response "now" is a small lie, but marking it 1970 would
 * flag a genuinely fresh table as stale forever.
 */
export function parseRateResponse(payload: unknown, receivedAt = Date.now()): RateTable | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as Record<string, unknown>;

  if (body.result === 'error') return null;

  // open.er-api.com
  if (body.rates && typeof body.rates === 'object') {
    if (typeof body.base_code === 'string' && body.base_code.toUpperCase() !== FX_BASE) return null;
    const rates = ratesFromRecord(body.rates as Record<string, unknown>);
    if (Object.keys(rates).length === 0) return null;
    const published = body.time_last_update_unix;
    const asOf = typeof published === 'number' && published > 0 ? published * 1000 : receivedAt;
    return { base: FX_BASE, rates, asOf, origin: 'network' };
  }

  // currency-api: the base currency is the key, lowercased.
  const nested = body.usd;
  if (nested && typeof nested === 'object') {
    const rates = ratesFromRecord(nested as Record<string, unknown>);
    if (Object.keys(rates).length === 0) return null;
    const date = typeof body.date === 'string' ? Date.parse(`${body.date}T00:00:00Z`) : NaN;
    return {
      base: FX_BASE,
      rates,
      asOf: Number.isFinite(date) ? date : receivedAt,
      origin: 'network',
    };
  }

  return null;
}

/**
 * Refresh the cached table. NEVER throws and never returns null.
 *
 * Offline, rate-limited, DNS-poisoned, HTML error page instead of JSON, a
 * payload with every rate set to null — every one of those paths returns the
 * cached table byte for byte, and the caller stores what it gets back with no
 * error handling of its own. Degradation is: live table → cached table →
 * seed table → the pegs, and the pegs alone still convert every GCC and
 * dollar pair correctly. There is no branch that ends in a crash and none
 * that ends in a rate we can't account for.
 */
export async function fetchRateTable(
  fetchJson: FxFetcher,
  cached: RateTable | null = SEED_RATES,
  now = Date.now(),
): Promise<RateTable> {
  const base = cached && cached.base === FX_BASE ? cached : SEED_RATES;
  try {
    const payload = await fetchJson(FX_ENDPOINT);
    return mergeRateTable(base, parseRateResponse(payload, now));
  } catch {
    // Deliberately silent: a failed refresh is the expected state on a phone,
    // not an incident, and the previous table is still serving.
    return base;
  }
}

// ── what the bank actually charged ─────────────────────────────────────────

/**
 * The rate implied by a bank message that carries both legs.
 *
 * UAE cards routinely narrate the purchase and its settlement in one SMS —
 * "USD 42.00 ... AED 154.25". sms-parser.ts keeps only the local leg (a local
 * amount anywhere in the message always beats a converted foreign one) and
 * discards the foreign figure, so the pair never reaches storage today. When
 * a later change does keep it, this turns the two into the rate the bank
 * really used, which includes its markup and its scheme fee — a number no
 * mid-market feed can tell the user and the only one that answers "what did
 * that card actually cost me".
 */
export function impliedRate(foreign: Money, settled: Money): number | null {
  const from = toMajor(foreign.minor, foreign.code);
  const to = toMajor(settled.minor, settled.code);
  if (from === null || to === null || from === 0) return null;
  const rate = to / from;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export interface FxMarkup {
  /** What the bank charged, in `settled` units per `foreign` unit. */
  impliedRate: number;
  /** What the pair was worth at mid-market. */
  midRate: number;
  /** Percent above mid-market; negative if the bank beat the market. */
  markupPct: number;
  /** Basis of the mid-market side, so a stale comparison can be labelled. */
  basis: RateQuote['basis'];
}

/** How far above the mid-market rate a settled foreign purchase landed. */
export function fxMarkup(
  foreign: Money,
  settled: Money,
  table: RateTable = SEED_RATES,
  now = Date.now(),
): FxMarkup | null {
  const implied = impliedRate(foreign, settled);
  const quote = rateFor(foreign.code, settled.code, table, now);
  if (implied === null || !quote || quote.rate <= 0) return null;
  return {
    impliedRate: implied,
    midRate: quote.rate,
    markupPct: ((implied - quote.rate) / quote.rate) * 100,
    basis: quote.basis,
  };
}
