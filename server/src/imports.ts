/** In-memory normalization for forwarded bank email and text-based statements. */
import PostalMime from 'postal-mime';
import { parse as parseCsvRecords } from 'csv-parse/sync';
import { extractText, getDocumentProxy } from 'unpdf';

import { classifyMerchantDescription, type ParsedSms } from '@/lib/sms-parser';
import { ledgerMoneySpec } from '@/lib/ledger-money';
import type { TransferEvidence } from '@/lib/transfer-reconciliation-types';

const MAX_NORMALIZED_CHARS = 128_000;
const MAX_CSV_RECORD_CHARS = 8_192;
/** How many leading CSV records may precede the header row (bank preambles). */
const MAX_CSV_PREAMBLE_RECORDS = 10;
const MONTH_NAME = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
// ISO, numeric day/month (order inferred per file, see inferDateOrder), and the
// `03-Apr-2026` / `3 Apr 2026` spelling many Gulf bank PDFs print.
const DATE_TOKEN = String.raw`(?:\d{4}-\d{2}-\d{2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{1,2}[\s-]${MONTH_NAME}[\s-]\d{2,4})`;
const DATE_LED_LINE = new RegExp(`^${DATE_TOKEN}\\s`, 'i');
// Statement money follows the ledger's ISO exponent (0, 2 or 3), not a Gulf
// hard-code. This permissive row lexer is narrowed again by amountMinor(),
// which validates grouping, currency and exact fractional precision.
const AMOUNT_TOKEN = String.raw`(?:(?:[A-Z]{3})\s*)?([\d,]+(?:\.\d{1,3})?)`;
const ROW_END_DIRECTION = new RegExp(
  `^(${DATE_TOKEN})\\s+(.{2,180}?)\\s+${AMOUNT_TOKEN}\\s+(DR|CR|DEBIT|CREDIT)$`,
  'i',
);
const ROW_MIDDLE_DIRECTION = new RegExp(
  `^(${DATE_TOKEN})\\s+(.{2,180}?)\\s+(DR|CR|DEBIT|CREDIT)\\s+${AMOUNT_TOKEN}$`,
  'i',
);
const ROW_DATE_PREFIX = new RegExp(`^(${DATE_TOKEN})\\s+(.+)$`, 'i');
/** A row's own date followed by its posting/value date — two columns, not prose. */
const DUAL_DATE_PREFIX = new RegExp(`^(${DATE_TOKEN})\\s+${DATE_TOKEN}\\s+(?=\\S)`, 'i');
// The column branch (parseColumnTail) insists on a decimal point: a bare
// integer at the end of a flattened PDF row is as likely a cheque or reference
// number as money. One decimal place is still money — real statements print
// `32.8` and `715.0`, and requiring two rejected every such row.
// What an empty debit or credit cell becomes once a PDF table is flattened.
const MONEY_PLACEHOLDER = /^(?:-|--|0|0\.0|0\.00|0\.000)$/;
const LOOKS_LIKE_MONEY_LINE = new RegExp(`\\d\\.\\d{1,3}(?:\\D|$)|\\b(?:DR|CR|DEBIT|CREDIT)\\b|\\b[A-Z]{3}\\s+\\d+`, 'i');
// Opening/closing balance, brought/carried forward and total lines carry money
// but are not transactions. A "Balance B/F 1,000.00 CR" would otherwise file
// as income and a "Total 40.00 0.00" as a second expense, and counting them as
// rejected would overstate what the user is missing. Anchored to the start of
// the description so a merchant merely containing the word is untouched.
// "Total" only counts when a figure, a colon or a totals word follows it;
// "TOTAL ENERGIES FUEL 120.00" is a merchant.
const SUMMARY_DESCRIPTION = /^(?:(?:opening|closing|new|previous|prev)\s+balance\b|balance\s+(?:b\/?f|c\/?f|brought|carried|outstanding)\b|(?:brought|carried)\s+forward\b|(?:sub)?totals?(?=\s*(?:$|:|(?:[A-Z]{3})?\s*[\d,]+(?:\.\d{1,3})?\b)|\s+(?:debits?|credits?|amounts?|for|of)\b)|الرصيد الافتتاحي|الرصيد الختامي|الإجمالي|المجموع)/iu;
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

type StatementCurrency = string;

type StatementParsedRow = ParsedSms & { transferEvidence?: TransferEvidence };

