import { currencyMinorUnits, type CurrencyCode } from '@/lib/currency-metadata';

export const LEDGER_MONEY_SCHEMA_VERSION = 2 as const;
export type LedgerExponent = 0 | 2 | 3;

export interface LedgerMoneySpec {
  schemaVersion: typeof LEDGER_MONEY_SCHEMA_VERSION;
  currency: CurrencyCode;
  exponent: LedgerExponent;
}

interface LegacyMoneyState {
  marketId?: unknown;
  ledgerMoney?: unknown;
  accounts?: unknown[];
  transactions?: unknown[];
  budgets?: unknown[];
  bills?: unknown[];
  cardDues?: unknown[];
  goals?: unknown[];
}

const supportedExponent = (value: number | null): value is LedgerExponent =>
  value === 0 || value === 2 || value === 3;

export const ledgerMoneySpec = (currency: string): LedgerMoneySpec | null => {
  const code = currency.trim().toUpperCase();
  const exponent = currencyMinorUnits(code);
  if (!supportedExponent(exponent)) return null;
  return {
    schemaVersion: LEDGER_MONEY_SCHEMA_VERSION,
    currency: code as CurrencyCode,
    exponent,
  };
};

export const isLedgerMoneySpec = (value: unknown): value is LedgerMoneySpec => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LedgerMoneySpec>;
  const currency = typeof candidate.currency === 'string'
    ? candidate.currency.trim().toUpperCase()
    : '';
  return candidate.schemaVersion === LEDGER_MONEY_SCHEMA_VERSION &&
    currencyMinorUnits(currency) !== null && candidate.currency === currency &&
    supportedExponent(candidate.exponent ?? -1);
};

/** Recreate the persisted interpretation without consulting today's ISO exponent. */
export const storedLedgerMoneySpec = (
  currency: string,
  exponent: number,
): LedgerMoneySpec | null => {
  const candidate: unknown = {
    schemaVersion: LEDGER_MONEY_SCHEMA_VERSION,
    currency: currency.trim().toUpperCase(),
    exponent,
  };
  return isLedgerMoneySpec(candidate) ? candidate : null;
};

/** Metadata drift blocks new imports; it never changes how history is displayed. */
export const ledgerMoneyMatchesCurrentMetadata = (spec: LedgerMoneySpec): boolean =>
  currencyMinorUnits(spec.currency) === spec.exponent;

const nonZeroNumber = (value: unknown): boolean => typeof value === 'number' && value !== 0;
const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
  ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
  : [];

export const ledgerStateHasMoney = (state: LegacyMoneyState): boolean =>
  records(state.accounts).some((item) => nonZeroNumber(item.openingFils) ||
    nonZeroNumber(item.snapshotFils) || nonZeroNumber(item.creditLimitFils)) ||
  records(state.transactions).length > 0 ||
  records(state.budgets).some((item) => nonZeroNumber(item.limitFils)) ||
  records(state.bills).some((item) => nonZeroNumber(item.amountFils)) ||
  records(state.cardDues).some((item) => nonZeroNumber(item.totalDueFils) ||
    nonZeroNumber(item.minDueFils) || nonZeroNumber(item.paidFils)) ||
  records(state.goals).some((item) => nonZeroNumber(item.targetFils) ||
    nonZeroNumber(item.savedFils));

/** Add an explicit currency/exponent to old ledgers without rescaling integers. */
export const migrateLegacyLedgerMoney = (state: LegacyMoneyState): LedgerMoneySpec | null => {
  if (state.ledgerMoney !== undefined && state.ledgerMoney !== null) {
    if (!isLedgerMoneySpec(state.ledgerMoney)) throw new Error('Unsupported ledger money specification');
    // v2 money is the authoritative accounting fact. `marketId` selects the
    // launch parser pack and may remain AE/SA while a global review-only user
    // records an INR/EUR/USD ledger. Never relabel a valid explicit spec from
    // a country preference.
    return state.ledgerMoney;
  }
  const hasMoney = ledgerStateHasMoney(state);
  if (!hasMoney) return null;
  if (state.marketId === 'SA') return ledgerMoneySpec('SAR');
  if (state.marketId === 'AE' || state.marketId === undefined || state.marketId === '') {
    return ledgerMoneySpec('AED');
  }
  throw new Error('Legacy ledger has money in an unknown market');
};

