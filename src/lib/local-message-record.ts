import {
  hasCarrierDuplicateIdentity,
  identifySourceFreeReviewAlert,
  inspectSourceFreeRefusedAlert,
  isUaeAdvertisingSender,
  parsedFinancialCandidateReview,
  shouldReviewParsedIncome,
  type CarrierCopyFacts,
} from '@/lib/auto-import';
import { statedBalanceInText } from '@/lib/dedupe';
import {
  appleMessageReviewIdentity,
  isUniversalReviewAlert,
  prepareUniversalReviewAlert,
  type UniversalReviewAdmissionInput,
  type ReviewEntry,
} from '@/lib/alert-review-tray';
import { toISODate } from '@/lib/format';
import { hasUniversalInstitutionSender } from '@/lib/alert-institution-grammars';
import {
  iosBankSenderIdentity,
  type IosBankSenderRegistry,
} from '@/lib/ios-bank-senders';
import { hasPersonalMessagePrefix, type LaunchAlertSession } from '@/lib/launch-alert-parser';
import {
  MARKETS,
  bankFromSender,
  soleBankNamedInText,
  withMarketPackForParsing,
  bankIdentityForName,
  detectLaunchMarketFromAlert,
  detectLaunchMarketFromSender,
} from '@/lib/markets';
import type { DeclinedSms, ScannedSms } from '@/lib/import-plan';
import type { ParsedSms } from '@/lib/sms-parser';
import { buildTransferEvidence } from '@/lib/transfer-evidence';
import { parseIosApplePayRecord } from '@/lib/ios-apple-pay-record';
import { parsedObligationReviewEvent } from '@/lib/parsed-review-event';
import type { FxQuote, MinorExponent } from '@/lib/fx';
import { convertWithReferenceQuote, quoteFitsDay } from '@/lib/fx-rates';
import type { createAiAlertReviewSession } from '@/lib/ai-alert-reader';
import { mergeAiReviewEvent } from '@/lib/generic-review-entry';
import type { createPrivateAlertFormatSession } from '@/lib/private-alert-format-runtime';
import { canEnrichPrivateFormatReview, privateAlertFormatReviewEvent } from '@/lib/private-alert-format-review';
import { activeCountryDateOrder, getActiveCountry } from '@/lib/country';

export const LOCAL_MESSAGE_RECORD_VERSION = 1 as const;
export const MAX_LOCAL_MESSAGE_TEXT_BYTES = 16 * 1024;
export const MAX_LOCAL_MESSAGE_SENDER_CHARACTERS = 80;
export const LOCAL_MESSAGE_FUTURE_SKEW_MS = 5 * 60_000;
/** Shortcut input cannot attest which app actually delivered a notification. */
export const LOCAL_NOTIFICATION_SENDER = 'Wafra Notification';
export const LOCAL_APPLE_PAY_SENDER = 'Wafra Apple Pay';
/**
 * What the native store records when the Message automation exposes no sender
 * (WafraLiveCaptureStore.automationSender, and the plain-text fallback).
 */
export const LOCAL_AUTOMATION_SENDER = 'Wafra Automation';
/**
 * Sender values that name nobody: the store's placeholder and the words an
 * automation renders for a missing contact. The same vocabulary the native
 * preview treats as no sender (ios-background-alert-parser.ts).
 */
