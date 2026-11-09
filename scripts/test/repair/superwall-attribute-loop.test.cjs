'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const { createStore } = require('zustand/vanilla');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const sdkPath = name => path.join(root, 'node_modules/expo-superwall/build/src', name);
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(options = {}) {
  let active;
  const contexts = new Map();
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const cell = () => {
    const index = active.cursor++;
    return active.slots[index] ??= {};
  };
  const memo = (factory, dependencies) => {
    const slot = cell();
    if (!same(slot.dependencies, dependencies)) {
      slot.dependencies = dependencies;
      slot.value = factory();
    }
    return slot.value;
  };
  const react = {
    createContext: () => ({ Provider: 'Provider' }), useContext: () => true,
    useMemo: memo, useCallback: (callback, deps) => memo(() => callback, deps),
    useRef: initial => { const slot = cell(); return slot.ref ??= { current: initial }; },
    useState: initial => {
      const slot = cell();
      if (!('state' in slot)) slot.state = typeof initial === 'function' ? initial() : initial;
      // React's setter is one function for the component's life.
      slot.set ??= next => { slot.state = typeof next === 'function' ? next(slot.state) : next; };
      return [slot.state, slot.set];
    },
    useEffect: (callback, dependencies) => {
      const slot = cell();
      if (same(slot.dependencies, dependencies)) return;
      slot.dependencies = dependencies;
      active.effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); });
    },
  };
  // Match the installed SDK's selector semantics while its actual store actions
  // and useSuperwall implementation run below. Native reads return fresh maps.
  const useShallow = selector => {
    const previous = react.useRef();
    return state => {
      const next = selector(state);
      const before = previous.current;
      if (before && Object.keys(before).length === Object.keys(next).length &&
          Object.keys(next).every(key => Object.is(before[key], next[key]))) return before;
      previous.current = next;
      return next;
    };
  };
  const calls = { attributes: [], tracking: [], configure: 0, configureOptions: [], pro: [], snapshots: [], appListeners: new Set(), deferred: [], productRequests: [], purchases: [], playQueries: 0, placements: [] };
  const state = { hydrated: true, privateMode: false, language: 'en', marketId: 'AE',
    onboarded: true, captureOptOut: false, trialStartTs: 0, pro: false,
    transactions: [], ...options.state };
  const native = {
    configure: async (_key, config) => { calls.configure++; calls.configureOptions.push(config); },
    getSubscriptionStatus: async () => ({ status: 'INACTIVE' }),
    getCustomerInfo: async () => ({ entitlements: [] }),
    setUserAttributes: async attributes => { calls.attributes.push(attributes); },
    getUserAttributes: async () => ({ fixture: 'unchanged native attributes' }),
    setEventTrackingBehavior: async behavior => { calls.tracking.push(behavior); },
    products: async ids => { calls.productRequests.push(ids); return options.products ? options.products(ids) : []; },
    purchase: async id => { calls.purchases.push(id); return options.purchase ? options.purchase(id) : { type: 'cancelled' }; },
    restorePurchases: async () => options.restore ? options.restore() : { result: 'restored' },
    addListener: () => ({ remove() {} }),
  };
  const sdk = load(sdkPath('useSuperwall.js'), {
    react, zustand: { create: initializer => {
      const store = createStore(initializer);
      return Object.assign(selector => selector(store.getState()), store);
    } },
    'zustand/shallow': { useShallow }, '../package.json': { version: '1.4.0' },
    './localResources': { resolveLocalResources: async () => undefined },
    './SuperwallExpoModule': native, './SuperwallOptions': {
      DefaultSuperwallOptions: { paywalls: { restoreFailed: {} }, logging: {} },
    },
    './utils/filterUndefined': { filterUndefined: value => value },
  });
  if (options.configured !== false) sdk.useSuperwallStore.setState({ isConfigured: true });
  const user = load(sdkPath('useUser.js'), { './useSuperwall': sdk });
  const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' };
  const rn = { Platform: { OS: options.platform ?? 'android' }, AppState: { addEventListener: (_name, callback) => {
    calls.appListeners.add(callback);
    return { remove: () => calls.appListeners.delete(callback) };
  } }, Linking: { getInitialURL: async () => null, addEventListener: () => ({ remove() {} }) } };
  const provider = load(sdkPath('SuperwallProvider.js'), {
    react, 'react/jsx-runtime': jsx, 'react-native': rn, 'zustand/shallow': { useShallow },
    './CustomPurchaseControllerProvider': { useCustomPurchaseController: () => false },
    './SuperwallExpoModule': native, './useSuperwall': sdk,
    './useSuperwallEvents': { useSuperwallEvents() {} },
  });
  const placement = { state: { status: 'idle' }, registerPlacement: async request => { calls.placements.push(request); } };
  const setPro = value => { calls.pro.push(value); state.pro = value; };
  const productContract = load(path.join(root, 'src/lib/purchases.ts'), {
    'react-native': rn, '@/lib/complimentary-access': { complimentaryAccessUntil: () => 0 },
  });
  const deps = {
    '@/components/complimentary-refresh': { ComplimentaryRefresh: () => null },
    'expo-superwall': { ...sdk, ...user, ...provider, usePlacement: () => placement },
    'expo-localization': { useLocales: () => options.locales ?? [{ languageTag: 'en-AE', regionCode: 'AE' }] },
    react, 'react/jsx-runtime': jsx, 'react-native': rn,
    '@/components/superwall-billing-context': { WafraBillingContext: { Provider: 'Billing' },
      unavailableBilling: { available: false, configured: false, purchasePro: async () => 'unavailable' } },
    '@/lib/billing': {
      entitlementSnapshot: status => status.status === 'UNKNOWN' ? null : { active: status.status === 'ACTIVE' },
      syncStoreCaptureEntitlement: async snapshot => { calls.snapshots.push(snapshot); return true; },
    },
    '@/lib/billing-locale': load(path.join(root, 'src/lib/billing-locale.ts')),
    '@/lib/capture': { subscribeIosCaptureEntitlementReset: () => () => {} },
    '@/lib/android-play-billing': {
      isAndroidPlayBillingAvailable: () => options.playQueryAvailable !== false,
      queryAndroidPlaySubscriptions: async () => {
        calls.playQueries++;
        return options.querySubscriptions ? options.querySubscriptions() : { status: 'inactive', activeProductIds: [], pendingProductIds: [], responseCode: 0 };
      },
    },
    '@/lib/purchases': { ENTITLEMENT_ID: 'pro', trialDaysLeft: current => current.trialStartTs ? 7 : 0,
      proOffersFromProducts: productContract.proOffersFromProducts,
      proProductIdsForPlatform: productContract.proProductIdsForPlatform },
    '@/lib/store': { useStore: () => ({ state, setPro, ensureDurable: async () => {}, setOnboardingProfile() {} }) },
    // Configure waits for Home's first frames; here the frames are always past.
    '@/lib/after-first-frames': { runAfterFirstFrames: task => {
      calls.deferred.push(task);
      if (options.framesPast !== false) task();
      return { cancel() {} };
    } },
  };
  const source = fs.readFileSync(path.join(root, 'src/components/superwall-billing-provider.native.tsx'), 'utf8') +
    '\nexport { SuperwallRuntime };';
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', 'process', '__DEV__', compiled)(name => {
    assert.ok(Object.hasOwn(deps, name), `unexpected dependency ${name}`);
    return deps[name];
  }, module, module.exports, { env: { EXPO_PUBLIC_SUPERWALL_ANDROID_API_KEY: 'fixture-public-key', EXPO_PUBLIC_SUPERWALL_IOS_API_KEY: 'fixture-ios-public-key' } }, false);
  const render = (key, callback) => {
    active = contexts.get(key) ?? { cursor: 0, slots: [], effects: [] };
    contexts.set(key, active);
    active.cursor = 0; active.effects = [];
    const result = callback();
    for (const effect of active.effects) effect();
    return result;
  };
  let runtimeValue = null;
  const receiveRuntime = value => { runtimeValue = value; };
  return {
    state, calls, sdk,
    billing: () => runtimeValue,
    unmountRuntime() {
      for (const slot of contexts.get('runtime')?.slots ?? []) slot?.cleanup?.();
      contexts.delete('runtime');
    },
    async renderRuntime(count = 1) {
      for (let i = 0; i < count; i++) {
        render('runtime', () => module.exports.SuperwallRuntime({ onValue: receiveRuntime }));
        await tick();
      }
    },
    async renderProvider(count = 1, children = null) {
      const trees = [];
      for (let i = 0; i < count; i++) {
        const tree = render('wafra-provider', () => module.exports.SuperwallBillingProvider({ children }));
        trees.push(tree);
        // Configure is deferred (state updates land on the next render), so
        // the SDK element joins the tree beside the app a render later.
        const sdkElement = tree.props.children.find(child => child?.type === provider.SuperwallProvider);
        if (sdkElement) {
          const context = render('sdk-provider', () => provider.SuperwallProvider(sdkElement.props));
          // The runtime inside the SDK provider publishes the billing value up.
          const runtime = context.props.children;
          render('sdk-runtime', () => runtime.type(runtime.props));
        } else if (contexts.has('sdk-runtime')) {
          // The SDK subtree left the tree: run its effects' cleanups, as React would.
          for (const slot of contexts.get('sdk-runtime').slots) slot?.cleanup?.();
          contexts.delete('sdk-runtime');
        }
        await tick();
      }
      return trees;
    },
  };
}

