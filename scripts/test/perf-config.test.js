/**
 * The Android tab-switch performance configuration.
 *
 * Two things are pinned here, and they are two halves of one story.
 *
 * WHAT WAS TRIED AND FAILED. `detachInactiveScreens={false}` on the tabs
 * navigator. The reasoning was good and the result was not: signed Release
 * builds, one emulator, warm and reseeded, run A/B/A so the control sat on both
 * sides of the change.
 *
 *   default (detaching on)   7/7 janky, p50 81ms,  p90 129ms
 *                            8/8 janky, p50 69ms,  p90 150ms
 *   detachInactiveScreens=0  8/8 janky, p50 500ms, p90 2050ms
 *                            8/8 janky, p50 200ms, p90 500ms   (+22.7MB PSS)
 *
 * Three to seven times slower and 22.7MB heavier. It is pinned as ABSENT
 * because it is exactly the kind of change someone reaches for again — it is
 * the top answer to "react-navigation tab switch slow on Android", it is one
 * prop, and on a debug build on a fast machine it looks harmless.
 *
 * WHAT ACTUALLY COSTS THE TIME. systrace on the default path, same build:
 * the tab's ACTION_UP lands, then ~33 consecutive `Choreographer#doFrame`
 * slices run animation callbacks with no traversal at all — nothing measured,
 * laid out or drawn — and the first traversal/draw arrives 548ms after the tap.
 * The return tap cost 182ms. Those durations are the tab screens' own entering
 * animations: Home and Flow reach delay 120 + duration 320 = 440ms, Wallet's
 * net-worth columns reach 5 x 45 + 360 = 585ms, Bills' recurring rows reach
 * min(i, 8) x 40 + 300 = 620ms. `ScreenFragment` recycles the same `Screen`
 * view across the fragment remove/add, so React never remounts and component
 * state survives — but the native subtree is detached from the window and
 * re-attached, and the entering animation can start again on that path.
 *
 * So every entrance in the four tab screens goes through `useScreenEntering`,
 * which returns undefined on Android. That is easy to bypass by accident: the
 * next person adding a section to a tab copies the line above it, and if that
 * line says `entering={FadeInDown...}` the stall comes straight back for one
 * more section. The check below is the reason it cannot.
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
function readIfPresent(rel) {
  try {
    return read(rel);
  } catch {
    return null;
  }
}

/**
 * Assertions about the app's own config run against code with the comments
 * removed. The code being checked here is a line or two and the comment
 * explaining it is thirty, so a plain grep matches the explanation rather than
 * the code — which is how the first version of this file failed: the comment
 * saying a prop was deliberately absent read as the prop being present.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\/[^\n]*\n/g, '{\n')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const TAB_SCREENS = [
  'src/app/(tabs)/index.tsx',
  'src/app/(tabs)/flow.tsx',
  'src/app/(tabs)/bills.tsx',
  'src/app/(tabs)/wallet.tsx',
];

// ---------------------------------------------------------------------------
// The navigator: the failed fix must stay gone.
// ---------------------------------------------------------------------------

const layout = stripComments(read('src/app/(tabs)/_layout.tsx'));

ok('the tabs navigator leaves detachInactiveScreens at its default',
  !/detachInactiveScreens/.test(layout),
  'measured on signed Release, A/B/A on one emulator: default detaching gives p50 69-81ms / ' +
    'p90 129-150ms, detachInactiveScreens={false} gives p50 200-500ms / p90 500-2050ms and ' +
    '+22.7MB PSS. Keeping every visited tab resident costs more than the fragment transaction ' +
    'it avoids. The tab-switch cost lives in src/hooks/use-screen-entering.ts, not here');

/**
 * `lazy` bounds what a tab costs before it is ever opened. Turning it off would
 * mount all four heavy screens at launch and move the cost into cold start,
 * which is currently healthy.
 */
ok('lazy tab loading is not disabled',
  !/lazy=\{false\}/.test(layout) && !/lazy:\s*false/.test(layout),
  'unvisited tabs must stay unmounted');

// ---------------------------------------------------------------------------
// The tab screens: no entrance may reach Android.
// ---------------------------------------------------------------------------

