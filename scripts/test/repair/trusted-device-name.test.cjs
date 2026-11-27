'use strict';
// Trusted-device pairing must never read the phone's own name.
//
// expo-device's deviceName is often "<owner>'s Galaxy" on Android and, on iOS 15, the
// user-assigned UIDevice.name. The relay stores the pairing label, and neither Google Play's
// Data safety form (once updated) nor the App Store privacy answers declare a Name. The label
// is a generic, localized "This phone" / "This iPhone"; the user can rename the device.
//
// Executes the real screen through the workflow harness with an expo-device stub that counts
// every read of deviceName. Not a device test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWorkflowHarness, walk, text } = require('../workflows/workflow-harness.cjs');
const { t } = require('../build/i18n.js');

const root = path.resolve(__dirname, '../../..');
const OWNER_NAME = "Nasser's Galaxy S25";

function render(platform, language) {
  // Private Mode off: pairing is allowed. states[2] is the `loading` slot.
  const h = createWorkflowHarness({ platform, language, state: { language, privateMode: false }, states: { 2: false } });
  const reads = { deviceName: 0 };
  h.deps['expo-device'] = {
    get deviceName() { reads.deviceName += 1; return OWNER_NAME; },
    get modelName() { return 'SM-S931B'; },
  };
  // A configured relay, so the real "create" path runs; record what pairing receives.
  const paired = [];
  h.deps['@/lib/relay'] = {
    ...h.deps['@/lib/relay'],
    DEFAULT_RELAY_URL: 'https://relay.example.test',
    getRelayConfig: async () => null,
    pairDevice: async (url, name) => { paired.push({ url, name }); return null; },
    listTrustedDevices: async () => [],
  };
  const tree = h.renderScreen('trusted-devices');
  return { h, tree, reads, paired };
}

const expected = {
  android: { en: 'This phone', ar: 'هذا الهاتف' },
  ios: { en: 'This iPhone', ar: 'هذا الآيفون' },
};

for (const platform of ['android', 'ios']) {
  for (const language of ['en', 'ar']) {
    test(`${platform}/${language}: pairing never reads Device.deviceName and sends a generic label`, async () => {
      const { tree, reads, paired } = render(platform, language);
      assert.doesNotMatch(text(tree), /Galaxy/, 'the owner\'s device name must not appear anywhere');
      const create = walk(tree).find((node) => typeof node.props?.onPress === 'function' &&
        (node.props.label ?? node.props.accessibilityLabel) === t('trustedCreateVault', language));
      assert.ok(create, 'the create-vault button renders with a configured relay');
      create.props.onPress();
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(paired.map((call) => call.name), [expected[platform][language]],
        'pairing sends the generic localized label');
      assert.equal(reads.deviceName, 0, 'the screen must not read the phone\'s own name');
    });
  }
}

test('source: the trusted-devices screen does not import expo-device or reference deviceName', () => {
  const source = fs.readFileSync(path.join(root, 'src/app/trusted-devices.tsx'), 'utf8');
  assert.doesNotMatch(source, /from 'expo-device'/);
  assert.doesNotMatch(source, /Device\.deviceName/);
});
