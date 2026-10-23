'use strict';
// iPhone capture runs through App Intents, which need iOS 16, while Wafra
// still installs on iOS 15.1. Render the real onboarding gate and the real
// /ios-setup route at each OS band: on iOS 15 both must offer a way forward
// (a statement, or pasted messages); on iOS 16 and later nothing changes.
// The harnesses are the existing journey ones; OS, router and storage are
// their boundaries. This is not device evidence.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../repair/load-typescript.cjs');
const { gate, profile } = require('./onboarding-extreme-navigation.test.cjs');
const { screen } = require('./onboarding-extreme-setup.test.cjs');
const root = path.resolve(__dirname, '../../..');
const availability = load(path.join(root, 'src/lib/ios-setup-availability.ts'));

const IOS_15 = ['15.1', '15.8.3'];
const IOS_16 = ['16.0', '16.7.10'];
const IOS_17_PLUS = ['17.5', '18.6', '26.6'];
const calls = (h, name) => h.events.filter(event => event[0] === name);
// Routes built inside the route's VM realm compare by value, not prototype.
const lastRoute = s => JSON.parse(JSON.stringify(s.routes.at(-1)));
const navigatorShown = h => h.nodes().some(node => node.type === 'Navigator' && !node.props?.accessibilityElementsHidden);

test('one rule decides the band: iOS 16 and later can run capture, iOS 15 and unknown cannot', () => {
  for (const version of [...IOS_16, ...IOS_17_PLUS, 16, 17.4]) {
    assert.equal(availability.iosSupportsLiveCapture(version), true, String(version));
  }
  for (const version of [...IOS_15, 15, 15.8, '', 'unknown', null, undefined]) {
    assert.equal(availability.iosSupportsLiveCapture(version), false, String(version));
  }
});

// ── Onboarding step 5 ───────────────────────────────────────────────────

for (const version of IOS_15) {
  test(`onboarding on iOS ${version} leads with statements and offers pasting, not a dead-end setup`, async () => {
    const h = await gate({ version, profile: profile('capture', null) });
    assert.ok(h.text().includes(h.t('onboardLiveUnsupportedTitle')), h.text());
    assert.ok(h.text().includes(h.t('onboardLiveUnsupportedBody')));
    assert.match(h.t('onboardLiveUnsupportedBody'), /iOS 16/);
    // Nothing that can only end in "needs iOS 16": no Set up, no checklist, no automation sheet.
    for (const id of ['onboarding-live-action', 'onboarding-ios-checklist', 'onboarding-how-it-works', 'onboarding-source-statements']) {
      assert.equal(h.byTestID(id), undefined, `${id} is hidden on iOS 15`);
    }
    assert.ok(h.byTestID('onboarding-live-statements'), 'statements are the primary action');
    assert.ok(h.byTestID('onboarding-source-paste'), 'pasting messages is offered beside it');
    assert.ok(h.byTestID('onboarding-source-manual'), 'adding by hand still finishes the step');
    assert.ok(h.byTestID('onboarding-source-manual').props.accessibilityLabel.endsWith(h.t('onboardManualIosUnsupportedBody')),
      'and does not promise capture can be turned on later');

    await h.press('iosLocalUnsupportedStatement');
    assert.deepEqual(h.routes, [['push', '/statement-import?fromOnboarding=1&statementSession=test-statement-session']]);
    assert.ok(navigatorShown(h), 'the gate steps aside for its own statement importer');
    assert.equal(calls(h, 'setCaptureOptOut').length, 0, 'choosing statements writes no capture preference');
    assert.equal(h.state.onboardingProfile.stage, 'capture');
    assert.equal(h.state.onboardingProfile.alerts, 'unsure');
    await h.route('/');
    assert.ok(h.text().includes(h.t('onboardLiveUnsupportedTitle')), 'back from the importer returns to this step');
  });

  test(`onboarding on iOS ${version} opens the paste form and comes back to the same step`, async () => {
    const h = await gate({ version, profile: profile('capture', null) });
    await h.tap('onboarding-source-paste');
    assert.deepEqual(h.routes, [['push', { pathname: '/import-sms', params: { manual: '1' } }]]);
    assert.ok(navigatorShown(h), 'the paste form is shown instead of the onboarding overlay');
    assert.equal(h.state.onboardingProfile.stage, 'capture');
    assert.equal(calls(h, 'onboarded').length, 0, 'pasting does not finish onboarding by itself');
    await h.route('/');
    assert.ok(h.text().includes(h.t('onboardLiveUnsupportedTitle')));
    assert.ok(h.byTestID('onboarding-live-statements'));
  });
}

