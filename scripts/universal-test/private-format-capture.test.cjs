const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLoader } = require('./load-ts.cjs');
const source = 'Bank alert: account ending 1357. GBP 46.80 at CEDAR BAKERY. Date: 2026-10-10.';
const observedAt = Date.parse('2026-10-10T12:00:00Z');
const now = new Date('2026-10-12T12:00:00Z');
const match = (fields = {}) => ({ kind: 'prefill', templateId: 'opaque-private-template-id',
  fields: { amountMinor: 4680, currency: 'GBP', exponent: 2, direction: 'debit',
    merchant: 'CEDAR BAKERY', date: '2026-10-10', ...fields } });
function converter(load = createLoader()) {
  const exists = fs.existsSync(path.resolve(__dirname, '../../src/lib/private-alert-format-review.ts'));
  return exists ? load('@/lib/private-alert-format-review').privateAlertFormatReviewEvent : () => null;
}
test('a locally confirmed format prefills unknown direction while money remains source-owned Review', async () => {
  const load = createLoader(); const convert = converter(load);
  common(load); const f = await teach(load); const hit = await f.runtime.read(source, 'UNLISTED-BANK', observedAt, { country: 'GB', dateOrder: 'DMY' });
  const event = convert(source, 'UNLISTED-BANK', observedAt, hit, { country: 'GB', dateOrder: 'DMY' });
  assert.ok(event, 'the production learned-format converter must return source-grounded Review');
  assert.equal(event.decision, 'review'); assert.equal(event.direction, 'debit'); assert.equal(event.status, 'unknown');
  assert.equal(event.amount.evidence, 'explicit'); assert.deepEqual(event.amount.value, { currency: 'GBP', minorUnits: '4680', exponent: 2 });
  assert.equal(event.merchant.value, 'CEDAR BAKERY'); assert.equal(event.transactionDate.value, '2026-10-10');
  assert.ok(event.issues.includes('learned-format')); assert.ok(!event.issues.includes('ai-proposed'));
  assert.ok(!JSON.stringify(event).includes('opaque-private-template-id'));
  const baseline = load('@/lib/universal-parser').inspectUniversalBankEvent(source, { sender: 'UNLISTED-BANK', dateOrder: 'DMY' });
  assert.deepEqual(event.instrument, baseline.instrument);
});
for (const fields of [{ amountMinor: 99900 }, { currency: 'USD' }, { exponent: 3 }, { merchant: 'INVENTED SHOP' },
  { date: '2012-04-03' }, { direction: 'none' }, { amountMinor: NaN }]) {
  test(`unissued field objects cannot propose source facts: ${Object.keys(fields).join(',')}`, () => {
    assert.equal(converter()(source, 'UNLISTED-BANK', observedAt, match(fields), { country: 'GB', dateOrder: 'DMY' }), null);
  });
}
for (const suffix of [' Payment failed.', ' Payment scheduled tomorrow.', ' Your OTP is 123456.', ' Payment pending.',
  ' Statement total GBP 46.80.', ' Credit limit GBP 46.80.', ' Minimum due GBP 46.80.']) {
  test(`whole-source financial controls cannot be reopened by learning: ${suffix}`, async () => {
    const load = createLoader(); common(load); const f = await teach(load); const text = source + suffix;
    const hit = await f.runtime.read(text, 'UNLISTED-BANK', observedAt, { country: 'GB', dateOrder: 'DMY' });
    assert.equal(hit, null);
    assert.equal(converter(load)(text, 'UNLISTED-BANK', observedAt, hit, { country: 'GB', dateOrder: 'DMY' }), null);
  });
}
test('mature Gulf sender, route, country and future dates refuse learned enrichment', () => {
  const convert = converter();
  assert.equal(convert(source, 'ADIB', observedAt, match(), { country: 'GB' }), null);
  assert.equal(convert(source, 'UNLISTED-BANK', observedAt, match(), { country: 'AE' }), null);
  assert.equal(convert(source, 'UNLISTED-BANK', observedAt, match(), { routedMarket: 'SA' }), null);
  assert.equal(convert(source.replaceAll('2026-10-10', '2026-10-20'), 'UNLISTED-BANK', observedAt,
    match({ date: '2026-10-20' }), { country: 'GB' }), null);
});
test('learned Review provenance survives source-free sanitization and preserves known direction', async () => {
  const load = createLoader(); const convert = converter(load);
  common(load); const f = await teach(load); const hit = await f.runtime.read(source, 'UNLISTED-BANK', observedAt, { country: 'GB' });
  const event = convert(source, 'UNLISTED-BANK', observedAt, hit, { country: 'GB' });
  assert.ok(event);
  const generic = load('@/lib/generic-review-entry');
  const sanitized = generic.sanitizeUniversalReviewEvent(event);
  assert.ok(sanitized.issues.includes('learned-format'));
  const prior = { ...sanitized, direction: 'unknown' };
  assert.equal(generic.mergeAiReviewEvent(prior, sanitized).direction, 'debit');
  assert.equal(generic.mergeAiReviewEvent({ ...prior, status: 'posted' }, sanitized).status, 'unknown');
  assert.equal(generic.mergeAiReviewEvent({ ...prior, direction: 'credit' }, sanitized).direction, 'credit');
  assert.equal(generic.mergeAiReviewEvent(prior, { ...sanitized, issues: ['ai-proposed'] }).direction, 'unknown');
});

