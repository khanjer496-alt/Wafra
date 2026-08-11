/** In-memory normalization for forwarded bank email and text-based statements. */
import PostalMime from 'postal-mime';
import { parse as parseCsvRecords } from 'csv-parse/sync';
import { extractText, getDocumentProxy } from 'unpdf';

import { classifyMerchantDescription, type ParsedSms } from '@/lib/sms-parser';

const MAX_NORMALIZED_CHARS = 128_000;
const MAX_CSV_RECORD_CHARS = 8_192;
const DATE_TOKEN = String.raw`(?:\d{4}-\d{2}-\d{2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})`;
const AMOUNT_TOKEN = String.raw`(?:(?:AED|SAR)\s*)?([\d,]+(?:\.\d{2})?)`;
const ROW_END_DIRECTION = new RegExp(
  `^(${DATE_TOKEN})\\s+(.{2,180}?)\\s+${AMOUNT_TOKEN}\\s+(DR|CR|DEBIT|CREDIT)$`,
  'i',
);
const ROW_MIDDLE_DIRECTION = new RegExp(
  `^(${DATE_TOKEN})\\s+(.{2,180}?)\\s+(DR|CR|DEBIT|CREDIT)\\s+${AMOUNT_TOKEN}$`,
  'i',
);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] !== '#') return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
    const hex = entity[1]?.toLowerCase() === 'x';
    const codepoint = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isFinite(codepoint) && codepoint >= 0 && codepoint <= 0x10ffff
      ? String.fromCodePoint(codepoint)
      : whole;
  });
}

export function htmlToText(html: string): string {
  const withoutActiveContent = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|head|svg|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(?:br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|header|footer|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(withoutActiveContent);
}

export function normalizeEmailContent(text?: string | null, html?: string | null): string {
  const source = text?.trim() ? text : html ? htmlToText(html) : '';
  return source
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_NORMALIZED_CHARS);
}

export async function parseRawEmail(
  raw: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array | string,
): Promise<{
  text: string;
  pdfAttachments: Uint8Array[];
  csvAttachments: { bytes: Uint8Array; filename: string; mimeType: string }[];
}> {
  const email = await PostalMime.parse(raw, { attachmentEncoding: 'arraybuffer' });
  const text = normalizeEmailContent(email.text, email.html);
  const bytes = (content: ArrayBuffer | Uint8Array | string): Uint8Array => {
    if (content instanceof Uint8Array) return content;
    if (typeof content !== 'string') return new Uint8Array(content);
    const binary = atob(content);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  };
  const attachments = email.attachments ?? [];
  const pdfAttachments = attachments
    .filter((attachment) =>
      attachment.mimeType === 'application/pdf' || /\.pdf$/i.test(attachment.filename ?? ''),
    )
    .map((attachment) => bytes(attachment.content));
  const csvAttachments = attachments
    .filter((attachment) => {
      const filename = attachment.filename ?? '';
      return (
        attachment.mimeType === 'text/csv' ||
        attachment.mimeType === 'application/csv' ||
        attachment.mimeType === 'text/tab-separated-values' ||
        /\.(?:csv|tsv)$/i.test(filename)
      );
    })
    .map((attachment) => ({
      bytes: bytes(attachment.content),
      filename: attachment.filename ?? '',
      mimeType: attachment.mimeType ?? 'application/octet-stream',
    }));
  return { text, pdfAttachments, csvAttachments };
}

type StatementCurrency = 'AED' | 'SAR';

export interface StatementCsvResult {
  rows: ParsedSms[];
  totalRows: number;
  rejectedRows: number;
}

