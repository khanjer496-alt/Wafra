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
}

export interface PdfImportAccepted {
  acceptedRows: number;
  pages: number;
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
  | 'too_large'
  | 'too_many_pages'
  | 'too_many_rows'
  | 'unreadable_pdf'
  | 'unsupported_statement_format'
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

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Reject a partial or invented capability document instead of guessing limits. */
export function parseImportCapabilities(value: unknown): ImportCapabilities | null {
  const root = object(value);
  const email = object(root?.email);
  const pdf = object(root?.pdf);
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
  };
}

export function parsePdfImportAccepted(value: unknown): PdfImportAccepted | null {
  const body = object(value);
  if (!positiveInt(body?.acceptedRows) || !positiveInt(body.pages)) return null;
  return { acceptedRows: body.acceptedRows, pages: body.pages };
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
  'too_large',
  'too_many_pages',
  'too_many_rows',
  'unreadable_pdf',
  'unsupported_statement_format',
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