const record = (text = source, extra = {}) => JSON.stringify({ v: 1, id: 'a'.repeat(64), text,
  sender: 'UNLISTED-BANK', observedAt: new Date(observedAt).toISOString(), source: 'message', ...extra });
function common(load) {
  const markets = load('@/lib/markets'); markets.setActiveMarket('ZZ'); markets.setLedgerCurrency('GBP', 2);
  load('@/lib/country').setActiveCountry('GB');
  return load('@/lib/launch-alert-parser').createLaunchAlertSession({ overrides: {}, bestEffort: { enabled: false, country: null } });
}
async function teach(load, { enabled = true, beforeRead, sender = 'UNLISTED-BANK', sampleSource = source } = {}) {
  const module = load('@/lib/private-alert-format-runtime');
  let secret = null; let reads = 0;
  const runtime = module.createPrivateAlertFormatRuntime({ isNative: () => true,
    async readSecret() { reads++; await beforeRead?.(); return secret; },
    async writeSecret(value) { secret = value; }, async removeSecret() { secret = null; },
    async randomBytes() { return new Uint8Array(32).fill(23); } });
  runtime.activate({ version: 1, templates: [] });
  const first = sampleSource.replace('2026-10-10', '2026-10-08');
  const created = await runtime.prepare({ source: first, sender, confirmed: {
    amountMinor: 4680, currency: 'GBP', exponent: 2, direction: 'debit', merchant: 'CEDAR BAKERY', date: '2026-10-08' },
    context: { country: 'GB', dateOrder: 'DMY' }, now: now.getTime() });
  assert.equal(created.ok, true, created.reason);
  const second = sampleSource.replace('46.80', '57.90').replace('CEDAR BAKERY', 'ASTER SHOP').replace('2026-10-10', '2026-10-09');
  const validated = await runtime.validate(created.template, second, sender, { now: now.getTime(), country: 'GB', dateOrder: 'DMY' });
  assert.equal(validated.ok, true, validated.reason);
  runtime.activate({ version: 1, templates: [validated.template] });
  module.createPrivateAlertFormatSession = options => runtime.session({ ...options, enabled: options?.enabled ?? enabled });
  return { runtime, module, reads: () => reads };
}
test('a known purchase family with an unread payee can use a validated format without reopening parsed rows', async () => {
  const load = createLoader(), session = common(load);
  const text = 'Bank alert: Your card ending 1357 was charged GBP 46.80. Trading party: CEDAR BAKERY. Date: 2026-10-10.';
  const f = await teach(load, { sampleSource: text });
  const local = load('@/lib/local-message-record');
  const serialized = record(text.replace('46.80', '73.25'));
  const baseline = local.parseLocalMessageRecord(serialized, now, null, session);
  assert.equal(baseline.kind, 'review');
  assert.equal(baseline.item.event.family, 'purchase');
  assert.equal(baseline.item.event.merchant.evidence, 'missing');
  const result = await local.parseLocalMessageRecordWithPrivateFormat(serialized, now, null, session, f.runtime.session(), undefined, baseline);
  assert.equal(result.kind, 'review');
  assert.equal(result.item.event.family, 'purchase');
  assert.equal(result.item.event.merchant.value, 'CEDAR BAKERY');
  assert.equal(result.item.sourceKey, baseline.item.sourceKey);
});
test('actual local record enrichment prefills changed source money without changing Message identity', async () => {
  const load = createLoader(), session = common(load); const local = load('@/lib/local-message-record');
  const f = await teach(load); const calls = []; const real = f.runtime.session();
  const reader = { async read(...args) { calls.push(args); return real.read(...args); } };
  const text = source.replace('46.80', '73.25'); const serialized = record(text);
  const prior = local.parseLocalMessageRecord(serialized, now, null, session);
  const result = local.parseLocalMessageRecordWithPrivateFormat
    ? await local.parseLocalMessageRecordWithPrivateFormat(serialized, now, null, session, reader, undefined, prior)
    : prior;
  assert.equal(result.kind, 'review'); assert.equal(result.item.event.direction, 'debit');
  assert.equal(result.item.event.status, 'unknown'); assert.equal(result.item.event.amount.value.minorUnits, '7325');
  assert.equal(result.item.id, prior.item.id); assert.equal(result.item.sourceKey, prior.item.sourceKey);
  assert.equal(result.item.channel, 'inbox'); assert.equal(result.item.expiresAt, prior.item.expiresAt);
  assert.equal(calls.length, 1); assert.ok(!JSON.stringify(result).includes(text));
});
test('a copied or source-swapped private match cannot provide a trusted Review direction', async () => {
  const load = createLoader(); common(load); const f = await teach(load); const convert = converter(load);
  const hit = await f.runtime.read(source, 'UNLISTED-BANK', observedAt, { country: 'GB' });
  assert.ok(hit);
  assert.equal(convert(source, 'UNLISTED-BANK', observedAt, { ...hit }, { country: 'GB' }), null);
  assert.equal(convert(source.replace('46.80', '73.25'), 'UNLISTED-BANK', observedAt, hit, { country: 'GB' }), null);
  assert.equal(convert(source, 'OTHER-BANK', observedAt, hit, { country: 'GB' }), null);
  assert.equal(convert(source, 'UNLISTED-BANK', observedAt + 1, hit, { country: 'GB' }), null);
  f.runtime.invalidate(); assert.equal(convert(source, 'UNLISTED-BANK', observedAt, hit, { country: 'GB' }), null);
});
function androidHarness(load, { rows, delivery = [], notifications = [] }) {
  const { createHash } = require('node:crypto'); const acknowledgements = [];
  load('react-native').Platform.OS = 'android';
  const sms = { async getInboxSms(since, beforeDate, beforeId, limit) {
    return rows.filter(item => item.date >= since && (item.date < beforeDate || item.date === beforeDate && item.id < beforeId))
      .sort((a, b) => b.date - a.date || b.id - a.id).slice(0, limit); }, async getReceived() { return delivery; } };
  const push = { isAvailable: () => true, isEnabled: () => true, async getCaptured() { return notifications; },
    async ackCaptured(ids) { acknowledgements.push(...ids); return true; } };
  load('expo-modules-core').requireOptionalNativeModule = name => name === 'SmsReader' ? sms : name === 'NotificationReader' ? push : null;
  load('expo-secure-store').__keychain.items.set('wafra.database.key.v1', 'a5'.repeat(32));
  const crypto = load('expo-crypto'); crypto.CryptoDigestAlgorithm = { SHA256: 'sha256' };
  crypto.digestStringAsync = async (_algorithm, text) => createHash('sha256').update(text).digest('hex');
  const aiCalls = []; load('@/lib/ai-alert-reader').createAiAlertReviewSession = () => ({ async read(...args) { aiCalls.push(args); return null; } });
  const api = load('@/lib/auto-import');
  return { aiCalls, acknowledgements, scan: options => api.scanInbox(0, {}, undefined, 'en-GB', options) };
}
const row = (body = source, extra = {}) => ({ id: 100, address: 'UNLISTED-BANK', body, date: observedAt, ...extra });
const notification = (text = source, extra = {}) => ({ id: 'synthetic-private-notification-1', pkg: 'com.example.alerts', appLabel: 'Alerts', title: '',
  text, ts: observedAt, sourceClass: 'financial-candidate', ...extra });