test('billing config uses the device region independently of the selected bank market', async () => {
  for (const fixture of [
    { language: 'en', marketId: 'AE', device: 'JP', want: 'en_JP' },
    { language: 'en', marketId: 'SA', device: 'US', want: 'en_US' },
    { language: 'ar', marketId: 'AE', device: 'KW', want: 'ar_KW' },
    { language: 'en', marketId: 'SA', device: 'SA', want: 'en_SA' },
  ]) {
    const h = harness({ configured: false,
      state: { language: fixture.language, marketId: fixture.marketId },
      locales: [{ languageTag: 'en-' + fixture.device, regionCode: fixture.device }],
    });
    await h.renderProvider(4);
    assert.equal(h.calls.configureOptions[0]?.localeIdentifier, fixture.want);
    assert.equal(h.calls.configure, 1, 'the locale fix must not reconfigure the SDK');
  }
});

test('unchanged app state settles without optional metadata or event collection', async () => {
  const h = harness();
  await h.renderRuntime(20);
  assert.equal(h.calls.attributes.length, 0);
  assert.deepEqual(h.calls.tracking, ['none']);
  assert.equal(h.calls.appListeners.size, 1);
});

test('iOS SDK user/customer/entitlement changes do not write attributes and entitlement synchronization still runs', async () => {
  const h = harness({ platform: 'ios' });
  await h.renderRuntime(3);
  for (let i = 0; i < 6; i++) {
    h.sdk.useSuperwallStore.setState({ user: { changed: i }, customerInfo: { revision: i },
      subscriptionStatus: { status: 'ACTIVE', entitlements: [{ id: 'pro' }] } });
    await h.renderRuntime(2);
  }
  assert.equal(h.calls.attributes.length, 0);
  assert.deepEqual(h.calls.tracking, ['none']);
  assert.deepEqual(h.calls.pro, [true]);
  assert.ok(h.calls.snapshots.length >= 6);
});

