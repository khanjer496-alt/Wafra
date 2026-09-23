import { test as base, expect } from '@playwright/test';
import type { PlayWrightAiFixtureType } from '@midscene/web/playwright';
import { PlaywrightAiFixture } from '@midscene/web/playwright';

export const test = base.extend<PlayWrightAiFixtureType>(
  PlaywrightAiFixture({
    // React Native Web mounts every route and animates between them. Without a
    // settle window the model photographs a half-drawn screen and reports a
    // missing element that is simply still fading in.
    waitForNetworkIdleTimeout: 2000,
    replanningCycleLimit: 30,
  }),
);

export { expect };

/**
 * Open the app and wait for the ledger to finish hydrating.
 *
 * The store hydrates asynchronously, and the screen it paints in the meantime
 * is the empty state. Asserting straight after `goto` therefore fails on an
 * empty Home that will be full a moment later — a false positive this suite
 * hit before the wait existed.
 */
export async function openApp(
  page: import('playwright').Page,
  aiWaitFor: PlayWrightAiFixtureType['aiWaitFor'],
  path = '/',
) {
  await page.goto(path);
  await aiWaitFor(
    'the app has finished loading: a populated screen with money figures is visible, not a blank or skeleton screen',
    { timeoutMs: 60_000 },
  );
}

/**
 * "AED 1,234.50" / "1,234.50" / "-1,234" → number. NaN when there is no figure.
 *
 * The suite compares totals against the rows printed beneath them, so it needs
 * the number the user reads, including the grouping separators that make a
 * naive parseFloat return 1.
 */
export function money(input: unknown): number {
  const cleaned = String(input ?? '').replace(/[^\d.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return Number.NaN;
  return Number(cleaned);
}

/** Sum a column of money strings or numbers, ignoring entries with no figure. */
export function sumMoney(values: unknown[]): number {
  return values.map(money).filter((n) => Number.isFinite(n)).reduce((a, b) => a + b, 0);
}
