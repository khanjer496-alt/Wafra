'use strict';
// Design language E: the in-context Pro sheet over Settings. Its trigger rules
// are pure (pro-gate.ts); the sheet itself runs from source over the shared
// checkout (useProCheckout), with only the storefront as a boundary.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { createWorkflowHarness, walk, text } = require('../workflows/workflow-harness.cjs');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const gate = load(path.join(root, 'src/lib/pro-gate.ts'));

test('a gated control asks for Pro only when Pro is not active', () => {
  assert.equal(gate.proGateFor(false, 'notifications'), 'notifications');
  assert.equal(gate.proGateFor(false, 'capture'), 'capture');
  assert.equal(gate.proGateFor(true, 'notifications'), null);
  assert.equal(gate.proGateFor(true, 'capture'), null);
});

test('the iOS capture switch opens the sheet only when turning a paused capture on', () => {
  assert.equal(gate.iosCaptureSwitchIntent(true, 'paused'), 'pro');
  // Turning capture OFF is never gated, whatever state it is in.
  assert.equal(gate.iosCaptureSwitchIntent(false, 'paused'), 'set');
  assert.equal(gate.iosCaptureSwitchIntent(true, 'queue-warning'), 'recover');
  assert.equal(gate.iosCaptureSwitchIntent(false, 'queue-warning'), 'set');
  for (const state of ['off', 'waiting-for-alert', 'first-alert-captured', 'needs-automation', 'checking'])
    assert.equal(gate.iosCaptureSwitchIntent(true, state), 'set', state);
});

test('tapping the capture row words keeps its old destinations, with the sheet for a paused capture', () => {
  assert.equal(gate.iosCaptureManageIntent('paused', false), 'pro');
  assert.equal(gate.iosCaptureManageIntent('paused', true), 'pro');
  assert.equal(gate.iosCaptureManageIntent('queue-warning', false), 'recover');
  assert.equal(gate.iosCaptureManageIntent('off', false), 'enable');
  assert.equal(gate.iosCaptureManageIntent('needs-automation', false), 'enable');
  assert.equal(gate.iosCaptureManageIntent('waiting-for-alert', true), 'enable');
  assert.equal(gate.iosCaptureManageIntent('waiting-for-alert', false), 'setup');
  assert.equal(gate.iosCaptureManageIntent('first-alert-captured', false), 'setup');
});

test('Settings routes gated rows to the sheet; only the Pro card still opens /pro', () => {
  const settings = read('src/app/settings.tsx');
  assert.equal((settings.match(/router\.push\('\/pro'\)/g) ?? []).length, 1);
  assert.match(settings, /testID="settings-pro-card"[\s\S]{0,300}router\.push\('\/pro'\)/);
  assert.match(settings, /gated\('notifications', onNotificationAccess\)/);
  assert.match(settings, /intent === 'pro'\) \{\s*setProSheet\('capture'\)/);
  assert.match(settings, /<ProSheet feature=\{proSheet\} onClose=\{\(\) => setProSheet\(null\)\} \/>/);
});

