import { toISODate } from '@/lib/format';
import {
  identifySourceFreeReviewAlert,
  inspectSourceFreeRefusedAlert,
  shouldReviewParsedIncome,
} from '@/lib/auto-import';
import {
  REVIEW_ALERT_TTL_MS,
  appleMessageReviewIdentity,
  type ReviewEntry,
} from '@/lib/alert-review-tray';
import {
  createLaunchAlertSession,
  type LaunchAlertSession,
} from '@/lib/launch-alert-parser';
import { bankFromSender } from '@/lib/markets';
import type { CategoryId } from '@/lib/types';
import type { DeclinedSms, ScannedSms } from '@/lib/import-plan';

/** The version emitted by the published Wafra history Shortcut. */
export const HISTORICAL_MESSAGE_VERSION = 1 as const;
export const MAX_HISTORICAL_RECORDS = 10_000;
export const MAX_HISTORICAL_TEXT_BYTES = 16 * 1024;

const ID_RE = /^[0-9a-f]{64}$/;
const UTC_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const UNSAFE_SENDER_RE = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;
const MAX_JSON_CONTAINER_DEPTH = 64;

export interface HistoricalMessageRecord {
  v: typeof HISTORICAL_MESSAGE_VERSION;
  /** Lowercase hexadecimal SHA-256 identity produced from the Apple Message GUID. */
  id: string;
  text: string;
  sender?: string;
  /** UTC ISO-8601 instant derived from the Message object's Date property. */
  receivedAt: string;
}

export interface HistoricalImportResult {
  parsed: ScannedSms[];
  reviewCandidates: ReviewEntry[];
  declined: DeclinedSms[];
  totalCount: number;
  acceptedCount: number;
  invalidCount: number;
  ignoredCount: number;
  duplicateCount: number;
  newestTs: number;
}

type HistoricalRefusal =
  | { kind: 'declined'; row: DeclinedSms }
  | { kind: 'review'; item: ReviewEntry }
  | { kind: 'ignored' };

const inspectHistoricalRefusal = (input: {
  record: HistoricalMessageRecord;
  timestamp: number;
  nowMs: number;
  session: LaunchAlertSession;
  inspection: ReturnType<LaunchAlertSession['inspect']>;
}): HistoricalRefusal => {
  const decision = inspectSourceFreeRefusedAlert({
    source: input.record.text,
    sender: input.record.sender?.trim() ?? '',
    observedAt: input.timestamp,
    channel: 'inbox',
    session: input.session,
    existingInspection: input.inspection,
  });
  if (decision.kind === 'declined') {
    return {
      kind: 'declined',
      row: {
        smsTs: input.timestamp,
        channel: 'inbox',
        sourceEventId: input.record.id,
        reason: decision.reason,
      },
    };
  }
  if (decision.kind === 'ignored') return decision;
  const identity = appleMessageReviewIdentity(input.record.id);
  if (!identity) return { kind: 'ignored' };
  const identified = identifySourceFreeReviewAlert(
    decision.candidate,
    identity,
  );
  if (!identified) return { kind: 'ignored' };
  return {
    kind: 'review',
    item: {
      ...identified,
      channel: 'shortcut',
      // An old Message is newly discovered now. Keep its real event timestamp,
      // but give the user the ordinary review window from this import rather
      // than immediately expiring years of otherwise reviewable history.
      expiresAt: Math.max(identified.expiresAt, input.nowMs + REVIEW_ALERT_TTL_MS),
    },
  };
};

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

