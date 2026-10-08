/** Native transport for forwarded-email and statement-file supplements. */
import { fetch as expoFetch } from 'expo/fetch';
import { Directory, File, Paths } from 'expo-file-system';

import {
  CloudImportError,
  csvMaxBytes,
  parseCsvImportAccepted,
  parseImportCapabilities,
  parseEmailForwardingCredential,
  parsePdfImportAccepted,
  pdfImportError,
  pdfPasswordHeaders,
  pdfPasswordUnusable,
  XLSX_CONTENT_TYPE,
  type ImportCapabilities,
  type CsvImportAccepted,
  type PdfImportAccepted,
  type EmailForwardingCredential,
} from '@/lib/cloud-import-contract';
import type { RelayConfig } from '@/lib/relay';
import type { LedgerMoneySpec } from '@/lib/ledger-money';

const REQUEST_TIMEOUT_MS = 60_000;
/**
 * One deadline covers the upload and the server's read, so a fixed minute
 * failed a 5 MB statement on a slow uplink even when the server went on to
 * queue its rows. Allow the time a ~32 KB/s connection needs to send the file,
 * up to five minutes; small files keep the plain one-minute deadline.
 */
const UPLOAD_BYTES_PER_SECOND = 32 * 1024;
const MAX_UPLOAD_TIMEOUT_MS = 5 * 60_000;
export const uploadTimeoutMs = (bytes: number): number =>
  Math.min(MAX_UPLOAD_TIMEOUT_MS, REQUEST_TIMEOUT_MS + Math.floor(bytes / UPLOAD_BYTES_PER_SECOND) * 1000);

export interface PickedStatement {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number;
  /** Expo DocumentPicker supplies the browser File on web. */
  file?: Blob;
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function relayFetch(
  url: string,
  token: string,
  init: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<{ response: Response; body: unknown }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // Settle the caller even if a native stream ignores cancellation. Abort
      // still releases the underlying request where the transport supports it.
      reject(new CloudImportError('network'));
      try { controller.abort(); } catch { /* The deadline already rejected. */ }
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await expoFetch(url, {
          ...init,
          signal: controller.signal,
          headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/json',
            ...(init.headers ?? {}),
          },
        });
        // Fetch resolves at headers; body streaming remains part of the same
        // deadline. A successful revocation deliberately has no body to read.
        const body = response.status === 204 ? null : await safeJson(response);
        return { response, body };
      })(),
      deadline,
    ]);
  } catch {
    throw new CloudImportError('network');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * What this build understands, sent on the capability read and on statement
 * uploads. A relay shows Excel and the specific PDF errors (damaged,
 * unsupported protection) only to builds that send it; older builds keep
 * the answers they always had.
 */
export const IMPORT_FEATURES_HEADER = { 'x-wafra-import-features': 'xlsx,pdf-error-detail' } as const;

/**
 * How the user's country writes a bare numeric date (country.ts
 * statementDateOrderForCountry); null when the country does not settle it.
 */
export type StatementDateOrder = 'day-first' | 'month-first' | null;

/** Omitted entirely when the caller did not say, so the relay applies its legacy rule. */
function dateOrderHeader(dateOrder: StatementDateOrder | undefined): Record<string, string> {
  return dateOrder === undefined ? {} : { 'x-wafra-date-order': dateOrder ?? 'unknown' };
}

export async function getImportCapabilities(cfg: RelayConfig): Promise<ImportCapabilities> {
  const { response, body } = await relayFetch(
    `${cfg.baseUrl}/v1/import/capabilities`,
    cfg.adminToken,
    { method: 'GET', headers: { ...IMPORT_FEATURES_HEADER } },
  );
  if (!response.ok) throw pdfImportError(response.status, body);
  const capabilities = parseImportCapabilities(body);
  if (!capabilities) throw new CloudImportError('unexpected', response.status);
  return capabilities;
}

/**
 * Mint a forwarding address. `locale` records the ledger currency and the
 * country's numeric date order the relay reads forwarded statements under;
 * without it the relay keeps the launch rule (AED/SAR from the market pack).
 */
export async function createEmailForwardingAddress(
  cfg: RelayConfig,
  locale?: { ledgerMoney: LedgerMoneySpec; dateOrder: StatementDateOrder },
): Promise<EmailForwardingCredential> {
  const { response, body } = await relayFetch(`${cfg.baseUrl}/v1/email-token`, cfg.adminToken, {
    method: 'POST',
    ...(locale ? {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ledgerCurrency: locale.ledgerMoney.currency,
        ledgerExponent: locale.ledgerMoney.exponent,
        dateOrder: locale.dateOrder ?? 'unknown',
      }),
    } : {}),
  });
  if (!response.ok) throw pdfImportError(response.status, body);
  const credential = parseEmailForwardingCredential(body);
  if (!credential || response.status !== 201) {
    throw new CloudImportError('unexpected', response.status);
  }
  return credential;
}

