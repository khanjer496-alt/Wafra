/** Native transport for forwarded-email and statement-file supplements. */
import { fetch as expoFetch } from 'expo/fetch';
import { Directory, File, Paths } from 'expo-file-system';

import {
  CloudImportError,
  parseCsvImportAccepted,
  parseImportCapabilities,
  parseEmailForwardingCredential,
  parsePdfImportAccepted,
  pdfImportError,
  type ImportCapabilities,
  type CsvImportAccepted,
  type PdfImportAccepted,
  type EmailForwardingCredential,
} from '@/lib/cloud-import-contract';
import type { RelayConfig } from '@/lib/relay';
import type { LedgerMoneySpec } from '@/lib/ledger-money';

const REQUEST_TIMEOUT_MS = 60_000;

export interface PickedStatement {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number;
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
): Promise<{ response: Response; body: unknown }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // Settle the caller even if a native stream ignores cancellation. Abort
      // still releases the underlying request where the transport supports it.
      reject(new CloudImportError('network'));
      try { controller.abort(); } catch { /* The deadline already rejected. */ }
    }, REQUEST_TIMEOUT_MS);
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

export async function getImportCapabilities(cfg: RelayConfig): Promise<ImportCapabilities> {
  const { response, body } = await relayFetch(
    `${cfg.baseUrl}/v1/import/capabilities`,
    cfg.adminToken,
    { method: 'GET' },
  );
  if (!response.ok) throw pdfImportError(response.status, body);
  const capabilities = parseImportCapabilities(body);
  if (!capabilities) throw new CloudImportError('unexpected', response.status);
  return capabilities;
}

export async function createEmailForwardingAddress(
  cfg: RelayConfig,
): Promise<EmailForwardingCredential> {
  const { response, body } = await relayFetch(`${cfg.baseUrl}/v1/email-token`, cfg.adminToken, {
    method: 'POST',
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

/**
 * Delete statement copies expo-document-picker left in its cache folder.
 *
 * `copyToCacheDirectory: true` writes each picked file to
 * `<cache>/DocumentPicker/<uuid>.<ext>` (both platforms, SDK 55). The import
 * deletes its copies when it finishes, but a session that ends mid-import —
 * the app killed while a statement uploads — leaves a readable bank statement
 * in the cache until the OS reclaims it. Only statement extensions are
 * touched, so a backup file picked from Settings is never removed from under
 * a restore, and `keep` spares a copy an upload is still reading.
 */
export function clearStatementPickerCache(keep: ReadonlySet<string> = new Set()): void {
  try {
    const directory = new Directory(Paths.cache, 'DocumentPicker');
    if (!directory.exists) return;
    // Compared by file name: the picker names each copy with a fresh UUID, and
    // the picker's URI and the directory listing's may spell the scheme apart.
    const baseName = (uri: string) => decodeURIComponent(uri.split('/').pop() ?? '');
    const kept = new Set([...keep].map(baseName));
    for (const entry of directory.list()) {
      if (!(entry instanceof File) || !/\.(?:pdf|csv|tsv)$/i.test(entry.uri) || kept.has(baseName(entry.uri))) continue;
      try {
        entry.delete();
      } catch {
        // Best effort: the OS may already have reclaimed it.
      }
    }
  } catch {
    // A missing or unreadable cache folder has nothing to clear.
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
): Promise<PdfImportAccepted> {
  if (!capabilities.pdf.enabled || !capabilities.pdf.accepts.includes('application/pdf')) {
    throw new CloudImportError('service');
  }
  const file = new File(picked.uri);
  if (!file.exists) throw new CloudImportError('invalid_pdf');
  const size = picked.size ?? file.size;
  if (!Number.isFinite(size) || size <= 0) throw new CloudImportError('invalid_pdf');
  if (size > capabilities.pdf.maxBytes) throw new CloudImportError('too_large', 413);

  const { response, body } = await relayFetch(`${cfg.baseUrl}/v1/import/pdf`, cfg.adminToken, {
    method: 'POST',
    headers: {
      'content-type': 'application/pdf',
      'x-wafra-ledger-currency': ledgerMoney.currency,
      'x-wafra-ledger-exponent': String(ledgerMoney.exponent),
      ...(password ? { 'x-wafra-pdf-password': password } : {}),
    },
    body: file,
  });
  if (!response.ok) throw pdfImportError(response.status, body);
  const accepted = parsePdfImportAccepted(body);
  if (!accepted) throw new CloudImportError('unexpected', response.status);
  return accepted;
}

/** Upload a user-selected delimited statement without base64 or multipart encoding. */
export async function uploadCsvStatement(
  cfg: RelayConfig,
  picked: PickedStatement,
  capabilities: ImportCapabilities,
  ledgerMoney: LedgerMoneySpec,
): Promise<CsvImportAccepted> {
  if (!capabilities.csv.enabled) throw new CloudImportError('service');
  const file = new File(picked.uri);
  if (!file.exists) throw new CloudImportError('invalid_csv');
  const size = picked.size ?? file.size;
  if (!Number.isFinite(size) || size <= 0) throw new CloudImportError('invalid_csv');
  if (size > capabilities.csv.maxBytes) throw new CloudImportError('too_large', 413);

  const extensionType = /\.tsv$/i.test(picked.name)
    ? 'text/tab-separated-values'
    : 'text/csv';
  const requestedType = picked.mimeType?.split(';', 1)[0].trim().toLowerCase();
  const contentType = requestedType && capabilities.csv.accepts.includes(requestedType)
    ? requestedType
    : extensionType;
  if (!capabilities.csv.accepts.includes(contentType)) throw new CloudImportError('service');

  const { response, body } = await relayFetch(`${cfg.baseUrl}/v1/import/csv`, cfg.adminToken, {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'x-wafra-ledger-currency': ledgerMoney.currency,
      'x-wafra-ledger-exponent': String(ledgerMoney.exponent),
    },
    body: file,
  });
  if (!response.ok) throw pdfImportError(response.status, body);
  const accepted = parseCsvImportAccepted(body);
  if (!accepted) throw new CloudImportError('unexpected', response.status);
  return accepted;
}
