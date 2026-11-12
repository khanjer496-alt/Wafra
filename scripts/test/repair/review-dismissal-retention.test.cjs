'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { source, tray, payment, storeHarness } = require('./retention-harness.cjs');
const key = item => source('lib/capture-source-identity').canonicalCaptureSourceKey(item.sourceKey, item.observedAt);

test('actual failed dismissal rehydrates all fifty; nine durable dismissals permit exactly nine new sources', { timeout: 15000 }, async () => {
  const items = Array.from({ length: 59 }, (_, i) => payment(i)); const h = storeHarness();
  // Models a source-holding caller (History/scan), so strict 'hold-source' admission.
  await h.stage(items, undefined, undefined, 'hold-source').durable;
  h.setWrite(async () => false);
  await assert.rejects(h.dismissDurable(items[0]), /Encrypted review dismissal write failed/);
  assert.equal(h.state.reviewTray.pending.length, 49, 'optimistic memory is not the persisted result');
  assert.equal(h.persisted.reviewTray.pending.length, 50);
  h.rehydrate(); assert.equal(h.state.reviewTray.pending.length, 50);
  assert.equal(h.state.reviewTray.tombstones.length, 0);
  h.setWrite(async () => true);
  for (const item of items.slice(0, 9)) await h.dismissDurable(item);
  assert.equal(h.persisted.reviewTray.pending.length, 41);
  const next = h.stage(items, undefined, undefined, 'hold-source'); assert.equal(next.admitted, 9);
  const receipts = await tray.settleReviewStage(items, next);
  assert.equal(receipts.filter(x => x.outcome === 'resolved').length, 9);
  assert.equal(receipts.filter(x => x.outcome === 'pending').length, 50);
  assert.equal(h.persisted.reviewTray.pending.length, 50);
  for (const item of h.state.reviewTray.pending) {
    const original = items.find(x => key(x) === key(item));
    assert.equal(item.expiresAt, original.expiresAt);
    assert.equal(item.event.amount.value.minorUnits, original.event.amount.value.minorUnits);
  }
});
test('empty-stage durable claims cannot borrow a later failed optimistic review', { timeout: 15000 }, async () => {
  const occupied = Array.from({ length: 50 }, (_, i) => payment(100 + i)); const h = storeHarness(occupied);
  const finishes = []; h.setWrite(() => new Promise(resolve => finishes.push(resolve)));
  const own = h.stage([]);
  h.dismiss(occupied[0]);
  const incoming = payment(0), later = h.stage([incoming]);
  const failed = assert.rejects(later.durable, /Encrypted review-tray write failed/);
  finishes[0](true); await own.durable;
  assert.ok(!own.retainedSourceKeys().includes(key(incoming)));
  finishes[1](false); await failed;
  h.rehydrate(); assert.equal(h.state.reviewTray.pending.length, 50);
  assert.ok(!h.state.reviewTray.pending.some(x => key(x) === key(incoming)));
});
