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


test('manual first-run hides both import surfaces in EN/AR and light/dark', () => {
  const now = Date.now();
  for (const language of ['en', 'ar']) for (const theme of ['light', 'dark']) {
    for (const history of [null, { status: 'paused', scanned: 0, found: 0, cursor: null, startedAt: now, updatedAt: now, error: null }]) {
      const h = harness({ empty: true, accounts: [], optOut: true, trialStartTs: now, history, language, theme });
      assert.equal(walk(h.tree).filter(node => ['money-picture-progress', 'history-reading-status'].includes(node.props?.testID)).length, 0);
    }
  }
});

test('notification-only capture does not advertise an SMS history import, but enabled SMS retains recovery', () => {
  const now = Date.now();
  const history = { status: 'paused', scanned: 0, found: 0, cursor: null, startedAt: now, updatedAt: now, error: null };
  for (const sms of [false, true]) {
    const h = harness({ empty: true, trialStartTs: now, history, androidCaptureSources: { sms, notifications: true } });
    assert.equal(walk(h.tree).filter(node => node.props?.testID === 'money-picture-progress').length, sms ? 1 : 0);
    assert.equal(walk(h.tree).filter(node => node.props?.testID === 'history-reading-status').length, 0);
  }
});


test('manual users also hide an older saved import without deleting its progress', () => {
  const now = Date.now();
  const history = { status: 'paused', scanned: 50, found: 8, cursor: null, startedAt: now - DAY, updatedAt: now, error: null };
  const h = harness({ optOut: true, trialStartTs: now - 8 * DAY, history });
  assert.equal(walk(h.tree).filter(node => ['money-picture-progress', 'history-reading-status'].includes(node.props?.testID)).length, 0);
  assert.equal(history.scanned, 50); assert.equal(history.found, 8); assert.equal(history.status, 'paused');
});


test('legacy Android installs with absent per-source settings retain saved import recovery', () => {
  const now = Date.now();
  const h = harness({ androidCaptureSources: undefined, trialStartTs: now,
    history: { status: 'paused', scanned: 50, found: 8, cursor: null, startedAt: now, updatedAt: now, error: null },
  });
  assert.equal(walk(h.tree).filter(node => node.props?.testID === 'money-picture-progress').length, 1);
});


test('notification-only first week keeps generic setup for empty or disabled SMS history', () => {
  const now = Date.now();
  const paused = { status: 'paused', scanned: 0, found: 0, cursor: null, startedAt: now, updatedAt: now, error: null };
  for (const language of ['en', 'ar']) for (const theme of ['light', 'dark']) for (const history of [null, paused]) {
    const h = harness({ empty: true, accounts: [], trialStartTs: now, history,
      androidCaptureSources: { sms: false, notifications: true }, captureState: 'waiting-for-alert', language, theme,
    });
    const pictures = walk(h.tree).filter(node => node.props?.testID === 'money-picture-progress');
    assert.equal(pictures.length, 1, 'notification capture keeps the first-week money picture');
    assert.match(text(pictures[0]), /moneyPictureBuilding/);
    assert.doesNotMatch(text(pictures[0]), /moneyPictureMessagesChecked|moneyPictureSaved/);
    assert.equal(walk(h.tree).filter(node => node.props?.testID === 'history-reading-status').length, 0);
    assert.equal(walk(h.tree).filter(node => node.props?.testID === 'journal-import-controls').length, 1,
      'first-week setup keeps capture visible even when its saved section preference is hidden');
    const hint = walk(h.tree).find(node => node.type === 'WidgetsHint');
    assert.equal(hint?.props.firstDays, true);
  }
});
