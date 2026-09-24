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
  };
  csv: {
    enabled: boolean;
    accepts: string[];
    maxBytes: number;
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
  acceptedRows: number;
  /** Date-led money lines the relay would not read; 0 from a relay that predates the field. */
  rejectedRows: number;
  /** Accepted + rejected rows; synthesized for an older relay response. */
  totalRows: number;
  pages: number;
  coverage: StatementImportCoverage | null;
  /** Of rejectedRows: card rows with a bare sign the statement never explains. */
  cardSignRowsSkipped: number;
}

export interface CsvImportAccepted {
  acceptedRows: number;
  rejectedRows: number;
  totalRows: number;
  coverage: StatementImportCoverage | null;
  /** Of rejectedRows: card rows with a bare sign the statement never explains. */
  cardSignRowsSkipped: number;
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
  | 'unsupported_statement_format'
  | 'ambiguous_card_signs'
  | 'rate_limited'
  | 'queue_full'
  | 'email_not_configured'
  | 'service'
  | 'unexpected';

export class CloudImportError extends Error {
  constructor(
    readonly code: CloudImportErrorCode,
    readonly status?: number,
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
  const csvCapability: ImportCapabilities['csv'] = csv
    ? {
        enabled: csv.enabled as boolean,
        accepts: [...(csv.accepts as string[])],
        maxBytes: csv.maxBytes as number,
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
    },
    csv: csvCapability,
  };
}

function parseStatementCoverage(value: unknown): StatementImportCoverage | null {
  if (value === null || value === undefined) return null;
  const row = object(value);
  if (!row || typeof row.sourceKey !== 'string' || row.sourceKey.length < 1 || row.sourceKey.length > 80 ||
      typeof row.label !== 'string' || row.label.length < 1 || row.label.length > 80 ||
      typeof row.startDate !== 'string' || typeof row.endDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(row.endDate) ||
      row.startDate > row.endDate) return null;
  return { sourceKey: row.sourceKey, label: row.label, startDate: row.startDate, endDate: row.endDate };
}

export function parsePdfImportAccepted(value: unknown): PdfImportAccepted | null {
  const body = object(value);
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
  if (cardSignRowsSkipped === null) return null;
  return {
    acceptedRows: body.acceptedRows, rejectedRows, totalRows, pages: body.pages, coverage, cardSignRowsSkipped,
  };
}

/** Optional (older relays omit it) and never more than the rows skipped. */
function cardSignSkips(value: unknown, rejectedRows: number): number | null {
  if (value === undefined) return 0;
  return nonNegativeInt(value) && value <= rejectedRows ? value : null;
}

export function parseCsvImportAccepted(value: unknown): CsvImportAccepted | null {
  const body = object(value);
  if (
    !positiveInt(body?.acceptedRows) ||
    !nonNegativeInt(body.rejectedRows) ||
    !positiveInt(body.totalRows) ||
    body.acceptedRows + body.rejectedRows !== body.totalRows
  ) return null;
  const coverage = parseStatementCoverage(body.coverage);
  if (body.coverage !== null && body.coverage !== undefined && !coverage) return null;
  const cardSignRowsSkipped = cardSignSkips(body.cardSignRowsSkipped, body.rejectedRows);
  if (cardSignRowsSkipped === null) return null;
  return {
    acceptedRows: body.acceptedRows,
    rejectedRows: body.rejectedRows,
    totalRows: body.totalRows,
    coverage,
    cardSignRowsSkipped,
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
  'unsupported_statement_format',
  'ambiguous_card_signs',
  'rate_limited',
  'queue_full',
  'email_not_configured',
]);

/** Convert HTTP status + safe JSON error code into a finite UI state. */
export function pdfImportError(status: number, value: unknown): CloudImportError {
  if (status === 401) return new CloudImportError('unauthorized', status);
  const code = object(value)?.error;
  if (typeof code === 'string' && KNOWN_ERRORS.has(code as CloudImportErrorCode)) {
    return new CloudImportError(code as CloudImportErrorCode, status);
  }
  if (status === 429) return new CloudImportError('rate_limited', status);
  if (status >= 500) return new CloudImportError('service', status);
  return new CloudImportError('unexpected', status);
}
