// Phone-AI Review prefill (src/lib/ai-alert-platform-reader.ts,
// ai-alert-reader.ts, ai-alert-prefill-queue.ts): the platform model's JSON
// goes through the SAME deterministic gate as every model, only pre-fills
// Review ("Suggested by on-device AI"), never posts, never runs for AE/SA,
// skips Low Power Mode / unavailable models / old alerts, is rate-limited,
// and the iOS queue is bounded and inert without a sink.
const assert = require('node:assert/strict');
const test = require('node:test');
const B = './build/';
const P = require(`${B}ai-alert-platform-reader`);
const R = require(`${B}ai-alert-reader`);
const Q = require(`${B}ai-alert-prefill-queue`);
const { isValidClosedSchema, parseClosedOutput, createOnDeviceAI } = require(`${B}on-device-ai`);
const country = require(`${B}country`);
const markets = require(`${B}markets`);

const OBS = Date.parse('2026-09-04T10:00:00Z');
const DEBITED = 'ZetaPay: USD 24.86 debited via card xx4421 @ NORTH STAR MARKET on 09/03/2026 ref A1B2C3';
const NO_CUE = 'Zeta: 24.86 USD / NORTH STAR MARKET / 09-03-2026 / card 4421';
const READING = {
  posting: 'yes', status: 'completed', amount: '24.86', currency: 'USD', direction: 'out',
  family: 'purchase', merchant: 'NORTH STAR MARKET', date: '09/03/2026',
};

const fakeAi = (value, { status = 'available', lowPower = false } = {}) => {
  const calls = [];
  return {
    calls,
    getAvailability: async () => ({ status, provider: status === 'available' ? 'apple-foundation-models' : null, languages: ['en', 'ar'], canPrepare: false }),
    peekAvailability: () => null,
    prepare: async () => ({ status, provider: null, languages: null, canPrepare: false }),
    lowPowerMode: async () => lowPower,
    networkType: async () => 'wifi',
    respond: async (request) => {
      calls.push(request);
      return value ? { kind: 'ok', value: Object.freeze({ ...value }), provider: 'apple-foundation-models' } : { kind: 'timeout' };
    },
  };
};
const deps = (ai, extra = {}) => ({ ai, readTagger: async () => null, taggerReady: () => false, now: () => OBS,
  foreground: () => true, ...extra });
const read = (source, ai, sender = 'ZETAPAY', observedAt = OBS, extra) =>
  R.aiReviewEventForRefusedAlert(source, sender, observedAt, deps(ai, extra));

test.beforeEach(() => {
  country.setActiveCountry('US');
  markets.setActiveMarket('ZZ');
  markets.setLedgerCurrency('USD', 2);
  R.resetAiAlertReaderBudget();
  R.setAiAlertPrefillEnabled(true);
});
test.after(() => markets.setLedgerCurrency(null));

test('the closed schema is valid for both platforms and matches the harness fields', () => {
  assert.ok(isValidClosedSchema(P.PLATFORM_ALERT_SCHEMA));
  assert.deepEqual(P.PLATFORM_ALERT_SCHEMA.fields.map((field) => field.name),
    ['posting', 'status', 'amount', 'currency', 'direction', 'family', 'merchant', 'date']);
  assert.ok(parseClosedOutput(JSON.stringify(READING), P.PLATFORM_ALERT_SCHEMA));
  assert.equal(parseClosedOutput(JSON.stringify({ ...READING, direction: 'sideways' }), P.PLATFORM_ALERT_SCHEMA), null);
  assert.equal(parseClosedOutput(JSON.stringify({ ...READING, extra: 'x' }), P.PLATFORM_ALERT_SCHEMA), null);
});

