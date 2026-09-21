import { test, expect, openApp } from '../fixture';

/**
 * The four-tab IA, checked the way a person checks it: land on each tab and
 * ask whether the screen is the one the tab promised.
 *
 * Expo Router keeps every route mounted behind the current one, so a tab that
 * navigates nowhere still leaves the previous screen painted and a presence
 * assertion passes. Reading the screen catches that; querySelector cannot.
 */
test.describe('navigation', () => {
  const TABS = ['Home', 'Spending', 'Bills', 'Accounts'] as const;

  for (const tab of TABS) {
    test(`${tab} tab opens its own screen`, async ({ page, aiWaitFor, aiTap, aiAssert }) => {
      await openApp(page, aiWaitFor);
      await aiTap(`the "${tab}" tab in the bottom tab bar`);
      await aiAssert(
        `the visible screen is the ${tab} screen and its content matches that name. ` +
        'It is not a blank screen, not an error screen, and not one of the other three tabs.',
      );
    });
  }

  test('the tab bar never covers the last row of content', async ({ page, aiWaitFor, aiTap, aiScroll, aiAssert }) => {
    // The tab bar floats over the scroll view. Scrolled to the bottom, the
    // final row can sit underneath it — readable in a screenshot taken
    // mid-scroll, unreachable to a thumb.
    await openApp(page, aiWaitFor);
    await aiTap('the "Spending" tab in the bottom tab bar');
    await aiScroll({ direction: 'down', scrollType: 'untilBottom' });
    await aiAssert(
      'the bottom-most row of the list is fully readable and is not hidden behind ' +
      'or overlapped by the floating tab bar',
    );
  });

  test('no screen reports an error or a missing route', async ({ page, aiWaitFor, aiTap, aiQuery }) => {
    await openApp(page, aiWaitFor);
    for (const tab of TABS) {
      await aiTap(`the "${tab}" tab in the bottom tab bar`);
      const problems = await aiQuery<string[]>(
        'string[], any text on screen that reports a failure to the user: ' +
        '"Unmatched route", "not found", "something went wrong", a raw stack trace, ' +
        'or a red error banner. Return an empty array when there is none.',
      );
      expect(problems ?? [], `${tab} showed an error`).toHaveLength(0);
    }
  });
});