export async function revokeEmailForwardingAddress(cfg: RelayConfig): Promise<void> {
  const { response, body } = await relayFetch(`${cfg.baseUrl}/v1/email-token`, cfg.adminToken, {
    method: 'DELETE',
  });
  if (response.status === 204) return;
  throw pdfImportError(response.status, body);
}

/** Statement file names the cleanup below may delete; nothing else is touched. */
const STATEMENT_COPY = /\.(?:pdf|csv|tsv|xlsx)$/i;

/**
 * Delete statement copies left in the two places Wafra receives them.
 *
 * `copyToCacheDirectory: true` writes each picked file to
 * `<cache>/DocumentPicker/<uuid>.<ext>` (both platforms, SDK 55), and a
 * statement opened in Wafra from the iOS Share Sheet or Files arrives as a
 * copy in `<documents>/Inbox` (LSSupportsOpeningDocumentsInPlace is false).
 * The import deletes its copies when it finishes, but a session that ends
 * mid-import — the app killed while a statement uploads, or a file opened
 * before setup finished — leaves a readable bank statement behind; the Inbox
 * copy would even reach a device backup. Only statement extensions are
 * touched, so a backup file picked from Settings is never removed from under
 * a restore, and `keep` spares a copy an upload is still reading or a file
 * that was just handed over and is waiting to be imported.
 */
export function clearStatementPickerCache(keep: ReadonlySet<string> = new Set()): void {
  // Compared by file name: the picker names each copy with a fresh UUID, and
  // the picker's URI and the directory listing's may spell the scheme apart.
  const baseName = (uri: string) => {
    try {
      return decodeURIComponent(uri.split('/').pop() ?? '');
    } catch {
      return uri.split('/').pop() ?? '';
    }
  };
  const kept = new Set([...keep].map(baseName));
  for (const location of [() => new Directory(Paths.cache, 'DocumentPicker'), () => new Directory(Paths.document, 'Inbox')]) {
    try {
      const directory = location();
      if (!directory.exists) continue;
      for (const entry of directory.list()) {
        if (!(entry instanceof File) || !STATEMENT_COPY.test(entry.uri) || kept.has(baseName(entry.uri))) continue;
        try {
          entry.delete();
        } catch {
          // Best effort: the OS may already have reclaimed it.
        }
      }
    } catch {
      // A missing or unreadable folder has nothing to clear.
    }
  }
}

/**
 * Upload the picked cache copy as the request body itself. SDK 55's File
 * implements Blob, so no base64 conversion, multipart envelope, or deprecated
 * FileSystem upload API is involved.
 */