test('the model reading is located in the text, never invented', () => {
  const prediction = P.predictionFromPlatformReading(DEBITED, READING);
  assert.equal(prediction.status, 'completed');
  assert.equal(prediction.direction, 'debit');
  const amt = prediction.spans.find((span) => span.label === 'AMT');
  assert.equal(DEBITED.slice(amt.start, amt.end), '24.86');
  // A rewritten number ("32.70" for "32,70") is located by value when unique.
  const de = 'Kartenzahlung 32,70 EUR bei REWE am 03.09.2026';
  const rewritten = P.predictionFromPlatformReading(de, { ...READING, amount: '32.70', currency: 'EUR', merchant: 'REWE', date: '03.09.2026' });
  const deAmt = rewritten.spans.find((span) => span.label === 'AMT');
  assert.equal(de.slice(deAmt.start, deAmt.end), '32,70');
  // "not posting" wins over a completed status; unknown words map to safe values.
  assert.equal(P.predictionFromPlatformReading(DEBITED, { ...READING, posting: 'no' }).status, 'unknown');
  assert.equal(P.predictionFromPlatformReading(DEBITED, { ...READING, family: 'none' }).family, 'non-posting');
  assert.equal(P.predictionFromPlatformReading(DEBITED, { ...READING, amount: '99.99' }).spans.some((s) => s.label === 'AMT'), false);
});

test('a grounded reading pre-fills Review through the shared gate, never as a posting', async () => {
  const ai = fakeAi(READING);
  const result = await read(DEBITED, ai);
  assert.equal(result.engine, 'platform');
  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].task, 'alert-read');
  assert.ok(ai.calls[0].prompt.includes(DEBITED));
  assert.equal(result.event.decision, 'review');
  assert.deepEqual(result.event.amount.value, { currency: 'USD', minorUnits: '2486', exponent: 2 });
  assert.equal(result.event.direction, 'debit', 'the cue "debited" backs the direction');
  assert.equal(result.event.merchant.value, 'NORTH STAR MARKET');
  assert.equal(result.event.transactionDate.value, '2026-09-03');
});

test('a direction without a matching cue in the text is left for the person', async () => {
  const result = await read(NO_CUE, fakeAi(READING));
  assert.ok(result);
  assert.equal(result.event.direction, 'unknown');
  const opposite = await read(DEBITED, fakeAi({ ...READING, direction: 'in', family: 'refund' }));
  assert.equal(opposite.event.direction, 'unknown', 'the model says in, the text says debited');
});

test('the gate refuses: ungrounded amount, not posting, OTP and pending wording', async () => {
  assert.equal(await read(DEBITED, fakeAi({ ...READING, amount: '99.99' })), null);
  assert.equal(await read(DEBITED, fakeAi({ ...READING, posting: 'no', status: 'pending' })), null);
  assert.equal(await read('Your OTP is 481516 for USD 24.86 at NORTH STAR MARKET. Do not share it.', fakeAi(READING)), null);
  assert.equal(await read('ZetaPay: USD 24.86 pending via card xx4421 @ NORTH STAR MARKET', fakeAi(READING)), null);
  assert.equal(await read(DEBITED, fakeAi(null)), null, 'a timeout is nothing');
});

test('never for UAE/Saudi: sender, alert routing, user country or ledger', async () => {
  const ai = fakeAi(READING);
  assert.equal(await read(DEBITED, ai, 'ADCBAlert'), null);
  assert.equal(await read('Purchase of AED 24.86 at NORTH STAR MARKET debited from card 4421', ai), null);
  country.setActiveCountry('AE');
  assert.equal(await read(DEBITED, ai), null);
  country.setActiveCountry('SA');
  assert.equal(await read(DEBITED, ai), null);
  country.setActiveCountry('US');
  markets.setLedgerCurrency('AED', 2);
  assert.equal(await read(DEBITED, ai), null);
  assert.equal(ai.calls.length, 0, 'the model was never asked');
});

test('an amount the model writes is only found on token boundaries (never "50" inside "150.00")', async () => {
  const body = 'ZetaPay: USD 150.00 debited via card xx4421 @ NORTH STAR MARKET on 09/03/2026';
  for (const amount of ['50', '15', '0.00', '1']) {
    const prediction = P.predictionFromPlatformReading(body, { ...READING, amount });
    assert.equal(prediction.spans.some((span) => span.label === 'AMT'), false, amount);
    assert.equal(await read(body, fakeAi({ ...READING, amount })), null, amount);
  }
  const whole = await read(body, fakeAi({ ...READING, amount: '150.00' }));
  assert.equal(whole.event.amount.value.minorUnits, '15000');
});

