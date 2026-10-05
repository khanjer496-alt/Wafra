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
  const calls = { attributes: [], tracking: [], configure: 0, pro: [], snapshots: [], appListeners: new Set(), deferred: [] };
  const state = { hydrated: true, privateMode: false, language: 'en', marketId: 'AE',
    onboarded: true, captureOptOut: false, trialStartTs: 0, pro: false,
    transactions: [], ...options.state };
  const native = {
    configure: async () => { calls.configure++; },
    getSubscriptionStatus: async () => ({ status: 'INACTIVE' }),
    getCustomerInfo: async () => ({ entitlements: [] }),
    setUserAttributes: async attributes => { calls.attributes.push(attributes); },
    getUserAttributes: async () => ({ fixture: 'unchanged native attributes' }),
    setEventTrackingBehavior: async behavior => { calls.tracking.push(behavior); },
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
  const rn = { Platform: { OS: 'android' }, AppState: { addEventListener: (_name, callback) => {
    calls.appListeners.add(callback);
    return { remove: () => calls.appListeners.delete(callback) };
  } }, Linking: { getInitialURL: async () => null, addEventListener: () => ({ remove() {} }) } };
  const provider = load(sdkPath('SuperwallProvider.js'), {
    react, 'react/jsx-runtime': jsx, 'react-native': rn, 'zustand/shallow': { useShallow },
    './CustomPurchaseControllerProvider': { useCustomPurchaseController: () => false },
    './SuperwallExpoModule': native, './useSuperwall': sdk,
    './useSuperwallEvents': { useSuperwallEvents() {} },
  });
  const placement = { state: { status: 'idle' }, registerPlacement: async () => {} };
  const setPro = value => { calls.pro.push(value); state.pro = value; };
  const deps = {
    'expo-superwall': { ...sdk, ...user, ...provider, usePlacement: () => placement },
    react, 'react/jsx-runtime': jsx, 'react-native': rn,
    '@/components/superwall-billing-context': { WafraBillingContext: { Provider: 'Billing' },
      unavailableBilling: { available: false, configured: false, purchasePro: async () => 'unavailable' } },
    '@/lib/billing': {
      entitlementSnapshot: status => status.status === 'UNKNOWN' ? null : { active: status.status === 'ACTIVE' },
      syncStoreCaptureEntitlement: async snapshot => { calls.snapshots.push(snapshot); return true; },
    },
    '@/lib/capture': {},
    '@/lib/purchases': { ENTITLEMENT_ID: 'pro', trialDaysLeft: current => current.trialStartTs ? 7 : 0 },
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
  }, module, module.exports, { env: { EXPO_PUBLIC_SUPERWALL_ANDROID_API_KEY: 'fixture-public-key' } }, false);
  const render = (key, callback) => {
    active = contexts.get(key) ?? { cursor: 0, slots: [], effects: [] };
    contexts.set(key, active);
    active.cursor = 0; active.effects = [];
    const result = callback();
    for (const effect of active.effects) effect();
    return result;
  };
  return {
    state, calls, sdk,
    async renderRuntime(count = 1) {
      for (let i = 0; i < count; i++) {
        render('runtime', () => module.exports.SuperwallRuntime({ children: null }));
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

test('unchanged app state settles after one attribute write despite real SDK user snapshot replacement', async () => {
  const h = harness();
  const before = h.sdk.useSuperwallStore.getState();
  await h.renderRuntime(20);
  assert.notEqual(h.sdk.useSuperwallStore.getState(), before, 'the SDK really replaced its subscribed state');
  assert.equal(h.calls.attributes.length, 1);
  assert.deepEqual(h.calls.tracking, ['all']);
  assert.equal(h.calls.appListeners.size, 1);
});

test('SDK user/customer/entitlement changes do not write attributes and entitlement synchronization still runs', async () => {
  const h = harness();
  await h.renderRuntime(3);
  for (let i = 0; i < 6; i++) {
    h.sdk.useSuperwallStore.setState({ user: { changed: i }, customerInfo: { revision: i },
      subscriptionStatus: { status: 'ACTIVE', entitlements: [{ id: 'pro' }] } });
    await h.renderRuntime(2);
  }
  assert.equal(h.calls.attributes.length, 1);
  assert.deepEqual(h.calls.tracking, ['all']);
  assert.deepEqual(h.calls.pro, [true]);
  assert.ok(h.calls.snapshots.length >= 6);
});

test('unrelated ledger edits are quiet and each targeting metadata change writes exactly once', async () => {
  const h = harness();
  await h.renderRuntime(3);
  h.state.transactions = [{ id: 'fixture-row', amountFils: 100 }];
  h.state.userName = 'Fixture';
  await h.renderRuntime(3);
  assert.equal(h.calls.attributes.length, 1);
  for (const patch of [{ language: 'ar' }, { marketId: 'SA' }, { captureOptOut: true },
    { onboardingProfile: { focus: 'bills', tracking: 'none', intention: 'control' } }, { trialStartTs: 123 }]) {
    const before = h.calls.attributes.length;
    Object.assign(h.state, patch);
    await h.renderRuntime(3);
    assert.equal(h.calls.attributes.length, before + 1);
  }
  assert.equal(h.calls.attributes.at(-1).wafra_trial_days_left, 7);
  assert.ok(h.calls.attributes.every(attributes => !('transactions' in attributes) && !('userName' in attributes)));
});

test('private mode suppresses metadata writes and transitions tracking once per consent change', async () => {
  const h = harness({ state: { privateMode: true } });
  await h.renderRuntime(4);
  assert.equal(h.calls.attributes.length, 0);
  assert.deepEqual(h.calls.tracking, ['none']);
  h.state.privateMode = false;
  await h.renderRuntime(5);
  assert.equal(h.calls.attributes.length, 1);
  assert.deepEqual(h.calls.tracking, ['none', 'all']);
  h.state.privateMode = true;
  h.state.language = 'ar';
  await h.renderRuntime(5);
  assert.equal(h.calls.attributes.length, 1);
  assert.deepEqual(h.calls.tracking, ['none', 'all', 'none']);
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
