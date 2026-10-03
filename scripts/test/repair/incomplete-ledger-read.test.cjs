'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { createLedgerPersistence } = load(path.resolve(__dirname, '../../../src/lib/ledger-persistence.ts'));
const key = 'test-ledger';
const complete = () => new Map([
  [key, JSON.stringify({ txChunks: 2, txChunkOrder: 'oldest-first', onboarded: true })],
  [`${key}:tx:0`, JSON.stringify([{ id: 'older' }])],
  [`${key}:tx:1`, JSON.stringify([{ id: 'newer' }])],
]);
function harness(disk, batch = keys => keys.map(k => [k, disk.get(k) ?? null])) {
  let writes = 0;
  const persistence = createLedgerPersistence({
    prefix: key, chunkSize: 1, currentChunkOrder: 'oldest-first',
    chunkTransactions: rows => [...rows].reverse().map(row => JSON.stringify([row])),
    migrateLegacyState: async () => false,
    storage: {
      getItem: async k => disk.get(k) ?? null,
      multiGet: async keys => batch(keys),
      multiSet: async entries => { writes++; for (const [k, value] of entries) disk.set(k, value); },
      multiRemove: async keys => { writes++; keys.forEach(k => disk.delete(k)); },
      destroy: async () => { writes++; disk.clear(); },
    },
  });
  return { persistence, writes: () => writes };
}

for (const [name, damage] of [
  ['missing chunk', disk => disk.delete(`${key}:tx:0`)],
  ['empty declared chunk', disk => disk.set(`${key}:tx:0`, '[]')],
  ['invalid chunk JSON', disk => disk.set(`${key}:tx:0`, '{')],
  ['non-array chunk', disk => disk.set(`${key}:tx:0`, '{}')],
  ['fractional count', disk => disk.set(key, JSON.stringify({ txChunks: 1.5 }))],
  ['negative count', disk => disk.set(key, JSON.stringify({ txChunks: -1 }))],
  ['string count', disk => disk.set(key, JSON.stringify({ txChunks: '2' }))],
  ['null count', disk => disk.set(key, JSON.stringify({ txChunks: null }))],
  ['unknown chunk order', disk => disk.set(key, JSON.stringify({ txChunks: 2, txChunkOrder: 'unknown' }))],
  ['missing current-layout count', disk => disk.set(key, JSON.stringify({ txChunkOrder: 'oldest-first' }))],
  ['invalid inline rows', disk => disk.set(key, JSON.stringify({ transactions: {} }))],
  ['array metadata', disk => disk.set(key, '[]')],
  ['scalar metadata', disk => disk.set(key, 'true')],
  ['empty metadata body', disk => disk.set(key, '')],
]) test(`${name} refuses hydration and cannot overwrite the retained ledger`, async () => {
  const disk = complete(); damage(disk);
  const before = [...disk];
  const h = harness(disk);
  await assert.rejects(h.persistence.load(), /corrupt ledger snapshot/i);
  assert.equal(await h.persistence.save({ hydrated: true, transactions: [], onboarded: false }), false);
  assert.equal(h.writes(), 0);
  assert.deepEqual([...disk], before);
});

test('an incomplete native batch is a failed read, not a smaller ledger', async () => {
  const disk = complete();
  const h = harness(disk, keys => [[keys[0], disk.get(keys[0])]]);
  await assert.rejects(h.persistence.load(), /corrupt ledger snapshot/i);
  assert.equal(await h.persistence.save({ transactions: [] }), false);
  assert.equal(h.writes(), 0);
});

test('retry reopens writes only when every retained chunk can be read', async () => {
  const disk = complete();
  const retained = disk.get(`${key}:tx:0`);
  disk.delete(`${key}:tx:0`);
  const h = harness(disk);
  await assert.rejects(h.persistence.load());
  disk.set(`${key}:tx:0`, retained);
  const loaded = await h.persistence.load();
  assert.deepEqual(Array.from(loaded.transactions, row => row.id), ['newer', 'older']);
  assert.equal(await h.persistence.save({ ...loaded, hydrated: true }), true);
});

test('native batch order does not change ledger chronology', async () => {
  const disk = complete();
  const h = harness(disk, keys => [...keys].reverse().map(k => [k, disk.get(k)]));
  const loaded = await h.persistence.load();
  assert.deepEqual(Array.from(loaded.transactions, row => row.id), ['newer', 'older']);
});

test('a genuinely empty store and legacy inline snapshot remain readable', async () => {
  assert.equal(await harness(new Map()).persistence.load(), null);
  const h = harness(new Map([[key, JSON.stringify({ transactions: [{ id: 'inline' }] })]]));
  assert.equal((await h.persistence.load()).transactions[0].id, 'inline');
  assert.equal(await h.persistence.save({ transactions: [{ id: 'inline' }] }), true);
});
