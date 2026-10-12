/**
 * Pure client contract for the relay's supplemental import endpoints.
 *
 * This stays platform-free so the request/response boundary can be exercised
 * by the Node test suite. The native transport lives in cloud-import.ts.
 */

export interface ImportCapabilities {
  email: {
    enabled: boolean;
    accepts: string[];
    maxBytes: number;
  };
  pdf: {
    enabled: boolean;
    accepts: string[];
    maxBytes: number;
    maxRows: number;
    maxPages: number;
    parser: string;
    note: string;
    /**
     * How the relay accepts a PDF password beyond the legacy raw header.
     * Present only when the relay advertises it; absent means legacy.
     */
    passwordEncoding?: string[];
    /** The longest password (UTF-8 bytes) the base64 header accepts, when advertised. */
    maxPasswordBytes?: number;
  };
  csv: {
    enabled: boolean;
    accepts: string[];
    maxBytes: number;
    /**
     * Per-type size ceilings (an Excel workbook may be allowed more than a
     * text file). Present only when the relay advertises it; otherwise every
     * type uses maxBytes.
     */
    maxBytesByType?: Record<string, number>;
    maxRows: number;
    parser: string;
    note: string;
  };
}

export interface StatementImportCoverage {
  sourceKey: string;
  label: string;
  startDate: string;
  endDate: string;
}

export interface PdfImportAccepted {
  statementImportId?: string;
  /** Every id the relay knows for this file on this device (first read, current re-read). */
  statementImportIds?: string[];
  acceptedRows: number;
  /** Date-led money lines the relay would not read; 0 from a relay that predates the field. */
  rejectedRows: number;
  /** Accepted + rejected rows; synthesized for an older relay response. */
  totalRows: number;
  pages: number;
  coverage: StatementImportCoverage | null;
  /** Of rejectedRows: card rows with a bare sign the statement never explains. */
  cardSignRowsSkipped: number;
  /**
   * The relay had already processed this exact file within its replay window
   * and queued nothing new. Says nothing about the ledger itself.
   */
  alreadyProcessed: boolean;
}

export interface CsvImportAccepted {
  statementImportId?: string;
  /** Every id the relay knows for this file on this device (first read, current re-read). */
  statementImportIds?: string[];
  acceptedRows: number;
  rejectedRows: number;
  totalRows: number;
  coverage: StatementImportCoverage | null;
  /** Of rejectedRows: card rows with a bare sign the statement never explains. */
  cardSignRowsSkipped: number;
  /**
   * The relay had already processed this exact file within its replay window
   * and queued nothing new. Says nothing about the ledger itself.
   */
  alreadyProcessed: boolean;
}

export interface EmailForwardingCredential {
  emailToken: string;
  forwardingAddress: string;
}

export type CloudImportErrorCode =
  | 'network'
  | 'unauthorized'
  | 'invalid_pdf'
  | 'pdf_required'
  | 'invalid_csv'
  | 'csv_required'
  | 'too_large'
  | 'too_many_pages'
  | 'too_many_rows'
  | 'pdf_too_long'
  | 'unreadable_pdf'
  | 'pdf_password_required'
  | 'pdf_password_incorrect'
  | 'pdf_password_invalid'
  | 'pdf_damaged'
  | 'pdf_encryption_unsupported'
  | 'invalid_xlsx'
  /** A structured statement file (OFX, QIF, camt, MT940) that is malformed. */
  | 'invalid_statement_file'
  /** The relay does not advertise or read this file's type. */
  | 'unsupported_file_type'
  | 'unsupported_statement_format'
  | 'ambiguous_card_signs'
  | 'ambiguous_dates'
  | 'multiple_statement_accounts'
  | 'statement_currency_mismatch'
  | 'statement_options_conflict'
  /** The rows read do not add up to the balances the statement states. */
  | 'statement_does_not_reconcile'
  /** Rows print no year and no statement period in the file settles it. */
  | 'dates_without_year'
  | 'rate_limited'
  | 'queue_full'
  | 'email_not_configured'
  | 'service'
  | 'unexpected';

/**
 * What a refusal of a different reading names: the earlier read of the same
 * file (so the phone can see whether it holds any of its rows) and the
 * day/month order it was read with.
 */
export interface StatementConflictDetail {
  statementImportId?: string;
  /** Every id the relay knows for this file on this device. */
  statementImportIds?: string[];
  previousDateOrder?: 'day-first' | 'month-first';
  /** Why the readings differ: another day/month order or currency, a newer parser, or not recorded. */
  reason?: 'options' | 'parser' | 'unknown';
}

