import {
  CURRENCY_SYMBOL_CANDIDATES,
  currencyMinorUnits,
  type CurrencyCode,
} from '@/lib/currency-metadata';

export const ALERT_DRAFT_VERSION = 1;

export type DraftEvidence = 'iso-code' | 'unique-symbol' | 'ambiguous-symbol';

export interface SourceSpan {
  start: number;
  end: number;
}

export interface MoneyCandidate {
  currency: CurrencyCode | null;
  currencyCandidates: readonly CurrencyCode[];
  /** Null when locale/currency ambiguity permits more than one exact value. */
  minorUnits: string | null;
  exponent: number | null;
  interpretations: MoneyInterpretation[];
  sourceText: string;
  span: SourceSpan;
  evidence: DraftEvidence;
  confidence: number;
  ambiguities: string[];
}

export interface MoneyInterpretation {
  currency: CurrencyCode;
  minorUnits: string;
  exponent: number;
}

export interface AlertDraft {
  parserVersion: number;
  /** Same UTF-16 length as the source, so every span maps back exactly. */
  normalizedText: string;
  decision: 'review' | 'refuse';
  reasons: string[];
  candidates: MoneyCandidate[];
}

export type CurrencyAliasMap = Readonly<Record<string, readonly CurrencyCode[]>>;

export interface AlertDraftContext {
  /** Market-scoped aliases such as KD or ج.م. Never apply these globally. */
  currencyAliases?: CurrencyAliasMap;
}

const DIGIT_ZEROES = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0e50, 0x1040, 0xff10] as const;

/** Normalize common bank-alert digits/separators without changing string length. */
export function normalizeAlertText(source: string): string {
  let out = '';
  for (const character of source) {
    const code = character.codePointAt(0) as number;
    let replaced = character;
    for (const zero of DIGIT_ZEROES) {
      if (code >= zero && code <= zero + 9) {
        replaced = String(code - zero);
        break;
      }
    }
    if (character === '٫') replaced = '.';
    else if (character === '٬') replaced = ',';
    else if (character === '−') replaced = '-';
    else if (character === '\u00a0' || character === '\u2007' || character === '\u202f') replaced = ' ';
    else if ((code >= 0x200e && code <= 0x200f) || (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)) replaced = ' ';
    out += replaced;
  }
  return out;
}

interface ParsedNumber {
  minorUnits: string;
  ambiguous: boolean;
  alternateMinorUnits: string | null;
}