test('ledger and onboarding changes never send targeting attributes', async () => {
  const h = harness();
  await h.renderRuntime(3);
  h.state.transactions = [{ id: 'fixture-row', amountFils: 100 }];
  h.state.userName = 'Fixture';
  await h.renderRuntime(3);
  assert.equal(h.calls.attributes.length, 0);
  for (const patch of [{ language: 'ar' }, { marketId: 'SA' }, { captureOptOut: true },
    { onboardingProfile: { focus: 'bills', tracking: 'none', intention: 'control' } }, { trialStartTs: 123 }]) {
    const before = h.calls.attributes.length;
    Object.assign(h.state, patch);
    await h.renderRuntime(3);
    assert.equal(h.calls.attributes.length, before);
  }
  assert.ok(h.calls.attributes.every(attributes => !('transactions' in attributes) && !('userName' in attributes)));
});

test('leaving Private Mode never re-enables optional Superwall collection', async () => {
  const h = harness({ state: { privateMode: true } });
  await h.renderRuntime(4);
  assert.equal(h.calls.attributes.length, 0);
  assert.deepEqual(h.calls.tracking, ['none']);
  h.state.privateMode = false;
  await h.renderRuntime(5);
  assert.equal(h.calls.attributes.length, 0);
  assert.deepEqual(h.calls.tracking, ['none']);
  h.state.privateMode = true;
  h.state.language = 'ar';
  await h.renderRuntime(5);
  assert.equal(h.calls.attributes.length, 0);
  assert.ok(h.calls.tracking.every(value => value === 'none'));
});

