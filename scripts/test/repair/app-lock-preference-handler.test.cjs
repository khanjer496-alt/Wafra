'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const lock = require('../build/app-lock.js');

function handler({ platform = 'ios', level = 1, outcome = { success: true }, saveFails = false } = {}) {
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
  const events = [], module = { exports: null };
  vm.runInNewContext(js, { module, Platform: { OS: platform }, t: key => key,
    Alert: { alert: (...args) => events.push(['alert', ...args]) },
    ...lock, LocalAuthentication: {
      getEnrolledLevelAsync: async () => { if (level instanceof Error) throw level; return level; },
      authenticateAsync: async options => { events.push(['authenticate', options.disableDeviceFallback]); return outcome; },
    },
    setAppLock: async value => { events.push(['save', value]); if (saveFails) throw new Error('Native privacy guard failed'); },
  });
  return { run: module.exports, events };
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
  assert.deepEqual(h.events, [['alert', 'noScreenLock', 'noScreenLockBody']]);
});
test('web cannot enable native App Lock', async () => {
  const h = handler({ platform: 'web' }); await h.run(true);
  assert.deepEqual(h.events, [['alert', 'notAvailable', 'appLockPhoneOnly']]);
});