export async function uploadPdfStatement(
  cfg: RelayConfig,
  picked: PickedStatement,
  capabilities: ImportCapabilities,
  ledgerMoney: LedgerMoneySpec,
  password?: string,
  dateOrder?: StatementDateOrder,
): Promise<PdfImportAccepted> {
  if (!capabilities.pdf.enabled || !capabilities.pdf.accepts.includes('application/pdf')) {
    throw new CloudImportError('service');
  }
  const file = picked.file ?? new File(picked.uri);
  if (!picked.file && !(file as File).exists) throw new CloudImportError('invalid_pdf');
  const size = file.size;
  if (!Number.isFinite(size) || size <= 0) throw new CloudImportError('invalid_pdf');
  if (size > capabilities.pdf.maxBytes) throw new CloudImportError('too_large', 413);
  // The relay would refuse this password; say so without sending the file.
  if (pdfPasswordUnusable(password, capabilities)) throw new CloudImportError('pdf_password_invalid', 400);

  const { response, body } = await relayFetch(`${cfg.baseUrl}/v1/import/pdf`, cfg.adminToken, {
    method: 'POST',
    headers: {
      'content-type': 'application/pdf',
      ...IMPORT_FEATURES_HEADER,
      'x-wafra-ledger-currency': ledgerMoney.currency,
      'x-wafra-ledger-exponent': String(ledgerMoney.exponent),
      ...dateOrderHeader(dateOrder),
      ...pdfPasswordHeaders(password, capabilities),
    },
    body: file,
  }, uploadTimeoutMs(size));
  if (!response.ok) throw pdfImportError(response.status, body);
  const accepted = parsePdfImportAccepted(body);
  if (!accepted) throw new CloudImportError('unexpected', response.status);
  return accepted;
}

/**
 * Upload a user-selected delimited statement (or, when the relay advertises
 * it, an Excel workbook) without base64 or multipart encoding. Excel shares
 * the CSV endpoint and its advertised size limit.
 */
export async function uploadCsvStatement(
  cfg: RelayConfig,
  picked: PickedStatement,
  capabilities: ImportCapabilities,
  ledgerMoney: LedgerMoneySpec,
  dateOrder?: StatementDateOrder,
): Promise<CsvImportAccepted> {
  if (!capabilities.csv.enabled) throw new CloudImportError('service');
  const file = picked.file ?? new File(picked.uri);
  if (!picked.file && !(file as File).exists) throw new CloudImportError('invalid_csv');
  const size = file.size;
  if (!Number.isFinite(size) || size <= 0) throw new CloudImportError('invalid_csv');

  const extension = /\.(csv|tsv|xlsx)$/i.exec(picked.name)?.[1].toLowerCase();
  const extensionType = extension === 'tsv'
    ? 'text/tab-separated-values'
    : extension === 'xlsx'
      ? XLSX_CONTENT_TYPE
      : 'text/csv';
  const requestedType = picked.mimeType?.split(';', 1)[0].trim().toLowerCase();
  // A workbook is never sent as text, nor text as a workbook: a known
  // extension settles that pair; otherwise the picker's advertised type wins.
  const contentType = extension === 'xlsx'
    ? XLSX_CONTENT_TYPE
    : requestedType && capabilities.csv.accepts.includes(requestedType) &&
        !(requestedType === XLSX_CONTENT_TYPE && extension !== undefined)
      ? requestedType
      : extensionType;
  if (!capabilities.csv.accepts.includes(contentType)) {
    // An Excel file (opened from Files) on a relay that does not read them yet.
    throw new CloudImportError(contentType === XLSX_CONTENT_TYPE ? 'unsupported_file_type' : 'service');
  }
  // A per-type ceiling when the relay advertises one, else the CSV limit.
  if (size > csvMaxBytes(capabilities, contentType)) throw new CloudImportError('too_large', 413);

  const { response, body } = await relayFetch(`${cfg.baseUrl}/v1/import/csv`, cfg.adminToken, {
    method: 'POST',
    headers: {
      'content-type': contentType,
      ...IMPORT_FEATURES_HEADER,
      'x-wafra-ledger-currency': ledgerMoney.currency,
      'x-wafra-ledger-exponent': String(ledgerMoney.exponent),
      ...dateOrderHeader(dateOrder),
    },
    body: file,
  }, uploadTimeoutMs(size));
  if (!response.ok) throw pdfImportError(response.status, body);
  const accepted = parseCsvImportAccepted(body);
  if (!accepted) throw new CloudImportError('unexpected', response.status);
  return accepted;
}
