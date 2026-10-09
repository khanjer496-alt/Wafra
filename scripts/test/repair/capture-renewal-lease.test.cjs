'use strict';

// iPhone capture runs in a Shortcuts automation, outside the app, and is gated
// by a lease the app mirrors from the store. The lease used to end exactly at
// the subscription period end, so every renewal switched capture off (and every
// message failed the automation) until Wafra was next opened.

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const billing = load(path.join(root, 'src/lib/billing.ts'), {
  'react-native': { Platform: { OS: 'ios' } },
  '@/lib/capture': {
    publishIosCaptureStatusRefresh() {},
    setIosStoreCaptureEntitlementLease: async () => true,
  },
  '@/lib/purchases': { ENTITLEMENT_ID: 'pro', PRO_SKUS: { monthly: 'pro_monthly', yearly: 'pro_yearly' } },
});

const NOW = Date.parse('2026-10-06T08:00:00Z');
const PERIOD_END = '2026-10-10T08:00:00Z';
const active = { status: 'ACTIVE', entitlements: [{ id: 'pro' }] };
const info = (overrides) => ({
  subscriptions: [{
    productId: 'pro_monthly', isActive: true, isRevoked: false, willRenew: true,
    isInGracePeriod: false, isInBillingRetryPeriod: false, expirationDate: PERIOD_END,
    ...overrides,
  }],
});

test('a plan set to renew keeps capture past the period end', () => {
  const snapshot = billing.entitlementSnapshot(active, info({}), NOW);
  assert.equal(snapshot.expirationDateMs, Date.parse(PERIOD_END) + billing.STORE_CAPTURE_RENEWAL_GRACE_MS);
  assert.equal(billing.STORE_CAPTURE_RENEWAL_GRACE_MS, 7 * 24 * 60 * 60 * 1000);
});

test('a cancelled plan stops capture exactly at the period end', () => {
  const snapshot = billing.entitlementSnapshot(active, info({ willRenew: false }), NOW);
  assert.equal(snapshot.expirationDateMs, Date.parse(PERIOD_END));
});

test('a plan in billing retry gets no grace', () => {
  const snapshot = billing.entitlementSnapshot(active, info({ isInBillingRetryPeriod: true }), NOW);
  assert.equal(snapshot.expirationDateMs, Date.parse(PERIOD_END));
});

test('an already expired or revoked transaction never earns grace', () => {
  const expired = billing.entitlementSnapshot(active, info({ expirationDate: '2026-10-01T00:00:00Z' }), NOW);
  assert.equal(expired.expirationDateMs, NOW + billing.STORE_CAPTURE_FALLBACK_LEASE_MS);
  const revoked = billing.entitlementSnapshot(active, info({ isRevoked: true }), NOW);
  assert.equal(revoked.expirationDateMs, NOW + billing.STORE_CAPTURE_FALLBACK_LEASE_MS);
});

test('a confirmed inactive answer still clears capture', () => {
  const snapshot = billing.entitlementSnapshot({ status: 'INACTIVE' }, info({}), NOW);
  assert.deepEqual({ ...snapshot }, { active: false, requestDateMs: NOW, expirationDateMs: null });
});
