'use strict';
// RC 396 F3: Android onboarding said payments arrive "from bank alerts or Apple Pay".
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');

test('Android onboarding waiting copy never mentions Apple Pay, in English and Arabic', () => {
  const copy = fs.readFileSync(path.join(root, 'src/lib/onboarding-e-copy.ts'), 'utf8');
  const android = [...copy.matchAll(/waitingBodyAndroid: '([^']+)'/g)].map(match => match[1]);
  assert.equal(android.length, 2, 'one English and one Arabic Android line');
  for (const line of android) assert.doesNotMatch(line, /apple|wallet/i);
  assert.match(android[1], /[؀-ۿ]/, 'the second is Arabic');
});

test('the completion screen picks the Android line on Android', () => {
  const gate = fs.readFileSync(path.join(root, 'src/components/onboarding-gate.tsx'), 'utf8');
  assert.match(gate, /Platform\.OS === 'android' \? words\.waitingBodyAndroid : words\.waitingBody/);
});
