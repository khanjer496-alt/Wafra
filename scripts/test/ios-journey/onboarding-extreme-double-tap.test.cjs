'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { gate, profile } = require('./onboarding-extreme-navigation.test.cjs');

const stage = (h, expected) => assert.equal(h.state.onboardingProfile.stage, expected);
const writes = h => h.events.filter(event => event[0] === 'setCaptureOptOut');
const open = async (t, options) => {
  const h = await gate({ manualClock: true, ...options });
  t.after(() => h.unmount());
  return h;
};

for (const reducedMotion of [false, true]) {
  test(`tracking Continue double tap 30ms apart retains Preview: reducedMotion=${reducedMotion}`, async t => {
    const h = await open(t, { profile: profile('tracking'), reducedMotion });
    await h.press('continueWord'); stage(h, 'preview');
    await h.advance(30);
    // Read the newly rendered same-position button, not the old callback.
    // Calling it also protects against a queued native press after disabling.
    h.control('continueWord').onPress(); await h.flush();
    stage(h, 'preview');
    assert.equal(h.control('continueWord').disabled, true);
    assert.equal(h.control('onboardBack').disabled, true);
    await h.advance(319);
    assert.equal(h.control('continueWord').disabled, true);
    await h.advance(1);
    assert.equal(h.control('continueWord').disabled, false);
    await h.press('continueWord'); stage(h, 'privacy');
    assert.deepEqual(writes(h), []);
  });
}

test('rapid Back taps use one transition and deliberate Back remains available afterward', async t => {
  const h = await open(t, { profile: profile('privacy') });
  await h.press('onboardBack'); stage(h, 'preview');
  await h.advance(30);
  h.control('onboardBack').onPress(); await h.flush(); stage(h, 'preview');
  await h.advance(320);
  assert.equal(h.control('onboardBack').disabled, false);
  await h.press('onboardBack'); stage(h, 'tracking');
  assert.equal(h.state.onboardingProfile.focus, 'spending');
  assert.equal(h.state.onboardingProfile.tracking, 'bank-apps');
});

test('rapid alternating Next and Back cannot undo a transition before its screen settles', async t => {
  const h = await open(t, { profile: profile('tracking') });
  await h.press('continueWord'); stage(h, 'preview');
  await h.advance(30);
  h.control('onboardBack').onPress(); await h.flush(); stage(h, 'preview');
  await h.advance(320);
  await h.press('onboardBack'); stage(h, 'tracking');
  h.control('continueWord').onPress(); await h.flush(); stage(h, 'tracking');
  await h.advance(350);
  await h.press('continueWord'); stage(h, 'preview');
});

test('Privacy second tap cannot start automatic or manual capture on the next screen', async t => {
  const h = await open(t, { profile: profile('privacy') });
  await h.press('onboardPrivacyContinue'); stage(h, 'capture');
  await h.advance(30);
  assert.equal(h.control('onboardAutomaticChoiceIos').disabled, true);
  assert.equal(h.control('onboardManualChoiceIos').disabled, true);
  h.control('onboardAutomaticChoiceIos').onPress();
  h.control('onboardManualChoiceIos').onPress(); await h.flush();
  assert.deepEqual(writes(h), []);
  assert.deepEqual(h.routes, []);
  await h.advance(320);
  await h.press('onboardAutomaticChoiceIos');
  assert.deepEqual(writes(h).map(event => event[1]), [false]);
  assert.deepEqual(h.routes, [['push', '/ios-setup?fromOnboarding=1']]);
});

test('transition timer is cleared on unmount and is not inherited by a fresh gate', async t => {
  const h = await open(t, { profile: profile('tracking') });
  await h.press('continueWord'); stage(h, 'preview');
  assert.equal(h.clock.pending, 1);
  const saved = JSON.parse(JSON.stringify(h.state.onboardingProfile));
  h.unmount(); assert.equal(h.clock.pending, 0);
  const restored = await open(t, { profile: saved });
  assert.equal(restored.control('continueWord').disabled, false);
  assert.equal(restored.clock.pending, 0);
  await restored.press('continueWord'); stage(restored, 'privacy');
});

test('unanswered Continue does not start a transition or bypass the question', async t => {
  const h = await open(t, { profile: profile('focus', null, null) });
  assert.equal(h.control('continueWord').disabled, true);
  h.control('continueWord').onPress(); await h.flush();
  stage(h, 'focus'); assert.equal(h.clock.pending, 0);
  await h.choose(0);
  assert.equal(h.control('continueWord').disabled, false);
  await h.press('continueWord'); stage(h, 'tracking');
});

test('optional plan Next cannot also accept the newly rendered budget choice', async t => {
  const h = await open(t, { platform: 'android', profile: profile('capture') });
  await h.press('onboardPersonalizeOptional');
  await h.advance(350);
  // Defaults already include a goal; the test navigates actual optional UI.
  await h.press('continueWord');
  await h.advance(30);
  h.control('onboardBudgetContinue').onPress(); await h.flush();
  assert.equal(h.state.onboardingPlan, null);
  assert.equal(h.control('onboardBudgetContinue').disabled, true);
  await h.advance(320);
  await h.press('onboardBudgetContinue');
  assert.ok(h.state.onboardingPlan);
  stage(h, 'capture');
  assert.deepEqual(writes(h), []);
});
