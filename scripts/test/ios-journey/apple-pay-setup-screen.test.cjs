const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../repair/load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const walk = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(walk) : [n, ...walk(n.props?.children)];
const health = load(path.join(root, 'src/lib/ios-capture-health.ts'));
const helper = load(path.join(root, 'src/lib/ios-apple-pay-setup.ts'), { './ios-capture-health': health }, { URL });
const progressApi = load(path.join(root, 'src/lib/ios-message-onboarding.ts'), {
  '@react-native-async-storage/async-storage': {}, './ios-setup-journey': { futureSetupConfigured: () => false },
  './ios-history-setup': { isIosHistoryShortcutInstalled: async () => false },
});

async function screen({ version = '27.0', nativePresent = true, capability = true, enabled = false, entitled = true, proof = null, received = null, bundled = true, installed = false, saved = null, fromOnboarding = '1', onboarded = false, cards, links, accounts = [] } = {}) {
  const slots = [], effects = [], events = [], urls = [], shares = [], routes = [], listeners = [];
  let cursor = 0, generation = 1, holdNext;
  const generationFn = () => generation;
  let status = { enabled, entitled, pending: 0, dropped: 0, corrupt: false, applePayPending: 0,
    setupProofVersion: 3, firstCapturedAt: Date.now(), applePaySetupProofAt: proof,
    firstApplePayReceivedAt: received, lastApplePayReceivedAt: received };
  let progress = saved ?? { version: 1, activeSection: 'future', futureCaptureSource: 'apple-pay', futureShortcutConfirmed: installed,
    futureAutomationConfirmed: false, futureStatus: 'in-progress', historyShortcutConfirmed: false, historyStatus: 'not-started', returnToOnboarding: true };
  const slot = create => slots[cursor++] ?? (slots[cursor - 1] = create());
  const react = {
    useRef: value => slot(() => ({ current: value })),
    useState(value) { const s = slot(() => ({ value })); return [s.value, x => { s.value = typeof x === 'function' ? x(s.value) : x; }]; },
    useCallback(fn, deps) { const s = slot(() => ({})); if (!s.deps || deps.some((v, i) => v !== s.deps[i])) { s.deps = deps; s.fn = fn; } return s.fn; },
    useEffect(fn, deps) { const s = slot(() => ({})); if (!s.deps || deps.some((v, i) => v !== s.deps[i])) { s.deps = deps; effects.push(() => { s.cleanup?.(); s.cleanup = fn(); }); } },
  };
  const jsx = (type, props) => typeof type === 'function' ? type(props ?? {}) : ({ type, props: props ?? {} });
  const native = { applePayCaptureSupported: capability,
    ...(bundled ? { getApplePayShortcutURL: async () => 'file:///app/WafraLiveCaptureResources.bundle/Wafra%20Apple%20Pay%20v1.shortcut' } : {}),
    getCaptureStatus: async () => { events.push('read-status'); const snapshot = { ...status }; if (holdNext) { const waiting = holdNext; holdNext = null; await waiting; } return snapshot; },
    setCaptureEnabled: async enabled => { events.push(`enabled:${enabled}`); status = { ...status, enabled }; },
    ...(cards === undefined ? {} : { listRecentApplePayCardObservations: async () => {
      if (cards === 'throw') throw new Error('read failed'); return cards; } }),
  };
  const component = load(path.join(root, 'src/app/ios-apple-pay-setup.tsx'), {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Platform: { OS: 'ios', Version: version }, View: 'View', StyleSheet: { create: styles => styles, hairlineWidth: 1 },
      Linking: { openURL: async url => urls.push(url) }, AppState: { addEventListener: (_, fn) => { listeners.push(fn); return { remove() {} }; } } },
    'expo-router': { Redirect: props => ({ type: 'Redirect', props }), Stack: { Screen: 'Screen' }, useRouter: () => ({ dismissTo: route => routes.push(route), push: route => routes.push(route), setParams() {} }), useLocalSearchParams: () => ({ fromOnboarding, shortcutResult: 'success' }) },
    'expo-sharing': { isAvailableAsync: async () => true, shareAsync: async (uri, options) => shares.push({ uri, options }) },
    // The ink band renders its band content, then the sheet; E buttons are the screen's buttons.
    '@/components/ui/band-scaffold': { BandScaffold: p => ({ type: 'BandScaffold', props: { ...p, children: [p.bandContent, p.children] } }) },
    '@/components/themed-text': { ThemedText: 'Text' },
    '@/components/ios-setup-video-card': { IosSetupVideoCard: 'VideoGuide' }, '@/components/ui/band/e-button': { EButton: 'Button' },
    '@/constants/theme': { Fonts: { sansSemi: 'Geist-SemiBold' } },
    '@/hooks/use-band': { useBand: id => ({ id, band: 'band', onBand: 'on', onBandSecondary: 'on2', tile: 'tile', bandRule: 'rule',
      text: 'text', textSecondary: 'text2', rule: 'rule', fill: 'fill', onFill: 'onFill', statusOk: 'ok', statusOver: 'over' }) },
    '@/hooks/use-language': { useLanguage: () => 'en' }, '@/hooks/use-large-text-layout': { useLargeTextLayout: () => false },
    '@/lib/capture-band-copy': load(path.join(root, 'src/lib/capture-band-copy.ts')),
    '@/lib/capture': { getIosCaptureNativeModule: () => nativePresent ? native : null, subscribeIosCaptureStatusRefresh: () => () => {} },
    '@/lib/ios-capture-health': health, '@/lib/ios-apple-pay-setup': helper,
    '@/lib/details-copy': load(path.join(root, 'src/lib/details-copy.ts')),
    '@/lib/ios-message-onboarding': { dispatchIosMessageSetup: async event => { events.push(event); progress = progressApi.reduceIosMessageSetup(progress, event); }, loadIosMessageSetupProgress: async () => progress, progressForSource: progressApi.progressForSource },
    '@/lib/store': { useStore: () => ({ state: { hydrated: true, onboarded, accounts, ...(links ? { applePayCardLinks: links } : {}) },
      getStateGeneration: generationFn,
      setCaptureOptOut: async value => events.push(`opt-out:${value}`),
      forgetApplePayCardLink: async card => { events.push(`forget:${card}`); links = (links ?? []).filter(row => row.cardOrPass !== card); } }) },
  }).default;
  let tree;
  const render = () => { cursor = 0; tree = component(); for (const effect of effects.splice(0)) effect(); };
  const flush = async () => { for (let i = 0; i < 6; i++) { await new Promise(r => setImmediate(r)); render(); } };
  render(); await flush();
  return { events, urls, shares, routes, flush, saved: () => progress, tree: () => tree,
    text: () => walk(tree).filter(n => n.type === 'Text').map(n => n.props.children).join(' '),
    button: label => walk(tree).find(n => n.type === 'Button' && n.props.label === label)?.props,
    async foreground(patch = {}) { status = { ...status, ...patch }; for (const fn of listeners) fn('active'); await flush(); },
    replaceLedger: () => { generation++; },
    holdRead: () => { let resolve; holdNext = new Promise(r => { resolve = r; }); return resolve; },
  };
}