export interface StatementCsvResult {
  rows: StatementParsedRow[];
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
  sourceAccount: [
    'source account number', 'source account no', 'from account number', 'from account no',
    'debit account number', 'debit account no', 'account number', 'account no', 'account no.',
    'a/c number', 'masked account number', 'رقم الحساب', 'الحساب المصدر',
  ],
  sourceCard: [
    'source card number', 'source card no', 'credit card number', 'card number', 'card no',
    'card no.', 'masked card number', 'رقم البطاقة',
  ],
  reference: [
    'transaction reference', 'transaction ref', 'transaction id', 'txn reference', 'txn ref',
    'reference number', 'reference no', 'reference', 'ref no', 'trace number', 'trace id',
    'رقم المرجع', 'مرجع العملية', 'رقم العملية',
  ],
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

/**
 * Pick the delimiter from the leading lines rather than the first one alone:
 * bank exports often open with a preamble ("Account statement",
 * "Account: XXXX1234") that has no delimiter at all. The delimiter that
 * appears on the most lines wins — the table's own separator recurs on every
 * row, while a stray `;` inside one description or one preamble line does
 * not — and the widest line breaks a tie.
 */
function csvDelimiter(text: string): string | null {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/, MAX_CSV_PREAMBLE_RECORDS + 1);
  const candidates = [',', '\t', ';']
    .map((delimiter) => {
      const counts = lines.map((line) => delimiterCount(line, delimiter));
      return {
        delimiter,
        lines: counts.filter((count) => count > 0).length,
        count: Math.max(...counts),
      };
    })
    .sort((left, right) => right.lines - left.lines || right.count - left.count);
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

function maskedTail(value: string): string | null {
  const normalized = normalizeDigits(value).normalize('NFKC').trim();
  if (!normalized || normalized.length > 128 || /[\u0000-\u001f\u007f-\u009f]/.test(normalized)) return null;
  const compact = normalized.replace(/[\s._/-]+/g, '');
  const tail = compact.match(/(\d{4})$/)?.[1] ?? null;
  if (!tail) return null;
  const digitCount = compact.replace(/\D/g, '').length;
  return digitCount >= 4 && digitCount <= 34 ? tail : null;
}

type StatementInstrument = NonNullable<ParsedSms['card']>;

/** Statement-wide identity from explicitly labelled document metadata only. */
function statementInstrument(text: string): StatementInstrument | null {
  const normalized = normalizeDigits(text).normalize('NFKC');
  const labelled = (
    kind: StatementInstrument['kind'],
    pattern: RegExp,
  ): StatementInstrument | null => {
    const match = pattern.exec(normalized);
    if (!match?.[1]) return null;
    const last4 = maskedTail(match[1]);
    return last4 ? { last4, kind } : null;
  };
  return labelled(
    'credit',
    /\bcredit\s+card\s+(?:number|no\.?|ending(?:\s+(?:in|with))?)\s*[:#-]?\s*([*xX•\s-]*\d(?:[*xX•\s-]*\d){3,23})/i,
  ) ?? labelled(
    'unknown',
    /\bcard\s+(?:number|no\.?|ending(?:\s+(?:in|with))?)\s*[:#-]?\s*([*xX•\s-]*\d(?:[*xX•\s-]*\d){3,23})/i,
  ) ?? labelled(
    'account',
    /\b(?:account|a\/c)\s+(?:number|no\.?|ending(?:\s+(?:in|with))?)\s*[:#-]?\s*([*xX•\s-]*\d(?:[*xX•\s-]*\d){3,23})/i,
  );
}

function statementBankHint(text: string): string | undefined {
  if (/\bHSBC\b/i.test(text)) return 'HSBC';
  return undefined;
}

function safeStatementReference(value: string): string | null {
  const normalized = normalizeDigits(value).normalize('NFKC').trim().toUpperCase();
  if (!normalized || normalized.length > 96 || /[\u0000-\u001f\u007f-\u009f]/.test(normalized)) return null;
  const unlabelled = normalized.replace(
    /^(?:REF(?:ERENCE)?|TRANSACTION|TXN|TRACE)(?:\s+(?:ID|NO\.?|NUMBER|REF))?\s*[:#-]?\s*/i,
    '',
  );
  const compact = unlabelled.replace(/[\s/]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!/^[A-Z0-9][A-Z0-9-]{5,39}$/.test(compact) || !/\d/.test(compact)) return null;
  if (/^\d{12,}$/.test(compact) || /^[A-Z]{2}\d{2}[A-Z0-9]{10,}$/.test(compact.replace(/-/g, '')) ||
      /^(?:19|20)\d{2}-?(?:0[1-9]|1[0-2])-?(?:0[1-9]|[12]\d|3[01])$/.test(compact)) return null;
  return compact;
}

function referenceFromDescription(description: string): string | null {
  const match = normalizeDigits(description).match(
    /\b(?:ref(?:erence)?|transaction\s+(?:id|ref(?:erence)?)|txn\s+(?:id|ref)|trace\s+(?:id|no\.?|number))\s*[:#-]?\s*([A-Z0-9][A-Z0-9\s/-]{5,48})/i,
  );
  return match ? safeStatementReference(match[1]) : null;
}

function statementCounterparty(
  description: string,
  type: 'expense' | 'income',
): TransferEvidence['counterparty'] {
  const text = normalizeDigits(description).normalize('NFKC');
  const direction = type === 'expense'
    ? String.raw`(?:to|beneficiary|destination|payee)`
    : String.raw`(?:from|sender|originator|ordering\s+party)`;
  const match = new RegExp(
    String.raw`\b${direction}\b[\s:,-]{0,12}(?:(account|acct|a\/c|iban|card)\b[\s:#-]*)?([Xx*•·\d][Xx*•·\d .\/-]{2,48}\d{4})(?!\d)`,
    'i',
  ).exec(text);
  if (!match) return undefined;
  const last4 = maskedTail(match[2]);
  if (!last4) return undefined;
  return { last4, kind: (match[1] ?? '').toLowerCase() === 'card' ? 'unknown' : 'account' };
}

function statementTransferMeaning(
  description: string,
  type: 'expense' | 'income',
  currency: StatementCurrency,
  source: ParsedSms['card'],
  explicitReference?: string | null,
): Pick<StatementParsedRow, 'merchant' | 'transferHint'> & { transferEvidence?: TransferEvidence } | null {
  const text = normalizeDigits(description).normalize('NFKC');
  const isTransfer = /\b(?:transfer|remittance|wire|telegraphic\s+transfer|funds?\s+transfer|instant\s+transfer|internal\s+transfer)\b/i.test(text) ||
    /(?:تحويل|حوالة)/u.test(text);
  // A fee/commission about a transfer is its own expense, not the movement.
  // Refuse that semantic promotion rather than hiding a real bank charge from spending.
  const transferCharge = /\b(?:transfer|remittance|wire)\b[\s\S]{0,36}\b(?:fee|fees|charge|commission|vat)\b|\b(?:fee|fees|charge|commission|vat)\b[\s\S]{0,36}\b(?:transfer|remittance|wire)\b/i.test(text) ||
    /(?:رسوم|عمولة)[^\n]{0,36}(?:تحويل|حوالة)|(?:تحويل|حوالة)[^\n]{0,36}(?:رسوم|عمولة)/u.test(text);
  if (!isTransfer || transferCharge) return null;
  const explicitOwn = /\b(?:own|self|internal)\s+(?:account\s+)?transfer\b|\bbetween\s+(?:my|own)\s+accounts\b/i.test(text) ||
    /تحويل\s+(?:بين\s+)?حساب(?:ات)?(?:ي|ك)/u.test(text);
  const reference = explicitReference ?? referenceFromDescription(description);
  const counterparty = statementCounterparty(description, type);
  return {
    merchant: explicitOwn ? 'Own account transfer' : type === 'expense' ? 'Outgoing transfer' : 'Incoming transfer',
    transferHint: true,
    transferEvidence: {
      version: 1,
      currency,
      attribution: source ? 'source' : 'fallback',
      statement: true,
      ...(reference ? { reference } : {}),
      ...(counterparty ? { counterparty } : {}),
      ...(explicitOwn ? { explicitOwn: true } : {}),
    },
  };
}

function uniqueColumnInstrument(
  records: string[][],
  index: number,
  kind: 'account' | 'unknown',
): ParsedSms['card'] {
  if (index < 0) return null;
  const tails = new Set(
    records
      .map((record) => maskedTail(record[index] ?? ''))
      .filter((tail): tail is string => tail !== null),
  );
  return tails.size === 1 ? { last4: [...tails][0], kind } : null;
}

function statementHeaderInstrument(text: string): ParsedSms['card'] {
  const lines = text.split(/\n+/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const found = new Map<string, NonNullable<ParsedSms['card']>>();
  for (const line of lines.slice(0, 80)) {
    if (ROW_END_DIRECTION.test(line) || ROW_MIDDLE_DIRECTION.test(line)) break;
    for (const candidate of [
      { kind: 'account' as const, re: /\b(?:account|acct|a\/c|iban)(?:\s+(?:no\.?|number))?\s*[:#-]?\s*([Xx*•·\d][Xx*•·\d .\/-]{2,48}\d{4})(?!\d)/i },
      { kind: 'unknown' as const, re: /\bcard(?:\s+(?:no\.?|number))?\s*[:#-]?\s*([Xx*•·\d][Xx*•·\d .\/-]{2,48}\d{4})(?!\d)/i },
    ]) {
      const match = candidate.re.exec(normalizeDigits(line));
      const last4 = match ? maskedTail(match[1]) : null;
      if (last4) found.set(`${candidate.kind}:${last4}`, { last4, kind: candidate.kind });
    }
  }
  return found.size === 1 ? [...found.values()][0] : null;
}

function statementCurrency(value: string): StatementCurrency | null {
  const normalized = normalizeDigits(value).normalize('NFKC').trim().toUpperCase();
  if (/^(?:AED|DHS?|D\.E|DIRHAMS?|د\.?\s*إ|درهم(?: إماراتي)?)$/iu.test(normalized)) return 'AED';
  if (/^(?:SAR|SR|S\.R|RIYALS?|ر\.?\s*س|ريال(?: سعودي)?)$/iu.test(normalized)) return 'SAR';
  return /^[A-Z]{3}$/.test(normalized) && ledgerMoneySpec(normalized) ? normalized : null;
}

function amountMinor(value: string, currency: StatementCurrency, signed: boolean): number | null {
  let normalized = normalizeDigits(value).normalize('NFKC').replace(/[\s\u00a0]+/g, ' ').trim();
  const spec = ledgerMoneySpec(currency);
  if (!spec || !normalized || /^(?:-|--|N\/?A|0(?:\.0{1,3})?)$/i.test(normalized)) return null;

  let negative = false;
  let explicitSign = false;
  if (/^\(.+\)$/.test(normalized)) {
    negative = true;
    explicitSign = true;
    normalized = normalized.slice(1, -1).trim();
  }
  const takeSign = () => {
    const prefix = /^([+-])/.exec(normalized)?.[1];
    const suffix = /([+-])$/.exec(normalized)?.[1];
    const sign = prefix ?? suffix;
    if (!sign) return;
    explicitSign = true;
    negative = sign === '-';
    normalized = prefix ? normalized.slice(1).trim() : normalized.slice(0, -1).trim();
  };
  takeSign();

  // Amount cells may carry either a canonical ISO code or the two launch-era
  // local aliases. Currency evidence is checked, never used to change the
  // requested ledger denomination.
  const localAlias = String.raw`(?:AED|DHS?|D\.E|DIRHAMS?|د\.?\s*إ|درهم(?: إماراتي)?|SAR|SR|S\.R|RIYALS?|ر\.?\s*س|ريال(?: سعودي)?|[A-Z]{3})`;
  const prefixCurrency = new RegExp(`^(${localAlias})\\s*`, 'iu').exec(normalized)?.[1];
  if (prefixCurrency) {
    if (statementCurrency(prefixCurrency) !== currency) return null;
    normalized = normalized.slice(prefixCurrency.length).trim();
  } else {
    const suffixCurrency = new RegExp(`\\s*(${localAlias})$`, 'iu').exec(normalized)?.[1];
    if (suffixCurrency) {
      if (statementCurrency(suffixCurrency) !== currency) return null;
      normalized = normalized.slice(0, normalized.length - suffixCurrency.length).trim();
    }
  }
  // Also accept sign placement immediately after/before a currency code.
  takeSign();
  if (signed !== explicitSign) return null;

  const fractionPattern = spec.exponent === 0 ? '' : `(?:\\.(\\d{1,${spec.exponent}}))?`;
  const match = new RegExp(`^((?:\\d{1,3}(?:,\\d{3})+|\\d+))${fractionPattern}$`).exec(normalized);
  if (!match) return null;
  const whole = match[1].replace(/,/g, '');
  const fraction = spec.exponent === 0 ? '' : (match[2] ?? '');
  let minor: bigint;
  try {
    minor = BigInt(whole) * BigInt(10 ** spec.exponent) +
      BigInt((fraction || '').padEnd(spec.exponent, '0') || '0');
  } catch {
    return null;
  }
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const valueMinor = Number(minor);
  return negative ? -valueMinor : valueMinor;
}

function rowDirection(value: string): 'expense' | 'income' | null {
  const normalized = normalizedHeader(value);
  if (/^(?:dr|d|debit|withdrawal|withdrawn|paid out|مدين|خصم|سحب)$/.test(normalized)) return 'expense';
  if (/^(?:cr|c|credit|deposit|deposited|paid in|دائن|إيداع)$/.test(normalized)) return 'income';
  return null;
}

/**
 * Decode an exported statement without guessing past what the bytes say.
 * A UTF-16 BOM names its encoding outright (Excel "Unicode text" exports);
 * otherwise the file is UTF-8, or — when it is not valid UTF-8 — the single-byte
 * Windows encoding older bank portals still emit. Replacement characters are
 * never produced: a byte sequence that decodes to NUL is binary, not a table.
 */
export function decodeCsv(bytes: Uint8Array): string {
  let text: string;
  try {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      text = new TextDecoder('utf-16le', { fatal: true, ignoreBOM: false }).decode(bytes);
    } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      text = new TextDecoder('utf-16be', { fatal: true, ignoreBOM: false }).decode(bytes);
    } else {
      try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
      } catch {
        text = new TextDecoder('windows-1252', { fatal: true, ignoreBOM: false }).decode(bytes);
      }
    }
  } catch {
    throw new Error('invalid_csv');
  }
  // Both decoders strip their own BOM; a stray one inside the body is not text.
  text = text.replace(/^\uFEFF/, '');
  if (text.includes('\u0000')) throw new Error('invalid_csv');
  return text;
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
  if (!ledgerMoneySpec(defaultCurrency)) throw new Error('unsupported_statement_currency');
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
  // The header is the first leading record that names a date column AND a money
  // column, not necessarily the first record: bank exports open with account
  // preambles, and a blank or repeated header cell is a column to ignore (first
  // occurrence wins), not grounds to refuse the whole file.
  const headerRow = records.slice(0, MAX_CSV_PREAMBLE_RECORDS).findIndex((record) => {
    const candidate = record.map(normalizedHeader);
    return candidate.length >= 3 && candidate.length <= 64 &&
      headerIndex(candidate, HEADER_ALIASES.date) >= 0 && (
        headerIndex(candidate, HEADER_ALIASES.amount) >= 0 ||
        headerIndex(candidate, HEADER_ALIASES.debit) >= 0 ||
        headerIndex(candidate, HEADER_ALIASES.credit) >= 0
      );
  });
  if (headerRow < 0 || records.length < headerRow + 2) {
    throw new Error('unsupported_statement_format');
  }
  const dataRecords = records.slice(headerRow + 1);
  const totalRows = dataRecords.length;
  if (totalRows > maxRows) throw new Error('too_many_rows');
  const headers = records[headerRow].map(normalizedHeader);
  const dateIndex = headerIndex(headers, HEADER_ALIASES.date);
  const descriptionIndex = headerIndex(headers, HEADER_ALIASES.description);
  const debitIndex = headerIndex(headers, HEADER_ALIASES.debit);
  const creditIndex = headerIndex(headers, HEADER_ALIASES.credit);
  const amountIndex = headerIndex(headers, HEADER_ALIASES.amount);
  const directionIndex = headerIndex(headers, HEADER_ALIASES.direction);
  const currencyIndex = headerIndex(headers, HEADER_ALIASES.currency);
  const sourceAccountIndex = headerIndex(headers, HEADER_ALIASES.sourceAccount);
  const sourceCardIndex = headerIndex(headers, HEADER_ALIASES.sourceCard);
  const referenceIndex = headerIndex(headers, HEADER_ALIASES.reference);
  const splitColumns = debitIndex >= 0 && creditIndex >= 0;
  const directedAmount = amountIndex >= 0 && directionIndex >= 0;
  const signedAmount = amountIndex >= 0 && directionIndex < 0;
  if (dateIndex < 0 || descriptionIndex < 0 || (!splitColumns && !directedAmount && !signedAmount)) {
    throw new Error('unsupported_statement_format');
  }
  // A source instrument column is useful only when the whole export identifies
  // one statement account/card. A varying column is transaction metadata, not
  // authority to route every row to a different local account.
  const sourceInstrument = sourceAccountIndex >= 0 && sourceCardIndex >= 0
    ? null
    : sourceAccountIndex >= 0
      ? uniqueColumnInstrument(dataRecords, sourceAccountIndex, 'account')
      : uniqueColumnInstrument(dataRecords, sourceCardIndex, 'unknown');
  const dateOrder = inferDateOrder(dataRecords.map((record) => record[dateIndex] ?? ''));

  const rows: StatementParsedRow[] = [];
  let rejectedRows = 0;
  for (const record of dataRecords) {
    if (record.length !== headers.length) {
      rejectedRows += 1;
      continue;
    }
    const date = isoDate(record[dateIndex] ?? '', dateOrder);
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
      // A `Type` column often carries the channel (POS, ATM, TRF) rather than
      // the direction. When the cell says nothing about direction but the
      // amount carries a sign, the sign is the explicit marker; when both
      // speak and disagree, neither is trusted.
      const labelled = rowDirection(record[directionIndex] ?? '');
      const unsignedMinor = amountMinor(record[amountIndex] ?? '', currency, false);
      const signedMinor = unsignedMinor === null
        ? amountMinor(record[amountIndex] ?? '', currency, true)
        : null;
      const signedType = signedMinor === null ? null : signedMinor < 0 ? 'expense' : 'income';
      if (labelled && signedType && labelled !== signedType) {
        type = null;
      } else {
        type = labelled ?? signedType;
        minor = unsignedMinor ?? (signedMinor === null ? null : Math.abs(signedMinor));
      }
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
      defaultCurrency === 'AED' ? 'AE' : defaultCurrency === 'SAR' ? 'SA' : null,
    );
    const reference = referenceIndex >= 0
      ? safeStatementReference(record[referenceIndex] ?? '')
      : referenceFromDescription(merchant);
    const rowAccountTail = sourceAccountIndex >= 0 ? maskedTail(record[sourceAccountIndex] ?? '') : null;
    const rowCardTail = sourceCardIndex >= 0 ? maskedTail(record[sourceCardIndex] ?? '') : null;
    const rowInstrument: ParsedSms['card'] = rowCardTail
      ? { last4: rowCardTail, kind: 'unknown' }
      : rowAccountTail
        ? { last4: rowAccountTail, kind: 'account' }
        : null;
    const transfer = statementTransferMeaning(
      merchant,
      type,
      defaultCurrency,
      sourceInstrument,
      reference,
    );
    rows.push({
      kind: 'transaction', type, amountFils: minor, currency: defaultCurrency,
      merchant: transfer?.merchant ?? classification.merchant, date,
      dueDay: null, minDueFils: null, card: rowInstrument, reference,
      transferHint: transfer?.transferHint ?? false,
      snapshotFils: null, snapshotKind: null,
      categoryGuess: transfer ? 'other' : classification.categoryGuess,
      categoryDeliberate: transfer ? true : classification.categoryDeliberate,
      ...(transfer?.transferEvidence ? { transferEvidence: transfer.transferEvidence } : {}),
      raw: record.join(delimiter),
    });
  }
  return { rows, totalRows, rejectedRows };
}

type DateOrder = 'day-first' | 'month-first';

/**
 * Decide how a file's numeric dates read. A first field above 12 can only be
 * a day; a second field above 12 can only be a month-first export. With no
 * evidence, or with contradictory evidence, keep the launch-tested UAE/KSA
 * DD/MM reading — the ambiguous rows then parse exactly as they did before.
 */
function inferDateOrder(values: Iterable<string>): DateOrder {
  let dayFirst = false;
  let monthFirst = false;
  for (const value of values) {
    const local = /^(\d{1,2})[\/-](\d{1,2})[\/-]\d{2,4}$/.exec(normalizeDigits(value).trim());
    if (!local) continue;
    if (Number(local[1]) > 12) dayFirst = true;
    if (Number(local[2]) > 12) monthFirst = true;
  }
  return monthFirst && !dayFirst ? 'month-first' : 'day-first';
}

const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function isoDate(value: string, order: DateOrder = 'day-first'): string | null {
  value = normalizeDigits(value).replace(/\s+/g, ' ').trim();
  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const named = new RegExp(`^(\\d{1,2})[\\s-](${MONTH_NAME})[\\s-](\\d{2,4})$`, 'i').exec(value);
  if (iso) {
    year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
  } else if (named) {
    day = Number(named[1]); month = MONTH_INDEX[named[2].slice(0, 3).toLowerCase()]; year = Number(named[3]);
    if (year < 100) year += 2000;
  } else {
    const local = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/.exec(value);
    if (!local) return null;
    if (order === 'month-first') {
      month = Number(local[1]); day = Number(local[2]);
    } else {
      day = Number(local[1]); month = Number(local[2]);
    }
    year = Number(local[3]);
    if (year < 100) year += 2000;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 2000 || year > 2100 || date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

type ColumnOrder = 'debit-first' | 'credit-first';

/**
 * Which of the two money columns comes first in this statement's table. Gulf
 * statements print Debit before Credit almost without exception; the header
 * line is checked anyway so the rare Credit | Debit layout is not read inverted.
 */
function statementColumnOrder(text: string): ColumnOrder {
  for (const original of text.split(/\n+/).slice(0, 120)) {
    const line = original.replace(/\s+/g, ' ').trim();
    // Only a table header counts. A header is a short run of column names —
    // date, a debit word, a credit word and at least one more column such as
    // balance or description — not a sentence. Prose in the preamble
    // ("Credits are listed before debits for each transaction date …") names
    // all three words too, and reading it as the header would invert every
    // sign in the file, so anything sentence-length or missing a fourth
    // column name is skipped and the Gulf default stands.
    if (!line || line.length > 120 || line.split(' ').length > 12 || DATE_LED_LINE.test(line)) continue;
    if (!/\bdate\b|تاريخ/iu.test(line) || /\b(?:credit|debit)\s+card\b|\bdirect\s+debit\b/i.test(line)) continue;
    if (!/\b(?:balance|description|details|particulars|narration|narrative|amount|reference)\b|الرصيد|البيان|التفاصيل|الوصف/iu.test(line)) continue;
    const debit = line.search(/\b(?:debits?|withdrawals?|paid out)\b|مدين|سحب/iu);
    const credit = line.search(/\b(?:credits?|deposits?|paid in)\b|دائن|إيداع/iu);
    if (debit < 0 || credit < 0) continue;
    return credit < debit ? 'credit-first' : 'debit-first';
  }
  return 'debit-first';
}

type MoneyToken =
  | { kind: 'placeholder' }
  | { kind: 'unsigned'; minor: number }
  | { kind: 'signed'; minor: number; type: 'expense' | 'income' };

function classifyMoneyToken(token: string, currency: StatementCurrency): MoneyToken | null {
  if (MONEY_PLACEHOLDER.test(token)) return { kind: 'placeholder' };
  const spec = ledgerMoneySpec(currency);
  if (!spec) return null;
  // Flattened PDF rows lose column boundaries. For decimal currencies, a bare
  // integer at the tail is more likely a cheque/reference number than money;
  // preserve the old conservative requirement for a decimal point. Zero-decimal
  // ledgers (JPY/KRW/etc.) necessarily use whole-unit money and are the exception.
  const numericSurface = token.replace(/[()\sA-Za-z+\-]/g, '');
  if (spec.exponent > 0 && !numericSurface.includes('.')) return null;
  // `21.40CR` — the accounting suffix printed hard against its figure, with no
  // space for the row lexer to split on. HSBC's card statement writes every
  // credit this way, so ROW_END_DIRECTION (which needs DR/CR as its own final
  // token) matched none of them. The suffix says the direction outright, which
  // is the one thing this parser will not guess at, so it is read wherever it
  // appears rather than behind a layout flag.
  //
  // BELOW the decimal-point guard, not above it: a trailing CR does not make a
  // reference number into money. `CHEQUE DEPOSIT REF 123456CR` read as income of
  // AED 123,456.00 when this branch ran first — money invented outright, and the
  // row not even counted as rejected.
  const suffixed = /^([\d,]+(?:\.\d{1,3})?)(DR|CR)$/i.exec(token);
  if (suffixed) {
    const minor = amountMinor(suffixed[1], currency, false);
    if (minor !== null) {
      return { kind: 'signed', minor, type: suffixed[2].toUpperCase() === 'CR' ? 'income' : 'expense' };
    }
  }
  const unsigned = amountMinor(token, currency, false);
  if (unsigned !== null) return { kind: 'unsigned', minor: unsigned };
  const signed = amountMinor(token, currency, true);
  return signed === null
    ? null
    : { kind: 'signed', minor: Math.abs(signed), type: signed < 0 ? 'expense' : 'income' };
}

/**
 * Read the money columns off the end of a flattened statement row without
 * guessing. Accepted shapes, after the description:
 *   signed [balance]             — `-125.00`, `125.00-`, `(125.00)`, `+125.00`
 *   debit credit [balance]       — one of the two populated, the other an
 *                                  empty-cell placeholder (`-`, `0.00`)
 * Anything else — a lone unsigned amount, both columns populated, a sign that
 * is not on the first money token, a currency that is not the statement's —
 * is left for the caller to count as rejected rather than read a direction in.
 */
/**
 * Whether this is a credit-card statement rather than an account statement.
 *
 * It matters because the two have opposite defaults. On an account statement an
 * unlabelled figure could be either direction, so `parseColumnTail` is right to
 * refuse it. A card statement lists charges and marks the exceptions: every
 * payment, refund and cashback carries CR, so an unlabelled row is a purchase,
 * and reading it as one is the convention rather than a guess.
 *
 * Two independent markers are required so that an account statement mentioning
 * a credit-card payment is not mistaken for one.
 */
function isCardStatement(text: string): boolean {
  const header = text.split(/\n+/).slice(0, 60).join('\n');
  const markers = [
    /\bcredit\s+card\s+statement\b/i,
    /\bminimum\s+(?:amount|payment)\s+due\b/i,
    /\b(?:available\s+)?credit\s+limit\b/i,
    /\bcard\s*(?:no\.?|number)\b/i,
    /\bbalance\s+outstanding\b/i,
    /\bstatement\s+(?:period|date)\b/i,
  ];
  return markers.filter((marker) => marker.test(header)).length >= 2;
}

/**
 * Whether this statement prices each row twice: what was charged, and what it
 * came to in the ledger's own currency.
 *
 * `Transaction Details | Original Amount | (+) VAT | Total Amount (AED)` is the
 * UAE card-statement table, and its last two or three figures are ONE charge
 * decomposed — not the debit/credit pair `parseColumnTail` reads. Told apart
 * only by the header naming both columns, because the rows themselves are
 * indistinguishable from a debit-and-balance pair, and reading `41.25 41.25` as
 * a debit of 41.25 and a credit of 41.25 would be a guess.
 *
 * Each label must stand as a column header ON ITS OWN LINE, and is looked for
 * through the whole file rather than a leading slice. Both halves of that are
 * load-bearing. A multi-page statement repeats its table head above each page's
 * rows, which on the reported file first appears at line 234 of 701 — a header
 * window would never have seen it. And the same words appear in the small print
 * further down ("Total Amount Payable on this Statement date", "the total
 * amount of Minimum Payment Due"), where they describe the bill rather than
 * name a column; a substring test over the whole text matches those too and
 * would switch this layout on for any statement carrying the usual terms.
 *
 * A bilingual head interleaves each English name with its Arabic twin, and the
 * extractor sometimes glues the pair into one line, so Arabic is stripped
 * before the line is compared. Anything else left on the line — a word of
 * prose, another column's name — means this is not that header.
 */
const COLUMN_LABEL_ONLY = /^[(\s]*([a-z][a-z ]*[a-z])[)\s]*(?:\([A-Z]{3}\))?$/i;

/**
 * What the two columns are called, which is not one thing per bank.
 *
 * The same table is printed under several names — what the card was charged
 * ("original amount", "transaction amount") beside what it settled to in the
 * ledger's own currency ("total amount", "billing amount", "amount in AED").
 * Keyed on the ledger's currency rather than a Gulf hard-code, so a SAR or USD
 * statement naming its column that way is read on the same terms.
 */
const CHARGED_AMOUNT_LABELS = [
  'original amount', 'transaction amount', 'foreign currency amount', 'original currency amount',
];
const settlementAmountLabels = (currency: StatementCurrency): string[] => {
  const code = currency.toLowerCase();
  return ['total amount', 'billing amount', 'settlement amount', `amount in ${code}`, `${code} amount`];
};

/** Every standalone column-header label in the file, in the order they appear. */
function columnHeaderLabels(text: string): string[] {
  const labels: string[] = [];
  for (const original of text.split(/\n+/)) {
    const line = original.replace(/[\p{Script=Arabic}\u200f\u200e]/gu, '').replace(/\s+/g, ' ').trim();
    if (!line || line.length > 40) continue;
    const label = COLUMN_LABEL_ONLY.exec(line)?.[1];
    if (label) labels.push(label.toLowerCase());
  }
  return labels;
}

/**
 * ORDER matters, not just presence.
 *
 * `parseOriginalTotalTail` reads the LAST figure on the row, which is only the
 * settlement amount while the settlement column is the rightmost of the two.
 * A statement printing `Billing Amount | Transaction Amount` puts the foreign
 * figure last, and reading that as the charge would file a USD number as AED —
 * money wrong, silently. Whichever label the header states last is the column
 * the last figure belongs to, so this returns true only when that is the
 * settlement one. The other order is left to the branches that demand an
 * explicit direction rather than read a position.
 */
function hasOriginalAndTotalColumns(text: string, currency: StatementCurrency): boolean {
  const labels = columnHeaderLabels(text);
  const settlement = settlementAmountLabels(currency);
  let lastCharged = -1;
  let lastSettlement = -1;
  labels.forEach((label, index) => {
    if (CHARGED_AMOUNT_LABELS.includes(label)) lastCharged = index;
    if (settlement.includes(label)) lastSettlement = index;
  });
  return lastCharged >= 0 && lastSettlement > lastCharged;
}

/** Continuation lines a wrapped row may span before its figures arrive. */
const MAX_WRAPPED_CONTINUATIONS = 2;

/**
 * Put a row that the PDF broke across lines back together.
 *
 * A table cell wider than its column wraps, and extraction emits each visual
 * line separately — so one transaction arrives as a date-led line with NO
 * money on it, the rest of its description, and then its figures:
 *
 *   09-Aug-26 11-Aug-26 NFC - (G-PAY)-GREEN VALLEY GROCERY
 *   DUBAI AE
 *   88.50 88.50
 *
 * These were not merely unread, they were invisible: the date line carries no
 * money, so `LOOKS_LIKE_MONEY_LINE` was false and the row was never counted as
 * rejected either. 42 of the 70 transactions on the reported statement were in
 * this shape, and the result still called its accounting complete — which is
 * the one thing `rejectedRows` exists to prevent.
 *
 * Deliberately narrow, because joining lines that are not one row would invent
 * a transaction. It starts only from a date-led line with no money, stops at
 * the next date-led line or an empty-cell placeholder, and spans at most two
 * continuations. A run that finds no figures leaves every line exactly as it
 * was.
 *
 * What ends a run is a line of nothing BUT figures — the wrapped row's own
 * money cells, which is what a table emits once the description above them has
 * run out. Merely containing money is not enough: a `Total 1,234.00` or
 * `Balance c/f 9,960.00` under an unread date-led line carries money too, and
 * joining onto one of those would turn a summary into a transaction and put a
 * figure nobody spent on the ledger.
 */
function isMoneyOnlyLine(line: string, currency: StatementCurrency): boolean {
  const words = line.split(' ');
  let figures = 0;
  for (const word of words) {
    if (/^(?:DR|CR|DEBIT|CREDIT)$/i.test(word) || statementCurrency(word) !== null) continue;
    const token = classifyMoneyToken(word, currency);
    if (!token) return false;
    if (token.kind !== 'placeholder') figures += 1;
  }
  return figures > 0;
}

/**
 * Whether a date-led line has a DESCRIPTION under its date, rather than more
 * date.
 *
 * `10-Aug-26 to 09-Sept-26` is a statement period, and a wrapped row's first
 * line is a merchant. Both are date-led and carry no money, so without this the
 * period line joined onto the `1,567.10` under it and filed a transaction
 * against a merchant called "to 09-Sept-26" — a figure nobody spent, under a
 * name nobody was paid. A row being joined has to name something.
 */
function hasDescriptionUnderDate(line: string, currency: StatementCurrency): boolean {
  const prefixed = ROW_DATE_PREFIX.exec(line);
  if (!prefixed || SUMMARY_DESCRIPTION.test(prefixed[2])) return false;
  return prefixed[2].split(' ').some((word) => {
    if (new RegExp(`^${DATE_TOKEN}$`, 'i').test(word)) return false;
    if (/^(?:to|through|until|till|and|-|–|—)$/i.test(word)) return false;
    if (/^(?:DR|CR|DEBIT|CREDIT)$/i.test(word) || statementCurrency(word) !== null) return false;
    if (classifyMoneyToken(word, currency)) return false;
    return /[A-Za-z\p{Script=Arabic}]{2,}/u.test(word);
  });
}

function joinWrappedRows(lines: string[], currency: StatementCurrency): string[] {
  const out: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    out.push(line);
    if (!line || !ROW_DATE_PREFIX.test(line) || LOOKS_LIKE_MONEY_LINE.test(line)) continue;
    if (!hasDescriptionUnderDate(line, currency)) continue;
    let joined = line;
    for (
      let ahead = index + 1;
      ahead < lines.length && ahead - index <= MAX_WRAPPED_CONTINUATIONS;
      ahead += 1
    ) {
      const next = lines[ahead];
      if (!next || ROW_DATE_PREFIX.test(next) || MONEY_PLACEHOLDER.test(next)) break;
      joined = `${joined} ${next}`;
      if (isMoneyOnlyLine(next, currency)) {
        out[out.length - 1] = joined;
        index = ahead;
        break;
      }
    }
  }
  return out;
}

/**
 * The charge on a row priced as `original [VAT] total`, and its direction.
 *
 * The ledger's figure is the LAST one — the total in its own currency — and the
 * figures before it are that same charge before VAT and in the currency it was
 * made in. Reachable only once the header has named those columns, and only on
 * a card statement, where an unmarked row is a purchase: the same rule, and the
 * same reason, as the lone-amount branch in `parseColumnTail`.
 *
 * Direction still has to be stated. A `CR` says so whether it is glued to the
 * total or standing as its own word between the two figures, and that is the
 * only way a row here becomes income.
 */
function parseOriginalTotalTail(
  rest: string,
  currency: StatementCurrency,
): { merchant: string; amountFils: number; type: 'expense' | 'income' } | null {
  const words = rest.split(' ');
  const total = classifyMoneyToken(words.at(-1) ?? '', currency);
  if (!total || total.kind === 'placeholder') return null;
  let cut = words.length - 1;
  let credit = total.kind === 'signed' && total.type === 'income';
  let figures = 0;
  // Walk back over the decomposition: the bare DR/CR this layout prints
  // between the two figures, and the original and VAT amounts themselves.
  //
  // An EMPTY cell counts as one of them. VAT is zero on most rows and many
  // statements print the cell as `-` rather than `0.00`, so treating a
  // placeholder as the end of the tail made the branch bail on exactly those
  // rows — and a bail used to fall through to `parseColumnTail`, which reads
  // the LEFTMOST figure and filed `FOREIGN SHOP 10.00 - 47.50` as AED 10.00.
  // That is the foreign amount: the wrong money, and the very thing the
  // header-order guard exists to prevent, arriving through a different door.
  while (cut > 0 && figures < 3) {
    const word = words[cut - 1];
    if (/^(?:DR|CR|DEBIT|CREDIT)$/i.test(word)) {
      credit = credit || /^(?:CR|CREDIT)$/i.test(word);
      cut -= 1;
      continue;
    }
    if (statementCurrency(word) === currency) { cut -= 1; continue; }
    const token = classifyMoneyToken(word, currency);
    if (!token) break;
    if (token.kind === 'placeholder') { figures += 1; cut -= 1; continue; }
    // A figure that disagrees about direction is not part of this charge.
    if (token.kind === 'signed' && (token.type === 'income') !== credit) return null;
    figures += 1;
    cut -= 1;
  }
  // One figure alone is the lone-amount case, and it is answered HERE rather
  // than left to fall through. A refusal in this layout is final — see the call
  // site — so returning null would silently drop a row whose reading was never
  // ambiguous: with a single figure there is no second column to pick wrongly.
  // Same rule and same reason as `loneAmountIsCharge`, and both are reached
  // only on a card statement.
  if (figures === 0) {
    const merchantOnly = words.slice(0, cut).join(' ').trim();
    return merchantOnly.length < 2 || merchantOnly.length > 180
      ? null
      : { merchant: merchantOnly, amountFils: total.minor, type: credit ? 'income' : 'expense' };
  }
  const merchant = words.slice(0, cut).join(' ').trim();
  return merchant.length < 2 || merchant.length > 180
    ? null
    : { merchant, amountFils: total.minor, type: credit ? 'income' : 'expense' };
}

function parseColumnTail(
  rest: string,
  currency: StatementCurrency,
  order: ColumnOrder,
  loneAmountIsCharge = false,
): { merchant: string; amountFils: number; type: 'expense' | 'income' } | null {
  const words = rest.split(' ');
  const tail: MoneyToken[] = [];
  let cut = words.length;
  while (cut > 0 && tail.length < 4) {
    const word = words[cut - 1];
    const standaloneCurrency = statementCurrency(word);
    if (standaloneCurrency) {
      // A currency word only qualifies the money token after it; one that
      // names another market's currency means this row is not ours.
      if (tail.length === 0 || standaloneCurrency !== currency) return null;
      cut -= 1;
      continue;
    }
    const token = classifyMoneyToken(word, currency);
    if (!token) break;
    tail.unshift(token);
    cut -= 1;
  }
  const merchant = words.slice(0, cut).join(' ').trim();
  if (merchant.length < 2 || merchant.length > 180 || tail.length === 0 || tail.length > 3) return null;
  const [first, second] = tail;
  if (first.kind === 'signed') {
    return tail.length <= 2 ? { merchant, amountFils: first.minor, type: first.type } : null;
  }
  // `03/08/2026 NOON.COM DUBAI ARE 68.93` — the whole body of a card
  // statement. One figure, no label, no second column, because a charge is
  // what the statement is for; the CR rows are handled by the branch above.
  if (loneAmountIsCharge && tail.length === 1 && first.kind === 'unsigned') {
    return { merchant, amountFils: first.minor, type: 'expense' };
  }
  if (tail.length < 2 || second.kind === 'signed') return null;
  const [debit, credit] = order === 'debit-first' ? [first, second] : [second, first];
  if (debit.kind === 'unsigned' && credit.kind === 'placeholder') {
    return { merchant, amountFils: debit.minor, type: 'expense' };
  }
  if (credit.kind === 'unsigned' && debit.kind === 'placeholder') {
    return { merchant, amountFils: credit.minor, type: 'income' };
  }
  return null;
}

/**
 * The description and the last two money figures on a row, ignoring a trailing
 * DR/CR label. Null unless the row really ends in two figures, so a reference
 * number cannot stand in for one: `CENTS_MONEY` requires the cents.
 */
function rowBalanceFigures(
  rest: string,
  currency: StatementCurrency,
): { merchant: string; amountMinor: number; balanceMinor: number } | null {
  const words = rest.trim().split(' ');
  if (/^(?:DR|CR|DEBIT|CREDIT)$/i.test(words.at(-1) ?? '')) words.pop();
  const balance = classifyMoneyToken(words.at(-1) ?? '', currency);
  const amount = classifyMoneyToken(words.at(-2) ?? '', currency);
  // A currency code before the figure marks the foreign original Gulf
  // statements print inside the description, not a column of its own. Tested
  // against real codes rather than any three capitals, because company
  // suffixes end descriptions constantly here — every `… FZ LLC 5.00 4,998.75`
  // would otherwise be unreadable, and with it the row after it. A code this
  // does not know costs nothing: the row then has to satisfy the exact balance
  // step like any other, and simply breaks the chain when it cannot.
  if (!balance || !amount || balance.kind === 'placeholder' || amount.kind === 'placeholder' ||
    statementCurrency(words.at(-3) ?? '') !== null) {
    return null;
  }
  // A running balance goes negative — an overdraft, and every credit card that
  // states what is owed. `-1,204.55` and `(1,204.55)` are balances like any
  // other; refusing them stopped reading the statement at the row the account
  // first went into the red.
  const balanceMinor = balance.kind === 'unsigned' || balance.type === 'income'
    ? balance.minor
    : -balance.minor;
  const merchant = words.slice(0, -2).join(' ').trim();
  return merchant.length < 2 || merchant.length > 180
    ? null
    : { merchant, amountMinor: amount.minor, balanceMinor };
}

/**
 * Whether the final figure on each row is a running balance.
 *
 * Two bare figures at the end of a row are ambiguous — `40.00 9,960.00` is a
 * debit and a balance, or a debit and a credit — and `parseColumnTail` is
 * right to refuse to guess between them. But a running balance is not a guess:
 * it has to reconcile. When every row's final figure differs from the previous
 * row's by exactly that row's other figure, the last column is a balance and
 * the sign of each step is that row's direction.
 *
 * This is what makes the commonest PDF layout readable at all. A statement
 * printing `Date Description Debit Credit Balance` marks the empty cell with a
 * placeholder only sometimes; when the cell is merely blank, extraction emits
 * spaces and the flattening at the top of `parseStatementLines` removes them,
 * leaving two indistinguishable figures. Every such row was rejected.
 *
 * Deliberately strict: four comparisons at minimum and near-total agreement,
 * so a file that merely happens to contain a few reconciling pairs does not
 * license reading the rest of it.
 */
function trailingBalanceRuns(lines: string[], currency: StatementCurrency): boolean {
  let previous: number | null = null;
  let checked = 0;
  let agreed = 0;
  for (const line of lines) {
    const prefixed = ROW_DATE_PREFIX.exec(line);
    if (!prefixed || SUMMARY_DESCRIPTION.test(prefixed[2])) continue;
    const figures = rowBalanceFigures(prefixed[2], currency);
    // A row this cannot read is a hole in the chain, not a disagreement. Its
    // successor must not be measured against a balance two rows back, or a
    // statement whose descriptions merely happen to end in a three-letter word
    // fails a test it never actually took.
    if (!figures) {
      previous = null;
      continue;
    }
    if (previous !== null) {
      checked += 1;
      if (Math.abs(figures.balanceMinor - previous) === figures.amountMinor) agreed += 1;
    }
    previous = figures.balanceMinor;
  }
  return checked >= 4 && agreed >= Math.ceil(checked * 0.9);
}

export interface StatementTextResult {
  rows: StatementParsedRow[];
  /** Every date-led money row this parser accounted for, accepted or rejected. */
  totalRows: number;
  /** Date-led lines that carried money but could not be read as a transaction. */
  rejectedRows: number;
  /** True when every row in totalRows is represented by rows or rejectedRows. */
  completeRowAccounting: boolean;
}

/**
 * Conservative statement-row parser. A row is accepted only when its direction
 * is explicit: a DR/CR label (tried first, unchanged), a signed amount, or a
 * debit/credit column pair with exactly one side populated. A bare amount in a
 * visual column is rejected rather than guessed after PDF layout has been
 * flattened to text — and, so that a partial import is not reported as a
 * complete one, every date-led line carrying money that fails is counted.
 */
export function parseStatementLines(
  text: string,
  currency: StatementCurrency = 'AED',
  identity: { card: ParsedSms['card']; bankHint?: string } = { card: null },
): StatementTextResult {
  if (!ledgerMoneySpec(currency)) throw new Error('unsupported_statement_currency');
  const rows: StatementParsedRow[] = [];
  let rejectedRows = 0;
  const sourceInstrument = identity.card ?? statementHeaderInstrument(text);
  const lines = joinWrappedRows(
    text.split(/\n+/)
      .map((original) => original.replace(/\s+/g, ' ').trim())
      // A row headed by its transaction date AND its posting date puts a second
      // date at the front of every description, where `parseColumnTail` reads
      // it as the first word of the merchant. Only a date sitting immediately
      // behind the row's own date is dropped: that position is a column, while
      // a date later in the text is part of what the row says.
      .map((line) => line.replace(DUAL_DATE_PREFIX, '$1 ')),
    currency,
  );
  const dateOrder = inferDateOrder(lines.map((line) => ROW_DATE_PREFIX.exec(line)?.[1] ?? ''));
  const columnOrder = statementColumnOrder(text);
  const originalTotalColumns = hasOriginalAndTotalColumns(text, currency);
  // Proven once for the whole file, then used to resolve rows the branches
  // below would otherwise have to reject as ambiguous.
  const balanceTrailing = trailingBalanceRuns(lines, currency);
  const cardStatement = isCardStatement(text);
  let previousBalance: number | null = null;
  const push = (
    date: string,
    merchant: string,
    amountFils: number,
    type: 'expense' | 'income',
    line: string,
  ) => {
    const classification = classifyMerchantDescription(
      merchant,
      type,
      currency === 'AED' ? 'AE' : currency === 'SAR' ? 'SA' : null,
    );
    const reference = referenceFromDescription(merchant);
    const transfer = statementTransferMeaning(merchant, type, currency, sourceInstrument, reference);
    rows.push({
      kind: 'transaction', type, amountFils, currency,
      merchant: transfer?.merchant ?? classification.merchant, date,
      dueDay: null, minDueFils: null, card: sourceInstrument, reference,
      transferHint: transfer?.transferHint ?? false,
      ...(identity.bankHint ? { bankHint: identity.bankHint } : {}),
      snapshotFils: null, snapshotKind: null,
      categoryGuess: transfer ? 'other' : classification.categoryGuess,
      categoryDeliberate: transfer ? true : classification.categoryDeliberate,
      ...(transfer?.transferEvidence ? { transferEvidence: transfer.transferEvidence } : {}),
      raw: line,
    });
  };
  for (const line of lines) {
    if (!line || line.length > 400) continue;
    const prefixed = ROW_DATE_PREFIX.exec(line);
    if (prefixed && SUMMARY_DESCRIPTION.test(prefixed[2])) continue;
    const countable = prefixed !== null && LOOKS_LIKE_MONEY_LINE.test(line);
    const accepted = rows.length;
    // Read before either branch and carried forward whether or not this row is
    // accepted, so one unreadable row cannot break the chain for the next.
    const figures = balanceTrailing && prefixed ? rowBalanceFigures(prefixed[2], currency) : null;
    const priorBalance = previousBalance;
    // Same hole rule as the proving pass, and here it is a correctness one:
    // a delta measured across a row that was skipped could carry the wrong
    // sign and file a credit as a debit.
    if (prefixed && !SUMMARY_DESCRIPTION.test(prefixed[2])) previousBalance = figures?.balanceMinor ?? null;
    const match = ROW_END_DIRECTION.exec(line) ?? ROW_MIDDLE_DIRECTION.exec(line);
    if (match) {
      // Only treat the three-letter token before an amount as currency when
      // it is actually a supported ISO currency. Merchant/location suffixes
      // such as `PARKING RTA 4.00 DR` are common statement text and must not
      // be mistaken for a foreign-currency marker just because they are three
      // uppercase letters.
      const explicitCurrencyToken = /\s([A-Z]{3})\s+[\d,]+(?:\.\d{1,3})?(?:\s+(?:DR|CR|DEBIT|CREDIT))?$/i
        .exec(line)?.[1]?.toUpperCase();
      const explicitCurrency = explicitCurrencyToken ? statementCurrency(explicitCurrencyToken) : null;
      const date = isoDate(match[1], dateOrder);
      let merchant = match[2].replace(/\s+/g, ' ').trim();
      // AMOUNT_TOKEN is intentionally permissive enough to recognize global
      // three-letter ISO codes. That also means the regex may temporarily eat
      // an ordinary three-letter merchant/location suffix such as RTA or LLC.
      // Put unrecognized tokens back into the description; recognized ISO
      // currency evidence stays out of the merchant title.
      if (explicitCurrencyToken) {
        if (explicitCurrency) {
          merchant = merchant.replace(new RegExp(`\\s*${explicitCurrencyToken}$`, 'i'), '').trim();
        } else if (!new RegExp(`(?:^|\\s)${explicitCurrencyToken}$`, 'i').test(merchant)) {
          merchant = `${merchant} ${explicitCurrencyToken}`.trim();
        }
      }
      const endDirection = /^(?:DR|CR|DEBIT|CREDIT)$/i.test(match[4] ?? '');
      const amountText = endDirection ? match[3] : match[4];
      const direction = (endDirection ? match[4] : match[3]).toUpperCase();
      const amountFils = amountMinor(amountText, currency, false);
      // `CARREFOUR 40.00 1,234.00 CR`: the labelled figure is the running
      // balance and the purchase sits at the end of the description. Two
      // money figures before one DR/CR label are ambiguous, so the line is
      // left for the rejected count rather than filed as a 1,234.00 credit.
      // `AMAZON AE USD 45.00 165.30 DR` is not that case: a currency code
      // before the figure marks the original foreign amount Gulf statements
      // print inside the description, and 165.30 DR is the real charge.
      const descriptionWords = merchant.split(' ');
      // Against real codes, not any three capitals: `ADCB ATM 200.00 5,300.00
      // DR` and `SPINNEYS JLT 120.00 27,890.00 DR` read their SECOND figure as
      // a currency marker under `[A-Z]{3}`, which switched this guard off and
      // imported the running balance as the amount.
      const balanceLabelled = classifyMoneyToken(descriptionWords.at(-1) ?? '', currency)?.kind === 'unsigned' &&
        statementCurrency(descriptionWords.at(-2) ?? '') === null;
      const credit = direction === 'CR' || direction === 'CREDIT';
      if (
        (!explicitCurrency || explicitCurrency === currency) && date && !balanceLabelled &&
        amountFils !== null && merchant
      ) {
        push(date, merchant, amountFils, credit ? 'income' : 'expense', line);
      } else if (
        balanceLabelled && date && figures &&
        (!explicitCurrency || explicitCurrency === currency)
      ) {
        // The label belongs to the balance; the charge is the figure before it,
        // which is where this row's description was made to end. Only reachable
        // once the file has proved its last column reconciles.
        push(date, figures.merchant, figures.amountMinor, credit ? 'income' : 'expense', line);
      }
    } else {
      const date = prefixed ? isoDate(prefixed[1], dateOrder) : null;
      // Once the header has named an original/total pair, THIS branch owns the
      // row and a refusal is final. Falling through to `parseColumnTail` handed
      // the same row to a reader that takes the leftmost figure — the foreign
      // amount — so the header-order guard only ever protected the rows this
      // branch happened to accept. A row it cannot read is now rejected and
      // counted, which is the honest answer and keeps the guard whole.
      const column = prefixed && date
        ? (originalTotalColumns && cardStatement
            ? parseOriginalTotalTail(prefixed[2], currency)
            : parseColumnTail(prefixed[2], currency, columnOrder, cardStatement))
        : null;
      if (date && column) push(date, column.merchant, column.amountFils, column.type, line);
      else if (date && figures && priorBalance !== null) {
        // No label and no placeholder to say which column is populated: the
        // step in the balance says it instead, and only when it matches this
        // row's other figure exactly.
        const delta = figures.balanceMinor - priorBalance;
        if (delta !== 0 && Math.abs(delta) === figures.amountMinor) {
          push(date, figures.merchant, figures.amountMinor, delta < 0 ? 'expense' : 'income', line);
        }
      }
    }
    if (countable && rows.length === accepted) rejectedRows += 1;
  }
  return {
    rows,
    totalRows: rows.length + rejectedRows,
    rejectedRows,
    completeRowAccounting: true,
  };
}

export function parseStatementText(
  text: string,
  currency: StatementCurrency = 'AED',
  identity: { card: ParsedSms['card']; bankHint?: string } = { card: null },
): StatementParsedRow[] {
  return parseStatementLines(text, currency, identity).rows;
}

export async function extractPdfStatementRows(
  bytes: Uint8Array,
  currency: StatementCurrency = 'AED',
  password?: string,
): Promise<{
  pages: number;
  rows: ParsedSms[];
  totalRows: number;
  rejectedRows: number;
  completeRowAccounting: boolean;
}> {
  const document = await getDocumentProxy(bytes, password ? { password } : undefined);
  try {
    const extracted = await extractText(document, { mergePages: true });
    // Its own code, not the generic unreadable one: a long text statement is
    // not a scan, and telling the user it is sends them the wrong way.
    if (extracted.text.length > MAX_NORMALIZED_CHARS) throw new Error('pdf_too_long');
    const parsed = parseStatementLines(extracted.text, currency);
    return {
      pages: extracted.totalPages,
      rows: parsed.rows,
      totalRows: parsed.totalRows,
      rejectedRows: parsed.rejectedRows,
      completeRowAccounting: parsed.completeRowAccounting,
    };
  } finally {
    const disposable = document as unknown as {
      destroy?: () => Promise<void> | void;
      cleanup?: () => Promise<void> | void;
    };
    if (disposable.destroy) await disposable.destroy();
    else if (disposable.cleanup) await disposable.cleanup();
  }
}