test('skipped: Low Power Mode (tagger too), background, model unavailable, an old alert, the setting off', async () => {
  const low = fakeAi(READING, { lowPower: true });
  assert.equal(await read(DEBITED, low), null);
  assert.equal(low.calls.length, 0);
  let taggerAsked = 0;
  assert.equal(await read(DEBITED, low, 'ZETAPAY', OBS, { taggerReady: () => true, readTagger: async () => { taggerAsked += 1; return null; } }), null);
  assert.equal(taggerAsked, 0, 'the downloaded reader is skipped in Low Power Mode too');
  const background = fakeAi(READING);
  assert.equal(await read(DEBITED, background, 'ZETAPAY', OBS, { foreground: () => false }), null);
  assert.equal(background.calls.length, 0, 'never asked from a background wake');
  const off = fakeAi(READING, { status: 'not-enabled' });
  assert.equal(await read(DEBITED, off), null);
  assert.equal(off.calls.length, 0);
  const old = fakeAi(READING);
  assert.equal(await read(DEBITED, old, 'ZETAPAY', OBS - R.PLATFORM_READ_RECENT_MS - 1), null);
  assert.equal(old.calls.length, 0);
  R.setAiAlertPrefillEnabled(false);
  const disabled = fakeAi(READING);
  assert.equal(await read(DEBITED, disabled), null);
  assert.equal(disabled.calls.length, 0);
});

test('rate budget: at most N readings per window, then the tagger or nothing', async () => {
  const ai = fakeAi(READING);
  for (let i = 0; i < R.PLATFORM_READ_BUDGET.max; i += 1) assert.ok(await read(DEBITED, ai));
  assert.equal(await read(DEBITED, ai), null);
  assert.equal(ai.calls.length, R.PLATFORM_READ_BUDGET.max);
  // Past the window the budget returns.
  const later = await R.aiReviewEventForRefusedAlert(DEBITED, 'ZETAPAY', OBS + R.PLATFORM_READ_BUDGET.windowMs,
    deps(ai, { now: () => OBS + R.PLATFORM_READ_BUDGET.windowMs + 1 }));
  assert.ok(later);
});

test('without a phone model the downloaded tagger is the fallback', async () => {
  const tagged = {
    engine: 'tagger', modelVersion: 't', status: 'completed', statusP: 0.99, family: 'purchase', familyP: 0.99,
    direction: 'debit', directionP: 0.99,
    spans: [{ label: 'AMT', start: DEBITED.indexOf('24.86'), end: DEBITED.indexOf('24.86') + 5, p: 0.99 }],
  };
  const result = await read(DEBITED, fakeAi(null, { status: 'unsupported-os' }), 'ZETAPAY', OBS,
    { taggerReady: () => true, readTagger: async () => tagged });
  assert.equal(result.engine, 'tagger');
  assert.equal(result.event.decision, 'review');
});

test('the on-device provider accepts the alert-read task and reads device state safely', async () => {
  const requests = [];
  const native = {
    getAvailability: async () => ({ status: 'available', provider: 'gemini-nano', languages: null, canPrepare: false }),
    respond: async (...args) => { requests.push(args); return JSON.stringify(READING); },
    cancel: async () => {},
    prepare: async () => ({ status: 'available', provider: 'gemini-nano', canPrepare: false }),
    getPowerState: async () => ({ lowPowerMode: true }),
    getNetworkType: async () => 'cellular',
  };
  const ai = createOnDeviceAI(native);
  const result = await ai.respond({ task: 'alert-read', instructions: P.PLATFORM_ALERT_INSTRUCTIONS,
    prompt: `Message:\n${DEBITED}`, schema: P.PLATFORM_ALERT_SCHEMA, language: 'en' });
  assert.equal(result.kind, 'ok');
  assert.equal(requests[0][1], 'alert-read');
  assert.equal(await ai.lowPowerMode(), true);
  assert.equal(await ai.networkType(), 'cellular');
  // An older native build without the new methods: safe defaults.
  const legacy = createOnDeviceAI({ ...native, getPowerState: undefined, getNetworkType: undefined });
  assert.equal(await legacy.lowPowerMode(), false);
  assert.equal(await legacy.networkType(), 'unknown', 'unknown is never treated as Wi-Fi');
  const throwing = createOnDeviceAI({ ...native, getNetworkType: async () => { throw new Error('x'); }, getPowerState: async () => 'odd' });
  assert.equal(await throwing.networkType(), 'unknown');
  assert.equal(await throwing.lowPowerMode(), false);
  assert.equal(await createOnDeviceAI(null).networkType(), 'unknown');
});

