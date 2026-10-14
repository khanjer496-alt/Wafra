const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs').createLoader();
const { aiReviewEventForRefusedAlert: read, createAiAlertReviewSession } = load('@/lib/ai-alert-reader');
const source = 'Bank alert: account ****1357. GBP 46.80 at CEDAR BAKERY. Date: 2026-10-10.';
const observedAt = Date.parse('2026-10-12T12:00:00Z');
const value = { amountId: 'm0', family: 'purchase', merchantQuote: 'CEDAR BAKERY', dateQuote: '' };
function runtime(extra = {}) {
  const requests = [];
  const ai = {
    async getAvailability() { return { status: 'available', provider: 'apple-foundation-models', languages: ['en', 'ar'], canPrepare: false }; },
    async respond(request) { requests.push(request); return { kind: 'ok', value, provider: 'apple-foundation-models' }; },
    peekAvailability: () => null,
    prepare: async () => { throw Error('No automatic model download'); },
    ...extra,
  };
  return { ai, requests };
}
test('launch capture does not invoke an unqualified model without explicit experimental opt-in', async () => {
  const previous = process.env.EXPO_PUBLIC_WAFRA_AI_ALERT_PREFILL;
  let launchReader;
  try {
    delete process.env.EXPO_PUBLIC_WAFRA_AI_ALERT_PREFILL;
    launchReader = require('./load-ts.cjs').createLoader()('@/lib/ai-alert-reader').aiReviewEventForRefusedAlert;
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_WAFRA_AI_ALERT_PREFILL;
    else process.env.EXPO_PUBLIC_WAFRA_AI_ALERT_PREFILL = previous;
  }
  let availabilityCalls = 0;
  const { ai, requests } = runtime({ getAvailability: async () => { availabilityCalls++; throw Error('No launch inference'); } });
  assert.equal(await launchReader(source, 'UNLISTED-BANK', observedAt, { runtime: ai, country: 'GB' }), null);
  assert.equal(availabilityCalls, 0);
  assert.equal(requests.length, 0);
});
test('unfamiliar bank Review invokes actual inference instead of the removed tagger stub', async () => {
  const { ai, requests } = runtime();
  const event = await read(source, 'UNLISTED-BANK', observedAt, { runtime: ai, country: 'GB', enabled: true });
  assert.ok(event);
  assert.equal(event.decision, 'review');
  assert.equal(event.amount.value.currency, 'GBP');
  assert.equal(event.amount.value.minorUnits, '4680');
  assert.equal(event.status, 'unknown');
  assert.equal(event.direction, 'unknown');
  assert.equal(event.merchant.value, 'CEDAR BAKERY');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].task, 'alert-review');
});
test('a capture session bounds inference while ordinary parser checks remain usable', async () => {
  const { ai, requests } = runtime();
  const session = createAiAlertReviewSession({ runtime: ai, country: 'GB', enabled: true });
  assert.ok(await session.read(source, '', observedAt));
  assert.equal(await session.read(source, '', observedAt), null);
  assert.equal(requests.length, 1);
});
test('non-financial and non-posted inputs never consume inference budget', async () => {
  const { ai, requests } = runtime();
  const session = createAiAlertReviewSession({ runtime: ai, country: 'GB', enabled: true });
  assert.equal(await session.read('Lunch tomorrow?', '', observedAt), null);
  assert.equal(await session.read(source + ' Payment declined.', '', observedAt), null);
  assert.ok(await session.read(source, '', observedAt));
  assert.equal(requests.length, 1);
});
test('mature Gulf refusals and disabled feature never invoke the model', async () => {
  const { ai, requests } = runtime();
  assert.equal(await read(source, 'ADIB', observedAt, { runtime: ai, country: 'GB', enabled: true }), null);
  assert.equal(await read(source, '', observedAt, { runtime: ai, country: 'AE', enabled: true }), null);
  assert.equal(await read(source, '', observedAt, { runtime: ai, country: 'GB', enabled: false }), null);
  assert.equal(requests.length, 0);
});
for (const kind of ['unavailable', 'timeout', 'invalid-output', 'cancelled', 'failed']) test(`model ${kind} leaves the existing path intact`, async () => {
  const { ai } = runtime({ respond: async () => ({ kind }) });
  assert.equal(await read(source, '', observedAt, { runtime: ai, country: 'GB', enabled: true }), null);
});
test('unsupported language and unavailable native model preserve deterministic fallback', async () => {
  for (const status of ['unavailable', 'device-not-eligible']) {
    const { ai, requests } = runtime({ getAvailability: async () => ({ status, provider: 'apple-foundation-models', languages: ['en'], canPrepare: false }) });
    assert.equal(await read(source, '', observedAt, { runtime: ai, country: 'GB', enabled: true }), null);
    assert.equal(requests.length, 0);
  }
  const { ai, requests } = runtime({ getAvailability: async () => ({ status: 'available', provider: 'gemini-nano', languages: ['en'], canPrepare: false }) });
  assert.equal(await read('تنبيه حساب: بطاقة ****1357. GBP 46.80 عند CEDAR BAKERY.', '', observedAt,
    { runtime: ai, country: 'JO', enabled: true }), null);
  assert.equal(requests.length, 0);
});
test('cancelled/stale capture discards a model answer', async () => {
  let cancelled = false;
  const { ai } = runtime({ respond: async () => { cancelled = true; return { kind: 'ok', value, provider: 'apple-foundation-models' }; } });
  assert.equal(await read(source, '', observedAt, { runtime: ai, country: 'GB', enabled: true, cancelled: () => cancelled }), null);
});
test('invented financial fields and malformed budgets cannot produce a Review reading', async () => {
  const { ai } = runtime({ respond: async () => ({ kind: 'ok', value: { ...value, amount: '999999' }, provider: 'apple-foundation-models' }) });
  assert.equal(await read(source, '', observedAt, { runtime: ai, country: 'GB', enabled: true }), null);
  const bounded = createAiAlertReviewSession({ runtime: runtime().ai, country: 'GB', enabled: true, maxInferences: NaN });
  assert.equal(await bounded.read(source, '', observedAt), null);
});

test('availability and queued generation share a whole-request deadline and consume one session attempt', async () => {
  let availabilityCalls = 0;
  const { ai } = runtime({ getAvailability: () => { availabilityCalls++; return new Promise(() => {}); } });
  const session = createAiAlertReviewSession({ runtime: ai, country: 'GB', enabled: true, timeoutMs: 500 });
  const started = Date.now();
  assert.equal(await session.read(source, '', observedAt), null);
  assert.ok(Date.now() - started < 1500);
  assert.equal(await session.read(source, '', observedAt), null);
  assert.equal(availabilityCalls, 1);
});