test('the sheet has no purchase path of its own', () => {
  const sheet = read('src/components/pro/pro-sheet.tsx');
  assert.match(sheet, /useProCheckout\(\)/);
  assert.match(sheet, /onPress=\{\(\) => void buySelectedPlan\(\)\}/);
  assert.doesNotMatch(sheet, /purchasePro|useWafraBilling|fetchProOffers|priceString\s*[:=]\s*['"`]|PRO_PRICES|PRO_REFERENCE_PRICE_STRINGS/);
});

const OFFERS = [
  { plan: 'yearly', productId: 'fixture.yearly', priceString: 'STORE-Y 1' },
  { plan: 'monthly', productId: 'fixture.monthly', priceString: 'STORE-M 2' },
];

function sheetHarness({ language = 'en', feature = 'capture', offers = OFFERS, legal = false, platform = 'ios' } = {}) {
  // useProCheckout's five states come first in the sheet body:
  // billingAction, offers, offerState, selectedPlan, notice.
  const h = createWorkflowHarness({ language, platform, state: { pro: false, founderPro: false }, states: { 1: offers, 2: offers.length ? 'ready' : 'unavailable' } });
  const d = h.deps;
  const purchases = [];
  h.local('@/lib/purchases', 'src/lib/purchases.ts');
  h.local('@/lib/pro-copy', 'src/lib/pro-copy.ts');
  d['@/lib/billing'] = { subscriptionManagementUrl: async () => null };
  d['@/lib/public-links'] = { configuredPublicUrl: (key) => (legal ? `https://example.test/${key}` : null) };
  d['@/components/superwall-billing-context'] = { useWafraBilling: () => ({
    available: true, configured: true, configurationError: null,
    fetchProOffers: async () => offers,
    purchasePro: async (productId) => { purchases.push(productId); return 'cancelled'; },
    restorePro: async () => null,
  }) };
  d['@/components/ui/bottom-sheet'] = { BottomSheet: (p) => (p.visible ? h.jsx('BottomSheet', p) : null) };
  h.local('@/hooks/use-pro-checkout', 'src/hooks/use-pro-checkout.ts');
  h.local('@/components/pro/pro-plan-options');
  const sheet = load(path.join(root, 'src/components/pro/pro-sheet.tsx'), d);
  const closes = [];
  const tree = sheet.ProSheet({ feature, onClose: () => closes.push('close') });
  return { h, tree, purchases, closes, words: d['@/lib/settings-e-copy'].settingsECopy(language), t: d['@/lib/i18n'].t };
}

test('a closed sheet draws nothing and asks the store for nothing', () => {
  const { tree, purchases } = sheetHarness({ feature: null });
  assert.equal(tree, null);
  assert.deepEqual(purchases, []);
});

for (const language of ['en', 'ar']) test(`the sheet names the tapped feature and shows only store prices: ${language}`, () => {
  const { tree, words, t, h } = sheetHarness({ language, feature: 'capture' });
  const sheet = walk(tree).find((n) => n.type === 'BottomSheet');
  assert.equal(sheet.props.title, words.proSheetTitle.capture);
  const all = text(tree);
  assert.ok(all.includes(t('featAutoTrackingIosText')), 'says what automatic capture does, in the Pro screen words');
  assert.ok(all.includes(h.deps['@/lib/pro-copy'].proCopy(language).freeText), 'says what stays free');
  for (const offer of OFFERS) assert.ok(all.includes(offer.priceString), offer.priceString);
  const radios = walk(tree).filter((n) => n.props?.accessibilityRole === 'radio');
  assert.deepEqual(radios.map((n) => n.props.testID), ['pro-sheet-plan-yearly', 'pro-sheet-plan-monthly']);
  assert.equal(radios[0].props.accessibilityState.selected, true);
  const buy = walk(tree).find((n) => n.props?.testID === 'pro-sheet-buy');
  assert.ok(buy.props.accessibilityLabel.includes('STORE-Y 1'), 'the button carries the store price of the chosen plan');
});

test('the notifications sheet explains the notification reader', () => {
  const { tree, words, h } = sheetHarness({ feature: 'notifications', platform: 'android' });
  assert.equal(walk(tree).find((n) => n.type === 'BottomSheet').props.title, words.proSheetTitle.notifications);
  assert.ok(text(tree).includes(h.deps['@/lib/pro-copy'].proCopy('en').notificationsText));
});

test('without store prices the sheet shows none and cannot charge', async () => {
  const { tree, purchases, t } = sheetHarness({ offers: [], legal: true });
  const all = text(tree);
  assert.ok(all.includes(t('priceUnavailable')));
  assert.ok(!walk(tree).some((n) => n.props?.accessibilityRole === 'radio'));
  walk(tree).find((n) => n.props?.testID === 'pro-sheet-buy').props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(purchases, [], 'no offer, no store call');
});

test('buying from the sheet refuses without legal links and otherwise goes through the shared checkout', async () => {
  const missing = sheetHarness({ legal: false });
  walk(missing.tree).find((n) => n.props?.testID === 'pro-sheet-buy').props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(missing.purchases, [], 'the legal guard runs before the store is asked');

  const ready = sheetHarness({ legal: true });
  walk(ready.tree).find((n) => n.props?.testID === 'pro-sheet-buy').props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ready.purchases, ['fixture.yearly']);
});

test('Not now closes the sheet and charges nothing', () => {
  const { tree, closes, purchases } = sheetHarness();
  walk(tree).find((n) => n.props?.testID === 'pro-sheet-not-now').props.onPress();
  assert.deepEqual(closes, ['close']);
  assert.deepEqual(purchases, []);
});

test('a paused iPhone capture switch opens the sheet, not the Pro route', () => {
  const h = createWorkflowHarness({ platform: 'ios' });
  h.deps['@/hooks/use-auto-import'] = { useAutoImport: () => ({
    captureState: 'paused', iosCaptureStatus: { enabled: false, pending: 0, dropped: 0, corrupt: false, lastHandledAt: null },
    recoverIosCaptureQueue: async () => true,
  }) };
  const tree = h.renderScreen('settings');
  const row = walk(tree).find((n) => n.props?.testID === 'settings-automatic-capture');
  const toggle = walk(row).find((n) => n.props?.accessibilityRole === 'switch');
  toggle.props.onPress();
  assert.ok(h.events.some((e) => e[0] === 'state' && e[2] === 'capture'), 'the sheet opens on automatic capture');
  assert.ok(!h.events.some((e) => e[0] === 'route'), 'Settings stays where it is');
  assert.ok(!h.events.some((e) => e[0] === 'setCaptureOptOut'), 'nothing about capture is saved');
});