export class CloudImportError extends Error {
  constructor(
    readonly code: CloudImportErrorCode,
    readonly status?: number,
    readonly detail?: StatementConflictDetail,
    /**
     * The layout fingerprint a Worker returns with
     * `unsupported_statement_format`: token CLASSES and known column labels
     * only, never the statement's contents. Carried so a diagnostic report can
     * include why a file read nothing; no screen renders it yet.
     */
    readonly layout?: unknown,
  ) {
    super(code);
    this.name = 'CloudImportError';
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function positiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * An optional per-type size map: only positive integer limits under plain
 * string keys are kept; anything malformed reads as absent (use maxBytes).
 */
function sizeByType(value: unknown): Record<string, number> | null {
  const map = object(value);
  if (!map || Array.isArray(value)) return null;
  const entries = Object.entries(map);
  if (entries.length === 0 || !entries.every(([, limit]) => positiveInt(limit))) return null;
  return Object.fromEntries(entries) as Record<string, number>;
}

/** The size ceiling the relay applies to one CSV-endpoint content type. */
export function csvMaxBytes(capabilities: Pick<ImportCapabilities, 'csv'>, contentType: string): number {
  const byType = capabilities.csv.maxBytesByType;
  return byType && Object.hasOwn(byType, contentType) ? byType[contentType] : capabilities.csv.maxBytes;
}

/** Reject a partial or invented capability document instead of guessing limits. */
export function parseImportCapabilities(value: unknown): ImportCapabilities | null {
  const root = object(value);
  const email = object(root?.email);
  const pdf = object(root?.pdf);
  const csvValue = root?.csv;
  const csv = object(csvValue);
  if (
    typeof email?.enabled !== 'boolean' ||
    !stringList(email.accepts) ||
    !positiveInt(email.maxBytes) ||
    typeof pdf?.enabled !== 'boolean' ||
    !stringList(pdf.accepts) ||
    !positiveInt(pdf.maxBytes) ||
    !positiveInt(pdf.maxRows) ||
    !positiveInt(pdf.maxPages) ||
    typeof pdf.parser !== 'string' ||
    typeof pdf.note !== 'string'
  ) return null;
  if (
    csvValue !== undefined && (
      typeof csv?.enabled !== 'boolean' ||
      !stringList(csv.accepts) ||
      !positiveInt(csv.maxBytes) ||
      !positiveInt(csv.maxRows) ||
      typeof csv.parser !== 'string' ||
      typeof csv.note !== 'string'
    )
  ) return null;
  const csvSizes = sizeByType(csv?.maxBytesByType);
  const csvCapability: ImportCapabilities['csv'] = csv
    ? {
        enabled: csv.enabled as boolean,
        accepts: [...(csv.accepts as string[])],
        maxBytes: csv.maxBytes as number,
        ...(csvSizes ? { maxBytesByType: csvSizes } : {}),
        maxRows: csv.maxRows as number,
        parser: csv.parser as string,
        note: csv.note as string,
      }
    : {
        enabled: false,
        accepts: [],
        maxBytes: 0,
        maxRows: 0,
        parser: 'unavailable',
        note: 'This relay does not advertise CSV imports.',
      };

  return {
    email: {
      enabled: email.enabled,
      accepts: [...email.accepts],
      maxBytes: email.maxBytes,
    },
    pdf: {
      enabled: pdf.enabled,
      accepts: [...pdf.accepts],
      maxBytes: pdf.maxBytes,
      maxRows: pdf.maxRows,
      maxPages: pdf.maxPages,
      parser: pdf.parser,
      note: pdf.note,
      // Optional and additive: a missing or malformed list reads as legacy
      // rather than refusing a capability document that is otherwise whole.
      ...(stringList(pdf.passwordEncoding) ? { passwordEncoding: [...pdf.passwordEncoding] } : {}),
      ...(positiveInt(pdf.maxPasswordBytes) ? { maxPasswordBytes: pdf.maxPasswordBytes } : {}),
    },
    csv: csvCapability,
  };
}

/**
 * The spreadsheet type a relay lists in csv.accepts when it reads Excel
 * workbooks; the app names Excel only when it is listed.
 */
export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * The UTF-8 bytes of `value`, written out rather than relying on Buffer or
 * TextEncoder so it behaves the same in Hermes and in Node. A lone surrogate
 * is encoded as U+FFFD, as TextEncoder does; a typed password never has one.
 */
function utf8Encode(value: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i += 1) {
    let code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      } else {
        code = 0xfffd;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd;
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return bytes;
}

/** Standard (padded) base64 of the UTF-8 bytes of `value`, without btoa. */
export function utf8Base64(value: string): string {
  const bytes = utf8Encode(value);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += BASE64_ALPHABET[(triple >> 18) & 0x3f] + BASE64_ALPHABET[(triple >> 12) & 0x3f];
    out += i + 1 < bytes.length ? BASE64_ALPHABET[(triple >> 6) & 0x3f] : '=';
    out += i + 2 < bytes.length ? BASE64_ALPHABET[triple & 0x3f] : '=';
  }
  return out;
}

/**
 * The base64 header's own rules, checked before a statement is uploaded: a
 * relay that reads it refuses (pdf_password_invalid) a password longer than
 * its advertised byte limit or one holding a control character (tab and line
 * breaks included). Legacy relays are left to answer for themselves.
 */
export function pdfPasswordUnusable(
  password: string | undefined,
  capabilities: Pick<ImportCapabilities, 'pdf'>,
): boolean {
  if (!password || !capabilities.pdf.passwordEncoding?.includes('b64')) return false;
  if (/[\u0000-\u001f]/.test(password)) return true;
  const limit = capabilities.pdf.maxPasswordBytes;
  return limit !== undefined && utf8Encode(password).length > limit;
}

/**
 * The header that carries a PDF password, exactly as typed (never trimmed).
 * A relay that advertises `b64` gets the UTF-8 bytes base64-encoded, so
 * Arabic and other non-Latin passwords survive HTTP header rules; an older
 * relay keeps the legacy raw header it has always read.
 */
export function pdfPasswordHeaders(
  password: string | undefined,
  capabilities: Pick<ImportCapabilities, 'pdf'>,
): Record<string, string> {
  if (!password) return {};
  return capabilities.pdf.passwordEncoding?.includes('b64')
    ? { 'x-wafra-pdf-password-b64': utf8Base64(password) }
    : { 'x-wafra-pdf-password': password };
}

function parseStatementCoverage(value: unknown): StatementImportCoverage | null {
  if (value === null || value === undefined) return null;
  const row = object(value);
  if (!row || typeof row.sourceKey !== 'string' || row.sourceKey.length < 1 || row.sourceKey.length > 80 ||
      typeof row.label !== 'string' || row.label.length < 1 || row.label.length > 80 ||
      typeof row.startDate !== 'string' || typeof row.endDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(row.endDate) ||
      !validCalendarDate(row.startDate) || !validCalendarDate(row.endDate) ||
      row.startDate > row.endDate) return null;
  return { sourceKey: row.sourceKey, label: row.label, startDate: row.startDate, endDate: row.endDate };
}

function validCalendarDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseStatementImportId(value: unknown): string | undefined | null {
  return value === undefined ? undefined : typeof value === 'string' && /^[a-f0-9]{32}$/.test(value) ? value : null;
}

/** Optional list of statement ids; malformed entries make the whole list absent. */
function parseStatementImportIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) return undefined;
  return value.every((id) => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id)) ? [...value] as string[] : undefined;
}