const HEADER_ALIASES = {
  date: [
    'transaction date', 'posting date', 'posted date', 'value date', 'txn date', 'date',
    'تاريخ العملية', 'تاريخ القيد', 'التاريخ',
  ],
  description: [
    'transaction description', 'transaction details', 'description', 'details', 'narration',
    'particulars', 'merchant', 'remarks', 'تفاصيل العملية', 'البيان', 'الوصف', 'التفاصيل',
  ],
  debit: [
    'debit amount', 'amount debited', 'withdrawal amount', 'withdrawals', 'withdrawal',
    'paid out', 'debit', 'مبلغ مدين', 'المسحوبات', 'مدين', 'خصم',
  ],
  credit: [
    'credit amount', 'amount credited', 'deposit amount', 'deposits', 'deposit', 'paid in',
    'credit', 'مبلغ دائن', 'الإيداعات', 'دائن', 'إيداع',
  ],
  amount: ['transaction amount', 'amount', 'مبلغ العملية', 'المبلغ'],
  direction: [
    'debit credit', 'dr cr', 'transaction type', 'direction', 'type',
    'نوع العملية', 'نوع القيد', 'النوع',
  ],
  currency: ['currency code', 'transaction currency', 'currency', 'ccy', 'curr', 'العملة'],
} as const;

function normalizedHeader(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function headerIndex(headers: string[], aliases: readonly string[]): number {
  for (const alias of aliases) {
    const index = headers.indexOf(normalizedHeader(alias));
    if (index >= 0) return index;
  }
  return -1;
}

function delimiterCount(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    if (line[index] === '"') {
      if (quoted && line[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && line[index] === delimiter) {
      count += 1;
    }
  }
  return count;
}

function csvDelimiter(text: string): string | null {
  const header = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  const candidates = [',', '\t', ';']
    .map((delimiter) => ({ delimiter, count: delimiterCount(header, delimiter) }))
    .sort((left, right) => right.count - left.count);
  return candidates[0].count > 0 ? candidates[0].delimiter : null;
}

function normalizeDigits(value: string): string {
  const arabic = '٠١٢٣٤٥٦٧٨٩';
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  return value
    .replace(/[\u0660-\u0669]/g, (digit) => String(arabic.indexOf(digit)))
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(persian.indexOf(digit)))
    .replace(/\u066b/g, '.')
    .replace(/\u066c/g, ',');
}

function statementCurrency(value: string): StatementCurrency | null {
  const normalized = normalizeDigits(value).normalize('NFKC').trim().toUpperCase();
  if (/^(?:AED|DHS?|D\.E|DIRHAMS?|د\.?\s*إ|درهم(?: إماراتي)?)$/iu.test(normalized)) return 'AED';
  if (/^(?:SAR|SR|S\.R|RIYALS?|ر\.?\s*س|ريال(?: سعودي)?)$/iu.test(normalized)) return 'SAR';
  return null;
}

function amountMinor(value: string, currency: StatementCurrency, signed: boolean): number | null {
  let normalized = normalizeDigits(value).normalize('NFKC').replace(/[\s\u00a0]+/g, ' ').trim();
  if (!normalized || /^(?:-|--|N\/?A|0(?:\.0{1,2})?)$/i.test(normalized)) return null;
  const explicit = /(?:AED|DHS?|D\.E|DIRHAMS?|د\.?\s*إ|درهم(?: إماراتي)?|SAR|SR|S\.R|RIYALS?|ر\.?\s*س|ريال(?: سعودي)?)/iu.exec(normalized)?.[0];
  if (explicit && statementCurrency(explicit) !== currency) return null;
  normalized = normalized
    .replace(/^(?:AED|DHS?|D\.E|DIRHAMS?|د\.?\s*إ|درهم(?: إماراتي)?|SAR|SR|S\.R|RIYALS?|ر\.?\s*س|ريال(?: سعودي)?)\s*/iu, '')
    .replace(/\s*(?:AED|DHS?|D\.E|DIRHAMS?|د\.?\s*إ|درهم(?: إماراتي)?|SAR|SR|S\.R|RIYALS?|ر\.?\s*س|ريال(?: سعودي)?)$/iu, '')
    .trim();
  const match = (signed ? /^([+-])((?:\d{1,3}(?:,\d{3})+|\d+))(?:\.(\d{1,2}))?$/ : /^((?:\d{1,3}(?:,\d{3})+|\d+))(?:\.(\d{1,2}))?$/).exec(normalized);
  if (!match) return null;
  const sign = signed ? match[1] : '+';
  const whole = (signed ? match[2] : match[1]).replace(/,/g, '');
  const fraction = (signed ? match[3] : match[2]) ?? '';
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor <= 0) return null;
  return sign === '-' ? -minor : minor;
}

