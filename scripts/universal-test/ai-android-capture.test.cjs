const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const source = 'Bank alert: account ****1357. GBP 46.80 at CEDAR BAKERY. Date: 2026-10-10.';
const observedAt = Date.parse('2026-10-10T12:00:00Z');
const row = (body = source, extra = {}) => ({ id: 100, address: 'UNLISTED-BANK', body, date: observedAt, ...extra });
const notification = (text = source, extra = {}) => ({ id: 'synthetic-notification-0001', pkg: 'com.example.alerts', appLabel: 'Alerts', title: '', text,
  ts: observedAt, sourceClass: 'financial-candidate', ...extra });
function harness({ rows = [row()], notifications = [], enabled = true, availability, respond } = {}) {
  const load = require('./load-ts.cjs').createLoader();
  const requests = [], acknowledgements = [], pageReads = [];
  let sessions = 0;
  load('react-native').Platform.OS = 'android';
  const sms = { async getInboxSms(since, beforeDate, beforeId, limit) { pageReads.push({ beforeDate, beforeId });
    return rows.filter(item => item.date >= since && (item.date < beforeDate || item.date === beforeDate && item.id < beforeId))
      .sort((a, b) => b.date - a.date || b.id - a.id).slice(0, limit); }, async getReceived() { return []; } };
  const push = { isAvailable: () => true, isEnabled: () => true, async getCaptured() { return notifications; },
    async ackCaptured(ids) { acknowledgements.push(...ids); return true; } };
  load('expo-modules-core').requireOptionalNativeModule = name => name === 'SmsReader' ? sms : name === 'NotificationReader' ? push : null;
  load('expo-secure-store').__keychain.items.set('wafra.database.key.v1', 'a5'.repeat(32));
  const crypto = load('expo-crypto'); crypto.CryptoDigestAlgorithm = { SHA256: 'sha256' };
  crypto.digestStringAsync = async (_algorithm, text) => createHash('sha256').update(text).digest('hex');
  const markets = load('@/lib/markets'); markets.setActiveMarket('ZZ'); markets.setLedgerCurrency('GBP', 2);
  load('@/lib/country').setActiveCountry('GB');
  const reader = load('@/lib/ai-alert-reader'); const factory = reader.createAiAlertReviewSession;
  const runtime = { async getAvailability() { return availability ?? { status: 'available', provider: 'gemini-nano', languages: ['en'], canPrepare: false }; },
    async respond(request) { requests.push(request); return respond ? respond(request) : { kind: 'ok', provider: 'gemini-nano',
      value: { amountId: 'm0', family: 'purchase', merchantQuote: 'CEDAR BAKERY', dateQuote: '' } }; } };
  reader.createAiAlertReviewSession = options => { sessions++; return factory({ ...options, runtime, country: 'GB', enabled: options?.enabled ?? enabled }); };
  const api = load('@/lib/auto-import');
  return { requests, acknowledgements, pageReads, sessions: () => sessions,
    scan: options => api.scanInbox(0, {}, undefined, 'en-GB', options), api };
}
test('actual Android inbox AI enriches Review without a parsed ledger row or provider identity drift', async () => {
  const enhanced = harness(); const baseline = harness({ enabled: false });
  const result = await enhanced.scan(); const plain = await baseline.scan();
  assert.equal(result.parsed.length, 0); assert.equal(result.reviewCandidates.length, 1);
  const item = result.reviewCandidates[0], original = plain.reviewCandidates[0];
  assert.equal(item.event.family, 'purchase'); assert.equal(item.event.decision, 'review');
  assert.equal(item.id, original.id); assert.equal(item.sourceKey, 'android_message_review_source_a100'); assert.equal(item.sourceKey, original.sourceKey);
  assert.equal(item.observedAt, observedAt); assert.equal(item.channel, 'inbox');
  for (const field of ['amount', 'balance', 'instrument', 'transactionDate']) assert.deepEqual(item.event[field], original.event[field]);
  assert.equal(item.event.status, original.event.status); assert.equal(item.event.direction, original.event.direction);
  assert.equal(enhanced.requests.length, 1); assert.equal(enhanced.sessions(), 1); assert.ok(item.event.issues.includes('ai-proposed'));
  assert.ok(!JSON.stringify(item).includes(source)); assert.ok(!('sender' in item)); assert.ok(!('raw' in item));
});
test('one Android inference budget covers the entire multi-page inbox scan', async () => {
  const h = harness({ rows: [row(source + ' Notice A.', { id: 100 }), row(source + ' Notice B.', { id: 90, date: observedAt - 86400000 }), row(source + ' Notice C.', { id: 80, date: observedAt - 172800000 })] });
  const result = await h.scan({ pageSize: 2 });
  assert.equal(h.sessions(), 1); assert.equal(h.requests.length, 1); assert.ok(h.pageReads.length >= 2);
  assert.equal(result.parsed.length, 0); assert.equal(result.reviewCandidates.length, 3);
  assert.equal(result.reviewCandidates.filter(item => item.event.family === 'purchase').length, 1);
});
test('Android deterministic profile-date exclusion and source-owned model date survive Review sanitization', async () => {
  const profile = 'Bank alert: account ****1357. Account opening date: 2012-04-03. GBP 46.80 at CEDAR BAKERY. Effective day: 2026-10-10.';
  const plain = await harness({ rows: [row(profile)], enabled: false }).scan();
  const baseline = plain.reviewCandidates[0].event;
  assert.equal(baseline.transactionDate.value, null); assert.equal(baseline.transactionDate.evidence, 'missing');
  const h = harness({ rows: [row(profile)], respond: async () => ({ kind: 'ok', provider: 'gemini-nano',
    value: { amountId: 'm0', family: 'purchase', merchantQuote: 'CEDAR BAKERY', dateQuote: '2026-10-10' } }) });
  const result = await h.scan(); const event = result.reviewCandidates[0].event;
  assert.equal(result.parsed.length, 0); assert.equal(event.transactionDate.value, '2026-10-10');
  assert.equal(event.transactionDate.evidence, 'explicit');
  assert.deepEqual(event.transactionDate.spans, []); // Persisted Review strips source spans.
  assert.deepEqual(event.transactionDate.alternatives, []); assert.ok(event.issues.includes('ai-proposed'));
  assert.deepEqual(event.amount, baseline.amount); assert.deepEqual(event.merchant, baseline.merchant);
  assert.equal(event.status, baseline.status); assert.equal(event.direction, baseline.direction);
  assert.equal(h.requests.length, 1);
  assert.equal(result.reviewCandidates[0].sourceKey, 'android_message_review_source_a100');
});
test('Android scan rejects an exact model quotation of an excluded account-opening date', async () => {
  const profile = 'Bank alert: account ****1357. Account opening date: 2012-04-03. GBP 46.80 at CEDAR BAKERY. Effective day: 2026-10-10.';
  const baseline = await harness({ rows: [row(profile)], enabled: false }).scan();
  const h = harness({ rows: [row(profile)], respond: async () => ({ kind: 'ok', provider: 'gemini-nano',
    value: { amountId: 'm0', family: 'purchase', merchantQuote: 'CEDAR BAKERY', dateQuote: '2012-04-03' } }) });
  const result = await h.scan();
  assert.equal(result.parsed.length, 0); assert.equal(h.requests.length, 1);
  assert.deepEqual(result.reviewCandidates[0].event, baseline.reviewCandidates[0].event);
  assert.equal(result.reviewCandidates[0].event.transactionDate.value, null);
});
test('an unavailable model and invalid output preserve Android deterministic Review', async () => {
  for (const extra of [{ availability: { status: 'unavailable', provider: 'gemini-nano', languages: [], canPrepare: false } },
    { respond: async () => ({ kind: 'ok', value: { amountId: 'm0', family: 'purchase', merchantQuote: 'INVENTED SHOP', dateQuote: '' }, provider: 'gemini-nano' }) }]) {
    const h = harness(extra); const result = await h.scan(); assert.equal(result.parsed.length, 0);
    assert.equal(result.reviewCandidates[0].event.family, 'unknown'); assert.equal(result.reviewCandidates[0].event.amount.value.minorUnits, '4680');
  }
});
test('failed/future/OTP controls and already-known families never invoke Android AI', async () => {
  const h = harness({ rows: [row(source + ' Payment failed.', { id: 100 }), row(source + ' Payment scheduled tomorrow.', { id: 90, date: observedAt - 86400000 }),
    row(source + ' Your OTP is 123456.', { id: 80, date: observedAt - 172800000 }),
    row('Your card ****1357 was used for a purchase of GBP 46.80 at CEDAR BAKERY on 2026-10-10.', { id: 70, date: observedAt - 259200000 })] });
  await h.scan(); assert.equal(h.requests.length, 0);
});
test('parser-version repair skips model inference and retains its deterministic outcomes', async () => {
  const h = harness(); const result = await h.scan({ historyRepair: true });
  assert.equal(h.requests.length, 0); assert.equal(result.reviewCandidates[0].event.family, 'unknown'); assert.equal(result.parsed.length, 0);
});
test('actual Android push unknown-format AI remains Review and ACK waits for explicit durable commit', async () => {
  const h = harness({ rows: [], notifications: [notification()] }); const result = await h.scan({ notificationOnly: true });
  assert.equal(result.parsed.length, 0); assert.equal(result.reviewCandidates.length, 1); assert.equal(result.reviewCandidates[0].event.family, 'purchase');
  assert.equal(h.requests.length, 1); assert.deepEqual(h.acknowledgements, []);
  await result.commit([result.reviewCandidates[0].sourceKey]); assert.deepEqual(h.acknowledgements, []);
  await result.commit(); assert.deepEqual(h.acknowledgements, ['synthetic-notification-0001']);
});
test('inbox and push reuse the same inference budget without losing their independent Review identities', async () => {
  const h = harness({ notifications: [notification(source + ' Notice P.', { ts: observedAt + 1000 })] }); const result = await h.scan();
  assert.equal(h.sessions(), 1); assert.equal(h.requests.length, 1); assert.equal(result.parsed.length, 0); assert.equal(result.reviewCandidates.length, 2);
  assert.equal(new Set(result.reviewCandidates.map(item => item.sourceKey)).size, 2); assert.equal(new Set(result.reviewCandidates.map(item => item.id)).size, 2);
  assert.deepEqual(h.acknowledgements, []);
});
test('an exact Android provider duplicate remains declined and cannot be resurrected by AI', async () => {
  const h = harness({ rows: [row(), row(source, { id: 99, date: observedAt - 1000 })] });
  const result = await h.scan(); assert.equal(result.reviewCandidates.length, 1); assert.equal(result.parsed.length, 0);
  assert.equal(result.reviewCandidates[0].sourceKey, 'android_message_review_source_a100');
  assert.equal(result.declined.length, 1); assert.equal(result.declined[0].sourceEventId, 'a99');
  assert.equal(result.declined[0].reason, 'exact-provider-duplicate'); assert.equal(h.requests.length, 1);
});
test('mature Gulf formats and native-language unavailability never gain an Android AI proposal', async () => {
  const gulf = harness({ rows: [row(source, { address: 'ADIB' })] }); await gulf.scan(); assert.equal(gulf.requests.length, 0);
  const arabic = harness({ rows: [row('تنبيه حساب: بطاقة ****1357. GBP 46.80 لدى CEDAR BAKERY.', { address: 'UNLISTED-BANK' })] });
  const result = await arabic.scan(); assert.equal(arabic.requests.length, 0); assert.equal(result.parsed.length, 0);
  assert.equal(result.reviewCandidates.length, 1);
});