test('unsupported iOS and missing native capability expose no capture action', async () => {
  for (const options of [{ version: '16.6' }, { nativePresent: false }, { capability: false }]) {
    const h = await screen(options);
    assert.equal(h.button('Enable capture on this iPhone'), undefined);
    assert.deepEqual(h.events, []);
  }
});
test('capture requires explicit opt-in and active entitlement', async () => {
  const blocked = await screen({ entitled: false });
  blocked.button('Enable capture on this iPhone').onPress(); await blocked.flush();
  assert.equal(blocked.events.some(e => typeof e === 'string' && /^(enabled|opt-out):/.test(e)), false);
  assert.match(blocked.text(), /Capture access is inactive/);
  const active = await screen();
  assert.equal(active.events.includes('enabled:true'), false);
  active.button('Enable capture on this iPhone').onPress(); await active.flush();
  assert.ok(active.events.indexOf('opt-out:false') < active.events.indexOf('enabled:true'));
});
test('sharing does not confirm installation; permission callback is not native proof', async () => {
  const h = await screen({ enabled: true });
  h.button('Add Apple Pay Shortcut').onPress(); await h.flush();
  assert.equal(h.shares.length, 1);
  assert.equal(h.shares[0].options.UTI, 'com.apple.shortcut');
  assert.match(h.text(), /Installation has not been confirmed/);
  h.button('I added the Shortcut').onPress(); await h.flush();
  h.button('Run permission check').onPress(); await h.flush();
  const url = new URL(h.urls[0]);
  assert.equal(url.searchParams.get('name'), 'Wafra Apple Pay v1');
  assert.equal(url.searchParams.has('input'), false);
  assert.equal(url.searchParams.has('text'), false);
  assert.equal(h.button('I saved the Apple Pay automation').disabled, true);
});
test('manual automation confirmation is separate from native proof and actual receipt', async () => {
  const h = await screen({ enabled: true, installed: true, proof: Date.now() });
  assert.match(h.text(), /Waiting for the first Apple Pay purchase/);
  assert.equal(h.events.some(e => e.type === 'future-automation-confirmed'), false);
  h.button('I saved the Apple Pay automation').onPress(); await h.flush();
  assert.ok(h.events.some(e => e.type === 'future-automation-confirmed'));
  assert.equal(h.routes[0].pathname, '/ios-setup');
  assert.match(h.routes[0].params.applePayReturn, /^\d{13}$/);
  assert.equal(h.routes[0].params.fromOnboarding, '1');
  await h.foreground({ firstApplePayReceivedAt: Date.now(), lastApplePayReceivedAt: Date.now() });
  assert.match(h.text(), /not a payment-settlement confirmation/);
});
test('incomplete events and manual older-binary fallback remain actionable', async () => {
  const h = await screen({ enabled: true, bundled: false });
  assert.match(h.text(), /Keep the whole currency amount/);
  assert.equal(h.button('Add Apple Pay Shortcut'), undefined);
  await h.foreground({ lastApplePayIncompleteAt: Date.now() });
  assert.match(h.text(), /Wallet reached Wafra without usable purchase details/);
  assert.equal(h.button('I saved the Apple Pay automation').disabled, true);
});
test('stale ledger generation cannot enable capture after an awaited status read', async () => {
  const h = await screen();
  const release = h.holdRead();
  h.button('Enable capture on this iPhone').onPress();
  h.replaceLedger(); release(); await h.flush();
  assert.equal(h.events.includes('enabled:true'), false);
  assert.equal(h.events.includes('opt-out:false'), false);
});
test('helper rejects foreign files and keeps receipts distinct from setup checks', () => {
  assert.equal(helper.isBundledApplePayShortcutUri('file:///app/WafraLiveCaptureResources.bundle/Wafra%20Apple%20Pay%20v1.shortcut'), true);
  for (const value of ['https://example.com/a.shortcut', 'file:///private/finance.json', 'file:///private/Wafra Apple Pay v1.shortcut']) assert.equal(helper.isBundledApplePayShortcutUri(value), false);
  const projected = helper.resolveApplePaySetupState({ enabled: true, entitled: true, firstApplePayReceivedAt: Date.now() });
  assert.equal(projected.received, true); assert.equal(projected.checked, false); assert.equal(projected.canConfirm, false);
});