test('onboarding on iOS 15 in Arabic shows the Arabic explanation and actions', async () => {
  const h = await gate({ version: '15.8', language: 'ar', profile: profile('capture', null) });
  assert.ok(h.text().includes(h.t('onboardLiveUnsupportedTitle')));
  assert.ok(h.text().includes(h.t('onboardLiveUnsupportedBody')));
  assert.match(h.t('onboardLiveUnsupportedBody'), /[؀-ۿ]/);
  assert.ok(h.control('iosLocalUnsupportedStatement'));
  assert.ok(h.control('iosLocalUnsupportedPaste'));
});

test('the Settings preview on iOS 15 imports nothing and moves on as adding by hand does', async () => {
  const h = await gate({ version: '15.8', ledger: { onboarded: true }, params: { onboarding: 'preview' } });
  await h.press('getStarted'); await h.press('onboardNameSkip');
  await h.press('skipForNow'); await h.press('skipForNow'); await h.press('notNow');
  assert.ok(h.text().includes(h.t('onboardLiveUnsupportedTitle')));
  assert.equal(h.byTestID('onboarding-source-paste'), undefined, 'the preview never opens the paste form');
  await h.press('iosLocalUnsupportedStatement');
  assert.ok(h.text().includes(h.eWords.manualTitle), h.text());
  assert.deepEqual(h.routes, []);
  assert.equal(calls(h, 'setCaptureOptOut').length, 0);
});

// A statement or a paste has brought rows in by the time the person is back on step 5.
const imported = [{ id: 'statement-row-1', type: 'expense', amountFils: 1250, category: 'dining', accountId: '',
  title: 'Cedar Bakery', date: '2026-10-01', source: 'pdf' }];

for (const language of ['en', 'ar']) {
  test(`onboarding on iOS 15 with imported rows leads with Continue and says what came in: ${language}`, async () => {
    const h = await gate({ version: '15.8', language, profile: profile('capture', null), ledger: { transactions: imported } });
    assert.ok(h.byTestID('onboarding-live-continue'), 'Continue leads once something is in');
    assert.equal(h.byTestID('onboarding-live-statements'), undefined);
    assert.ok(h.byTestID('onboarding-source-statements'), 'another statement is still a row away');
    assert.ok(h.byTestID('onboarding-source-paste'));
    assert.equal(h.byTestID('onboarding-source-manual'), undefined, 'Continue is that same finish');
    await h.tap('onboarding-live-continue');
    assert.deepEqual(calls(h, 'setCaptureOptOut').map(([, value]) => value), [true]);
    assert.equal(h.state.onboardingProfile.alerts, 'neither', 'nothing reaches Wafra by itself on iOS 15');
    assert.ok(h.text().includes(h.t('onboardIosImportedTitle')), h.text());
    assert.ok(h.text().includes(h.t('onboardIosImportedBody')));
    assert.ok(!h.text().includes(h.eWords.manualTitle));
  });
}

for (const version of ['16.0', '17.5']) {
  test(`onboarding on iOS ${version} with imported rows keeps Set up and adding by hand`, async () => {
    const h = await gate({ version, profile: profile('capture', null), ledger: { transactions: imported } });
    assert.ok(h.byTestID('onboarding-live-action'));
    assert.ok(h.byTestID('onboarding-source-manual'));
    assert.equal(h.byTestID('onboarding-live-continue'), undefined);
    await h.tap('onboarding-source-manual');
    assert.ok(h.text().includes(h.eWords.manualTitle), 'the by-hand result wording is unchanged');
    assert.ok(!h.text().includes(h.t('onboardIosImportedTitle')));
  });
}

