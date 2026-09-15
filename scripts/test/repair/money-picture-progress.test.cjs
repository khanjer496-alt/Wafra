'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { harness, walk, text } = require('./journal-harness.cjs');

const root = path.resolve(__dirname, '../../..');
const progress = load(path.join(root, 'src/lib/money-picture-progress.ts'));
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 16, 12);

test('money picture is a seven-day surface, not a permanent Home widget', () => {
  assert.ok(progress.moneyPictureProgress({
    nowMs: NOW, trialStartTs: NOW - 6 * DAY, history: null,
    transactionCount: 0, activeAccountCount: 0, obligationCount: 0, captureReady: false,
  }));
  assert.equal(progress.moneyPictureProgress({
    nowMs: NOW, trialStartTs: NOW - 7 * DAY, history: null,
    transactionCount: 100, activeAccountCount: 4, obligationCount: 8, captureReady: true,
  }), null);
});

test('money picture reflects durable import state without inventing a percentage', () => {
  const model = progress.moneyPictureProgress({
    nowMs: NOW, trialStartTs: NOW - DAY,
    history: { status: 'running', scanned: 1234, found: 57, cursor: null, startedAt: NOW - 1000, updatedAt: NOW, error: null },
    transactionCount: 43, activeAccountCount: 2, obligationCount: 5, captureReady: true,
  });
  assert.equal(JSON.stringify(model), JSON.stringify({
    state: 'building', transactionCount: 43, activeAccountCount: 2, obligationCount: 5,
    historyScanned: 1234, historyFound: 57,
  }));
});

test('completed history retires the first-week card immediately', () => {
  assert.equal(progress.moneyPictureProgress({
    nowMs: NOW, trialStartTs: NOW - DAY,
    history: { status: 'complete', scanned: 29919, found: 15518, cursor: null, startedAt: NOW - 1000, updatedAt: NOW, error: null },
    transactionCount: 14866, activeAccountCount: 44, obligationCount: 12, captureReady: true,
  }), null);
});

test('manual first real activity retires the card instead of keeping a ready state for seven days', () => {
  assert.equal(progress.moneyPictureProgress({
    nowMs: NOW, trialStartTs: NOW - DAY, history: null,
    transactionCount: 1, activeAccountCount: 1, obligationCount: 0, captureReady: false,
  }), null);
});

test('first-week Home replaces the duplicate history banner with one money-picture surface', () => {
  const now = Date.now();
  const h = harness({
    trialStartTs: now,
    history: { status: 'running', scanned: 1234, found: 57, cursor: null, startedAt: now, updatedAt: now, error: null },
  });
  const picture = walk(h.tree).find((node) => node.props?.testID === 'money-picture-progress');
  assert.ok(picture);
  assert.match(text(picture), /1,234/);
  assert.match(text(picture), /57/);
  assert.doesNotMatch(text(picture), /%|ETA|\d+ of \d+/i);
  assert.equal(walk(h.tree).filter((node) => node.props?.testID === 'history-reading-status').length, 0);
});

test('after the first week an unfinished history import keeps the existing recovery surface', () => {
  const now = Date.now();
  const h = harness({
    trialStartTs: now - 8 * DAY,
    history: { status: 'paused', scanned: 50, found: 8, cursor: null, startedAt: now - DAY, updatedAt: now, error: null },
  });
  assert.equal(walk(h.tree).filter((node) => node.props?.testID === 'money-picture-progress').length, 0);
  assert.equal(walk(h.tree).filter((node) => node.props?.testID === 'history-reading-status').length, 1);
});
