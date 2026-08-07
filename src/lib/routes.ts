/**
 * Every screen this app can be linked to, as a closed union.
 *
 * Why this file exists: `buildInsights` used to hand every insight a plain
 * `string` href, assigned by matching on the insight's id — `budget-*` went to
 * `/budgets`, everything else fell through to `/stats`. Neither screen existed.
 * Five of the six insights the demo ledger produces dead-ended on expo-router's
 * "Unmatched Route" page, and nothing in the codebase could have caught it,
 * because `'/budgets'` is a perfectly good `string`.
 *
 * So a destination is no longer a string. It is an `AppRoute`, and there are
 * two independent gates on that type:
 *
 *  1. This union. A route that is not listed here cannot be written into an
 *     `Insight.href` at all.
 *  2. `experiments.typedRoutes` (see app.json). With the router types
 *     generated, expo-router's `Href` is the union of the files under
 *     `src/app`, and every `router.push(route)` call site in the app checks an
 *     `AppRoute` against it — so listing a route here that has no screen fails
 *     `tsc`, and deleting a screen that is still linked to fails it too.
 *
 * Because the generated types live in `.expo/` (git-ignored, written by
 * `expo start`), gate 2 is only live once the dev server has run at least once.
 * `scripts/test/unit.test.js` therefore re-checks this list against the actual
 * files in `src/app` on every `npm test`, which needs no generated anything.
 *
 * Keep the list ordered the way the app is: tabs first, then pushed screens.
 */
export const APP_ROUTES = [
  // Tabs
  '/',
  '/flow',
  '/bills',
  '/wallet',
  // Pushed screens
  '/stats',
  '/transactions',
  '/cards',
  '/settings',
  '/accuracy',
  '/categorise',
  '/import-sms',
  '/ios-setup',
  '/add-transaction',
  '/pro',
] as const;

/** A screen, with no query string. */
export type StaticRoute = (typeof APP_ROUTES)[number];

/**
 * A screen, optionally carrying a query string — `/transactions?category=dining`
 * is how a drill-down arrives pre-filtered. Mirrors what expo-router's `Href`
 * accepts, so an `AppRoute` is always pushable.
 */
export type AppRoute = StaticRoute | `${StaticRoute}?${string}`;