for (const version of [...IOS_16, ...IOS_17_PLUS]) {
  test(`onboarding on iOS ${version} keeps automatic capture setup unchanged`, async () => {
    const h = await gate({ version, profile: profile('capture', null) });
    assert.ok(h.text().includes(h.t('onboardLiveTitle')));
    assert.ok(!h.text().includes(h.t('onboardLiveUnsupportedTitle')));
    for (const id of ['onboarding-live-action', 'onboarding-ios-checklist', 'onboarding-how-it-works', 'onboarding-source-statements']) {
      assert.ok(h.byTestID(id), `${id} is shown`);
    }
    assert.equal(h.byTestID('onboarding-live-statements'), undefined);
    assert.equal(h.byTestID('onboarding-source-paste'), undefined);
    assert.ok(h.byTestID('onboarding-source-manual').props.accessibilityLabel.endsWith(h.eWords.addByHandBody));
    await h.press('onboardLiveAction');
    assert.deepEqual(h.routes, [['push', '/ios-setup?fromOnboarding=1']]);
  });
}

// ── /ios-setup ──────────────────────────────────────────────────────────

for (const version of IOS_15) {
  test(`/ios-setup in onboarding on iOS ${version} explains the limit and offers both ways in`, async t => {
    const s = await screen(t, { version });
    assert.ok(s.text().includes(s.copy.t('iosLocalUnsupported')), s.text());
    assert.ok(s.text().includes(s.copy.t('iosLocalUnsupportedBody')));
    assert.match(s.copy.t('iosLocalUnsupported'), /iOS 16 or later/);
    assert.ok(s.all().some(node => node.props?.testID === 'ios-capture-unsupported'));
    assert.equal(s.button('iosLocalInstallShortcut'), undefined, 'no Shortcut to add');
    assert.ok(s.button('iosMessageContinueManual'), 'Skip for now still finishes onboarding');

    await s.press('iosLocalUnsupportedStatement');
    const [kind, route] = lastRoute(s);
    assert.equal(kind, 'push');
    assert.deepEqual(route, { pathname: '/statement-import',
      params: { fromOnboarding: '1', statementSession: 'setup-statement-handoff' } });
    assert.equal(s.statementHandoff.matchesIosStatementHandoff(route.params.statementSession), true,
      'the onboarding gate will step aside for this importer');

    await s.press('iosLocalUnsupportedPaste');
    assert.deepEqual(lastRoute(s), ['push', { pathname: '/import-sms', params: { manual: '1' } }]);
    assert.deepEqual(s.urls, [], 'nothing opens Shortcuts');
    assert.equal(s.receipts.some(([name]) => name === 'enabled' || name === 'onboarded'), false);
  });
}

test('/ios-setup from Settings on iOS 15 offers the same actions without an onboarding handoff', async t => {
  const s = await screen(t, { version: '15.8', params: { fromOnboarding: undefined } });
  assert.ok(s.text().includes(s.copy.t('iosLocalUnsupported')));
  assert.equal(s.button('iosMessageContinueManual'), undefined, 'no first-run exit outside onboarding');
  await s.press('iosLocalUnsupportedStatement');
  assert.deepEqual(lastRoute(s), ['push', { pathname: '/statement-import', params: {} }]);
  assert.equal(s.statementHandoff.matchesIosStatementHandoff('setup-statement-handoff'), false);
  await s.press('iosLocalUnsupportedPaste');
  assert.deepEqual(lastRoute(s), ['push', { pathname: '/import-sms', params: { manual: '1' } }]);
});

test('/ios-setup on iOS 15 in Arabic shows the Arabic explanation and actions', async t => {
  const s = await screen(t, { version: '15.8', language: 'ar' });
  assert.ok(s.text().includes(s.copy.t('iosLocalUnsupported')));
  assert.match(s.copy.t('iosLocalUnsupported'), /iOS 16/);
  assert.match(s.copy.t('iosLocalUnsupportedBody'), /[؀-ۿ]/);
  assert.ok(s.button('iosLocalUnsupportedStatement'));
  assert.ok(s.button('iosLocalUnsupportedPaste'));
});

for (const version of [...IOS_16, ...IOS_17_PLUS]) {
  test(`/ios-setup on iOS ${version} keeps the Shortcut setup unchanged`, async t => {
    const s = await screen(t, { version });
    assert.ok(!s.text().includes(s.copy.t('iosLocalUnsupported')));
    assert.equal(s.all().some(node => node.props?.testID === 'ios-capture-unsupported'), false);
    assert.equal(s.button('iosLocalUnsupportedStatement'), undefined);
    assert.equal(s.button('iosLocalUnsupportedPaste'), undefined);
    assert.ok(s.button('iosLocalInstallShortcut'), 'step 1 adds the Shortcut');
  });
}
