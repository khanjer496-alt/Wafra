'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const load = require('./load-typescript.cjs');
const source = path.resolve(__dirname, '../../../src/lib/local-semantic-scheduler.ts');
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

test('interactive inference runs before queued background work, never concurrently', async () => {
  const { createLocalSemanticScheduler } = load(source);
  const schedule = createLocalSemanticScheduler();
  const first = deferred();
  const order = [];
  const a = schedule(async () => { order.push('running'); await first.promise; return 1; }, { priority: 'background' });
  const b = schedule(async () => { order.push('background'); return 2; }, { priority: 'background' });
  const c = schedule(async () => { order.push('question'); return 3; });
  assert.deepEqual(order, ['running']);
  first.resolve();
  assert.deepEqual(await Promise.all([a, b, c]), [1, 2, 3]);
  assert.deepEqual(order, ['running', 'question', 'background']);
});

test('cancelled queued work never enters inference', async () => {
  const { createLocalSemanticScheduler } = load(source);
  const schedule = createLocalSemanticScheduler();
  const first = deferred();
  const active = schedule(() => first.promise);
  let cancelled = false;
  let calls = 0;
  const queued = schedule(async () => { calls++; }, { cancelled: () => cancelled });
  const rejected = assert.rejects(queued, /cancelled/);
  cancelled = true;
  first.resolve();
  await active;
  await rejected;
  assert.equal(calls, 0);
});

test('one inference failure does not block the next question', async () => {
  const { createLocalSemanticScheduler } = load(source);
  const schedule = createLocalSemanticScheduler();
  const failed = schedule(async () => { throw new Error('session failed'); });
  const next = schedule(async () => 7);
  await assert.rejects(failed, /session failed/);
  assert.equal(await next, 7);
});

test('bounded queue refuses excess work without retaining another closure', async () => {
  const { createLocalSemanticScheduler } = load(source);
  const schedule = createLocalSemanticScheduler(2);
  const first = deferred();
  const active = schedule(() => first.promise);
  const queued = [schedule(async () => 1), schedule(async () => 2)];
  await assert.rejects(schedule(async () => 3), /queue-full/);
  first.resolve();
  await active;
  assert.deepEqual(await Promise.all(queued), [1, 2]);
});

test('navigation-blocked background work does not hold the session ahead of interactive work', async () => {
  const timers = [];
  const { createLocalSemanticScheduler } = load(source, {}, { setTimeout: callback => { timers.push(callback); return 1; } });
  let blocked = 900;
  const schedule = createLocalSemanticScheduler(32, { backgroundBlockedFor: () => blocked });
  const order = [];
  const background = schedule(async () => { order.push('background'); }, {priority: 'background'});
  assert.deepEqual(order, []);
  await schedule(async () => { order.push('interactive'); });
  assert.deepEqual(order, ['interactive']);
  blocked = 0;
  timers.shift()();
  await background;
  assert.deepEqual(order, ['interactive', 'background']);
});

test('cancelled background job is discarded during navigation without entering native work', async () => {
  const timers = [];
  const { createLocalSemanticScheduler } = load(source, {}, { setTimeout: callback => { timers.push(callback); return 1; } });
  const schedule = createLocalSemanticScheduler(32, { backgroundBlockedFor: () => 900 });
  let cancelled = false;
  let calls = 0;
  const background = schedule(async () => { calls++; }, {priority: 'background', cancelled: () => cancelled});
  const rejected = assert.rejects(background, /cancelled/);
  cancelled = true;
  timers.shift()();
  await rejected;
  assert.equal(calls, 0);
});
