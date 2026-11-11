'use strict';
// Covered-screen freeze (Android on, iOS and web OFF until a device pass).
//
// What this pins, and what it does not: the tab content (and ordinary pushed screens) stop
// re-rendering on store changes while another screen covers them, WITHOUT freezing the capture
// and History hosts. It executes the real components with real React (server renderer) and stub
// navigation. It is not a frame-rate or device measurement.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const jsxRuntime = require('react/jsx-runtime');

const policy = () => load(path.join(root, 'src/lib/covered-screen-freeze.ts'), {});
const freezeModule = (overrides = {}) => load(path.join(root, 'src/components/freeze-when-covered.tsx'), {
  react: React, 'react/jsx-runtime': jsxRuntime, '@/lib/covered-screen-freeze': policy(), ...overrides,
});

test('one platform decision: Android on, iOS and web off; exemptions are pinned', () => {
  const p = policy();
  assert.equal(p.freezeCoveredScreens('android'), true);
  assert.equal(p.freezeCoveredScreens('ios'), false, 'iOS stays OFF until App QA Lead\'s device pass');
  assert.equal(p.freezeCoveredScreens('web'), false);
  assert.equal(p.freezeCoveredScreens('windows'), false);
  assert.deepEqual([...p.FREEZE_EXEMPT_ROUTES], ['(tabs)', 'import-sms', 'ios-setup', 'teach-bank-format']);
  assert.ok(p.COVER_FREEZE_DELAY_MS >= 400, 'the screen must stay painted for the whole push animation');
});

test('the freeze suspends children: covered render adds 0 child renders, uncovered renders them once', () => {
  const { FreezeSuspender } = freezeModule();
  let renders = 0;
  const Spy = () => { renders += 1; return React.createElement('span', null, 'home'); };
  const frozen = renderToStaticMarkup(React.createElement(React.Suspense, { fallback: 'F' },
    React.createElement(FreezeSuspender, { freeze: true }, React.createElement(Spy))));
  assert.equal(renders, 0, 'a frozen subtree runs no component code, so no projection can run');
  assert.match(frozen, /F/, 'the Suspense fallback shows while frozen');
  const live = renderToStaticMarkup(React.createElement(React.Suspense, { fallback: 'F' },
    React.createElement(FreezeSuspender, { freeze: false }, React.createElement(Spy))));
  assert.equal(renders, 1);
  assert.match(live, /home/);
});

test('unfreezing releases the pending promise so the subtree resumes', () => {
  const ref = { current: {} };
  const stubReact = { ...React, useRef: () => ref };
  const { FreezeSuspender: Suspender } = freezeModule({ react: stubReact });
  let thrown;
  try { Suspender({ freeze: true, children: null }); } catch (error) { thrown = error; }
  assert.equal(typeof thrown?.then, 'function', 'freezing throws a thenable, as react-freeze does');
  let released = false;
  thrown.then(() => { released = true; });
  assert.equal(Suspender({ freeze: false, children: 'back' }).props.children, 'back');
  return Promise.resolve().then(() => assert.equal(released, true, 'unfreeze resolves the thrown promise'));
});

function hookHarness() {
  const slots = []; let cursor = 0; const effects = []; const timers = [];
  const react = {
    ...React,
    useState: (initial) => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (v) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useEffect: (fn, deps) => { effects.push({ fn, deps }); },
    useRef: () => ({ current: {} }),
  };
  const setTimeoutStub = (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length - 1; };
  const clearTimeoutStub = (id) => { if (timers[id]) timers[id].cleared = true; };
  return {
    react, timers, setTimeoutStub, clearTimeoutStub,
    begin: () => { cursor = 0; effects.length = 0; },
    flush: () => { const cleanups = effects.map(({ fn }) => fn()); return cleanups; },
  };
}

test('freezing waits for the push animation; uncovering unfreezes in the same render', () => {
  const h = hookHarness();
  const p = policy();
  const mod = load(path.join(root, 'src/components/freeze-when-covered.tsx'), {
    react: h.react, 'react/jsx-runtime': jsxRuntime, '@/lib/covered-screen-freeze': p,
  }, { setTimeout: h.setTimeoutStub, clearTimeout: h.clearTimeoutStub });
  const frozenProp = (tree) => tree.props.children.props.freeze;
  // Covered, not yet frozen: children stay painted for the animation.
  h.begin();
  let tree = mod.FreezeWhenCovered({ covered: true, enabled: true, children: 'content' });
  assert.equal(frozenProp(tree), false, 'not frozen at the moment of covering');
  h.flush();
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].ms, p.COVER_FREEZE_DELAY_MS);
  h.timers[0].fn(); // the delay elapses
  h.begin();
  tree = mod.FreezeWhenCovered({ covered: true, enabled: true, children: 'content' });
  assert.equal(frozenProp(tree), true, 'frozen once the delay has elapsed');
  // Uncovered: unfrozen immediately, without waiting for any effect.
  h.begin();
  tree = mod.FreezeWhenCovered({ covered: false, enabled: true, children: 'content' });
  assert.equal(frozenProp(tree), false, 'revealing the screen must show current data on the first frame');
  // Disabled platform: children pass straight through, no Suspense at all.
  h.begin();
  tree = mod.FreezeWhenCovered({ covered: true, enabled: false, children: 'content' });
  assert.equal(tree.type, React.Fragment);
});

