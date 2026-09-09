const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const load = require('./repair/load-typescript.cjs');
// Run the CURRENT coordinator source. Existing compiled dependencies are the
// regular production parser test modules, not a substitute history extractor.
const coordinator = load(path.join(__dirname, '../../src/lib/ios-history-import.ts'), {
  '@/lib/alert-review-tray': require('./build/alert-review-tray.js'),
  '@/lib/launch-alert-parser': require('./build/launch-alert-parser.js'),
  '@/lib/historical-import': require('./build/historical-import.js'),
});
const records = Array.from({ length: 10001 }, (_, i) => JSON.stringify({
  v: 1, id: i.toString(16).padStart(64, '0'),
  text: 'Synthetic non-financial history test.', sender: 'TEST',
  receivedAt: '2026-01-01T12:00:00.000Z',
}));
const chunks = [];
for (let i = 0; i < records.length; i += 37) chunks.push(records.slice(i, i + 37));
function native(paged) {
  return {
    reads: 0, discards: 0,
    async purgeExpired() { return 0; },
    async getCompletedSession() { return { paged, chunkIndices: chunks.map((_, i) => i),
      found: records.length, attempted: records.length, accepted: records.length, skipped: 0 }; },
    async readChunk(_id, index) { this.reads++; return chunks[index]; },
    async discardSession() { this.discards++; },
  };
}
test('paged source loads all 10,001 real-shaped records through the current coordinator', async () => {
  const bridge = native(true);
  const result = await coordinator.loadIosHistorySession({ sessionId: 'PAGED-11111111-1111-4111-8111-111111111111', native: bridge, overrides: {}, now: new Date('2026-09-09T12:00:00Z') });
  assert.equal(result.summary.accepted, 10001);
  assert.equal(result.summary.ignored, 10001);
  assert.equal(bridge.reads, 271);
  assert.equal(bridge.discards, 0);
});
for (const flag of [undefined, false, 'true', 1]) test(`legacy or invalid paged flag ${String(flag)} cannot enlarge the old limit`, async () => {
  const bridge = native(flag);
  await assert.rejects(() => coordinator.loadIosHistorySession({ sessionId: 'PAGED-11111111-1111-4111-8111-111111111111', native: bridge, overrides: {} }), { code: 'invalid-descriptor' });
  assert.equal(bridge.reads, 0); assert.equal(bridge.discards, 1);
});
