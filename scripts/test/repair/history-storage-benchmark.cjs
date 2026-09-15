'use strict';
/**
 * Deterministic production-persistence comparison with synthetic bank rows.
 * Native SQLCipher, provider IO, parsing, React and phone speed are NOT timed.
 * Pass an immutable prior module path to --baseline (e.g. build 132's file).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const load = require('./load-typescript.cjs');
const baselineIndex = process.argv.indexOf('--baseline');
if (baselineIndex < 0 || !process.argv[baselineIndex + 1]) {
  throw new Error('Usage: node scripts/test/repair/history-storage-benchmark.cjs --baseline /path/to/prior/ledger-persistence.ts');
}
const prior = path.resolve(process.argv[baselineIndex + 1]);
const current = path.resolve(__dirname, '../../../src/lib/ledger-persistence.ts');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const KEY = 'synthetic-ledger';
const CHUNK_SIZE = 400;
const PAGE_SIZE = 1000;

async function run(file, rows, reopenEvery = 0) {
  const { createLedgerPersistence } = load(file);
  const data = new Map();
  let chunkWrites = 0, chunkBytes = 0, metadataBytes = 0, saveCalls = 0;
  const storage = {
    async getItem(key) { return data.get(key) ?? null; },
    async multiGet(keys) { return keys.map(key => [key, data.get(key) ?? null]); },
    async multiSet(entries) {
      saveCalls++;
      for (const [key, value] of entries) {
        if (key === KEY) metadataBytes += Buffer.byteLength(value);
        else { chunkWrites++; chunkBytes += Buffer.byteLength(value); }
        data.set(key, value);
      }
    },
    async multiRemove(keys) { for (const key of keys) data.delete(key); },
    async destroy() { data.clear(); },
  };
  function chunkTransactions(transactions) {
    const out = [];
    for (let end = transactions.length; end > 0; end -= CHUNK_SIZE) {
      out.push(JSON.stringify(transactions.slice(Math.max(0, end - CHUNK_SIZE), end)));
    }
    return out;
  }
  const make = () => createLedgerPersistence({
    prefix: KEY, chunkSize: CHUNK_SIZE, currentChunkOrder: 'oldest-first',
    chunkTransactions, storage, migrateLegacyState: async () => false,
  });
  let engine = make();
  await engine.load();
  const started = performance.now();
  let last;
  for (let count = PAGE_SIZE; count <= rows.length; count += PAGE_SIZE) {
    const transactions = rows.slice(0, count);
    last = { hydrated: true, onboarded: true, transactions,
      historyImport: { status: 'running', cursor: { beforeDateMs: rows[count - 1].ts, beforeId: 100000 - count },
        scanned: count, found: count, startedAt: 1, updatedAt: count, error: null } };
    assert.equal(await engine.save(last), true);
    if (reopenEvery && count % reopenEvery === 0) {
      engine = make();
      const loaded = await engine.load();
      assert.equal(digest(JSON.stringify(loaded.transactions)), digest(JSON.stringify(transactions)));
      assert.equal(loaded.historyImport.scanned, count);
    }
  }
  // Include the final empty provider page and its one-time layout conversion.
  await engine.save({ ...last, historyImport: { ...last.historyImport, status: 'complete', cursor: null } });
  const cpuAndMemoryMs = performance.now() - started;
  const loaded = await make().load();
  const outputHash = digest(JSON.stringify(loaded.transactions));
  assert.equal(outputHash, digest(JSON.stringify(rows)));
  assert.equal(loaded.historyImport.status, 'complete');
  assert.equal(loaded.historyImport.cursor, null);
  assert.equal(JSON.parse(data.get(KEY)).txChunkOrder, 'oldest-first');
  return { chunkWrites, chunkBytes, metadataBytes, saveCalls, cpuAndMemoryMs: Math.round(cpuAndMemoryMs), outputHash };
}

(async () => {
  const measurements = [];
  for (const count of [10000, 25000, 50000]) {
    const rows = Array.from({ length: count }, (_, i) => ({
      id: `synthetic-${i}`, date: '2026-09-07', ts: 1788768000000 - i * 60000,
      source: 'sms', title: `Synthetic merchant ${i % 20}`, accountId: `synthetic-bank-${i % 3}`,
      type: 'expense', category: 'groceries', amountFils: 1000 + i, currency: 'AED',
    }));
    const before = await run(prior, rows);
    const after = await run(current, rows);
    assert.equal(before.outputHash, after.outputHash);
    assert.equal(before.saveCalls, after.saveCalls);
    measurements.push({ transactions: count, before, after,
      writeReductionPercent: +(100 * (1 - after.chunkWrites / before.chunkWrites)).toFixed(2),
      byteReductionPercent: +(100 * (1 - after.chunkBytes / before.chunkBytes)).toFixed(2),
    });
  }
  const restartRows = Array.from({ length: 10000 }, (_, i) => ({ id: `resume-${i}`, ts: 1788768000000 - i, amountFils: i + 1 }));
  const restart = { before: await run(prior, restartRows, 2000), after: await run(current, restartRows, 2000) };
  console.log(JSON.stringify({
    scope: 'Actual persistence module; synthetic records; memory adapter. Counts bytes passed to storage, not native IO, SQLCipher time, parser throughput or phone speed.',
    sourceSha256: { before: digest(fs.readFileSync(prior)), after: digest(fs.readFileSync(current)) },
    chunkSize: CHUNK_SIZE, pageSize: PAGE_SIZE, finalConversionIncluded: true,
    measurements, processRestartEvery2000: restart,
  }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