test('actual SDK provider configures once across unrelated app and SDK snapshots', async () => {
  const h = harness({ configured: false });
  await h.renderProvider(5);
  assert.equal(h.calls.configure, 1);
  assert.equal(h.calls.deferred.length, 1, 'an onboarded launch defers configure past Home\'s first frames, once');
  h.state.transactions = [{ id: 'fixture-row' }];
  h.sdk.useSuperwallStore.setState({ user: { changed: true } });
  await h.renderProvider(5);
  assert.equal(h.calls.configure, 1);
});

// The app below the billing provider keeps ONE element shape from before
// hydration through configure: switching the wrapper type remounted the
// router, lock and onboarding exactly as Home appeared.
test('the app keeps its place and wrapper across hydration and a deferred configure', async () => {
  const app = { type: 'App', props: {} };
  const h = harness({ configured: false, framesPast: false, state: { hydrated: false } });
  const appSlot = (tree) => {
    const index = tree.props.children.findIndex(child => child?.type === 'Billing');
    return { index, element: tree.props.children[index] };
  };
  const [before] = await h.renderProvider(1, app);
  const unhydrated = appSlot(before);
  assert.ok(unhydrated.index >= 0);
  assert.equal(unhydrated.element.props.children, app);
  assert.equal(unhydrated.element.props.value.available, false, 'before hydration: no storefront');
  h.state.hydrated = true;
  const [hydrated] = await h.renderProvider(1, app);
  assert.deepEqual([appSlot(hydrated).index, appSlot(hydrated).element.props.children], [unhydrated.index, app]);
  assert.equal(h.calls.configure, 0, 'configure waits for Home to settle');
  assert.equal(appSlot(hydrated).element.props.value.available, true);
  assert.equal(appSlot(hydrated).element.props.value.configured, false, 'checkout is not offered before configure');
  assert.equal(await appSlot(hydrated).element.props.value.purchasePro('yearly'), 'unavailable');
  assert.deepEqual(h.calls.pro, [], 'the stored Pro flag stands until the store answers');
  assert.equal(h.calls.deferred.length, 1);
  h.calls.deferred[0]();
  const configured = await h.renderProvider(3, app);
  for (const tree of configured) {
    assert.deepEqual([appSlot(tree).index, appSlot(tree).element.props.children], [unhydrated.index, app],
      'the same wrapper at the same position: React keeps the app mounted');
  }
  assert.equal(h.calls.configure, 1);
});

test('a screen that needs checkout before Home settles configures at once', async () => {
  const h = harness({ configured: false, framesPast: false });
  const [first] = await h.renderProvider(1);
  const billing = first.props.children.find(child => child?.type === 'Billing').props.value;
  assert.equal(billing.configured, false);
  assert.equal(h.calls.configure, 0);
  billing.configureNow();
  await h.renderProvider(2);
  assert.equal(h.calls.configure, 1, 'the Pro screen does not wait out the launch delay');
});

test('first run configures without waiting: onboarding can offer checkout', async () => {
  const h = harness({ configured: false, framesPast: false, state: { onboarded: false } });
  await h.renderProvider(3);
  assert.equal(h.calls.deferred.length, 0);
  assert.equal(h.calls.configure, 1);
});

// Erase everything un-hydrates the store, which unmounts the SDK subtree. Its
// last billing value must not be offered by the next one for even a commit.
test('a runtime that unmounts takes its billing value with it', async () => {
  const h = harness({ configured: false, state: { onboarded: false } });
  const billingOf = (tree) => tree.props.children.find(child => child?.type === 'Billing').props.value;
  const settled = await h.renderProvider(4);
  const live = billingOf(settled.at(-1));
  assert.equal(live.available, true);
  assert.equal(live.configureNow, undefined, 'the runtime\'s own value, not the configuring placeholder');
  h.state.hydrated = false;
  const [erased] = await h.renderProvider(1);
  assert.equal(billingOf(erased).available, false);
  h.state.hydrated = true;
  const [rehydrated] = await h.renderProvider(1);
  assert.notEqual(billingOf(rehydrated), live, 'the old runtime\'s value is gone');
  assert.equal(typeof billingOf(rehydrated).configureNow, 'function', 'configuring until the new runtime answers');
});

