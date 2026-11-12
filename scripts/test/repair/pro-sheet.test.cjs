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

for (const surface of ['sheet', 'screen']) for (const language of ['en', 'ar']) {
  // #213 replaced the disabled button with "load prices again". What must still hold
  // from #177: with no store offer there is no purchase button at all, only the retry.
  test(`${surface}/${language}: no store offer leaves no purchase button, only the retry`, () => {
    const { tree } = sheetHarness({ surface, language, offers: [], legal: true });
    const ids = walk(tree).map(node => node.props?.testID).filter(Boolean);
    assert.ok(!ids.includes(surface === 'sheet' ? 'pro-sheet-buy' : 'pro-buy'), 'no buy button without a store offer');
    assert.ok(ids.includes(surface === 'sheet' ? 'pro-sheet-retry-prices' : 'pro-retry-prices'));
  });
}
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
  assert.match(sheet, /\(\) => void buySelectedPlan\(\)/);
  assert.doesNotMatch(sheet, /purchasePro|useWafraBilling|fetchProOffers|priceString\s*[:=]\s*['"`]|PRO_PRICES|PRO_REFERENCE_PRICE_STRINGS/);
});

// Synthetic formatter fixtures, not live regional prices.
const OFFERS = [
  { plan: 'yearly', productId: 'fixture.yearly', priceString: 'STORE-Y 1' },
  { plan: 'weekly', productId: 'fixture.weekly', priceString: 'د.ك ٤٫٩٩٠' },
];

function sheetHarness({ language = 'en', feature = 'capture', offers = OFFERS, legal = false, platform = 'ios', billingAction = null,
  selectedPlan = 'yearly', largeText = false, surface = 'sheet', available = true, laterOffers = null } = {}) {
  // State slots: the sheet's previous feature (0) and open session (1), then
  // useProCheckout's billingAction (2), offers (3), offerState (4),
  // selectedPlan (5) and notice (6). An open sheet is rendered as the session
  // that opening started.
  const offset = surface === 'sheet' ? 2 : 0;
  const states = { [offset]: billingAction, [offset + 1]: offers, [offset + 2]: offers.length ? 'ready' : 'unavailable',
    [offset + 3]: selectedPlan };
  if (surface === 'sheet' && feature) Object.assign(states, { 0: feature, 1: { feature, id: 1 } });
  const h = createWorkflowHarness({ language, platform, largeText, state: { pro: false, founderPro: false }, states });
  const d = h.deps;
  const purchases = [];
  const fetches = [];
  h.local('@/lib/purchases', 'src/lib/purchases.ts');
  h.local('@/lib/pro-copy', 'src/lib/pro-copy.ts');
  d['@/lib/billing'] = { subscriptionManagementUrl: async () => null };
  d['@/lib/public-links'] = { configuredPublicUrl: (key) => (legal ? `https://example.test/${key}` : null) };
  d['@/components/superwall-billing-context'] = { useWafraBilling: () => ({
    available, configured: available, configurationError: null,
    fetchProOffers: async () => { fetches.push(1); return laterOffers ?? offers; },
    purchasePro: async (productId) => { purchases.push(productId); return 'cancelled'; },
    restorePro: async () => null,
  }) };
  d['@/components/ui/bottom-sheet'] = { BottomSheet: (p) => (p.visible ? h.jsx('BottomSheet', { ...p, children: [p.children, p.footer] }) : null) };
  h.local('@/lib/pro-plans', 'src/lib/pro-plans.ts');
  h.local('@/hooks/use-pro-checkout', 'src/hooks/use-pro-checkout.ts');
  h.local('@/components/pro/pro-plan-options');
  const closes = [];
  const tree = surface === 'sheet'
    ? load(path.join(root, 'src/components/pro/pro-sheet.tsx'), d).ProSheet({ feature, onClose: () => closes.push('close') })
    : load(path.join(root, 'src/app/pro.tsx'), d).default();
  return { h, tree, purchases, fetches, closes, words: d['@/lib/settings-e-copy'].settingsECopy(language), t: d['@/lib/i18n'].t };
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
  assert.deepEqual(radios.map((n) => n.props.testID), ['pro-sheet-plan-yearly', 'pro-sheet-plan-weekly']);
  assert.equal(radios[0].props.accessibilityState.selected, true);
  const buy = walk(tree).find((n) => n.props?.testID === 'pro-sheet-buy');
  assert.ok(buy.props.accessibilityLabel.includes('STORE-Y 1'), 'the button carries the store price of the chosen plan');
});