function tabsLayout(platform, focused) {
  const jsx = (type, props) => ({ type, props });
  const Tabs = Object.assign(() => null, { Screen: 'TabScreen' });
  const freeze = freezeModule();
  const mod = load(path.join(root, 'src/components/app-tabs-layout.tsx'), {
    react: React, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'expo-router': { Tabs },
    '@react-navigation/native': { useIsFocused: () => focused },
    'react-native': { Platform: { get OS() { return platform; } } },
    '@/components/tab-bar': { WafraTabBar: 'TabBar' },
    '@/components/ui/tab-bar-metrics': { TabBarMetricsProvider: 'Metrics' },
    '@/hooks/use-auto-import': { useAutoImport: () => {} },
    '@/hooks/use-history-import': { useHistoryImport: () => {} },
    '@/hooks/use-shared-alert-formats': { useSharedAlertFormats: () => {} },
    '@/components/freeze-when-covered': freeze,
    '@/lib/covered-screen-freeze': policy(),
  }).default;
  return { tree: mod(), Tabs, FreezeWhenCovered: freeze.FreezeWhenCovered };
}

test('tabs layout: only <Tabs> sits inside the freeze; CaptureOwner is its sibling', () => {
  const { tree, Tabs, FreezeWhenCovered } = tabsLayout('android', false);
  const [owner, frozen] = tree.props.children;
  assert.equal(owner.type.name, 'CaptureOwner', 'capture host stays outside the freeze');
  assert.equal(frozen.type, FreezeWhenCovered);
  assert.equal(frozen.props.covered, true, 'the tab route is covered when the root stack focus is elsewhere');
  assert.equal(frozen.props.enabled, true);
  assert.equal(frozen.props.children.type, Tabs);
  assert.equal(tabsLayout('android', true).tree.props.children[1].props.covered, false);
  assert.equal(tabsLayout('ios', false).tree.props.children[1].props.enabled, false, 'iOS OFF');
  assert.equal(tabsLayout('web', false).tree.props.children[1].props.enabled, false, 'web OFF');
});

test('capture and History hooks stay live while covered: they are not under any freeze', () => {
  const tabs = read('src/components/app-tabs-layout.tsx');
  const ownerAt = tabs.indexOf('<CaptureOwner />');
  const freezeAt = tabs.indexOf('<FreezeWhenCovered');
  const closeAt = tabs.indexOf('</FreezeWhenCovered>');
  assert.ok(ownerAt > -1 && freezeAt > -1 && closeAt > freezeAt);
  assert.ok(ownerAt < freezeAt || ownerAt > closeAt, 'CaptureOwner must not be inside FreezeWhenCovered');
  const hosts = tabs.slice(tabs.indexOf('function CaptureOwner'), tabs.indexOf('export default'));
  assert.match(hosts, /useHistoryImport\(\)/);
  assert.match(hosts, /useAutoImport\(true, false\)/);
  assert.match(hosts, /useSharedAlertFormats\(\)/);
  // The root stack must not freeze the (tabs) route either, or the host would freeze with it.
  const rootLayout = read('src/components/app-root-layout.tsx');
  assert.match(rootLayout, /<Stack\.Screen\s+name="\(tabs\)"\s+options=\{\{[^}]*freezeOnBlur:\s*false/);
});

test('root stack: ordinary pushed screens freeze on Android; the exempt routes are pinned live', () => {
  const rootLayout = read('src/components/app-root-layout.tsx');
  assert.match(rootLayout, /<Stack screenOptions=\{\{ headerShown: false, freezeOnBlur: freezeCoveredScreens\(Platform\.OS\) \}\}>/);
  assert.match(rootLayout, /from '@\/lib\/covered-screen-freeze'/);
  for (const route of policy().FREEZE_EXEMPT_ROUTES) {
    const at = rootLayout.search(new RegExp(`<Stack\\.Screen\\s+name="${route.replace(/[()]/g, '\\$&')}"`));
    assert.ok(at > -1, `${route} must be declared on the root stack`);
    const declaration = rootLayout.slice(at, rootLayout.indexOf('/>', at));
    assert.match(declaration, /freezeOnBlur:\s*false/, `${route} must opt out of the freeze`);
  }
});

test('iOS keeps its own native-tabs layout untouched, and the freeze has no data path', () => {
  assert.doesNotMatch(read('src/components/app-tabs-layout.ios.tsx'), /freeze-when-covered|FreezeWhenCovered/);
  const code = read('src/components/freeze-when-covered.tsx') + read('src/lib/covered-screen-freeze.ts');
  assert.doesNotMatch(code, /@\/lib\/(store|ledger|dashboard-projection|insights|subscriptions)/,
    'freezing changes when screens render, never what any total is');
});
