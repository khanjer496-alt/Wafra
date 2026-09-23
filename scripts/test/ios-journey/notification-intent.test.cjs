const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const plugin = read('modules/wafra-live-capture/plugin/index.js');
const generatedPath = path.join(root, 'ios/Wafra/WafraLiveCaptureIntent.swift');
const source = plugin.split('const intentSource = `')[1].split('`;')[0];

test('generated native intent is exactly the plugin output', { skip: !fs.existsSync(generatedPath) }, () => {
  assert.equal(fs.readFileSync(generatedPath, 'utf8'), source);
});

test('notification intent takes explicit text and cannot access notifications directly', () => {
  const intent = source.split('struct CaptureWafraNotificationIntent: AppIntent {')[1]
    .split('@available(iOS 26.0, *)')[0];
  assert.match(intent, /var text: String/);
  assert.match(intent, /inputConnectionBehavior: \.connectToPreviousIntentResult/);
  assert.match(intent, /openAppWhenRun = false/);
  assert.match(intent, /authenticationPolicy: IntentAuthenticationPolicy = \.alwaysAllowed/);
  assert.match(intent, /stageNotification\(\s*text: text, eventId: UUID\(\)\.uuidString, observedAt: Date\(\)/);
  assert.doesNotMatch(intent, /UNUserNotificationCenter|NotificationCenter|sender:/);
});

test('manual setup check returns before financial admission and never treats empty input as proof', () => {
  const intent = source.split('struct CaptureWafraNotificationIntent: AppIntent {')[1];
  assert.match(intent, /if text\.trimmingCharacters\(in: \.whitespacesAndNewlines\) == WafraLiveCaptureStore\.notificationSetupProbeText \{\s*try WafraLiveCaptureStore\.shared\.recordNotificationSetupProof\(at: Date\(\)\)\s*return \.result\(value: "setup-checked"\)\s*\}/);
  assert.doesNotMatch(intent, /recordSetupProof|recordFirstCapturedAt/);
  assert.match(intent, /case \.invalid:\s*throw WafraLiveCaptureIntentError\.invalidNotification/);
});

for (const locale of ['en', 'ar']) {
  test(`notification localization is present and generated identically for ${locale}`, () => {
    const resource = read(`modules/wafra-live-capture/ios/Resources/${locale}.lproj/WafraIntents.strings`);
    const generatedResource = path.join(root, `ios/Wafra/Supporting/${locale}.lproj/WafraIntents.strings`);
    if (fs.existsSync(generatedResource)) assert.equal(fs.readFileSync(generatedResource, 'utf8'), resource);
    for (const key of ['title', 'text.parameter', 'invalid', 'error']) {
      assert.ok(resource.includes(`"live.notification.${key}" = "`));
    }
  });
}