// Run the actual provider and installed SDK wrapper. Control only native product
// replies, so the allowlist is exercised through the same boundary as checkout.
const planProduct = plan => ({
  productIdentifier: `wafra_pro_${plan}`, fullIdentifier: `wafra_pro_${plan}:${plan}:sw-none`,
  localizedPrice: plan === 'weekly' ? '$4.99' : '$49.99',
  hasFreeTrial: false, subscriptionPeriod: { value: 1, unit: plan === 'weekly' ? 'week' : 'year' },
});
const productId = plan => planProduct(plan).fullIdentifier;
function deferredProductReply() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('a newer pending or failed price lookup cannot buy a previously returned offer', async () => {
  const pending = deferredProductReply();
  let responses = 0;
  const h = harness({ products: () => ++responses === 1 ? [planProduct('weekly')] : pending.promise });
  await h.renderRuntime();
  const billing = h.billing();
  assert.equal(await billing.purchasePro(productId('weekly')), 'unavailable');
  assert.equal((await billing.fetchProOffers()).length, 1);
  const latest = billing.fetchProOffers();
  assert.equal(await billing.purchasePro(productId('weekly')), 'unavailable');
  assert.equal(h.calls.purchases.length, 0);
  pending.reject(new Error('simulated product lookup failed'));
  assert.deepEqual(Array.from(await latest), []);
  assert.equal(await billing.purchasePro(productId('weekly')), 'unavailable');
  assert.equal(h.calls.purchases.length, 0);
});

test('a thrown latest lookup leaves no previously loaded product authorized', async () => {
  let fail = false;
  const h = harness({ products: async () => {
    if (fail) throw new Error('simulated store failure');
    return [planProduct('weekly')];
  } });
  await h.renderRuntime();
  await h.billing().fetchProOffers();
  fail = true;
  assert.deepEqual(Array.from(await h.billing().fetchProOffers()), []);
  assert.equal(await h.billing().purchasePro(productId('weekly')), 'unavailable');
  assert.deepEqual(h.calls.purchases, []);
});

test('an older successful lookup returns no stale offers and cannot replace the latest allowlist', async () => {
  const first = deferredProductReply(), second = deferredProductReply();
  const replies = [first, second];
  const h = harness({ products: () => replies.shift().promise });
  await h.renderRuntime();
  const older = h.billing().fetchProOffers(), latest = h.billing().fetchProOffers();
  second.resolve([planProduct('yearly')]);
  assert.equal((await latest)[0].productId, productId('yearly'));
  first.resolve([planProduct('weekly')]);
  assert.deepEqual(Array.from(await older), []);
  assert.equal(await h.billing().purchasePro(productId('weekly')), 'unavailable');
  assert.equal(await h.billing().purchasePro(productId('yearly')), 'cancelled');
  assert.deepEqual(h.calls.purchases, [productId('yearly')]);
});

test('an older failure cannot revoke a successful newer price lookup', async () => {
  const first = deferredProductReply(), second = deferredProductReply();
  const replies = [first, second];
  const h = harness({ products: () => replies.shift().promise });
  await h.renderRuntime();
  const older = h.billing().fetchProOffers(), latest = h.billing().fetchProOffers();
  second.resolve([planProduct('yearly')]);
  await latest;
  first.reject(new Error('superseded store failure'));
  assert.deepEqual(Array.from(await older), []);
  assert.equal(await h.billing().purchasePro(productId('yearly')), 'cancelled');
  assert.deepEqual(h.calls.purchases, [productId('yearly')]);
});

test('a latest empty catalog keeps an older pending response from authorizing a purchase', async () => {
  const first = deferredProductReply(), second = deferredProductReply();
  const replies = [first, second];
  const h = harness({ products: () => replies.shift().promise });
  await h.renderRuntime();
  const older = h.billing().fetchProOffers(), latest = h.billing().fetchProOffers();
  second.resolve([]);
  assert.deepEqual(Array.from(await latest), []);
  first.resolve([planProduct('weekly')]);
  assert.deepEqual(Array.from(await older), []);
  assert.equal(await h.billing().purchasePro(productId('weekly')), 'unavailable');
  assert.deepEqual(h.calls.purchases, []);
});