test('setting up Apple Pay keeps a finished SMS setup recorded until Apple Pay is itself confirmed', async () => {
  const sms = { version: 1, activeSection: 'future', futureShortcutConfirmed: true, futureShortcutVersion: 3,
    futureAutomationConfirmed: true, futureStatus: 'complete', historyShortcutConfirmed: false, historyStatus: 'not-started', returnToOnboarding: false };
  const h = await screen({ saved: sms });
  h.button('Enable capture on this iPhone').onPress(); await h.flush();
  h.button('Add Apple Pay Shortcut').onPress(); await h.flush();
  h.button('I added the Shortcut').onPress(); await h.flush();
  assert.equal(h.events.some(e => e.type === 'future-source-changed'), false);
  assert.equal(h.saved().futureCaptureSource, undefined, 'Home still reports the SMS setup');
  assert.deepEqual([h.saved().futureShortcutConfirmed, h.saved().futureShortcutVersion, h.saved().futureAutomationConfirmed, h.saved().futureStatus],
    [true, 3, true, 'complete']);
  assert.match(h.text(), /Shortcut installation confirmed by you/, 'Apple Pay reads its own parked progress');
  await h.foreground({ applePaySetupProofAt: Date.now() });
  h.button('I saved the Apple Pay automation').onPress(); await h.flush();
  assert.equal(h.saved().futureCaptureSource, 'apple-pay');
  assert.equal(h.saved().futureAutomationConfirmed, true);
  assert.equal(h.saved().parkedSources.message.automationConfirmed, true, 'SMS progress is parked, not erased');
});

