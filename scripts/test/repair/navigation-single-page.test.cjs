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
const { singlePageId } = load(path.resolve('src/lib/navigation-identity.ts'));
const reducer = sdk.stackRouterOverride({ getStateForAction: () => null }).getStateForAction;
const options = { routeGetIdList: {}, routeParamList: {} };
const initial = () => ({ key: 'root', type: 'stack', index: 0, routeNames: ['home', 'settings', 'account', 'transactions'], routes: [{ key: 'home-1', name: 'home' }], preloadedRoutes: [] });
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
  const { useRouter } = load(path.resolve('src/hooks/use-app-router.ts'), {
    'expo-router': { useRouter: () => raw, useSegments: () => ['add-transaction'] }, react: { useMemo: f => f() },
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
  const { useRouter } = load(path.resolve('src/hooks/use-app-router.ts'), {
    'expo-router': { useRouter: () => raw, useSegments: () => ['(tabs)', 'index'] },
    react: { useMemo: f => f() }, '@/lib/navigation-identity': { singlePageId },
  });
  useRouter().push('/flow?view=categories&filter=limited');
  assert.equal(calls[0][0], '/flow?view=categories&filter=limited');
});