for (const surface of ['sheet', 'screen']) for (const language of ['en', 'ar']) for (const platform of ['ios', 'android']) {
  test(`weekly selection, store price and renewal terms on the Pro ${surface}: ${language}/${platform}`, async () => {
    const prefix = surface === 'sheet' ? 'pro-sheet-plan' : 'pro-plan';
    const ready = sheetHarness({ language, platform, legal: true, surface, largeText: true });
    const weekly = walk(ready.tree).find((n) => n.props?.testID === `${prefix}-weekly`);
    weekly.props.onPress();
    assert.ok(ready.h.events.some((e) => e[0] === 'state' && e[2] === 'weekly'), 'weekly can be selected');

    const selected = sheetHarness({ language, platform, legal: true, surface, selectedPlan: 'weekly', largeText: true });
    const selectedWeekly = walk(selected.tree).find((n) => n.props?.testID === `${prefix}-weekly`);
    assert.equal(selectedWeekly.props.accessibilityState.checked, true);
    assert.equal(selectedWeekly.props.accessibilityLabel, `${selected.t('weekly')} · ${OFFERS[1].priceString} ${selected.t('perWeek')}`);
    const all = text(selected.tree);
    assert.ok(all.includes(selected.h.deps['@/lib/i18n'].tf('proChargeTimingWeek', { price: OFFERS[1].priceString })));
    assert.ok(!all.includes(selected.h.deps['@/lib/i18n'].tf('proChargeTimingYear', { price: OFFERS[1].priceString })));
    const buy = walk(selected.tree).find((n) => n.props?.testID === (surface === 'sheet' ? 'pro-sheet-buy' : 'pro-buy'));
    assert.ok(buy.props.accessibilityLabel.includes(selected.t('weekly')));
    assert.ok(buy.props.accessibilityLabel.includes(OFFERS[1].priceString), 'exact store string including Arabic digits and three decimals');
    buy.props.onPress();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(selected.purchases, ['fixture.weekly']);
  });
}

for (const language of ['en', 'ar']) test(`a missing weekly plan is explicitly unavailable without a blank-price radio: ${language}`, () => {
  const missing = sheetHarness({ language, offers: OFFERS.slice(0, 1) });
  const all = text(missing.tree);
  assert.ok(all.includes(missing.t('weekly')));
  assert.ok(all.includes(missing.t('priceUnavailable')));
  assert.ok(!walk(missing.tree).some((n) => n.props?.testID === 'pro-sheet-plan-weekly'));
  assert.equal(walk(missing.tree).filter((n) => n.props?.accessibilityRole === 'radio').length, 1);
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
  assert.ok(!walk(tree).some((n) => n.props?.testID === 'pro-sheet-buy'), 'no charge button without a store plan');
  walk(tree).find((n) => n.props?.testID === 'pro-sheet-retry-prices').props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(purchases, [], 'no offer, no store purchase call');
});

for (const surface of ['sheet', 'screen']) for (const language of ['en', 'ar']) {
  const id = surface === 'sheet' ? 'pro-sheet-retry-prices' : 'pro-retry-prices';
  test(`with no store plan the main button retries the prices instead of doing nothing, and says when the store still returns none: ${surface}/${language}`, async () => {
    const { tree, h, t, fetches, purchases } = sheetHarness({ surface, language, offers: [], legal: true });
    const button = walk(tree).find((n) => n.props?.testID === id);
    assert.ok(button, 'a retry button, not a dead "Get Wafra Pro"');
    assert.equal(button.props.accessibilityLabel, t('retryPrices'));
    assert.notEqual(button.props.disabled, true);
    assert.ok(!walk(tree).some((n) => n.props?.testID === (surface === 'sheet' ? 'pro-sheet-buy' : 'pro-buy')));
    const before = fetches.length;
    button.props.onPress();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fetches.length, before + 1, 'tapping asks the store for prices again');
    assert.deepEqual(purchases, [], 'retrying never reaches the purchase path');
    const notices = h.events.filter((e) => e[0] === 'state' && e[2] && typeof e[2] === 'object' && e[2].title);
    assert.ok(notices.some((e) => e[2].title === h.deps['@/lib/pro-copy'].proCopy(language).pricesStillUnavailable && e[2].body === h.deps['@/lib/pro-copy'].proCopy(language).pricesStillUnavailableBody),
      'the user is told plainly that the store still sent nothing');
  });
}

