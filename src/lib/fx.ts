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
  // Wider region. The three-decimal dinars are listed even though the seed
  // carries no rate for them: an exponent is a fact about the currency and is
  // needed the moment an amount is rendered, while a rate is a fact about
  // today and can arrive with the first refresh. Leaving them out did not make
  // them unreachable — formatMoney tolerates an unknown code — it made
  // formatMoney print millimes as if they were hundredths, a factor of ten.
  JOD: def('JOD', 'د.ا', 3, 'Jordanian Dinar'),
  TND: def('TND', 'د.ت', 3, 'Tunisian Dinar'),
  LYD: def('LYD', 'ل.د', 3, 'Libyan Dinar'),
  IQD: def('IQD', 'ع.د', 3, 'Iraqi Dinar'),
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

/** Digits plus the separators a human, a locale or a bank PDF puts between them. */
const NUMBER_BODY = /^(?:\d[\d,\u0020\u00a0\u2009\u202f']*)?(?:\.\d*)?$/;

/**
 * Text to Money, honouring the currency's own exponent, so "12.345" is 12345
 * minor units of KWD and 1235 of AED.
 *
 * Unlike parseAmountToFils in format.ts this accepts negatives, and that is
 * the whole reason it cannot reuse format.ts's approach of scrubbing
 * everything that is not a digit or a dot and testing the sign with /^\s*-/.
 * The scrub deletes the minus, so the sign has to be read before it and from
 * the right side of the number: the minus in "AED -500" — which is exactly
 * what formatMoney prints for a refund — is not the first non-space
 * character, so the anchored test missed it and the function returned a
 * positive 500. A parse that cannot read back its own formatter's output
 * turns every refund into a charge, silently and with no null to catch.
 *
 * The sign is therefore anything ahead of the digits (a currency code or
 * symbol may sit in between) or a wrapping pair of parentheses, which is how
 * every accounting export and every bank PDF writes a credit. U+2212, the
 * real minus sign, arrives whenever a figure is copied out of a statement.
 *
 * What follows the first digit must be a plain decimal number. The old scrub
 * turned "1e3" into "13" and answered AED 13, and "1.2.3" into a NaN that at
 * least failed loudly; anything we cannot read as one number is now null.
 */
export function parseMoney(text: string, code: string): Money | null {
  if (!getCurrency(code) || typeof text !== 'string') return null;
  const trimmed = text.trim();
  const wrapped = trimmed.length > 2 && trimmed.startsWith('(') && trimmed.endsWith(')');
  const body = wrapped ? trimmed.slice(1, -1) : trimmed;
  // The number starts at its first digit, or at the dot of a bare ".5".
  const start = body.search(/\d|\.\d/);
  if (start < 0) return null;
  const digits = body.slice(start);
  if (!NUMBER_BODY.test(digits) || !/\d/.test(digits)) return null;
  const negative = wrapped || /[-−]/.test(body.slice(0, start));
  const value = Number(digits.replace(/[^0-9.]/g, ''));
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
 * This is the one place an unknown code is tolerated rather than refused,
 * because a render path that throws takes a screen down over a label. What it
 * must NOT do is guess the exponent. Assuming two decimals printed TND 1234
 * millimes as "TND 12.34" when the amount is TND 1.234 — a factor of ten, in
 * the one function that was allowed to be lenient, on exactly the codes most
 * likely to be missing: the three-decimal dinars of the region. An exponent we
 * do not know cannot be defaulted, so the integer is printed unscaled and said
 * to be unscaled. Ugly on a screen, and impossible to read as an amount it is
 * not.
 */
export function formatMoney(
  amount: Money,
  opts?: { decimals?: boolean; symbol?: boolean; prefix?: boolean },
): string {
  const c = getCurrency(amount.code);
  if (!c) {
    const raw = Math.round(amount.minor);
    const bare = `${raw < 0 ? '-' : ''}${groupThousands(Math.abs(raw))} (minor units)`;
    return opts?.prefix === false ? bare : `${amount.code} ${bare}`;
  }
  const digits = c.digits;
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
  return `${opts?.symbol ? c.symbol : amount.code} ${body}`;
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
   * When the PROVIDER published the NEWEST of these, in epoch ms — not when
   * we fetched them. A daily feed fetched five minutes ago can still be
   * twenty hours old, and staleness is a property of the numbers, not of the
   * download.
   *
   * This is a table-level figure and answers exactly one question: is another
   * request worth making (see shouldRefresh). It is NOT the age of any given
   * rate, because a merge keeps a code the feed omitted — see asOfByCode.
   */
  asOf: number;
  /**
   * Publish time per code, for the rates that did not all arrive together.
   *
   * A merge carries forward any code the response omitted or sent as null,
   * which is right — a value one publish cycle old beats no value at all —
   * but it means the table's own asOf describes only the codes that were
   * actually refreshed. Without this map a currency the feed quietly stopped
   * publishing (a suspended one really does come back null, and LBP has been
   * exactly that) kept its number forever while every quote built from it
   * claimed to be seconds old and 'live', which is the one thing this module
   * promises never to do.
   *
   * Optional because a table persisted by an older build, or hand-built in a
   * test, has none; those fall back to the table's asOf, which is the old
   * behaviour and no worse than it was.
   */
  asOfByCode?: Readonly<Record<string, number>>;
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

/**
 * How far ahead of the device clock a publish time may sit before we stop
 * believing it. A phone's clock and a provider's differ by seconds; a day of
 * slack covers a wrong time zone and a user who set the date by hand. Past
 * that, one side is broken and the timestamp cannot order anything.
 */
export const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * Distance in time from a publish stamp, in either direction.
 *
 * The absolute value is the point. Clamping a future timestamp to age 0 —
 * `Math.max(0, now - asOf)` — reported a rate stamped with the year 58540 as
 * zero milliseconds old, so it was 'live', never stale, and shouldRefresh
 * said no forever: one provider emitting milliseconds in a field documented
 * as seconds stopped the app fetching for good. A number we cannot place in
 * time is not fresh, it is unmeasurable, and the only safe reading of a
 * distance is how far it is from now whichever side it falls.
 */
function ageOf(asOf: unknown, now: number): number {
  if (typeof asOf !== 'number' || !Number.isFinite(asOf)) return Number.MAX_SAFE_INTEGER;
  return Math.abs(now - asOf);
}

export function rateAgeMs(table: RateTable, now = Date.now()): number {
  return ageOf(table?.asOf, now);
}

/** True when the table's freshest floating rate is past the freshness window. */
export function isStale(table: RateTable, now = Date.now()): boolean {
  return rateAgeMs(table, now) > RATE_FRESH_MS;
}

/**
 * Whether a refresh is worth attempting — call before spending a request.
 *
 * Deliberately asks about the table and not about any one rate: a code the
 * feed has stopped publishing stays old no matter how often we fetch, and
 * refreshing on its account would burn a request every call forever. Age per
 * rate is a labelling question and lives in rateFor.
 */
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
  /**
   * Publish time of the OLDEST leg the rate was built from; 0 for a peg. A
   * cross rate is only as current as its stalest half, so this is the figure
   * a "rate from 3 days ago" label has to quote.
   */
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
 *
 * `table` is treated as hostile: it comes off disk, and a truncated write
 * leaves an object with no `rates` at all. This function is called on render
 * paths, so it returns null rather than throwing.
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
  if (!isRateTable(table)) return null;
  const perA = a in PEGGED_PER_USD ? PEGGED_PER_USD[a] : table.rates[a];
  const perB = b in PEGGED_PER_USD ? PEGGED_PER_USD[b] : table.rates[b];
  if (!isUsableRate(perA) || !isUsableRate(perB)) return null;
  // Each floating leg carries its own publish time and the pair inherits the
  // worse of the two; a pegged leg is a legal constant and contributes none.
  // At least one leg is floating here — both-pegged returned above.
  const asOf = Math.min(
    a in PEGGED_PER_USD ? Infinity : rateAsOf(table, a),
    b in PEGGED_PER_USD ? Infinity : rateAsOf(table, b),
  );
  const age = ageOf(asOf, now);
  return {
    from: a,
    to: b,
    rate: perB / perA,
    basis: age > RATE_FRESH_MS ? 'stale' : 'live',
    asOf,
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
 * Is this actually a table, or the wreckage of one?
 *
 * Every table in this module has been through AsyncStorage, and a write that
 * was interrupted comes back as a shape that satisfies the type and nothing
 * else. Checking only `base` — which is what every function here used to do —
 * let a table with no `rates` at all travel: `{ ...undefined }` is silently
 * `{}`, so the merge laundered the corruption instead of falling back to the
 * seed, and rateFor read `.rates[a]` off undefined and threw. Pegged pairs
 * still answered from the constants, so the crash only ever fired on foreign
 * currencies and read as intermittent. `asOf` is deliberately not required
 * here: a table whose timestamp is unreadable still has usable numbers and is
 * quoted as stale rather than withheld.
 */
function isRateTable(value: RateTable | null | undefined): value is RateTable {
  return (
    !!value &&
    value.base === FX_BASE &&
    !!value.rates &&
    typeof value.rates === 'object'
  );
}

/** When THIS code was last published, falling back to the table's own stamp. */
function rateAsOf(table: RateTable, code: string): number {
  const stamp = table.asOfByCode?.[code];
  const asOf = typeof stamp === 'number' && Number.isFinite(stamp) ? stamp : table.asOf;
  return Number.isFinite(asOf) ? asOf : 0;
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
 * - A code missing from the incoming set keeps its cached value AND the
 *   publish time it was last seen with. The feeds publish every code at once,
 *   so a gap means a provider hiccup on that one currency and a value one
 *   cycle old beats no value at all — but only the codes that actually
 *   arrived may claim the new timestamp. Copying it onto the whole map is how
 *   a suspended currency ended up months old and labelled 'live'.
 * - A cached timestamp in the future cannot order anything, so it does not
 *   get to veto the response. Without that, one bad publish time was
 *   permanent: nothing newer could ever beat the year 58540, and the table
 *   was persisted, so it survived restarts.
 * - The pegs are re-asserted last and always win. See PEGGED_PER_USD.
 */
export function mergeRateTable(
  cached: RateTable | null,
  incoming: RateTable | null,
  now = Date.now(),
): RateTable {
  const base = isRateTable(cached) ? cached : SEED_RATES;
  if (!isRateTable(incoming) || !Number.isFinite(incoming.asOf)) return base;
  const ordered = Number.isFinite(base.asOf) && base.asOf <= now + MAX_FUTURE_SKEW_MS;
  if (ordered && incoming.asOf <= base.asOf) return base;

  const merged: Record<string, number> = { ...base.rates };
  const stamps: Record<string, number> = {};
  for (const code of Object.keys(merged)) stamps[code] = rateAsOf(base, code);
  let accepted = 0;
  for (const code of SUPPORTED_CODES) {
    const value = incoming.rates[code];
    if (!isUsableRate(value)) continue;
    merged[code] = value;
    stamps[code] = incoming.asOf;
    accepted++;
  }
  // A response that carried nothing we understand is not a newer table, it is
  // a broken one — keeping its timestamp would mark the cache fresh while its
  // numbers stayed exactly as old as before.
  if (accepted === 0) return base;
  // The pegs are constants, not observations: their entries in the stamp map
  // exist only so the map covers the table, and rateFor never reads them
  // because it answers a pegged leg from PEGGED_PER_USD directly.
  Object.assign(merged, PEGGED_PER_USD);
  return {
    base: FX_BASE,
    rates: merged,
    asOfByCode: stamps,
    asOf: incoming.asOf,
    origin: incoming.origin,
  };
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
 * `receivedAt` is only a fallback for a payload that carries no publish time,
 * or one whose publish time cannot be true. Dating an undated response "now"
 * is a small lie, but marking it 1970 would flag a genuinely fresh table as
 * stale forever.
 */
function publishedAtMs(value: unknown, receivedAt: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return receivedAt;
  const believable = receivedAt + MAX_FUTURE_SKEW_MS;
  const asSeconds = value * 1000;
  if (asSeconds <= believable) return asSeconds;
  // A feed emitting milliseconds in a field documented as seconds is a common
  // enough bug to be worth reading rather than discarding: 1785196951000 is a
  // fine timestamp, it is just already in milliseconds. Multiplying it again
  // put the table in the year 58540, and a single one of those poisoned the
  // cache permanently — see mergeRateTable and ageOf.
  if (value <= believable) return value;
  // Neither reading lands in a time that has happened. We know when it
  // arrived and nothing else, so say that and let it age from here.
  return receivedAt;
}
export function parseRateResponse(payload: unknown, receivedAt = Date.now()): RateTable | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as Record<string, unknown>;

  if (body.result === 'error') return null;

  // open.er-api.com
  if (body.rates && typeof body.rates === 'object') {
    if (typeof body.base_code === 'string' && body.base_code.toUpperCase() !== FX_BASE) return null;
    const rates = ratesFromRecord(body.rates as Record<string, unknown>);
    if (Object.keys(rates).length === 0) return null;
    return {
      base: FX_BASE,
      rates,
      asOf: publishedAtMs(body.time_last_update_unix, receivedAt),
      origin: 'network',
    };
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
      // NaN fails the comparison too, so an unparseable date lands on
      // receivedAt exactly like a date that has not happened yet.
      asOf: date <= receivedAt + MAX_FUTURE_SKEW_MS ? date : receivedAt,
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
 *
 * A cached table that is not one — a half-written record with no `rates` — is
 * not a cache, it is damage, and it degrades to the seed here rather than
 * being handed back to the caller to be persisted again.
 */
export async function fetchRateTable(
  fetchJson: FxFetcher,
  cached: RateTable | null = SEED_RATES,
  now = Date.now(),
): Promise<RateTable> {
  const base = isRateTable(cached) ? cached : SEED_RATES;
  try {
    const payload = await fetchJson(FX_ENDPOINT);
    return mergeRateTable(base, parseRateResponse(payload, now), now);
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
