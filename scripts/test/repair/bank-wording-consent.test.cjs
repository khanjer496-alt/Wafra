'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const loadSource = (name, deps) => load(path.join(root, 'src/lib', name + '.ts'), deps);
const { createLoader } = require('../../universal-test/load-ts.cjs');
const choiceRules = createLoader()('@/lib/shared-alert-format-share');
const until = async (condition) => {
  for (let i = 0; i < 12 && !condition(); ++i) await Promise.resolve();
  assert.ok(condition(), 'the expected asynchronous boundary was reached');
};
function harness(state = {}) {
  const calls = [];
  let dialog, configGate, identityGate;
  const impl = loadSource('shared-alert-format-submit', {
    'react-native': { Alert: { alert: (_title, body, options) => { calls.push('dialog'); dialog = { body, options }; } } },
    'expo-crypto': {}, 'expo-secure-store': {}, 'expo/fetch': {},
    '@/lib/relay': { getRelayConfig: async () => { calls.push('lookup'); return configGate ? configGate : null; } },
    '@/lib/shared-alert-format-share': choiceRules,
    '@/lib/shared-alert-format-identity': { createSharingIdentity: () => ({
      ensure: async () => { calls.push('pair'); return identityGate || {}; }
    }) },
    '@/lib/shared-alert-format-sync': { submitSharedAlertShape: async () => { calls.push('send'); } },
  });
  return {
    calls, state,
    send: () => impl.submitShapeAnonymously({}, () => state, async choice => { calls.push('choice'); state.shareAlertFormatsV1 = choice; }),
    choose: async label => { await until(() => dialog); assert.match(dialog.body, /future eligible formats/); dialog.options.find(b => b.text === label).onPress(); },
    delayConfig: (p) => { configGate = p; }, delayPair: (p) => { identityGate = p; },
  };
}
test('default and legacy ON cannot pair or upload; Keep private persists and avoids another prompt', async () => {
  const h = harness({ shareAlertFormats: true });
  const first = h.send(); await h.choose('Keep private'); await first; await h.send();
  assert.deepEqual(h.calls, ['dialog','choice']);
});
test('the affirmative choice permits this contribution and subsequent eligible saves', async () => {
  const h = harness(); const first = h.send(); await h.choose('Share bank wording'); await first;
  await h.send();
  assert.deepEqual(h.calls, ['dialog','choice','lookup','pair','send','lookup','pair','send']);
});
test('stored opt-out and Private Mode never prompt, pair or upload', async () => {
  for (const state of [{ shareAlertFormatsV1: false }, { privateMode: true, shareAlertFormatsV1: true }]) {
    const h = harness(state); await h.send(); assert.deepEqual(h.calls, []);
  }
});
test('revocation between asynchronous credential boundaries stops further work', async () => {
  for (const stage of ['lookup','pair']) {
    const h = harness({ shareAlertFormatsV1: true });
    let release; const p = new Promise(r => { release=r; });
    if (stage === 'lookup') h.delayConfig(p); else h.delayPair(p);
    const first = h.send(); await until(() => h.calls.includes(stage));
    h.state.privateMode = true; release(null); await first;
    assert.equal(h.calls.includes('send'), false);
    assert.equal(h.calls.includes('pair'), stage === 'pair');
  }
});

test('a parallel contribution cannot send with an optimistic preference still being persisted', async () => {
  const h = harness({ shareAlertFormatsV1: true });
  await choiceRules.whileSavingFormatChoice(() => h.send());
  assert.deepEqual(h.calls, []);
});