test('an unconfigured replacement lookup invalidates in-flight and cached product authorization', async () => {
  const pending = deferredProductReply();
  const h = harness({ products: () => pending.promise });
  await h.renderRuntime();
  const oldFetch = h.billing().fetchProOffers();
  await tick();
  h.sdk.useSuperwallStore.setState({ isConfigured: false });
  await h.renderRuntime();
  assert.deepEqual(Array.from(await h.billing().fetchProOffers()), []);
  pending.resolve([planProduct('weekly')]);
  assert.deepEqual(Array.from(await oldFetch), []);
  h.sdk.useSuperwallStore.setState({ isConfigured: true });
  await h.renderRuntime();
  assert.equal(await h.billing().purchasePro(productId('weekly')), 'unavailable');
  assert.deepEqual(h.calls.purchases, []);
});

const ownedPlaySubscription = { status: 'active', activeProductIds: ['wafra_pro_yearly'], pendingProductIds: [], responseCode: 0 };
const emptyPlaySubscriptions = { status: 'inactive', activeProductIds: [], pendingProductIds: [], responseCode: 0 };
const unavailablePlaySubscriptions = { status: 'unknown', activeProductIds: [], pendingProductIds: [], responseCode: 2 };

test('Android grants purchased access from a fresh successful Play query despite stale SDK inactive state', async () => {
  const h = harness({ querySubscriptions: async () => ownedPlaySubscription });
  await h.renderRuntime(3);
  assert.equal(h.state.pro, true);
  assert.deepEqual(h.calls.pro, [true]);
});

test('Android foreground success with no owned subscriptions revokes paid access and preserves Founder', async () => {
  let reply = ownedPlaySubscription;
  const h = harness({ state: { pro: true, founderPro: true, complimentaryIssuedAt: 123 }, querySubscriptions: async () => reply });
  h.sdk.useSuperwallStore.setState({ subscriptionStatus: { status: 'ACTIVE', entitlements: [{ id: 'pro' }] } });
  await h.renderRuntime(3);
  reply = emptyPlaySubscriptions;
  for (const listener of h.calls.appListeners) listener('active');
  await tick();
  assert.equal(h.state.pro, false);
  assert.equal(h.state.founderPro, true);
  assert.equal(h.state.complimentaryIssuedAt, 123);
});

test('Android query errors and SDK inactive callbacks cannot revoke the last confirmed paid access', async () => {
  const h = harness({ state: { pro: true }, querySubscriptions: async () => unavailablePlaySubscriptions });
  await h.renderRuntime(3);
  h.sdk.useSuperwallStore.setState({ subscriptionStatus: { status: 'INACTIVE' }, customerInfo: { entitlements: [] } });
  await h.renderRuntime(2);
  await h.billing().refresh();
  assert.equal(h.state.pro, true);
  assert.deepEqual(h.calls.pro, []);
});

test('Android a superseded successful empty query cannot overwrite a newer active query', async () => {
  const older = deferredProductReply();
  let count = 0;
  const h = harness({ querySubscriptions: () => ++count === 1 ? older.promise : Promise.resolve(ownedPlaySubscription) });
  await h.renderRuntime();
  await h.billing().refresh();
  older.resolve(emptyPlaySubscriptions);
  await tick();
  assert.equal(h.state.pro, true);
  assert.deepEqual(h.calls.pro, [true]);
});

test('Android purchase invalidates prior queries and verifies after checkout before applying ownership', async () => {
  const older = deferredProductReply(), purchase = deferredProductReply();
  let count = 0;
  const h = harness({ products: async () => [planProduct('yearly')], purchase: () => purchase.promise,
    querySubscriptions: () => ++count === 1 ? older.promise : Promise.resolve(ownedPlaySubscription) });
  await h.renderRuntime();
  await h.billing().fetchProOffers();
  const buying = h.billing().purchasePro(productId('yearly'));
  await tick();
  for (const listener of h.calls.appListeners) listener('active');
  await tick();
  assert.equal(count, 1, 'returning from checkout must not query before the purchase action settles');
  purchase.resolve({ type: 'purchased' });
  assert.equal(await buying, 'purchased');
  older.resolve(emptyPlaySubscriptions);
  await tick();
  assert.equal(h.state.pro, true);
  assert.deepEqual(h.calls.pro, [true]);
});