const scaleFor = (exponent: LedgerExponent): number => 10 ** exponent;

/**
 * How a device writes numbers: its decimal mark, its digit-group mark and
 * whether groups follow the Indian lakh/crore pattern (12,34,567).
 *
 * Only presentation and typed input consult this. Stored money is always an
 * integer of ledger minor units, and machine formats (exports, backups, the
 * SMS parser) never pass through it.
 */
export interface NumberConventions {
  decimal: '.' | ',';
  group: string;
  grouping: 'thousands' | 'indian';
}

export const CANONICAL_NUMBER_CONVENTIONS: Readonly<NumberConventions> = Object.freeze({
  decimal: '.',
  group: ',',
  grouping: 'thousands',
});

/** Group marks a locale can legitimately use. Anything else is refused. */
const SPACE_GROUPS = new Set([' ', '\u00A0', '\u202F', '\u2009']);
const APOSTROPHE_GROUPS = new Set(["'", '\u2019']);
const isAllowedGroup = (value: string): boolean =>
  value === ',' || value === '.' || SPACE_GROUPS.has(value) || APOSTROPHE_GROUPS.has(value);

/**
 * The Arabic UI shows Latin digits, so the Arabic decimal and group marks map
 * onto their Latin equivalents instead of mixing scripts inside one figure.
 */
const latinSeparator = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string' || value.length !== 1) return null;
  if (value === '\u066B') return '.';
  if (value === '\u066C') return ',';
  return value;
};

/**
 * Reads the locale's marks from `format` output rather than `formatToParts`:
 * Hermes' Apple Intl has returned a single literal part from formatToParts,
 * which would silently drop Indian grouping. 1234567.5 always prints as
 * digits 1..7, one decimal mark and group marks between digit runs.
 */
const intlConventions = (locale: string): NumberConventions | null => {
  try {
    const text = new Intl.NumberFormat(locale, { useGrouping: true, minimumFractionDigits: 1 })
      .format(1234567.5)
      .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
    const match = /^(\d+)(?:(\D)(\d+))?(?:\D(\d+))?(?:\D(\d+))?(\D)5$/.exec(text.replace(/[\u200E\u200F\u061C]/g, ''));
    if (!match) return null;
    const runs = [match[1], match[3], match[4], match[5]].filter((run): run is string => !!run)
      .map((run) => run.length);
    const decimal = latinSeparator(match[6]);
    const group = latinSeparator(match[2]);
    const indian = runs.length === 3 && runs[0] === 2 && runs[1] === 2 && runs[2] === 3;
    if ((decimal !== '.' && decimal !== ',') || !group || group === decimal || !isAllowedGroup(group)) {
      return null;
    }
    return { decimal, group, grouping: indian ? 'indian' : 'thousands' };
  } catch {
    return null;
  }
};

export interface DeviceMoneyLocale {
  /** BCP 47 tag for the device's formats, e.g. "de-DE" or "en-IN". */
  locale?: string | null;
  /** expo-localization's `decimalSeparator` for the device region. */
  decimalSeparator?: string | null;
  /** expo-localization's `digitGroupingSeparator` for the device region. */
  groupSeparator?: string | null;
  /** The device Region (ISO 3166 alpha-2), e.g. "AE" on an en-US phone in the UAE. */
  region?: string | null;
}

/** The subset of an expo-localization `Locale` that money display reads. */
export interface ExpoLocaleLike {
  languageTag?: string | null;
  languageCode?: string | null;
  regionCode?: string | null;
  languageRegionCode?: string | null;
  decimalSeparator?: string | null;
  digitGroupingSeparator?: string | null;
}

const regionOf = (value: string | null | undefined): string | null => {
  const code = value?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : null;
};

/**
 * Map expo-localization's first Locale onto the money display settings.
 *
 * The Region is `regionCode` — the device's Region setting, which on a UAE
 * phone whose language is English (United States) is "AE" — and only falls
 * back to the language's own region when the device reports none. The
 * language tag never decides it: that is how an en-US phone in Dubai would
 * get month-first US dates.
 */
