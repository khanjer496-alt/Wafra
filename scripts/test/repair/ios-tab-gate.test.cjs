'use strict';
// iOS tab gate. expo-router's NativeTabs mounts all four tabs at launch and hard-codes
// freezeContents={false}, so Flow, Bills and Wallet computed whole-ledger figures on every store
// change while hidden. The gate skips a tab's content until its first focus and freezes it while
// unfocused afterwards. Android and web keep their existing behavior (lazy tabs + freezeOnBlur).
//
// Real React (server renderer) proves what renders; a small hook harness proves the state
// sequence across renders. This is not a device or frame measurement.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const jsxRuntime = require('react/jsx-runtime');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const policy = () => load(path.join(root, 'src/lib/covered-screen-freeze.ts'), {});

const shell = { addListener: () => () => {}, name: 'tabs-shell-in-root-stack' };
function gateModule({ platform = 'ios', focused = () => true, react = React, globals, selectedIndex = () => 1 } = {}) {
  const p = policy();
  const freeze = load(path.join(root, 'src/components/freeze-when-covered.tsx'), {
    react, 'react/jsx-runtime': jsxRuntime, '@/lib/covered-screen-freeze': p,
  }, globals);
  return load(path.join(root, 'src/components/ios-tab-gate.tsx'), {
    react, 'react/jsx-runtime': jsxRuntime,
    'react-native': { Platform: { OS: platform } },
    '@react-navigation/native': { useIsFocused: () => focused(), useNavigation: () => ({ getParent: () => shell }),
      useRoute: () => ({ key: 'flow-key' }), useNavigationState: (select) => select({ index: selectedIndex(), routes: [{ key: 'home-key' }, { key: 'flow-key' }] }) },
    '@/components/freeze-when-covered': freeze,
    '@/lib/covered-screen-freeze': p,
    '@/lib/after-first-frames': { runAfterFirstFrames: () => ({ cancel() {} }) },
    // Structure only here; the real pause is proven in tab-held-frame.test.cjs.
    '@/lib/store': { StorePauseBoundary: ({ children }) => children },
    '@/lib/tab-prewarm': { scheduleTabPrewarm: () => ({ cancel() {} }) },
  }, globals);
}

/** A tab body whose render IS the projection work: one call per render. */
function projectionTab() {
  const calls = { n: 0 };
  const Tab = () => { calls.n += 1; return React.createElement('span', null, 'figures'); };
  return { Tab, calls };
}

test('policy: the gate is on for iOS only', () => {
  const p = policy();
  assert.equal(p.gateTabsUntilFocus('ios'), true);
  assert.equal(p.gateTabsUntilFocus('android'), false, 'Android tabs are already lazy and freezeOnBlur');
  assert.equal(p.gateTabsUntilFocus('web'), false);
});

test('non-iOS platforms get the very same screen component back', () => {
  const { Tab } = projectionTab();
  assert.equal(gateModule({ platform: 'android' }).withIosTabGate(Tab), Tab);
  assert.equal(gateModule({ platform: 'web' }).withIosTabGate(Tab), Tab);
  assert.notEqual(gateModule({ platform: 'ios' }).withIosTabGate(Tab), Tab);
});

test('a hidden iOS tab does 0 projection calls before its first focus', () => {
  const { Tab, calls } = projectionTab();
  const Gated = gateModule({ focused: () => false }).withIosTabGate(Tab);
  for (let storeChange = 0; storeChange < 20; storeChange += 1) {
    assert.equal(renderToStaticMarkup(React.createElement(Gated)), '');
  }
  assert.equal(calls.n, 0, 'NativeTabs mounts this tab at launch; nothing may run until it is opened');
});

test('the gate times its freeze from the tab shell route in the root stack', () => {
  const { Tab } = projectionTab();
  const Gated = gateModule({ focused: () => true }).withIosTabGate(Tab);
  const tree = Gated({});
  assert.equal(tree.props.focused, true);
  assert.equal(tree.props.transitions, shell, 'the tab\'s parent navigation, whose events time push and swipe-back');
});

test('the gate knows whether its tab is the selected one', () => {
  const { Tab } = projectionTab();
  const selectedHere = gateModule({ focused: () => false, selectedIndex: () => 1 }).withIosTabGate(Tab)({});
  assert.equal(selectedHere.props.selected, true);
  const elsewhere = gateModule({ focused: () => false, selectedIndex: () => 0 }).withIosTabGate(Tab)({});
  assert.equal(elsewhere.props.selected, false);
});

