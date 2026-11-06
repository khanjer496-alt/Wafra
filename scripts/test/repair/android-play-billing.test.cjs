'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const products = load(path.join(root, 'src/lib/purchases.ts'), {
  'react-native': { Platform: { OS: 'android' } },
  '@/lib/complimentary-access': { complimentaryAccessUntil: () => 0 },
});
const unknown = { status: 'unknown', activeProductIds: [], pendingProductIds: [], responseCode: null };

function reader(native, throwOnLookup = false) {
  const query = load(path.join(root, 'src/lib/android-play-billing.ts'), {
    'expo-modules-core': { requireOptionalNativeModule(name) {
      assert.equal(name, 'WafraPlayBilling');
      if (throwOnLookup) throw new Error('bridge unavailable');
      return native;
    } },
    '@/lib/purchases': products,
  }).queryAndroidPlaySubscriptions;
  // The source loader runs in its own VM; compare the returned JSON contract
  // without depending on that realm's Object/Array prototypes.
  return async () => JSON.parse(JSON.stringify(await query()));
}

test('missing native module and failed native calls preserve unknown rather than inventing an empty store', async () => {
  assert.deepEqual(await reader(null)(), unknown);
  assert.deepEqual(await reader(null, true)(), unknown);
  assert.deepEqual(await reader({ querySubscriptions: async () => { throw new Error('timeout'); } })(), unknown);
});

test('only successful coherent known-product answers can grant or revoke access', async () => {
  const malformed = [null, {}, { status: 'inactive', activeProductIds: [], pendingProductIds: [], responseCode: 2 },
    { status: 'inactive', activeProductIds: ['wafra_pro_yearly'], pendingProductIds: [], responseCode: 0 },
    { status: 'active', activeProductIds: [], pendingProductIds: [], responseCode: 0 },
    { status: 'active', activeProductIds: ['unrelated_product'], pendingProductIds: [], responseCode: 0 },
    { status: 'active', activeProductIds: ['wafra_pro_yearly'], pendingProductIds: [], responseCode: '0' },
    { status: 'unknown', activeProductIds: [], pendingProductIds: [], responseCode: 0 }];
  for (const reply of malformed) {
    assert.deepEqual(await reader({ querySubscriptions: async () => reply })(), unknown);
  }
});

test('known retired monthly ownership remains valid and no transaction secrets cross the wrapper boundary', async () => {
  const reply = { status: 'active', activeProductIds: ['wafra_pro_monthly'], pendingProductIds: [], responseCode: 0,
    purchaseToken: 'sensitive-fixture-must-not-escape', orderId: 'fixture-order' };
  assert.deepEqual(await reader({ querySubscriptions: async () => reply })(), {
    status: 'active', activeProductIds: ['wafra_pro_monthly'], pendingProductIds: [], responseCode: 0,
  });
});

test('pending checkout remains distinguishable from owned access on a successful query', async () => {
  assert.deepEqual(await reader({ querySubscriptions: async () => ({
    status: 'inactive', activeProductIds: [], pendingProductIds: ['wafra_pro_yearly'], responseCode: 0,
  }) })(), { status: 'inactive', activeProductIds: [], pendingProductIds: ['wafra_pro_yearly'], responseCode: 0 });
});
