/**
 * PHONE-AI READING OF UNRECOGNISED BANK ALERTS (Review prefill only).
 *
 * The platform model that ships with the phone — Apple Foundation Models on
 * iOS 26+ with Apple Intelligence (guided generation over the closed schema
 * below), Gemini Nano through the ML Kit GenAI Prompt API on supported
 * Android phones — reads ONE alert that every parser and the person's learned
 * formats could not, and proposes the same JSON the phase-2 zero-shot harness
 * scored (scripts/parser-ai/llm/run-llm.py): posting + reason, amount as
 * written, currency as written, direction, family, merchant and date.
 *
 * That proposal is untrusted. `predictionFromPlatformReading` only LOCATES
 * the model's strings in the message (never invents an offset), and the
 * caller passes the result through the SAME deterministic gate as every other
 * model (ai-alert-extractor.ts gateAiAlert: amount grounded on one money
 * token, non-completed wording, OTP/promotion rules, AE/SA exclusion). Its
 * direction must also be backed by a direction cue in the text. The outcome
 * can only pre-fill a Review item labelled "Suggested by on-device AI"; it is
 * never posted. Inference runs on the phone; nothing here uses the network.
 */
import type { AiAlertFamily, AiAlertPrediction, AiAlertStatus, AiSpan, AiSpanLabel } from '@/lib/ai-alert-extractor';
import { alertWords } from '@/lib/ai-alert-words';
import type { OnDeviceAI, OnDeviceAIProvider, OnDeviceClosedSchema } from '@/lib/on-device-ai';

/** Longest alert text the model is shown (the harness used 1,200 characters). */
export const PLATFORM_ALERT_MAX_CHARS = 1_200;
export const PLATFORM_ALERT_TIMEOUT_MS = 8_000;

const STATUSES = ['completed', 'pending', 'declined', 'otp', 'promo', 'balance', 'statement', 'request', 'future', 'other'] as const;
const FAMILIES = ['purchase', 'refund', 'transfer', 'salary', 'fee', 'withdrawal', 'card-payment', 'bill-payment', 'none'] as const;

/** Closed output schema: the harness schema, with `posting` as a closed yes/no. */
export const PLATFORM_ALERT_SCHEMA: OnDeviceClosedSchema = Object.freeze({
  name: 'WafraBankAlert',
  fields: Object.freeze([
    { name: 'posting', description: 'yes only if ONE money movement already completed on the account or card', choices: ['yes', 'no'] },
    { name: 'status', description: 'why: completed if posting', choices: [...STATUSES] },
    { name: 'amount', description: 'the transaction amount copied exactly as written, empty if none', maxLength: 40 },
    { name: 'currency', description: 'the currency code or symbol written next to that amount, empty if none', maxLength: 16 },
    { name: 'direction', description: 'out = money left the customer, in = money came in, none if not posting', choices: ['out', 'in', 'none'] },
    { name: 'family', description: 'the kind of movement, none if not posting', choices: [...FAMILIES] },
    { name: 'merchant', description: 'merchant, payee, payer or biller name as written, empty if none', maxLength: 80 },
    { name: 'date', description: 'the transaction date exactly as written, empty if none', maxLength: 40 },
  ]),
});

/** Zero-shot instructions (the phase-2 harness system prompt). */
export const PLATFORM_ALERT_INSTRUCTIONS = [
  'You extract structured data from ONE bank SMS or app notification, in any language. Return only the requested fields.',
  '- posting: yes only if the message reports ONE money movement that has already completed on the customer\'s account/card (a purchase, refund, transfer sent or received, salary, fee, ATM withdrawal, card payment received, bill paid). no for OTP/verification codes, pending/authorisation holds, declined/failed, promotions/offers, balance or statement/due reminders, payment requests, scheduled/future.',
  '- status: why (completed if posting).',
  '- amount: the transaction amount copied EXACTLY as written in the message (digits and separators), never a balance, available limit, minimum due or fee cap. Empty if none.',
  '- currency: the currency code or symbol copied exactly as written next to that amount. Empty if none.',
  '- direction: out = money left the customer (debit), in = money came to the customer (credit), none if not posting.',
  '- family: the kind of movement, none if not posting.',
  '- merchant: the merchant, payee, payer or biller name as written, empty if none.',
  '- date: the transaction date exactly as written, empty if none.',
].join('\n');

const STATUS_MAP: Readonly<Record<string, AiAlertStatus>> = {
  completed: 'completed', pending: 'pending', declined: 'declined', otp: 'otp', promo: 'promo',
  balance: 'informational', statement: 'informational', request: 'request', future: 'future', other: 'unknown',
};

/**
 * Where `text` occurs in `body`, on token boundaries only: "50" never
 * matches inside "150.00" and "1,205" never inside "1,205.10".
 */
