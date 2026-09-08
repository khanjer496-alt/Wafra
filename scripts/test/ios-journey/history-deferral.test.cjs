'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const load = require('../repair/load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const journey = load(path.join(root, 'src/lib/ios-setup-journey.ts'));

function harness() {
  const values = new Map();
  const storage = {
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
  };
  const progress = load(path.join(root, 'src/lib/ios-message-onboarding.ts'), {
    '@react-native-async-storage/async-storage': storage,
    './ios-history-setup': { isIosHistoryShortcutInstalled: async () => false },
    './ios-setup-journey': journey,
  });
  return { ...progress, storage, values };
}

test('finishing requires live future readiness plus imported history or an explicit future-only choice', async () => {
  assert.equal(typeof journey.canFinishIosMessageSetup, 'function');
  const h = harness();
  const base = await h.loadIosMessageSetupProgress(h.storage);
  for (const historyStatus of ['not-started', 'in-progress', 'complete', 'skipped']) {
    for (const historySkippedForNow of [undefined, false, true]) {
      for (const confirmed of [false, true]) {
        for (const readiness of ['not-added', 'shortcut-proven', 'first-alert-captured']) {
          const progress = { ...base, historyStatus, historySkippedForNow, futureAutomationConfirmed: confirmed };
          const expected = confirmed && readiness !== 'not-added' &&
            (historyStatus === 'complete' || (historyStatus === 'skipped' && historySkippedForNow === true));
          assert.equal(journey.canFinishIosMessageSetup(progress, readiness), expected);
        }
      }
    }
  }
});

test('skip event cannot manufacture future readiness or bypass the automation confirmation', async () => {
  const h = harness();
  const base = await h.loadIosMessageSetupProgress(h.storage);
  for (const [futureAutomationConfirmed, readiness] of [[false, 'shortcut-proven'], [true, 'not-added']]) {
    const current = { ...base, futureStatus: 'complete', futureAutomationConfirmed };
    assert.equal(h.reduceIosMessageSetup(current, { type: 'history-skipped-for-now', readiness }), current);
  }
  const completed = { ...base, futureAutomationConfirmed: true, historyStatus: 'complete' };
  assert.equal(h.reduceIosMessageSetup(completed, { type: 'history-skipped-for-now', readiness: 'shortcut-proven' }), completed);
});

test('explicit deferral survives relaunch without claiming history or first-alert delivery', async () => {
  const h = harness();
  await h.dispatchIosMessageSetup({ type: 'future-shortcut-confirmed' }, h.storage);
  await h.dispatchIosMessageSetup({ type: 'future-automation-confirmed' }, h.storage);
  await h.dispatchIosMessageSetup({ type: 'onboarding-started' }, h.storage);
  await h.dispatchIosMessageSetup({ type: 'history-skipped-for-now', readiness: 'shortcut-proven' }, h.storage);
  const restored = await h.loadIosMessageSetupProgress(h.storage);
  assert.equal(restored.historyStatus, 'skipped');
  assert.equal(restored.historySkippedForNow, true);
  assert.equal(restored.futureAutomationConfirmed, true);
  assert.equal(restored.futureShortcutConfirmed, true);
  assert.equal(restored.returnToOnboarding, true);
  assert.equal(journey.canFinishIosMessageSetup(restored, 'shortcut-proven'), true);
  assert.equal(journey.canFinishIosMessageSetup(restored, 'not-added'), false);
  assert.doesNotMatch(h.values.get(h.IOS_MESSAGE_SETUP_PROGRESS_KEY), /firstCapturedAt|sender|body|sessionId/);
  await h.dispatchIosMessageSetup({ type: 'onboarding-finished' }, h.storage);
  assert.equal((await h.loadIosMessageSetupProgress(h.storage)).historySkippedForNow, true);
});

test('resuming, resetting, completing or dismissing history removes the explicit deferral only', async () => {
  for (const status of ['in-progress', 'not-started', 'complete', 'skipped']) {
    const h = harness();
    await h.dispatchIosMessageSetup({ type: 'future-automation-confirmed' }, h.storage);
    await h.dispatchIosMessageSetup({ type: 'history-shortcut-confirmed' }, h.storage);
    await h.dispatchIosMessageSetup({ type: 'history-skipped-for-now', readiness: 'shortcut-proven' }, h.storage);
    await h.dispatchIosMessageSetup({ type: 'history-status-changed', status }, h.storage);
    const restored = await h.loadIosMessageSetupProgress(h.storage);
    assert.equal(restored.historySkippedForNow, undefined);
    assert.equal(restored.futureAutomationConfirmed, true);
    assert.equal(restored.historyShortcutConfirmed, true);
    assert.equal(journey.canFinishIosMessageSetup(restored, 'shortcut-proven'), status === 'complete');
  }
});

test('legacy skipped review is not future-only consent; malformed or unrelated metadata stays rejected', async () => {
  const h = harness();
  const base = await h.loadIosMessageSetupProgress(h.storage);
  const legacy = { ...base, historyStatus: 'skipped', futureAutomationConfirmed: true };
  h.values.set(h.IOS_MESSAGE_SETUP_PROGRESS_KEY, JSON.stringify(legacy));
  const restored = await h.loadIosMessageSetupProgress(h.storage);
  assert.equal(restored.futureAutomationConfirmed, true);
  assert.equal(restored.historySkippedForNow, undefined);
  assert.equal(journey.canFinishIosMessageSetup(restored, 'shortcut-proven'), false);
  for (const invalid of [{ historySkippedForNow: 'true' }, { historySkippedForNow: true, body: 'private' }]) {
    h.values.set(h.IOS_MESSAGE_SETUP_PROGRESS_KEY, JSON.stringify({ ...legacy, ...invalid }));
    assert.equal((await h.loadIosMessageSetupProgress(h.storage)).futureAutomationConfirmed, false);
  }
  await h.dispatchIosMessageSetup({ type: 'future-automation-confirmed' }, h.storage);
  await h.dispatchIosMessageSetup({ type: 'history-skipped-for-now', readiness: 'shortcut-proven' }, h.storage);
  await h.clearIosMessageSetupProgress(h.storage);
  const reset = await h.loadIosMessageSetupProgress(h.storage);
  assert.equal(reset.historySkippedForNow, undefined);
  assert.equal(reset.historyStatus, 'not-started');
  assert.equal(reset.futureAutomationConfirmed, false);
});
