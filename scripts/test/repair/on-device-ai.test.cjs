'use strict';
/**
 * Platform on-device model provider (`src/lib/on-device-ai.ts`).
 *
 * Runs the shipping source against a scripted native bridge. Covers
 * availability states and caching, language gating, strict closed-schema
 * parsing of hostile model output, timeout/cancellation, serialisation and
 * the no-network guarantee of the JavaScript layer.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const load = require('./load-typescript.cjs');

// Values come from a vm realm; compare their JSON shape, not prototypes.
const same = (actual, expected, message) =>
  assert.deepEqual(actual === undefined ? actual : JSON.parse(JSON.stringify(actual)), expected, message);

const root = path.resolve(__dirname, '../../..');
const source = path.join(root, 'src/lib/on-device-ai.ts');

function loadProvider(native) {
  return load(source, { '../../modules/wafra-on-device-ai': { __esModule: true, default: native } });
}

const schema = {
  name: 'Test',
  fields: [
    { name: 'tool', choices: ['spending-total', 'none'] },
    { name: 'merchant', maxLength: 20 },
  ],
};
const request = (extra = {}) => ({
  task: 'ask-plan', instructions: 'Pick.', prompt: 'Question: hi', schema, language: 'en', ...extra,
});

function scripted({ availability = { status: 'available', provider: 'apple-foundation-models', languages: ['en', 'ar'] }, reply } = {}) {
  const calls = { availability: 0, respond: [], cancel: [], prepare: 0, inFlight: 0, maxInFlight: 0 };
  const native = {
    async getAvailability() { calls.availability++; return typeof availability === 'function' ? availability() : availability; },
    async respond(...args) {
      calls.respond.push(args);
      calls.inFlight++;
      calls.maxInFlight = Math.max(calls.maxInFlight, calls.inFlight);
      try {
        return await (typeof reply === 'function' ? reply(...args) : reply);
      } finally {
        calls.inFlight--;
      }
    },
    async cancel(id) { calls.cancel.push(id); },
    async prepare() { calls.prepare++; return { status: 'model-not-ready', provider: 'gemini-nano', canPrepare: false }; },
  };
  return { native, calls };
}

test('no native module (web, Expo Go, older binary) is simply unavailable', async () => {
  const { createOnDeviceAI } = loadProvider(null);
  const ai = createOnDeviceAI(null);
  assert.equal((await ai.getAvailability()).status, 'unavailable');
  same(await ai.respond(request()), { kind: 'unavailable' });
});

test('availability is normalised: unknown or provider-less "available" is not trusted', async () => {
  const { createOnDeviceAI } = loadProvider(null);
  const cases = [
    [{ status: 'available', provider: 'apple-foundation-models', languages: ['en'] }, 'available'],
    [{ status: 'available' }, 'unavailable'],
    [{ status: 'available', provider: 'cloud-gpt' }, 'unavailable'],
    [{ status: 'enabled-maybe', provider: 'gemini-nano' }, 'unavailable'],
    [{ status: 'not-enabled', provider: 'apple-foundation-models' }, 'not-enabled'],
    [{ status: 'device-not-eligible', provider: 'gemini-nano' }, 'device-not-eligible'],
    [{ status: 'unsupported-os' }, 'unsupported-os'],
    [null, 'unavailable'],
  ];
  for (const [raw, expected] of cases) {
    const { native } = scripted({ availability: raw });
    assert.equal((await createOnDeviceAI(native).getAvailability()).status, expected, JSON.stringify(raw));
  }
  const rejects = { ...scripted().native, getAvailability: async () => { throw new Error('bridge'); } };
  assert.equal((await createOnDeviceAI(rejects).getAvailability()).status, 'unavailable');
  const prep = scripted({ availability: { status: 'available', provider: 'gemini-nano', canPrepare: true } });
  assert.equal((await createOnDeviceAI(prep.native).getAvailability()).canPrepare, false,
    'canPrepare only means something while the model is not ready');
});

test('availability is cached for its TTL and refreshed on demand', async () => {
  const { createOnDeviceAI } = loadProvider(null);
  let clock = 0;
  const { native, calls } = scripted();
  const ai = createOnDeviceAI(native, { now: () => clock, availabilityTtlMs: 1000 });
  assert.equal(ai.peekAvailability(), null);
  await ai.getAvailability();
  await ai.getAvailability();
  assert.equal(calls.availability, 1);
  assert.equal(ai.peekAvailability().status, 'available');
  clock = 2000;
  await ai.getAvailability();
  assert.equal(calls.availability, 2);
  await ai.getAvailability({ refresh: true });
  assert.equal(calls.availability, 3);
});

test('a valid closed object is returned with its provider', async () => {
  const { createOnDeviceAI } = loadProvider(null);
  const { native, calls } = scripted({ reply: '{"tool":"spending-total","merchant":""}' });
  const result = await createOnDeviceAI(native).respond(request());
  same({ ...result.value }, { tool: 'spending-total', merchant: '' });
  assert.equal(result.provider, 'apple-foundation-models');
  const [id, task, instructions, prompt, schemaJson, maxTokens, timeoutMs] = calls.respond[0];
  assert.match(id, /^wafra-ai-\d+$/);
  assert.equal(task, 'ask-plan');
  assert.equal(instructions, 'Pick.');
  assert.equal(prompt, 'Question: hi');
  same(JSON.parse(schemaJson), schema);
  assert.ok(maxTokens >= 16 && maxTokens <= 1024 && timeoutMs >= 500 && timeoutMs <= 30000);
});

test('hostile or malformed model output is rejected, never repaired', async () => {
  const { parseClosedOutput } = loadProvider(null);
  const rejected = [
    '', 'null', '[]', '"spending-total"', '42',
    'Sure! {"tool":"spending-total","merchant":""}',
    '{"tool":"spending-total","merchant":""} and more',
    '{"tool":"spending-total","merchant":""}{"tool":"none","merchant":""}',
    '{"tool":"spending-total"}',
    '{"tool":"spending-total","merchant":"","amount":"AED 5,000"}',
    '{"tool":"delete-everything","merchant":""}',
    '{"tool":"Spending-Total","merchant":""}',
    '{"tool":["spending-total"],"merchant":""}',
    '{"tool":"spending-total","merchant":5000}',
    '{"tool":"spending-total","merchant":{"name":"x"}}',
    '{"tool":"spending-total","merchant":"a merchant name that is far too long"}',
    '{"tool":"spending-total","merchant":"Tal\\u202Ebat"}',
    '{"tool":"spending-total","merchant":"line\\nbreak"}',
    '{"__proto__":{"polluted":true},"tool":"spending-total","merchant":""}',
    '```json\n{"tool":"spending-total","merchant":""}\n``` trailing',
    'x'.repeat(5000),
  ];
  for (const text of rejected) assert.equal(parseClosedOutput(text, schema), null, JSON.stringify(text).slice(0, 80));
  assert.equal({}.polluted, undefined);
  same({ ...parseClosedOutput('```json\n{"tool":"none","merchant":" Talabat "}\n```', schema) },
    { tool: 'none', merchant: 'Talabat' }, 'one surrounding code fence (Gemini Nano) is tolerated');
  const parsed = parseClosedOutput('{"merchant":"","tool":"none"}', schema);
  assert.ok(Object.isFrozen(parsed));

  const { createOnDeviceAI } = loadProvider(null);
  const { native } = scripted({ reply: '{"tool":"spending-total","merchant":"","total":"999"}' });
  same(await createOnDeviceAI(native).respond(request()), { kind: 'invalid-output' });
});

test('bad requests never cross the bridge', async () => {
  const { createOnDeviceAI, isValidClosedSchema } = loadProvider(null);
  const { native, calls } = scripted({ reply: '{}' });
  const ai = createOnDeviceAI(native);
  for (const bad of [
    request({ task: 'free-chat' }),
    request({ prompt: '' }),
    request({ prompt: 'x'.repeat(6001) }),
    request({ schema: { name: 'X', fields: [] } }),
    request({ schema: { name: 'X', fields: [{ name: 'a', choices: ['x', 'x'] }] } }),
    request({ schema: { name: 'X', fields: [{ name: 'a', maxLength: 500 }] } }),
    request({ schema: { name: '9', fields: [{ name: 'a', choices: ['x'] }] } }),
  ]) same(await ai.respond(bad), { kind: 'invalid-request' });
  assert.equal(calls.respond.length, 0);
  assert.equal(isValidClosedSchema(schema), true);
});

test('language gating: Apple uses its reported list, Gemini Nano is English-only', async () => {
  const { createOnDeviceAI, supportsOnDeviceLanguage, textLanguage } = loadProvider(null);
  const apple = { status: 'available', provider: 'apple-foundation-models', languages: ['en'], canPrepare: false };
  assert.equal(supportsOnDeviceLanguage(apple, 'en'), true);
  assert.equal(supportsOnDeviceLanguage(apple, 'ar'), false);
  assert.equal(supportsOnDeviceLanguage({ ...apple, languages: ['ar', 'en'] }, 'ar'), true);
  const gemini = { status: 'available', provider: 'gemini-nano', languages: null, canPrepare: false };
  assert.equal(supportsOnDeviceLanguage(gemini, 'en'), true);
  assert.equal(supportsOnDeviceLanguage(gemini, 'ar'), false);
  assert.equal(supportsOnDeviceLanguage({ ...apple, status: 'not-enabled' }, 'en'), false);
  assert.equal(textLanguage('كم صرفت على المطاعم', 'en'), 'ar');
  assert.equal(textLanguage('Coffee please', 'ar'), 'en');
  assert.equal(textLanguage('123', 'ar'), 'ar');

  const { native, calls } = scripted({ availability: { status: 'available', provider: 'gemini-nano' }, reply: '{}' });
  same(await createOnDeviceAI(native).respond(request({ language: 'ar' })), { kind: 'language-unsupported' });
  assert.equal(calls.respond.length, 0, 'an unsupported language never reaches the model');
});

test('every unavailable state keeps callers on their deterministic path', async () => {
  const { createOnDeviceAI } = loadProvider(null);
  for (const status of ['unsupported-os', 'device-not-eligible', 'not-enabled', 'model-not-ready', 'unavailable']) {
    const { native, calls } = scripted({ availability: { status, provider: 'apple-foundation-models' }, reply: '{}' });
    same(await createOnDeviceAI(native).respond(request()), { kind: 'unavailable' }, status);
    assert.equal(calls.respond.length, 0);
  }
});

test('a slow model times out in JavaScript and the native request is cancelled', async () => {
  const { createOnDeviceAI } = loadProvider(null);
  const { native, calls } = scripted({ reply: () => new Promise(() => {}) });
  const timers = [];
  const ai = createOnDeviceAI(native, {
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => {},
  });
  const pending = ai.respond(request({ timeoutMs: 1000 }));
  while (!timers.length) await new Promise((resolve) => setImmediate(resolve));
  timers[0]();
  same(await pending, { kind: 'timeout' });
  same(calls.cancel, [calls.respond[0][0]]);
});

test('native failure codes map to fixed kinds; unavailability invalidates the cache', async () => {
  const { createOnDeviceAI } = loadProvider(null);
  const cases = [
    ['ERR_ON_DEVICE_AI_TIMEOUT', 'timeout'], ['ERR_ON_DEVICE_AI_CANCELLED', 'cancelled'],
    ['ERR_ON_DEVICE_AI_BUSY', 'busy'], ['ERR_ON_DEVICE_AI_REFUSED', 'refused'],
    ['ERR_ON_DEVICE_AI_UNAVAILABLE', 'unavailable'], ['ERR_ON_DEVICE_AI_UNSUPPORTED_LANGUAGE', 'language-unsupported'],
    ['ERR_SOMETHING_ELSE', 'failed'],
  ];
  for (const [code, kind] of cases) {
    const { native, calls } = scripted({ reply: () => Promise.reject(Object.assign(new Error('x'), { code })) });
    const ai = createOnDeviceAI(native);
    same(await ai.respond(request()), { kind }, code);
    await ai.getAvailability();
    assert.equal(calls.availability, kind === 'unavailable' || kind === 'language-unsupported' ? 2 : 1, code);
  }
});

test('requests are serialised and cancellation is honoured before and after generation', async () => {
  const { createOnDeviceAI } = loadProvider(null);
  const { native, calls } = scripted({
    reply: () => new Promise((resolve) => setTimeout(() => resolve('{"tool":"none","merchant":""}'), 5)),
  });
  const ai = createOnDeviceAI(native);
  const results = await Promise.all([ai.respond(request()), ai.respond(request()), ai.respond(request())]);
  assert.ok(results.every((result) => result.kind === 'ok'));
  assert.equal(calls.maxInFlight, 1, 'one generation at a time');
  same(await ai.respond(request({ cancelled: () => true })), { kind: 'cancelled' });
  let cancelled = false;
  const late = ai.respond(request({ cancelled: () => cancelled }));
  cancelled = true;
  same(await late, { kind: 'cancelled' });
});

test('prepare is an explicit call only and reports the new status', async () => {
  const { createOnDeviceAI } = loadProvider(null);
  const { native, calls } = scripted({ availability: { status: 'model-not-ready', provider: 'gemini-nano', canPrepare: true } });
  const ai = createOnDeviceAI(native);
  assert.equal((await ai.getAvailability()).canPrepare, true);
  assert.equal(calls.prepare, 0, 'checking availability never downloads');
  assert.equal((await ai.prepare()).status, 'model-not-ready');
  assert.equal(calls.prepare, 1);
});

test('the JavaScript layer has no network route', () => {
  for (const file of ['src/lib/on-device-ai.ts', 'src/lib/on-device-assistant.ts', 'src/lib/on-device-category.ts',
    'modules/wafra-on-device-ai/index.ts']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(text, /\bfetch\s*\(|XMLHttpRequest|WebSocket|expo\/fetch|https?:\/\//, file);
    // Advisory only: no route to a ledger writer or importer.
    assert.doesNotMatch(text, /(?:from\s+|require\(\s*|import\(\s*)['"][^'"]*(?:\/store|import-plan|ledger-import|auto-import)['"]/, file);
  }
  for (const file of ['modules/wafra-on-device-ai/ios/WafraOnDeviceAIEngine.swift',
    'modules/wafra-on-device-ai/android/src/main/java/expo/modules/wafraondeviceai/GeminiNanoEngine.kt']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(text, /URLSession|URLRequest|HttpURLConnection|OkHttp|https?:\/\//, file);
  }
});
