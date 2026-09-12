'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../repair/load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const historyInstallUrl = 'https://www.icloud.com/shortcuts/5bd032fe9a464af390ac1aae22af2f08';
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)];
const session = () => ({ sessionId: 'PAGED-11111111-2222-4333-8444-555555555555', status: 'continue', checked: 50,
  accepted: 44, skipped: 6, createdAtMs: Date.now() - 5000, expiresAtMs: Date.now() - 5000 + 86400000 });
async function screen({ progress = null, installed = false, legacyInstalled = false, language = 'en', fromOnboarding = true, available = true, installUrl = historyInstallUrl } = {}) {
  const slots = [], effects = [], urls = [], routes = [], changes = [], handoffs = [], discards = [];
  const listeners = []; let cursor = 0, generation = 1, nativeReads = 0;
  const values = new Map(); if (legacyInstalled) values.set('wafra/ios-paged-shortcut-confirmed/v1', 'true');
  const slot = fn => slots[cursor++] ?? (slots[cursor - 1] = fn());
  const react = {
    useRef: value => slot(() => ({ current: value })),
    useState(value) { const s = slot(() => ({ value: typeof value === 'function' ? value() : value })); return [s.value, x => { s.value = typeof x === 'function' ? x(s.value) : x; }]; },
    useCallback(fn, deps) { const s = slot(() => ({})); if (!s.deps || deps.some((v, i) => v !== s.deps[i])) { s.value = fn; s.deps = deps; } return s.value; },
    useEffect(fn, deps) { const s = slot(() => ({})); if (!s.deps || deps.some((v, i) => v !== s.deps[i])) { s.deps = deps; effects.push(() => { s.cleanup?.(); s.cleanup = fn(); }); } },
  };
  const jsx = (type, props) => typeof type === 'function' ? type(props ?? {}) : ({ type, props: props ?? {} });
  let pending = null;
  const native = { getPagedStatus: async () => { nativeReads++; if (pending) await pending; return progress === null ? null : JSON.stringify(progress); },
    discardSession: async id => { discards.push(id); progress = null; } };
  const store = { getStateGeneration: () => generation };
  const api = load(path.join(root, 'src/lib/ios-paged-setup.ts'), {}, { process: { env: {
    EXPO_PUBLIC_WAFRA_PAGED_HISTORY_BETA: '1', EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL: installUrl,
  } } });
  if (installed) values.set(api.PAGED_HISTORY_INSTALL_KEY, 'true');
  const deps = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { Platform: { OS: 'ios', Version: '26.6' }, View: 'View', ScrollView: 'ScrollView',
      AppState: { addEventListener: (_kind, fn) => { listeners.push(fn); return { remove() {} }; } },
      Linking: { canOpenURL: async () => available, openURL: async value => urls.push(value) } },
    'expo-router': { Redirect: 'Redirect', Stack: { Screen: 'Screen' }, useRouter: () => ({ push: v => routes.push(v), replace: v => routes.push(v) }),
      useLocalSearchParams: () => ({ origin: fromOnboarding ? 'onboarding' : 'settings' }) },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@react-native-async-storage/async-storage': { getItem: async k => values.get(k) ?? null, setItem: async (k, v) => values.set(k, v) },
    '@/components/themed-text': { ThemedText: 'Text' }, '@/components/ui/confirm-sheet': { ConfirmSheet: 'Confirm' },
    '@/components/ui/controls': { Button: 'Button' }, '@/components/ui/screen-header': { ScreenHeader: 'Header' },
    '@/constants/theme': { MaxContentWidth: 640, ScreenPadding: 24, Spacing: { two: 8, three: 12, four: 16 } },
    '@/hooks/use-language': { useLanguage: () => language }, '@/hooks/use-theme': { useTheme: () => ({ background: '#14120F' }) },
    '@/lib/store': { useStore: () => store }, '@/lib/ios-paged-setup': api,
    '@/lib/ios-history-setup': { beginIosHistoryHandoffForOrigin: async (...args) => handoffs.push(args),
      iosHistoryReturnOriginFromParam: value => value, iosSupportsMessageHistory: () => true,
      iosHistorySetupStorageCoordinator: { run: fn => fn() } },
    '@/lib/ios-message-onboarding': { dispatchIosMessageSetup: async value => changes.push(value),
      loadIosMessageSetupProgress: async () => ({ returnToOnboarding: fromOnboarding }) },
    '../../modules/wafra-message-history': { __esModule: true, default: native },
  };
  const component = load(path.join(root, 'src/app/ios-paging-beta.tsx'), deps).default;
  let tree;
  const render = () => { cursor = 0; tree = component(); for (const effect of effects.splice(0)) effect(); return tree; };
  const flush = async () => { for (let i = 0; i < 6; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } };
  render(); await flush();
  return { flush, urls, routes, changes, handoffs, discards, values, get nativeReads() { return nativeReads; },
    button(label) { const found = walk(tree).filter(n => n.type === 'Button' && n.props.label === label); assert.equal(found.length, 1, label); return found[0].props; },
    confirm() { return walk(tree).find(n => n.type === 'Confirm').props; },
    setProgress(value) { progress = value; }, replaceLedger() { generation++; },
    holdNative(value) { pending = value; }, async foreground() { for (const fn of listeners) fn('active'); await flush(); },
    text() { return walk(tree).filter(n => n.type === 'Text').flatMap(n => n.props.children).join(' '); },
  };
}
test('fresh setup does not import on render or install; explicit confirmation starts the matching Shortcut', async () => {
  const s = await screen();
  assert.deepEqual(s.urls, []); assert.deepEqual(s.changes, []);
  assert.equal(s.button('Add the history Shortcut').disabled, false);
  s.button('Add the history Shortcut').onPress(); await s.flush();
  assert.equal(s.urls[0], historyInstallUrl);
  assert.deepEqual(s.handoffs, []); assert.equal(s.values.size, 0);
  s.button('I added it — start import').onPress(); await s.flush();
  assert.match(s.urls[1], /^shortcuts:\/\/x-callback-url\/run-shortcut\?/);
  assert.equal(s.handoffs[0][0], 'onboarding');
  assert.equal(s.changes[0].type, 'history-status-changed'); assert.equal(s.changes[0].status, 'in-progress');
});
test('missing or unapproved install configuration never opens a different shortcut or starts a handoff', async () => {
  for (const installUrl of ['', 'https://example.invalid/unverified.shortcut']) {
    const s = await screen({ installUrl });
    s.button('Add the history Shortcut').onPress(); await s.flush();
    assert.deepEqual(s.urls, []);
    assert.deepEqual(s.handoffs, []);
    assert.deepEqual(s.changes, []);
    assert.equal(s.values.size, 0);
    assert.ok(s.text().includes('Shortcuts is not available'));
  }
});
test('an older confirmed shortcut cannot bypass the new installation even with saved history', async () => {
  const pending = session();
  const s = await screen({ legacyInstalled: true, progress: pending });
  s.button('Add the history Shortcut').onPress(); await s.flush();
  assert.deepEqual(s.urls, [historyInstallUrl]);
  assert.deepEqual(s.handoffs, []);
  assert.deepEqual(s.discards, []);
  s.button('I added it — start import').onPress(); await s.flush();
  assert.equal(new URL(s.urls[1]).searchParams.get('name'), 'Wafra History v2');
  assert.equal(s.handoffs[0][1], Math.floor(pending.createdAtMs));
});
test('resume retains original session timing; completion opens review rather than claiming ledger save', async () => {
  const progress = session(); const s = await screen({ progress, installed: true });
  s.button('Resume saved import').onPress(); await s.flush();
  assert.equal(s.handoffs[0][1], Math.floor(progress.createdAtMs));
  assert.deepEqual(s.discards, []);
  s.setProgress({ ...progress, status: 'complete' }); await s.foreground();
  s.button('Review transactions').onPress(); await s.flush();
  assert.equal(s.routes[0].pathname, '/import-sms'); assert.equal(s.routes[0].params.history, progress.sessionId);
  assert.ok(s.changes.every(v => v.status !== 'complete'));
});
test('discard confirmation is session-specific and cannot delete a concurrently replaced session', async () => {
  const progress = session(); const s = await screen({ progress, installed: true });
  s.button('Discard temporary import').onPress(); await s.flush();
  assert.equal(s.confirm().visible, true); assert.deepEqual(s.discards, []);
  s.setProgress({ ...progress, sessionId: 'PAGED-AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE' });
  s.confirm().onConfirm(); await s.flush(); assert.deepEqual(s.discards, []);
});
test('Arabic help and errors remain usable without Shortcuts or device automation settings', async () => {
  const s = await screen({ language: 'ar', available: false });
  s.button('إضافة اختصار السجل').onPress(); await s.flush();
  assert.deepEqual(s.urls, []); assert.deepEqual(s.handoffs, []);
  assert.match(s.text(), /تطبيق الاختصارات غير متاح/);
});
