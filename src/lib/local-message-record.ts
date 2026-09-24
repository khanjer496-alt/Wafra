import {
  identifySourceFreeReviewAlert,
  inspectSourceFreeRefusedAlert,
  parsedFinancialCandidateReview,
  shouldReviewParsedIncome,
} from '@/lib/auto-import';
import {
  appleMessageReviewIdentity,
  isUniversalReviewAlert,
  type ReviewEntry,
} from '@/lib/alert-review-tray';
import { toISODate } from '@/lib/format';
import {
  iosBankSenderIdentity,
  type IosBankSenderRegistry,
} from '@/lib/ios-bank-senders';
import type { LaunchAlertSession } from '@/lib/launch-alert-parser';
import {
  MARKETS,
  bankFromSender,
  soleBankNamedInText,
  withMarketPackForParsing,
  bankIdentityForName,
  detectLaunchMarketFromAlert,
} from '@/lib/markets';
import type { DeclinedSms, ScannedSms } from '@/lib/import-plan';
import type { ParsedSms } from '@/lib/sms-parser';
import { buildTransferEvidence } from '@/lib/transfer-evidence';
import { parseIosApplePayRecord } from '@/lib/ios-apple-pay-record';

export const LOCAL_MESSAGE_RECORD_VERSION = 1 as const;
export const MAX_LOCAL_MESSAGE_TEXT_BYTES = 16 * 1024;
export const MAX_LOCAL_MESSAGE_SENDER_CHARACTERS = 80;
export const LOCAL_MESSAGE_FUTURE_SKEW_MS = 5 * 60_000;
/** Shortcut input cannot attest which app actually delivered a notification. */
export const LOCAL_NOTIFICATION_SENDER = 'Wafra Notification';
export const LOCAL_APPLE_PAY_SENDER = 'Wafra Apple Pay';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_EVENT_ID_RE = /^[0-9a-f]{64}$/;
const UTC_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UNSAFE_SENDER_RE = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/u;
const ENVELOPE_KEYS = ['id', 'observedAt', 'sender', 'source', 'text', 'v'] as const;

const validLocalMessageId = (value: unknown): value is string =>
  typeof value === 'string' && (UUID_RE.test(value) || SHA256_EVENT_ID_RE.test(value));

interface LocalMessageEnvelope {
  v: typeof LOCAL_MESSAGE_RECORD_VERSION;
  id: string;
  text: string;
  sender: string;
  observedAt: string;
  source: 'message' | 'notification' | 'apple-pay';
}

export interface LocalMessageRecordPreflight {
  id: string;
  observedAt: number | null;
  attribution: IosBankSenderAttribution | null;
  market: 'AE' | 'SA' | null;
  valid: boolean;
  /** Kept even for malformed Wallet payloads so they are never invalid-ACKed. */
  source?: 'apple-pay';
}

export interface IosBankSenderAttribution {
  market: 'AE' | 'SA';
  bankId: string;
  bankHint: string;
}

export type LocalMessageParseOutcome =
  | { kind: 'parsed'; market: 'AE' | 'SA'; row: ScannedSms; milestone: 'financial' }
  | { kind: 'declined'; market: 'AE' | 'SA'; row: DeclinedSms; milestone: 'decline-candidate' }
  | { kind: 'review'; market: 'AE' | 'SA' | null; item: ReviewEntry; milestone: 'review-candidate' | 'none' }
  | { kind: 'ignored'; market: 'AE' | 'SA' | null; milestone: 'none' }
  | { kind: 'held'; market: null; milestone: 'none' }
  | { kind: 'invalid'; milestone: 'none' };

export type LocalApplePayParseOutcome =
  | { kind: 'review'; market: null; item: ReviewEntry; milestone: 'none' }
  | { kind: 'held'; market: null; milestone: 'none' };

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
    !validLocalMessageId(value.id) ||
    typeof value.text !== 'string' ||
    typeof value.sender !== 'string' ||
    (value.source !== 'message' && value.source !== 'notification' && value.source !== 'apple-pay') ||
    (value.source === 'notification' &&
      (!UUID_RE.test(value.id) || value.sender !== LOCAL_NOTIFICATION_SENDER)) ||
    (value.source === 'apple-pay' &&
      (!UUID_RE.test(value.id) || value.sender !== LOCAL_APPLE_PAY_SENDER))) {
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
  if (!validLocalMessageId(object.id)) return null;
  const attribution = object.source === 'message' && typeof object.sender === 'string'
    ? attributeIosBankSender(object.sender)
    : null;
  const decoded = decodeLocalMessageEnvelope(serialized, nowMs);
  return {
    id: object.id,
    observedAt: decoded?.observedAt ?? null,
    attribution,
    market: decoded && decoded.envelope.source !== 'apple-pay'
      ? attribution?.market ?? detectLaunchMarketFromAlert(
          decoded.envelope.text,
          decoded.envelope.sender,
        )
      : null,
    valid: decoded !== null,
    ...(object.source === 'apple-pay' ? { source: 'apple-pay' as const } : {}),
  };
}