export const deviceMoneyLocale = (locale: ExpoLocaleLike | null | undefined): DeviceMoneyLocale | null => {
  if (!locale) return null;
  const region = regionOf(locale.regionCode) ?? regionOf(locale.languageRegionCode);
  const language = locale.languageCode?.trim() || locale.languageTag?.split(/[-_]/)[0] || null;
  return {
    locale: language && region ? `${language}-${region}` : locale.languageTag ?? language,
    decimalSeparator: locale.decimalSeparator ?? null,
    groupSeparator: locale.digitGroupingSeparator ?? null,
    region,
  };
};

/**
 * Number conventions for a device: the locale supplies the grouping pattern,
 * and the device's own separator settings (which a user can override in
 * system settings) win over what the language tag implies. Anything unusable
 * falls back to canonical `1,234.56` rather than guessing.
 */
export const numberConventionsForLocale = (input: DeviceMoneyLocale): NumberConventions => {
  const fromLocale = input.locale ? intlConventions(input.locale) : null;
  const base = fromLocale ?? CANONICAL_NUMBER_CONVENTIONS;
  const decimal = input.decimalSeparator == null ? base.decimal : latinSeparator(input.decimalSeparator);
  if (decimal !== '.' && decimal !== ',') return { ...CANONICAL_NUMBER_CONVENTIONS };
  const candidate = input.groupSeparator == null ? base.group : latinSeparator(input.groupSeparator);
  const group = candidate && candidate !== decimal && isAllowedGroup(candidate)
    ? candidate
    : decimal === ',' ? '.' : ',';
  return { decimal, group, grouping: base.grouping };
};

let displayConventions: NumberConventions = { ...CANONICAL_NUMBER_CONVENTIONS };
let displayLocale: string | null = null;
let deviceRegion: string | null = null;
const placementCache = new Map<string, CurrencyPlacement>();

const supportedLocale = (locale: string | null | undefined): string | null => {
  const tag = locale?.trim();
  if (!tag) return null;
  try {
    return Intl.NumberFormat.supportedLocalesOf([tag]).length ? tag : null;
  } catch {
    return null;
  }
};

/**
 * Adopt the device's number conventions for display and typed input. `null`
 * restores canonical `1,234.56` with ISO codes, which is also the state
 * before the app has read the device (and in every test that does not opt in).
 */
export const setDisplayMoneyLocale = (input: DeviceMoneyLocale | null): void => {
  displayConventions = input ? numberConventionsForLocale(input) : { ...CANONICAL_NUMBER_CONVENTIONS };
  const locale = input ? supportedLocale(input.locale) : null;
  if (locale !== displayLocale) placementCache.clear();
  displayLocale = locale;
  deviceRegion = regionOf(input?.region);
};

export const displayNumberConventions = (): NumberConventions => displayConventions;

/** The device Region last adopted, or null when none is known. */
export const displayRegion = (): string | null => deviceRegion;

const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LETTERS_ONLY = /^[A-Za-z]+$/;

/**
 * Where a currency sits relative to its figure in the device locale.
 * `spaced` is whether the locale separates them ("1.234,56 €" vs "$1,234.56").
 */
export interface CurrencyPlacement {
  label: string;
  position: 'before' | 'after';
  spaced: boolean;
}

const CODE_PLACEMENT = (iso: string): CurrencyPlacement => ({ label: iso, position: 'before', spaced: true });
const DIGITS = /[\d\u0660-\u0669\u06F0-\u06F9]/;
const BIDI = /[\u200E\u200F\u061C]/g;
const SPACE = /[\s\u00A0\u202F]/;

/**
 * The currency label and its position for `code` in the device locale.
 *
 * The label is the currency's symbol when the locale gives it an unambiguous
 * one, else the ISO code. CLDR's `symbol` form is already disambiguated for
 * the locale — USD is "$" in en-US but "US$" in en-CA, CAD is "CA$" in en-US —
 * whereas `narrowSymbol` prints a bare "$" for every dollar, so it is never
 * used. A symbol that is the code itself, letters only ("CHF"), or Arabic
 * script keeps the code, placed before the figure with a space exactly as the
 * UAE and Saudi UIs, English and Arabic, have always shown "AED 1,234.56".
 *
 * The position and spacing are read from `Intl.NumberFormat#format` output
 * (text before the first digit is a prefix), not formatToParts, which Hermes'
 * Apple Intl has not fully implemented. Visual only: accessibility labels
 * keep speaking the ISO code.
 */
