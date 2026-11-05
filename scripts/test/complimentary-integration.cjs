'use strict';
// Exercise the JS entitlement/store boundary independently from the native HTTP
// transport. The transport's wire behavior is tested in its Android unit tests.
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./repair/load-typescript.cjs');
const root = path.resolve(__dirname, '../..');
const { createLoader } = require('../universal-test/load-ts.cjs');
const logic = createLoader()('@/lib/complimentary-access');

function deviceWith(transport) {
  const keys = new Map();
  const device = load(path.join(root, 'src/lib/complimentary-device.ts'), {
    'react-native': { Platform: { OS: 'android' } },
    '@/lib/complimentary-access': logic,
    '@/lib/complimentary-clock': { anchorGrant: () => true, clearGrantClock: () => true },
    'expo-secure-store': {
      getItemAsync: async key => keys.get(key) ?? null,
      setItemAsync: async (key, value) => { keys.set(key, value); },
      deleteItemAsync: async key => { keys.delete(key); },
    },
    'expo-modules-core': { requireOptionalNativeModule(name) {
      assert.equal(name, 'WafraGrantTransport');
      return transport;
    } },
  }).complimentaryDevice;
  return { device, keys };
}

test('an explicit native grant enrolls the device; later denial withdraws access without re-creating a purchase', async () => {
  const code = 'B'.repeat(43);
  let response = 'granted';
  const calls = [];
  const { device, keys } = deviceWith({ verify: async value => { calls.push(value); return response; } });
  assert.equal((await device.refresh()).status, 'absent');
  assert.equal(calls.length, 0);
  assert.equal((await device.redeem(code)).status, 'granted');
  assert.equal((await device.refresh()).status, 'granted');
  response = 'denied';
  assert.equal((await device.refresh()).status, 'denied');
  assert.deepEqual(calls, [code, code, code]);
  await device.clear();
  assert.equal(keys.size, 0);
});

test('missing, failing, or unrecognized native response cannot enroll a device', async () => {
  for (const transport of [null, { verify: async () => 'unexpected' }, { verify: async () => { throw new Error('test'); } }]) {
    const { device, keys } = deviceWith(transport);
    assert.equal((await device.redeem('C'.repeat(43))).status, 'unavailable');
    assert.equal(keys.size, 0);
  }
});