function rowDirection(value: string): 'expense' | 'income' | null {
  const normalized = normalizedHeader(value);
  if (/^(?:dr|d|debit|withdrawal|withdrawn|paid out|مدين|خصم|سحب)$/.test(normalized)) return 'expense';
  if (/^(?:cr|c|credit|deposit|deposited|paid in|دائن|إيداع)$/.test(normalized)) return 'income';
  return null;
}

export function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new Error('invalid_csv');
  }
}

/**
 * Parse an exported statement with named columns. Direction must be explicit:
 * separate debit/credit columns, an amount plus direction column, or a signed
 * amount on every accepted row. Unmarked positive amounts are never guessed.
 */
export function parseStatementCsv(
  text: string,
  defaultCurrency: StatementCurrency,
  maxRows = 200,
): StatementCsvResult {
  const delimiter = csvDelimiter(text);
  if (!delimiter) throw new Error('invalid_csv');
  let records: string[][];
  try {
    records = parseCsvRecords(text, {
      bom: true,
      delimiter,
      max_record_size: MAX_CSV_RECORD_CHARS,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    }) as string[][];
  } catch {
    throw new Error('invalid_csv');
  }
  if (records.length < 2 || records[0].length < 3 || records[0].length > 64) {
    throw new Error('unsupported_statement_format');
  }
  const totalRows = records.length - 1;
  if (totalRows > maxRows) throw new Error('too_many_rows');
  const headers = records[0].map(normalizedHeader);
  if (new Set(headers).size !== headers.length || headers.some((header) => !header)) {
    throw new Error('invalid_csv');
  }
  const dateIndex = headerIndex(headers, HEADER_ALIASES.date);
  const descriptionIndex = headerIndex(headers, HEADER_ALIASES.description);
  const debitIndex = headerIndex(headers, HEADER_ALIASES.debit);
  const creditIndex = headerIndex(headers, HEADER_ALIASES.credit);
  const amountIndex = headerIndex(headers, HEADER_ALIASES.amount);
  const directionIndex = headerIndex(headers, HEADER_ALIASES.direction);
  const currencyIndex = headerIndex(headers, HEADER_ALIASES.currency);
  const splitColumns = debitIndex >= 0 && creditIndex >= 0;
  const directedAmount = amountIndex >= 0 && directionIndex >= 0;
  const signedAmount = amountIndex >= 0 && directionIndex < 0;
  if (dateIndex < 0 || descriptionIndex < 0 || (!splitColumns && !directedAmount && !signedAmount)) {
    throw new Error('unsupported_statement_format');
  }

  const rows: ParsedSms[] = [];
  let rejectedRows = 0;
  for (const record of records.slice(1)) {
    if (record.length !== headers.length) {
      rejectedRows += 1;
      continue;
    }
    const date = isoDate(record[dateIndex] ?? '');
    const description = record[descriptionIndex] ?? '';
    const unsafeDescription = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(description);
    const merchant = description.normalize('NFKC').replace(/\s+/g, ' ').trim();
    const currency: StatementCurrency | null = currencyIndex >= 0
      ? statementCurrency(record[currencyIndex] ?? '')
      : defaultCurrency;
    let type: 'expense' | 'income' | null = null;
    let minor: number | null = null;
    if (currency === defaultCurrency && splitColumns) {
      const debit = amountMinor(record[debitIndex] ?? '', currency, false);
      const credit = amountMinor(record[creditIndex] ?? '', currency, false);
      if ((debit === null) !== (credit === null)) {
        type = debit === null ? 'income' : 'expense';
        minor = debit ?? credit;
      }
    } else if (currency === defaultCurrency && directedAmount) {
      type = rowDirection(record[directionIndex] ?? '');
      minor = amountMinor(record[amountIndex] ?? '', currency, false);
    } else if (currency === defaultCurrency && signedAmount) {
      const signedMinor = amountMinor(record[amountIndex] ?? '', currency, true);
      if (signedMinor !== null) {
        type = signedMinor < 0 ? 'expense' : 'income';
        minor = Math.abs(signedMinor);
      }
    }
    if (
      !date || unsafeDescription || merchant.length < 2 || merchant.length > 180 ||
      !type || !minor
    ) {
      rejectedRows += 1;
      continue;
    }
    const classification = classifyMerchantDescription(
      merchant,
      type,
      defaultCurrency === 'AED' ? 'AE' : 'SA',
    );
    rows.push({
      kind: 'transaction', type, amountFils: minor, currency: defaultCurrency,
      merchant: classification.merchant, date,
      dueDay: null, minDueFils: null, card: null, reference: null, transferHint: false,
      snapshotFils: null, snapshotKind: null,
      categoryGuess: classification.categoryGuess,
      categoryDeliberate: classification.categoryDeliberate,
      raw: record.join(delimiter),
    });
  }
  return { rows, totalRows, rejectedRows };
}

