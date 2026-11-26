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


test('ack recovery retries billing errors with bounded backoff and fresh native queries', async () => {
  const waits = []; let calls = 0;
  const billing = load(path.join(root, 'src/lib/android-play-billing.ts'), {
    'expo-modules-core': { requireOptionalNativeModule: () => ({
      querySubscriptions: async () => unknown,
      acknowledgeSubscriptions: async () => {
        calls++;
        if (calls === 1) throw Error('synthetic billing unavailable');
        return calls === 2 ? unknown : { status: 'active', activeProductIds: ['wafra_pro_weekly'], pendingProductIds: [], responseCode: 0 };
      },
    }) }, '@/lib/purchases': products,
  }, { setTimeout: (callback, delay) => { waits.push(delay); callback(); } });
  await billing.recoverAndroidPlayAcknowledgements(() => true);
  assert.equal(calls, 3); assert.deepEqual(waits, [1000, 2000]);
});

test('ack recovery is bounded, single flight, optional on old binaries and stops after local revocation', async () => {
  let calls = 0; let allowed = true; const waits = [];
  const billing = load(path.join(root, 'src/lib/android-play-billing.ts'), {
    'expo-modules-core': { requireOptionalNativeModule: () => ({
      querySubscriptions: async () => unknown,
      acknowledgeSubscriptions: async () => { calls++; return unknown; },
    }) }, '@/lib/purchases': products,
  }, { setTimeout: (callback, delay) => { waits.push(delay); allowed = false; callback(); } });
  await Promise.all([billing.recoverAndroidPlayAcknowledgements(() => allowed), billing.recoverAndroidPlayAcknowledgements(() => allowed)]);
  assert.equal(calls, 1); assert.deepEqual(waits, [1000]);
  const old = load(path.join(root, 'src/lib/android-play-billing.ts'), {
    'expo-modules-core': { requireOptionalNativeModule: () => ({ querySubscriptions: async () => unknown }) }, '@/lib/purchases': products,
  });
  await old.recoverAndroidPlayAcknowledgements(() => true);
});

test('persistent ACK errors stop after three attempts; successful no-op never retries', async () => {
  for (const success of [false, true]) {
    let calls = 0; const waits = [];
    const billing = load(path.join(root, 'src/lib/android-play-billing.ts'), {
      'expo-modules-core': { requireOptionalNativeModule: () => ({
        querySubscriptions: async () => unknown,
        acknowledgeSubscriptions: async () => { calls++; return success ? { status: 'inactive', activeProductIds: [], pendingProductIds: [], responseCode: 0 } : unknown; },
      }) }, '@/lib/purchases': products,
    }, { setTimeout: (callback, delay) => { waits.push(delay); callback(); } });
    await billing.recoverAndroidPlayAcknowledgements(() => true);
    assert.equal(calls, success ? 1 : 3); assert.deepEqual(waits, success ? [] : [1000, 2000]);
  }
});


test('query carries only a safe acknowledgement-needed boolean when native provides it', async () => {
  const result = await reader({ querySubscriptions: async () => ({
    status: 'active', activeProductIds: ['wafra_pro_weekly'], pendingProductIds: [], responseCode: 0,
    needsAcknowledgement: false,
  }) })();
  assert.equal(result.needsAcknowledgement, false);
});

test('a new billing session starts its own recovery instead of inheriting a stale backoff', async () => {
  let allowedA = true; let releaseDelay; let calls = 0;
  const billing = load(path.join(root, 'src/lib/android-play-billing.ts'), {
    'expo-modules-core': { requireOptionalNativeModule: () => ({
      querySubscriptions: async () => unknown,
      acknowledgeSubscriptions: async () => { calls++; return calls === 1 ? unknown : { status: 'inactive', activeProductIds: [], pendingProductIds: [], responseCode: 0 }; },
    }) }, '@/lib/purchases': products,
  }, { setTimeout: callback => { releaseDelay = callback; } });
  const a = billing.recoverAndroidPlayAcknowledgements(() => allowedA, {});
  await Promise.resolve(); await Promise.resolve();
  allowedA = false;
  await billing.recoverAndroidPlayAcknowledgements(() => true, {});
  assert.equal(calls, 2); releaseDelay(); await a;
});
