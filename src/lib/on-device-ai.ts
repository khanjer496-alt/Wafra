import NativeOnDeviceAI, {
  type WafraOnDeviceAINativeAvailability,
  type WafraOnDeviceAINativeModule,
} from '../../modules/wafra-on-device-ai';

/**
 * Advisory access to the phone's own language model.
 *
 * - iOS 26+ with Apple Intelligence: Apple Foundation Models.
 * - Supported Android phones: Gemini Nano through ML Kit GenAI / AICore.
 *
 * This layer has no network route of its own: requests go to the native
 * module, and both platforms run inference on the device. Every reply is
 * untrusted: it is accepted only when it is exactly one object of the closed
 * schema the caller supplied, and callers must still pass it through their
 * own domain validators. Money, dates, direction, dedupe and imports never
 * depend on this module; when it is unavailable, times out or returns
 * anything unexpected, callers keep their deterministic result.
 */

export type OnDeviceAIStatus =
  | 'available'
  | 'unsupported-os'
  | 'device-not-eligible'
  | 'not-enabled'
  | 'model-not-ready'
  | 'unavailable';
export type OnDeviceAIProvider = 'apple-foundation-models' | 'gemini-nano';
export type OnDeviceAITask = 'ask-plan' | 'categorize';
export type OnDeviceAILanguage = 'en' | 'ar';

export interface OnDeviceAIAvailability {
  status: OnDeviceAIStatus;
  provider: OnDeviceAIProvider | null;
  /** Codes the platform reports, or null when the platform publishes no list. */
  languages: readonly string[] | null;
  canPrepare: boolean;
}

export type OnDeviceClosedField =
  | { name: string; description?: string; choices: readonly string[] }
  | { name: string; description?: string; maxLength: number };

export interface OnDeviceClosedSchema {
  name: string;
  fields: readonly OnDeviceClosedField[];
}

export interface OnDeviceAIRequest {
  task: OnDeviceAITask;
  instructions: string;
  prompt: string;
  schema: OnDeviceClosedSchema;
  language: OnDeviceAILanguage;
  maxTokens?: number;
  timeoutMs?: number;
  cancelled?: () => boolean;
}

export type OnDeviceAIFailureKind =
  | 'unavailable'
  | 'language-unsupported'
  | 'invalid-request'
  | 'timeout'
  | 'cancelled'
  | 'busy'
  | 'refused'
  | 'invalid-output'
  | 'failed';

export type OnDeviceAIResult =
  | { kind: 'ok'; value: Readonly<Record<string, string>>; provider: OnDeviceAIProvider }
  | { kind: OnDeviceAIFailureKind };

const STATUSES: readonly OnDeviceAIStatus[] = ['available', 'unsupported-os', 'device-not-eligible',
  'not-enabled', 'model-not-ready', 'unavailable'];
const PROVIDERS: readonly OnDeviceAIProvider[] = ['apple-foundation-models', 'gemini-nano'];
const TASKS: readonly OnDeviceAITask[] = ['ask-plan', 'categorize'];
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const MAX_PROMPT = 6_000;
const MAX_OUTPUT = 4_096;
export const ON_DEVICE_AI_DEFAULT_TIMEOUT_MS = 8_000;

const UNAVAILABLE: OnDeviceAIAvailability = Object.freeze({
  status: 'unavailable', provider: null, languages: null, canPrepare: false,
});

/** Same limits the native modules enforce; checked here first so bad input never crosses the bridge. */
export function isValidClosedSchema(schema: unknown): schema is OnDeviceClosedSchema {
  if (!schema || typeof schema !== 'object') return false;
  const { name, fields } = schema as { name?: unknown; fields?: unknown };
  if (typeof name !== 'string' || !IDENTIFIER.test(name) || !Array.isArray(fields) ||
    fields.length < 1 || fields.length > 16) return false;
  const seen = new Set<string>();
  return fields.every((field: unknown) => {
    if (!field || typeof field !== 'object') return false;
    const f = field as { name?: unknown; description?: unknown; choices?: unknown; maxLength?: unknown };
    if (typeof f.name !== 'string' || !IDENTIFIER.test(f.name) || seen.has(f.name)) return false;
    seen.add(f.name);
    if (f.description !== undefined && (typeof f.description !== 'string' || f.description.length > 400)) return false;
    if (f.choices !== undefined) {
      return f.maxLength === undefined && Array.isArray(f.choices) && f.choices.length >= 1 && f.choices.length <= 64 &&
        new Set(f.choices).size === f.choices.length &&
        f.choices.every((choice) => typeof choice === 'string' && choice.length > 0 && choice.length <= 64);
    }
    return Number.isSafeInteger(f.maxLength) && (f.maxLength as number) >= 1 && (f.maxLength as number) <= 200;
  });
}