/** Wallet observations are structured facts, never SMS text or bank attribution. */
export function parseLocalApplePayRecord(serialized: string, now: Date): LocalApplePayParseOutcome {
  const held: LocalApplePayParseOutcome = { kind: 'held', market: null, milestone: 'none' };
  if (!Number.isFinite(now.getTime())) return held;
  const decoded = decodeLocalMessageEnvelope(serialized, now.getTime());
  if (!decoded || decoded.envelope.source !== 'apple-pay') return held;
  const result = parseIosApplePayRecord(decoded.envelope.text, decoded.envelope.id, decoded.observedAt);
  return result.kind === 'review'
    ? { kind: 'review', market: null, item: result.item, milestone: 'none' }
    : held;
}

function localReviewIdentity(id: string): { id: string; sourceKey: string } {
  const appleMessage = appleMessageReviewIdentity(id);
  if (appleMessage) return appleMessage;
  const opaque = id.replace(/-/g, '').toLocaleLowerCase('en-US');
  return {
    id: `local_review_id_${opaque}`,
    sourceKey: `local_review_source_${opaque}`,
  };
}

/**
 * A parsed row whose own currency this ledger cannot hold. Money-moving rows
 * (transactions and card payments) become a durable, source-free Universal
 * Review under the record's own review identity: Review shows the foreign
 * amount and promotion refuses it as a currency mismatch, so nothing posts and
 * nothing is lost silently. Informational kinds (statement, bill reminder)
 * move no money and return null for the caller to acknowledge as ignored.
 */
export function currencyConflictReview(
  outcome: Extract<LocalMessageParseOutcome, { kind: 'parsed' }>,
  recordId: string,
): Extract<LocalMessageParseOutcome, { kind: 'review' }> | null {
  const { row } = outcome;
  if (row.kind !== 'transaction' && row.kind !== 'cardPayment') return null;
  const observedAt = row.smsTs;
  if (observedAt === undefined || !Number.isSafeInteger(observedAt)) return null;
  const candidate = parsedFinancialCandidateReview({ ...row, kind: 'transaction' }, observedAt);
  if (!candidate || !('kind' in candidate) || candidate.kind !== 'universal') return null;
  const item = identifySourceFreeReviewAlert(
    { ...candidate, channel: row.channel === 'push' ? 'push' : 'inbox' },
    localReviewIdentity(recordId),
  );
  return item ? { kind: 'review', market: outcome.market, item, milestone: 'none' } : null;
}

