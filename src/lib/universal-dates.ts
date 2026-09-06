import type { SourceSpan } from '@/lib/alert-draft';
import { missingUniversalField, type UniversalBankEvent, type UniversalField, type UniversalParseContext } from '@/lib/universal-types';

type DateRole = 'transactionDate' | 'dueDate' | 'statementDate';
interface DateObservation { span: SourceSpan; values: string[]; issues: string[] }

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
  يناير: 1, فبراير: 2, مارس: 3, أبريل: 4, ابريل: 4, مايو: 5, يونيو: 6,
  يوليو: 7, أغسطس: 8, اغسطس: 8, سبتمبر: 9, أكتوبر: 10, اكتوبر: 10,
  نوفمبر: 11, ديسمبر: 12,
};
const MONTH_WORD = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const DAY_NAMED = new RegExp(`^(\\d{1,2})[-\\s]*(${MONTH_WORD})(?:[-\\s]*(\\d{2,4}))?$`, 'iu');
const MONTH_NAMED = new RegExp(`^(${MONTH_WORD})\\.?\\s+(\\d{1,2})(?:,?\\s+(\\d{2,4}))?$`, 'iu');
const DATE_TOKENS = new RegExp(
  `(?:(?<![\\p{L}\\p{N}/.-])|(?<=于))(?:\\d{1,4}(?:[/.-]\\d{1,4}){1,7}` +
  `|\\d{1,2}[-\\s]*(?:${MONTH_WORD})(?:[-\\s]*\\d{2,4})?` +
  `|(?:${MONTH_WORD})\\.?\\s+\\d{1,2}(?:,?\\s+\\d{2,4})?)(?:(?![\\p{L}\\p{N}]|[/.-]\\d)|(?=在|存入))`, 'giu');

