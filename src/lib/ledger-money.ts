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

export const parseMajorToMinor = (text: string, spec: LedgerMoneySpec): number | null => {
  const value = text.trim();
  if (!value || !/^\d[\d,]*(?:\.\d+)?$/.test(value)) return null;
  const [wholeRaw, fractionRaw = ''] = value.split('.');
  if (fractionRaw.length > spec.exponent) return null;
  if (wholeRaw.includes(',') && !/^\d{1,3}(?:,\d{3})+$/.test(wholeRaw)) return null;
  const whole = wholeRaw.replace(/,/g, '').replace(/^0+(?=\d)/, '') || '0';
  const digits = `${whole}${fractionRaw.padEnd(spec.exponent, '0')}`.replace(/^0+(?=\d)/, '') || '0';
  let minor: bigint;
  try { minor = BigInt(digits); } catch { return null; }
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
};

const groupThousands = (value: string): string => value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const formatMinorUnits = (
  minorUnits: number,
  spec: LedgerMoneySpec,
  options?: { decimals?: boolean },
): string => {
  if (!Number.isSafeInteger(minorUnits)) throw new Error('Money must be a safe integer');
  const scale = scaleFor(spec.exponent);
  const absolute = Math.abs(minorUnits);
  const remainder = absolute % scale;
  const showDecimals = options?.decimals ?? remainder !== 0;
  const whole = showDecimals ? Math.floor(absolute / scale) : Math.round(absolute / scale);
  const sign = minorUnits < 0 && (whole > 0 || (showDecimals && remainder > 0)) ? '-' : '';
  const base = `${sign}${groupThousands(String(whole))}`;
  if (!showDecimals || spec.exponent === 0) return base;
  return `${base}.${String(remainder).padStart(spec.exponent, '0')}`;
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
