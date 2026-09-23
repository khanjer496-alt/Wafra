import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * Midscene drives this suite with a vision-language model: every `ai*` call is
 * a screenshot plus a model round trip, not a DOM query. Three consequences
 * are encoded below and none of them are style preferences.
 *
 *  - Timeouts are minutes, not seconds. A replanning cycle can take several
 *    model calls, and a 30s Playwright default fails the test before the
 *    model has answered once.
 *  - Workers default to 1. Parallel workers multiply model spend and rate
 *    limiting, and the failure they produce ("connection reset") looks like an
 *    app bug rather than a quota.
 *  - The suite runs against the EXPORTED web build served by run.sh, never
 *    against `expo start`. The export is what the assertions describe.
 */
const BASE = process.env.BASE ?? 'http://localhost:8127';

/**
 * CI images here ship Chromium at a fixed path and forbid `playwright install`.
 * A developer machine has its own download and no such path. Probe rather than
 * pick, so the same config works in both places.
 */
const chromium = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const executablePath = existsSync(chromium) ? chromium : undefined;

/**
 * Wafra is a phone app. Reviewing it at a desktop viewport tests a layout no
 * user sees and hides exactly the defects this suite exists to catch — a
 * figure that only clips at 390px, a sheet that only overlaps the tab bar on a
 * short screen.
 */
const PHONE = { width: 390, height: 844 };

/** Dark mode doubles model spend, so it is opt-in: MIDSCENE_DARK=1. */
const themes = process.env.MIDSCENE_DARK === '1'
  ? (['light', 'dark'] as const)
  : (['light'] as const);

export default defineConfig({
  testDir: './specs',
  timeout: 5 * 60 * 1000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: Number(process.env.MIDSCENE_WORKERS ?? 1),
  // A retry re-runs the model, so a flaky assertion costs twice and still
  // reports green. Fail once and read the report instead.
  retries: 0,
  reporter: [['list'], ['@midscene/web/playwright-reporter', { type: 'merged' }]],
  use: {
    baseURL: BASE,
    viewport: PHONE,
    deviceScaleFactor: 2,
    hasTouch: true,
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
  },
  projects: themes.map((colorScheme) => ({
    name: colorScheme,
    use: { colorScheme },
  })),
});