test('the "still no prices" copy exists in English and Arabic, promises nothing about charges, and differs from the panel text', () => {
  const { h, t } = sheetHarness({ offers: [] });
  const { proCopy } = h.deps['@/lib/pro-copy'];
  const en = proCopy('en'), ar = proCopy('ar');
  assert.notEqual(en.pricesStillUnavailable, t('priceUnavailable'));
  assert.notEqual(en.pricesStillUnavailableBody, t('priceUnavailableBody'));
  assert.doesNotMatch(en.pricesStillUnavailableBody, /charged/i);
  assert.match(ar.pricesStillUnavailable, /[\u0600-\u06FF]/);
  assert.match(ar.pricesStillUnavailableBody, /[\u0600-\u06FF]/);
  assert.notEqual(ar.pricesStillUnavailable, en.pricesStillUnavailable);
});

test('a build without a storefront keeps the old button, whose answer is the Play/App Store message', () => {
  const { tree, t } = sheetHarness({ offers: [], available: false });
  assert.equal(walk(tree).find((n) => n.props?.testID === 'pro-sheet-buy').props.accessibilityLabel, t('getPro'));
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

test('while a purchase runs the sheet cannot be dismissed or left', () => {
  const { tree, closes, h } = sheetHarness({ billingAction: 'purchase' });
  const sheet = walk(tree).find((n) => n.type === 'BottomSheet');
  assert.equal(sheet.props.dismissible, false, 'no backdrop, drag, close button or back');
  for (const id of ['pro-sheet-buy', 'pro-sheet-restore', 'pro-sheet-not-now', 'pro-sheet-more']) {
    const control = walk(tree).find((n) => n.props?.testID === id);
    assert.equal(control.props.disabled, true, id);
  }
  assert.deepEqual(closes, []);
  assert.ok(!h.events.some((e) => e[0] === 'route'));
  const idle = sheetHarness();
  assert.notEqual(walk(idle.tree).find((n) => n.type === 'BottomSheet').props.dismissible, false);
});

test('Restore sits in the sheet and goes through the shared checkout', async () => {
  const { tree, t } = sheetHarness();
  const restore = walk(tree).find((n) => n.props?.testID === 'pro-sheet-restore');
  assert.equal(restore.props.accessibilityLabel, t('restorePurchase'));
  assert.match(read('src/components/pro/pro-sheet.tsx'), /onPress=\{\(\) => void restore\(\)\}/);
});

test('when the retry gets the plans, they are shown and no "still no prices" notice appears', async () => {
  const run = sheetHarness({ surface: 'screen', offers: [], laterOffers: OFFERS, legal: true });
  walk(run.tree).find((n) => n.props?.testID === 'pro-retry-prices').props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(run.h.events.some((e) => e[0] === 'state' && Array.isArray(e[2]) && e[2].length === OFFERS.length), 'the offers are stored');
  assert.ok(!run.h.events.some((e) => e[0] === 'state' && e[2] && e[2].title === run.h.deps['@/lib/pro-copy'].proCopy('en').pricesStillUnavailable));
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

test('plan rows do not advertise a retired monthly product or savings claims', () => {
  const { tree, t } = sheetHarness({ offers: [...OFFERS, { plan: 'monthly', productId: 'fixture.retired', priceString: 'RETIRED-MONTHLY' }] });
  const all = text(tree);
  assert.ok(!all.includes('RETIRED-MONTHLY'));
  assert.ok(!all.includes(t('proMostPopular')));
  assert.ok(!walk(tree).some(n => /yearly-(?:saving|popular|per-week)$/.test(n.props?.testID || '')));
  assert.deepEqual(walk(tree).filter(n => n.props?.accessibilityRole === 'radio').map(n => n.props.testID), ['pro-sheet-plan-yearly', 'pro-sheet-plan-weekly']);
});
