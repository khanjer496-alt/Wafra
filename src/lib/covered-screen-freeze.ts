/**
 * Which platforms pause screens that another screen covers.
 *
 * A screen under a pushed screen (Home under Transactions, a tab under Settings)
 * still re-renders on every store change, so one category edit recomputes the
 * dashboard, subscriptions and insights behind a screen nobody can see.
 *
 * One decision per platform, in one place. Android is on. iOS stays OFF until
 * App QA Lead's device pass: iOS uses its own native-tabs layout
 * (app-tabs-layout.ios.tsx) and its tabs are deliberately not frozen today.
 * Web is off: there is no native stack to cover anything.
 */
export const FREEZE_COVERED_SCREENS: Readonly<Record<string, boolean>> = {
  android: true,
  ios: false,
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