function isoDate(value: string): string | null {
  value = normalizeDigits(value).trim();
  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) {
    year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
  } else {
    const local = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/.exec(value);
    if (!local) return null;
    day = Number(local[1]); month = Number(local[2]); year = Number(local[3]);
    if (year < 100) year += 2000;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 2000 || year > 2100 || date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Conservative statement-row parser. It accepts only rows that explicitly
 * label debit/credit direction; a bare amount in a visual column is rejected
 * rather than guessed after PDF layout has been flattened to text.
 */
export function parseStatementText(
  text: string,
  currency: StatementCurrency = 'AED',
): ParsedSms[] {
  const rows: ParsedSms[] = [];
  for (const original of text.split(/\n+/)) {
    const line = original.replace(/\s+/g, ' ').trim();
    if (!line || line.length > 400) continue;
    const match = ROW_END_DIRECTION.exec(line) ?? ROW_MIDDLE_DIRECTION.exec(line);
    if (!match) continue;
    const explicitCurrency = /\s(AED|SAR)\s+[\d,]+(?:\.\d{2})?(?:\s+(?:DR|CR|DEBIT|CREDIT))?$/i
      .exec(line)?.[1]?.toUpperCase();
    if (explicitCurrency && explicitCurrency !== currency) continue;
    const date = isoDate(match[1]);
    if (!date) continue;
    const merchant = match[2].replace(/\s+/g, ' ').trim();
    const endDirection = /^(?:DR|CR|DEBIT|CREDIT)$/i.test(match[4] ?? '');
    const amountText = endDirection ? match[3] : match[4];
    const direction = (endDirection ? match[4] : match[3]).toUpperCase();
    const amountFils = Math.round(Number(amountText.replace(/,/g, '')) * 100);
    if (!Number.isSafeInteger(amountFils) || amountFils <= 0 || !merchant) continue;
    const type = direction === 'CR' || direction === 'CREDIT' ? 'income' : 'expense';
    const classification = classifyMerchantDescription(
      merchant,
      type,
      currency === 'AED' ? 'AE' : 'SA',
    );
    rows.push({
      kind: 'transaction', type, amountFils, currency,
      merchant: classification.merchant, date,
      dueDay: null, minDueFils: null, card: null, reference: null, transferHint: false,
      snapshotFils: null, snapshotKind: null,
      categoryGuess: classification.categoryGuess,
      categoryDeliberate: classification.categoryDeliberate,
      raw: line,
    });
  }
  return rows;
}

export async function extractPdfStatementRows(
  bytes: Uint8Array,
  currency: StatementCurrency = 'AED',
): Promise<{
  pages: number;
  rows: ParsedSms[];
}> {
  const document = await getDocumentProxy(bytes);
  try {
    const extracted = await extractText(document, { mergePages: true });
    if (extracted.text.length > MAX_NORMALIZED_CHARS) throw new Error('PDF text exceeds limit');
    return { pages: extracted.totalPages, rows: parseStatementText(extracted.text, currency) };
  } finally {
    const disposable = document as unknown as {
      destroy?: () => Promise<void> | void;
      cleanup?: () => Promise<void> | void;
    };
    if (disposable.destroy) await disposable.destroy();
    else if (disposable.cleanup) await disposable.cleanup();
  }
}