test('Android restore resolves unknown without revoking access when both store seams fail', async () => {
  const h = harness({ state: { pro: true }, querySubscriptions: async () => unavailablePlaySubscriptions,
    restore: async () => { throw new Error('store disconnected'); } });
  await h.renderRuntime();
  assert.equal(await h.billing().restorePro(), null);
  assert.equal(h.state.pro, true);
});

test('Android restore uses successful Play ownership even if SDK restore reports a transient failure', async () => {
  let reply = emptyPlaySubscriptions;
  const h = harness({ querySubscriptions: async () => reply, restore: async () => ({ result: 'failed' }) });
  await h.renderRuntime();
  reply = ownedPlaySubscription;
  assert.equal(await h.billing().restorePro(), true);
  assert.equal(h.state.pro, true);
});

test('Android a pending Play transaction never grants Pro even when the SDK labels checkout purchased', async () => {
  let reply = emptyPlaySubscriptions;
  const h = harness({ products: async () => [planProduct('yearly')], querySubscriptions: async () => reply,
    purchase: async () => { reply = { ...emptyPlaySubscriptions, pendingProductIds: ['wafra_pro_yearly'] }; return { type: 'purchased' }; } });
  await h.renderRuntime();
  await h.billing().fetchProOffers();
  assert.equal(await h.billing().purchasePro(productId('yearly')), 'pending');
  assert.equal(h.state.pro, false);
});

test('Android query completion after runtime unmount cannot change purchased access', async () => {
  const query = deferredProductReply();
  const h = harness({ querySubscriptions: () => query.promise });
  await h.renderRuntime();
  h.unmountRuntime();
  query.resolve(ownedPlaySubscription);
  await tick();
  assert.deepEqual(h.calls.pro, []);
});

test('an older Android binary without the safe query bridge cannot offer or charge a subscription', async () => {
  const h = harness({ playQueryAvailable: false, state: { pro: true },
    querySubscriptions: async () => unavailablePlaySubscriptions, products: async () => [planProduct('yearly')] });
  await h.renderRuntime();
  assert.equal(h.billing().configured, false);
  assert.deepEqual(Array.from(await h.billing().fetchProOffers()), []);
  assert.equal(await h.billing().purchasePro(productId('yearly')), 'unavailable');
  assert.deepEqual(h.calls.purchases, []);
  assert.equal(h.state.pro, true);
});

test('a Play response arriving after billing becomes unconfigured cannot change cached access', async () => {
  const query = deferredProductReply();
  const h = harness({ querySubscriptions: () => query.promise });
  await h.renderRuntime();
  h.sdk.useSuperwallStore.setState({ isConfigured: false });
  await h.renderRuntime();
  query.resolve(ownedPlaySubscription);
  await tick();
  assert.equal(h.state.pro, false);
});

test('overlapping Android money actions cannot open a second checkout or restore mid-purchase', async () => {
  const purchase = deferredProductReply();
  const h = harness({ products: async () => [planProduct('yearly')], purchase: () => purchase.promise });
  await h.renderRuntime();
  await h.billing().fetchProOffers();
  const first = h.billing().purchasePro(productId('yearly'));
  assert.equal(await h.billing().purchasePro(productId('yearly')), 'unavailable');
  assert.equal(await h.billing().restorePro(), null);
  purchase.resolve({ type: 'cancelled' });
  assert.equal(await first, 'cancelled');
  assert.deepEqual(h.calls.purchases, [productId('yearly')]);
});

test('Android SDK and foreground callbacks cannot supersede the purchase verification or allow another action', async () => {
  const verification = deferredProductReply();
  let count = 0;
  const h = harness({ products: async () => [planProduct('yearly')], purchase: async () => ({ type: 'purchased' }),
    querySubscriptions: () => ++count === 1 ? Promise.resolve(emptyPlaySubscriptions) : verification.promise });
  await h.renderRuntime();
  await h.billing().fetchProOffers();
  const buying = h.billing().purchasePro(productId('yearly'));
  await tick();
  h.sdk.useSuperwallStore.setState({ subscriptionStatus: { status: 'ACTIVE', entitlements: [{ id: 'pro' }] }, customerInfo: { entitlements: [] } });
  await h.renderRuntime();
  for (const listener of h.calls.appListeners) listener('active');
  await tick();
  assert.equal(count, 2, 'only the action owns its post-purchase verification');
  assert.equal(await h.billing().purchasePro(productId('yearly')), 'unavailable');
  assert.equal(await h.billing().restorePro(), null);
  verification.resolve(ownedPlaySubscription);
  assert.equal(await buying, 'purchased');
  assert.equal(h.state.pro, true);
});

