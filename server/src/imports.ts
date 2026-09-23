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
    // Bilingual PDFs often interleave the translated label between the
    // English label and the value: `Credit Card Number <Arabic> 4111…`.
    // Permit only a short run containing no Latin letters/digits before the
    // explicitly card-labelled number, so a later unrelated amount cannot be
    // captured as card identity.
    'credit',
    /\bcredit\s+card\s+(?:number|no\.?)\b[^A-Za-z0-9\r\n]{0,96}([*xX•\s-]*\d(?:[*xX•\s-]*\d){3,23})/iu,
  ) ?? labelled(
    // Bilingual PDFs can expose the English label in visual/right-to-left
    // extraction order as "Number Card Credit" even though the page renders
    // "Credit Card Number". The following value is still explicitly labelled
    // card metadata, so retaining only its terminal four digits is safe.
    'credit',
    /\bnumber\s+card\s+credit\b\s*[:#-]?\s*([*xX•\s-]*\d(?:[*xX•\s-]*\d){3,23})/i,
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
 * Credit-card transaction tables that expose both the original and posted
 * total amount need different semantics from an account Debit/Credit table.
 * The card itself is the direction authority: ordinary rows are charges and
 * CR/credit marks the exceptions. Requiring all of these column labels keeps
 * that convention scoped to an actual table, not prose that merely mentions a
 * transaction or a total amount somewhere in the document.
 */
function hasCardTotalAmountTable(text: string, cardStatement: boolean): boolean {
  if (!cardStatement) return false;
  const normalized = text.replace(/\s+/g, ' ');
  return (
    /\btransaction\s*date\b/i.test(normalized) &&
    /\b(?:posting|post)\s*date\b/i.test(normalized) &&
    /\btransaction\s*(?:details?|description)\b/i.test(normalized) &&
    /\boriginal\s+amount\b/i.test(normalized) &&
    /\btotal\s+amount\b/i.test(normalized)
  );
}

interface TrailingAmountCell {
  before: string;
  surface: string;
  direction: 'expense' | 'income' | null;
}

// PDF text extraction may join a direction label directly to the figure
// (`13.92CR`) or leave it as a separate text item (`13.92 CR`). The optional
// ISO token covers original-amount cells in foreign currency; only the final
// Total Amount cell is later required to match the ledger currency.
const TRAILING_AMOUNT_CELL = /(?:^|\s)((?:(?:[A-Z]{3})\s*)?[\d,]+(?:\.\d{1,3})?(?:\s*[A-Z]{3})?)\s*(DR|CR|DEBIT|CREDIT)?\s*$/i;

function trailingAmountCell(value: string): TrailingAmountCell | null {
  const match = TRAILING_AMOUNT_CELL.exec(value);
  if (!match) return null;
  const label = match[2]?.toUpperCase();
  const direction = label === 'CR' || label === 'CREDIT'
    ? 'income'
    : label === 'DR' || label === 'DEBIT'
      ? 'expense'
      : null;
  return {
    before: value.slice(0, match.index).trim(),
    surface: match[1].trim(),
    direction,
  };
}

function ledgerCellMinor(cell: TrailingAmountCell, currency: StatementCurrency): number | null {
  const positive = amountMinor(cell.surface, currency, false);
  if (positive !== null) return positive;
  // amountMinor deliberately refuses zero because zero is not a transaction.
  // VAT can legitimately be an explicit 0.00 cell, and here it is used only to
  // prove a column boundary, never emitted as a transaction amount.
  const code = /\b([A-Z]{3})\b/i.exec(cell.surface)?.[1];
  if (code && statementCurrency(code) !== currency) return null;
  const numeric = cell.surface.replace(/[A-Za-z\s]/g, '').replace(/,/g, '');
  return /^0(?:\.0{1,3})?$/.test(numeric) ? 0 : null;
}

function directionsAgree(values: Array<'expense' | 'income' | null>): 'expense' | 'income' | null | false {
  const explicit = values.filter((value): value is 'expense' | 'income' => value !== null);
  if (new Set(explicit).size > 1) return false;
  return explicit[0] ?? null;
}

function cardTotalAmountRowComplete(line: string): boolean {
  const first = ROW_DATE_PREFIX.exec(line);
  if (!first) return false;
  const posting = ROW_DATE_PREFIX.exec(first[2]);
  if (!posting) return false;
  const total = trailingAmountCell(posting[2]);
  if (!total) return false;
  return trailingAmountCell(total.before) !== null;
}

function reconcilesThirdAmountContinuation(
  pending: string,
  continuationLine: string,
  currency: StatementCurrency,
): boolean {
  const continuation = trailingAmountCell(continuationLine);
  if (!continuation || continuation.before) return false;
  const totalMinor = ledgerCellMinor(continuation, currency);
  if (totalMinor === null) return false;

  const second = trailingAmountCell(pending);
  if (!second) return false;
  const secondMinor = ledgerCellMinor(second, currency);
  const first = trailingAmountCell(second.before);
  const firstMinor = first ? ledgerCellMinor(first, currency) : null;
  return firstMinor !== null && secondMinor !== null && firstMinor + secondMinor === totalMinor;
}

function startsCardTotalAmountRow(line: string): boolean {
  return CARD_ROW_PREFIX.test(line);
}

function cardTotalAmountRowPrefix(line: string, dateOrder: DateOrder): boolean {
  const first = ROW_DATE_PREFIX.exec(line);
  if (!first || !isoDate(first[1], dateOrder)) return false;
  const posting = ROW_DATE_PREFIX.exec(first[2]);
  return !!posting && isoDate(posting[1], dateOrder) !== null;
}

/**
 * PDF extraction sometimes appends a visual subheader/footer after a complete
 * row (`... 101.75 CR - 4111… cardholder`) instead of emitting an EOL. Trim
 * such trailer text only when the prefix before a separator is already a fully
 * formed two-date/two-amount card row. Hyphens inside merchant names therefore
 * cannot truncate a transaction.
 */
function trimCompletedCardRowTrailer(line: string): string {
  if (cardTotalAmountRowComplete(line)) return line;
  const separators = [...line.matchAll(/\s[-–—]\s*/gu)].map((match) => match.index ?? -1).filter((index) => index > 0);
  for (let index = separators.length - 1; index >= 0; index -= 1) {
    const prefix = line.slice(0, separators[index]).trim();
    if (cardTotalAmountRowComplete(prefix)) return prefix;
  }
  return line;
}

// The description may wrap immediately after Posting Date, so the second date
// is allowed to end the extracted text line. The next line is then coalesced
// into this pending row before amount parsing.
const CARD_ROW_START = new RegExp(`(${DATE_TOKEN})\\s+(${DATE_TOKEN})(?=\\s|$)`, 'ig');
const CARD_ROW_PREFIX = new RegExp(`^${DATE_TOKEN}\\s+${DATE_TOKEN}(?=\\s|$)`, 'i');
const EMBEDDED_CARD_DATE_PAIR = new RegExp(`${DATE_TOKEN}\\s+${DATE_TOKEN}`, 'i');

interface CardTextSegment {
  text: string;
  /** A visual row separator or a preceding money cell proved this boundary. */
  explicitBoundary: boolean;
}

function packedCardRowBoundary(line: string, index: number): { valid: boolean; explicit: boolean } {
  if (index === 0) return { valid: true, explicit: false };
  const before = line.slice(0, index).trimEnd();
  if (/[-–—]$/u.test(before)) return { valid: true, explicit: true };
  // The first transaction on a flattened page can follow an Opening Balance
  // directly, with no row separator. A money cell immediately before the date
  // pair is a valid boundary; ordinary merchant prose is not.
  const afterMoney = /(?:^|\s)(?:[A-Z]{3}\s*)?[\d,]+(?:\.\d{1,3})?\s*(?:DR|CR|DEBIT|CREDIT)?$/i.test(before);
  return { valid: afterMoney, explicit: afterMoney };
}

/**
 * Some PDF generators put an entire table page into one text line and separate
 * visual rows only with a hyphen. Split only at the very strong "transaction
 * date + posting date" signature. A lone date in a merchant or footer cannot
 * create a row this way.
 */
function splitPackedCardRows(line: string): CardTextSegment[] {
  const starts: { index: number; explicitBoundary: boolean }[] = [];
  CARD_ROW_START.lastIndex = 0;
  for (let match = CARD_ROW_START.exec(line); match; match = CARD_ROW_START.exec(line)) {
    const boundary = packedCardRowBoundary(line, match.index);
    if (boundary.valid) starts.push({ index: match.index, explicitBoundary: boundary.explicit });
  }
  CARD_ROW_START.lastIndex = 0;
  if (starts.length === 0) return [{ text: line, explicitBoundary: false }];
  const parts: CardTextSegment[] = [];
  if (starts[0].index > 0) {
    const prefix = line.slice(0, starts[0].index)
      .replace(/\s*[-–—]\s*$/u, '')
      .trim();
    if (prefix) parts.push({ text: prefix, explicitBoundary: false });
  }
  for (let index = 0; index < starts.length; index += 1) {
    const part = line.slice(starts[index].index, starts[index + 1]?.index ?? line.length)
      .replace(/^[-–—]\s*/u, '')
      .replace(/\s*[-–—]\s*$/u, '')
      .trim();
    if (part) parts.push({ text: part, explicitBoundary: starts[index].explicitBoundary });
  }
  return parts;
}

/**
 * unpdf preserves PDF.js `hasEOL`, which means a visually single table row can
 * arrive as several lines (description/location, then amount cells). Rebuild
 * only rows in the strongly identified card Total Amount table, and stop as
 * soon as the mandatory Original Amount + Total Amount tail is present.
 */
function coalesceCardTotalAmountRows(lines: string[], currency: StatementCurrency): string[] {
  const result: string[] = [];
  let pending: string | null = null;
  const flush = () => {
    if (pending) result.push(pending);
    pending = null;
  };
  for (const segment of lines.flatMap(splitPackedCardRows)) {
    const line = trimCompletedCardRowTrailer(
      segment.text.replace(/^[-–—]\s*(?=\d{1,2}[\s/-])/u, '').trim(),
    );
    // A wrapped merchant/location line can itself begin with a date-looking
    // token (for example a hotel stay period). In this table a REAL row starts
    // with Transaction Date + Posting Date, so one leading date alone must stay
    // attached to the pending description instead of flushing it as a new row.
    if (startsCardTotalAmountRow(line)) {
      if (pending && !cardTotalAmountRowComplete(pending) && !segment.explicitBoundary) {
        // No visual/structural boundary proves this is a new transaction. Keep
        // the two fragments together and let parseCardTotalAmountRow reject an
        // embedded second date-pair as ambiguous rather than silently moving
        // the money to the wrong transaction date.
        pending = `${pending} ${line}`.replace(/\s+/g, ' ').trim();
        continue;
      }
      flush();
      pending = line;
      continue;
    }
    if (pending) {
      // Two trailing figures can be either Original + Total (complete row) OR
      // Original + VAT with Total wrapped to the next text line. Extend only
      // when the next line is a pure amount cell and all three reconcile.
      if (cardTotalAmountRowComplete(pending) &&
          !reconcilesThirdAmountContinuation(pending, line, currency)) {
        flush();
        if (line) result.push(line);
        continue;
      }
      // A bare separator is a PDF table artefact, not part of the merchant.
      if (!/^[-–—]$/u.test(line)) pending = `${pending} ${line}`.replace(/\s+/g, ' ').trim();
      continue;
    }
    result.push(line);
  }
  flush();
  return result;
}

function parseCardTotalAmountRow(
  line: string,
  currency: StatementCurrency,
  dateOrder: DateOrder,
): { date: string; merchant: string; amountFils: number; type: 'expense' | 'income' } | null {
  const first = ROW_DATE_PREFIX.exec(line);
  if (!first) return null;
  const date = isoDate(first[1], dateOrder);
  const posting = ROW_DATE_PREFIX.exec(first[2]);
  if (!date || !posting || !isoDate(posting[1], dateOrder)) return null;

  const total = trailingAmountCell(posting[2]);
  if (!total) return null;
  const totalMinor = ledgerCellMinor(total, currency);
  if (totalMinor === null || totalMinor <= 0) return null;

  // One preceding amount is mandatory (Original Amount). If VAT is populated,
  // there are three trailing cells and Original + VAT must reconcile exactly to
  // Total before we strip the extra cell. This avoids eating a decimal number
  // that legitimately belongs to the merchant description.
  const nearest = trailingAmountCell(total.before);
  if (!nearest) return null;
  const nearestMinor = ledgerCellMinor(nearest, currency);
  const prior = trailingAmountCell(nearest.before);
  const priorMinor = prior ? ledgerCellMinor(prior, currency) : null;
  const hasExplicitVat = prior !== null && nearestMinor !== null && priorMinor !== null &&
    priorMinor + nearestMinor === totalMinor;
  const merchant = (hasExplicitVat ? prior.before : nearest.before).trim();
  if (merchant.length < 2 || merchant.length > 180) return null;
  if (EMBEDDED_CARD_DATE_PAIR.test(merchant)) return null;

  const direction = directionsAgree([
    total.direction,
    nearest.direction,
    hasExplicitVat && prior ? prior.direction : null,
  ]);
  if (direction === false) return null;
  return {
    date,
    merchant,
    amountFils: totalMinor,
    // In a proved credit-card Total Amount table, an unlabelled row is a card
    // charge. Credits/refunds/payments are the rows explicitly marked CR.
    type: direction ?? 'expense',
  };
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

/**
 * The lines a statement parse actually works on.
 *
 * Shared so that anything reasoning ABOUT a parse — reconciliation, the layout
 * fingerprint — sees the same lines the parse was handed. Reading the file a
 * second way would let a diagnosis describe a table the parser never saw.
 */
function statementLines(
  text: string,
  currency: StatementCurrency,
  cardTotalAmountTable: boolean,
): string[] {
  const rawLines = text.split(/\n+/).map((original) => original.replace(/\s+/g, ' ').trim());
  return cardTotalAmountTable ? coalesceCardTotalAmountRows(rawLines, currency) : rawLines;
}

/**
 * A money token and any direction marker glued to it.
 *
 * Extraction emits a credit either as `21.40 CR` or as `21.40CR`, and this
 * parser reads the glued form at row level, in `trailingAmountCell`. Anything
 * that reads a token on its own has to split it the same way, or a credit
 * balance is simply unreadable — which is how an overpaid card came back
 * `unknown` while its row had been read correctly.
 */
function splitDirectionSuffix(word: string): { figure: string; marker?: string } {
  const glued = /^(.*?)(DR|CR|DEBIT|CREDIT)$/i.exec(word);
  return glued ? { figure: glued[1], marker: glued[2] } : { figure: word };
}

/**
 * Whether a line is nothing BUT figures.
 *
 * Used to find a stated balance's own value in a bilingual summary box, where
 * the labels are stacked above the figures rather than beside them. Merely
 * containing money is not enough for that: `Total 1,234.00` carries money and
 * is not a value cell.
 */
function isMoneyOnlyLine(line: string, currency: StatementCurrency): boolean {
  const words = line.split(' ');
  let figures = 0;
  for (const word of words) {
    if (/^(?:DR|CR|DEBIT|CREDIT)$/i.test(word) || statementCurrency(word) !== null) continue;
    const token = classifyMoneyToken(splitDirectionSuffix(word).figure, currency);
    if (!token) return false;
    if (token.kind !== 'placeholder') figures += 1;
  }
  return figures > 0;
}

/**
 * Whether a date-led line has a DESCRIPTION under its date, rather than more
 * date.
 *
 * `10-Aug-26 to 09-Sept-26` is a statement period; a wrapped row's first line is
 * a merchant. Both are date-led and carry no money, and only the second is a
 * transaction this parser failed to account for.
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

/**
 * A column header stated on a line of its own.
 *
 * Bilingual statements print the Arabic and English name of a column together
 * and the extractor sometimes glues the pair into one line, so Arabic is
 * stripped before the line is compared. Anything else left on it — a word of
 * prose, another column's name — means this is not a header.
 */
const COLUMN_LABEL_ONLY = /^[(\s]*([a-z][a-z ]*[a-z])[)\s]*(?:\([A-Z]{3}\))?$/i;

/**
 * What a money column is called, which is not one thing per bank: what the card
 * was charged ("original amount", "transaction amount") beside what it settled
 * to in the ledger's own currency ("total amount", "amount in AED"). Keyed on
 * the ledger's currency rather than a Gulf hard-code.
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
    const line = original.replace(/[\p{Script=Arabic}‏‎]/gu, '').replace(/\s+/g, ' ').trim();
    if (!line || line.length > 40) continue;
    const label = COLUMN_LABEL_ONLY.exec(line)?.[1];
    if (label) labels.push(label.toLowerCase());
  }
  return labels;
}

/**
 * The two figures a statement states about itself: what it opened at and what
 * it closed at.
 *
 * Both are matched from a SHORT label line, never a sentence. "Total
 * Outstanding" heads the summary box of a UAE card statement and also appears
 * five times in its small print ("Amount by which the Total Outstanding on
 * Statement Date amount exceeds your current credit limit"), and anchoring a
 * reconciliation to a sentence would contradict a parse that was right.
 *
 * The figure is taken from the label's own line when it is there, and otherwise
 * from the first line of nothing but money within a short window after it: a
 * bilingual summary box lays its labels and values out as separate lines, so a
 * statement can state "Total Outstanding" and its figure five lines apart with
 * its Arabic twin and a stray bracket in between.
 */
const OPENING_BALANCE_LABEL =
  /\b(?:opening|previous|prev)\s+balance\b|\bbalance\s+b\/?f\b|\bbrought\s+forward\b|الرصيد الافتتاحي/iu;
const CLOSING_BALANCE_LABEL =
  /\b(?:closing|new|current)\s+balance\b|\btotal\s+outstanding\b|\bbalance\s+c\/?f\b|\bcarried\s+forward\b|\bstatement\s+balance\b|الرصيد الختامي/iu;
/** A label line is a label, not prose. */
const MAX_BALANCE_LABEL_CHARS = 48;
/** How far past a label its own figure may sit in a stacked bilingual box. */
const MAX_BALANCE_VALUE_LOOKAHEAD = 8;

/**
 * A stated balance as a SIGNED figure in the statement's own terms.
 *
 * DR and CR mean opposite things to the two kinds of statement and the sign has
 * to follow, because reconciliation compares this against a sum. A card balance
 * is what is owed, so `200.00 DR` is +200 owed and `200.00CR` is an overpaid
 * card at -200. An account balance is what is held, so the same two words run
 * the other way. Reading a CR as positive on a card would make an overpaid
 * statement miss by twice its balance and report `contradicted` against a parse
 * that was right.
 *
 * The marker is popped whether it is glued to the figure or stands as its own
 * word: `Total Outstanding 1,100.00 DR` ends in a direction, and leaving it
 * there makes the whole line unreadable, so the lookahead runs on and takes the
 * minimum-payment figure underneath as the closing balance.
 */
function signedBalance(
  line: string,
  currency: StatementCurrency,
  owed: boolean,
): number | null {
  const words = line.split(' ');
  let trailing = /^(?:DR|CR|DEBIT|CREDIT)$/i.exec(words.at(-1) ?? '')?.[0];
  if (trailing) words.pop();
  const split = splitDirectionSuffix(words.at(-1) ?? '');
  const figure = classifyMoneyToken(split.figure, currency);
  // `0.00` is a PLACEHOLDER in a transaction cell — an empty debit or credit
  // column prints exactly that — but it is a real figure in a balance anchor: a
  // fully paid card and a newly opened account both legitimately state zero.
  // Rejecting it left such a statement `unknown` even when its rows reached the
  // stated zero exactly. A bare `-` or `--` really is an empty cell and stays out.
  if (figure?.kind === 'placeholder') {
    return /^0(?:\.0{1,3})?$/.test(split.figure) ? 0 : null;
  }
  if (!figure) return null;
  trailing = trailing ?? split.marker;
  if (!trailing && figure.kind === 'signed') {
    trailing = figure.type === 'income' ? 'CR' : 'DR';
  }
  const credit = trailing ? /^(?:CR|CREDIT)$/i.test(trailing) : null;
  if (credit === null) return figure.minor;
  // Owed: a credit is money the card does NOT owe. Held: a debit is overdrawn.
  return owed === credit ? -figure.minor : figure.minor;
}

function statedBalance(
  lines: string[],
  label: RegExp,
  other: RegExp,
  currency: StatementCurrency,
  owed: boolean,
): number | null {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || line.length > MAX_BALANCE_LABEL_CHARS || !label.test(line)) continue;
    // On the label's own line, the last figure on it is the balance.
    const own = signedBalance(line, currency, owed);
    if (own !== null) return own;
    for (let ahead = index + 1; ahead <= index + MAX_BALANCE_VALUE_LOOKAHEAD && ahead < lines.length; ahead += 1) {
      const next = lines[ahead];
      if (!next) continue;
      // Stop at ANY balance label, not just this one. A summary box stacks its
      // labels and then its values, so a lookahead that only knew its own label
      // would run straight into the other balance's figure and report the
      // opening one as the closing one - a difference of the whole statement.
      if (label.test(next) || other.test(next) || ROW_DATE_PREFIX.test(next)) break;
      if (!isMoneyOnlyLine(next, currency)) continue;
      const figure = signedBalance(next, currency, owed);
      if (figure === null) break;
      return figure;
    }
  }
  return null;
}

/**
 * Date-led lines that are neither a transaction this parser read nor one it
 * counted as rejected - a row it never saw at all.
 *
 * A description wide enough to wrap past what `coalesceCardTotalAmountRows`
 * spans leaves its date line carrying no money, and `LOOKS_LIKE_MONEY_LINE` is
 * what makes a line countable, so such a row falls out of the accounting
 * entirely. Reconciliation has to know about it, or it will call a correct
 * partial read a contradiction.
 */
function unaccountedDateLedLines(lines: string[], currency: StatementCurrency): number {
  let unaccounted = 0;
  for (const line of lines) {
    if (!line || line.length > 400) continue;
    const prefixed = ROW_DATE_PREFIX.exec(line);
    if (!prefixed) continue;
    if (SUMMARY_DESCRIPTION.test(prefixed[2])) {
      // A DATE-LED summary line is ambiguous, and both readings are plausible: a
      // balance row the table dated, or a transaction at a payee whose name
      // starts with a balance word. `01/07/2026 NEW BALANCE 100.00 - 4,900.00`
      // is read as a summary and so is neither accepted nor rejected, which
      // leaves the sum short by a transaction that may well be real. Counting it
      // here is what keeps that from being reported as the parse contradicting
      // itself. An undated summary line is the normal shape and is not counted.
      if (LOOKS_LIKE_MONEY_LINE.test(line)) unaccounted += 1;
      continue;
    }
    if (LOOKS_LIKE_MONEY_LINE.test(line)) continue;
    // A line with no description under its date is a period or a heading, not a
    // transaction this parser lost. See `hasDescriptionUnderDate`.
    if (hasDescriptionUnderDate(line, currency)) unaccounted += 1;
  }
  return unaccounted;
}

/**
 * Whether the rows that were read actually ADD UP to what the statement says.
 *
 * Recognising a layout and reading it correctly are not the same thing, and
 * nothing in this file could previously tell them apart: a reading that put the
 * wrong figure in every row, or every direction the wrong way round, produced a
 * full set of plausible transactions and no complaint. A statement states its
 * own opening and closing balance, so the arithmetic between them is a proof
 * that costs nothing to run.
 *
 * A card statement's balance is what is OWED, so a purchase raises it and a
 * payment lowers it; an account statement runs the other way. `isCardStatement`
 * already decides which, and getting it backwards is itself caught, because the
 * sum then misses by twice the traffic rather than closing.
 *
 * Attempted only on a complete read. A file with rejected rows is missing
 * transactions by definition, so it cannot close, and calling that a
 * contradiction would report every partial import as wrong. The verdict is
 * `unknown` wherever the statement does not state both anchors - this exists to
 * ADD proof, never to cast doubt on a parse it cannot check.
 */
export type StatementReconciliation =
  | { verdict: 'unknown' }
  | { verdict: 'proven'; openingMinor: number; closingMinor: number }
  | { verdict: 'contradicted'; openingMinor: number; closingMinor: number; differenceMinor: number };

function reconcileStatement(
  rows: StatementParsedRow[],
  lines: string[],
  text: string,
  currency: StatementCurrency,
  rejectedRows: number,
): StatementReconciliation {
  if (rejectedRows > 0) return { verdict: 'unknown' };
  // `rejectedRows === 0` is not the same as a complete read. A row the PDF
  // wrapped over more continuations than the coalescer spans stays a date-led
  // line carrying no money - never accepted, never counted, invisible. A parse
  // missing those cannot close, and reporting it `contradicted` would accuse a
  // correct reading of being wrong, which is what this is documented never to do.
  if (unaccountedDateLedLines(lines, currency) > 0) return { verdict: 'unknown' };
  const owed = isCardStatement(text);
  const openingMinor = statedBalance(lines, OPENING_BALANCE_LABEL, CLOSING_BALANCE_LABEL, currency, owed);
  const closingMinor = statedBalance(lines, CLOSING_BALANCE_LABEL, OPENING_BALANCE_LABEL, currency, owed);
  if (openingMinor === null || closingMinor === null) return { verdict: 'unknown' };
  let expenses = 0;
  let income = 0;
  for (const row of rows) {
    if (row.type === 'expense') expenses += row.amountFils;
    else income += row.amountFils;
  }
  const expected = owed
    ? openingMinor + expenses - income
    : openingMinor - expenses + income;
  const differenceMinor = expected - closingMinor;
  return differenceMinor === 0
    ? { verdict: 'proven', openingMinor, closingMinor }
    : { verdict: 'contradicted', openingMinor, closingMinor, differenceMinor };
}

/** How many distinct row shapes a fingerprint reports, commonest first. */
const MAX_FINGERPRINT_SHAPES = 8;
/** How many column-header labels it reports. */
const MAX_FINGERPRINT_HEADERS = 16;

/**
 * A statement's LAYOUT with its contents removed.
 *
 * When a file reads zero rows the parser knows exactly why and the user is told
 * nothing that can be acted on - and nobody upstream learns which bank, which
 * table, which shape defeated it. Every such failure has so far had to arrive
 * as a person reporting it, and the HSBC case took a real statement to diagnose.
 *
 * What makes that fixable without handling anyone's money is that the answer is
 * never in the values. It is in the SHAPE: how many date columns a row leads
 * with, whether its figures carry a direction, where the amounts sit. So every
 * token that could carry content becomes its class and nothing else -
 *
 *   `09-Aug-26 11-Aug-26 COFFEE HOUSE DUBAI AE 41.25 41.25`
 *     becomes  `DATE DATE WORD+ MONEY MONEY`
 *
 * - which is enough to write a fixture from and carries no merchant, no amount,
 * no balance, no account number, no name. Digits never survive: a token that is
 * money becomes MONEY whatever its value, and one that is anything else becomes
 * WORD whatever it spells. Column headers are the one exception, and they are
 * reported only when they name a column - see `reportableColumnLabels`.
 */
export interface StatementLayoutFingerprint {
  /** Column labels the file states, in order. Named only when they name a
   *  column - see `reportableColumnLabels`, which is what keeps a cardholder's
   *  name and address out of this. */
  headers: string[];
  /** Standalone header-shaped lines that were NOT reported, counted only. */
  otherHeaderLines: number;
  /** Distinct date-led row shapes with their counts, commonest first. */
  shapes: { shape: string; count: number }[];
  /** Date-led lines seen, and how many of those carried money. */
  dateLedLines: number;
  moneyLines: number;
  /** Whether the file read as a card statement, and which layouts it proved. */
  cardStatement: boolean;
  cardTotalAmountTable: boolean;
  trailingBalance: boolean;
}

/**
 * The nouns a money table names its columns with.
 *
 * `columnHeaderLabels` answers "does this line stand alone like a header", which
 * is all a presence check needs. A fingerprint REPORTS its labels, so the same
 * rule is nowhere near enough: an address block is short standalone alphabetic
 * lines too, and fingerprinting a real statement emitted the cardholder's name,
 * their employer and their city alongside the real headers.
 *
 * So a label is reported only when it names a column - it carries one of these
 * nouns and is no longer than a header gets. That keeps the discovery this
 * exists for (the next bank's word for an amount column is still learned) while
 * a name, an employer or a street cannot satisfy it. Anything else is counted
 * and not named, so the count still says how much was passed over.
 */
const KNOWN_COLUMN_LABELS = [
  'transaction date', 'posting date', 'post date', 'value date', 'date',
  'transaction details', 'transaction description', 'description', 'details',
  'narration', 'particulars', 'reference', 'reference number',
  'debit', 'credit', 'debit amount', 'credit amount', 'withdrawal', 'withdrawals',
  'deposit', 'deposits', 'amount', 'balance', 'running balance', 'closing balance',
  'opening balance', 'previous balance', 'new balance', 'statement balance',
  'total outstanding', 'minimum payment', 'minimum amount due', 'payment due date',
  'credit limit', 'available limit', 'finance charges', 'vat', 'tax', 'fees',
  'currency', 'rate', 'exchange rate', 'card number', 'total', 'charges',
  // Seen on real statements and added here deliberately: this list is how a new
  // bank's column vocabulary enters the diagnostic, and every entry is generic
  // column wording rather than anything out of anyone's file.
  'other debits', 'other credits', 'start date', 'end date', 'transaction',
  'statement date', 'due date', 'amount due', 'total amount due', 'payments',
];

/**
 * Whether a label is one this parser already knows the name of.
 *
 * A CLOSED SET, and it has to be, because every heuristic tried here leaked. A
 * bare "does the line contain a column word" emitted a cardholder's employer
 * (`GULF PAYMENTS SERVICES LLC` carries "payments"). Requiring the noun to be
 * the LAST word emitted their name (`ALICE CREDIT`, `MOHAMMED TOTAL` - a name
 * followed by a column noun passes that test exactly as a real header does).
 *
 * There is no test over free text that separates "a column called X" from "a
 * person called X", because the strings are the same shape. So the only
 * defensible rule is to report nothing that did not already exist in this file:
 * a label is named only when it matches a constant here, which makes the output
 * PROVABLY content-free rather than carefully filtered. Everything else is
 * counted, so the count still says how much was passed over.
 *
 * The cost is that a bank's novel word for a column is no longer learned from
 * the fingerprint. The row shapes still show the table's structure, which is the
 * actionable half, and a new label can be added here once someone has seen it.
 * That is a smaller loss than a name in a diagnostic.
 */
function namesAColumn(label: string, currency: StatementCurrency): boolean {
  return KNOWN_COLUMN_LABELS.includes(label)
    || CHARGED_AMOUNT_LABELS.includes(label)
    || settlementAmountLabels(currency).includes(label);
}

function reportableColumnLabels(
  text: string,
  currency: StatementCurrency,
): { headers: string[]; otherHeaderLines: number } {
  const headers: string[] = [];
  let otherHeaderLines = 0;
  for (const label of columnHeaderLabels(text)) {
    if (namesAColumn(label, currency)) {
      if (!headers.includes(label)) headers.push(label);
    } else {
      otherHeaderLines += 1;
    }
  }
  return { headers, otherHeaderLines };
}

/** One token's CLASS. Never its value - see StatementLayoutFingerprint. */
function tokenClass(word: string, currency: StatementCurrency): string {
  if (new RegExp(`^${DATE_TOKEN}$`, 'i').test(word)) return 'DATE';
  if (/^(?:DR|CR|DEBIT|CREDIT)$/i.test(word)) return 'DIR';
  if (statementCurrency(word) !== null) return 'CUR';
  const token = classifyMoneyToken(word, currency);
  if (token) return token.kind === 'placeholder' ? 'EMPTY' : 'MONEY';
  // `21.40CR` is ONE token that is money and states its direction, which is how
  // extraction often emits a credit. Reporting it as WORD would describe the
  // table as having a text column where it has an amount column — the shape
  // would send the next reader of this fingerprint the wrong way.
  const glued = splitDirectionSuffix(word);
  if (glued.marker && classifyMoneyToken(glued.figure, currency)) return 'MONEY+DIR';
  // A bare integer is not money to this parser, but a row full of them is a
  // reference or a card number and the difference matters when reading a shape.
  if (/^[\d,]+$/.test(word)) return 'DIGITS';
  return 'WORD';
}

export function statementLayoutFingerprint(
  text: string,
  currency: StatementCurrency = 'AED',
): StatementLayoutFingerprint {
  // The same lines the parser reads, through the same coalescer, so a shape
  // reported here is the shape the parser was actually handed.
  const cardStatement = isCardStatement(text);
  const cardTotalAmountTable = hasCardTotalAmountTable(text, cardStatement);
  const lines = statementLines(text, currency, cardTotalAmountTable);
  const counts = new Map<string, number>();
  let dateLedLines = 0;
  let moneyLines = 0;
  for (const line of lines) {
    if (!line || line.length > 400 || !ROW_DATE_PREFIX.test(line)) continue;
    dateLedLines += 1;
    if (LOOKS_LIKE_MONEY_LINE.test(line)) moneyLines += 1;
    // Collapsed, so one shape is not reported once per merchant-name length:
    // `WORD WORD WORD` and `WORD WORD` are the same table, differently wide.
    const shape = line.split(' ').map((word) => tokenClass(word, currency))
      .join(' ').replace(/(?:WORD )+WORD/g, 'WORD+');
    counts.set(shape, (counts.get(shape) ?? 0) + 1);
  }
  const shapes = [...counts.entries()]
    .map(([shape, count]) => ({ shape, count }))
    .sort((a, b) => b.count - a.count || a.shape.localeCompare(b.shape))
    .slice(0, MAX_FINGERPRINT_SHAPES);
  const { headers, otherHeaderLines } = reportableColumnLabels(text, currency);
  return {
    headers: headers.slice(0, MAX_FINGERPRINT_HEADERS),
    otherHeaderLines,
    shapes,
    dateLedLines,
    moneyLines,
    cardStatement,
    cardTotalAmountTable,
    trailingBalance: trailingBalanceRuns(lines, currency),
  };
}

export interface StatementTextResult {
  rows: StatementParsedRow[];
  /** Every date-led money row this parser accounted for, accepted or rejected. */
  totalRows: number;
  /** Date-led lines that carried money but could not be read as a transaction. */
  rejectedRows: number;
  /** True when every row in totalRows is represented by rows or rejectedRows. */
  completeRowAccounting: boolean;
  /** Whether the rows add up to the balances the statement states for itself. */
  reconciliation: StatementReconciliation;
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
  const sourceInstrument = identity.card ?? statementInstrument(text) ?? statementHeaderInstrument(text);
  const bankHint = identity.bankHint ?? statementBankHint(text);
  const cardStatement = isCardStatement(text);
  const cardTotalAmountTable = hasCardTotalAmountTable(text, cardStatement);
  const lines = statementLines(text, currency, cardTotalAmountTable);
  const dateOrder = inferDateOrder(lines.map((line) => ROW_DATE_PREFIX.exec(line)?.[1] ?? ''));
  const columnOrder = statementColumnOrder(text);
  // Proven once for the whole file, then used to resolve rows the branches
  // below would otherwise have to reject as ambiguous.
  const balanceTrailing = trailingBalanceRuns(lines, currency);
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
      ...(bankHint ? { bankHint } : {}),
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
    const cardTableCandidate = cardTotalAmountTable && prefixed
      ? cardTotalAmountRowPrefix(line, dateOrder)
      : false;
    const cardTableRow = cardTableCandidate
      ? parseCardTotalAmountRow(line, currency, dateOrder)
      : null;
    if (cardTableCandidate) {
      if (cardTableRow) {
        push(cardTableRow.date, cardTableRow.merchant, cardTableRow.amountFils, cardTableRow.type, line);
      }
      if (countable && rows.length === accepted) rejectedRows += 1;
      continue;
    }
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
      const column = prefixed && date
        ? parseColumnTail(prefixed[2], currency, columnOrder, cardStatement)
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
    reconciliation: reconcileStatement(rows, lines, text, currency, rejectedRows),
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
  /** Carried from the parse: a statement that proves itself says so here too. */
  reconciliation: StatementReconciliation;
  /**
   * The layout of a file this parser read NOTHING from, so the failure can be
   * diagnosed without anyone sending in their statement. Null on every parse
   * that read a row: there is nothing to diagnose, and it costs a pass to build.
   */
  layout: StatementLayoutFingerprint | null;
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
      reconciliation: parsed.reconciliation,
      layout: parsed.rows.length === 0
        ? statementLayoutFingerprint(extracted.text, currency)
        : null,
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