for (const rel of TAB_SCREENS) {
  const src = stripComments(read(rel));

  ok(`${rel}: clips offscreen Android ScrollView children`,
    /removeClippedSubviews=\{Platform\.OS === 'android'\}/.test(src),
    'detached tabs must not reissue every below-the-fold native draw command on re-attach');

  /**
   * The whole guard. Every `entering=` in a tab screen must be wrapped, so the
   * Android short-circuit is impossible to route around by copying the line
   * above. An unwrapped one is a regression of exactly the shape systrace
   * caught: 300-620ms of animation frames with nothing drawn.
   */
  const enterings = src.match(/entering=\{[^\n]*/g) ?? [];
  const unwrapped = enterings.filter((line) => !line.startsWith('entering={enter('));
  ok(`${rel}: every entering animation goes through useScreenEntering`,
    enterings.length > 0 && unwrapped.length === 0,
    enterings.length === 0
      ? 'expected at least one entering= here; if the animations were removed outright, ' +
        'drop this screen from TAB_SCREENS rather than leaving a check that cannot fail'
      : `unwrapped: ${unwrapped.join(' | ')}`);

  ok(`${rel}: calls useScreenEntering`,
    /import \{ useScreenEntering \} from '@\/hooks\/use-screen-entering'/.test(src) &&
      /const enter = useScreenEntering\(\)/.test(src),
    'the wrapper has to come from the hook — a local `enter` would pass the check above ' +
      'while doing nothing');

  /**
   * Exiting and layout animations have the same hazard and no guard of their
   * own, because there are none today. A view being animated out on a native
   * detach is worse than one animated in: the tab you are leaving holds the
   * frame. Caught here rather than in review.
   */
  ok(`${rel}: no exiting or layout animation on a detachable screen`,
    !/\bexiting=\{/.test(src) && !/\blayout=\{/.test(src),
    'react-native-screens detaches and re-attaches these subtrees on every tab switch — ' +
      'an exiting or layout animation there fires on a navigation the user already made');

  /**
   * `Section` from ui/layout carries its own ungated FadeInDown. It is the
   * right thing on a pushed screen and a 320ms stall on a tab.
   */
  ok(`${rel}: does not use Section, which carries its own entrance`,
    !/\bSection\b(?![A-Za-z])[^\n]*from '@\/components\/ui\/layout'/.test(src) &&
      !/import \{[^}]*\bSection\b[^}]*\} from '@\/components\/ui\/layout'/.test(src),
    'Section animates itself and does not know it is on a tab');
}

// ---------------------------------------------------------------------------
// The tab bar. Not a tab screen, and that is exactly why it was missed.
//
// v43 (signed, 358f8b2) after the premount fix: a warm tab tap renders in ONE
// frame at 65/73/85ms, against 7-8 frames at p50 70-101ms in v41 and up to
// 2050ms in v42. PSS 161.7MB, back at the v41 control rather than v42's leak.
// Atrace: ACTION_UP 4238.219 to Record View draw 4238.343 = 124ms, against
// 548ms in v41.
//
// What still sits in front of that draw is a run of consecutive Choreographer
// `animation` callbacks beginning 4238.223 — 4ms after the tap, before
// anything is measured or laid out. The tab bar's own `FadeIn.duration(180)`
// was the only ungated entrance left in the tab-switch path, and 180ms is the
// duration in the trace. React-navigation re-renders the bar on every
// navigation state change, so that entrance is configured afresh on each
// press rather than once at mount.
// ---------------------------------------------------------------------------

const tabBar = stripComments(read('src/components/tab-bar.tsx'));

{
  const enterings = tabBar.match(/entering=\{[^\n]*/g) ?? [];
  const unwrapped = enterings.filter((line) => !line.startsWith('entering={enter('));
  ok('src/components/tab-bar.tsx: its entrance goes through useScreenEntering',
    enterings.length > 0 && unwrapped.length === 0,
    enterings.length === 0
      ? 'expected an entering= here; if the animation was removed outright, drop this block ' +
        'rather than leaving a check that cannot fail'
      : `unwrapped: ${unwrapped.join(' | ')}`);

  ok('src/components/tab-bar.tsx: calls useScreenEntering',
    /import \{ useScreenEntering \} from '@\/hooks\/use-screen-entering'/.test(tabBar) &&
      /const enter = useScreenEntering\(\)/.test(tabBar),
    'a local `enter` would satisfy the check above while doing nothing');

  /**
   * The bar is rebuilt on every navigation state change, so an exiting or
   * layout animation here would fire on every tab press by construction —
   * worse than the entering one, which at least only replays on a re-register.
   */
  ok('src/components/tab-bar.tsx: no exiting or layout animation',
    !/\bexiting=\{/.test(tabBar) && !/\blayout=\{/.test(tabBar),
    'react-navigation re-renders this component on every navigation state change');
}

// ---------------------------------------------------------------------------
// The hook itself.
// ---------------------------------------------------------------------------

const hook = stripComments(read('src/hooks/use-screen-entering.ts'));

ok('useScreenEntering drops the animation on Android',
  /Platform\.OS === 'android' \|\| reducedMotion \? undefined :/.test(hook),
  'this one expression is the fix; everything else in this file only makes sure it is reached');

ok('useScreenEntering still honours Reduce Motion',
  /reducedMotion/.test(hook) && /useReducedMotion/.test(hook),
  'Flow and Bills were not checking Reduce Motion before this hook existed — routing them ' +
    'through it is what fixed that, and dropping the check would undo it silently');

const flow = stripComments(read('src/app/(tabs)/flow.tsx'));
ok('Flow groups the six-month chart in one ledger pass',
  /summarizeCashflowMonths\(state\.transactions, keys, liveAccounts, internal\)/.test(flow) &&
    !/summarizeMonth\(state\.transactions, k, liveAccounts, internal\)/.test(flow),
  'six separate full-ledger summaries stall first visit on large imported histories');
ok('Flow reuses category totals instead of scanning once per budget',
  /spentByCategory\.get\(b\.category\)/.test(flow) &&
    !/spentInMonthForCategory/.test(flow),
  'budget count must not multiply the cost of opening Flow');
ok('Flow defers below-the-fold insight analysis until after Android navigation',
  /InteractionManager\.runAfterInteractions/.test(flow) &&
    /Platform\.OS === 'android'[\s\S]*deferredInsights/.test(flow),
  'subscription and comparison analysis must not block the first visible tab draw');

// ---------------------------------------------------------------------------
// Fonts: native binaries embed them; JavaScript must not load them twice.
// ---------------------------------------------------------------------------

{
  const appConfig = JSON.parse(read('app.json')).expo;
  const fontPlugin = appConfig.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-font',
  );
  const configuredFonts = fontPlugin?.[1]?.fonts ?? [];
  const root = stripComments(read('src/app/_layout.tsx'));
  ok('all eight product fonts are embedded by the expo-font config plugin',
    configuredFonts.length === 8,
    `configured ${configuredFonts.length}; native rendering depends on every Latin, mono and Arabic face`);
  ok('native startup does not reload embedded fonts through JavaScript',
    /WEB_FONTS.*from '@\/lib\/web-fonts'/.test(root) &&
      /Platform\.OS === 'web' && !webFontsLoaded/.test(root) &&
      /export const WEB_FONTS = \{\};/.test(stripComments(read('src/lib/web-fonts.ts'))) &&
      !/SplashScreen\.(?:preventAutoHideAsync|hideAsync)/.test(root),
    'Expo v55 makes config-plugin fonts available before React mounts; a second useFonts/splash gate delays first paint');
}

// ---------------------------------------------------------------------------
// The upstream behaviour this rests on. Skipped rather than failed when
// node_modules is absent, so the suite still runs on a bare checkout.
// ---------------------------------------------------------------------------

const tabView = readIfPresent(
  'node_modules/@react-navigation/bottom-tabs/lib/module/views/BottomTabView.js',
);
if (!tabView) {
  console.log('- react-navigation not installed, skipping the upstream-default checks');
} else {
  /**
   * The path everything above was measured on. If upstream ever stops detaching
   * by default on Android, the numbers in this file describe a configuration
   * the app no longer runs, and the whole diagnosis needs re-measuring rather
   * than re-reading.
   */
  const defaultExpr = tabView.match(/detachInactiveScreens\s*=\s*([^\n]*)/);
  ok('bottom-tabs still detaches inactive screens by default on Android',
    !!defaultExpr && /android/i.test(defaultExpr[1]),
    defaultExpr ? defaultExpr[1].trim() : 'no detachInactiveScreens default found');
}

const fragment = readIfPresent(
  'node_modules/react-native-screens/android/src/main/java/com/swmansion/rnscreens/ScreenFragment.kt',
);
if (!fragment) {
  console.log('- react-native-screens Android sources not installed, skipping the recycle check');
} else {
  /**
   * Why the fix is "do not configure an entrance" rather than "remount less".
   * `onCreateView` re-adds the SAME `Screen` view through `recycle()`, so React
   * state survives a tab switch and there is no remount to prevent — the view
   * is merely detached from the window and re-attached. If this ever became a
   * real teardown, component state would start being lost on tab switches and
   * that is a much larger bug than the one this file is about.
   */
  ok('ScreenFragment still recycles the same Screen view across a detach',
    /addView\(screen\.recycle\(\)\)/.test(fragment),
    'a tab switch is a native detach/re-attach, not a remount — if that changed, tab state ' +
      'is now being destroyed and this whole diagnosis needs redoing');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
