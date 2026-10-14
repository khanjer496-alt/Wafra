const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs').createLoader();
const local = load('@/lib/local-message-record');
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { createAiAlertReviewSession } = load('@/lib/ai-alert-reader');
const { loadIosHistorySession } = load('@/lib/ios-history-import');
const { createIosLocalCaptureCoordinator } = load('@/lib/ios-local-capture');
const tray = load('@/lib/alert-review-tray');
const markets = load('@/lib/markets');
markets.setActiveMarket('ZZ');
markets.setLedgerCurrency('GBP', 2);
load('@/lib/country').setActiveCountry('GB');
const now = new Date('2026-10-12T12:00:00.000Z');
const source = 'Bank alert: account ****1357. GBP 46.80 at CEDAR BAKERY. Date: 2026-10-10.';
const observedAt = '2026-10-10T12:00:00.000Z';
const session = () => createLaunchAlertSession({ overrides: {}, bestEffort: { enabled: false, country: null } });
const live = (text = source, extra = {}) => JSON.stringify({ v: 1, id: 'a'.repeat(64), text, sender: 'UNLISTED-BANK', observedAt, source: 'message', ...extra });
const historical = (text = source, extra = {}) => JSON.stringify({ v: 1, id: 'a'.repeat(64), text, sender: 'UNLISTED-BANK', receivedAt: observedAt, ...extra });
function runtime(extra = {}) {
  const requests = [];
  const { respond, ...properties } = extra;
  return { requests, ai: { async getAvailability() { return { status: 'available', provider: 'apple-foundation-models', languages: ['en'], canPrepare: false }; },
    async respond(request) { requests.push(request); return respond ? respond(request) : { kind: 'ok', provider: 'apple-foundation-models', value: { amountId: 'm0', family: 'purchase', merchantQuote: 'CEDAR BAKERY', dateQuote: '' } }; },
    ...properties } };
}
const options = ai => ({ runtime: ai, country: 'GB', enabled: true });
const parse = (record, ai, cancelled) => local.parseLocalMessageRecordWithAi(record, now, null, session(), createAiAlertReviewSession(options(ai)), cancelled);
function nativeHistory(chunks) {
  return { discards: 0, async purgeExpired() {}, async getCompletedSession() { return { found: chunks.flat().length, attempted: chunks.flat().length, accepted: chunks.flat().length, skipped: 0, chunkIndices: chunks.map((_, i) => i) }; },
    async readChunk(_id, index) { return chunks[index]; }, async discardSession() { this.discards++; } };
}
function liveHarness(records, ai, onStage, pageSize = 50) {
  const state = { hydrated: true, marketId: 'ZZ', captureOptOut: false, transactions: [], accounts: [], cardDues: [], bills: [], budgets: [], goals: [], merchantOverrides: {},
    ledgerMoney: { schemaVersion: 2, currency: 'GBP', exponent: 2 }, reviewTray: tray.emptyAlertReviewTray(), localCaptureQualifications: [], lastScanTs: 0 };
  let queue = records;
  const acknowledgements = [];
  let writes = 0, generation = 1;
  let lastPage = [];
  const native = { async purgeExpired() {}, async getCaptureStatus() { return { firstCapturedAt: null }; }, async listPendingRecords() { lastPage = queue.slice(0, pageSize); return lastPage; },
    async acknowledgeRecords(ids) { acknowledgements.push(...ids); queue = queue.filter(record => !ids.includes(JSON.parse(record).id)); } };
  const ledger = { getState: () => state, getStateGeneration: () => generation, async ensureDurable() {},
    importBatch() { writes++; throw Error('AI Review must never write money'); },
    stageReviewAlerts(items) { onStage?.(items, lastPage); let admitted = 0;
      for (const item of items) { const result = tray.admitPreparedReviewAlert(state.reviewTray, item, now.getTime()); state.reviewTray = result.state; admitted += result.outcome === 'admitted'; }
      return { admitted, durable: Promise.resolve() }; } };
  return { state, acknowledgements, writes: () => writes, replace: () => generation++, coordinator: createIosLocalCaptureCoordinator({ native, ledger, now: () => now.getTime(), aiReview: options(ai), retireShortcutCapture: async () => 'not-needed' }) };
}
test('live unknown-format AI Review preserves Message identity, capture date and existing source facts', async () => {
  const { ai, requests } = runtime();
  const baseline = local.parseLocalMessageRecord(live(), now, null, session());
  const result = await parse(live(), ai);
  assert.equal(result.kind, 'review'); assert.equal(result.item.event.family, 'purchase');
  assert.equal(result.item.id, baseline.item.id); assert.equal(result.item.sourceKey, baseline.item.sourceKey);
  assert.equal(result.item.observedAt, Date.parse(observedAt)); assert.equal(result.item.channel, 'inbox');
  assert.deepEqual(result.item.event.amount, baseline.item.event.amount);
  assert.equal(result.item.event.status, baseline.item.event.status); assert.equal(result.item.event.direction, baseline.item.event.direction);
  assert.equal(requests.length, 1); assert.ok(!JSON.stringify(result).includes(source));
});
for (const suffix of [' Payment failed.', ' Payment scheduled tomorrow.', ' Your OTP is 123456.']) test(`non-posted live control ${suffix} cannot invoke AI`, async () => {
  const { ai, requests } = runtime(); const record = live(source + suffix);
  assert.deepEqual(await parse(record, ai), local.parseLocalMessageRecord(record, now, null, session())); assert.equal(requests.length, 0);
});
test('invalid, Wallet and known-family records retain their original lanes without inference', async () => {
  const { ai, requests } = runtime();
  for (const record of [live(source, { v: 2 }), live(source, { source: 'apple-pay', sender: local.LOCAL_APPLE_PAY_SENDER, id: '10000000-0000-4000-8000-000000000001' }), live('Your card ****1357 was used for a purchase of GBP 46.80 at CEDAR BAKERY on 2026-10-10.')]) {
    assert.deepEqual(await parse(record, ai), local.parseLocalMessageRecord(record, now, null, session()));
  }
  assert.equal(requests.length, 0);
});
test('unavailable models and cancelled inference preserve the deterministic local Review', async () => {
  let cancelled = false;
  for (const ai of [runtime({ async getAvailability() { return { status: 'unavailable', languages: [], canPrepare: false }; } }).ai,
    runtime({ async respond() { cancelled = true; return { kind: 'ok', value: { amountId: 'm0', family: 'purchase', merchantQuote: '', dateQuote: '' } }; } }).ai]) {
    cancelled = false; const result = await parse(live(), ai, () => cancelled);
    assert.deepEqual(result, local.parseLocalMessageRecord(live(), now, null, session()));
  }
});
test('live coordinator enriches source-free Review, clears its page before durability and never posts money', async () => {
  const { ai, requests } = runtime(); const records = [live()];
  const harness = liveHarness(records, ai, (items, copies) => { assert.deepEqual(copies, ['']); assert.ok(!JSON.stringify(items).includes(source)); });
  const result = await harness.coordinator.drain();
  assert.equal(result.reviews, 1); assert.equal(result.imported, 0); assert.equal(harness.writes(), 0);
  assert.equal(harness.state.reviewTray.pending[0].event.family, 'purchase'); assert.equal(requests.length, 1);
  assert.deepEqual(harness.acknowledgements, ['a'.repeat(64)]); assert.equal(result.firstCapturedAt, null);
});
test('live drain inference budget spans all records and pages', async () => {
  const { ai, requests } = runtime(); const records = [live(), live(source, { id: 'b'.repeat(64) })];
  const harness = liveHarness(records, ai, undefined, 1); const result = await harness.coordinator.drain();
  assert.equal(result.reviews, 2); assert.equal(requests.length, 1); assert.equal(harness.writes(), 0);
});
test('opt-out during live inference leaves every record unacknowledged', async () => {
  let harness;
  const { ai } = runtime({ async respond() { harness.state.captureOptOut = true; return { kind: 'cancelled' }; } });
  harness = liveHarness([live()], ai); const result = await harness.coordinator.drain();
  assert.equal(result.reviews, 0); assert.deepEqual(harness.acknowledgements, []); assert.equal(harness.writes(), 0);
});
test('ledger replacement during inference refuses the page before Review mutation or ACK', async () => {
  let harness;
  const { ai } = runtime({ async respond() { harness.replace(); return { kind: 'cancelled' }; } });
  harness = liveHarness([live()], ai); await assert.rejects(harness.coordinator.drain(), /ledger was replaced/);
  assert.deepEqual(harness.acknowledgements, []); assert.equal(harness.state.reviewTray.pending.length, 0);
});
test('history uses one model inference for the full import and retains exact dedup identity and old-message Review expiry', async () => {
  const { ai, requests } = runtime(); const native = nativeHistory([[historical()], [historical(source, { id: 'b'.repeat(64) })]]);
  const result = await loadIosHistorySession({ sessionId: 'HISTORY-11111111', native, overrides: {}, now, aiReview: options(ai) });
  assert.equal(result.summary.reviewed, 2); assert.equal(result.summary.parsed, 0); assert.equal(result.summary.ignored, 0);
  assert.equal(result.reviewCandidates[0].event.family, 'purchase'); assert.equal(result.reviewCandidates[1].event.family, 'unknown');
  assert.equal(result.reviewCandidates[0].sourceKey, `apple_message_review_source_${'a'.repeat(64)}`);
  assert.equal(result.reviewCandidates[0].channel, 'shortcut'); assert.equal(result.reviewCandidates[0].observedAt, Date.parse(observedAt));
  assert.ok(result.reviewCandidates[0].expiresAt > now.getTime()); assert.ok(!JSON.stringify(result).includes(source)); assert.equal(requests.length, 1);
});
test('history validates the whole chunk before AI sees any source', async () => {
  const { ai, requests } = runtime(); const native = nativeHistory([[historical(), historical(source, { id: 'invalid' })]]);
  await assert.rejects(loadIosHistorySession({ sessionId: 'HISTORY-11111111', native, overrides: {}, now, aiReview: options(ai) }), { code: 'record-mismatch' });
  assert.equal(requests.length, 0); assert.equal(native.discards, 1);
});
test('history cancellation during inference drops suggestions and preserves retryable native source', async () => {
  let cancelled = false;
  const { ai } = runtime({ async respond() { cancelled = true; return { kind: 'cancelled' }; } }); const native = nativeHistory([[historical()]]);
  await assert.rejects(loadIosHistorySession({ sessionId: 'HISTORY-11111111', native, overrides: {}, now, aiReview: options(ai), cancelled: () => cancelled }), { code: 'cancelled' });
  assert.equal(native.discards, 0);
});
test('a notification Review retains its protected lane and observation UUID', async () => {
  const { ai, requests } = runtime(); const id = '10000000-0000-4000-8000-000000000001';
  const result = await parse(live(source, { id, sender: local.LOCAL_NOTIFICATION_SENDER, source: 'notification' }), ai);
  assert.equal(result.kind, 'review'); assert.equal(result.item.channel, 'push'); assert.equal(result.item.event.family, 'purchase');
  assert.equal(result.item.sourceKey, `local_review_source_${id.replaceAll('-', '')}`); assert.equal(tray.isIosNotificationReview(result.item), true);
  assert.equal(requests.length, 1);
});
test('a mature Gulf refusal cannot be reopened by the iOS AI wrapper', async () => {
  const { ai, requests } = runtime(); const record = live('Your card ****1357 was used for AED 46.80 at CEDAR BAKERY on 2026-10-10.', { sender: 'ADIB' });
  const baseline = local.parseLocalMessageRecord(record, now, 'AE', session());
  assert.deepEqual(await local.parseLocalMessageRecordWithAi(record, now, 'AE', session(), createAiAlertReviewSession(options(ai))), baseline);
  assert.equal(requests.length, 0);
});
test('enrichment cannot lower ambiguous money or replace known merchant/status/direction', () => {
  const baseline = local.parseLocalMessageRecord(live(), now, null, session()).item;
  const old = { ...baseline, event: { ...baseline.event, amount: { ...baseline.event.amount, evidence: 'ambiguous', alternatives: [baseline.event.amount.value] } } };
  const proposed = { ...baseline.event, family: 'purchase', status: 'posted', direction: 'debit',
    amount: { ...baseline.event.amount, value: { currency: 'GBP', minorUnits: '99900', exponent: 2 } },
    merchant: { ...baseline.event.merchant, value: 'OTHER SHOP' } };
  const item = local.prepareAiEnrichedLocalReview({ id: baseline.id, sourceKey: baseline.sourceKey, observedAt: baseline.observedAt, channel: 'push', event: proposed }, old);
  assert.deepEqual(item.event.amount, old.event.amount); assert.deepEqual(item.event.merchant, old.event.merchant);
  assert.equal(item.event.status, old.event.status); assert.equal(item.event.direction, old.event.direction);
  assert.equal(item.channel, old.channel); assert.equal(item.expiresAt, old.expiresAt);
});
test('history controls and unavailable models do not change parsed/review/ignored accounting', async () => {
  const { ai, requests } = runtime();
  const native = nativeHistory([[historical(source + ' Payment failed.'), historical(source + ' Your OTP is 123456.', { id: 'b'.repeat(64) }), historical(source + ' Payment scheduled tomorrow.', { id: 'c'.repeat(64) })]]);
  const result = await loadIosHistorySession({ sessionId: 'HISTORY-11111111', native, overrides: {}, now, aiReview: options(ai) });
  assert.equal(requests.length, 0); assert.equal(result.summary.accepted, 3);
  assert.equal(result.summary.parsed + result.summary.reviewed + result.summary.declined + result.summary.ignored, 3);
  const unavailable = runtime({ async getAvailability() { return { status: 'unavailable', languages: [], canPrepare: false }; } });
  const loaded = await loadIosHistorySession({ sessionId: 'HISTORY-11111111', native: nativeHistory([[historical()]]), overrides: {}, now, aiReview: options(unavailable.ai) });
  assert.equal(loaded.reviewCandidates[0].event.family, 'unknown'); assert.equal(unavailable.requests.length, 0);
});
test('whole-chunk duplicate identity validation precedes every AI request', async () => {
  const { ai, requests } = runtime(); const native = nativeHistory([[historical(), historical()]]);
  await assert.rejects(loadIosHistorySession({ sessionId: 'HISTORY-11111111', native, overrides: {}, now, aiReview: options(ai) }), { code: 'duplicate-record' });
  assert.equal(requests.length, 0); assert.equal(native.discards, 1);
});
test('history clears source-bearing bridge results before progress callbacks can stage anything', async () => {
  const { ai } = runtime(); const chunks = [[historical()]];
  await loadIosHistorySession({ sessionId: 'HISTORY-11111111', native: nativeHistory(chunks), overrides: {}, now, aiReview: options(ai),
    onProgress() { assert.deepEqual(chunks[0], ['']); } });
});
test('full live capture deterministically excludes the profile date and accepts the source-owned model date', async () => {
  const profile = 'Bank alert: account ****1357. Account opening date: 2012-04-03. GBP 46.80 at CEDAR BAKERY. Effective day: 2026-10-10.';
  const baseline = local.parseLocalMessageRecord(live(profile), now, null, session());
  assert.equal(baseline.item.event.transactionDate.value, null);
  assert.equal(baseline.item.event.transactionDate.evidence, 'missing');
  const { ai, requests } = runtime({ async respond() { return { kind: 'ok', provider: 'apple-foundation-models',
    value: { amountId: 'm0', family: 'purchase', merchantQuote: 'CEDAR BAKERY', dateQuote: '2026-10-10' } }; } });
  const harness = liveHarness([live(profile)], ai);
  const result = await harness.coordinator.drain(); const event = harness.state.reviewTray.pending[0].event;
  assert.equal(result.imported, 0); assert.equal(event.transactionDate.value, '2026-10-10');
  assert.equal(event.transactionDate.evidence, 'explicit');
  assert.deepEqual(event.transactionDate.spans, []); // Persisted Review strips source spans.
  assert.deepEqual(event.transactionDate.alternatives, []);
  assert.ok(event.issues.includes('ai-proposed')); assert.equal(requests.length, 1);
  assert.deepEqual(event.amount, baseline.item.event.amount); assert.equal(event.status, baseline.item.event.status);
  assert.equal(event.direction, baseline.item.event.direction); assert.deepEqual(event.merchant, baseline.item.event.merchant);
  assert.equal(harness.writes(), 0);
});
test('full live capture rejects an exact model quote of the excluded account-opening date', async () => {
  const profile = 'Bank alert: account ****1357. Account opening date: 2012-04-03. GBP 46.80 at CEDAR BAKERY. Effective day: 2026-10-10.';
  const baseline = local.parseLocalMessageRecord(live(profile), now, null, session());
  const { ai, requests } = runtime({ async respond() { return { kind: 'ok', provider: 'apple-foundation-models',
    value: { amountId: 'm0', family: 'purchase', merchantQuote: 'CEDAR BAKERY', dateQuote: '2012-04-03' } }; } });
  const harness = liveHarness([live(profile)], ai); const result = await harness.coordinator.drain();
  assert.equal(result.imported, 0); assert.equal(requests.length, 1); assert.equal(harness.writes(), 0);
  assert.deepEqual(harness.state.reviewTray.pending[0].event, baseline.item.event);
  assert.equal(harness.state.reviewTray.pending[0].event.transactionDate.value, null);
});
test('full live capture protects a genuine known transaction date against a mismatched model quotation', async () => {
  const original = local.parseLocalMessageRecord(live(), now, null, session());
  const { ai } = runtime({ async respond() { return { kind: 'ok', provider: 'apple-foundation-models',
    value: { amountId: 'm0', family: 'purchase', merchantQuote: 'CEDAR BAKERY', dateQuote: '2012-04-03' } }; } });
  const harness = liveHarness([live()], ai); const result = await harness.coordinator.drain();
  assert.equal(result.imported, 0); assert.deepEqual(harness.state.reviewTray.pending[0].event, original.item.event);
});
test('full history capture also honors the source-owned profile-date exclusion', async () => {
  const profile = 'Bank alert: account ****1357. Account opening date: 2012-04-03. GBP 46.80 at CEDAR BAKERY. Effective day: 2026-10-10.';
  const { ai } = runtime({ async respond() { return { kind: 'ok', provider: 'apple-foundation-models',
    value: { amountId: 'm0', family: 'purchase', merchantQuote: 'CEDAR BAKERY', dateQuote: '2026-10-10' } }; } });
  const result = await loadIosHistorySession({ sessionId: 'HISTORY-11111111', native: nativeHistory([[historical(profile)]]), overrides: {}, now, aiReview: options(ai) });
  assert.equal(result.reviewCandidates[0].event.transactionDate.value, '2026-10-10');
  assert.ok(result.reviewCandidates[0].event.issues.includes('ai-proposed')); assert.equal(result.summary.parsed, 0);
});
test('a legacy profile-date correction requires its field marker and protects other known facts', () => {
  const profile = 'Bank alert: account ****1357. Account opening date: 2012-04-03. GBP 46.80 at CEDAR BAKERY. Effective day: 2026-10-10.';
  const current = local.parseLocalMessageRecord(live(profile), now, null, session()).item;
  assert.equal(current.event.transactionDate.evidence, 'missing');
  const explicitDate = value => ({ value, evidence: 'explicit',
    spans: [{ start: profile.indexOf(value), end: profile.indexOf(value) + value.length }], alternatives: [], issues: [] });
  // Test-only persisted legacy state from before deterministic profile-date
  // exclusion. Both calendar fields remain schema-valid; current parsing above
  // still excludes the opening date rather than reproducing the old bug.
  const baseline = { ...current, event: { ...current.event, transactionDate: explicitDate('2012-04-03') } };
  const input = { id: baseline.id, sourceKey: baseline.sourceKey, observedAt: baseline.observedAt, channel: baseline.channel,
    event: { ...baseline.event, family: 'purchase', issues: ['ai-proposed', 'source-profile-field-excluded'],
      merchant: { ...baseline.event.merchant, value: 'OTHER SHOP' },
      transactionDate: explicitDate('2026-10-10') } };
  const unmarked = local.prepareAiEnrichedLocalReview(input, baseline);
  assert.ok(unmarked);
  assert.equal(unmarked.event.transactionDate.value, '2012-04-03'); assert.equal(unmarked.event.merchant.value, 'CEDAR BAKERY');
  input.event.transactionDate.issues = ['source-profile-field-excluded'];
  const marked = local.prepareAiEnrichedLocalReview(input, baseline);
  assert.ok(marked); assert.equal(marked.event.transactionDate.evidence, 'explicit');
  assert.equal(marked.event.transactionDate.value, '2026-10-10'); assert.equal(marked.event.merchant.value, 'CEDAR BAKERY');
  assert.deepEqual(marked.event.amount, baseline.event.amount); assert.equal(marked.event.status, baseline.event.status);
  assert.equal(marked.event.direction, baseline.event.direction);
  input.event.transactionDate = { value: null, evidence: 'missing', spans: [], alternatives: [], issues: ['source-profile-field-excluded'] };
  const cleared = local.prepareAiEnrichedLocalReview(input, baseline);
  assert.ok(cleared); assert.equal(cleared.event.transactionDate.evidence, 'missing');
  assert.equal(cleared.event.transactionDate.value, null); assert.equal(cleared.event.merchant.value, 'CEDAR BAKERY');
});