// C0/C1 controls, bidi overrides/isolates and zero-width joiners have no place
// in a short label and could disguise text shown back to the user.
const UNSAFE_TEXT = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/u;

/**
 * Strict reader for model output. Accepts exactly one JSON object whose keys
 * are exactly the schema's fields, where every closed field holds one of its
 * choices verbatim and every free field is a short, clean string. A single
 * surrounding Markdown code fence is tolerated because Gemini Nano (which has
 * no constrained decoding in the pinned Prompt API) sometimes adds one.
 */
export function parseClosedOutput(text: unknown, schema: OnDeviceClosedSchema): Readonly<Record<string, string>> | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_OUTPUT) return null;
  let body = text.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/u.exec(body);
  if (fenced) body = fenced[1].trim();
  if (!body.startsWith('{') || !body.endsWith('}')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const prototype = Object.getPrototypeOf(parsed);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== schema.fields.length) return null;
  const out: Record<string, string> = {};
  for (const field of schema.fields) {
    if (!Object.prototype.hasOwnProperty.call(record, field.name)) return null;
    const value = record[field.name];
    if (typeof value !== 'string') return null;
    if ('choices' in field) {
      if (!field.choices.includes(value)) return null;
      out[field.name] = value;
    } else {
      const clean = value.normalize('NFKC').trim();
      if (clean.length > field.maxLength || UNSAFE_TEXT.test(clean)) return null;
      out[field.name] = clean;
    }
  }
  return Object.freeze(out);
}

function normalizeAvailability(raw: unknown): OnDeviceAIAvailability {
  if (!raw || typeof raw !== 'object') return UNAVAILABLE;
  const value = raw as Partial<WafraOnDeviceAINativeAvailability>;
  const status = STATUSES.includes(value.status as OnDeviceAIStatus) ? value.status as OnDeviceAIStatus : 'unavailable';
  const provider = PROVIDERS.includes(value.provider as OnDeviceAIProvider) ? value.provider as OnDeviceAIProvider : null;
  const languages = Array.isArray(value.languages)
    ? Object.freeze(value.languages.filter((code): code is string => typeof code === 'string' && /^[a-z]{2,3}$/u.test(code)))
    : null;
  // An "available" report without a known provider is not trusted.
  if (status === 'available' && !provider) return UNAVAILABLE;
  return Object.freeze({ status, provider, languages, canPrepare: value.canPrepare === true && status === 'model-not-ready' });
}

/**
 * Apple publishes the model's languages. Gemini Nano's Prompt API does not,
 * so only English is assumed there; other languages keep the rule-based path.
 */
export function supportsOnDeviceLanguage(availability: OnDeviceAIAvailability, language: OnDeviceAILanguage): boolean {
  if (availability.status !== 'available') return false;
  if (availability.languages) return availability.languages.includes(language);
  return language === 'en';
}

/** Script of user-supplied text, so an Arabic question is not sent to an English-only model. */
export function textLanguage(text: string, fallback: OnDeviceAILanguage): OnDeviceAILanguage {
  if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u.test(text)) return 'ar';
  if (/[A-Za-z]/u.test(text)) return 'en';
  return fallback;
}

function failureKind(error: unknown): OnDeviceAIFailureKind {
  const code = error && typeof error === 'object' ? String((error as { code?: unknown }).code ?? '') : '';
  switch (code) {
    case 'ERR_ON_DEVICE_AI_TIMEOUT': return 'timeout';
    case 'ERR_ON_DEVICE_AI_CANCELLED': return 'cancelled';
    case 'ERR_ON_DEVICE_AI_BUSY': return 'busy';
    case 'ERR_ON_DEVICE_AI_REFUSED': return 'refused';
    case 'ERR_ON_DEVICE_AI_UNAVAILABLE': return 'unavailable';
    case 'ERR_ON_DEVICE_AI_UNSUPPORTED_LANGUAGE': return 'language-unsupported';
    case 'ERR_ON_DEVICE_AI_INVALID_REQUEST': return 'invalid-request';
    default: return 'failed';
  }
}

