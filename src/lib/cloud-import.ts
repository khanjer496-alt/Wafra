/** Native transport for forwarded-email and statement-file supplements. */
import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';

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

async function relayFetch(url: string, token: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await expoFetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new CloudImportError('network');
  } finally {
    clearTimeout(timer);
  }
}

export async function getImportCapabilities(cfg: RelayConfig): Promise<ImportCapabilities> {
  const response = await relayFetch(
    `${cfg.baseUrl}/v1/import/capabilities`,
    cfg.adminToken,
    { method: 'GET' },
  );
  const body = await safeJson(response);
  if (!response.ok) throw pdfImportError(response.status, body);
  const capabilities = parseImportCapabilities(body);
  if (!capabilities) throw new CloudImportError('unexpected', response.status);
  return capabilities;
}

export async function createEmailForwardingAddress(
  cfg: RelayConfig,
): Promise<EmailForwardingCredential> {
  const response = await relayFetch(`${cfg.baseUrl}/v1/email-token`, cfg.adminToken, {
    method: 'POST',
  });
  const body = await safeJson(response);
  if (!response.ok) throw pdfImportError(response.status, body);
  const credential = parseEmailForwardingCredential(body);
  if (!credential || response.status !== 201) {
    throw new CloudImportError('unexpected', response.status);
  }
  return credential;
}

export async function revokeEmailForwardingAddress(cfg: RelayConfig): Promise<void> {
  const response = await relayFetch(`${cfg.baseUrl}/v1/email-token`, cfg.adminToken, {
    method: 'DELETE',
  });
  if (response.status === 204) return;
  throw pdfImportError(response.status, await safeJson(response));
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
): Promise<PdfImportAccepted> {
  if (!capabilities.pdf.enabled || !capabilities.pdf.accepts.includes('application/pdf')) {
    throw new CloudImportError('service');
  }
  const file = new File(picked.uri);
  if (!file.exists) throw new CloudImportError('invalid_pdf');
  const size = picked.size ?? file.size;
  if (!Number.isFinite(size) || size <= 0) throw new CloudImportError('invalid_pdf');
  if (size > capabilities.pdf.maxBytes) throw new CloudImportError('too_large', 413);

  const response = await relayFetch(`${cfg.baseUrl}/v1/import/pdf`, cfg.adminToken, {
    method: 'POST',
    headers: { 'content-type': 'application/pdf' },
    body: file,
  });
  const body = await safeJson(response);
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

  const response = await relayFetch(`${cfg.baseUrl}/v1/import/csv`, cfg.adminToken, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: file,
  });
  const body = await safeJson(response);
  if (!response.ok) throw pdfImportError(response.status, body);
  const accepted = parseCsvImportAccepted(body);
  if (!accepted) throw new CloudImportError('unexpected', response.status);
  return accepted;
}
