'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const lock = require('../build/app-lock.js');

function handler({ platform = 'ios', level = 1, outcome = { success: true }, saveFails = false, authFails = false } = {}) {
  const file = path.resolve(__dirname, '../../../src/app/settings.tsx');
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let body;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'toggleAppLock') body = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(body, 'Exercise the actual protected handler, not a duplicate implementation');
  const printed = ts.createPrinter().printNode(ts.EmitHint.Unspecified, body, source);
  const js = ts.transpileModule(`module.exports = ${printed};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const events = [], prompts = [], promptingDuring = [], module = { exports: null };
  vm.runInNewContext(js, { module, Platform: { OS: platform }, t: key => key,
    Alert: { alert: (...args) => events.push(['alert', ...args]) },
    ...lock, LocalAuthentication: {
      getEnrolledLevelAsync: async () => { if (level instanceof Error) throw level; return level; },
      authenticateAsync: async options => {
        events.push(['authenticate', options.disableDeviceFallback]); prompts.push(options.promptMessage);
        promptingDuring.push(lock.appLockSession.prompting());
        if (authFails) throw new Error('Prompt could not be shown');
        return outcome;
      },
    },
    setAppLock: async value => { events.push(['save', value]); if (saveFails) throw new Error('Native privacy guard failed'); },
  });
  return { run: module.exports, events, prompts, promptingDuring };
}

for (const enabled of [false, true]) test(`native privacy failure is handled when App Lock becomes ${enabled}`, async () => {
  const h = handler({ saveFails: true });
  await assert.doesNotReject(h.run(enabled));
  assert.deepEqual(h.events.filter(e => e[0] === 'save'), [['save', enabled]]);
  assert.deepEqual(h.events.filter(e => e[0] === 'alert'), [['alert', 'notAvailable', 'privacyPreferenceFailed']]);
});
test('a passcode-only phone can enable App Lock through real authentication options', async () => {
  const h = handler(); await h.run(true);
  assert.deepEqual(h.events, [['authenticate', false], ['save', true]]);
});
test('an enrollment lookup failure retains the passcode fallback', async () => {
  const h = handler({ level: new Error('Lookup unavailable') }); await h.run(true);
  assert.deepEqual(h.events, [['authenticate', false], ['save', true]]);
});
test('cancelling authentication never enables or saves App Lock', async () => {
  const h = handler({ outcome: { success: false, error: 'user_cancel' } }); await h.run(true);
  assert.deepEqual(h.events, [['authenticate', false]]);
});
test('a phone with no screen lock never attempts authentication or native activation', async () => {
  const h = handler({ level: 0 }); await h.run(true);
  assert.deepEqual(h.events, [['alert', 'noScreenLockIos', 'noScreenLockBodyIos']], 'iPhone names its passcode');
  const android = handler({ platform: 'android', level: 0 }); await android.run(true);
  assert.deepEqual(android.events, [['alert', 'noScreenLock', 'noScreenLockBody']], 'Android keeps its screen-lock wording');
});
for (const [platform, title, body] of [['ios', 'noScreenLockIos', 'noScreenLockBodyIos'], ['android', 'noScreenLock', 'noScreenLockBody']]) {
  test(`authentication the phone cannot offer explains the missing lock in ${platform} words`, async () => {
    const h = handler({ platform, outcome: { success: false, error: 'not_enrolled' } }); await h.run(true);
    assert.deepEqual(h.events, [['authenticate', false], ['alert', title, body]]);
  });
}
test('web cannot enable native App Lock', async () => {
  const h = handler({ platform: 'web' }); await h.run(true);
  assert.deepEqual(h.events, [['alert', 'notAvailable', 'appLockPhoneOnly']]);
});

// O3 (#267): switching App Lock off asks for the same owner authentication,
// with the same device-credential fallback, as switching it on.
for (const platform of ['ios', 'android']) {
  test(`turning App Lock off on ${platform} authenticates first, with the passcode fallback`, async () => {
    const h = handler({ platform }); await h.run(false);
    assert.deepEqual(h.events, [['authenticate', false], ['save', false]]);
    assert.deepEqual(h.prompts, ['confirmDisableAppLock']);
  });
}
test('turning App Lock on keeps its own prompt', async () => {
  const h = handler(); await h.run(true);
  assert.deepEqual(h.prompts, ['confirmAppLock']);
});
for (const error of ['user_cancel', 'system_cancel', 'app_cancel', 'authentication_failed', 'lockout', 'user_fallback']) {
  test(`${error} while turning App Lock off leaves the lock on`, async () => {
    const h = handler({ platform: 'android', outcome: { success: false, error } }); await h.run(false);
    assert.deepEqual(h.events, [['authenticate', false]], 'nothing is saved, so the lock stays on');
  });
}
test('an enrollment lookup failure still authenticates before turning App Lock off', async () => {
  const h = handler({ level: new Error('Lookup unavailable') }); await h.run(false);
  assert.deepEqual(h.events, [['authenticate', false], ['save', false]]);
});
test('a phone that reports no screen lock cannot turn App Lock off without authentication', async () => {
  const h = handler({ level: 0 }); await h.run(false);
  assert.deepEqual(h.events, [['alert', 'noScreenLockIos', 'noScreenLockBodyIos']]);
  const android = handler({ platform: 'android', level: 0 }); await android.run(false);
  assert.deepEqual(android.events, [['alert', 'noScreenLock', 'noScreenLockBody']]);
  const refused = handler({ platform: 'android', outcome: { success: false, error: 'not_enrolled' } }); await refused.run(false);
  assert.deepEqual(refused.events, [['authenticate', false], ['alert', 'noScreenLock', 'noScreenLockBody']]);
});
test('web, which has no native lock, still clears the preference without a prompt', async () => {
  const h = handler({ platform: 'web' }); await h.run(false);
  assert.deepEqual(h.events, [['save', false]]);
});
test('the disable prompt has English and Arabic copy', () => {
  const load = require('./load-typescript.cjs');
  const { t } = load(path.resolve(__dirname, '../../../src/lib/i18n.ts'));
  assert.equal(t('confirmDisableAppLock', 'en'), 'Confirm to turn off app lock');
  assert.equal(t('confirmDisableAppLock', 'ar'), 'أكّد لإيقاف قفل التطبيق');
  assert.equal(t('confirmAppLock', 'en'), 'Confirm to enable app lock');
});

// While the lock is on, the gate's re-lock listener is live during the
// Settings prompt. The shared session tells it the sheet is the owner
// answering, and a successful prompt leaves no stale absence behind.
for (const enabled of [false, true]) {
  test(`the Settings prompt is flagged to the gate only while it is up (enable ${enabled})`, async () => {
    lock.appLockSession.setLeftAt(0);
    const h = handler(); await h.run(enabled);
    assert.deepEqual(h.promptingDuring, [true]);
    assert.equal(lock.appLockSession.prompting(), false);
  });
}
test('a successful owner prompt clears an absence the gate has not handled yet', async () => {
  lock.appLockSession.setLeftAt(1_000);
  const h = handler({ platform: 'android' }); await h.run(false);
  assert.equal(lock.appLockSession.leftAt(), 0);
  assert.deepEqual(h.events, [['authenticate', false], ['save', false]]);
});
test('a cancelled owner prompt keeps the absence, so the re-lock rules still apply', async () => {
  lock.appLockSession.setLeftAt(1_000);
  const h = handler({ platform: 'android', outcome: { success: false, error: 'user_cancel' } }); await h.run(false);
  assert.equal(lock.appLockSession.leftAt(), 1_000);
  assert.equal(lock.appLockSession.prompting(), false);
  lock.appLockSession.setLeftAt(0);
});
test('a prompt that throws clears the flag and saves nothing', async () => {
  const h = handler({ authFails: true });
  await assert.rejects(h.run(false), /Prompt could not be shown/);
  assert.equal(lock.appLockSession.prompting(), false);
  assert.deepEqual(h.events, [['authenticate', false]]);
});