const ABSENT_SENDER_RE = /^(?:wafra(?:\s+(?:automation|shortcut))?|shortcut|automation|unknown|none|null)$/i;

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
  /** `market` is null only for an unproven-format row (`row.bestEffort`). */
  | { kind: 'parsed'; market: 'AE' | 'SA' | null; row: ScannedSms; milestone: 'financial' }
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
 * The launch market that may route this record's parser — Android's rule.
 *
 * Android routes the UAE/Saudi grammar from the SMS sender alone
 * (auto-import.ts, detectLaunchMarketFromSender); a sender that names no
 * launch bank is never parsed as one, whatever currency its text quotes. The
 * body used to route every iPhone record too, so a telco bill, a delivery-app
 * receipt, a parking short code or a shop quoting "AED" reached the bank
 * grammar and was auto-posted where Android sent it to Review or ignored it.
 *
 * The body's currency routes only a record with NO sender to read: the
 * notification lane (no attested sender) and a Message the automation staged
 * without one (LOCAL_AUTOMATION_SENDER, blank, or another ABSENT_SENDER_RE
 * placeholder). A phone number, short code,
 * e-mail address or brand name is a sender, and it names no bank.
 */
function localRecordMarket(
  envelope: LocalMessageEnvelope,
  attribution: IosBankSenderAttribution | null,
): 'AE' | 'SA' | null {
  if (attribution) return attribution.market;
  const sender = envelope.sender.trim();
  const senderAbsent = envelope.source === 'notification' || sender === '' ||
    ABSENT_SENDER_RE.test(sender);
  return senderAbsent
    ? detectLaunchMarketFromAlert(envelope.text, envelope.sender)
    : detectLaunchMarketFromSender(envelope.sender);
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
      ? localRecordMarket(decoded.envelope, attribution)
      : null,
    valid: decoded !== null,
    ...(object.source === 'apple-pay' ? { source: 'apple-pay' as const } : {}),
  };
}

/**
 * An opaque in-memory key for one string: four independent 32-bit
 * multiplicative mixes of its UTF-16 units (128 bits) plus its length. It lets the drain recognise a byte-identical
 * copy after the Message text itself has been cleared. Never persisted.
 */