function hasUniqueJsonMembers(input: string): boolean {
  let index = 0;
  const isWhitespace = (code: number): boolean =>
    code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20;
  const skipWhitespace = (): void => {
    while (index < input.length && isWhitespace(input.charCodeAt(index))) index += 1;
  };
  const consume = (character: string): boolean => {
    if (input[index] !== character) return false;
    index += 1;
    return true;
  };
  const parseString = (): string | null => {
    if (input[index] !== '"') return null;
    const start = index;
    index += 1;
    while (index < input.length) {
      if (input[index] === '"') {
        index += 1;
        try {
          const value: unknown = JSON.parse(input.slice(start, index));
          return typeof value === 'string' ? value : null;
        } catch {
          return null;
        }
      }
      index += input[index] === '\\' ? 2 : 1;
    }
    return null;
  };
  const parseValue = (containerDepth: number): boolean => {
    skipWhitespace();
    if (index >= input.length) return false;
    if (input[index] === '{') {
      if (containerDepth >= MAX_JSON_CONTAINER_DEPTH) return false;
      return parseObject(containerDepth + 1);
    }
    if (input[index] === '[') {
      if (containerDepth >= MAX_JSON_CONTAINER_DEPTH) return false;
      return parseArray(containerDepth + 1);
    }
    if (input[index] === '"') return parseString() !== null;
    const start = index;
    while (
      index < input.length &&
      !isWhitespace(input.charCodeAt(index)) &&
      ![',', ']', '}'].includes(input[index])
    ) index += 1;
    return index > start;
  };
  const parseObject = (containerDepth: number): boolean => {
    if (!consume('{')) return false;
    skipWhitespace();
    if (consume('}')) return true;
    const names = new Set<string>();
    while (index < input.length) {
      skipWhitespace();
      const name = parseString();
      if (name === null || names.has(name)) return false;
      names.add(name);
      skipWhitespace();
      if (!consume(':') || !parseValue(containerDepth)) return false;
      skipWhitespace();
      if (consume('}')) return true;
      if (!consume(',')) return false;
    }
    return false;
  };
  const parseArray = (containerDepth: number): boolean => {
    if (!consume('[')) return false;
    skipWhitespace();
    if (consume(']')) return true;
    while (index < input.length) {
      if (!parseValue(containerDepth)) return false;
      skipWhitespace();
      if (consume(']')) return true;
      if (!consume(',')) return false;
    }
    return false;
  };

  if (!parseValue(0)) return false;
  skipWhitespace();
  return index === input.length;
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
  if (!hasUniqueJsonMembers(input)) return null;
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
  launchSession: LaunchAlertSession = createLaunchAlertSession({ overrides: overrides ?? {} }),
): HistoricalImportResult {
  const limited = inputs.slice(0, MAX_HISTORICAL_RECORDS);
  let invalidCount = Math.max(0, inputs.length - limited.length);
  let ignoredCount = 0;
  let duplicateCount = 0;
  let newestTs = 0;
  const parsed: ScannedSms[] = [];
  const reviewCandidates: ReviewEntry[] = [];
  const declined: DeclinedSms[] = [];
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
    const senderBank = sender ? bankFromSender(sender)?.name : undefined;
    const inspection = launchSession.inspect(record.text, sender ?? '');
    const result = launchSession.parse(record.text, sender ?? '', inspection);
    if (!result) {
      const refusal = inspectHistoricalRefusal({
        record,
        timestamp,
        nowMs: now.getTime(),
        session: launchSession,
        inspection,
      });
      if (refusal.kind === 'declined') declined.push(refusal.row);
      else if (refusal.kind === 'review') reviewCandidates.push(refusal.item);
      else ignoredCount += 1;
      continue;
    }
    if (shouldReviewParsedIncome(result)) {
      const refusal = inspectHistoricalRefusal({
        record,
        timestamp,
        nowMs: now.getTime(),
        session: launchSession,
        inspection,
      });
      if (refusal.kind === 'declined') declined.push(refusal.row);
      if (refusal.kind === 'review') {
        reviewCandidates.push(refusal.item);
        continue;
      }
    }

    // Never spread `raw` across this boundary: historical source text is more
    // sensitive than an ordinary Android scan and is not needed after parse.
    const { raw: _raw, ...structured } = result;
    parsed.push({
      ...structured,
      bankHint: structured.bankHint ?? senderBank,
      // Receipt time dates a transaction, never an unstated card deadline.
      date: structured.kind === 'cardStatement' ? structured.date : structured.date ?? toISODate(new Date(timestamp)),
      smsTs: timestamp,
      channel: 'inbox',
      sourceEventId: record.id,
    });
  }

  // Stable chronological order makes plans deterministic across Shortcut
  // chunking and interrupted/resumed runs.
  parsed.sort((a, b) => (a.smsTs ?? 0) - (b.smsTs ?? 0));
  reviewCandidates.sort((a, b) => a.observedAt - b.observedAt);
  declined.sort((a, b) => a.smsTs - b.smsTs);

  return {
    parsed,
    reviewCandidates,
    declined,
    totalCount: inputs.length,
    acceptedCount: parsed.length,
    invalidCount,
    ignoredCount,
    duplicateCount,
    newestTs,
  };
}
