'use strict';
// Redesigned Pro, Trusted devices, statements, first run, Ask and Feedback:
// copy parity and the truth rules each screen is held to.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const shape = (value) => {
  if (typeof value === 'function') return 'function';
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape(value[key])]));
  }
  return typeof value;
};
const assertParity = (en, ar) => {
  assert.deepEqual(shape(ar), shape(en));
  const walk = (value, key) => {
    if (typeof value === 'string') {
      assert.ok(value.trim().length > 0, key);
      return;
    }
    if (typeof value === 'function') return;
    for (const [k, v] of Object.entries(value)) walk(v, `${key}.${k}`);
  };
  walk(ar, 'ar');
  walk(en, 'en');
};

test('Pro copy is paired and sells only what Pro gates', () => {
  const { PRO_COPY } = load(path.join(root, 'src/lib/pro-copy.ts'));
  assertParity(PRO_COPY.en, PRO_COPY.ar);
  const pro = read('src/app/pro.tsx');
  // No saving badge: the store returns display strings, not numeric prices.
  assert.doesNotMatch(pro, /proSavePercent|SAVE|save\s*\{/i);
  // Insights and subscriptions are free, so they are not a Pro benefit.
  assert.doesNotMatch(pro, /featInsights/);
  // Android-only rows are the notification reader and past-SMS import, both
  // of which isProActive/requiresPro actually gate.
  assert.match(pro, /autoCaptureMethod\(\) === 'inboxScan'[\s\S]{0,200}copy\.notificationsTitle[\s\S]{0,200}copy\.historyTitle/);
  assert.match(read('src/lib/purchases.ts'), /export function requiresPro\(method: CaptureMethod\): boolean \{\s*return method !== 'manual';/);
  assert.match(pro, /accessibilityRole="radio"/);
  assert.match(pro, /t\('proOutcomeTitle'\)/);
});

test('Trusted devices shows the invite countdown as its hero and says what is relayed', () => {
  const screen = read('src/app/trusted-devices.tsx');
  const i18n = read('src/lib/i18n.ts');
  assert.match(screen, /testID="trusted-invite-countdown"[\s\S]{0,900}type="display"[\s\S]{0,200}secondsLeft \/ 60/);
  assert.match(screen, /t\('trustedRelayOnly', language\)/);
  assert.match(i18n, /trustedRelayOnly: \{\s*en: 'The phone that joins receives only new items relayed after it joins\. Older transactions are not copied\.'/);
  // The board's "Share one ledger" promise is not made anywhere.
  assert.doesNotMatch(i18n, /Share one ledger/);
});
