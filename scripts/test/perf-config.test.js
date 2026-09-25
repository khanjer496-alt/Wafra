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
 * animations: Home and Flow reach delay 120 + duration 320 = 440ms and Bills'
 * recurring rows reach min(i, 8) x 40 + 300 = 620ms. Wallet removed its
 * decorative entrance while simplifying its overview. `ScreenFragment`
 * recycles the same `Screen`
 * view across the fragment remove/add, so React never remounts and component
 * state survives — but the native subtree is detached from the window and
 * re-attached, and the entering animation can start again on that path.
 *
 * So every remaining entrance in the animated tab screens goes through
 * `useScreenEntering`,
 * which returns undefined on Android. That is easy to bypass by accident: the
 * next person adding a section to a tab copies the line above it, and if that
 * line says `entering={FadeInDown...}` the stall comes straight back for one
 * more section. The check below is the reason it cannot.
 *
 * ---------------------------------------------------------------------------
 *
 * THE SECOND HALF OF THIS FILE is about the ledger rather than the navigator:
 * the per-row work that four mounted tab screens redo on every mutation, and
 * the writes a single captured SMS causes. Those costs are invisible in
 * development because they are configuration-dependent — the salary-day month
 * defaults to 1, and a developer's ledger is a few hundred rows — so they are
 * pinned behaviourally here, at the settings that actually expose them.
 */
const fs = require('fs');
const path = require('path');
const fmt = require('./build/format');
const insights = require('./build/insights');

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

const GATED_LAYOUT_ENTRY_TAB_SCREENS = [
  'src/app/(tabs)/bills.tsx',
];
// The shipping Home: `src/app/(tabs)/index.tsx` re-exports it. The
// ledger-home-screen list further down keeps its persistent-reveal contract
// for the day that screen is rendered again; today nothing imports it, so a
// stall there is not a stall the user can hit, and this list guards the Home
// that is.
const SHIPPING_TAB_SCREENS_WITHOUT_LAYOUT_ANIMATION = [
  'src/screens/journal-home-screen.tsx',
];

// ---------------------------------------------------------------------------
// 120 Hz capability: keep it in Expo config so clean EAS/prebuilds preserve it.
// ---------------------------------------------------------------------------

{
  const appConfig = stripComments(read('app.config.js'));
  // The plugin deliberately stores generated native source inside JS template
  // strings. `stripComments` would treat `//` inside those strings as real JS
  // comments and erase the rest of the generated Kotlin from this inspection.
  const highRefresh = read('modules/wafra-high-refresh/plugin/index.js');

  ok('the high-refresh native plugin is part of every Expo prebuild',
    /\.\/modules\/wafra-high-refresh\/plugin/.test(appConfig) &&
      /plugins:\s*\[\.\.\.withPagedPlugins, highRefreshPlugin\]/.test(appConfig),
    'a native-only edit is lost by clean EAS/prebuild; the plugin has to be registered in app.config.js');

  ok('iOS clean builds keep the ProMotion opt-in',
    /CADisableMinimumFrameDurationOnPhone/.test(highRefresh) &&
      /next\.modResults\[IOS_PROMOTION_KEY\]\s*=\s*true/.test(highRefresh),
    'without CADisableMinimumFrameDurationOnPhone, supported iPhones can remain capped below ProMotion refresh rates');

  ok('Android 14+ tells the scheduler Wafra intends to render at 120 fps',
    /Build\.VERSION\.SDK_INT\s*>=\s*Build\.VERSION_CODES\.UPSIDE_DOWN_CAKE/.test(highRefresh) &&
      /120f/.test(highRefresh) &&
      /params\.preferredRefreshRate\s*=\s*targetRate/.test(highRefresh),
    'preferredRefreshRate is the window-level hint; do not switch display modes just to request refresh rate');

  ok('older Android versions request an actual supported refresh rate',
    /defaultDisplay\.supportedRefreshRates/.test(highRefresh) &&
      /minByOrNull/.test(highRefresh),
    'before Android 14 preferredRefreshRate must match a supported rate, so hard-coding 120 can be ignored on 90/144 Hz devices');

  ok('Android 15+ keeps high-refresh interactions compatible with idle power saving',
    /Build\.VERSION_CODES\.VANILLA_ICE_CREAM/.test(highRefresh) &&
      /window\.setFrameRatePowerSavingsBalanced\(true\)/.test(highRefresh),
    'finance screens are often static; allowing refresh-rate balancing avoids holding the panel high while nothing moves');

  ok('high-refresh support does not force a display resolution/mode',
    !/preferredDisplayModeId/.test(highRefresh),
    'Wafra only needs a frame-rate preference; changing the display mode can also change resolution');
}

// New Spending components do not run a delayed entering sequence.
for (const rel of ['src/app/(tabs)/flow.tsx', 'src/components/spending/spending-overview.tsx', 'src/components/spending/spending-trends.tsx']) {
 const src=stripComments(read(rel));
 ok(`${rel}: no hidden entrance work reintroduced`, !/entering=|useScreenEntering|FadeIn/.test(src));
}
const PERSISTENT_REVEAL_TAB_SCREENS = [
  'src/screens/ledger-home-screen.tsx',
];

// ---------------------------------------------------------------------------
// The navigator: the failed fix must stay gone.
// ---------------------------------------------------------------------------

const layout = stripComments(read('src/components/app-tabs-layout.tsx'));

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

