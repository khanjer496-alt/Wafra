'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));

// 1.0.2: every merchant and bank logo comes from the online lookup, on by
// default on iOS and Android, with no switch and no consent step. Only a
// saved local-only preference (or a store that has not hydrated yet) stops it.
// A miss, an error or no network leaves the letter avatar.
//
// Executes the real component's state/effect lifecycle while replacing only
// React/native rendering and the resolver boundary. No device data or network.
function harness(kind, { platform = 'ios', privateMode = false, hydrated = true } = {}) {
  const frames = new Map();
  const rootFrame = { hooks: [], cursor: 0 };
  let frame = rootFrame;
  let effects = [];
  let calls = 0;
  const idle = { scheduled: 0, cancelled: 0 };
  let resolveLogo = async () => identity;
  const state = { privateMode, hydrated };
  const identity = { id: 'brandfetch:choithrams.com', domain: 'choithrams.com', logoUrl: 'https://cdn.brandfetch.io/domain/choithrams.com?c=fixture' };
  const react = {
    useState(initial) {
      const hooks = frame.hooks;
      const index = frame.cursor++;
      if (!(index in hooks)) hooks[index] = { value: initial };
      return [hooks[index].value, value => { hooks[index].value = value; }];
    },
    useEffect(effect, deps) {
      const hooks = frame.hooks;
      const index = frame.cursor++;
      const previous = hooks[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        effects.push(() => { previous?.cleanup?.(); hooks[index] = { deps, cleanup: effect() }; });
      }
    },
    // The avatars are React.memo components; the harness calls the inner
    // function directly, so memo is identity here.
    memo: component => component,
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const resolve = (...args) => { calls++; return resolveLogo(...args); };
  const deps = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Platform: { OS: platform }, StyleSheet: { create: v => v, absoluteFill: {}, hairlineWidth: 1 } },
    'expo-image': { Image: 'Image' },
    '@/constants/theme': { Radius: {}, BandPalettes: { light: { accounts: { glyphGround: '#EEE', tint: '#2F6577', rule: '#DDD' } }, dark: { accounts: { glyphGround: '#222', tint: '#7FB4C4', rule: '#333' } } } },
    // Avatars subscribe to the narrow online-logo context, not the whole
    // store, so a ledger mutation cannot re-render every row's artwork. The
    // real provider value is pinned by the store test below.
    '@/lib/store': { useOnlineLogosAllowed: () => state.hydrated && !state.privateMode },
    '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/hooks/use-color-scheme': { useColorScheme: () => 'dark' },
    '@/hooks/use-band': { useBand: () => ({ glyphGround: '#2E2A23' }) },
    '@/components/ui/monogram-avatar': { MonogramAvatar: 'Monogram' },
    '@/lib/merchant-logo-resolver': { resolveRemoteMerchantLogo: resolve },
    '@/lib/bank-logo-resolver': { resolveBankLogo: resolve },
  };
  // Lookups are deferred to an idle turn on the phone; the harness runs the
  // callback immediately so `flush` still observes every effect.
  const module = load(path.join(root, `src/components/ui/${kind}-avatar.tsx`), deps, {
    requestIdleCallback: callback => { idle.scheduled++; callback(); return idle.scheduled; },
    cancelIdleCallback: () => { idle.cancelled++; },
  });
  const Component = kind === 'merchant' ? module.MerchantAvatar : module.BankAvatar;
  const props = kind === 'merchant' ? { title: 'Choithrams', category: 'groceries' } : { account: { bankName: 'FAB', kind: 'bank' } };
  // Expand internal components (LogoTile, the letter wrapper) with their own hook frames.
  function expand(node, keyPath = 'root') {
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') {
      const key = `${keyPath}/${node.type.name}:${node.key ?? ''}`;
      if (!frames.has(key)) frames.set(key, { hooks: [], cursor: 0 });
      const saved = frame;
      frame = frames.get(key); frame.cursor = 0;
      const out = node.type(node.props);
      frame = saved;
      return expand(out, key);
    }
    const children = node.props?.children;
    if (children === undefined) return node;
    const list = [children].flat(Infinity).map((child, i) => expand(child, `${keyPath}.${i}`));
    return { ...node, props: { ...node.props, children: list } };
  }
  return {
    state, identity, idle, props, get calls() { return calls; }, setResolve: fn => { resolveLogo = fn; },
    render: () => { frame = rootFrame; rootFrame.cursor = 0; return expand(Component(props)); },
    flush: () => { const pending = effects; effects = []; pending.forEach(run => run()); },
  };
}
function find(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (predicate(node)) out.push(node);
  for (const child of [node.props?.children].flat(Infinity)) find(child, predicate, out);
  return out;
}
const remoteSources = node => find(node, n => n.type === 'Image').map(n => n.props.source?.uri).filter(Boolean);
const letters = node => find(node, n => n.type === 'Monogram');
const images = node => find(node, n => n.type === 'Image');

for (const platform of ['ios', 'android']) for (const kind of ['merchant', 'bank']) {
  test(`${platform} ${kind}: online logo is on by default with no switch or consent`, async () => {
    const h = harness(kind, { platform });
    h.render(); h.flush(); await turn();
    assert.equal(h.calls, 1, 'one lookup for the visible row');
    assert.equal(h.idle.scheduled, 1, 'the lookup waits for an idle turn, never the render');
    assert.deepEqual(remoteSources(h.render()), [h.identity.logoUrl]);
  });
}