export const currencyPlacement = (code: string, locale: string | null = displayLocale): CurrencyPlacement => {
  const iso = code.trim().toUpperCase();
  if (!locale || !/^[A-Z]{3}$/.test(iso)) return CODE_PLACEMENT(iso);
  const key = `${locale}|${iso}`;
  const cached = placementCache.get(key);
  if (cached) return cached;
  let placement = CODE_PLACEMENT(iso);
  try {
    const text = new Intl.NumberFormat(locale, {
      style: 'currency', currency: iso, currencyDisplay: 'symbol',
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(1).replace(BIDI, '');
    const digit = text.search(DIGITS);
    const before = digit > 0 ? text.slice(0, digit) : '';
    const after = digit >= 0 ? text.slice(digit + 1) : '';
    const symbol = text.replace(new RegExp(DIGITS.source, 'g'), '').replace(/[\s\u00A0\u202F]/g, '').trim();
    if (digit >= 0 && symbol && symbol.toUpperCase() !== iso && !LETTERS_ONLY.test(symbol) &&
      !ARABIC_SCRIPT.test(symbol) && symbol.length <= 4) {
      const prefix = before.trim().length > 0;
      placement = {
        label: symbol,
        position: prefix ? 'before' : 'after',
        spaced: prefix ? SPACE.test(before.slice(-1)) : SPACE.test(after.charAt(0)),
      };
    }
  } catch {
    placement = CODE_PLACEMENT(iso);
  }
  placementCache.set(key, placement);
  return placement;
};

/** The visual currency label alone: symbol or ISO code (see currencyPlacement). */
export const currencyDisplayLabel = (code: string, locale: string | null = displayLocale): string =>
  currencyPlacement(code, locale).label;

const THOUSANDS_GROUPS = /^\d{1,3}(?:,\d{3})+$/;
const INDIAN_GROUPS = /^\d{1,2}(?:,\d{2})*,\d{3}$/;

const parseCanonical = (
  text: string,
  spec: LedgerMoneySpec,
  grouping: NumberConventions['grouping'],
): number | null => {
  const value = text.trim();
  if (!value || !/^\d[\d,]*(?:\.\d+)?$/.test(value)) return null;
  const [wholeRaw, fractionRaw = ''] = value.split('.');
  if (fractionRaw.length > spec.exponent) return null;
  if (wholeRaw.includes(',') && !THOUSANDS_GROUPS.test(wholeRaw) &&
    !(grouping === 'indian' && INDIAN_GROUPS.test(wholeRaw))) return null;
  const whole = wholeRaw.replace(/,/g, '').replace(/^0+(?=\d)/, '') || '0';
  const digits = `${whole}${fractionRaw.padEnd(spec.exponent, '0')}`.replace(/^0+(?=\d)/, '') || '0';
  let minor: bigint;
  try { minor = BigInt(digits); } catch { return null; }
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
};

/** Canonical `1,234.56` input — the machine form. Never locale-dependent. */
export const parseMajorToMinor = (text: string, spec: LedgerMoneySpec): number | null =>
  parseCanonical(text, spec, 'thousands');

/**
 * Typed input in the device's conventions, exactly, or null.
 *
 * Only the locale's own decimal mark is a decimal; the other of `.`/`,` is
 * read as a group mark and must then group correctly. So "1.234" is 1,234 in
 * de-DE, "1,234" is 1.234 there (and refused for a two-decimal currency), and
 * "12.50" in de-DE — neither a valid group nor this locale's decimal — is
 * refused rather than guessed. With a space or apostrophe group mark, the
 * other of `.`/`,` is refused outright. `text` must already be reduced to
 * digits and separators (see parseAmountWithMoneySpec).
 */
export const parseLocalizedMajorToMinor = (
  text: string,
  spec: LedgerMoneySpec,
  conventions: NumberConventions = displayConventions,
): number | null => {
  let value = text.trim();
  if (!value) return null;
  const { decimal, group } = conventions;
  const spacing = SPACE_GROUPS.has(group) || APOSTROPHE_GROUPS.has(group);
  if (spacing) value = value.replace(/[\s\u00A0\u202F\u2009'\u2019]/g, '');
  if (/[^\d.,]/.test(value)) return null;
  const other = decimal === '.' ? ',' : '.';
  const hasDecimal = value.includes(decimal);
  const otherMarks = value.split(other).length - 1;
  const afterOther = otherMarks === 1 ? value.length - value.indexOf(other) - 1 : -1;
  // "1.234" in de-DE (or "1,234" in en-US) for a three-decimal currency is
  // either 1,234 or 1.234 — a factor of 1,000. A keyboard that lacks the
  // locale's own decimal mark makes the second reading real, so refuse.
  if (!hasDecimal && afterOther === 3 && spec.exponent === 3) return null;
  // Many Android numeric keyboards offer only "." whatever the Region. In a
  // decimal-comma locale a lone "." that cannot be a digit group (not three
  // digits after it) and fits the exponent has exactly one reading.
  if (decimal === ',' && !hasDecimal && afterOther >= 1 && afterOther <= spec.exponent &&
    afterOther !== 3) {
    return parseCanonical(value, spec, conventions.grouping);
  }
  if (spacing) {
    // Space/apostrophe grouping is already gone; the other of "." and ","
    // has no meaning here.
    if (otherMarks > 0) return null;
    return parseCanonical(decimal === ',' ? value.replace(',', '.') : value, spec, conventions.grouping);
  }
  const canonical = decimal === '.'
    ? value
    : value.replace(/[.,]/g, (mark) => (mark === ',' ? '.' : ','));
  return parseCanonical(canonical, spec, conventions.grouping);
};

const groupDigits = (digits: string, conventions: NumberConventions): string => {
  if (conventions.grouping === 'indian' && digits.length > 3) {
    const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, conventions.group);
    return `${head}${conventions.group}${digits.slice(-3)}`;
  }
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, conventions.group);
};

/**
 * Exact display of stored minor units in the device conventions (canonical
 * until the app adopts the device's). Whole amounts drop decimals unless
 * `decimals` is true; `decimals: false` rounds to whole major units.
 */
export const formatMinorUnits = (
  minorUnits: number,
  spec: LedgerMoneySpec,
  options?: { decimals?: boolean; conventions?: NumberConventions; grouping?: boolean },
): string => {
  if (!Number.isSafeInteger(minorUnits)) throw new Error('Money must be a safe integer');
  const conventions = options?.conventions ?? displayConventions;
  const scale = scaleFor(spec.exponent);
  const absolute = Math.abs(minorUnits);
  const remainder = absolute % scale;
  const showDecimals = options?.decimals ?? remainder !== 0;
  const whole = showDecimals ? Math.floor(absolute / scale) : Math.round(absolute / scale);
  const sign = minorUnits < 0 && (whole > 0 || (showDecimals && remainder > 0)) ? '-' : '';
  const digits = options?.grouping === false ? String(whole) : groupDigits(String(whole), conventions);
  const base = `${sign}${digits}`;
  if (!showDecimals || spec.exponent === 0) return base;
  return `${base}${conventions.decimal}${String(remainder).padStart(spec.exponent, '0')}`;
};

/**
 * Editable text for an amount field: no group marks, the device decimal mark,
 * exact minor units — what parseLocalizedMajorToMinor reads back unchanged.
 */
export const formatMinorUnitsForInput = (
  minorUnits: number,
  spec: LedgerMoneySpec,
  conventions: NumberConventions = displayConventions,
  options?: { decimals?: boolean },
): string => formatMinorUnits(minorUnits, spec, {
  conventions,
  grouping: false,
  decimals: options?.decimals === true ? true : undefined,
});

/**
 * A whole visual money string in the device's pattern: "1.234,56 €" in
 * de-DE, "$1,234.56" in en-US, "AED 1,234.56" wherever AED shows its code.
 * The figure is formatMinorUnits' exact output; a symbol is joined with a
 * no-break space so it never wraps away from its figure. Not for
 * accessibility labels, which should speak the ISO code.
 */
export const formatMoneyText = (
  minorUnits: number,
  spec: LedgerMoneySpec,
  options?: { decimals?: boolean; conventions?: NumberConventions; locale?: string | null },
): string => {
  const placement = currencyPlacement(spec.currency, options?.locale === undefined ? displayLocale : options.locale);
  const figure = formatMinorUnits(Math.abs(minorUnits), spec, {
    decimals: options?.decimals,
    conventions: options?.conventions,
  });
  const sign = minorUnits < 0 && /[1-9]/.test(figure) ? '-' : '';
  if (placement.label === spec.currency && placement.position === 'before') {
    return `${placement.label} ${sign}${figure}`;
  }
  const gap = placement.spaced ? '\u00A0' : '';
  return placement.position === 'before'
    ? `${sign}${placement.label}${gap}${figure}`
    : `${sign}${figure}${gap}${placement.label}`;
};

/**
 * Coarse nominal scale of a currency against the launch AED/SAR baseline, as
 * a power of ten: something costing about 100 AED costs roughly 10^k × 100 of
 * it (JPY 2: ¥10,000; KWD −1: 10 KWD).
 *
 * This is NOT an exchange rate and never converts money. It only sizes
 * heuristic thresholds — a "large" purchase, a noise floor, preset chips — so
 * they mean the same in a large-nominal currency as they do in AED. Unlisted
 * currencies take 0, the AED/SAR/USD/EUR/GBP class.
 */
const NOMINAL_SCALE: Readonly<Record<string, -1 | 1 | 2 | 3 | 4>> = Object.freeze({
  BHD: -1, KWD: -1, OMR: -1, JOD: -1,
  INR: 1, EGP: 1, PHP: 1, THB: 1, TRY: 1, ZAR: 1, MXN: 1, CZK: 1, TWD: 1, UAH: 1,
  RUB: 1, RSD: 1, GHS: 1, HNL: 1, BOB: 1, MUR: 1,
  JPY: 2, PKR: 2, BDT: 2, NPR: 2, LKR: 2, KES: 2, HUF: 2, ISK: 2, CLP: 2, KZT: 2,
  DZD: 2, YER: 2, ETB: 2, XOF: 2, XAF: 2, AMD: 2, AFN: 2, JMD: 2, DOP: 2, ARS: 2,
  KRW: 3, NGN: 3, COP: 3, TZS: 3, UGX: 3, PYG: 3, MMK: 3, KHR: 3, MNT: 3, IQD: 3,
  MGA: 3, RWF: 3, CDF: 3, MWK: 3, SOS: 3,
  IDR: 4, VND: 4, IRR: 4, LBP: 4, UZS: 4, LAK: 4, SYP: 4, GNF: 4,
});

export const nominalScaleOf = (currency: string): number =>
  NOMINAL_SCALE[currency.trim().toUpperCase()] ?? 0;

/**
 * Exact minor units of "about `referenceMajor` AED" in `spec`'s currency.
 * `typicalMinorAmount(AED, 200)` is 20,000 fils; JPY gives ¥20,000 and KWD
 * 20.000 KWD. `referenceMajor` is a whole number of AED-sized units.
 */
export const typicalMinorAmount = (spec: LedgerMoneySpec, referenceMajor: number): number => {
  const power = spec.exponent + nominalScaleOf(spec.currency);
  const value = power >= 0
    ? referenceMajor * 10 ** power
    : Math.round(referenceMajor / 10 ** -power);
  if (!Number.isSafeInteger(value)) throw new Error('Typical amount exceeds safe integer range');
  return value;
};

/** Whole major units at the ledger exponent, rounded to nearest. */
export const wholeMajorUnits = (minorUnits: number, spec: LedgerMoneySpec): number =>
  Math.round(minorUnits / scaleFor(spec.exponent));

/**
 * A round budget-sized figure: the nearest multiple of the currency's
 * "about 100 AED" step, never below one step. AED rounds to 100 dirhams.
 */
export const roundToNiceMinor = (minorUnits: number, spec: LedgerMoneySpec): number => {
  const step = typicalMinorAmount(spec, 100);
  const rounded = Math.max(step, Math.round(minorUnits / step) * step);
  if (!Number.isSafeInteger(rounded)) throw new Error('Rounded money exceeds safe integer range');
  return rounded;
};

export const roundToWholeMajorMinor = (minorUnits: number, spec: LedgerMoneySpec): number => {
  if (!Number.isSafeInteger(minorUnits)) throw new Error('Money must be a safe integer');
  const scale = scaleFor(spec.exponent);
  const rounded = Math.round(minorUnits / scale) * scale;
  if (!Number.isSafeInteger(rounded)) throw new Error('Rounded money exceeds safe integer range');
  return rounded;
};

export const checkedMinorSum = (values: readonly number[]): number => {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(total + value)) {
      throw new Error('Money total exceeds safe integer range');
    }
    total += value;
  }
  return total;
};