test('actual Android inbox uses keyed learned prefill ahead of AI and retains provider identity', async () => {
  const load = createLoader(); common(load); await teach(load);
  const h = androidHarness(load, { rows: [row(source.replace('46.80', '73.25'))] });
  const result = await h.scan(); assert.equal(result.parsed.length, 0); assert.equal(result.reviewCandidates.length, 1);
  const item = result.reviewCandidates[0]; assert.equal(item.event.direction, 'debit'); assert.equal(item.event.status, 'unknown');
  assert.equal(item.event.amount.value.minorUnits, '7325'); assert.ok(item.event.issues.includes('learned-format'));
  assert.equal(item.sourceKey, 'android_message_review_source_a100'); assert.equal(item.observedAt, observedAt); assert.equal(item.channel, 'inbox');
  assert.deepEqual(h.aiCalls, []); assert.ok(!JSON.stringify(result.reviewCandidates).includes(source));
});
function iosHarness(load, records, onStage, extra = {}) {
  const tray = load('@/lib/alert-review-tray');
  const state = { hydrated: true, marketId: 'ZZ', captureOptOut: false, transactions: [], accounts: [], cardDues: [], bills: [], budgets: [], goals: [], merchantOverrides: {},
    ledgerMoney: { schemaVersion: 2, currency: 'GBP', exponent: 2 }, reviewTray: tray.emptyAlertReviewTray(), localCaptureQualifications: [], lastScanTs: 0 };
  let queue = records, generation = 1, writes = 0; const acknowledgements = []; let lastPage = [];
  const native = { async purgeExpired() {}, async getCaptureStatus() { return { firstCapturedAt: null }; },
    async listPendingRecords() { lastPage = queue.slice(0, 50); return lastPage; },
    async acknowledgeRecords(ids) { acknowledgements.push(...ids); queue = queue.filter(item => !ids.includes(JSON.parse(item).id)); } };
  const ledger = { getState: () => state, getStateGeneration: () => generation, async ensureDurable() {},
    importBatch() { writes++; throw Error('learned Review cannot post money'); },
    stageReviewAlerts(items) { onStage?.(items, lastPage); let admitted = 0;
      for (const item of items) { const result = tray.admitPreparedReviewAlert(state.reviewTray, item, now.getTime()); state.reviewTray = result.state; admitted += result.outcome === 'admitted'; }
      return { admitted, durable: Promise.resolve() }; } };
  const aiCalls = []; load('@/lib/ai-alert-reader').createAiAlertReviewSession = () => ({ async read(...args) { aiCalls.push(args); return null; } });
  return { state, acknowledgements, writes: () => writes, replace: () => generation++, aiCalls,
    coordinator: load('@/lib/ios-local-capture').createIosLocalCaptureCoordinator({ native, ledger, now: () => now.getTime(),
      retireShortcutCapture: async () => 'not-needed', ...extra }) };
}
test('actual iOS live drain clears source before durability and acknowledges only learned Review', async () => {
  const load = createLoader(); common(load); await teach(load);
  const text = source.replace('46.80', '73.25');
  const h = iosHarness(load, [record(text)], (items, copies) => { assert.deepEqual(copies, ['']); assert.ok(!JSON.stringify(items).includes(text)); });
  const result = await h.coordinator.drain(); assert.equal(result.reviews, 1); assert.equal(result.imported, 0); assert.equal(h.writes(), 0);
  assert.equal(h.state.reviewTray.pending[0].event.direction, 'debit'); assert.ok(h.state.reviewTray.pending[0].event.issues.includes('learned-format'));
  assert.equal(h.state.reviewTray.pending[0].sourceKey, `apple_message_review_source_${'a'.repeat(64)}`);
  assert.deepEqual(h.acknowledgements, ['a'.repeat(64)]); assert.deepEqual(h.aiCalls, []);
});
function nativeHistory(chunks) {
  return { discards: 0, async purgeExpired() {}, async getCompletedSession() { return { found: chunks.flat().length,
    attempted: chunks.flat().length, accepted: chunks.flat().length, skipped: 0, chunkIndices: chunks.map((_, i) => i) }; },
    async readChunk(_id, index) { return chunks[index]; }, async discardSession() { this.discards++; } };
}
const historical = (text = source, extra = {}) => JSON.stringify({ v: 1, id: 'a'.repeat(64), text, sender: 'UNLISTED-BANK', receivedAt: new Date(observedAt).toISOString(), ...extra });
test('actual iOS History prefills every matching page while preserving source identities and accounting', async () => {
  const load = createLoader(); common(load); await teach(load);
  const aiCalls = []; load('@/lib/ai-alert-reader').createAiAlertReviewSession = () => ({ async read(...args) { aiCalls.push(args); return null; } });
  const native = nativeHistory([[historical(source.replace('46.80', '73.25'))], [historical(source.replace('46.80', '91.40'), { id: 'b'.repeat(64) })]]);
  const result = await load('@/lib/ios-history-import').loadIosHistorySession({ sessionId: 'HISTORY-11111111', native, overrides: {}, now });
  assert.equal(result.summary.reviewed, 2); assert.equal(result.summary.parsed, 0); assert.equal(result.summary.ignored, 0);
  assert.deepEqual(result.reviewCandidates.map(item => item.event.direction), ['debit', 'debit']);
  assert.deepEqual(result.reviewCandidates.map(item => item.event.amount.value.minorUnits), ['7325', '9140']);
  assert.deepEqual(result.reviewCandidates.map(item => item.sourceKey), ['a', 'b'].map(x => `apple_message_review_source_${x.repeat(64)}`));
  assert.ok(result.reviewCandidates.every(item => item.channel === 'shortcut' && item.event.issues.includes('learned-format'))); assert.deepEqual(aiCalls, []);
});
test('actual Android delivery receiver uses local prefill without creating a ledger row', async () => {
  const load = createLoader(); common(load); await teach(load);
  const h = androidHarness(load, { rows: [], delivery: [row(source.replace('46.80', '73.25'))] });
  const result = await h.scan(); assert.equal(result.parsed.length, 0); assert.equal(result.reviewCandidates.length, 1);
  assert.equal(result.reviewCandidates[0].event.direction, 'debit'); assert.equal(result.reviewCandidates[0].channel, 'delivery');
  assert.equal(result.reviewCandidates[0].event.amount.value.minorUnits, '7325'); assert.deepEqual(h.aiCalls, []);
});
test('actual Android push learns no package trust and ACK waits for durable Review commit', async () => {
  const load = createLoader(); common(load); await teach(load, { sender: '' });
  const h = androidHarness(load, { rows: [], notifications: [notification(source.replace('46.80', '73.25'))] });
  const result = await h.scan({ notificationOnly: true }); assert.equal(result.parsed.length, 0); assert.equal(result.reviewCandidates.length, 1);
  const item = result.reviewCandidates[0]; assert.equal(item.event.direction, 'debit'); assert.equal(item.channel, 'push');
  assert.ok(item.event.issues.includes('learned-format')); assert.equal(item.sourceClass, 'financial-candidate'); assert.equal(item.sourcePackage, 'com.example.alerts');
  assert.deepEqual(h.acknowledgements, []); assert.deepEqual(h.aiCalls, []);
  await result.commit([item.sourceKey]); assert.deepEqual(h.acknowledgements, []);
  await result.commit(); assert.deepEqual(h.acknowledgements, ['synthetic-private-notification-1']);
});
test('Android exact-provider duplicates remain one Review and one explicit duplicate refusal', async () => {
  const load = createLoader(); common(load); await teach(load);
  const h = androidHarness(load, { rows: [row(), row(source, { id: 99, date: observedAt - 1000 })] });
  const result = await h.scan(); assert.equal(result.reviewCandidates.length, 1); assert.equal(result.parsed.length, 0);
  assert.equal(result.reviewCandidates[0].sourceKey, 'android_message_review_source_a100'); assert.equal(result.reviewCandidates[0].event.direction, 'debit');
  assert.equal(result.declined.length, 1); assert.equal(result.declined[0].reason, 'exact-provider-duplicate'); assert.equal(result.declined[0].sourceEventId, 'a99');
});
for (const [name, text, address] of [
  ['pending', source + ' Payment pending.'], ['declined', source + ' Payment failed.'], ['future', source + ' Scheduled tomorrow.'],
  ['OTP', source + ' Your OTP is 123456.'], ['changed literal', source.replace('Bank alert:', 'Daily balance information:')],
  ['changed currency', source.replace('GBP 46.80', 'USD 46.80')], ['changed sender', source, 'OTHER-BANK'],
  ['statement', source + ' Statement total GBP 46.80.'], ['new extra money', source + ' Fee GBP 3.00.'],
]) test(`actual Android capture refuses learned proposal for ${name}`, async () => {
  const load = createLoader(); common(load); await teach(load);
  const h = androidHarness(load, { rows: [row(text, { address: address ?? 'UNLISTED-BANK' })] }); const result = await h.scan();
  assert.equal(result.parsed.length, 0); assert.ok(result.reviewCandidates.every(item => !item.event.issues.includes('learned-format')));
});
test('Android feature disable, parser repair, and format reset keep deterministic Review', async () => {
  for (const mode of ['disabled', 'repair', 'reset']) {
    const load = createLoader(); common(load); const formats = await teach(load);
    if (mode === 'reset') formats.runtime.invalidate();
    const h = androidHarness(load, { rows: [row()] });
    const result = await h.scan(mode === 'repair' ? { historyRepair: true } : mode === 'disabled' ? { privateFormatReview: { enabled: false } } : {});
    assert.equal(result.parsed.length, 0); assert.equal(result.reviewCandidates[0].event.direction, 'unknown');
    assert.ok(!result.reviewCandidates[0].event.issues.includes('learned-format'));
  }
});
test('a changed active numeric-date policy abstains from the previously taught local format', async () => {
  const load = createLoader(); common(load); await teach(load); load('@/lib/country').setActiveCountry('US');
  const h = androidHarness(load, { rows: [row()] }); const result = await h.scan();
  assert.equal(result.reviewCandidates[0].event.direction, 'unknown'); assert.ok(!result.reviewCandidates[0].event.issues.includes('learned-format'));
});
test('iOS local prefill refuses opt-out and ledger replacement during delayed secure matching', async () => {
  for (const mode of ['opt-out', 'replacement']) {
    const load = createLoader(); common(load); let scanning = false, h;
    await teach(load, { beforeRead: async () => { if (scanning) { if (mode === 'opt-out') h.state.captureOptOut = true; else h.replace(); } } });
    h = iosHarness(load, [record()]); scanning = true;
    if (mode === 'replacement') await assert.rejects(h.coordinator.drain(), /ledger was replaced/);
    else { const result = await h.coordinator.drain(); assert.equal(result.reviews, 0); }
    assert.equal(h.state.reviewTray.pending.length, 0); assert.deepEqual(h.acknowledgements, []); assert.equal(h.writes(), 0);
  }
});
test('iOS History validates duplicates and malformed chunks before local key access', async () => {
  for (const [records, code] of [[[historical(), historical()], 'duplicate-record'], [[historical(), historical(source, { id: 'invalid' })], 'record-mismatch']]) {
    const load = createLoader(); common(load); const f = await teach(load); const before = f.reads();
    const native = nativeHistory([records]); await assert.rejects(load('@/lib/ios-history-import').loadIosHistorySession({ sessionId: 'HISTORY-11111111', native, overrides: {}, now }), { code });
    assert.equal(f.reads(), before); assert.equal(native.discards, 1);
  }
});
test('iOS History cancellation during secure matching leaves native source retryable', async () => {
  const load = createLoader(); common(load); let scanning = false, cancelled = false;
  await teach(load, { beforeRead: async () => { if (scanning) cancelled = true; } });
  const native = nativeHistory([[historical()]]); scanning = true;
  await assert.rejects(load('@/lib/ios-history-import').loadIosHistorySession({ sessionId: 'HISTORY-11111111', native, overrides: {}, now, cancelled: () => cancelled }), { code: 'cancelled' });
  assert.equal(native.discards, 0);
});
test('mature Gulf capture retains its deterministic outcome without touching private format keys', async () => {
  const load = createLoader(); common(load); const f = await teach(load); const before = f.reads();
  const h = androidHarness(load, { rows: [row('Your card ****1357 was used for AED 46.80 at CEDAR BAKERY on 2026-10-10.', { address: 'ADIB' })] });
  const result = await h.scan(); assert.equal(f.reads(), before); assert.ok(result.reviewCandidates.every(item => !item.event.issues.includes('learned-format')));
});
test('validated local format supplies context for an unknown issuer that generic bank words cannot recognize', async () => {
  const load = createLoader(); const session = common(load);
  const bankless = 'Issuer notice. GBP 46.80 at CEDAR BAKERY. Date: 2026-10-10. Reference number 7654.';
  assert.equal(load('@/lib/launch-alert-parser').hasGenericBankAlertContext(bankless, 'UNLISTED-BANK'), false);
  const f = await teach(load, { sampleSource: bankless });
  const local = load('@/lib/local-message-record'); const text = bankless.replace('46.80', '73.25');
  const serialized = record(text); const baseline = local.parseLocalMessageRecord(serialized, now, null, session);
  assert.equal(baseline.kind, 'ignored');
  const result = await local.parseLocalMessageRecordWithPrivateFormat(serialized, now, null, session, f.runtime.session(), undefined, baseline);
  assert.equal(result.kind, 'review'); assert.equal(result.item.event.direction, 'debit'); assert.equal(result.item.event.status, 'unknown');
  assert.equal(result.item.event.amount.value.minorUnits, '7325'); assert.equal(result.item.event.instrument.evidence, 'missing');
  assert.ok(result.item.event.issues.includes('learned-format'));
  const androidLoad = createLoader(); common(androidLoad); await teach(androidLoad, { sampleSource: bankless });
  const h = androidHarness(androidLoad, { rows: [row(text)] }); const scanned = await h.scan();
  assert.equal(scanned.parsed.length, 0); assert.equal(scanned.reviewCandidates.length, 1); assert.equal(scanned.reviewCandidates[0].event.direction, 'debit');
});
test('iOS notification prefill retains its protected push identity without introducing bank attribution', async () => {
  const load = createLoader(); const session = common(load); const local = load('@/lib/local-message-record');
  const f = await teach(load, { sender: local.LOCAL_NOTIFICATION_SENDER }); const id = '10000000-0000-4000-8000-000000000001';
  const text = source.replace('46.80', '73.25'); const serialized = record(text, { id, source: 'notification', sender: local.LOCAL_NOTIFICATION_SENDER });
  const prior = local.parseLocalMessageRecord(serialized, now, null, session);
  const result = await local.parseLocalMessageRecordWithPrivateFormat(serialized, now, null, session, f.runtime.session(), undefined, prior);
  assert.equal(result.kind, 'review'); assert.equal(result.item.event.direction, 'debit'); assert.equal(result.item.channel, 'push');
  assert.equal(result.item.id, prior.item.id); assert.equal(result.item.sourceKey, `local_review_source_${id.replaceAll('-', '')}`);
  assert.equal(load('@/lib/alert-review-tray').isIosNotificationReview(result.item), true); assert.ok(!('sender' in result.item));
});
test('invalid, Wallet, known-family and Gulf local records never read private format keys', async () => {
  const load = createLoader(); const session = common(load); const local = load('@/lib/local-message-record'); const f = await teach(load); const before = f.reads();
  const cases = [[record(source, { v: 2 }), null],
    [record(source, { source: 'apple-pay', sender: local.LOCAL_APPLE_PAY_SENDER, id: '10000000-0000-4000-8000-000000000001' }), null],
    [record('Your card ending 1357 was used for a purchase of GBP 46.80 at CEDAR BAKERY on 2026-10-10.'), null],
    [record('Your card ending 1357 was used for AED 46.80 at CEDAR BAKERY on 2026-10-10.', { sender: 'ADIB' }), 'AE']];
  for (const [serialized, market] of cases) {
    const prior = local.parseLocalMessageRecord(serialized, now, market, session);
    assert.deepEqual(await local.parseLocalMessageRecordWithPrivateFormat(serialized, now, market, session, f.runtime.session(), undefined, prior), prior);
  }
  assert.equal(f.reads(), before);
});