export function parsePdfImportAccepted(value: unknown): PdfImportAccepted | null {
  const body = object(value);
  const statementImportId = parseStatementImportId(body?.statementImportId);
  if (statementImportId === null) return null;
  if (!positiveInt(body?.acceptedRows) || !positiveInt(body.pages)) return null;
  // Optional so an older relay's response still parses; present but malformed
  // is a different relay contract and is refused like any other field.
  const rejectedRows = body.rejectedRows === undefined ? 0 : body.rejectedRows;
  if (!nonNegativeInt(rejectedRows)) return null;
  const totalRows = body.totalRows === undefined
    ? body.acceptedRows + rejectedRows
    : body.totalRows;
  if (!positiveInt(totalRows) || body.acceptedRows + rejectedRows !== totalRows) return null;
  const parsedCoverage = parseStatementCoverage(body.coverage);
  if (body.coverage !== null && body.coverage !== undefined && !parsedCoverage) return null;
  // Defensive compatibility: an older relay may send a min/max range even when
  // it also admits skipped rows. Do not persist that range as complete locally.
  const coverage = rejectedRows === 0 ? parsedCoverage : null;
  const cardSignRowsSkipped = cardSignSkips(body.cardSignRowsSkipped, rejectedRows);
  const alreadyProcessed = optionalFlag(body.alreadyProcessed);
  if (cardSignRowsSkipped === null || alreadyProcessed === null) return null;
  const statementImportIds = parseStatementImportIds(body.statementImportIds);
  return {
    ...(statementImportId ? { statementImportId } : {}),
    ...(statementImportIds ? { statementImportIds } : {}),
    acceptedRows: body.acceptedRows, rejectedRows, totalRows, pages: body.pages, coverage, cardSignRowsSkipped,
    alreadyProcessed,
  };
}