for (const kind of ['merchant', 'bank']) {
  test(`${kind}: the letter shows first and stays until the remote image loads`, async () => {
    const h = harness(kind);
    const first = h.render();
    assert.equal(letters(first).length, 1, 'the row paints a letter before any lookup');
    assert.equal(images(first).length, 0);
    h.flush(); await turn();
    const loading = h.render();
    assert.equal(letters(loading).length, 1, 'resolution supplies a URL, not decoded artwork');
    images(loading)[0].props.onLoad();
    const loaded = h.render();
    assert.equal(letters(loaded).length, 0);
    assert.equal(images(loaded).length, 1);
  });
  test(`${kind}: a lookup miss (no confident match, offline) keeps the letter`, async () => {
    const h = harness(kind);
    h.setResolve(async () => null);
    h.render(); h.flush(); await turn();
    const node = h.render();
    assert.equal(h.calls, 1);
    assert.deepEqual(remoteSources(node), []);
    assert.equal(letters(node).length, 1);
  });
  test(`${kind}: an image error falls back to the letter`, async () => {
    const h = harness(kind);
    h.render(); h.flush(); await turn();
    images(h.render())[0].props.onError();
    const node = h.render();
    assert.deepEqual(remoteSources(node), []);
    assert.equal(letters(node).length, 1);
  });
  test(`${kind}: nothing is looked up before the store hydrates`, async () => {
    const h = harness(kind, { hydrated: false });
    h.render(); h.flush(); await turn();
    assert.equal(h.calls, 0);
    assert.equal(h.idle.scheduled, 0);
  });
  test(`${kind}: saved local-only preference blocks lookup and remote image sources`, () => {
    const h = harness(kind, { privateMode: true });
    const node = h.render(); h.flush();
    assert.equal(h.calls, 0);
    assert.deepEqual(remoteSources(node), []);
    assert.equal(letters(node).length, 1);
  });
  test(`${kind}: existing remote artwork disappears immediately when local-only preference is on`, async () => {
    const h = harness(kind);
    h.render(); h.flush(); await turn();
    assert.equal(remoteSources(h.render()).length, 1);
    h.state.privateMode = true;
    assert.deepEqual(remoteSources(h.render()), [], 'render must hide the URL before the cleanup effect runs');
    h.flush();
    assert.equal(h.idle.cancelled, 1, 'the pending idle job is cancelled on the way out');
  });
  test(`${kind}: late resolution cannot introduce artwork after local-only preference changes`, async () => {
    const h = harness(kind);
    const pending = deferred(); h.setResolve(() => pending.promise);
    h.render(); h.flush();
    h.state.privateMode = true; h.render(); h.flush();
    pending.resolve(h.identity); await turn();
    assert.deepEqual(remoteSources(h.render()), []);
    assert.equal(h.calls, 1);
  });
}

test('merchant: a new title on a mounted row never shows the previous merchant\'s logo', async () => {
  const h = harness('merchant');
  h.render(); h.flush(); await turn();
  assert.equal(remoteSources(h.render()).length, 1);
  h.props.title = 'Another Merchant';
  const next = h.render();
  assert.deepEqual(remoteSources(next), [], 'the old result is keyed to the old title');
  assert.equal(letters(next).length, 1);
  h.flush(); await turn();
  assert.equal(h.calls, 2, 'the new title is looked up');
});

test('the store gate is hydration and local-only mode only; an old saved opt-in is ignored', () => {
  const store = fs.readFileSync(path.join(root, 'src/lib/store.tsx'), 'utf8');
  assert.match(store, /setLogoLookupsAllowed\(next\.hydrated && !next\.privateMode\)/);
  assert.match(store, /OnlineLogosContext\.Provider value=\{state\.hydrated && !state\.privateMode\}/);
  // Neither gate reads the pre-1.0 opt-in value or the platform.
  for (const gate of [store.match(/setLogoLookupsAllowed\(([^;]*)\);/)[1], store.match(/OnlineLogosContext\.Provider value=\{([^}]*)\}/)[1]]) {
    assert.doesNotMatch(gate, /onlineLogosEnabled|Platform/, gate);
  }
  for (const kind of ['merchant', 'bank']) {
    const source = fs.readFileSync(path.join(root, `src/components/ui/${kind}-avatar.tsx`), 'utf8');
    assert.doesNotMatch(source, /Platform\.OS !== 'android'|onlineLogosEnabled|merchant-logo-assets/, `${kind}: no platform gate, opt-in or bundled marks`);
  }
});

test('Settings has no online-logo switch or consent step, and explains the lookup in the privacy sheet', () => {
  const settings = fs.readFileSync(path.join(root, 'src/app/settings.tsx'), 'utf8');
  assert.doesNotMatch(settings, /onlineLogosTitle|onlineLogosEnabled: enabled|settings-online-logos/);
  assert.match(settings, /t\('privacyLogosBody'\)/);
  const strings = fs.readFileSync(path.join(root, 'src/lib/i18n.ts'), 'utf8');
  const body = strings.slice(strings.indexOf('privacyLogosBody:'), strings.indexOf('privacyLegacyTitle:'));
  assert.match(body, /en: 'Merchant and bank logos load online\./);
  assert.match(body, /not the amount, account or card number, or bank message/);
  assert.match(body, /ar: 'تُحمَّل شعارات التجّار والبنوك عبر الإنترنت\./);
  assert.match(body, /دون المبلغ أو رقم الحساب أو البطاقة أو نص رسالة البنك/);
  assert.doesNotMatch(body, /off by default|متوقفة افتراضياً/);
});