test('Android SDK and foreground callbacks cannot turn a confirmed restore into unknown', async () => {
  const verification = deferredProductReply();
  let count = 0;
  const h = harness({ querySubscriptions: () => ++count === 1 ? Promise.resolve(emptyPlaySubscriptions) : verification.promise });
  await h.renderRuntime();
  const restoring = h.billing().restorePro();
  await tick();
  h.sdk.useSuperwallStore.setState({ customerInfo: { entitlements: [{ id: 'pro' }] } });
  await h.renderRuntime();
  for (const listener of h.calls.appListeners) listener('active');
  await tick();
  assert.equal(count, 2);
  verification.resolve(ownedPlaySubscription);
  assert.equal(await restoring, true);
});

for (const action of ['purchase', 'restore']) {
  test(`Android deconfiguration during ${action} cannot query or grant through the old action closure`, async () => {
    const pendingAction = deferredProductReply();
    const h = harness({ products: async () => [planProduct('yearly')], querySubscriptions: async () => emptyPlaySubscriptions,
      purchase: () => pendingAction.promise, restore: () => pendingAction.promise });
    await h.renderRuntime();
    await h.billing().fetchProOffers();
    const result = action === 'purchase'
      ? h.billing().purchasePro(productId('yearly')) : h.billing().restorePro();
    await tick();
    h.sdk.useSuperwallStore.setState({ isConfigured: false });
    await h.renderRuntime();
    pendingAction.resolve(action === 'purchase' ? { type: 'purchased' } : { result: 'restored' });
    assert.equal(await result, action === 'purchase' ? 'unconfirmed' : null);
    assert.equal(h.calls.playQueries, 1);
    assert.equal(h.state.pro, false);
  });

  test(`Android a false-to-true configuration cycle invalidates the old ${action} verification`, async () => {
    const pendingAction = deferredProductReply(), newSessionQuery = deferredProductReply();
    let queries = 0;
    const h = harness({ products: async () => [planProduct('yearly')],
      querySubscriptions: () => ++queries === 1 ? Promise.resolve(emptyPlaySubscriptions) : newSessionQuery.promise,
      purchase: () => pendingAction.promise, restore: () => pendingAction.promise });
    await h.renderRuntime();
    await h.billing().fetchProOffers();
    const result = action === 'purchase'
      ? h.billing().purchasePro(productId('yearly')) : h.billing().restorePro();
    await tick();
    h.sdk.useSuperwallStore.setState({ isConfigured: false });
    await h.renderRuntime();
    h.sdk.useSuperwallStore.setState({ isConfigured: true });
    await h.renderRuntime();
    pendingAction.resolve(action === 'purchase' ? { type: 'purchased' } : { result: 'restored' });
    assert.equal(await result, action === 'purchase' ? 'unconfirmed' : null);
    assert.equal(h.state.pro, false, 'an old session cannot use the new ready flag as ownership proof');
    assert.equal(queries, 2, 'the current session gets its own deferred refresh');
    newSessionQuery.resolve(ownedPlaySubscription);
    await tick();
    assert.equal(h.state.pro, true, 'only the new session response can grant access');
  });
}

for (const platform of ['ios', 'android']) test(`${platform}: SDK initializes with minimal collection options`, async () => {
  const h = harness({ platform, configured: false });
  await h.renderProvider(5);
  const config = h.calls.configureOptions[0];
  assert.equal(config.eventTrackingBehavior, 'none');
  assert.equal(config.isExternalDataCollectionEnabled, false);
  assert.equal(config.enableExperimentalDeviceVariables, false);
  assert.equal(config.shouldObservePurchases, true, 'entitlement observation is preserved');
});

test('paywall and onboarding requests carry no custom targeting or caller attributes', async () => {
  const h = harness({ platform: 'ios' });
  await h.renderRuntime(3);
  await h.billing().presentProPaywall({ source: 'fixture', merchant: 'private fixture' });
  await h.billing().presentOnboardingFlow();
  assert.equal(h.calls.placements.length, 2);
  for (const request of h.calls.placements) assert.deepEqual(Object.keys(request), ['placement']);
});