test('the ink band shows the plain title, one line and an example marked as one; steps and gates stay on the sheet', async () => {
  const h = await screen({ enabled: true });
  const scaffold = h.tree();
  assert.equal(scaffold.type, 'BandScaffold');
  assert.equal(scaffold.props.band, 'home');
  const band = walk(scaffold.props.bandContent);
  const example = band.find(n => n.props?.testID === 'apple-pay-example');
  assert.ok(example, 'the example sits on the band');
  assert.match(example.props.accessibilityLabel, /^Example only\..*waits in Review/);
  const bandText = band.filter(n => n.type === 'Text').map(n => n.props.children).join(' ');
  assert.match(bandText, /Apple Pay purchases/);
  assert.match(bandText, /first purchase from each card asks which account it belongs to/);
  assert.match(bandText, /added automatically/);
  assert.match(bandText, /Example/);
  assert.doesNotMatch(bandText, /•|\d{4}/, 'no card identity is shown');
  const sheet = walk(scaffold.props.children);
  for (const id of ['apple-pay-step-install', 'apple-pay-step-check', 'apple-pay-step-automation']) {
    assert.ok(sheet.some(n => n.props?.testID === id), id);
  }
  assert.ok(sheet.some(n => n.props?.accessibilityLabel === 'Step 1'), 'numbered, not done before the gates');
  assert.ok(sheet.some(n => n.props?.accessibilityLabel === 'Step 2'));
  // What turning capture on covers is read before the button that turns it on.
  const off = walk((await screen()).tree().props.children);
  const scopeAt = off.findIndex(n => n.props?.testID === 'apple-pay-scope');
  const enableAt = off.findIndex(n => n.props?.testID === 'apple-pay-enable' || (n.type === 'Button' && n.props.label === 'Enable capture on this iPhone'));
  assert.ok(scopeAt >= 0 && enableAt > scopeAt, `scope ${scopeAt} precedes enable ${enableAt}`);
  // The back control is inert while a step is running.
  const busy = await screen();
  const release = busy.holdRead();
  busy.button('Enable capture on this iPhone').onPress();
  await new Promise(r => setImmediate(r));
  await busy.flush();
  busy.tree().props.nav.back();
  assert.deepEqual(busy.routes, [], 'no navigation while busy');
  release(); await busy.flush();
  busy.tree().props.nav.back();
  assert.equal(busy.routes[0].pathname, '/ios-setup');
});


test('Apple Pay setup versions validate the whole value and require iOS 17 Wallet automations', () => {
  for (const version of [16, '16.7.2', '15', '27oops', '27.0-beta', ' 27', '27.', '27..1', '', NaN, Infinity, null, {}, true, '999999999999999999999999']) {
    assert.equal(helper.iosSupportsApplePayAutomation(version), false, String(version));
  }
  for (const version of [17, '17.0', 26, '26.6.2', 27, 27.1, '27', '27.0.1', '28.0']) {
    assert.equal(helper.iosSupportsApplePayAutomation(version), true, String(version));
  }
  for (const language of ['en', 'ar']) {
    const copy = helper.iosApplePayCopy(language);
    assert.match(copy.subtitle, /17/); assert.doesNotMatch(copy.subtitle, /27/);
    assert.match(copy.unsupported, /17/);
    // Shortcuts' Replace leaves two same-named copies; never advise it.
    assert.doesNotMatch(copy.addHelp, /Replace|استبدل/);
  }
});

test('older and invalid iOS deep links redirect to SMS setup without native actions or progress loss', async () => {
  const saved = { version: 1, futureCaptureSource: 'apple-pay', futureShortcutConfirmed: true,
    futureAutomationConfirmed: true, futureStatus: 'complete', returnToOnboarding: true };
  for (const version of ['16.7', '15.0', '27oops']) {
    const h = await screen({ version, saved, enabled: true, proof: Date.now(), received: Date.now() });
    assert.equal(h.tree().type, 'Redirect');
    assert.equal(h.tree().props.href.pathname, '/ios-setup');
    assert.equal(h.tree().props.href.params.fromOnboarding, '1');
    assert.equal(h.tree().props.href.params.section, 'future');
    assert.deepEqual(h.events, []); assert.deepEqual(h.urls, []); assert.deepEqual(h.shares, []);
    assert.equal(h.saved(), saved);
  }
  const settings = await screen({ version: '16.1', fromOnboarding: '0', onboarded: true });
  assert.equal(settings.tree().props.href.params.fromOnboarding, undefined);
});


