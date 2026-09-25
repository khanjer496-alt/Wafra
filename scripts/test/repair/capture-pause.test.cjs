'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const pause = load(path.join(root, 'src/lib/capture-pause.ts'));
const { detectCapturePause, DAY_MS } = pause;
const HOUR = 3_600_000;
const NOW = Date.parse('2026-09-25T09:00:00Z');

/** Captures every `stepMs` from `startAgoMs` until `endAgoMs` before NOW. */
function series(startAgoMs, endAgoMs, stepMs) {
  const out = [];
  for (let ago = startAgoMs; ago >= endAgoMs; ago -= stepMs) out.push(NOW - ago);
  return out;
}

test('no verdict without enough history or captures', () => {
  assert.equal(detectCapturePause({ captureTimes: [], nowMs: NOW, snoozedAtMs: null }), null);
  // Plenty of captures, but only ten days of them: a new user has no usual yet.
  assert.equal(detectCapturePause({ captureTimes: series(10 * DAY_MS, 5 * DAY_MS, 4 * HOUR), nowMs: NOW, snoozedAtMs: null }), null);
  // A long span but only five captures.
  assert.equal(detectCapturePause({ captureTimes: series(40 * DAY_MS, 8 * DAY_MS, 8 * DAY_MS), nowMs: NOW, snoozedAtMs: null }), null);
});

test('several texts a day: three quiet days is not yet stopped, four is', () => {
  const quiet2 = detectCapturePause({ captureTimes: series(30 * DAY_MS, 2 * DAY_MS, 6 * HOUR), nowMs: NOW, snoozedAtMs: null });
  assert.equal(quiet2.stopped, false);
  assert.equal(quiet2.rhythm, 'several-a-day');
  assert.equal(quiet2.thresholdMs, 3 * DAY_MS, 'the three-day floor applies to frequent captures');
  const quiet3 = detectCapturePause({ captureTimes: series(30 * DAY_MS, 3 * DAY_MS, 6 * HOUR), nowMs: NOW, snoozedAtMs: null });
  assert.equal(quiet3.stopped, false, 'exactly the threshold is not beyond it');
  const quiet4 = detectCapturePause({ captureTimes: series(30 * DAY_MS, 4 * DAY_MS, 6 * HOUR), nowMs: NOW, snoozedAtMs: null });
  assert.equal(quiet4.stopped, true);
  assert.equal(quiet4.silentDays, 4);
});

test('an infrequent rhythm needs three times its usual gap', () => {
  const everyThree = (lastAgo) => detectCapturePause({ captureTimes: series(60 * DAY_MS, lastAgo, 3 * DAY_MS), nowMs: NOW, snoozedAtMs: null });
  const eight = everyThree(8 * DAY_MS);
  assert.equal(eight.rhythm, 'every-few-days');
  assert.equal(eight.thresholdMs, 9 * DAY_MS);
  assert.equal(eight.stopped, false, 'eight days is under three usual gaps');
  assert.equal(everyThree(11 * DAY_MS).stopped, true);
});

test('one daily capture reads as about daily; bursts do not shrink the rule below three days', () => {
  const daily = detectCapturePause({ captureTimes: series(40 * DAY_MS, DAY_MS, DAY_MS), nowMs: NOW, snoozedAtMs: null });
  assert.equal(daily.rhythm, 'about-daily');
  assert.equal(daily.stopped, false);
  const burst = [...series(30 * DAY_MS, 5 * DAY_MS, DAY_MS), ...series(30 * DAY_MS, 5 * DAY_MS, DAY_MS).map((ms) => ms + 60_000)];
  const verdict = detectCapturePause({ captureTimes: burst, nowMs: NOW, snoozedAtMs: null });
  assert.equal(verdict.thresholdMs, 3 * DAY_MS);
  assert.equal(verdict.stopped, true);
});

test('"I was away" restarts the clock from the snooze, and only a later snooze counts', () => {
  const captures = series(30 * DAY_MS, 6 * DAY_MS, 6 * HOUR);
  assert.equal(detectCapturePause({ captureTimes: captures, nowMs: NOW, snoozedAtMs: null }).stopped, true);
  const snoozedToday = detectCapturePause({ captureTimes: captures, nowMs: NOW, snoozedAtMs: NOW - HOUR });
  assert.equal(snoozedToday.stopped, false);
  assert.equal(snoozedToday.silentDays, 6, 'the reported silence is still measured from the last capture');
  assert.equal(detectCapturePause({ captureTimes: captures, nowMs: NOW, snoozedAtMs: NOW - 4 * DAY_MS }).stopped, true,
    'silence continuing past the threshold after the snooze shows the notice again');
  assert.equal(detectCapturePause({ captureTimes: captures, nowMs: NOW, snoozedAtMs: NOW - 20 * DAY_MS }).stopped, true,
    'a snooze older than the last capture is ignored');
  assert.equal(detectCapturePause({ captureTimes: captures, nowMs: NOW, snoozedAtMs: NOW + DAY_MS }).stopped, true,
    'a snooze in the future is ignored');
});

test('future-dated and invalid timestamps are not evidence of a recent capture', () => {
  const captures = [...series(30 * DAY_MS, 5 * DAY_MS, 6 * HOUR), NOW + 5 * DAY_MS, NaN, -1];
  const verdict = detectCapturePause({ captureTimes: captures, nowMs: NOW, snoozedAtMs: null });
  assert.equal(verdict.stopped, true);
  assert.equal(verdict.lastCaptureMs, NOW - 5 * DAY_MS);
  assert.equal(detectCapturePause({ captureTimes: captures, nowMs: NaN, snoozedAtMs: null }), null);
});
