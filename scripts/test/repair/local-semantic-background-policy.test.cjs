'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const source = path.resolve(__dirname, '../../../src/lib/local-semantic-background-policy.ts');

test('headless/inactive work is refused, and returning active never revives an old job', () => {
  const p = load(source);
  assert.equal(p.localSemanticBackgroundCancellation()(), true);
  p.setLocalSemanticAppActive(true);
  const old = p.localSemanticBackgroundCancellation();
  assert.equal(old(), false);
  p.setLocalSemanticAppActive(false);
  assert.equal(old(), true);
  p.setLocalSemanticAppActive(true);
  assert.equal(old(), true);
  assert.equal(p.localSemanticBackgroundCancellation()(), false);
});

test('ledger reset synchronously releases registered queues and invalidates only previous work', () => {
  const p = load(source);
  p.setLocalSemanticAppActive(true);
  const old = p.localSemanticBackgroundCancellation();
  let released = 0;
  const unsubscribe = p.onLocalSemanticBackgroundCancelled(() => released++);
  p.cancelLocalSemanticBackgroundWork();
  assert.equal(released, 1);
  assert.equal(old(), true);
  assert.equal(p.localSemanticBackgroundCancellation()(), false);
  unsubscribe();
  p.cancelLocalSemanticBackgroundWork();
  assert.equal(released, 1);
});

test('optional preparation cancelled during download cannot proceed to its next heavy phase', async () => {
  const timers = [];
  const p = load(source, {}, {setTimeout: callback => { timers.push(callback); return 1; }});
  p.setLocalSemanticAppActive(true);
  const cancelled = p.localSemanticBackgroundCancellation();
  let idleChecks = 0;
  const checkpoint = p.waitForLocalSemanticPreparation(cancelled, async () => { idleChecks++; });
  const rejected = assert.rejects(checkpoint, /cancelled/);
  p.setLocalSemanticAppActive(false);
  timers.shift()();
  await rejected;
  assert.equal(idleChecks, 0);
});

test('optional preparation rechecks cancellation after a navigation idle wait', async () => {
  const p = load(source, {}, {setTimeout: callback => { callback(); return 1; }});
  p.setLocalSemanticAppActive(true);
  const cancelled = p.localSemanticBackgroundCancellation();
  await assert.rejects(p.waitForLocalSemanticPreparation(cancelled, async () => {
    p.cancelLocalSemanticBackgroundWork();
  }), /cancelled/);
});

test('interactive joins promote an idle-blocked optional preparation without a second session', async () => {
  const p = load(source, {}, {setTimeout: callback => { callback(); return 1; }});
  p.setLocalSemanticAppActive(true);
  let idleEntered;
  const entered = new Promise(resolve => { idleEntered = resolve; });
  let releaseIdle;
  const idle = new Promise(resolve => { releaseIdle = resolve; });
  let starts = 0;
  let heavyWork = 0;
  const flight = p.createLocalSemanticPreparationFlight(async controller => {
    starts++;
    await controller.checkpoint();
    heavyWork++;
    return 'one-session';
  }, () => { idleEntered(); return idle; });
  const optional = flight.get(true);
  await entered;
  assert.equal(heavyWork, 0);
  assert.equal(await flight.get(false), 'one-session');
  assert.equal(await optional, 'one-session');
  assert.equal(starts, 1);
  assert.equal(heavyWork, 1);
  releaseIdle();
});

test('interactive join retries an already-cancelled optional attempt only after it settles', async () => {
  const p = load(source, {}, {setTimeout: callback => { callback(); return 1; }});
  p.setLocalSemanticAppActive(true);
  let rejectionReady;
  const reached = new Promise(resolve => { rejectionReady = resolve; });
  let settle;
  const settling = new Promise(resolve => { settle = resolve; });
  let starts = 0;
  let active = 0;
  let maximum = 0;
  const flight = p.createLocalSemanticPreparationFlight(async controller => {
    starts++; active++; maximum = Math.max(maximum, active);
    try {
      if (starts === 1) {
        p.cancelLocalSemanticBackgroundWork();
        try { await controller.checkpoint(); } catch (error) {
          rejectionReady(); await settling; throw error;
        }
      }
      await controller.checkpoint();
      return 'interactive-session';
    } finally { active--; }
  }, async () => {});
  const optional = flight.get(true);
  const rejected = assert.rejects(optional, /cancelled/);
  await reached;
  const interactive = flight.get(false);
  assert.equal(starts, 1);
  settle();
  await rejected;
  assert.equal(await interactive, 'interactive-session');
  assert.equal(starts, 2);
  assert.equal(maximum, 1);
});

test('failed artifact cannot release single-flight while another artifact is still writing', async () => {
  const p = load(source);
  p.setLocalSemanticAppActive(true);
  let releaseWriter;
  const writing = new Promise(resolve => { releaseWriter = resolve; });
  let rejectedArtifact;
  const rejectionObserved = new Promise(resolve => { rejectedArtifact = resolve; });
  let starts = 0;
  let writerFinished = false;
  const flight = p.createLocalSemanticPreparationFlight(async controller => {
    starts++;
    if (starts === 1) {
      p.cancelLocalSemanticBackgroundWork();
      const failed = controller.checkpoint().catch(error => { rejectedArtifact(); throw error; });
      return p.settleLocalSemanticArtifacts([failed, writing.then(() => { writerFinished = true; return 'old-artifact'; })]);
    }
    assert.equal(writerFinished, true, 'old artifact writer must settle before retry');
    return ['new-artifacts'];
  }, async () => {});
  const optional = flight.get(true);
  let firstSettled = false;
  const rejected = assert.rejects(optional, /cancelled/).then(() => { firstSettled = true; });
  await rejectionObserved;
  const interactive = flight.get(false);
  await Promise.resolve();
  assert.equal(starts, 1);
  assert.equal(firstSettled, false);
  releaseWriter();
  await rejected;
  assert.deepEqual(await interactive, ['new-artifacts']);
  assert.equal(starts, 2);
});

test('artifact settlement preserves ordering and waits for siblings on a network failure', async () => {
  const p = load(source);
  let finish;
  const slow = new Promise(resolve => { finish = resolve; });
  let settled = false;
  const expected = new Error('download failed');
  const batch = p.settleLocalSemanticArtifacts([Promise.reject(expected), slow]);
  const rejected = assert.rejects(batch, error => error === expected).then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  finish('tokenizer');
  await rejected;
  assert.deepEqual(Array.from(await p.settleLocalSemanticArtifacts([Promise.resolve('model'), Promise.resolve('tokenizer')])), ['model', 'tokenizer']);
});
