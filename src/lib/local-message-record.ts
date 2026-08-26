import {
  identifySourceFreeReviewAlert,
  inspectSourceFreeRefusedAlert,
  shouldReviewParsedIncome,
} from '@/lib/auto-import';
import type { ReviewAlert } from '@/lib/alert-review-tray';
import { toISODate } from '@/lib/format';
import {
  iosBankSenderIdentity,
  type IosBankSenderRegistry,
} from '@/lib/ios-bank-senders';
import type { LaunchAlertSession } from '@/lib/launch-alert-parser';
import { MARKETS, bankFromSender, bankIdentityForName } from '@/lib/markets';
import type { DeclinedSms, ScannedSms } from '@/lib/import-plan';
import type { ParsedSms } from '@/lib/sms-parser';

export const LOCAL_MESSAGE_RECORD_VERSION = 1 as const;
export const MAX_LOCAL_MESSAGE_TEXT_BYTES = 16 * 1024;
export const MAX_LOCAL_MESSAGE_SENDER_CHARACTERS = 80;
export const LOCAL_MESSAGE_FUTURE_SKEW_MS = 5 * 60_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UTC_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UNSAFE_SENDER_RE = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/u;
const ENVELOPE_KEYS = ['id', 'observedAt', 'sender', 'source', 'text', 'v'] as const;

interface LocalMessageEnvelope {
  v: typeof LOCAL_MESSAGE_RECORD_VERSION;
  id: string;
  text: string;
  sender: string;
  observedAt: string;
  source: 'message';
}

export interface LocalMessageRecordPreflight {
  id: string;
  observedAt: number | null;
  attribution: IosBankSenderAttribution | null;
  valid: boolean;
}

export interface IosBankSenderAttribution {
  market: 'AE' | 'SA';
  bankId: string;
  bankHint: string;
}

export type LocalMessageParseOutcome =
  | { kind: 'parsed'; market: 'AE' | 'SA'; row: ScannedSms; milestone: 'financial' }
  | { kind: 'declined'; market: 'AE' | 'SA'; row: DeclinedSms; milestone: 'decline-candidate' }
  | { kind: 'review'; market: 'AE' | 'SA'; item: ReviewAlert; milestone: 'review-candidate' }
  | { kind: 'ignored'; market: 'AE' | 'SA'; milestone: 'none' }
  | { kind: 'invalid'; milestone: 'none' };

/** UTF-8 length with an explicit malformed-surrogate failure for Hermes. */
export function localMessageUtf8Bytes(value: string): number | null {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (!Number.isInteger(low) || low < 0xdc00 || low > 0xdfff) return null;
      bytes += 4;
      index += 1;
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

export function parseLocalMessageObservedAt(value: unknown, nowMs: number): number | null {
  if (typeof value !== 'string' || !UTC_INSTANT_RE.test(value)) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) return null;
  if (timestamp < 0 || timestamp > nowMs + LOCAL_MESSAGE_FUTURE_SKEW_MS) return null;
  return timestamp;
}

function hasExactEnvelopeKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === ENVELOPE_KEYS.length &&
    keys.every((key, index) => key === ENVELOPE_KEYS[index]);
}

function decodeLocalMessageEnvelope(
  serialized: string,
  nowMs: number,
): { envelope: LocalMessageEnvelope; observedAt: number } | null {
  if (typeof serialized !== 'string' || localMessageUtf8Bytes(serialized) === null) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
  const value = decoded as Record<string, unknown>;
  if (!hasExactEnvelopeKeys(value) || value.v !== LOCAL_MESSAGE_RECORD_VERSION ||
    typeof value.id !== 'string' || !UUID_RE.test(value.id) ||
    typeof value.text !== 'string' ||
    typeof value.sender !== 'string' ||
    value.source !== 'message') {
    return null;
  }
  const textBytes = localMessageUtf8Bytes(value.text);
  const senderBytes = localMessageUtf8Bytes(value.sender);
  const observedAt = parseLocalMessageObservedAt(value.observedAt, nowMs);
  if (textBytes === null || textBytes === 0 || textBytes > MAX_LOCAL_MESSAGE_TEXT_BYTES ||
    senderBytes === null || value.sender.length === 0 ||
    value.sender.length > MAX_LOCAL_MESSAGE_SENDER_CHARACTERS ||
    UNSAFE_SENDER_RE.test(value.sender) || observedAt === null) {
    return null;
  }
  return {
    envelope: value as unknown as LocalMessageEnvelope,
    observedAt,
  };
}

function canonicalBankId(name: string): string | null {
  return bankIdentityForName(name)?.replace(/\s+/g, '-') ?? null;
}

/**
 * Re-resolve Task 1's exact identity, then prove its canonical bank ID agrees
 * with the launch parser's market pack. Body text is never attribution input.
 */