const calendarDate = (year: number, month: number, day: number): string | null => {
  if (!Number.isInteger(year) || year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= days ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
};

const valuesFor = (token: string, order: UniversalParseContext['dateOrder']): Pick<DateObservation, 'values' | 'issues'> => {
  let values: (string | null)[] = [];
  const iso = token.match(/^(\d{4})([/.-])(\d{1,2})\2(\d{1,2})$/u);
  if (iso) values = [calendarDate(Number(iso[1]), Number(iso[3]), Number(iso[4]))];
  else {
    const numeric = token.match(/^(\d{1,2})([/.-])(\d{1,2})(?:\2(\d{2,4}))?$/u);
    if (numeric) {
      if (numeric[4]?.length !== 4) return { values: [], issues: ['missing-four-digit-year'] };
      const a = Number(numeric[1]), b = Number(numeric[3]), year = Number(numeric[4]);
      if (order === 'YMD') return { values: [], issues: ['date-order-conflict'] };
      values = order === 'DMY' ? [calendarDate(year, b, a)]
        : order === 'MDY' ? [calendarDate(year, a, b)]
          : [calendarDate(year, b, a), calendarDate(year, a, b)];
    } else {
      if (/^[\d/.-]+$/u.test(token)) return { values: [], issues: ['invalid-date'] };
      const dayFirst = token.match(DAY_NAMED);
      const monthFirst = token.match(MONTH_NAMED);
      const yearText = dayFirst?.[3] ?? monthFirst?.[3];
      if (yearText?.length !== 4) return { values: [], issues: ['missing-four-digit-year'] };
      const monthWord = dayFirst?.[2] ?? monthFirst?.[1] ?? '';
      const day = Number(dayFirst?.[1] ?? monthFirst?.[2]);
      values = [calendarDate(Number(yearText), MONTHS[monthWord.toLocaleLowerCase()], day)];
    }
  }
  const valid = [...new Set(values.filter((value): value is string => value !== null))];
  return { values: valid, issues: valid.length ? (valid.length > 1 ? ['ambiguous-date-order'] : []) : ['invalid-date'] };
};

/** Labels govern dates; numbers in references and merchant names do not. */
const dateRole = (text: string, start: number, end: number): DateRole | null => {
  const prefix = text.slice(Math.max(0, start - 140), start);
  if (/(?:\bdue(?:\s+date)?|\bpay(?:ment)?\s+(?:by|before)|\bdeadline|\bdate\s+limite(?:\s+de\s+paiement)?|\bfällig\s+am|支払期限|अंतिम\s+तिथि|\bfecha\s+límite\s+de\s+pago|\bscadenza|भुगतान\s+की\s+अंतिम\s+तिथि|تاريخ\s+استحقاق\s+الدفع|تاريخ\s+(?:الاستحقاق|الإستحقاق)|مستحق(?:ة)?\s*(?:بتاريخ)?|قبل\s+تاريخ)\s*(?:(?:is|on|by|before)\s*)?[:：=-]?\s*$/iu.test(prefix)) return 'dueDate';
  if (/(?:\bstatement\s+(?:date|dated|generated|issued)|\bgenerated|\bissued|تاريخ\s+(?:الكشف|كشف\s+الحساب|الإصدار|الاصدار))\s*(?:(?:is|on)\s*)?[:：=-]?\s*$/iu.test(prefix)) return 'statementDate';
  if (/(?:\b(?:transaction|purchase|payment|posting)\s+date|\bdate|\bdatum|利用日|日時|تاريخ\s+(?:العملية|العمليه|المعاملة|المعامله))\s*(?:(?:is|on)\s*)?[:：=-]?\s*$/iu.test(prefix)) return 'transactionDate';
  // These are the ordinary date-introducing words in the supplied language
  // packs; require an actual date token immediately after them.
  if (/(?:\b(?:on|dated|le|am|el|il|op|em)|بتاريخ)\s*$/iu.test(prefix)) return 'transactionDate';
  const suffix = text.slice(end, Math.min(text.length, end + 180));
  // New-language date contexts require the surrounding transaction predicate;
  // a reference number next to a date-like token is not a date field.
  if (/^\s+tarihinde\s+/u.test(suffix) && /işyerinde(?:ki)?\s+[A-Z]{3}/u.test(suffix) &&
      !/\b(?:ref(?:erence)?|id)\s*[:#-]?\s*$/iu.test(prefix)) return 'transactionDate';
  if (/^\s+को\s+(?:कार्ड|आपके\s+कार्ड)/u.test(suffix) &&
      (/^\s*$/u.test(prefix) || /रिफंड\s+राशि\s*$/u.test(prefix))) return 'transactionDate';
  if (/于$/u.test(prefix) && (/^在[^。]{1,96}消费/u.test(suffix) || /^存入/u.test(suffix))) return 'transactionDate';
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = text.indexOf('\n', end);
  const before = text.slice(lineStart, start).trim();
  const after = text.slice(end, lineEnd < 0 ? text.length : lineEnd).trim();
  if (!before && /^(?:\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?[.]?$/iu.test(after)) return 'transactionDate';
  return null;
};

const fieldFrom = (observations: DateObservation[]): UniversalField<string> => {
  if (!observations.length) return missingUniversalField();
  const values = [...new Set(observations.flatMap((item) => item.values))];
  const issues = [...new Set(observations.flatMap((item) => item.issues))];
  const uncertain = observations.some((item) => item.values.length !== 1);
  const explicit = values.length === 1 && !uncertain;
  return {
    value: explicit ? values[0] : null,
    evidence: explicit ? 'explicit' : values.length ? 'ambiguous' : 'missing',
    alternatives: explicit ? [] : values,
    spans: observations.map((item) => item.span),
    issues: values.length > 1 && !issues.includes('ambiguous-date-order') ? [...issues, 'conflicting-dates'] : issues,
  };
};

export function extractUniversalDates(
  normalizedText: string,
  context: UniversalParseContext,
  moneySpans: readonly SourceSpan[],
): Pick<UniversalBankEvent, DateRole> {
  const observations: Record<DateRole, DateObservation[]> = { transactionDate: [], dueDate: [], statementDate: [] };
  for (const match of normalizedText.matchAll(DATE_TOKENS)) {
    const span = { start: match.index!, end: match.index! + match[0].length };
    if (moneySpans.some((money) => span.start < money.end && span.end > money.start)) continue;
    const role = dateRole(normalizedText, span.start, span.end);
    if (role) observations[role].push({ span, ...valuesFor(match[0], context.dateOrder) });
  }
  return {
    transactionDate: fieldFrom(observations.transactionDate),
    dueDate: fieldFrom(observations.dueDate),
    statementDate: fieldFrom(observations.statementDate),
  };
}