test('a focused iOS tab renders its content normally', () => {
  const { Tab, calls } = projectionTab();
  const Gated = gateModule({ focused: () => true }).withIosTabGate(Tab);
  assert.match(renderToStaticMarkup(React.createElement(Gated)), /figures/);
  assert.equal(calls.n, 1);
});

function hookHarness() {
  const slots = []; let cursor = 0; const effects = []; const timers = [];
  const react = {
    ...React,
    useState: (initial) => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (v) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useEffect: (fn) => { effects.push(fn); },
    useRef: () => ({ current: {} }),
  };
  return {
    react, timers,
    globals: { setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length - 1; }, clearTimeout() {} },
    begin: () => { cursor = 0; effects.length = 0; },
    flush: () => effects.splice(0).forEach((fn) => fn()),
  };
}

test('lifecycle: skipped until first focus (or pre-warm), paused on the store while unfocused, never unmounted', () => {
  const h = hookHarness();
  const { TabFocusGate } = gateModule({ react: h.react, globals: h.globals });
  const { Tab } = projectionTab();
  const child = React.createElement(Tab);
  // Unfocused before any visit: nothing at all.
  h.begin();
  assert.equal(TabFocusGate({ focused: false, children: child }), null);
  // First focus: the content is handed to a live (uncovered) pause boundary.
  h.begin();
  let tree = TabFocusGate({ focused: true, children: child });
  assert.equal(tree.props.covered, false);
  assert.equal(tree.props.children, child);
  // Leaving the tab: the boundary is told it is covered (it pauses after its delay).
  h.begin();
  tree = TabFocusGate({ focused: false, children: child });
  assert.notEqual(tree, null, 'a visited tab stays mounted, keeping its state and scroll position');
  assert.equal(tree.props.covered, true);
  assert.equal(tree.props.fallback, true, 'a tab left for a sibling pauses on the fallback delay');
  // No Suspense on iOS tabs any more: hiding and re-showing a suspended tree was the cost on the tap.
  assert.doesNotMatch(read('src/components/ios-tab-gate.tsx'), /FreezeWhenCovered|FreezeSuspender|Suspense/);
});

test('every iOS tab route is gated; Android/web route content is unchanged', () => {
  for (const [file, screen] of [
    ['src/app/(tabs)/flow.tsx', 'FlowScreen'], ['src/app/(tabs)/bills.tsx', 'BillsScreen'],
    ['src/app/(tabs)/wallet.tsx', 'WalletScreen'], ['src/app/(tabs)/index.tsx', 'JournalHomeScreen'],
  ]) {
    const source = read(file);
    assert.match(source, /from '@\/components\/ios-tab-gate'/, `${file} must import the gate`);
    assert.match(source, new RegExp(`export default withIosTabGate\\(${screen}\\);`), `${file} must export its gated screen`);
  }
});

test('capture and History stay outside every gate on iOS', () => {
  const ios = read('src/components/app-tabs-layout.ios.tsx');
  assert.doesNotMatch(ios, /ios-tab-gate|withIosTabGate|FreezeWhenCovered/, 'the iOS shell itself is never gated');
  const owner = ios.slice(ios.indexOf('function CaptureOwner'), ios.indexOf('const TABS'));
  assert.match(owner, /useHistoryImport\(\)/);
  assert.match(owner, /useAutoImport\(true, false\)/);
  assert.match(owner, /useSharedAlertFormats\(\)/);
  assert.match(ios, /<CaptureOwner \/>\s*\n[\s\S]*<NativeTabs/, 'CaptureOwner renders beside NativeTabs, not inside a tab');
  for (const file of ['src/app/(tabs)/flow.tsx', 'src/app/(tabs)/bills.tsx', 'src/app/(tabs)/wallet.tsx']) {
    assert.doesNotMatch(read(file), /useHistoryImport|useAutoImport\(true/, `${file} must not own capture or History`);
  }
});

test('the gate has no data path: from the store it takes only the pause boundary', () => {
  const code = read('src/components/ios-tab-gate.tsx');
  assert.match(code, /^import \{ StorePauseBoundary \} from '@\/lib\/store';$/m);
  assert.doesNotMatch(code, /useStore|useStoreSelector|@\/lib\/(ledger|dashboard-projection|insights|subscriptions)/);
});