test('source visibility fails closed without changing stored source data', () => {
  const availability = load(path.join(root, 'src/lib/ios-setup-availability.ts'));
  assert.equal(availability.visibleIosSetupSource('apple-pay', { applePay: false, notification: true }), 'message');
  assert.equal(availability.visibleIosSetupSource('apple-pay', { applePay: true, notification: true }), 'apple-pay');
  for (const source of [undefined, null, 'unrecognized', {}, 'Apple-Pay']) {
    assert.equal(availability.visibleIosSetupSource(source, { applePay: true, notification: true }), 'message');
  }
});


test('Apple Pay video appears only with supported native capture and the matching bundled shortcut', async () => {
  for (const options of [{}, { bundled: false }, { capability: false }, { version: '26.6' }]) {
    const h = await screen(options);
    const guides = walk(h.tree()).filter(node => node.type === 'VideoGuide');
    assert.equal(guides.length, Object.keys(options).length === 0 ? 1 : 0);
    if (guides.length) assert.equal(guides[0].props.kind, 'apple-pay');
  }
  const steps = helper.iosApplePayCopy('en').automationSteps.join(' ');
  assert.match(steps, /Shortcuts editor.*Automation section.*Transaction trigger/);
  assert.match(steps, /Amount and Merchant bound to Shortcut Input/);
  assert.doesNotMatch(steps, /Add Run Shortcut|Automation → \+/);
  // iOS 17–26: a personal Transaction automation that runs the bundled Shortcut.
  const legacy = helper.iosApplePayCopy('en').automationStepsLegacy.join(' ');
  assert.match(legacy, /Automation, then \+\. Choose Transaction/);
  assert.match(legacy, /Run Immediately/);
  assert.match(legacy, /Wafra Apple Pay v1/);
  assert.equal(helper.iosApplePayCopy('ar').automationStepsLegacy.length, 3);
});

test('recent Wallet Card or Pass values are listed newest first, on device only, with absent values named', async () => {
  const at = Date.parse('2026-10-11T09:00:00Z');
  const h = await screen({ enabled: true, received: at, cards: [
    JSON.stringify({ receivedAt: at - 60_000 }),
    JSON.stringify({ cardOrPass: 'Visa Gold 1234', receivedAt: at - 30_000 }),
    JSON.stringify({ cardOrPass: 'Apple Card', receivedAt: at }),
    JSON.stringify({ cardOrPass: 'bad\u202e', receivedAt: at }),
    'not json',
  ] });
  const block = walk(h.tree()).find(n => n.props?.testID === 'apple-pay-card-observations');
  assert.ok(block, 'card observations block is shown');
  const lines = walk(block).filter(n => n.type === 'Text' && n.props.type === 'small').map(n => [].concat(n.props.children).join(''));
  assert.equal(lines.length, 3);
  assert.match(lines[0], /· Apple Card$/); assert.match(lines[1], /· Visa Gold 1234$/); assert.match(lines[2], /· No card name sent \(optional\)$/);
  assert.match(h.text(), /Card or Pass from Wallet/);
  assert.match(h.text(), /first purchase from each card asks which account it belongs to; later ones from that card are added automatically/);
  assert.match(h.text(), /card name stays on this iPhone/);
  assert.equal(walk(block).some(n => n.props?.testID === 'apple-pay-card-links'), false, 'no linked-card list without links');
});