function parseNumber(source: string, exponent: number): ParsedNumber | null {
  let value = source.trim().replace(/[+]/g, '');
  const negative = value.startsWith('-');
  if (negative) value = value.slice(1);
  value = value.replace(/[ '\u2019]/g, '');
  if (!/^\d[\d.,]*$/.test(value) || value.length > 48) return null;

  const dot = value.lastIndexOf('.');
  const comma = value.lastIndexOf(',');
  let decimalAt = -1;
  let ambiguous = false;

  const validGroupedInteger = (raw: string, separator: string): boolean => {
    const parts = raw.split(separator);
    if (parts.length < 2 || !/^\d{1,3}$/.test(parts[0]) || !/^\d{3}$/.test(parts[parts.length - 1])) {
      return false;
    }
    const middle = parts.slice(1, -1);
    return middle.length === 0 || middle.every((part) => /^\d{3}$/.test(part)) ||
      middle.every((part) => /^\d{2}$/.test(part));
  };

  if (dot >= 0 && comma >= 0) {
    const last = Math.max(dot, comma);
    const tail = value.length - last - 1;
    if (exponent <= 0 || tail !== exponent) return null;
    const decimalSeparator = value[last];
    const groupingSeparator = decimalSeparator === '.' ? ',' : '.';
    const integerPart = value.slice(0, last);
    if (integerPart.includes(decimalSeparator) ||
      (integerPart.includes(groupingSeparator) && !validGroupedInteger(integerPart, groupingSeparator))) {
      return null;
    }
    decimalAt = last;
  } else if (dot >= 0 || comma >= 0) {
    const separator = dot >= 0 ? '.' : ',';
    const locations = [...value.matchAll(new RegExp(`\\${separator}`, 'g'))].map((m) => m.index as number);
    const last = locations[locations.length - 1];
    const tail = value.length - last - 1;
    if (locations.length === 1 && exponent > 0 && tail > 0 && tail <= exponent) {
      decimalAt = last;
      // A single three-digit suffix can also be a thousands group. Preserve
      // the candidate but force review rather than pretending certainty.
      ambiguous = exponent === 3 && tail === 3;
    } else if (exponent === 3 && tail === 3 &&
      validGroupedInteger(value.slice(0, last), separator)) {
      // Even repeated separators are kept ambiguous for three-decimal
      // currencies: bank templates must prove whether the last separator is
      // decimal before an exact value can be selected.
      decimalAt = last;
      ambiguous = true;
    } else if (!validGroupedInteger(value, separator)) {
      return null;
    }
  }

  const integerRaw = decimalAt >= 0 ? value.slice(0, decimalAt) : value;
  const fractionRaw = decimalAt >= 0 ? value.slice(decimalAt + 1) : '';
  const integer = integerRaw.replace(/[.,]/g, '');
  if (!/^\d+$/.test(integer) || (fractionRaw && !/^\d+$/.test(fractionRaw))) return null;
  if (fractionRaw.length > exponent) return null;
  const digits = `${integer}${fractionRaw.padEnd(exponent, '0')}`.replace(/^0+(?=\d)/, '');
  const minorUnits = `${negative ? '-' : ''}${digits || '0'}`;
  let alternateMinorUnits: string | null = null;
  if (ambiguous) {
    const grouped = value.replace(/[.,]/g, '').replace(/^0+(?=\d)/, '') || '0';
    alternateMinorUnits = `${negative ? '-' : ''}${grouped}${'0'.repeat(exponent)}`;
  }
  return { minorUnits, ambiguous, alternateMinorUnits };
}

const NUMBER = `[+-]?(?:\\d[\\d.,' \\u2019]{0,46}\\d|\\d)`;
const TOKEN_GAP = '\\s{0,3}';
const ISO_PREFIX = new RegExp(`\\b([A-Za-z]{3})${TOKEN_GAP}(${NUMBER})`, 'g');
const ISO_SUFFIX = new RegExp(`(${NUMBER})${TOKEN_GAP}([A-Za-z]{3})\\b`, 'g');
const SYMBOLS = Object.keys(CURRENCY_SYMBOL_CANDIDATES).sort((a, b) => b.length - a.length);
const escapeRe = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SYMBOL_PATTERN = SYMBOLS.map(escapeRe).join('|');
const SYMBOL_PREFIX = new RegExp(`(${SYMBOL_PATTERN})${TOKEN_GAP}(${NUMBER})`, 'g');
const SYMBOL_SUFFIX = new RegExp(`(${NUMBER})${TOKEN_GAP}(${SYMBOL_PATTERN})`, 'g');

interface RawCandidate {
  start: number;
  end: number;
  amount: string;
  token: string;
  currencies: readonly CurrencyCode[];
  evidence: DraftEvidence;
}

const collectAliasRaw = (normalized: string, aliases: CurrencyAliasMap): RawCandidate[] => {
  const tokens = Object.keys(aliases).sort((a, b) => b.length - a.length);
  if (!tokens.length) return [];
  const currenciesByToken = new Map(
    tokens.map((token) => [token.toLowerCase(), aliases[token]] as const),
  );
  const pattern = tokens.map(escapeRe).join('|');
  const prefix = new RegExp(`(^|[^\\p{L}\\p{N}])(${pattern})${TOKEN_GAP}(${NUMBER})`, 'giu');
  const suffix = new RegExp(`(${NUMBER})${TOKEN_GAP}(${pattern})(?=$|[^\\p{L}\\p{N}])`, 'giu');
  const found: RawCandidate[] = [];
  for (const [re, tokenAt, amountAt] of [[prefix, 2, 3], [suffix, 2, 1]] as const) {
    re.lastIndex = 0;
    for (const match of normalized.matchAll(re)) {
      const leading = re === prefix ? match[1].length : 0;
      const token = match[tokenAt];
      const currencies = currenciesByToken.get(token.toLowerCase());
      if (!currencies?.length) continue;
      found.push({
        start: (match.index as number) + leading,
        end: (match.index as number) + match[0].length,
        amount: match[amountAt],
        token,
        currencies,
        evidence: currencies.length === 1 ? 'unique-symbol' : 'ambiguous-symbol',
      });
    }
  }
  return found;
};

function collectRaw(normalized: string, aliases: CurrencyAliasMap = {}): RawCandidate[] {
  const found: RawCandidate[] = [];
  const scanIso = (re: RegExp, prefix: boolean): void => {
    re.lastIndex = 0;
    for (const match of normalized.matchAll(re)) {
      if (!prefix && (match.index as number) > 0 &&
        /[\p{L}\p{N}]/u.test(normalized[(match.index as number) - 1])) continue;
      const matchEnd = (match.index as number) + match[0].length;
      if (matchEnd < normalized.length && /[\p{L}\p{N}]/u.test(normalized[matchEnd])) continue;
      const code = (prefix ? match[1] : match[2]).toUpperCase();
      if (currencyMinorUnits(code) === null) continue;
      found.push({
        start: match.index as number,
        end: (match.index as number) + match[0].length,
        amount: prefix ? match[2] : match[1],
        token: code,
        currencies: [code as CurrencyCode],
        evidence: 'iso-code',
      });
    }
  };
  const scanSymbol = (re: RegExp, prefix: boolean): void => {
    re.lastIndex = 0;
    for (const match of normalized.matchAll(re)) {
      if (!prefix && (match.index as number) > 0 &&
        /[\p{L}\p{N}]/u.test(normalized[(match.index as number) - 1])) continue;
      const matchEnd = (match.index as number) + match[0].length;
      if (matchEnd < normalized.length && /[\p{L}\p{N}]/u.test(normalized[matchEnd])) continue;
      const token = prefix ? match[1] : match[2];
      const currencies = CURRENCY_SYMBOL_CANDIDATES[token];
      if (!currencies) continue;
      found.push({
        start: match.index as number,
        end: (match.index as number) + match[0].length,
        amount: prefix ? match[2] : match[1],
        token,
        currencies,
        evidence: currencies.length === 1 ? 'unique-symbol' : 'ambiguous-symbol',
      });
    }
  };
  scanIso(ISO_PREFIX, true);
  scanIso(ISO_SUFFIX, false);
  // A market-scoped alias is stronger evidence than the same token's global
  // symbol ambiguity (for example Rs in India), but never outranks an ISO code.
  found.push(...collectAliasRaw(normalized, aliases));
  scanSymbol(SYMBOL_PREFIX, true);
  scanSymbol(SYMBOL_SUFFIX, false);
  return found
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .filter((item, index, all) => !all.slice(0, index).some((prior) => prior.start === item.start && prior.end === item.end));
}

const HARD_NEGATIVES: readonly [string, RegExp][] = [
  ['authentication-or-otp', /\b(?:otp|one[ -]?time password|verification code|authorization code|security code|do not share|pin)\b|رمز (?:التحقق|التأكيد)|كلمة المرور/i],
  ['declined-or-failed', /\b(?:declined|failed|unsuccessful|rejected|not approved)\b|مرفوض|فشل(?:ت|ت)?/i],
  ['scheduled-or-due', /\b(?:pre[ -]?debit|will be debited|scheduled|due on|payment due|reminder)\b|سيتم (?:خصم|سحب)|مستحق/i],
  ['promotion', /\b(?:offer|promotion|promo code|discount voucher|apply now)\b|عرض ترويجي|خصم خاص/i],
  ['aggregate-or-summary', /\b(?:spend to date|spending summary|totaling|statement total|monthly total)\b|ملخص (?:الإنفاق|المصروفات)/i],
];

const MOVEMENT_WORDS = /\b(?:spent|purchase|purchased|paid|charged|debited|credited|received|sent|withdrawn|deposited|refund|reversal|transfer)\b|شراء|خصم|إيداع|تحويل|استرداد/i;
const BALANCE_ONLY = /\b(?:available balance|current balance|available limit|credit limit|outstanding balance)\b|الرصيد (?:الحالي|المتاح)|الحد (?:المتاح|الائتماني)/i;

/**
 * Find grounded money candidates in an alert. This API can only review or
 * refuse: it is intentionally impossible for this first worldwide slice to
 * write an unverified amount into the ledger.
 */
export function inspectAlertDraft(source: string, context: AlertDraftContext = {}): AlertDraft {
  const normalizedText = normalizeAlertText(source.slice(0, 4096));
  const reasons = HARD_NEGATIVES.filter(([, pattern]) => pattern.test(normalizedText)).map(([reason]) => reason);
  if (source.length > 4096) reasons.push('input-too-long');
  if (BALANCE_ONLY.test(normalizedText) && !MOVEMENT_WORDS.test(normalizedText)) reasons.push('balance-only');

  const candidates: MoneyCandidate[] = [];
  const rawCandidates = collectRaw(normalizedText, context.currencyAliases);
  if (rawCandidates.length > 16) reasons.push('too-many-money-candidates');
  for (const raw of rawCandidates.slice(0, 16)) {
    const interpretations: MoneyInterpretation[] = [];
    let numberAmbiguous = false;
    for (const currency of raw.currencies) {
      const exponent = currencyMinorUnits(currency);
      if (exponent === null) continue;
      const parsed = parseNumber(raw.amount, exponent);
      if (!parsed) continue;
      interpretations.push({ currency, minorUnits: parsed.minorUnits, exponent });
      if (parsed.alternateMinorUnits !== null) {
        numberAmbiguous = true;
        interpretations.push({ currency, minorUnits: parsed.alternateMinorUnits, exponent });
      }
    }
    const uniqueInterpretations = interpretations.filter((item, index, all) =>
      all.findIndex((other) =>
        other.currency === item.currency &&
        other.minorUnits === item.minorUnits &&
        other.exponent === item.exponent) === index);
    if (!uniqueInterpretations.length) continue;
    const values = [...new Set(uniqueInterpretations.map((item) => `${item.exponent}:${item.minorUnits}`))];
    const everyCurrencyParsed = new Set(uniqueInterpretations.map((item) => item.currency)).size === raw.currencies.length;
    const canonical = values.length === 1 && everyCurrencyParsed ? uniqueInterpretations[0] : null;
    const ambiguities: string[] = [];
    if (raw.currencies.length > 1) ambiguities.push('currency-symbol');
    if (numberAmbiguous) ambiguities.push('decimal-or-grouping');
    if (values.length > 1 && raw.currencies.length > 1) ambiguities.push('currency-exponent');
    candidates.push({
      currency: raw.currencies.length === 1 ? raw.currencies[0] : null,
      currencyCandidates: raw.currencies,
      minorUnits: canonical?.minorUnits ?? null,
      exponent: canonical?.exponent ?? null,
      interpretations: uniqueInterpretations,
      sourceText: source.slice(raw.start, raw.end),
      span: { start: raw.start, end: raw.end },
      evidence: raw.evidence,
      confidence: raw.evidence === 'iso-code'
        ? (numberAmbiguous ? 0.72 : 0.98)
        : raw.evidence === 'unique-symbol'
          ? (numberAmbiguous ? 0.65 : 0.9)
          : 0.55,
      ambiguities,
    });
  }

  if (!candidates.length) reasons.push('no-grounded-money');
  else if (candidates.some((candidate) => candidate.ambiguities.length > 0)) reasons.push('ambiguous-money');

  return {
    parserVersion: ALERT_DRAFT_VERSION,
    normalizedText,
    decision: reasons.some((reason) => reason !== 'ambiguous-money') ? 'refuse' : 'review',
    reasons: [...new Set(reasons)],
    candidates,
  };
}
