/**
 * Which platforms pause screens that another screen covers.
 *
 * A screen under a pushed screen (Home under Transactions, a tab under Settings)
 * still re-renders on every store change, so one category edit recomputes the
 * dashboard, subscriptions and insights behind a screen nobody can see.
 *
 * One decision per platform, in one place. Android and iOS freeze covered
 * pushed screens on the root stack (nothing calls react-native-screens'
 * enableFreeze, so it was never on). The exempt routes below stay live. On iOS
 * the tab content is paused per tab by ios-tab-gate.tsx, because NativeTabs
 * never freezes its tabs; app-tabs-layout.tsx is Android/web only.
 * Web is off: there is no native stack to cover anything.
 */
const FREEZE_COVERED_SCREENS: Readonly<Record<string, boolean>> = {
  android: true,
  ios: true,
  web: false,
};

export const freezeCoveredScreens = (platformOS: string): boolean =>
  FREEZE_COVERED_SCREENS[platformOS] === true;

/**
 * Pushed screens, and the tab shell, that must keep rendering while covered.
 *
 * - `(tabs)`: the route hosts CaptureOwner (SMS capture, History import, shared
 *   formats). It must stay live; its tab content is paused separately, below it.
 * - `import-sms`, `ios-setup`, `teach-bank-format`: they show a long-running job
 *   or a native hand-off while another screen can be on top.
 */
export const FREEZE_EXEMPT_ROUTES = ['(tabs)', 'import-sms', 'ios-setup', 'teach-bank-format'] as const;

/**
 * Freezing starts this long after a screen is covered, so it stays painted for
 * the whole push animation (an immediate freeze blanks it while it slides).
 * Revealing it again is immediate: the first frame back shows current data.
 */
export const COVER_FREEZE_DELAY_MS = 600;

/**
 * iOS tabs: skip a tab's content until its first focus, and pause it while
 * unfocused afterwards (ios-tab-gate.tsx).
 *
 * expo-router's NativeTabs mounts all four tabs at launch and hard-codes
 * `freezeContents={false}`, so Flow, Bills and Wallet computed whole-ledger
 * figures on every store change while hidden, and cold start waited for all
 * four. Android tabs are already lazy and freeze on blur; web is unaffected.
 * Gating work until focus changes when a tab renders, never what it shows.
 */
const GATE_TABS_UNTIL_FOCUS: Readonly<Record<string, boolean>> = {
  ios: true,
  android: false,
  web: false,
};

export const gateTabsUntilFocus = (platformOS: string): boolean =>
  GATE_TABS_UNTIL_FOCUS[platformOS] === true;

/**
 * A hidden iOS tab that was never opened mounts once on its own, this long
 * after launch's first frames (and after each previous pre-warm), once the
 * foreground is idle (tab-prewarm.ts),
 * so its first open is no slower than when NativeTabs mounted every tab at
 * launch, without putting that work back on the launch itself.
 */
export const TAB_PREWARM_DELAY_MS = 3000;