function opaqueTextKey(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  let h3 = 0x2545f491;
  let h4 = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
    h3 = Math.imul(h3 ^ code, 2246822507);
    h4 = Math.imul(h4 ^ code, 3266489909);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  h3 = Math.imul(h3 ^ (h3 >>> 16), 2654435761) ^ Math.imul(h4 ^ (h4 >>> 13), 1597334677);
  h4 = Math.imul(h4 ^ (h4 >>> 16), 2654435761) ^ Math.imul(h3 ^ (h3 >>> 13), 1597334677);
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${value.length.toString(16)}:${hex(h1)}${hex(h2)}${hex(h3)}${hex(h4)}`;
}

/**
 * The source-free facts Android's carrier re-delivery fold decides on
 * (auto-import.ts carrierRedeliveryIndexesOf), read from one queued Message
 * before its text is cleared. Only a valid `message` record has them: the
 * notification lane has its own replay guard, and Wallet rows are not SMS.
 */
export function localMessageCarrierFacts(
  serialized: string,
  now: Date,
): (Omit<CarrierCopyFacts, 'balance'> & { balance: number | undefined }) | null {
  const decoded = decodeLocalMessageEnvelope(serialized, now.getTime());
  if (!decoded || decoded.envelope.source !== 'message') return null;
  const { envelope, observedAt } = decoded;
  return {
    sender: opaqueTextKey(envelope.sender),
    copyKey: hasCarrierDuplicateIdentity(envelope.text)
      ? opaqueTextKey(`${envelope.sender}\u0000${envelope.text}`) : null,
    date: observedAt,
    balance: statedBalanceInText(envelope.text),
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

/**
 * Review identity for a message whose canonical source key is `smsKey`: the
 * same mapping as import-plan.ts walletNearMatchIdentity, so both paths give a
 * message one identity and promotion writes back exactly that smsKey.
 */
function messageReviewIdentity(smsKey: string): { id: string; sourceKey: string } | null {
  const apple = smsKey.match(/^h([a-f0-9]{64})$/);
  if (apple) return appleMessageReviewIdentity(apple[1]);
  const android = smsKey.match(/^h(a(?:0|[1-9]\d{0,39})t(?:0|[1-9]\d{0,15}))$/);
  if (android) {
    return { id: `android_wallet_review_id_${android[1]}`, sourceKey: `android_message_review_source_${android[1]}` };
  }
  if (/^s\d{10,16}-[1-9]\d{0,15}$/.test(smsKey)) return { id: `wallet_review_id_${smsKey}`, sourceKey: smsKey };
  return null;
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

/** Preserve source facts; allow a source-owned profile exclusion to correct its own field. */
export function prepareAiEnrichedLocalReview(
  input: UniversalReviewAdmissionInput,
  existing?: ReviewEntry,
): ReviewEntry | null {
  if (input.event.decision !== 'review') return null;
  if (existing && (!isUniversalReviewAlert(existing) || (existing.event.family !== 'unknown' &&
    !(input.event.issues.includes('learned-format') && canEnrichPrivateFormatReview(existing.event))))) return null;
  const prior = existing && isUniversalReviewAlert(existing) ? existing.event : null;
  const item = prepareUniversalReviewAlert({
    ...input,
    event: prior ? mergeAiReviewEvent(prior, input.event) : input.event,
  });
  // An existing row owns its identity, delivery channel and expiry window.
  return item && existing ? { ...existing, event: item.event } as ReviewEntry : item;
}

/**
 * Enrich a refused record before its caller clears every ephemeral source
 * copy. The synchronous parser and all its financial outcomes stay intact.
 */
export async function parseLocalMessageRecordWithAi(
  serialized: string,
  now: Date,
  expectedMarket: 'AE' | 'SA' | null,
  session: LaunchAlertSession,
  ai: Pick<ReturnType<typeof createAiAlertReviewSession>, 'read'>,
  cancelled?: () => boolean,
  original?: LocalMessageParseOutcome,
  privateEnrichment = false,
): Promise<LocalMessageParseOutcome> {
  const baseline = original ?? parseLocalMessageRecord(serialized, now, expectedMarket, session);
  if (expectedMarket !== null || cancelled?.() ||
    (baseline.kind !== 'ignored' && !(baseline.kind === 'review' &&
      isUniversalReviewAlert(baseline.item) && (baseline.item.event.family === 'unknown' ||
        (privateEnrichment && canEnrichPrivateFormatReview(baseline.item.event))) &&
      !baseline.item.event.issues.includes('learned-format')))) return baseline;
  const decoded = decodeLocalMessageEnvelope(serialized, now.getTime());
  if (!decoded || decoded.envelope.source === 'apple-pay') return baseline;
  const { envelope, observedAt } = decoded;
  // A deliberate personal-message refusal must not become a model or learned
  // format proposal merely because its currency routes outside the Gulf.
  if (hasPersonalMessagePrefix(envelope.text)) return baseline;
  try {
    if (baseline.kind === 'ignored') {
      const refusal = inspectSourceFreeRefusedAlert({ source: envelope.text, sender: envelope.sender,
        observedAt, channel: envelope.source === 'notification' ? 'push' : 'inbox', session });
      // A declined, security, future, promotional or other deliberate refusal
      // must never be resurrected by a model proposal.
      if (refusal.kind !== 'ignored' || refusal.reason !== 'unrecognized') return baseline;
    }
    const event = await ai.read(envelope.text, envelope.sender, observedAt);
    if (!event || cancelled?.()) return baseline;
    const item = prepareAiEnrichedLocalReview({
      ...localReviewIdentity(envelope.id), observedAt,
      channel: envelope.source === 'notification' ? 'push' : 'inbox', event,
    }, baseline.kind === 'review' ? baseline.item : undefined);
    return item ? { kind: 'review', market: null, item, milestone: 'none' } : baseline;
  } catch {
    return baseline;
  }
}

/** A ready, keyed local format can advise the same source-free Review lane. */
export async function parseLocalMessageRecordWithPrivateFormat(
  serialized: string,
  now: Date,
  expectedMarket: 'AE' | 'SA' | null,
  session: LaunchAlertSession,
  formats: Pick<ReturnType<typeof createPrivateAlertFormatSession>, 'read'>,
  cancelled?: () => boolean,
  original?: LocalMessageParseOutcome,
): Promise<LocalMessageParseOutcome> {
  const context = { country: getActiveCountry(), dateOrder: activeCountryDateOrder(), routedMarket: expectedMarket };
  return parseLocalMessageRecordWithAi(serialized, now, expectedMarket, session, {
    async read(source, sender, observedAt) {
      const match = await formats.read(source, sender, observedAt, context);
      return !match || cancelled?.() ? null : privateAlertFormatReviewEvent(source, sender, observedAt, match, context);
    },
  }, cancelled, original, true);
}

/** The pair and day a currency-conflict purchase needs converted, or null. */
export function currencyConflictFxNeed(
  outcome: Extract<LocalMessageParseOutcome, { kind: 'parsed' }>,
  ledgerCurrency: string,
): { base: string; quote: string; date: string } | null {
  const { row } = outcome;
  if (row.kind !== 'transaction' || row.currency === ledgerCurrency) return null;
  // A local figure the parser derived from its OFFLINE table ("USD 20.00" with
  // no AED stated) is an estimate, not the debit. Converting it again would
  // post an invented rate under a reference label; it stays in Review.
  if (row.fxSource === 'fallback') return null;
  const date = row.date ?? (row.smsTs !== undefined && Number.isFinite(row.smsTs)
    ? toISODate(new Date(row.smsTs)) : null);
  return date ? { base: row.currency, quote: ledgerCurrency, date } : null;
}

/**
 * CONVERT, DON'T REFUSE: a launch-market purchase on a ledger kept in another
 * currency ("AED 73.45 at CARREFOUR" on a USD ledger).
 *
 * The amount that left the account is the one the alert states in its own
 * currency, so that is the original recorded on the row, converted with the
 * dated provider quote the caller obtained (`fxSource: 'reference'`, rate and
 * effective date kept). The parser's own foreign annotation (a USD figure the
 * AED card charged for) is replaced, because the AED debit is what moved.
 * A row whose AED figure came from the parser's offline table is never
 * converted: that figure is an estimate, not the debit.
 * Account snapshots stated in the alert's currency describe a different money
 * and are dropped rather than relabelled. Only ordinary transactions convert;
 * card payments, statements and bills keep their existing handling. Without a
 * valid quote this returns null and the caller keeps the Review item.
 */
export function convertCurrencyConflictRow(
  outcome: Extract<LocalMessageParseOutcome, { kind: 'parsed' }>,
  ledger: { currency: string; exponent: MinorExponent },
  quote: FxQuote | null | undefined,
): Extract<LocalMessageParseOutcome, { kind: 'parsed' }> | null {
  const need = currencyConflictFxNeed(outcome, ledger.currency);
  if (!need || !quoteFitsDay(quote, need.date)) return null;
  const { row } = outcome;
  // The Gulf parser's local figures are two-decimal fils by construction.
  const conversion = convertWithReferenceQuote(
    { currency: row.currency, minorUnits: row.amountFils, exponent: 2 },
    ledger.currency,
    ledger.exponent,
    quote,
  );
  if (!conversion) return null;
  const {
    originalAmountMinor: _legacy,
    originalCurrency: _currency,
    originalMinorUnits: _minor,
    originalExponent: _exponent,
    fxRate: _rate,
    fxRateDate: _rateDate,
    fxSource: _source,
    ...rest
  } = row;
  return {
    ...outcome,
    row: {
      ...rest,
      ...conversion.fields,
      amountFils: conversion.amountFils,
      currency: ledger.currency,
      snapshotFils: null,
      snapshotKind: null,
    },
  };
}

/**
 * A parsed row whose own currency this ledger cannot hold. Money-moving rows
 * (transactions and card payments) become a durable, source-free Universal
 * Review under the record's own review identity. Purchases require a dated
 * conversion at confirmation; card payments retain their settlement family
 * and cannot become ordinary spending. Informational kinds (statement, bill reminder)
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
  const candidate = parsedFinancialCandidateReview(row, observedAt);
  if (!candidate || !('kind' in candidate) || candidate.kind !== 'universal') return null;
  const item = identifySourceFreeReviewAlert(
    { ...candidate, channel: row.channel === 'push' ? 'push' : 'inbox' },
    localReviewIdentity(recordId),
  );
  return item ? { kind: 'review', market: outcome.market, item, milestone: 'none' } : null;
}

/**
 * A bank alert that would post a second row for an Apple Pay purchase already
 * in the ledger becomes a Review item flagged as a possible Apple Pay
 * duplicate, bound to that Wallet row ("Already recorded" / "Add as a
 * separate purchase"). Source-free: built from the parsed row only.
 *
 * Its identity is the message's own source key (`smsKey`, as the planner
 * keys the row it would have posted), mapped exactly as the planner maps its
 * same-account possible duplicates. "Already recorded" can then bind the
 * message to the Wallet row, and a later re-read of the same message (History
 * import, rescan) finds it by identity. Only a key with no review mapping
 * falls back to the queue record's own identity.
 */
export function walletRepeatReview(
  outcome: Extract<LocalMessageParseOutcome, { kind: 'parsed' }>,
  recordId: string,
  walletTransactionId: string,
  smsKey?: string,
): Extract<LocalMessageParseOutcome, { kind: 'review' }> | null {
  const { row } = outcome;
  if (row.kind !== 'transaction' || row.type !== 'expense') return null;
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(walletTransactionId)) return null;
  const observedAt = row.smsTs;
  if (observedAt === undefined || !Number.isSafeInteger(observedAt)) return null;
  const candidate = parsedFinancialCandidateReview(row, observedAt);
  if (!candidate || !('kind' in candidate) || candidate.kind !== 'universal') return null;
  const item = identifySourceFreeReviewAlert(
    { ...candidate, channel: row.channel === 'push' ? 'push' : row.captureSource === 'shortcut' ? 'shortcut' : 'inbox' },
    (smsKey ? messageReviewIdentity(smsKey) : null) ?? localReviewIdentity(recordId),
  );
  if (!item || !isUniversalReviewAlert(item)) return null;
  return {
    kind: 'review', market: outcome.market, milestone: 'none',
    item: { ...item, attentionReason: 'possible-apple-pay-duplicate', walletTransactionId },
  };
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

/**
 * "Auto-add alerts from unverified bank formats" on iPhone: the same path
 * Android's SMS scan takes for a sender that names no UAE/Saudi bank
 * (LaunchAlertSession.parseUnproven, whose decideBestEffortAutoPost holds the
 * setting, the scam/OTP/decline/future/promotion gates, the own-tail rules and
 * the ledger-currency rule). The session carries the setting; off, this is
 * always null and the record goes to Review as before. A record staged
 * without a sender is read with a BLANK sender, as Android's policy reads one,
 * never under the placeholder's name. Only an ordinary transaction posts: an
 * unverified card settlement has no provider identity to replay safely, so it
 * waits in Review (as Android's delivery and push lanes hold it), and income
 * the launch policy reviews is reviewed here too.
 */
const IPHONE_SHORT_CODE_SENDER = /^\d{3,6}$/;
/** A forwarded message is someone else's alert, never the reader's own. */
const FORWARDED_BODY = /^\s*(?:fwd?|fw)\s*:|-{2,}\s*forwarded\s+message|\bbegin\s+forwarded\s+message\b/i;
/** The lure shape: "Not you? Call 1888…", "call +1 888 555 0100". */
const CALL_A_NUMBER_LURE = /\bnot\s+you\b|\b(?:call|dial|contact)\b[^.\n]{0,30}?\+?\d[\d\s().-]{6,}\d/i;
function unprovenMessageRow(
  envelope: LocalMessageEnvelope,
  observedAt: number,
  session: LaunchAlertSession,
  inspection: ReturnType<LaunchAlertSession['inspect']>,
): Extract<LocalMessageParseOutcome, { kind: 'parsed' }> | null {
  const trimmed = envelope.sender.trim();
  const sender = trimmed === '' || ABSENT_SENDER_RE.test(trimmed) ? '' : envelope.sender;
  // The iPhone Messages automation runs for EVERY text — iMessages, people
  // saved as contacts ("Mom", "John Smith"), phone numbers, e-mail handles —
  // which Android's SMS scan never hands this policy. A present sender must
  // be a bank-style sender ID: a known institution header or a carrier short
  // code. A forwarded body or a call-this-number lure never auto-adds, from
  // anyone. All of these wait in Review instead.
  if (sender !== '' && !hasUniversalInstitutionSender(trimmed) && !IPHONE_SHORT_CODE_SENDER.test(trimmed)) return null;
  if (FORWARDED_BODY.test(envelope.text) || CALL_A_NUMBER_LURE.test(envelope.text)) return null;
  const parsed = session.parseUnproven(envelope.text, sender,
    sender === envelope.sender ? inspection : session.inspect(envelope.text, sender), observedAt);
  if (!parsed || !parsed.bestEffort || parsed.kind !== 'transaction' || shouldReviewParsedIncome(parsed)) return null;
  const { raw: _raw, sender: _sender, ...structured } = parsed as ParsedSms & { sender?: unknown };
  return {
    kind: 'parsed',
    market: null,
    row: {
      ...structured,
      transferEvidence: buildTransferEvidence({ ...parsed, sender }, true),
      date: structured.date ?? toISODate(new Date(observedAt)),
      smsTs: observedAt,
      channel: 'inbox',
      ...(SHA256_EVENT_ID_RE.test(envelope.id) ? { sourceEventId: envelope.id } : {}),
      ...(UUID_RE.test(envelope.id) ? { messageObservationId: envelope.id } : {}),
    },
    milestone: 'financial',
  };
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
  const routedMarket = localRecordMarket(envelope, attribution);
  if (routedMarket !== expectedMarket) {
    return { kind: 'invalid', milestone: 'none' };
  }
  // A UAE advertising sender ("AD-ADCB") is never a movement and never a
  // Review card, on either platform (auto-import.ts isUaeAdvertisingSender).
  if (!isNotification && isUaeAdvertisingSender(envelope.sender)) {
    return { kind: 'ignored', market: expectedMarket, milestone: 'none' };
  }

  try {
    // This consumes every currency while refusing only explicit personal chat.
    // Do not gate unknown bank formats on a generic-context vocabulary: real
    // compact field lists can lack those words and still carry sound evidence.
    if (hasPersonalMessagePrefix(envelope.text)) {
      return { kind: 'ignored', market: expectedMarket, milestone: 'none' };
    }
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
      const unproven = isNotification ? null : unprovenMessageRow(envelope, observedAt, session, inspection);
      return unproven ?? sanitizedRefusal(envelope, observedAt, null, session, inspection, notificationDecision);
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
      // Successful parser facts outrank an independent generic extractor's
      // miss. Preserve the statement/settlement family without authorizing a
      // card mutation or reinterpreting its total as a transaction amount.
      const event = parsedObligationReviewEvent(parsed);
      const item = event ? prepareUniversalReviewAlert({
        ...localReviewIdentity(envelope.id), observedAt, channel: 'push', event,
      }) : null;
      if (item) return { kind: 'review', market: expectedMarket, item, milestone: 'none' };
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
    // A record staged without a sender (the automation placeholder, the
    // notification lane) leaves the one bank the body names as its only bank
    // identity. A real sender reaches here only when it names a launch bank.
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