for (const rel of GATED_LAYOUT_ENTRY_TAB_SCREENS) {
  const src = stripComments(read(rel));

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

// Home needs a visible Android entrance, but never another layout animation on
// a detachable native screen. MotionReveal animates only opacity/transform via
// one persistent shared value, so tab reattachment cannot register or replay
// an entering transition.
for (const rel of PERSISTENT_REVEAL_TAB_SCREENS) {
  const src = stripComments(read(rel));

  ok(`${rel}: uses persistent paint-only reveals`,
    /import \{ MotionReveal \} from '@\/components\/ui\/motion-reveal'/.test(src) &&
      (src.match(/<MotionReveal\b/g) ?? []).length >= 4,
    'the Android-visible choreography must stay on the persistent reveal primitive');

  ok(`${rel}: has no detachable-screen layout animation`,
    !/\bentering=\{/.test(src) && !/\bexiting=\{/.test(src) && !/\blayout=\{/.test(src),
    'entering/exiting/layout animations can replay when react-native-screens reattaches a tab');

  ok(`${rel}: does not use Section, which carries its own entrance`,
    !/\bSection\b(?![A-Za-z])[^\n]*from '@\/components\/ui\/layout'/.test(src) &&
      !/import \{[^}]*\bSection\b[^}]*\} from '@\/components\/ui\/layout'/.test(src),
    'Section registers a layout entrance and does not know it is on a detachable tab');
}

for (const rel of SHIPPING_TAB_SCREENS_WITHOUT_LAYOUT_ANIMATION) {
  const src = stripComments(read(rel));
  ok(`${rel}: has no detachable-screen layout animation`,
    !/\bentering=\{/.test(src) && !/\bexiting=\{/.test(src) && !/\blayout=\{/.test(src),
    'entering/exiting/layout animations can replay when react-native-screens reattaches a tab');
  ok(`${rel}: does not use Section, which carries its own entrance`,
    !/\bSection\b(?![A-Za-z])[^\n]*from '@\/components\/ui\/layout'/.test(src) &&
      !/import \{[^}]*\bSection\b[^}]*\} from '@\/components\/ui\/layout'/.test(src),
    'Section registers a layout entrance and does not know it is on a detachable tab');
}

const motionReveal = stripComments(read('src/components/ui/motion-reveal.tsx'));

ok('MotionReveal animates persistent paint properties, not layout',
  /useSharedValue\(/.test(motionReveal) &&
    /useAnimatedStyle\(/.test(motionReveal) &&
    /opacity:/.test(motionReveal) &&
    /translateY:/.test(motionReveal) &&
    /scale:/.test(motionReveal) &&
    !/\bentering=\{/.test(motionReveal) &&
    !/\bexiting=\{/.test(motionReveal) &&
    !/\blayout=\{/.test(motionReveal),
  'the reveal must remain a shared-value paint animation so tab attach cannot replay it');

ok('MotionReveal honours the app reduced-motion policy',
  /useMotionPreference\(\)/.test(motionReveal) &&
    /if \(!ready\) return/.test(motionReveal) &&
    /if \(reducedMotion\)/.test(motionReveal) &&
    /progress\.value = 1/.test(motionReveal),
  'wait for screen-reader detection, then settle immediately when motion is reduced');

// ---------------------------------------------------------------------------
// The tab bar. Not a tab screen, and that is exactly why it was missed.
//
// v43 (signed, 358f8b2) after the premount fix: a warm tab tap renders in ONE
// frame at 65/73/85ms, against 7-8 frames at p50 70-101ms in v41 and up to
// 2050ms in v42. PSS 161.7MB, back at the v41 control rather than v42's leak.
// Atrace: ACTION_UP 4238.219 to Record View draw 4238.343 = 124ms, against
// 548ms in v41.
//
// The bar may animate focus state because that shared value persists with each
// keyed tab button. It may not register entering/exiting/layout transitions:
// React-navigation re-renders the bar on every navigation state change, so a
// layout transition would be configured afresh on every press.
// ---------------------------------------------------------------------------

const tabBar = stripComments(read('src/components/tab-bar.tsx'));

{
  ok('src/components/tab-bar.tsx: selection is immediate without shared-value motion',
    !/useSharedValue|withSpring|withTiming/.test(tabBar) && /focused \? theme\.primary/.test(tabBar),
    'selection uses the keyed tab state directly, without a new animation');

  /**
   * The bar is rebuilt on every navigation state change, so an exiting or
   * layout animation here would fire on every tab press by construction —
   * worse than the entering one, which at least only replays on a re-register.
   */
  ok('src/components/tab-bar.tsx: no entering, exiting or layout animation',
    !/\bentering=\{/.test(tabBar) && !/\bexiting=\{/.test(tabBar) && !/\blayout=\{/.test(tabBar),
    'react-navigation re-renders this component on every navigation state change');

  ok('src/components/tab-bar.tsx: selected state is exposed without motion',
    /accessibilityState=\{\{ selected: focused \}\}/.test(tabBar) && !/Animated|withSpring/.test(tabBar),
    'selection is immediate for every user including Reduce Motion');

  ok('src/components/tab-bar.tsx: rapid taps cannot enqueue overlapping navigation transitions',
    /navigationPendingRef/.test(tabBar) &&
      /if \(!focused && navigationPendingRef\.current !== null\) return/.test(tabBar) &&
      /navigationPendingRef\.current = route\.key/.test(tabBar) &&
      /\}, \[state\.index\]\)/.test(tabBar) &&
      /setTimeout\([\s\S]*?750\)/.test(tabBar),
    'the selected index can lag a physical tap; a second destination must wait for the first ' +
      'fragment/navigation transaction instead of piling more work onto a stalled UI thread');

  ok('src/components/tab-bar.tsx: tap storms leave only a source-free diagnostic breadcrumb',
    /recordRuntimeInteraction\('main-tab-press'\)/.test(tabBar) &&
      !/recordRuntimeInteraction\([^)]*route\.name/.test(tabBar),
    'a crash report may count pressure, but it must not persist which financial destination ' +
      'the user was viewing');
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

// ---------------------------------------------------------------------------
// monthKey, the hottest function in the app.
//
// It is called once per row by every filter, every period test and every
// grouping, and it used to build a `Date` on the salary-day path — which is
// the path most of a ledger takes, because the path is "this row is dated
// before the start day". `MONEY_MONTH_DAYS` in onboarding.ts offers 1, 25, 27
// and 28, so three of the four choices put three quarters of the rows on it.
// A developer running with the default of 1 sees none of that.
//
// Measured against the compiled modules over a synthetic 10,000-row ledger:
//
//   monthKey x10,000        day 1  0.30 ms   day 25  4.10 ms   day 28  4.50 ms
//   buildInsights, 8 budgets  9.9 ms                          53.2 ms
//
// after this and the budget-lookup fix below:
//
//   monthKey x10,000        day 1  0.31 ms   day 25  0.89 ms   day 28  0.77 ms
//   buildInsights, 8 budgets  9.3 ms                           6.1 ms
//
// The assertions come in pairs: one that the answer is unchanged, at every
// start day the app can be set to, and one that the cost has not come back.
// ---------------------------------------------------------------------------

/** monthKey as it was written before this: correct, and one Date per row. */
function monthKeyViaDate(iso, startDay) {
  if (startDay > 1 && Number(iso.slice(8, 10)) < startDay) {
    const [y, m] = iso.slice(0, 7).split('-').map(Number);
    const d = new Date(y, m - 1 - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  return iso.slice(0, 7);
}

function shiftMonthKeyViaDate(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Every date in [2023-01-01, 2027-12-31], as ISO strings. */
function everyDate() {
  const dates = [];
  for (let y = 2023; y <= 2027; y++) {
    for (let m = 1; m <= 12; m++) {
      const last = new Date(y, m, 0).getDate();
      for (let d = 1; d <= last; d++) {
        dates.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      }
    }
  }
  return dates;
}

const ALL_DATES = everyDate();

{
  // Every start day the setting accepts, not just the four onboarding offers —
  // the slider in Settings reaches all of them.
  let mismatch = null;
  for (let startDay = 1; startDay <= 28 && !mismatch; startDay++) {
    fmt.setMonthStartDay(startDay);
    for (const iso of ALL_DATES) {
      const got = fmt.monthKey(iso);
      const want = monthKeyViaDate(iso, startDay);
      if (got !== want) {
        mismatch = `monthStartDay=${startDay} ${iso}: got ${got}, want ${want}`;
        break;
      }
    }
  }
  ok('monthKey answers exactly what the Date implementation answered, at every start day',
    !mismatch,
    `${mismatch} — this is the safety net under the string arithmetic in format.ts. ` +
      'monthKey decides which month every row belongs to; a single wrong key moves money ' +
      'between months on every screen at once');

  let shiftMismatch = null;
  for (const key of ['2023-01', '2024-02', '2025-06', '2026-11', '2026-12', '2027-01']) {
    for (let delta = -30; delta <= 30 && !shiftMismatch; delta++) {
      const got = fmt.shiftMonthKey(key, delta);
      const want = shiftMonthKeyViaDate(key, delta);
      if (got !== want) shiftMismatch = `${key} ${delta >= 0 ? '+' : ''}${delta}: got ${got}, want ${want}`;
    }
  }
  ok('shiftMonthKey answers exactly what the Date implementation answered',
    !shiftMismatch,
    `${shiftMismatch} — the year carry is a floor division now, and a floor that rounded ` +
      'toward zero would put December of the previous year in the wrong year');

  // monthKey and shiftMonthKey(-1) have to stay the same function. monthKey
  // stopped calling it for speed, which is exactly how two implementations of
  // one rule start to drift.
  let pairMismatch = null;
  fmt.setMonthStartDay(28);
  for (const iso of ALL_DATES) {
    if (Number(iso.slice(8, 10)) >= 28) continue;
    if (fmt.monthKey(iso) !== fmt.shiftMonthKey(iso.slice(0, 7), -1)) {
      pairMismatch = iso;
      break;
    }
  }
  ok('the salary-day path still agrees with shiftMonthKey(-1)',
    !pairMismatch,
    `${pairMismatch} — monthKey no longer calls shiftMonthKey, so nothing but this check ` +
      'keeps the inlined month subtraction and the real one saying the same thing');
}

{
  const format = stripComments(read('src/lib/format.ts'));
  const body = format.slice(format.indexOf('export function monthKey'));
  const monthKeyBody = body.slice(0, body.indexOf('\n}'));

  /**
   * The regression itself, stated as code rather than as a number. A `Date` in
   * here is an allocation per row on the salary-day path, and it is the single
   * change that made every full-ledger pass 7-14x slower.
   */
  ok('monthKey builds no Date and delegates to nothing that does',
    !/new Date/.test(monthKeyBody) && !/shiftMonthKey/.test(monthKeyBody),
    `monthKey's body must stay pure string arithmetic: ${JSON.stringify(monthKeyBody)}`);

  ok('shiftMonthKey builds no Date either',
    !/new Date/.test(
      format.slice(
        format.indexOf('export function shiftMonthKey'),
        format.indexOf('\n}', format.indexOf('export function shiftMonthKey')),
      ),
    ),
    'it is called per month rather than per row, but monthKey used to delegate here and the ' +
      'next person to need a month shift in a loop will reach for it');
}

/** Milliseconds for the fastest of `runs` repetitions — the least noisy figure. */
function fastest(fn, runs = 7) {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (ms < best) best = ms;
  }
  return best;
}

{
  // 10,000 rows spread over three years, which is what a heavy real ledger
  // looks like after a full SMS import.
  const dates = [];
  for (let i = 0; i < 10_000; i++) dates.push(ALL_DATES[(i * 7919) % ALL_DATES.length]);

  const shipping = () => {
    for (const d of dates) fmt.monthKey(d);
  };
  const viaDate = () => {
    for (const d of dates) monthKeyViaDate(d, 28);
  };

  // At monthStartDay 28 all but three days of every month take the salary-day
  // branch, which is the branch that used to build a Date. Day 1 never does,
  // which is exactly why the cost was invisible in development.
  fmt.setMonthStartDay(28);
  shipping();
  viaDate();
  const now = fastest(shipping);
  const then = fastest(viaDate);

  /**
   * Measured against the implementation this replaced, on the same data in the
   * same process, rather than against a wall-clock budget — that is the only
   * comparison that means the same thing on a fast laptop and a slow CI box.
   * A regression that reintroduces the allocation lands at parity. The bound
   * is loose on purpose: this catches a Date coming back, it does not police a
   * few percent.
   */
  ok('a full-ledger monthKey pass at monthStartDay 28 beats the Date implementation outright',
    now * 2.5 < then,
    `10,000 monthKey calls at day 28: ${now.toFixed(2)}ms now against ${then.toFixed(2)}ms ` +
      'for the Date version. Three of the four salary days onboarding offers put most of a ' +
      'ledger on this path, so a regression here multiplies every derivation on every tab');

  fmt.setMonthStartDay(1);
}

// ---------------------------------------------------------------------------
// daysBetweenISO, called once per charge by subscription detection.
// ---------------------------------------------------------------------------

{
  const daysBetweenViaDate = (fromISO, toISO) =>
    Math.round(
      (new Date(`${toISO}T12:00:00`).getTime() - new Date(`${fromISO}T12:00:00`).getTime()) /
        86_400_000,
    );

  let mismatch = null;
  const anchors = ['2023-01-01', '2024-02-28', '2024-02-29', '2024-03-01', '2025-12-31', '2026-06-15'];
  for (const from of anchors) {
    for (const to of ALL_DATES) {
      if (fmt.daysBetweenISO(from, to) !== daysBetweenViaDate(from, to)) {
        mismatch = `${from} -> ${to}`;
        break;
      }
    }
    if (mismatch) break;
  }
  ok('daysBetweenISO answers exactly what the two-Date implementation answered',
    !mismatch,
    `${mismatch} — leap days and the noon anchoring are the whole reason this function is ` +
      'shared rather than re-derived per module');

  /**
   * The shape guard is what makes the arithmetic path safe to take at all.
   * Anything that is not a bare YYYY-MM-DD has to fall through to `Date` and
   * keep producing whatever it produced before, NaN included.
   */
  ok('a malformed date still falls back to the Date path',
    Number.isNaN(fmt.daysBetweenISO('', '2026-01-01')) &&
      Number.isNaN(fmt.daysBetweenISO('2026-01-01', 'not a date')) &&
      Number.isNaN(fmt.daysBetweenISO('2026-01-01T09:00:00Z', '2026-01-02')),
    'the fast path must refuse anything it was not designed for rather than read digits out ' +
      'of the middle of it');
}

// ---------------------------------------------------------------------------
// buildInsights: one pass over the ledger, not one per budget.
// ---------------------------------------------------------------------------

{
  const CATEGORIES = ['groceries', 'dining', 'transport', 'shopping', 'health', 'entertainment'];
  const rows = [];
  for (let i = 0; i < 600; i++) {
    const day = (i % 28) + 1;
    rows.push({
      id: `tx-${i}`,
      date: `2026-07-${String(day).padStart(2, '0')}`,
      title: `Shop ${i % 40}`,
      amountFils: 1000 + i * 13,
      type: 'expense',
      category: CATEGORIES[i % CATEGORIES.length],
      accountId: 'acc-1',
      source: 'sms',
    });
  }
  // Split rows are the case the two implementations could disagree on: the
  // per-budget scan counted each part separately via `amountInCategory`, and
  // the summary accumulates the same parts via `allocationsOf`.
  rows.push({
    id: 'tx-split',
    date: '2026-07-12',
    title: 'Carrefour',
    amountFils: 30_000,
    type: 'expense',
    category: 'groceries',
    accountId: 'acc-1',
    source: 'sms',
    splits: [
      { category: 'groceries', amountFils: 24_000 },
      { category: 'shopping', amountFils: 6_000 },
    ],
  });
  rows.push({
    id: 'tx-income',
    date: '2026-07-02',
    title: 'Salary',
    amountFils: 2_000_000,
    type: 'income',
    category: 'salary',
    accountId: 'acc-1',
    source: 'sms',
  });

  for (const startDay of [1, 25]) {
    fmt.setMonthStartDay(startDay);
    const period = { mode: 'month', key: '2026-07' };
    const summary = insights.summarizeMonth(rows, period);
    const byCategory = new Map(summary.byCategory.map((c) => [c.category, c.totalFils]));
    let mismatch = null;
    for (const category of [...CATEGORIES, 'rent', 'salary']) {
      const scanned = insights.spentInMonthForCategory(rows, period, category);
      if ((byCategory.get(category) ?? 0) !== scanned) {
        mismatch = `${category} at monthStartDay ${startDay}: summary ${byCategory.get(category) ?? 0}, scan ${scanned}`;
        break;
      }
    }
    ok(`the month summary already holds every budget's spend (monthStartDay ${startDay})`,
      !mismatch,
      `${mismatch} — buildInsights reads its budget figures out of summarizeMonth's ` +
        'byCategory instead of re-walking the ledger per budget. If the two ever stopped ' +
        'agreeing, budget warnings would quote a different number from the one Flow draws');
  }
  fmt.setMonthStartDay(1);

  const july = [];
  for (let d = 31; d >= 1; d--) {
    july.push({
      id: `jul-${d}`,
      date: `2026-07-${String(d).padStart(2, '0')}`,
      title: 'Shop',
      amountFils: 1000,
      type: 'expense',
      category: 'dining',
      accountId: 'acc-1',
      source: 'sms',
    });
  }
  const older = [];
  for (let i = 0; i < 3000; i++) {
    older.push({
      id: `old-${i}`,
      date: `2025-01-${String((i % 28) + 1).padStart(2, '0')}`,
      title: 'Old',
      amountFils: 500,
      type: 'expense',
      category: 'shopping',
      accountId: 'acc-1',
      source: 'sms',
    });
  }
  const newestFirst = [...july, ...older];
  const period = { mode: 'month', key: '2026-07' };
  const windowed = insights.summarizeMonth(newestFirst, period);
  const onlyJuly = insights.summarizeMonth(july, period);
  ok('a newest-first 3,000-row tail does not change this month\'s summary',
    windowed.expenseFils === onlyJuly.expenseFils && windowed.expenseFils === 31_000,
    `newest-first ${windowed.expenseFils} vs July-only ${onlyJuly.expenseFils} — early-exit must not drop in-period rows or pick up older months`);
}

{
  const source = stripComments(read('src/lib/insights.ts'));
  const start = source.indexOf('export function buildInsights');
  const body = source.slice(start);

  /**
   * `spentInMonthForCategory` is still exported, for callers that hold no
   * summary. Inside buildInsights it is a full walk of the ledger — allocating
   * an Allocation array per row — for a number computed twenty lines above:
   * measured at 4.3ms per budget on a 10,000-row ledger at monthStartDay 25,
   * against 0.8ms at day 1, which is why it was never noticed.
   */
  ok('buildInsights does not re-scan the ledger once per budget',
    !/spentInMonthForCategory\(/.test(body),
    'the per-budget spend has to come from the summary this function already computed');
}

// ---------------------------------------------------------------------------
// Interaction hot paths: visible rows and entry opening must stay O(visible).
// ---------------------------------------------------------------------------

{
  const merchantAvatar = read('src/components/ui/merchant-avatar.tsx');
  const bankAvatar = read('src/components/ui/bank-avatar.tsx');
  const merchantLogoResolver = read('src/lib/merchant-logo-resolver.ts');
  const bankLogoResolver = read('src/lib/bank-logo-resolver.ts');
  const detail = read('src/components/entry-detail-sheet.tsx');
  const haptics = read('src/lib/haptics.ts');

  ok('merchant avatars subscribe only to Private Mode, not the whole ledger',
    /usePrivateMode/.test(merchantAvatar) && !/useStore\s*\(/.test(merchantAvatar) && /React\.memo\(MerchantAvatarInner\)/.test(merchantAvatar),
    'a transaction list can have hundreds of avatars; a full StoreContext subscription rerenders all of them on every unrelated ledger update');

  ok('bank avatars subscribe only to Private Mode, not the whole ledger',
    /usePrivateMode/.test(bankAvatar) && !/useStore\s*\(/.test(bankAvatar) && /React\.memo\(BankAvatarInner\)/.test(bankAvatar),
    'account artwork should not rebuild when transactions, budgets, or import progress change');

  ok('remote merchant artwork has bounded JS metadata and unresolved work',
    /MAX_MEMORY_CACHE_ENTRIES\s*=\s*128/.test(merchantLogoResolver) &&
      /MAX_PENDING_RESOLUTIONS\s*=\s*24/.test(merchantLogoResolver) &&
      /pending\.size >= MAX_PENDING_RESOLUTIONS/.test(merchantLogoResolver) &&
      /while \(memory\.size > MAX_MEMORY_CACHE_ENTRIES\)/.test(merchantLogoResolver),
    'a long transaction history can expose thousands of unique merchant strings; presentation enrichment must not become a process-lifetime Map/promise backlog');

  ok('remote bank artwork has bounded JS metadata and unresolved work',
    /MAX_MEMORY_CACHE_ENTRIES\s*=\s*64/.test(bankLogoResolver) &&
      /MAX_PENDING_RESOLUTIONS\s*=\s*8/.test(bankLogoResolver) &&
      /pending\.size >= MAX_PENDING_RESOLUTIONS/.test(bankLogoResolver) &&
      /while \(memory\.size > MAX_MEMORY_CACHE_ENTRIES\)/.test(bankLogoResolver),
    'wallet navigation must not retain every remote institution lookup for the lifetime of the process');

  ok('Android remote logos use disk cache instead of process-wide decoded-image memory',
    /Platform\.OS === 'android'[\s\S]*?'disk'\s*:\s*'memory-disk'/.test(merchantAvatar) &&
      /Platform\.OS === 'android'\s*\?\s*'disk'\s*:\s*'memory-disk'/.test(bankAvatar),
    'decoded remote artwork has unbounded brand cardinality on imported ledgers; disk cache keeps reuse without retaining every image in RAM');

  ok('opening an entry does not reconcile the full transfer graph',
    !/reconcileTransfers\s*\(/.test(detail) && /transferOwnership\(transaction\)/.test(detail),
    'the selected row already carries normalized transfer evidence; rebuilding the whole ledger graph on every tap blocks the JS thread');

  const tapped = bodyOf(haptics, 'export function tapped');
  ok('routine Android taps reserve navigation first and defer a short haptic until the next frame',
    !!tapped && tapped.includes('prioritizeForegroundNavigation()') &&
      tapped.includes("Platform.OS === 'android'") && tapped.includes('requestAnimationFrame') &&
      tapped.includes('performAndroidHapticsAsync(Haptics.AndroidHaptics.Context_Click)'),
    'the haptic must not compete with the JS turn that handles navigation, but Android taps still need physical feedback');
}

// ---------------------------------------------------------------------------
// Storage chunking: a new transaction must not rewrite the whole ledger.
// ---------------------------------------------------------------------------

const storeSource = read('src/lib/store.tsx');
const ledgerPersistenceSource = stripComments(read('src/lib/ledger-persistence.ts'));

/** The body of a top-level declaration, brace-matched. */
function bodyOf(source, header) {
  const start = source.indexOf(header);
  if (start === -1) return null;
  let i = source.indexOf('{', start);
  if (i === -1) return null;
  const open = i;
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

{
  const chunkSize = Number((storeSource.match(/const TX_CHUNK_SIZE = (\d+)/) ?? [])[1]);
  const body = bodyOf(storeSource, 'export function chunkTransactions');
  let chunkTransactions = null;
  if (body && chunkSize) {
    try {
      // Compiled with TX_CHUNK_SIZE as a parameter — the real body, run
      // against the real constant, rather than a copy of the arithmetic. The
      // only TypeScript in it is the local's type annotation, which `new
      // Function` cannot parse; nothing else about the body is touched.
      const asJs = body.replace(/(\bconst\s+\w+)\s*:\s*[^=]+=/g, '$1 =');
      chunkTransactions = new Function('TX_CHUNK_SIZE', 'transactions', asJs).bind(null, chunkSize);
      chunkTransactions([]);
    } catch {
      chunkTransactions = null;
    }
  }

  ok('the chunking function can be lifted out of store.tsx',
    !!chunkTransactions,
    'store.tsx is a React module and cannot be required here, so the assertions below run its ' +
      'real body against the real chunk size. Treat this failing as all of them failing');

  if (chunkTransactions) {
    // 10,000 rows, newest first — the order `sortTxs` keeps the ledger in.
    const ledger = [];
    for (let i = 0; i < 10_000; i++) {
      ledger.push({ id: `tx-${i}`, date: ALL_DATES[ALL_DATES.length - 1 - (i % ALL_DATES.length)], amountFils: 1000 + i });
    }

    const before = chunkTransactions(ledger);
    ok('the ledger is cut into whole chunks of the configured size',
      before.length === Math.ceil(ledger.length / chunkSize),
      `${before.length} chunks for ${ledger.length} rows at ${chunkSize} per chunk`);

    ok('the chunks reassemble, back to front, into the ledger they were cut from',
      JSON.stringify([...before].reverse().flatMap((body) => JSON.parse(body))) ===
        JSON.stringify(ledger),
      'chunk 0 holds the OLDEST rows, so a load concatenates from the last chunk backwards. ' +
        'Getting this backwards would put the ledger on screen in reverse until the next sort');

    /**
     * The property the whole scheme exists for. `sortTxs` keeps the ledger
     * newest-first and `addTransaction` prepends, so every captured SMS used
     * to shift every row down one index and change every chunk body: measured
     * at 26 of 26 chunks and 1.8MB through SQLCipher for one 180-byte row.
     */
    const after = chunkTransactions([{ id: 'tx-new', date: '2027-12-31', amountFils: 999 }, ...ledger]);
    const rewritten = after.filter((body, i) => before[i] !== body);
    ok('a new transaction at the head rewrites exactly one chunk',
      rewritten.length === 1 && after.length === before.length + 1,
      `${rewritten.length} of ${after.length} chunk bodies differ after prepending one row. ` +
        'Chunks are diffed by index at save time, so any layout where a row\'s index depends ' +
        'on how many rows are NEWER than it rewrites the entire ledger on every capture');

    ok('editing one row in place rewrites exactly one chunk',
      (() => {
        const edited = ledger.slice();
        edited[5000] = { ...edited[5000], amountFils: 1 };
        return chunkTransactions(edited).filter((body, i) => before[i] !== body).length === 1;
      })(),
      'an edit changes one row and must not disturb the rest of the layout');

    ok('an empty ledger produces no chunks',
      chunkTransactions([]).length === 0,
      'a blank store must not write a chunk key it will then have to remove');
  }
}

{
  /**
   * The stored layout is declared in meta, and read back before the chunks are
   * interpreted. Without that, upgrading would reinterpret a head-anchored
   * ledger as an oldest-first one — every row still present, but arriving in a
   * scrambled order, which is enough to change which of two duplicate rows
   * `reconcileCaptureDuplicates` keeps.
   */
  const load = bodyOf(ledgerPersistenceSource, 'const readExistingSnapshot = async');
  ok('the loader reads the stored chunk layout before reassembling',
    !!load &&
      /parsed\.txChunkOrder === currentChunkOrder/.test(load) &&
      /if \(chunkOrder === currentChunkOrder\) blocks\.reverse\(\)/.test(load),
    'a ledger written by an older build carries no marker and must be read in the layout it ' +
      'was written in, not reinterpreted');

  const persist = bodyOf(ledgerPersistenceSource, 'const writeSnapshot = async');
  ok('every meta record says which layout the chunks on disk are in',
    !!persist && /txChunkOrder: order/.test(persist) &&
      /const order = needsChunks \? targetOrder : storedChunkOrder/.test(persist),
    'meta is written on saves that do not touch transactions too, and one of those stamping ' +
      'the new layout over old chunks is the same data-scrambling bug from the other side');
}


// ---------------------------------------------------------------------------
// Automatic capture must distinguish source-free maintenance from real arrivals.
// ---------------------------------------------------------------------------

{
  const autoImport = stripComments(read('src/hooks/use-auto-import.ts'));
  ok('real Android arrival edges acknowledge a durable import while source-free maintenance stays quiet',
    /liveEvent && !interactive/.test(autoImport) &&
      /showLiveCaptureFeedback\(outcome\.transactions\)/.test(autoImport) &&
      /latestScan\.current\(false, true\)/.test(autoImport) &&
      /runAndroidNotificationDrain\(true\)/.test(autoImport) &&
      /latestScan\.current\(false\)/.test(autoImport),
    'only a source-backed SMS/notification edge should get the short live success feedback; launch/resume safety scans remain silent');

  ok('daily summary work is keyed to ledger changes, not every store mutation',
    /\[getStateSnapshot, historyImportRunning, state\.dailySummary, state\.hydrated, state\.onboarded,[\s\S]*?state\.transactions, watchForeground\]/.test(autoImport) &&
      !/\}, \[state, watchForeground\]\);/.test(autoImport),
    'history pages, settings changes, and other unrelated reducer updates must not reschedule the daily summary; completion may schedule once');

  ok('Android resume catch-up leaves the first reopened frames to UI/input',
    /ANDROID_RESUME_SCAN_GRACE_MS\s*=\s*5_000/.test(autoImport) &&
      /ANDROID_INITIAL_SCAN_GRACE_MS\s*=\s*6_000/.test(autoImport) &&
      /waitForForegroundHistoryIdle/.test(autoImport) &&
      /initialScanCancelled/.test(autoImport) &&
      /shouldSkipFreshAndroidResumeScan\(\)/.test(autoImport) &&
      /setTimeout\([\s\S]*?scheduler\.request\(\)[\s\S]*?ANDROID_RESUME_SCAN_GRACE_MS\)/.test(autoImport),
    'a fresh source-free resume should do no inbox work, and a stale one must not start it while Android restores the window');

  ok('launch notification and digest maintenance respect the navigation lease',
    /ANDROID_NOTIFICATION_RECOVERY_GRACE_MS\s*=\s*10_000/.test(autoImport) &&
      /DAILY_SUMMARY_MAINTENANCE_GRACE_MS\s*=\s*9_000/.test(autoImport) &&
      /waitForForegroundHistoryIdle\(SESSION_REMINDER_SYNC_GRACE_MS\)/.test(autoImport) &&
      /waitForForegroundHistoryIdle\(DAILY_SUMMARY_MAINTENANCE_GRACE_MS\)/.test(autoImport),
    'source-free maintenance must keep yielding priority to real taps even after its wall-clock grace expires');

  ok('Android bank-app queue is not reopened on every quick resume without a change signal',
    /ANDROID_NOTIFICATION_RECHECK_MS\s*=\s*30_000/.test(autoImport) &&
      /ANDROID_NOTIFICATION_RECOVERY_GRACE_MS\s*=\s*10_000/.test(autoImport) &&
      /androidNotificationDrainRequired\s*=\s*false/.test(autoImport) &&
      /getPendingCount/.test(autoImport) &&
      /pending <= 0/.test(autoImport) &&
      /NotificationReader\.addListener\('onQueueChanged',[\s\S]*?androidNotificationDrainRequired = true[\s\S]*?scheduler\.request\(\)/.test(autoImport) &&
      /androidNotificationDrainRequired = false[\s\S]*?androidNotificationLastCheckedAt = Date\.now\(\)/.test(autoImport),
    'cold launch/resume must inspect only a source-free pending count after an idle grace; a real native queue edge still forces an immediate drain');

  const notificationListener = stripComments(read(
    'modules/notification-reader/android/src/main/java/expo/modules/notificationreader/BankNotificationListenerService.kt'));
  const notificationStore = stripComments(read(
    'modules/notification-reader/android/src/main/java/expo/modules/notificationreader/NotificationCaptureStore.kt'));
  const notificationModule = stripComments(read(
    'modules/notification-reader/android/src/main/java/expo/modules/notificationreader/NotificationReaderModule.kt'));
  ok('notification-listener reconnect recovery never runs KeyStore sweep inline',
    /override fun onListenerConnected\(\)[\s\S]*?scheduleSweep\(\)/.test(notificationListener) &&
      /recoveryExecutor\.execute/.test(notificationListener) &&
      /fun scheduleSweepConnected\(\)/.test(notificationListener) &&
      /if \(!wasEnabled && nowEnabled\) BankNotificationListenerService\.scheduleSweepConnected\(\)/.test(notificationModule),
    'Android can reconnect NotificationListenerService during launch; encrypted shade recovery must be pushed off that callback path');

  ok('bank notification admission touches the encrypted queue only once per candidate',
    /val appendResult = NotificationCaptureStore\.append\(/.test(notificationListener) &&
      !/NotificationCaptureStore\.admissionBlockReason\(/.test(notificationListener) &&
      /fun append\([\s\S]*?\): String/.test(notificationStore) &&
      /return "duplicate"/.test(notificationStore),
    'a duplicate preflight followed by append decrypted the same AndroidKeyStore queue twice for every visible bank notification');

  const historyImport = stripComments(read('src/hooks/use-history-import.ts'));
  ok('Android history repair keeps running across foreground transitions without auto-starting old paused jobs',
    /FOREGROUND_HISTORY_FIRST_RUN_GRACE_MS\s*=\s*8_000/.test(historyImport) &&
      /progress\.scanned > 0/.test(historyImport) &&
      !/RNAppState\.addEventListener\('change'/.test(historyImport) &&
      /historyRepair:\s*true/.test(historyImport) &&
      /includeNotificationQueue:\s*false/.test(historyImport),
    'a saved paused job still needs explicit Continue, but a job already running must not pause every time Android foregrounds the Activity');

  ok('history planning and commit both honor the foreground navigation lease',
    /FOREGROUND_HISTORY_PAGE_GAP_MS\s*=\s*120/.test(historyImport) &&
      /FOREGROUND_HISTORY_PAGE_SIZE\s*=\s*128/.test(historyImport) &&
      /BACKGROUND_HISTORY_PAGE_SIZE\s*=\s*512/.test(historyImport) &&
      /FOREGROUND_HISTORY_PAGES_PER_COMMIT\s*=\s*1/.test(historyImport) &&
      /BACKGROUND_HISTORY_PAGES_PER_COMMIT\s*=\s*1/.test(historyImport) &&
      /waitForForegroundHistoryIdle\(FOREGROUND_HISTORY_PAGE_GAP_MS\)/.test(historyImport) &&
      (historyImport.match(/await waitForForegroundHistoryIdle\(\);/g) ?? []).length >= 2,
    'yielding only while parsing still lets synchronous planning or ledger reconciliation start on the same turn as a tap');

  const autoImportSource = stripComments(read('src/lib/auto-import.ts'));
  ok('history repair rejects impossible personal/non-money rows before heavy parsing',
    /historyRepair\?: boolean/.test(autoImportSource) &&
      /if \(options\.historyRepair\)/.test(autoImportSource) &&
      /!hasBankAlertMoneyHint\(sms\.body\)/.test(autoImportSource) &&
      /launchSenderMarket === null && !hasGenericBankAlertContext\(sms\.body, sms\.address\)/.test(autoImportSource),
    'a multi-year repair must not run regional/worldwide grammars over ordinary personal SMS that cannot produce ledger money');

  const importPlanSource = stripComments(read('src/lib/import-plan.ts'));
  ok('history exact-source repairs keep generalized duplicate indexes lazy',
    /let guardCache: ReturnType<typeof duplicateGuard> \| null = null/.test(importPlanSource) &&
      /if \(exactPrior\) \{[\s\S]*?healFromReparse\([\s\S]*?continue;[\s\S]*?const duplicate = guard\(\)/.test(importPlanSource) &&
      /let rowsByTimestampCache: Map<number, Transaction\[\]> \| null = null/.test(importPlanSource) &&
      /let transferRepairCandidatesCache: Map<string, Transaction\[\]> \| null = null/.test(importPlanSource),
    'an exact retained-message identity should heal directly instead of allocating every cross-channel/title/timestamp index over a large ledger');

  ok('source-identity planning allocates collision arrays only for actual collisions',
    /const collidingPriorsBySmsKey = new Map<string, Transaction\[\]>\(\)/.test(importPlanSource) &&
      !/const priorsBySmsKey = new Map<string, Transaction\[\]>\(\)/.test(importPlanSource) &&
      /if \(prior\) \{[\s\S]*?collidingPriorsBySmsKey\.set\(sourceKey, \[prior, t\]\)/.test(importPlanSource),
    'a 15k-row ledger with unique source identities must not allocate 15k single-item arrays on every history checkpoint');

  const smsParserSource = stripComments(read('src/lib/sms-parser.ts'));
  const captureSource = stripComments(read('src/lib/capture.ts'));
  const ledgerImportSource = stripComments(read('src/lib/ledger-import.ts'));
  ok('history checkpoints merge into the already-sorted ledger without a full re-sort',
    /transactions:\s*mergeSortedTransactions\(batch\.transactions, existing\)/.test(ledgerImportSource) &&
      !/transactions:\s*incrementalFastPath[\s\S]*?sortTransactions\(\[\.\.\.batch\.transactions, \.\.\.existing\]\)/.test(ledgerImportSource),
    'ordinary healing preserves dates; only an admitted source-date correction needs to restore order before the linear merge');
  // A deliberate historical repair can advance this independent version.
  // Pin the separate numeric contract, not a particular release number.
  const backfillRevision = smsParserSource.match(/const PARSER_BACKFILL_VERSION\s*=\s*(\d+)\s*;/);
  const runtimeRevision = smsParserSource.match(/const PARSER_VERSION\s*=\s*(\d+)\s*;/);
  ok('runtime parser revisions are decoupled from expensive historical backfill',
      backfillRevision !== null && runtimeRevision !== null &&
      Number(backfillRevision[1]) > 0 && Number(backfillRevision[1]) <= Number(runtimeRevision[1]) &&
      /\(state\.parserVersion \?\? 0\) < PARSER_BACKFILL_VERSION/.test(captureSource) &&
      /parserRereadComplete \? PARSER_BACKFILL_VERSION/.test(ledgerImportSource) &&
      /\(next\.parserVersion \?\? 0\) < PARSER_BACKFILL_VERSION/.test(stripComments(read('src/lib/store.tsx'))),
    'ordinary parser releases must not automatically force a full retained-inbox reread or launch-time saved-row reparse');

  const captureExecutor = stripComments(read('src/lib/capture-executor.ts'));
  ok('routine capture yields between collection and synchronous import planning',
    /collected\.parsed\.length > 0 \|\| collected\.declined\.length > 0/.test(captureExecutor) &&
      /await yieldForegroundTurn\(\)/.test(captureExecutor),
    'a completed native inbox read must give pending UI/input a turn before planning and reconciliation');

  const ledgerPersistence = stripComments(read('src/lib/ledger-persistence.ts'));
  ok('ledger persistence does not retain a second serialized copy of every transaction chunk',
    !/previousChunks|chunkBodies|nextChunks/.test(ledgerPersistence) &&
      /previousTransactions/.test(ledgerPersistence) &&
      /chunkRowsUnchanged/.test(ledgerPersistence),
    'keeping every JSON chunk string alive beside parsed transactions raises steady-state memory and GC pressure on large ledgers');

  const store = stripComments(read('src/lib/store.tsx'));
  ok('completed hydration maintenance is receipt-gated instead of walking the ledger every launch',
    /HYDRATION_FINALIZE_VERSION\s*=\s*1/.test(store) &&
      /finalizationReceiptCurrent/.test(store) &&
      /finalizationReceiptCurrent\s*\?\s*paymentsRepaired\s*:\s*removeDeclinedTransactions/.test(store) &&
      /finalizationReceiptCurrent[\s\S]*?\?\s*declinesRemoved\.transactions[\s\S]*?:\s*finalizeHydrationTransactions/.test(store),
    'decline cleanup plus capture/payment reconciliation cost hundreds of ms on a 14k-row persisted ledger and must run only when its receipt is stale');

  ok('unfinished history hydration reuses its provisional transfer receipt instead of rebuilding the graph',
    /historyImportIncomplete\(reduced\.historyImport\)/.test(store) &&
      /historyImportIncomplete\(next\.historyImport\)/.test(store),
    'a persisted running job hydrates as paused; treating only literal running as provisional caused multi-second 15k-row graph rebuilds on every relaunch');

  ok('build-262 ledgers can adopt the hydration-finalize receipt without one extra slow launch',
    /legacyFinalizationReceipt/.test(store) &&
      /hydrationReparseKey === exactReparseKey/.test(store) &&
      /transferNormalizationVersion === TRANSFER_NORMALIZATION_VERSION/.test(store) &&
      /Array\.isArray\(action\.state\.transferInternalIds\)/.test(store),
    'the immediately previous build already persisted this exact maintenance under current parser and transfer receipts');

  const home = stripComments(read('src/screens/journal-home-screen.tsx'));
  const settings = stripComments(read('src/app/settings.tsx'));
  ok('Home never schedules category/parser cleanup scans after becoming usable',
    /includeCleanupPrompts:\s*false/.test(home) &&
      !/homeCleanupReady|setHomeCleanupReady/.test(home),
    'uncategorisedMerchants and unreadFormatCount are full-history maintenance; dedicated screens own them, not Home');

  ok('Settings renders without scanning the full ledger for badge counts',
    !/uncategorisedMerchants|unreadFormatCount|noFormatsReason/.test(settings),
    'opening Settings to change a toggle must stay independent of transaction count');

  // The clean-up rows (and their counts) moved to Data and help. The counts
  // are full-history scans, so they run only after the screen's interactions
  // settle, with the static descriptions shown until then.
  const settingsData = stripComments(read('src/app/settings-data.tsx'));
  const deferred = settingsData.match(/InteractionManager\.runAfterInteractions\(\(\) => \{[\s\S]*?\n\s*\}\);/)?.[0] ?? '';
  ok('Data and help defers its clean-up counts until after first paint',
    /uncategorisedMerchants\(/.test(deferred) && /unreadFormatCount\(/.test(deferred) &&
      (settingsData.match(/uncategorisedMerchants\(|unreadFormatCount\(/g) ?? []).length === 2 &&
      /cleanupCounts \? copy\.merchantsToPlace\(cleanupCounts\.place\) : t\('sortShopsSettingsDetail'\)/.test(settingsData) &&
      /cleanupCounts \? copy\.unreadFormats\(cleanupCounts\.unread\) : t\('improveAccuracySettingsDetail'\)/.test(settingsData),
    'the two ledger scans may never run in the render path');

  ok('Home resume clock does not invalidate full-ledger projections within the same day',
    /const projectionDay\s*=/.test(home) &&
      (home.match(/state\.marketId, period, projectionDay/g) ?? []).length >= 2 &&
      !/state\.marketId, period, now\]/.test(home),
    'setNow(new Date()) runs on every foreground resume; the Date object must not make Home scan the whole ledger twice when only the clock changed');

  ok('Home defers optional historical insight work until after the first usable frame',
    /InteractionManager\.runAfterInteractions/.test(home) &&
      /!homeAnalysisReady \|\| !insightWidgetVisible/.test(home) &&
      /projectDashboardInsight\(state, period, now\)/.test(home) &&
      !/const homeInsight = useMemo/.test(home) &&
      !/surface: 'dashboard', includeInsights: true/.test(home),
    'a 10k+ row ledger must not run subscription/history analysis before Home can accept input, and must not hitch the render that just painted a new SMS');

  const notifications = stripComments(read('src/lib/notifications.ts'));
  const reminders = stripComments(read('src/lib/reminders.ts'));
  ok('automatic Android reminder setup never runs synchronous full-ledger recurrence detection',
      /detectSubscriptionsCooperatively\(/.test(notifications) &&
      /historyImportIncomplete\(state\.historyImport\)/.test(notifications) &&
      /detectedSubscriptions = \[\]/.test(notifications) &&
      /recordRuntimeOperation\('reminder-projection'/.test(notifications) &&
      /buildPaymentReminders\(state, now, MAX_REMINDERS, detectedSubscriptions\)/.test(notifications) &&
      /SESSION_REMINDER_SYNC_GRACE_MS\s*=\s*8_000/.test(autoImport) &&
      /waitForForegroundHistoryIdle\(SESSION_REMINDER_SYNC_GRACE_MS\)/.test(autoImport) &&
      /syncPaymentReminders\(current\)/.test(autoImport),
    'launch reminder setup runs after Home appears; recurrence analysis must yield between slices instead of freezing Hermes');

  const testerDiagnostics = stripComments(read('src/lib/android-tester-diagnostics.ts'));
  const diagnosticMessages = stripComments(read('src/lib/diagnostic-messages.ts'));
  ok('one-tap tester diagnostics page the native inbox instead of reading 1,000 SMS in one JS turn',
    /maxPageSize: 50/.test(testerDiagnostics) &&
      /maxPageSize\?: number/.test(read('src/lib/diagnostic-messages.ts')) &&
      /Math\.min\(maxPage, remaining\)/.test(diagnosticMessages),
    'a 14k-row ledger plus a 1,000-message inbox read froze the support button for 5-20s');

  const smsReaderNative = stripComments(read(
    'modules/sms-reader/android/src/main/java/expo/modules/smsreader/SmsReaderModule.kt'));
  ok('native SMS pages LIMIT the provider cursor instead of opening the whole inbox',
    /DESC LIMIT \$limit/.test(smsReaderNative) &&
      /remaining \+ 32/.test(smsReaderNative) &&
      /fun collectInboxPage\(/.test(smsReaderNative) &&
      /if \(rejectSensitive && SensitiveMessageFilter\.shouldReject\(body\)\) continue/.test(smsReaderNative),
    'a native inbox read without LIMIT stalled Send diagnostics and routine capture on CPH2653');

  ok('routine capture pages 128 inbox rows instead of 1,000',
    /pageSize: 128/.test(captureSource) &&
      /maxInboxPages: fullHistoricalReread \? 1 : undefined/.test(captureSource),
    'incremental capture still drains every newer message; it must not parse a thousand bodies before yielding');

  ok('SMS inbox pages yield to the UI between provider reads',
    /waitForForegroundHistoryIdle\(FOREGROUND_PARSE_YIELD_MS\)/.test(autoImportSource),
    'a multi-page catch-up after a week offline must not monopolise Hermes');

  ok('Home FX repair stops after 16 fallback rows instead of filtering 14k',
    /if \(pending\.length === 16\) break/.test(home),
    'reference FX is a bounded repair, not a full-ledger scan');


  ok('reminder planning accepts a precomputed recurrence projection',
    /detectedSubscriptions\?: readonly Subscription\[\]/.test(reminders) &&
      /detectedSubscriptions[\s\S]*?detectSubscriptions\(/.test(reminders),
    'the cooperative Android caller must be able to supply the exact recurrence result without the pure planner rescanning synchronously');

  const bills = stripComments(read('src/app/(tabs)/bills.tsx'));
  const subscriptions = stripComments(read('src/lib/subscriptions.ts'));
  const cards = stripComments(read('src/lib/cards.ts'));
  const assistant = stripComments(read('src/lib/wafra-assistant.ts'));
  const assistantScreen = stripComments(read('src/app/assistant.tsx'));
  ok('the first Android Bills frame does not synchronously run recurring detection',
    /androidRecurring/.test(bills) &&
      /InteractionManager\.runAfterInteractions/.test(bills) &&
      (bills.match(/requestAnimationFrame/g) ?? []).length >= 2 &&
      /detectSubscriptionsCooperatively\(/.test(bills) &&
      /Platform\.OS === 'android'[\s\S]*?androidRecurring \?\? \[\]/.test(bills),
    'Bills is lazy-mounted on the navigation tap; full-ledger recurrence work must start only after the tab has painted');

  ok('Android recurring detection yields the full-ledger scan instead of merely delaying one blocking turn',
    /function\* subscriptionDetectionWorker/.test(subscriptions) &&
      /SUBSCRIPTION_DETECTION_SLICE_MS\s*=\s*2/.test(subscriptions) &&
      /Date\.now\(\) - startedAt < SUBSCRIPTION_DETECTION_SLICE_MS/.test(subscriptions) &&
      /waitForForegroundHistoryIdle\(SUBSCRIPTION_DETECTION_YIELD_MS\)/.test(subscriptions),
    'a delayed synchronous detectSubscriptions call still freezes JS after the tab paints; the scan itself must be cooperative');

  ok('recurrence detection drops impossible one-off/two-off merchant groups before yielding cadence work',
    /if \(txs\.length < 2\) continue/.test(subscriptions) &&
      /if \(txs\.length === 2\)/.test(subscriptions) &&
      /knownTwoChargeProvider/.test(subscriptions) &&
      /billLikeTwoChargeGroup/.test(subscriptions),
    'a large imported ledger has thousands of one-off merchants; they must not each consume a cooperative timer turn');

  ok('Bills never restarts recurrence from row zero on tab churn',
    /UPCOMING_RECURRENCE_IDLE_MS\s*=\s*4_000/.test(bills) &&
      /needsRecurrenceNow/.test(bills) &&
      /agendaView === 'cards'/.test(bills) &&
      /subscriptionDetectionInFlight/.test(subscriptions) &&
      /if \(existing\) return existing\.promise/.test(subscriptions) &&
      /callers simply ignore the eventual value/.test(read('src/lib/subscriptions.ts')),
    'one immutable ledger snapshot must own one cooperative recurrence job; focus changes may ignore the result but must not cancel/restart the underlying scan');

  ok('default Upcoming does not start recurrence in the navigation-critical window',
    /else delay = setTimeout\(startProjection, UPCOMING_RECURRENCE_IDLE_MS\)/.test(bills) &&
      /agendaView === 'subscriptions' \|\| agendaView === 'utilities' \|\| agendaView === 'all'/.test(bills),
    'cards/manual bills must paint immediately; only an explicit recurrence view may bypass the idle grace');

  ok('Bills does not compute recently-paid card history for the default Upcoming view',
    /const needsPaidCards = agendaView === 'cards' \|\| agendaView === 'all'/.test(bills) &&
      /needsPaidCards[\s\S]*?bills-paid-cards[\s\S]*?recentlySettledDues\(state, now\)[\s\S]*?: \[\]/.test(bills),
    'recent settled statements are invisible on Upcoming and must not block the first Bills tap');

  const billsLogic = stripComments(read('src/lib/bills.ts'));
  ok('manual bill reconciliation is cached across Home and Bills for one immutable ledger/day',
    /let billsForMonthCache:/.test(billsLogic) &&
      /billsForMonthCache\.transactions === transactions/.test(billsLogic) &&
      /billsForMonthCache\.bills === bills/.test(billsLogic) &&
      /return billsForMonthCache\.value\.slice\(\)/.test(billsLogic),
    'Home already computes card/bill upcoming data; opening Bills must reuse that result rather than retokenize the full ledger');

  ok('manual bill reconciliation stops after the current money month on a newest-first ledger',
    /function spendingInMonth\(/.test(billsLogic) &&
      /if \(seenInMonth && newestFirst\) break/.test(billsLogic) &&
      /const monthRows = spendingInMonth\(transactions, key, live, internal\)/.test(billsLogic) &&
      /candidatePayments\(bill, monthRows, key, live, internal\)/.test(billsLogic),
    'Home leaving-soon and Bills must not retokenize 14k historical rows to settle this month\'s three bills');

  const dailySummaryLogic = stripComments(read('src/lib/daily-summary.ts'));
  ok('daily spend summary stops after leaving today on a newest-first ledger',
    /function forEachInDateWindow\(/.test(dailySummaryLogic) &&
      /if \(seen && newestFirst\) break/.test(dailySummaryLogic) &&
      /forEachInDateWindow\(state\.transactions, \(date\) => date === dayISO/.test(dailySummaryLogic),
    'reminder setup must not walk 2019 to total today\'s coffees');

  ok('settled-card history is cached by immutable card inputs and day',
    /let recentlySettledDuesCache:/.test(cards) &&
      /recentlySettledDuesCache\.withinDays === withinDays/.test(cards) &&
      /sameInputs\(recentlySettledDuesCache, state\)/.test(cards),
    'Cards/All should not replay statement allocation when revisiting Bills on an unchanged ledger');

  ok('card statement allocation is cached once per card and immutable ledger snapshot',
    /let allocationCache:/.test(cards) && /sameInputs\(allocationCache, state\)/.test(cards) &&
      /allocationCache\.byAccount\.get\(accountId\)/.test(cards),
    'Bills history and card detail must not replay the same payment allocation once per statement');

  ok('Ask Wafra paints Android Send state before interpreting the ledger',
    /Platform\.OS === 'android'[\s\S]*?new Promise<void>\(\(resolve\) => requestAnimationFrame/.test(assistantScreen) &&
      /runWafraAssistantCooperatively/.test(assistantScreen),
    'the input must clear and pending turn must paint before any large-ledger calculation starts');

  ok('Ask Wafra suggestions never run recurrence detection just to choose a chip',
    /state\.bills\.length > 0 \|\| state\.cardDues\.length > 0/.test(assistant) &&
      !/suggestedAssistantQuestions[\s\S]{0,1800}leavingSoon\(/.test(assistant.slice(assistant.indexOf('export function suggestedAssistantQuestions'))),
    'opening the Assistant should not trigger subscription analysis before the user asks a question');

  const paymentAgenda = stripComments(read('src/components/bills/payment-agenda.tsx'));
  const referencePresentation = stripComments(read('src/lib/reference-presentation.ts'));
  ok('Bills renders long agendas progressively instead of mounting every row at once',
    /PAYMENT_AGENDA_PAGE_SIZE\s*=\s*24/.test(paymentAgenda) &&
      /groupPaymentAgendaWindow\(visibleItems, includePaid, renderLimit\)/.test(paymentAgenda) &&
      /section\.items\.slice\(0, remaining\)/.test(paymentAgenda) &&
      /setRenderLimit\(\(current\) => current \+ PAYMENT_AGENDA_PAGE_SIZE\)/.test(paymentAgenda),
    'large imported histories can create many recurring rows; the ScrollView must keep first mount bounded');

  ok('Bills bounds agenda sorting to the visible window before React receives recurrence results',
    /export function groupPaymentAgendaWindow/.test(referencePresentation) &&
      /kept\.length === boundedLimit/.test(referencePresentation) &&
      /kept\.splice\(low, 0, item\)/.test(referencePresentation) &&
      /if \(kept\.length > boundedLimit\) kept\.pop\(\)/.test(referencePresentation),
    'pagination after fully sorting every recurring candidate still leaves the expensive synchronous work on the JS thread');

  const insightSource = stripComments(read('src/lib/insights.ts'));
  const flow = stripComments(read('src/app/(tabs)/flow.tsx'));
  const wallet = stripComments(read('src/app/(tabs)/wallet.tsx'));
  ok('month summaries stop after leaving a newest-first bounded period',
    /if \(seenInPeriod && newestFirst && !unbounded\) break/.test(insightSource),
    'a 14k-row history must not walk 2019 just to total this month');

  ok('month early-exit requires the whole ledger to be newest-first, not a sorted prefix',
    /function datesAreNewestFirst/.test(insightSource) &&
      /const newestFirst = datesAreNewestFirst\(transactions\)/.test(insightSource),
    'a newest-first prefix with later in-period rows would undercount money if we stopped at the first inversion');

  ok('Wallet reissue suggestions are cached on the immutable ledger snapshot',
    /let reissueCache:/.test(cards) &&
      /reissueCache\?\.transactions === state\.transactions/.test(cards),
    'opening Wallet three times on an unchanged 14k-row ledger was 122ms each');

  ok('Wallet does not filter the whole ledger a second time just to count SMS rows',
    !/state\.transactions\.filter\(\(tx\) => tx\.source === 'sms'\)/.test(wallet),
    'smsCount belongs on the activity pass already walking accounts');

  ok('Flow activity preview stops after eight newest matches',
    /ACTIVITY_PREVIEW_LIMIT/.test(flow) &&
      /out\.length >= ACTIVITY_PREVIEW_LIMIT/.test(flow) &&
      !/\.filter\(\(tx\) => isSpending\(tx, live, internal\) && inPeriod\(tx\.date, period\)\)/.test(flow),
    'the preview is eight rows; copying the whole period of spending is wasted JS');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
