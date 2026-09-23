'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const load = require('./load-typescript.cjs');
const { createLedgerPersistence } = load(path.resolve(__dirname, '../../../src/lib/ledger-persistence.ts'));
const KEY = 'wafra/inline-migration-test';
const CHUNK_SIZE = 400;
const rows = count => Array.from({ length: count }, (_, index) => ({
  id: `fixture-${index}`, date: '2026-09-19', ts: 2_000_000 - index,
  amountFils: index + 1, title: 'Synthetic purchase', source: 'sms',
  accountId: 'fixture', type: 'expense', category: 'other',
}));
const plain = value => JSON.parse(JSON.stringify(value));

function harness(count, order, staleChunks = false) {
  const original = rows(count);
  const disk = new Map([[KEY, JSON.stringify({
    transactions: original, txChunks: 0, historyImport: null,
    ...(order ? { txChunkOrder: order } : {}),
  })]]);
  if (staleChunks) {
    for (let index = 0; index < Math.ceil(count / CHUNK_SIZE); index++) {
      disk.set(`${KEY}:tx:${index}`, JSON.stringify([{ ...original[0], id: `stale-${index}`, amountFils: 999_999 }]));
    }
  }
  const writes = [];
  let failNextWrite = false;
  const storage = {
    async getItem(key) { return disk.get(key) ?? null; },
    async multiGet(keys) { return keys.map(key => [key, disk.get(key) ?? null]); },
    async multiSet(entries) {
      writes.push(entries.map(([key]) => key));
      if (failNextWrite) { failNextWrite = false; throw new Error('injected atomic write failure'); }
      for (const [key, value] of entries) disk.set(key, value);
    },
    async multiRemove(keys) { for (const key of keys) disk.delete(key); },
    async destroy() { disk.clear(); },
  };
  const make = () => createLedgerPersistence({
    prefix: KEY, chunkSize: CHUNK_SIZE, currentChunkOrder: 'oldest-first', storage,
    migrateLegacyState: async () => false,
    chunkTransactions(transactions) {
      const chunks = [];
      for (let end = transactions.length; end > 0; end -= CHUNK_SIZE) {
        chunks.push(JSON.stringify(transactions.slice(Math.max(0, end - CHUNK_SIZE), end)));
      }
      return chunks;
    },
  });
  return { original, make, disk, writes,
    failNextWrite() { failNextWrite = true; },
    chunksWritten: () => writes.at(-1).filter(key => key !== KEY) };
}

for (const editNewest of [false, true]) {
  test(`3,113 inline rows survive ${editNewest ? 'newest-row classification' : 'metadata-only save'} and reopening`, async () => {
    const h = harness(3_113, 'oldest-first');
    const persistence = h.make();
    const loaded = await persistence.load();
    const transactions = editNewest
      ? loaded.transactions.map((row, index) => index === 0 ? { ...row, transferDecision: { ownership: 'own' } } : row)
      : loaded.transactions;
    assert.equal(await persistence.save({ ...loaded, transactions, hydrated: true, userName: 'Changed' }), true);
    const reopened = await h.make().load();
    assert.equal(reopened.transactions.length, 3_113);
    assert.deepEqual(plain(reopened.transactions), plain(transactions), 'all IDs, amounts, order and decisions survive');
    assert.equal(h.chunksWritten().length, 8, 'inline rows have no durable chunk baseline');
  });
}

for (const order of [undefined, 'oldest-first', 'newest-first']) {
  for (const editNewest of [false, true]) {
    test(`${order ?? 'unmarked legacy'} inline state: ${editNewest ? 'row edit' : 'metadata save'} preserves boundary-sized ledgers and supersedes stale chunks`, async () => {
      for (const count of [0, 1, 399, 400, 401, 3_113]) {
        for (const staleChunks of [false, true]) {
          const h = harness(count, order, staleChunks);
          const persistence = h.make();
          const loaded = await persistence.load();
          assert.deepEqual(plain(loaded.transactions), h.original, 'inline rows are authoritative over stale chunk keys');
          const transactions = editNewest
            ? loaded.transactions.map((row, index) => index === 0 ? { ...row, title: 'Edited' } : row)
            : loaded.transactions;
          await persistence.save({ ...loaded, transactions, hydrated: true, userName: 'Changed' });
          const reopened = await h.make().load();
          assert.equal(reopened.transactions.length, count, `count=${count}, stale=${staleChunks}`);
          assert.deepEqual(plain(reopened.transactions), plain(transactions));
          assert.equal(h.chunksWritten().length, Math.ceil(count / CHUNK_SIZE));
          assert.equal(JSON.parse(h.disk.get(KEY)).transactions, undefined, 'conversion uses the chunk contract');
        }
      }
    });
  }
}

test('after inline conversion, metadata and single-row saves retain ordinary chunk caching', async () => {
  const h = harness(3_113, 'oldest-first');
  const first = h.make();
  const inline = await first.load();
  await first.save({ ...inline, hydrated: true });
  const reopened = h.make();
  const loaded = await reopened.load();
  await reopened.save({ ...loaded, hydrated: true, userName: 'Changed' });
  assert.equal(h.chunksWritten().length, 0);
  const transactions = loaded.transactions.map((row, index) => index === 0 ? { ...row, title: 'Edited' } : row);
  await reopened.save({ ...loaded, transactions, hydrated: true });
  assert.equal(h.chunksWritten().length, 1);
  assert.deepEqual(plain((await h.make().load()).transactions), plain(transactions));
});

test('failed inline conversion preserves the original snapshot and retries every chunk', async () => {
  for (const order of [undefined, 'oldest-first', 'newest-first']) {
    for (const staleChunks of [false, true]) {
      const h = harness(3_113, order, staleChunks);
      const persistence = h.make();
      const loaded = await persistence.load();
      const snapshot = { ...loaded, hydrated: true, userName: 'Changed' };
      const before = [...h.disk];
      h.failNextWrite();
      await assert.rejects(persistence.save(snapshot), /injected atomic write failure/);
      assert.deepEqual([...h.disk], before);
      assert.deepEqual(plain((await h.make().load()).transactions), h.original);
      assert.equal(await persistence.save(snapshot), true);
      assert.equal(h.chunksWritten().length, 8);
      assert.deepEqual(plain((await h.make().load()).transactions), h.original);
    }
  }
});