test('linked Wallet cards are listed with their account and can be forgotten', async () => {
  const at = Date.parse('2026-10-11T09:00:00Z');
  const h = await screen({ enabled: true, received: at, cards: [], accounts: [
    { id: 'acc-liv', name: 'Liv', kind: 'bank' }, { id: 'acc-old', name: 'Old card', kind: 'card', archived: true },
  ], links: [
    { cardOrPass: 'Apple Cash', accountId: 'acc-liv', linkedAt: at - 1000 },
    { cardOrPass: 'Liv Debit', accountId: 'acc-gone', linkedAt: at - 500 },
    { cardOrPass: 'Old Visa', accountId: 'acc-old', linkedAt: at },
    { cardOrPass: 'Visa Debit', accountId: 'acc-liv', linkedAt: at + 1, ambiguous: true },
  ] });
  const block = walk(h.tree()).find(n => n.props?.testID === 'apple-pay-card-links');
  assert.ok(block, 'links show even when Wallet sent no recent card rows');
  const lines = walk(block).filter(n => n.type === 'Text' && n.props.type === 'small').map(n => [].concat(n.props.children).join(''));
  assert.deepEqual(lines, ['Apple Cash · Liv', 'Liv Debit · account removed or hidden, so purchases ask again',
    'Old Visa · account removed or hidden, so purchases ask again',
    'Visa Debit · confirmed on two accounts. More than one card may share this name, so its purchases always ask. Forget it to choose again']);
  const forgets = walk(block).filter(n => n.type === 'Button' && n.props.label === 'Forget');
  assert.equal(forgets.length, 4);
  assert.equal(forgets[0].props.accessibilityLabel, 'Forget: Apple Cash');
  forgets[0].props.onPress();
  await h.flush();
  assert.ok(h.events.includes('forget:Apple Cash'));
  const after = walk(walk(h.tree()).find(n => n.props?.testID === 'apple-pay-card-links'))
    .filter(n => n.type === 'Text' && n.props.type === 'small').map(n => [].concat(n.props.children).join(''));
  assert.equal(after.some(line => line.startsWith('Apple Cash')), false);
  assert.match(h.text(), /Forget a card to choose its account again on its next purchase/);
});

test('Apple Pay setup copy says the first purchase per card asks and later ones post, in English and Arabic', () => {
  const en = helper.iosApplePayCopy('en'), ar = helper.iosApplePayCopy('ar');
  for (const key of ['intro', 'cardHelp']) {
    assert.match(en[key], /first purchase from each card asks which account it belongs to/, key);
    assert.match(en[key], /added automatically/, key);
    assert.doesNotMatch(en[key], /Each supported purchase goes to Review|not used to choose an account/, key);
    assert.match(ar[key], /أول عملية من كل بطاقة تسألك/, key);
    assert.match(ar[key], /تلقائياً/, key);
  }
  for (const key of ['linksTitle', 'linksHelp', 'linkGone', 'linkAmbiguous', 'forget']) {
    assert.equal(typeof en[key], 'string', key); assert.equal(typeof ar[key], 'string', key);
    assert.notEqual(en[key], ar[key], key);
  }
});

test('no card block on older binaries, empty lists or a failed read; the rest of the screen still loads', async () => {
  for (const cards of [undefined, [], 'throw']) {
    const h = await screen({ enabled: true, received: Date.now(), cards });
    assert.equal(walk(h.tree()).some(n => n.props?.testID === 'apple-pay-card-observations'), false);
    assert.ok(h.text().includes('Last Apple Pay event received'), String(cards));
  }
});

test('card observation helper validates rows and keeps at most five, newest first', () => {
  const at = Date.parse('2026-10-11T09:00:00Z');
  const rows = Array.from({ length: 7 }, (_, i) => JSON.stringify({ cardOrPass: `Card ${i}`, receivedAt: at + i }));
  const parsed = helper.parseApplePayCardObservations(rows);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.map(row => row.cardOrPass))), ['Card 6', 'Card 5', 'Card 4', 'Card 3', 'Card 2']);
  for (const bad of [null, 'x', {}, [42], [JSON.stringify({ receivedAt: 'now' })], [JSON.stringify({ receivedAt: at, cardOrPass: ' x' })],
    [JSON.stringify({ receivedAt: at, cardOrPass: 'x'.repeat(81) })], [JSON.stringify({ receivedAt: at, extra: 1 })]]) {
    assert.equal(helper.parseApplePayCardObservations(bad).length, 0, JSON.stringify(bad));
  }
});

test('the JS reader accepts every value the native sanitizer emits (shared table)', () => {
  const table = JSON.parse(require('node:fs').readFileSync(path.join(root, 'scripts/test/fixtures/apple-pay-card-or-pass.json'), 'utf8'));
  assert.ok(table.cases.length >= 20);
  for (const { name, input, expected } of table.cases) {
    if (expected === null) continue;
    assert.equal(helper.usableCardOrPass(expected), true, name);
    assert.ok(expected.length <= helper.MAX_APPLE_PAY_CARD_OR_PASS_LENGTH, name);
    const [row] = helper.parseApplePayCardObservations([JSON.stringify({ cardOrPass: expected, receivedAt: 1 })]);
    assert.equal(row.cardOrPass, expected, name);
    // Raw inputs carrying controls, bidi or zero-width scalars are never read as-is.
    if (/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/u.test(input)) {
      assert.equal(helper.usableCardOrPass(input), false, name);
    }
  }
});