export function attributeIosBankSender(
  sender: string,
  registry?: IosBankSenderRegistry,
): IosBankSenderAttribution | null {
  const identity = iosBankSenderIdentity(sender, registry);
  if (!identity) return null;
  const banks = MARKETS
    .filter((market) => market.id === identity.market)
    .flatMap((market) => market.banks)
    .filter((bank) => bank.re.test(sender) && canonicalBankId(bank.name) === identity.bankId);
  if (banks.length !== 1) return null;
  return { ...identity, bankHint: banks[0].name };
}

/**
 * Validate a queue envelope into source-free page metadata. A null result has
 * no trustworthy ID and therefore cannot be acknowledged safely.
 */
export function preflightLocalMessageRecord(
  serialized: string,
  now: Date,
): LocalMessageRecordPreflight | null {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs) || typeof serialized !== 'string') return null;
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  if (typeof object.id !== 'string' || !UUID_RE.test(object.id)) return null;
  const attribution = typeof object.sender === 'string'
    ? attributeIosBankSender(object.sender)
    : null;
  const decoded = decodeLocalMessageEnvelope(serialized, nowMs);
  return {
    id: object.id,
    observedAt: decoded?.observedAt ?? null,
    attribution,
    valid: decoded !== null && attribution !== null,
  };
}

function localReviewIdentity(id: string): { id: string; sourceKey: string } {
  const opaque = id.replace(/-/g, '').toLocaleLowerCase('en-US');
  return {
    id: `local_review_id_${opaque}`,
    sourceKey: `local_review_source_${opaque}`,
  };
}

function sanitizedRefusal(
  envelope: LocalMessageEnvelope,
  observedAt: number,
  market: 'AE' | 'SA',
  session: LaunchAlertSession,
  inspection: ReturnType<LaunchAlertSession['inspect']>,
): Exclude<LocalMessageParseOutcome, { kind: 'parsed' } | { kind: 'invalid' }> {
  const decision = inspectSourceFreeRefusedAlert({
    source: envelope.text,
    sender: envelope.sender,
    observedAt,
    channel: 'inbox',
    session,
    existingInspection: inspection,
  });
  if (decision.kind === 'declined') {
    return {
      kind: 'declined',
      market,
      row: {
        smsTs: observedAt,
        channel: 'inbox',
        reason: decision.reason,
      },
      milestone: 'decline-candidate',
    };
  }
  if (decision.kind === 'review') {
    const item = identifySourceFreeReviewAlert(
      decision.candidate,
      localReviewIdentity(envelope.id),
    );
    if (item) return { kind: 'review', market, item, milestone: 'review-candidate' };
  }
  return { kind: 'ignored', market, milestone: 'none' };
}

/** Parse one native queue record without returning Message text or sender. */
export function parseLocalMessageRecord(
  serialized: string,
  now: Date,
  expectedMarket: 'AE' | 'SA',
  session: LaunchAlertSession,
): LocalMessageParseOutcome {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return { kind: 'invalid', milestone: 'none' };
  const decoded = decodeLocalMessageEnvelope(serialized, nowMs);
  if (!decoded) return { kind: 'invalid', milestone: 'none' };
  const { envelope, observedAt } = decoded;
  const attribution = attributeIosBankSender(envelope.sender);
  if (!attribution || attribution.market !== expectedMarket) {
    return { kind: 'invalid', milestone: 'none' };
  }

  try {
    const inspection = session.inspect(envelope.text, envelope.sender);
    const parsed = session.parse(
      envelope.text,
      envelope.sender,
      inspection,
      expectedMarket,
    );
    if (!parsed) {
      return sanitizedRefusal(envelope, observedAt, expectedMarket, session, inspection);
    }
    if (shouldReviewParsedIncome(parsed)) {
      const refusal = sanitizedRefusal(
        envelope,
        observedAt,
        expectedMarket,
        session,
        inspection,
      );
      if (refusal.kind === 'review') return refusal;
    }

    const parsedWithEphemeralSender = parsed as ParsedSms & { sender?: unknown };
    const {
      raw: _raw,
      sender: _sender,
      ...structured
    } = parsedWithEphemeralSender;
    const bankHint = structured.bankHint ?? bankFromSender(envelope.sender)?.name ??
      attribution.bankHint;
    if (canonicalBankId(bankHint) !== attribution.bankId) {
      return { kind: 'invalid', milestone: 'none' };
    }
    const row: ScannedSms = {
      ...structured,
      bankHint,
      date: structured.date ?? toISODate(new Date(observedAt)),
      smsTs: observedAt,
      channel: 'inbox',
      market: attribution.market,
    };
    return {
      kind: 'parsed',
      market: attribution.market,
      row,
      milestone: 'financial',
    };
  } catch {
    return { kind: 'invalid', milestone: 'none' };
  }
}
