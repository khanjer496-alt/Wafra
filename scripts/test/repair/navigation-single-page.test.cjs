const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
// Execute SDK 55's real stack reducer; isolate only its native/React UI imports.
const sdk = load(require.resolve('expo-router/build/layouts/StackClient'), {
  '@react-navigation/native': {}, 'nanoid/non-secure': { nanoid: (() => { let id = 0; return () => String(++id); })() },
  react: {}, 'react/jsx-runtime': {}, './withLayoutContext': { withLayoutContext: () => ({}) },
  '../fork/native-stack/createNativeStackNavigator': { createNativeStackNavigator: () => ({}) },
  '../link/preview/LinkPreviewContext': {},
  '../navigationParams': require('expo-router/build/navigationParams'),
  '../useScreens': {}, './stack-utils': {}, '../utils/children': {}, '../views/Protected': {},
});
const { singlePageId } = load(path.resolve(__dirname, '../../../src/lib/navigation-identity.ts'));
const reducer = sdk.stackRouterOverride({ getStateForAction: () => null }).getStateForAction;
const options = { routeGetIdList: {}, routeParamList: {} };
const initial = () => ({ key: 'root', type: 'stack', index: 0, routeNames: ['home', 'settings', 'account', 'transactions'], routes: [{ key: 'home-1', name: 'home' }], preloadedRoutes: [] });
// Root container state as expo-router 55 builds it: the internal `__root` slot,
// then the root Stack whose focused route is the first segment.
const stackState = (focused, nested) => ({ index: 0, routes: [{ name: '__root', state: {
  index: focused === '(tabs)' ? 0 : 1,
  routes: [{ name: '(tabs)', ...(focused === '(tabs)' && nested ? { state: nested } : {}) }, ...(focused === '(tabs)' ? [] : [{ name: focused }])],
} }] });
const rootRef = (state, ready = true) => ({ isReady: () => ready, getRootState: () => state });
const push = (state, name, params, singular = singlePageId) => reducer(state, { type: 'PUSH', payload: { name, params, singular } }, options);
test('unguarded repeated taps reproduce two identical pages', () => {
  const state = push(push(initial(), 'settings', {}, false), 'settings', {}, false);
  assert.equal(state.routes.length, 3);
});
test('repeated taps keep one page and a single previous screen', () => {
  let state = initial();
  for (let i = 0; i < 10; i++) state = push(state, 'settings', {});
  assert.deepEqual(Array.from(state.routes, r => r.name), ['home', 'settings']);
});
test('different records and filters remain separate destinations', () => {
  let state = push(initial(), 'account', { id: 'a' });
  state = push(state, 'account', { id: 'b' });
  state = push(state, 'transactions', { type: 'income' });
  state = push(state, 'transactions', { type: 'expense' });
  assert.equal(state.routes.length, 5);
});
test('query key order and absent params do not create duplicates', () => {
  let state = push(initial(), 'transactions', { type: 'income', source: 'sms' });
  state = push(state, 'transactions', { source: 'sms', type: 'income' });
  assert.equal(state.routes.length, 2);
  assert.equal(singlePageId('settings', {}), singlePageId('settings', { section: undefined }));
});
test('returning after Back allows opening the page again', () => {
  const opened = push(initial(), 'settings', {});
  const back = { ...opened, index: 0, routes: opened.routes.slice(0, 1) };
  assert.equal(push(back, 'settings', {}).routes.length, 2);
});
test('application hook forwards singular identity and preserves other router actions', () => {
  const calls = [];
  const tabCalls = [];
  const raw = { dismissTo: (...args) => tabCalls.push(args), push: (...args) => calls.push(args), back: () => {}, replace: () => {} };
  const { useRouter } = load(path.resolve(__dirname, '../../../src/hooks/use-app-router.ts'), {
    'expo-router': { useRouter: () => raw, useNavigationContainerRef: () => rootRef(stackState('add-transaction')) }, react: { useMemo: f => f() },
    '@/lib/navigation-identity': { singlePageId },
  });
  const router = useRouter();
  router.push('/settings');
  assert.equal(calls[0][1].dangerouslySingular, singlePageId);
  router.push('/wallet');
  router.push({ pathname: '/flow', params: { view: 'categories' } });
  assert.equal(tabCalls.length, 2);
  assert.equal(calls.length, 1);
  assert.equal(router.back, raw.back);
  assert.equal(router.replace, raw.replace);
  router.push('/settings', { dangerouslySingular: false });
  assert.equal(calls[1][1].dangerouslySingular, false);
  router.push('/wallet', { preserveTabHistory: true });
  assert.equal(calls[2][0], '/wallet');
  assert.equal(calls[2][1].dangerouslySingular, singlePageId);
  assert.equal(calls[2][1].preserveTabHistory, undefined);
  assert.equal(tabCalls.length, 2);
});

test('links within the tab shell navigate instead of sending an unsupported POP_TO to tabs', () => {
  const calls = [];
  const raw = { navigate: (...args) => calls.push(args), dismissTo: () => assert.fail('must not pop inside tabs'), push: () => assert.fail('must not push tabs') };
  const { useRouter } = load(path.resolve(__dirname, '../../../src/hooks/use-app-router.ts'), {
    'expo-router': { useRouter: () => raw, useNavigationContainerRef: () => rootRef(stackState('(tabs)', { index: 0, routes: [{ name: 'index' }, { name: 'flow' }] })) },
    react: { useMemo: f => f() }, '@/lib/navigation-identity': { singlePageId },
  });
  useRouter().push('/flow?view=categories&filter=limited');
  assert.equal(calls[0][0], '/flow?view=categories&filter=limited');
});