const findSpan = (body: string, text: string, label: AiSpanLabel, from = 0): AiSpan | null => {
  const wanted = text.trim();
  if (!wanted) return null;
  const bounded = (haystack: string, at: number): boolean => {
    const before = haystack.slice(0, at);
    const after = haystack.slice(at + wanted.length);
    const leftOpen = !/[\p{L}\p{N}]$/u.test(before) && !/[\p{N}][.,'\u066B\u066C]$/u.test(before);
    const rightOpen = !/^[\p{L}\p{N}]/u.test(after) && !/^[.,'\u066B\u066C][\p{N}]/u.test(after);
    return leftOpen && rightOpen;
  };
  const search = (haystack: string, needle: string): number => {
    for (const start of [from, 0]) {
      for (let at = haystack.indexOf(needle, start); at >= 0; at = haystack.indexOf(needle, at + 1)) {
        if (bounded(haystack, at)) return at;
      }
    }
    return -1;
  };
  let at = search(body, wanted);
  if (at < 0) at = search(body.toLowerCase(), wanted.toLowerCase());
  if (at < 0) return null;
  return { label, start: at, end: at + wanted.length, p: 1 };
};

const numberValues = (text: string): number[] => {
  const digits = text.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/[٫]/g, '.').replace(/[٬\s'’]/g, '');
  const out = new Set<number>();
  const split = digits.match(/^(.*?)([.,])(\d{1,3})$/);
  out.add(Number(digits.replace(/[.,]/g, '')));
  if (split) out.add(Number(`${split[1].replace(/[.,]/g, '')}.${split[3]}`));
  return [...out].filter(Number.isFinite);
};

/**
 * Locate the model's amount. Exact substring first; otherwise the UNIQUE
 * number word in the message with the same value (models rewrite "32,70" as
 * "32.70"). The gate re-grounds whatever this returns.
 */
const findAmount = (body: string, text: string): AiSpan | null => {
  const exact = findSpan(body, text, 'AMT');
  if (exact) return exact;
  const numeric = text.replace(/[^\d.,٠-٩٫٬]/g, '');
  if (!/\d|[٠-٩]/.test(numeric)) return null;
  const wanted = numberValues(numeric.includes('.') && numeric.includes(',') ? numeric.replace(/,/g, '') : numeric);
  const hits = alertWords(body).filter((word) => /^[\d٠-٩]/.test(word.text) &&
    numberValues(word.text).some((value) => wanted.includes(value)));
  return hits.length === 1 ? { label: 'AMT', start: hits[0].start, end: hits[0].end, p: 1 } : null;
};

/** The closed-schema reply as an engine-agnostic prediction (spans located, no probabilities). */
export function predictionFromPlatformReading(
  source: string,
  value: Readonly<Record<string, string>>,
  provider: OnDeviceAIProvider | 'harness' = 'harness',
): AiAlertPrediction {
  let status: AiAlertStatus = STATUS_MAP[value.status] ?? 'unknown';
  // "not posting" wins over a completed status; a completed "posting" with
  // another stated reason keeps that reason (not posting).
  if (value.posting !== 'yes' && status === 'completed') status = 'unknown';
  const family: AiAlertFamily = (FAMILIES as readonly string[]).includes(value.family) && value.family !== 'none'
    ? value.family as AiAlertFamily : 'non-posting';
  const direction = value.direction === 'out' ? 'debit' : value.direction === 'in' ? 'credit' : 'none';
  const spans: AiSpan[] = [];
  const amount = findAmount(source, value.amount ?? '');
  if (amount) spans.push(amount);
  const currency = findSpan(source, value.currency ?? '', 'CUR', amount ? Math.max(0, amount.start - 8) : 0);
  if (currency) spans.push(currency);
  const merchant = findSpan(source, value.merchant ?? '', 'MER');
  if (merchant) spans.push(merchant);
  const date = findSpan(source, value.date ?? '', 'DATE');
  if (date) spans.push(date);
  return {
    engine: 'llm',
    modelVersion: `platform:${provider}`,
    status,
    statusP: 1,
    family,
    familyP: 1,
    direction,
    directionP: 1,
    spans,
  };
}

/**
 * Ask the phone's model to read one alert. Resolves null when the model is
 * unavailable, busy, times out, refuses, or answers outside the schema.
 * Never throws. The on-device-ai layer serialises requests (one at a time).
 */
export async function readAlertWithPlatformModel(
  source: string,
  ai: OnDeviceAI,
  options: { timeoutMs?: number; cancelled?: () => boolean } = {},
): Promise<AiAlertPrediction | null> {
  try {
    if (typeof source !== 'string' || !source.trim() || source.length > PLATFORM_ALERT_MAX_CHARS) return null;
    const result = await ai.respond({
      task: 'alert-read',
      instructions: PLATFORM_ALERT_INSTRUCTIONS,
      prompt: `Message:\n${source}`,
      schema: PLATFORM_ALERT_SCHEMA,
      // Apple publishes its model's languages; Gemini Nano is used for text
      // written in Latin script only (on-device-ai.ts supportsOnDeviceLanguage).
      language: /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/u.test(source) ? 'ar' : 'en',
      maxTokens: 200,
      timeoutMs: options.timeoutMs ?? PLATFORM_ALERT_TIMEOUT_MS,
      cancelled: options.cancelled,
    });
    if (result.kind !== 'ok') return null;
    return predictionFromPlatformReading(source, result.value, result.provider);
  } catch {
    return null;
  }
}
