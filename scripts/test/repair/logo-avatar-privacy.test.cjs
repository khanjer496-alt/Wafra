'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));

// Executes the real component's state/effect lifecycle while replacing only
// React/native rendering and the resolver boundary. No device data or network.
function harness(kind, { privateMode = false, bundled = null } = {}) {
  const hooks = [];
  let cursor = 0;
  let effects = [];
  let calls = 0;
  let resolveLogo = async () => identity;
  const state = { privateMode };
  const identity = { id: 'fixture', domain: 'choithrams.com', logoUrl: 'https://cdn.brandfetch.io/domain/choithrams.com?c=fixture' };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { value: initial };
      return [hooks[index].value, value => { hooks[index].value = value; }];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = hooks[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        effects.push(() => { previous?.cleanup?.(); hooks[index] = { deps, cleanup: effect() }; });
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const resolve = (...args) => { calls++; return resolveLogo(...args); };
  const deps = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', StyleSheet: { create: v => v } },
    'expo-image': { Image: 'Image' }, '@/constants/theme': { Radius: {} },
    '@/lib/store': { useStore: () => ({ state }) },
    '@/hooks/use-theme': { useTheme: () => ({}) }, '@/components/ui/icon': { Icon: 'Icon' },
    '@/components/ui/category-avatar': { CategoryAvatar: 'Category' },
    '@/components/ui/merchant-logo-assets': { merchantLogoFor: () => bundled },
    '@/lib/merchant-logo-resolver': { resolveRemoteMerchantLogo: resolve },
    '@/lib/bank-logo-resolver': { resolveBankLogo: resolve },
  };
  const module = load(path.join(root, `src/components/ui/${kind}-avatar.tsx`), deps);
  const Component = kind === 'merchant' ? module.MerchantAvatar : module.BankAvatar;
  const props = kind === 'merchant' ? { title: 'Choithrams', category: 'groceries' } : { account: { bankName: 'FAB', kind: 'bank' } };
  return {
    state, identity, get calls() { return calls; }, setResolve: fn => { resolveLogo = fn; },
    render: () => { cursor = 0; return Component(props); },
    flush: () => { const pending = effects; effects = []; pending.forEach(run => run()); },
  };
}
function remoteSources(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.props?.source?.uri) out.push(node.props.source.uri);
  for (const child of [node.props?.children].flat(Infinity)) remoteSources(child, out);
  return out;
}
for (const kind of ['merchant', 'bank']) {
  test(`${kind}: existing local-only preference blocks lookup and remote image sources`, () => {
    const h = harness(kind, { privateMode: true });
    const node = h.render(); h.flush();
    assert.equal(h.calls, 0);
    assert.deepEqual(remoteSources(node), []);
  });
  test(`${kind}: existing remote artwork disappears immediately when local-only preference is enabled`, async () => {
    const h = harness(kind);
    h.render(); h.flush(); await turn();
    assert.equal(remoteSources(h.render()).length, 1);
    h.state.privateMode = true;
    assert.deepEqual(remoteSources(h.render()), [], 'render must hide the URL before the cleanup effect runs');
    h.flush();
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
test('bundled merchant artwork remains available with the legacy local-only preference', () => {
  const h = harness('merchant', { privateMode: true, bundled: { id: 'fixture-local', source: 42 } });
  const node = h.render(); h.flush();
  assert.equal(node.props.source, 42);
  assert.equal(h.calls, 0);
});