export interface OnDeviceAI {
  getAvailability(options?: { refresh?: boolean }): Promise<OnDeviceAIAvailability>;
  /** Last known availability without touching native code; null before the first check. */
  peekAvailability(): OnDeviceAIAvailability | null;
  /** Explicit user action only (Android): asks AICore to fetch Gemini Nano. */
  prepare(): Promise<OnDeviceAIAvailability>;
  respond(request: OnDeviceAIRequest): Promise<OnDeviceAIResult>;
}

export function createOnDeviceAI(
  native: WafraOnDeviceAINativeModule | null,
  options: { now?: () => number; availabilityTtlMs?: number; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout } = {},
): OnDeviceAI {
  const now = options.now ?? (() => Date.now());
  const ttl = options.availabilityTtlMs ?? 30_000;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let cached: { value: OnDeviceAIAvailability; at: number } | null = null;
  let inflight: Promise<OnDeviceAIAvailability> | null = null;
  let serial: Promise<unknown> = Promise.resolve();
  let sequence = 0;

  const remember = (value: OnDeviceAIAvailability) => {
    cached = { value, at: now() };
    return value;
  };

  const getAvailability = async ({ refresh = false } = {}): Promise<OnDeviceAIAvailability> => {
    if (!native) return remember(UNAVAILABLE);
    if (!refresh && cached && now() - cached.at < ttl) return cached.value;
    inflight ??= native.getAvailability()
      .then(normalizeAvailability, () => UNAVAILABLE)
      .then(remember)
      .finally(() => { inflight = null; });
    return inflight;
  };

  const run = async (request: OnDeviceAIRequest): Promise<OnDeviceAIResult> => {
    if (!native) return { kind: 'unavailable' };
    if (!TASKS.includes(request.task) || !isValidClosedSchema(request.schema) ||
      typeof request.prompt !== 'string' || request.prompt.trim().length === 0 || request.prompt.length > MAX_PROMPT ||
      typeof request.instructions !== 'string' || request.instructions.length > MAX_PROMPT) {
      return { kind: 'invalid-request' };
    }
    if (request.cancelled?.()) return { kind: 'cancelled' };
    const availability = await getAvailability();
    if (availability.status !== 'available' || !availability.provider) return { kind: 'unavailable' };
    if (!supportsOnDeviceLanguage(availability, request.language)) return { kind: 'language-unsupported' };
    if (request.cancelled?.()) return { kind: 'cancelled' };
    const provider = availability.provider;
    const timeoutMs = Math.min(Math.max(request.timeoutMs ?? ON_DEVICE_AI_DEFAULT_TIMEOUT_MS, 500), 30_000);
    const maxTokens = Math.min(Math.max(Math.trunc(request.maxTokens ?? 256), 16), 1_024);
    const requestId = `wafra-ai-${++sequence}`;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timedOut = new Promise<{ kind: 'timeout' }>((resolve) => {
      timer = setTimer(() => resolve({ kind: 'timeout' }), timeoutMs);
    });
    const answered = native.respond(requestId, request.task, request.instructions, request.prompt,
      JSON.stringify(request.schema), maxTokens, timeoutMs)
      .then((text): OnDeviceAIResult => {
        const value = parseClosedOutput(text, request.schema);
        return value ? { kind: 'ok', value, provider } : { kind: 'invalid-output' };
      }, (error: unknown): OnDeviceAIResult => {
        const kind = failureKind(error);
        // The model or its language may have become unavailable since the check.
        if (kind === 'unavailable' || kind === 'language-unsupported') cached = null;
        return { kind };
      });
    const result = await Promise.race([answered, timedOut]);
    if (timer !== null) clearTimer(timer);
    if (result.kind === 'timeout') void native.cancel(requestId).catch(() => undefined);
    if (request.cancelled?.()) return { kind: 'cancelled' };
    return result;
  };

  return {
    getAvailability,
    peekAvailability: () => cached?.value ?? null,
    async prepare() {
      if (!native) return remember(UNAVAILABLE);
      try {
        return remember(normalizeAvailability(await native.prepare()));
      } catch {
        return getAvailability({ refresh: true });
      }
    },
    respond(request) {
      // One generation at a time; both platforms reject concurrent requests.
      const next = serial.then(() => run(request), () => run(request));
      serial = next.catch(() => undefined);
      return next.catch((): OnDeviceAIResult => ({ kind: 'failed' }));
    },
  };
}

export const onDeviceAI: OnDeviceAI = createOnDeviceAI(NativeOnDeviceAI);