/** Optional boolean: absent from an older relay reads false; anything else is refused. */
function optionalFlag(value: unknown): boolean | null {
  if (value === undefined) return false;
  return typeof value === 'boolean' ? value : null;
}

/** Optional (older relays omit it) and never more than the rows skipped. */
function cardSignSkips(value: unknown, rejectedRows: number): number | null {
  if (value === undefined) return 0;
  return nonNegativeInt(value) && value <= rejectedRows ? value : null;
}

export function parseCsvImportAccepted(value: unknown): CsvImportAccepted | null {
  const body = object(value);
  const statementImportId = parseStatementImportId(body?.statementImportId);
  if (statementImportId === null) return null;
  if (
    !positiveInt(body?.acceptedRows) ||
    !nonNegativeInt(body.rejectedRows) ||
    !positiveInt(body.totalRows) ||
    body.acceptedRows + body.rejectedRows !== body.totalRows
  ) return null;
  const coverage = parseStatementCoverage(body.coverage);
  if (body.coverage !== null && body.coverage !== undefined && !coverage) return null;
  const cardSignRowsSkipped = cardSignSkips(body.cardSignRowsSkipped, body.rejectedRows);
  const alreadyProcessed = optionalFlag(body.alreadyProcessed);
  if (cardSignRowsSkipped === null || alreadyProcessed === null) return null;
  const statementImportIds = parseStatementImportIds(body.statementImportIds);
  return {
    ...(statementImportId ? { statementImportId } : {}),
    ...(statementImportIds ? { statementImportIds } : {}),
    acceptedRows: body.acceptedRows,
    rejectedRows: body.rejectedRows,
    totalRows: body.totalRows,
    coverage: body.rejectedRows === 0 ? coverage : null,
    cardSignRowsSkipped,
    alreadyProcessed,
  };
}

export function parseEmailForwardingCredential(
  value: unknown,
): EmailForwardingCredential | null {
  const body = object(value);
  if (
    typeof body?.emailToken !== 'string' ||
    body.emailToken.length < 40 ||
    body.emailToken.length > 128 ||
    typeof body.forwardingAddress !== 'string' ||
    body.forwardingAddress.length > 320 ||
    /[\s\r\n]/.test(body.forwardingAddress) ||
    !body.forwardingAddress.includes('@')
  ) return null;
  return { emailToken: body.emailToken, forwardingAddress: body.forwardingAddress };
}

const KNOWN_ERRORS = new Set<CloudImportErrorCode>([
  'invalid_pdf',
  'pdf_required',
  'invalid_csv',
  'csv_required',
  'too_large',
  'too_many_pages',
  'too_many_rows',
  'pdf_too_long',
  'unreadable_pdf',
  'pdf_password_required',
  'pdf_password_incorrect',
  'pdf_password_invalid',
  'pdf_damaged',
  'pdf_encryption_unsupported',
  'invalid_xlsx',
  'invalid_statement_file',
  'unsupported_file_type',
  'unsupported_statement_format',
  'ambiguous_card_signs',
  'ambiguous_dates',
  'multiple_statement_accounts',
  'statement_currency_mismatch',
  'statement_options_conflict',
  'statement_does_not_reconcile',
  'dates_without_year',
  'rate_limited',
  'queue_full',
  'email_not_configured',
]);

/** Convert HTTP status + safe JSON error code into a finite UI state. */
export function pdfImportError(status: number, value: unknown): CloudImportError {
  if (status === 401) return new CloudImportError('unauthorized', status);
  const body = object(value);
  const code = body?.error;
  if (code === 'statement_options_conflict') {
    const statementImportId = parseStatementImportId(body?.statementImportId);
    const order = body?.previousDateOrder;
    const reason = body?.reason;
    const statementImportIds = parseStatementImportIds(body?.statementImportIds);
    const detail: StatementConflictDetail = {
      ...(typeof statementImportId === 'string' ? { statementImportId } : {}),
      ...(statementImportIds ? { statementImportIds } : {}),
      ...(order === 'day-first' || order === 'month-first' ? { previousDateOrder: order } : {}),
      ...(reason === 'options' || reason === 'parser' || reason === 'unknown' ? { reason } : {}),
    };
    return new CloudImportError('statement_options_conflict', status, detail);
  }
  if (typeof code === 'string' && KNOWN_ERRORS.has(code as CloudImportErrorCode)) {
    return new CloudImportError(code as CloudImportErrorCode, status, undefined, body?.layout);
  }
  if (status === 429) return new CloudImportError('rate_limited', status);
  if (status >= 500) return new CloudImportError('service', status);
  return new CloudImportError('unexpected', status);
}
