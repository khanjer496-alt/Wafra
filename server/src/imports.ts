/** In-memory normalization for forwarded bank email and text-based statements. */
import PostalMime from 'postal-mime';
import { extractText, getDocumentProxy } from 'unpdf';

import type { ParsedSms } from '@/lib/sms-parser';

const MAX_NORMALIZED_CHARS = 128_000;
const DATE_TOKEN = String.raw`(?:\d{4}-\d{2}-\d{2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})`;
const AMOUNT_TOKEN = String.raw`(?:AED\s*)?([\d,]+(?:\.\d{2})?)`;
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
): Promise<{ text: string; pdfAttachments: Uint8Array[] }> {
  const email = await PostalMime.parse(raw, { attachmentEncoding: 'arraybuffer' });
  const text = normalizeEmailContent(email.text, email.html);
  const pdfAttachments = (email.attachments ?? [])
    .filter((attachment) =>
      attachment.mimeType === 'application/pdf' || /\.pdf$/i.test(attachment.filename ?? ''),
    )
    .map((attachment) => {
      const content = attachment.content;
      if (content instanceof Uint8Array) return content;
      if (typeof content !== 'string') return new Uint8Array(content);
      const binary = atob(content);
      return Uint8Array.from(binary, (char) => char.charCodeAt(0));
    });
  return { text, pdfAttachments };
}

function isoDate(value: string): string | null {
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
export function parseStatementText(text: string): ParsedSms[] {
  const rows: ParsedSms[] = [];
  const seen = new Set<string>();
  for (const original of text.split(/\n+/)) {
    const line = original.replace(/\s+/g, ' ').trim();
    if (!line || line.length > 400) continue;
    const match = ROW_END_DIRECTION.exec(line) ?? ROW_MIDDLE_DIRECTION.exec(line);
    if (!match) continue;
    const date = isoDate(match[1]);
    if (!date) continue;
    const merchant = match[2].replace(/\s+/g, ' ').trim();
    const endDirection = /^(?:DR|CR|DEBIT|CREDIT)$/i.test(match[4] ?? '');
    const amountText = endDirection ? match[3] : match[4];
    const direction = (endDirection ? match[4] : match[3]).toUpperCase();
    const amountFils = Math.round(Number(amountText.replace(/,/g, '')) * 100);
    if (!Number.isSafeInteger(amountFils) || amountFils <= 0 || !merchant) continue;
    const type = direction === 'CR' || direction === 'CREDIT' ? 'income' : 'expense';
    const key = `${date}|${type}|${amountFils}|${merchant.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      kind: 'transaction', type, amountFils, currency: 'AED', merchant, date,
      dueDay: null, minDueFils: null, card: null, reference: null, transferHint: false,
      snapshotFils: null, snapshotKind: null, categoryGuess: 'other', raw: line,
    });
  }
  return rows;
}

export async function extractPdfStatementRows(bytes: Uint8Array): Promise<{
  pages: number;
  rows: ParsedSms[];
}> {
  const document = await getDocumentProxy(bytes);
  try {
    const extracted = await extractText(document, { mergePages: true });
    if (extracted.text.length > MAX_NORMALIZED_CHARS) throw new Error('PDF text exceeds limit');
    return { pages: extracted.totalPages, rows: parseStatementText(extracted.text) };
  } finally {
    const disposable = document as unknown as {
      destroy?: () => Promise<void> | void;
      cleanup?: () => Promise<void> | void;
    };
    if (disposable.destroy) await disposable.destroy();
    else if (disposable.cleanup) await disposable.cleanup();
  }
}