function sanitizedRefusal(
  envelope: LocalMessageEnvelope,
  observedAt: number,
  market: 'AE' | 'SA' | null,
  session: LaunchAlertSession,
  inspection: ReturnType<LaunchAlertSession['inspect']>,
  existingDecision?: ReturnType<typeof inspectSourceFreeRefusedAlert>,
): Exclude<LocalMessageParseOutcome, { kind: 'parsed' } | { kind: 'invalid' }> {
  const channel = envelope.source === 'notification' ? 'push' : 'inbox';
  const decision = existingDecision ?? inspectSourceFreeRefusedAlert({
    source: envelope.text,
    sender: envelope.sender,
    observedAt,
    channel,
    session,
    existingInspection: inspection,
  });
  if (decision.kind === 'declined') {
    if (market === null) return { kind: 'ignored', market, milestone: 'none' };
    return {
      kind: 'declined',
      market,
      row: {
        smsTs: observedAt,
        channel,
        // Message timestamps can collide at whole-second precision. Preserve
        // exact Apple identity so a decline cannot sweep an unrelated posting.
        // A notification's arrival time is not the identity of any Message.
        // Its UUID confines decline reconciliation to this exact queue record.
        ...(envelope.source === 'notification' || SHA256_EVENT_ID_RE.test(envelope.id)
          ? { sourceEventId: envelope.id } : {}),
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
    if (item) return {
      kind: 'review', market, item,
      milestone: !isUniversalReviewAlert(item) && item.market === market
        ? 'review-candidate' : 'none',
    };
  }
  return { kind: 'ignored', market, milestone: 'none' };
}

/** Parse one native queue record without returning Message text or sender. */
export function parseLocalMessageRecord(
  serialized: string,
  now: Date,
  expectedMarket: 'AE' | 'SA' | null,
  session: LaunchAlertSession,
): LocalMessageParseOutcome {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return { kind: 'invalid', milestone: 'none' };
  const decoded = decodeLocalMessageEnvelope(serialized, nowMs);
  if (!decoded) return { kind: 'invalid', milestone: 'none' };
  const { envelope, observedAt } = decoded;
  if (envelope.source === 'apple-pay') return parseLocalApplePayRecord(serialized, now);
  const isNotification = envelope.source === 'notification';
  const attribution = isNotification ? null : attributeIosBankSender(envelope.sender);
  const routedMarket = attribution?.market ??
    detectLaunchMarketFromAlert(envelope.text, envelope.sender);
  if (routedMarket !== expectedMarket) {
    return { kind: 'invalid', milestone: 'none' };
  }

  try {
    const inspection = session.inspect(envelope.text, envelope.sender);
    // Apply the same push promotion/non-posting policy as Android before a
    // permissive transaction grammar can mistake an offer for actual money.
    // Reuse this source-free decision on refusal; source text is never retained.
    const notificationDecision = isNotification ? inspectSourceFreeRefusedAlert({
      source: envelope.text,
      sender: envelope.sender,
      observedAt,
      channel: 'push',
      session,
      existingInspection: inspection,
    }) : undefined;
    if (notificationDecision?.kind === 'declined' && notificationDecision.reason === 'security-challenge') {
      return { kind: 'ignored', market: expectedMarket, milestone: 'none' };
    }
    if (notificationDecision?.kind === 'declined' ||
      (notificationDecision?.kind === 'ignored' && notificationDecision.reason !== 'unrecognized')) {
      return sanitizedRefusal(envelope, observedAt, expectedMarket, session, inspection, notificationDecision);
    }
    if (expectedMarket === null) {
      return sanitizedRefusal(envelope, observedAt, null, session, inspection, notificationDecision);
    }
    const parsed = session.parse(
      envelope.text,
      envelope.sender,
      inspection,
      expectedMarket,
      observedAt,
    );
    if (!parsed) {
      return sanitizedRefusal(envelope, observedAt, expectedMarket, session, inspection, notificationDecision);
    }
    // Statements and card payments have separate accounting mutations without
    // a transaction observation receipt. Keep notification delivery on the
    // durable source-free Review path until those kinds have end-to-end replay
    // identity; authoritative Message capture retains its existing behavior.
    if (isNotification && parsed.kind !== 'transaction') {
      return sanitizedRefusal(envelope, observedAt, expectedMarket, session, inspection, notificationDecision);
    }
    if (shouldReviewParsedIncome(parsed) || (isNotification && parsed.type === 'income' &&
      parsed.categoryGuess === 'other' && !parsed.transferHint)) {
      const refusal = sanitizedRefusal(
        envelope,
        observedAt,
        expectedMarket,
        session,
        inspection,
        notificationDecision,
      );
      if (refusal.kind === 'review') return refusal;
    }

    const parsedWithEphemeralSender = parsed as ParsedSms & { sender?: unknown };
    const {
      raw: _raw,
      sender: _sender,
      ...structured
    } = parsedWithEphemeralSender;
    // A Shortcut sender that names no bank (a number, a contact label) leaves
    // the one bank the body names as the record's only bank identity.
    const bankHint = structured.bankHint ?? bankFromSender(envelope.sender)?.name ??
      attribution?.bankHint ??
      withMarketPackForParsing(expectedMarket, () => soleBankNamedInText(envelope.text)?.name) ??
      undefined;
    if (attribution && canonicalBankId(bankHint ?? '') !== attribution.bankId) {
      return { kind: 'invalid', milestone: 'none' };
    }
    // Notification setup does not establish an issuer. Never let the planner
    // fill an absent bank from a user's unrelated single known-bank answer.
    // The existing review policy keeps grounded facts for account selection;
    // if it cannot describe the alert safely, leave it unposted.
    if (isNotification && canonicalBankId(bankHint ?? '') === null) {
      return sanitizedRefusal(envelope, observedAt, expectedMarket, session, inspection, notificationDecision);
    }
    const row: ScannedSms = {
      ...structured,
      // Capture only masked endpoints/reference before the body is discarded.
      // Import planning downgrades this if local source routing is ambiguous.
      transferEvidence: buildTransferEvidence({ ...parsed, bankHint, sender: envelope.sender }, !isNotification),
      ...(bankHint ? { bankHint } : {}),
      // Receipt time dates a transaction, never an unstated card deadline.
      date: structured.kind === 'cardStatement' ? structured.date : structured.date ?? toISODate(new Date(observedAt)),
      smsTs: observedAt,
      channel: isNotification ? 'push' : 'inbox',
      market: expectedMarket,
      // Notification UUIDs identify queue observations, not bank events. Keep
      // them as ACK/review/decline receipts only; financial rows use existing push
      // time/merchant/instrument dedupe, including repeated OS notifications.
      // Only SHA-256(Message GUID) names a retained Apple Message. A Message
      // staged under a queue UUID (Apple withheld the GUID or its date, or the
      // automation passed plain text) is an observation like a notification:
      // without a history identity it is keyed `s{time}-{amount}` and stays
      // open to the same-event rule, so the History import copy of the same
      // Message (its GUID and real date, seconds apart) merges with it.
      ...(!isNotification && SHA256_EVENT_ID_RE.test(envelope.id) ? { sourceEventId: envelope.id } : {}),
      // The queue delivers each such Message once. Its UUID is kept only as a
      // durable "one live observation" marker so dedupe never folds a second
      // genuine identical purchase into it and binds it one-to-one to History.
      ...(!isNotification && UUID_RE.test(envelope.id) ? { messageObservationId: envelope.id } : {}),
      ...(isNotification ? { notificationObservationId: envelope.id } : {}),
    };
    return {
      kind: 'parsed',
      market: expectedMarket,
      row,
      milestone: 'financial',
    };
  } catch {
    return { kind: 'invalid', milestone: 'none' };
  }
}