test('iOS queue: inert without a sink; stages only a labelled Review item; bounded; recent only', async () => {
  const job = (n, observedAt = Date.now()) => ({
    source: DEBITED, sender: 'ZETAPAY', observedAt, channel: 'inbox',
    identity: { id: `local_review_id_${String(n).padStart(32, '0')}`, sourceKey: `local_review_source_${String(n).padStart(32, '0')}` },
  });
  Q.setAiPrefillSink(null);
  assert.equal(Q.enqueueAiPrefill(job(1)), false, 'no sink: nothing kept');
  const staged = [];
  Q.setAiPrefillSink((items) => { staged.push(...items); });
  const readings = [];
  Q.setAiPrefillReaderForTests(async (source, sender, observedAt) => {
    readings.push(source);
    return R.aiReviewEventForRefusedAlert(source, sender, observedAt, deps(fakeAi(READING), { now: () => observedAt }));
  });
  // Clearing (opt-out, Private Mode, erase, restore) drops waiting and in-flight jobs.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  Q.setAiPrefillReaderForTests(async (source, sender, observedAt) => {
    await gate;
    return R.aiReviewEventForRefusedAlert(source, sender, observedAt, deps(fakeAi(READING), { now: () => observedAt }));
  });
  assert.equal(Q.enqueueAiPrefill(job(50)), true);
  assert.equal(Q.enqueueAiPrefill(job(51)), true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  Q.clearAiPrefillQueue();
  release();
  await Q.flushAiPrefillQueue();
  assert.equal(staged.length, 0, 'nothing staged after a clear');
  Q.setAiPrefillReaderForTests(async (source, sender, observedAt) => {
    readings.push(source);
    return R.aiReviewEventForRefusedAlert(source, sender, observedAt, deps(fakeAi(READING), { now: () => observedAt }));
  });
  try {
    assert.equal(Q.enqueueAiPrefill(job(2, Date.now() - R.PLATFORM_READ_RECENT_MS - 1000)), false, 'old alert');
    assert.equal(Q.enqueueAiPrefill(job(3)), true);
    assert.equal(Q.enqueueAiPrefill(job(3)), false, 'the same source is queued once');
    await Q.flushAiPrefillQueue();
    assert.equal(staged.length, 1);
    const [item] = staged;
    assert.equal(item.kind, 'universal');
    assert.equal(item.suggestedBy, 'ai');
    assert.equal(item.id, job(3).identity.id);
    assert.deepEqual(item.event.amount.value, { currency: 'USD', minorUnits: '2486', exponent: 2 });
    assert.ok(item.learn, 'confirming it will teach the format');
    assert.ok(!JSON.stringify(item).includes('ref A1B2C3'), 'no message text in the item');
    // Bounded: a burst beyond the cap is dropped, not queued.
    let accepted = 0;
    for (let n = 10; n < 10 + Q.AI_PREFILL_MAX_QUEUE + 5; n += 1) if (Q.enqueueAiPrefill(job(n))) accepted += 1;
    assert.ok(accepted <= Q.AI_PREFILL_MAX_QUEUE);
    await Q.flushAiPrefillQueue();
    assert.equal(Q.aiPrefillQueueLength(), 0);
    // Setting off: nothing is kept.
    R.setAiAlertPrefillEnabled(false);
    assert.equal(Q.enqueueAiPrefill(job(99)), false);
  } finally {
    Q.setAiPrefillReaderForTests(null);
    Q.setAiPrefillSink(null);
  }
});
