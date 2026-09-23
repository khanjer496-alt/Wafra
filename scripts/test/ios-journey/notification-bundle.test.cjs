'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
test('the app bundles the exact reviewed Apple-signed notification Shortcut', () => {
  const bytes = fs.readFileSync(path.join(root, 'modules/wafra-live-capture/ios/Resources/Wafra Notifications v1.shortcut'));
  assert.equal(bytes.length, 22747);
  assert.equal(bytes.subarray(0, 4).toString(), 'AEA1');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '93e9c6e120a6a7bedeb95a3b4b952c7a57cbad9622ba269562de1413e6608fcc');
  const podspec = fs.readFileSync(path.join(root, 'modules/wafra-live-capture/ios/WafraLiveCapture.podspec'), 'utf8');
  assert.ok(podspec.includes("['Resources/**/*']"));
});