test('the hook decides tab-vs-detail at press time and never subscribes to route changes', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(path.resolve(__dirname, '../../../src/hooks/use-app-router.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  // Every screen calls useRouter(); a route subscription re-renders all four
  // mounted tabs on each tab switch (measured on iOS 26 native tabs).
  assert.doesNotMatch(source, /useSegments|usePathname|useRootNavigationState|useGlobalSearchParams/);
  assert.doesNotMatch(source, /expo-router\/build/, 'no private expo-router modules');

  let state = stackState('(tabs)', { index: 1, routes: [{ name: 'index' }, { name: 'flow' }] });
  const navigated = [];
  const dismissed = [];
  const raw = { navigate: (...a) => navigated.push(a), dismissTo: (...a) => dismissed.push(a), push: () => assert.fail('tabs are never pushed') };
  const { useRouter } = load(path.resolve(__dirname, '../../../src/hooks/use-app-router.ts'), {
    'expo-router': {
      useRouter: () => raw,
      useNavigationContainerRef: () => ({ isReady: () => true, getRootState: () => state }),
      useSegments: () => assert.fail('useSegments must not be called'),
    },
    react: { useMemo: f => f() }, '@/lib/navigation-identity': { singlePageId },
  });
  const router = useRouter();
  router.push('/bills');
  // The same router instance sees the later state without re-rendering.
  state = stackState('settings');
  router.push('/bills');
  assert.deepEqual(navigated.map(c => c[0]), ['/bills']);
  assert.deepEqual(dismissed.map(c => c[0]), ['/bills']);
});

test('tab-shell detection mirrors expo-router first segment', () => {
  const { isTabShellFocused } = load(path.resolve(__dirname, '../../../src/hooks/use-app-router.ts'), {
    'expo-router': {}, react: { useMemo: f => f() }, '@/lib/navigation-identity': { singlePageId },
  });
  assert.equal(isTabShellFocused(stackState('(tabs)')), true);
  assert.equal(isTabShellFocused(stackState('(tabs)', { index: 3, routes: [{ name: 'index' }, { name: 'flow' }, { name: 'bills' }, { name: 'wallet' }] })), true);
  assert.equal(isTabShellFocused(stackState('settings')), false);
  assert.equal(isTabShellFocused(stackState('add-transaction')), false);
  // Root slot whose child has not rendered yet: expo-router reads params.screen.
  assert.equal(isTabShellFocused({ routes: [{ name: '__root', params: { screen: '(tabs)' } }] }), true);
  assert.equal(isTabShellFocused({ routes: [{ name: '__root', params: { screen: 'settings' } }] }), false);
  // Top-level not-found/sitemap and an unmounted container are not the tab shell.
  assert.equal(isTabShellFocused({ routes: [{ name: '+not-found' }] }), false);
  assert.equal(isTabShellFocused(undefined), false);
  assert.equal(isTabShellFocused({ index: 0, routes: [] }), false);
});

test('hook result matches expo-router getRouteInfoFromState segments for real states', () => {
  // SDK 55's own segment derivation; only its URL-formatting fork is isolated.
  const { getRouteInfoFromState } = load(require.resolve('expo-router/build/global-state/routeInfo'), {
    '../constants': require('expo-router/build/constants'),
    '../fork/getPathFromState-forks': { appendBaseUrl: (p) => p },
  }, { URLSearchParams });
  const { isTabShellFocused } = load(path.resolve(__dirname, '../../../src/hooks/use-app-router.ts'), {
    'expo-router': {}, react: { useMemo: f => f() }, '@/lib/navigation-identity': { singlePageId },
  });
  const states = [
    stackState('(tabs)'),
    stackState('(tabs)', { index: 2, routes: [{ name: 'index' }, { name: 'flow' }, { name: 'bills' }] }),
    stackState('settings'), stackState('transactions'), stackState('ios-setup'),
    { routes: [{ name: '__root', params: { screen: '(tabs)' } }] },
    { routes: [{ name: '__root', params: { screen: '/(tabs)/bills' } }] },
    { routes: [{ name: '__root', params: { screen: 'settings', params: { screen: '(tabs)' } } }] },
    { routes: [{ name: '__root', state: { routes: [{ name: '(tabs)' }, { name: 'settings' }] } }] },
    { index: 0, routes: [{ name: '__root', state: { index: 0, routes: [{ name: '+not-found' }] } }] },
    { routes: [{ name: '__root', state: { index: 1, routes: [{ name: '(tabs)' }, { name: 'card' }] }, params: { screen: '(tabs)' } }] },
    { routes: [{ name: '+not-found' }] },
    { routes: [{ name: '_sitemap' }] },
  ];
  for (const state of states) {
    assert.equal(isTabShellFocused(state), getRouteInfoFromState(state).segments[0] === '(tabs)', JSON.stringify(state));
  }
});

test('before the root navigator is ready a tab link dismisses without reading state', () => {
  const dismissed = [];
  const raw = { navigate: () => assert.fail('not ready is outside the tabs'), dismissTo: (...a) => dismissed.push(a), push: () => assert.fail('tabs are never pushed') };
  const { useRouter } = load(path.resolve(__dirname, '../../../src/hooks/use-app-router.ts'), {
    'expo-router': {
      useRouter: () => raw,
      useNavigationContainerRef: () => ({ isReady: () => false, getRootState: () => assert.fail('getRootState before ready logs an error') }),
    },
    react: { useMemo: f => f() }, '@/lib/navigation-identity': { singlePageId },
  });
  useRouter().push('/wallet');
  assert.deepEqual(dismissed.map(c => c[0]), ['/wallet']);
});
