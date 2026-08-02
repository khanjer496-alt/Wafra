/**
 * The Android tab-switch performance configuration, and the library behaviour
 * it depends on.
 *
 * A signed Release build on emulator-5554 (commit 39bd99c) missed 8 of 8
 * frames on warm tab taps, p50 73-77ms, p90 97-113ms, with exactly one
 * rendered frame per tap. Cold start and scrolling were both fine, so the cost
 * was one synchronous block on the UI thread per tap: react-native-screens
 * destroying and rebuilding a whole tab's native View hierarchy through a
 * `commitNowAllowingStateLoss()` FragmentTransaction. The fix is one prop,
 * `detachInactiveScreens={false}` in src/app/(tabs)/_layout.tsx.
 *
 * One prop is easy to delete. It reads like a default, it has no visible
 * effect on a debug build on a fast machine, and nothing in the type system
 * says it is load-bearing — so the regression it prevents can only be seen by
 * building a signed Release and counting frames, which nobody does on a
 * cleanup commit. Hence this file.
 *
 * It also pins the three upstream facts the fix rests on. Each one is a real
 * way a dependency bump could turn the prop into a silent no-op while every
 * other test in the suite stays green:
 *
 *   1. bottom-tabs still defaults detaching ON for Android. If upstream ever
 *      flips the default, the prop is redundant and the comment is a lie.
 *   2. ScreenContainer with enabled=false still renders a plain View, so the
 *      FragmentManager path is never constructed.
 *   3. InnerScreen with enabled=false still falls back to toggling `display`,
 *      so inactive tabs are actually hidden. If that branch changed, all four
 *      tabs would render on top of each other.
 */
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const ROOT = path.join(__dirname, '../..');
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/**
 * Assertions about the app's own config run against code with the comments
 * removed. The prop being checked here is one line and the comment explaining
 * it is forty, so a plain grep matches the explanation rather than the code —
 * which is how the first run of this file failed: the comment saying
 * freezeOnBlur is deliberately absent read as freezeOnBlur being present.
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function readIfPresent(rel) {
  try {
    return read(rel);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The app's own configuration.
// ---------------------------------------------------------------------------

const layout = stripComments(read('src/app/(tabs)/_layout.tsx'));

ok('the tabs navigator opts out of detaching inactive screens',
  /detachInactiveScreens=\{false\}/.test(layout),
  'src/app/(tabs)/_layout.tsx must pass detachInactiveScreens={false} to <Tabs> — ' +
    'without it every warm tab tap destroys and rebuilds a tab\'s native views on the UI thread');

/**
 * freezeOnBlur is not a companion to the above — it is mutually exclusive with
 * it. react-freeze is only wired up inside InnerScreen's `enabled && native`
 * branch, which is the branch detachInactiveScreens={false} opts out of. So
 * adding freezeOnBlur here would look like a second optimisation and do
 * nothing at all. Caught here rather than in review.
 */
ok('freezeOnBlur is not set on the tabs navigator, where it would be a silent no-op',
  !/freezeOnBlur/.test(layout),
  'freezeOnBlur has no effect while detachInactiveScreens is false — ' +
    'react-native-screens only mounts the react-freeze wrapper on the enabled path');

/**
 * `lazy` is what keeps the memory tradeoff bounded: an unvisited tab costs
 * nothing, so retaining views only ever applies to tabs the user has actually
 * opened. Turning it off here would mount all four heavy screens at launch and
 * push the cost back into cold start, which is currently healthy.
 */
ok('lazy tab loading is not disabled',
  !/lazy=\{false\}/.test(layout) && !/lazy:\s*false/.test(layout),
  'unvisited tabs must stay unmounted, otherwise retaining their views moves the cost to cold start');

// ---------------------------------------------------------------------------
// The upstream behaviour the configuration depends on. Skipped rather than
// failed when node_modules is absent, so the suite still runs on a bare
// checkout.
// ---------------------------------------------------------------------------

const tabView = readIfPresent('node_modules/@react-navigation/bottom-tabs/lib/module/views/BottomTabView.js');
if (!tabView) {
  console.log('- react-navigation not installed, skipping the upstream-default checks');
} else {
  /**
   * The default we are overriding. Written upstream as a platform list, so
   * match on Android appearing in the default expression for the prop.
   */
  const defaultExpr = tabView.match(/detachInactiveScreens\s*=\s*([^\n]*)/);
  ok('bottom-tabs still defaults to detaching inactive screens on Android',
    !!defaultExpr && /android/i.test(defaultExpr[1]),
    defaultExpr ? defaultExpr[1].trim() : 'no detachInactiveScreens default found');

  /**
   * The prop has to reach both the container and each screen. If upstream ever
   * stopped threading it to one of them, half the fix would quietly go away.
   */
  ok('the prop is threaded into both the screen container and each screen',
    /MaybeScreenContainer[\s\S]{0,400}enabled: detachInactiveScreens/.test(tabView) &&
      /MaybeScreen[\s\S]{0,600}enabled: detachInactiveScreens/.test(tabView),
    'BottomTabView must pass detachInactiveScreens as `enabled` to MaybeScreenContainer and MaybeScreen');
}

const container = readIfPresent('node_modules/react-native-screens/src/components/ScreenContainer.tsx');
if (!container) {
  console.log('- react-native-screens sources not installed, skipping the escape-hatch checks');
} else {
  /**
   * This is the whole fix: enabled=false must bypass the native container, so
   * ScreenContainer.kt — and its commitNowAllowingStateLoss() transaction —
   * is never in the tree.
   */
  ok('ScreenContainer falls back to a plain View when disabled',
    /if\s*\(enabled\s*&&\s*isNativePlatformSupported\)/.test(container) &&
      /return\s*<View\s*\{\.\.\.rest\}\s*\/>/.test(container),
    'a disabled ScreenContainer must not render the native RNSScreenContainer');

  const screen = readIfPresent('node_modules/react-native-screens/src/components/Screen.tsx');
  if (screen) {
    // Inactive tabs are hidden by `display`, not by being detached.
    ok('a disabled Screen still hides inactive tabs via display',
      /display:\s*activityState\s*!==\s*0\s*\?\s*'flex'\s*:\s*'none'/.test(screen),
      'without this branch all four tabs would draw on top of each other');

    // The reason freezeOnBlur is checked as absent above.
    const freezeIdx = screen.indexOf('DelayedFreeze freeze=');
    const fallbackIdx = screen.search(/display:\s*activityState\s*!==\s*0/);
    ok('react-freeze is still only wired into the enabled path',
      freezeIdx !== -1 && fallbackIdx !== -1 && freezeIdx < fallbackIdx,
      'if freezing became available on the disabled path, freezeOnBlur would be worth revisiting');
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
