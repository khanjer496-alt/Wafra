import { toISODate } from '@/lib/format';
import { createLaunchAlertSession } from '@/lib/launch-alert-parser';
import {
  nonPostingReason,
} from '@/lib/sms-parser';
import type { CategoryId } from '@/lib/types';
import type { DeclinedSms, ScannedSms } from '@/lib/import-plan';

/** The version emitted by the published Wafra history Shortcut. */
export const HISTORICAL_MESSAGE_VERSION = 1 as const;
export const MAX_HISTORICAL_RECORDS = 10_000;
export const MAX_HISTORICAL_TEXT_BYTES = 16 * 1024;

const ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const UTC_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const UNSAFE_SENDER_RE = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;

export interface HistoricalMessageRecord {
  v: typeof HISTORICAL_MESSAGE_VERSION;
  /** SHA-256/base64url identity produced from the Apple Message GUID. */
  id: string;
  text: string;
  sender?: string;
  /** UTC ISO-8601 instant derived from the Message object's Date property. */
  receivedAt: string;
}

export interface HistoricalImportResult {
  parsed: ScannedSms[];
  declined: DeclinedSms[];
  totalCount: number;
  acceptedCount: number;
  invalidCount: number;
  ignoredCount: number;
  duplicateCount: number;
  newestTs: number;
}

/** UTF-8 byte count without relying on TextEncoder being present in Hermes. */
function utf8Bytes(value: string): number | null {
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(i + 1);
      if (low < 0xdc00 || low > 0xdfff) return null;
      bytes += 4;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return null;
    } else if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function ownKeysOnly(record: Record<string, unknown>): boolean {
  const allowed = new Set(['v', 'id', 'text', 'sender', 'receivedAt']);
  return Object.keys(record).every((key) => allowed.has(key));
}

function parseInstant(value: unknown, nowMs: number): number | null {
  if (typeof value !== 'string' || !UTC_INSTANT_RE.test(value)) return null;
  const canonical = value.length === 20 ? value.replace(/Z$/, '.000Z') : value;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  // Date.parse normalises impossible dates (such as 31 February); the
  // round-trip makes those invalid instead of quietly moving the transaction.
  if (new Date(timestamp).toISOString() !== canonical) return null;
  // A small clock-skew allowance is enough for real devices and rejects a
  // malformed Shortcut date that would otherwise poison duplicate ordering.
  if (timestamp > nowMs + 5 * 60_000) return null;
  return timestamp;
}

function decodeRecord(input: string, nowMs: number): {
  record: HistoricalMessageRecord;
  timestamp: number;
} | null {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  if (!ownKeysOnly(object)) return null;
  if (object.v !== HISTORICAL_MESSAGE_VERSION) return null;
  if (typeof object.id !== 'string' || !ID_RE.test(object.id)) return null;
  if (typeof object.text !== 'string' || !object.text.trim()) return null;
  const textBytes = utf8Bytes(object.text);
  if (textBytes === null || textBytes > MAX_HISTORICAL_TEXT_BYTES) return null;
  // Sender is useful routing metadata, not part of the financial event. A
  // Contact object, control mark, or unexpectedly long label from Shortcuts
  // must not make an otherwise valid bank alert disappear; fail open by
  // omitting only the untrusted optional field.
  const sender =
    typeof object.sender === 'string' &&
    object.sender.length > 0 &&
    object.sender.length <= 80 &&
    !UNSAFE_SENDER_RE.test(object.sender)
      ? object.sender
      : undefined;
  const timestamp = parseInstant(object.receivedAt, nowMs);
  if (timestamp === null) return null;
  return {
    record: {
      v: HISTORICAL_MESSAGE_VERSION,
      id: object.id,
      text: object.text,
      ...(sender === undefined ? {} : { sender }),
      receivedAt: object.receivedAt as string,
    },
    timestamp,
  };
}

/**
 * Parse a staged iOS history session entirely on-device.
 *
 * Raw text exists only while the launch interpreter is running. It is
 * explicitly removed before a row leaves this function, including unreadable
 * and declined rows.
 */
export function parseHistoricalMessageRecords(
  inputs: string[],
  overrides?: Record<string, CategoryId>,
  now: Date = new Date(),
  seen: Set<string> = new Set(),
): HistoricalImportResult {
  const limited = inputs.slice(0, MAX_HISTORICAL_RECORDS);
  let invalidCount = Math.max(0, inputs.length - limited.length);
  let ignoredCount = 0;
  let duplicateCount = 0;
  let newestTs = 0;
  const parsed: ScannedSms[] = [];
  const declined: DeclinedSms[] = [];
  const launchSession = createLaunchAlertSession({ overrides: overrides ?? {} });

  for (const input of limited) {
    const decoded = typeof input === 'string' ? decodeRecord(input, now.getTime()) : null;
    if (!decoded) {
      invalidCount += 1;
      continue;
    }
    const { record, timestamp } = decoded;
    if (seen.has(record.id)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(record.id);
    newestTs = Math.max(newestTs, timestamp);

    const sender = record.sender?.trim();
    const senderLabel = sender ?? '';
    const inspection = launchSession.inspect(record.text, senderLabel);
    const result = launchSession.parse(record.text, senderLabel, inspection);
    if (!result) {
      const reason = nonPostingReason(record.text);
      if (reason) {
        declined.push({
          smsTs: timestamp,
          sender,
          channel: 'inbox',
          sourceEventId: record.id,
          reason,
        });
      } else {
        ignoredCount += 1;
      }
      continue;
    }

    // Never spread `raw` across this boundary: historical source text is more
    // sensitive than an ordinary Android scan and is not needed after parse.
    const { raw: _raw, ...structured } = result;
    parsed.push({
      ...structured,
      date: structured.date ?? toISODate(new Date(timestamp)),
      smsTs: timestamp,
      sender,
      channel: 'inbox',
      sourceEventId: record.id,
    });
  }

  // Stable chronological order makes plans deterministic across Shortcut
  // chunking and interrupted/resumed runs.
  parsed.sort((a, b) => (a.smsTs ?? 0) - (b.smsTs ?? 0));
  declined.sort((a, b) => a.smsTs - b.smsTs);

  return {
    parsed,
    declined,
    totalCount: inputs.length,
    acceptedCount: parsed.length,
    invalidCount,
    ignoredCount,
    duplicateCount,
    newestTs,
  };
}
