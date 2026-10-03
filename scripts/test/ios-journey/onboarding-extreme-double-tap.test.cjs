'use strict';
// Design language E: adjacent steps share button positions (Continue, the
// quiet action under it). A second physical tap must never act on the screen
// that just appeared.
const test = require('node:test');
const assert = require('node:assert/strict');
const { gate, profile } = require('./onboarding-extreme-navigation.test.cjs');

const stage = (h, expected) => assert.equal(h.state.onboardingProfile.stage, expected);
const writes = h => h.events.filter(event => event[0] === 'setCaptureOptOut');
const calls = (h, name) => h.events.filter(event => event[0] === name);
const open = async (t, options) => {
  const h = await gate({ manualClock: true, ...options });
  t.after(() => h.unmount());
  return h;
};

for (const reducedMotion of [false, true]) {
  test(`goals Continue double tap 30ms apart stays on Watch: reducedMotion=${reducedMotion}`, async t => {
    const h = await open(t, { profile: profile('focus'), reducedMotion });
    await h.press('continue'); stage(h, 'tracking');
    await h.advance(30);
    // Read the newly rendered same-position button, not the old callback.
    // Calling it also protects against a queued native press after disabling.
    h.control('continue').onPress(); await h.flush();
    stage(h, 'tracking');
    assert.equal(h.control('continue').disabled, true);
    assert.equal(h.control('back').disabled, true);
    await h.advance(319);
    assert.equal(h.control('continue').disabled, true);
    await h.advance(1);
    assert.equal(h.control('continue').disabled, false);
    await h.press('continue'); stage(h, 'alerts');
    assert.deepEqual(writes(h), []);
  });
}

test('rapid Back taps use one transition and deliberate Back remains available afterward', async t => {
  const h = await open(t, { profile: profile('alerts') });
  await h.press('back'); stage(h, 'tracking');
  await h.advance(30);
  h.control('back').onPress(); await h.flush(); stage(h, 'tracking');
  await h.advance(320);
  assert.equal(h.control('back').disabled, false);
  await h.press('back'); stage(h, 'focus');
  assert.equal(h.state.onboardingProfile.focus, 'spending', 'an older answer survives the E journey');
});

test('rapid alternating Next and Back cannot undo a transition before its screen settles', async t => {
  const h = await open(t, { profile: profile('focus') });
  await h.press('continue'); stage(h, 'tracking');
  await h.advance(30);
  h.control('back').onPress(); await h.flush(); stage(h, 'tracking');
  await h.advance(320);
  await h.press('back'); stage(h, 'focus');
  h.control('continue').onPress(); await h.flush(); stage(h, 'focus');
  await h.advance(350);
  await h.press('continue'); stage(h, 'tracking');
});

test('Watch Continue cannot also allow notifications on the newly rendered Reminders', async t => {
  const h = await open(t, { profile: profile('tracking') });
  await h.press('continue'); stage(h, 'alerts');
  await h.advance(30);
  assert.equal(h.control('allowNotifications').disabled, true);
  h.control('allowNotifications').onPress(); await h.flush();
  stage(h, 'alerts');
  assert.equal(calls(h, 'requestVisibleNotificationPermission').length, 0);
  await h.advance(320);
  await h.press('allowNotifications'); stage(h, 'capture');
  assert.equal(calls(h, 'requestVisibleNotificationPermission').length, 1);
  assert.deepEqual(writes(h), []);
});

test('the Reminders second tap cannot open statements, start capture or choose by hand', async t => {
  const h = await open(t, { profile: profile('alerts') });
  await h.press('notNow'); stage(h, 'capture');
  await h.advance(30);
  for (const key of ['onboardLiveAction', 'importStatements', 'addByHand']) assert.equal(h.control(key).disabled, true, key);
  h.control('onboardLiveAction').onPress(); h.control('importStatements').onPress(); h.control('addByHand').onPress();
  await h.flush();
  assert.deepEqual(writes(h), []);
  assert.deepEqual(h.routes, []);
  assert.equal(h.input.pathname, '/');
  await h.advance(320);
  await h.press('onboardLiveAction');
  assert.deepEqual(writes(h).map(event => event[1]), [false]);
  assert.deepEqual(h.routes, [['push', '/ios-setup?fromOnboarding=1']]);
});

test('transition timer is cleared on unmount and is not inherited by a fresh gate', async t => {
  const h = await open(t, { profile: profile('focus') });
  await h.press('continue'); stage(h, 'tracking');
  assert.equal(h.clock.pending, 1);
  const saved = JSON.parse(JSON.stringify(h.state));
  h.unmount(); assert.equal(h.clock.pending, 0);
  const restored = await open(t, { ledger: saved });
  assert.equal(restored.control('continue').disabled, false);
  assert.equal(restored.clock.pending, 0);
  await restored.press('continue'); stage(restored, 'alerts');
});

test('an empty name cannot Continue, start a transition or bypass the step', async t => {
  const h = await open(t);
  await h.press('getStarted');
  await h.advance(350);
  assert.equal(h.control('continue').disabled, true);
  h.control('continue').onPress(); await h.flush();
  assert.equal(h.clock.pending, 0);
  assert.equal(h.state.userName, 'there');
  await h.changeText('onboarding-name-input', 'Mona');
  assert.equal(h.control('continue').disabled, false);
  await h.press('continue'); stage(h, 'focus');
});
