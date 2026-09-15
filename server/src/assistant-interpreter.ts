/**
 * Language-only Workers AI boundary for Ask Wafra.
 *
 * The phone redacts known accounts, banks, card tails, merchants, bills and
 * long reference numbers before this module sees the sentence. This module
 * does not receive a ledger, raw SMS, amounts, balances, device id or token.
 * Its one job is to rewrite conversational language into short canonical
 * English that the deterministic on-device planner can parse afterwards.
 */

// Cloudflare's JSON Mode currently supports this model. Keep this on a model
// explicitly listed by Cloudflare rather than relying on prompt-only JSON from
// a cheaper model: malformed prose is worse than a clean refusal here because
// this output feeds a deterministic finance parser.
export const ASSISTANT_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const MAX_ASSISTANT_LANGUAGE_BODY_BYTES = 4_096;
// Deliberately below the Workers AI free daily allocation even if every call
// uses the full output budget. This endpoint is a fallback, not a chat model.
export const ASSISTANT_AI_PER_HOUR = 50;
export const ASSISTANT_AI_PER_DAY = 200;

const PLACEHOLDER_RE = /__WAFRA_[A-Z0-9_]+__/g;
const DIGIT_RE = /\b\d+\b/g;

export interface AssistantAiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface AssistantLanguageRequest {
  v: 1;
  question: string;
  context: {
    previousTool?: string;
    previousSubject?: 'account' | 'card' | 'bill' | 'merchant' | 'category' |
      'subscription' | 'payment' | 'income' | 'spending' | 'unknown';
    language: 'en' | 'ar' | 'other';
  };
}

export interface AssistantLanguageResult {
  supported: boolean;
  confidence: 'high' | 'medium' | 'low';
  canonicalQuestion?: string;
  /** Privacy-safe diagnostic category; never contains prompt/model text. */
  reason?: 'model_refused' | 'ai_error' | 'invalid_output' | 'token_mismatch';
}

const SUBJECTS = new Set([
  'account', 'card', 'bill', 'merchant', 'category', 'subscription',
  'payment', 'income', 'spending', 'unknown',
]);

const TOOL_RE = /^[a-z][a-z-]{0,39}$/;

function ownKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function validateAssistantLanguageRequest(value: unknown): AssistantLanguageRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (!ownKeys(request, ['v', 'question', 'context']) || request.v !== 1 ||
      typeof request.question !== 'string' || !request.question.trim() || request.question.length > 1_000 ||
      request.question.includes('\n') || request.question.includes('\r')) return null;
  if (!request.context || typeof request.context !== 'object' || Array.isArray(request.context)) return null;
  const context = request.context as Record<string, unknown>;
  if (!ownKeys(context, ['previousTool', 'previousSubject', 'language'])) return null;
  if (!['en', 'ar', 'other'].includes(String(context.language))) return null;
  if (context.previousTool !== undefined &&
      (typeof context.previousTool !== 'string' || !TOOL_RE.test(context.previousTool))) return null;
  if (context.previousSubject !== undefined &&
      (typeof context.previousSubject !== 'string' || !SUBJECTS.has(context.previousSubject))) return null;

  return {
    v: 1,
    question: request.question.trim(),
    context: {
      ...(typeof context.previousTool === 'string' ? { previousTool: context.previousTool } : {}),
      ...(typeof context.previousSubject === 'string'
        ? { previousSubject: context.previousSubject as AssistantLanguageRequest['context']['previousSubject'] }
        : {}),
      language: context.language as AssistantLanguageRequest['context']['language'],
    },
  };
}

function multiset(value: string, pattern: RegExp): string[] {
  return [...value.matchAll(pattern)].map((match) => match[0]).sort();
}

function sameTokens(input: string, output: string): boolean {
  const same = (a: string[], b: string[]) =>
    a.length === b.length && a.every((value, index) => value === b[index]);
  return same(multiset(input, PLACEHOLDER_RE), multiset(output, PLACEHOLDER_RE)) &&
    same(multiset(input, DIGIT_RE), multiset(output, DIGIT_RE));
}

function parseModelJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function modelObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') return parseModelJson(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const response = (value as Record<string, unknown>).response;
  if (typeof response === 'string') return parseModelJson(response);
  return response && typeof response === 'object' && !Array.isArray(response)
    ? response as Record<string, unknown>
    : null;
}

const SYSTEM_PROMPT = `You are Wafra's language normalizer, not a financial adviser or calculator.
Rewrite the user's personal-finance QUESTION into short, simple canonical English for a deterministic parser.
Never answer the question. Never calculate anything. Never infer or invent a bank, merchant, account, card, amount, date, period, or condition.
Tokens like __WAFRA_ACCOUNT_1__ are opaque placeholders. Preserve every placeholder EXACTLY and preserve its occurrence count.
Preserve every digit sequence EXACTLY. Do not convert number words to digits or digits to words.
Pronouns may stay generic: "this card", "that one", "it". The local app resolves them from conversation context.
Translate Arabic or Arabizi only when the meaning is clear. Expand harmless chat shorthand and obvious typos.
If meaning is ambiguous, asks for unsupported advice, or cannot be preserved exactly, return supported false.
Return one JSON object with exactly supported, confidence and canonicalQuestion. When supported is false, return an empty canonicalQuestion.
Examples:
did u clear this card for september? -> {"supported":true,"confidence":"high","canonicalQuestion":"did i settle this card for september?"}
which cc i used most? -> {"supported":true,"confidence":"high","canonicalQuestion":"which card did i use most?"}
كم صرفت هذا الشهر؟ -> {"supported":true,"confidence":"high","canonicalQuestion":"how much did i spend this month?"}`;

export async function runAssistantLanguageModel(
  ai: AssistantAiBinding,
  request: AssistantLanguageRequest,
): Promise<AssistantLanguageResult> {
  let output: unknown;
  try {
    output = await ai.run(ASSISTANT_AI_MODEL, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify({ context: request.context, question: request.question }) },
      ],
      temperature: 0,
      max_tokens: 120,
      response_format: {
        // Cloudflare JSON Mode still prevents prose/fences, while our strict
        // validator below enforces the exact keys and token preservation. This
        // is intentionally less brittle than schema-constrained generation:
        // Cloudflare can reject an otherwise valid rewrite when a model cannot
        // satisfy a JSON Schema grammar on one turn.
        type: 'json_object',
      },
    });
  } catch {
    return { supported: false, confidence: 'low', reason: 'ai_error' };
  }

  const parsed = modelObject(output);
  if (!parsed || !ownKeys(parsed, ['supported', 'confidence', 'canonicalQuestion']) ||
      typeof parsed.supported !== 'boolean' ||
      !['high', 'medium', 'low'].includes(String(parsed.confidence))) {
    return { supported: false, confidence: 'low', reason: 'invalid_output' };
  }
  const confidence = parsed.confidence as AssistantLanguageResult['confidence'];
  if (parsed.supported !== true) return { supported: false, confidence, reason: 'model_refused' };
  if (typeof parsed.canonicalQuestion !== 'string') return { supported: false, confidence: 'low', reason: 'invalid_output' };
  const canonicalQuestion = parsed.canonicalQuestion.trim();
  if (!canonicalQuestion || canonicalQuestion.length > 1_000 || /[\r\n]/.test(canonicalQuestion) ||
      !sameTokens(request.question, canonicalQuestion)) {
    return { supported: false, confidence: 'low', reason: 'token_mismatch' };
  }
  return { supported: true, confidence, canonicalQuestion };
}
