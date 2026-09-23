import { test, expect, openApp } from '../fixture';

/**
 * Bills is a screen entirely about dates, and its defects have been date
 * defects: a bill dated in the past filed under "upcoming", a countdown that
 * counts to a different day than the date beside it.
 */
test.describe('bills', () => {
  test.beforeEach(async ({ page, aiWaitFor, aiTap }) => {
    await openApp(page, aiWaitFor);
    await aiTap('the "Bills" tab in the bottom tab bar');
  });

  test('upcoming bills are actually upcoming', async ({ aiQuery }) => {
    const bills = await aiQuery<{ name: string; due: string; section: string }[]>(
      '{ name: string, due: string, section: string }[], every bill row visible, ' +
      'with the due date exactly as printed and the section heading it sits under.',
    );
    test.skip(!bills?.length, 'no bills rendered');

    const overdueInUpcoming = bills.filter((b) => {
      if (!/upcoming|due soon|next/i.test(b.section ?? '')) return false;
      const when = Date.parse(b.due);
      // Unparseable relative copy ("in 3 days") is the app's own wording and
      // is checked by the countdown test below, not here.
      return Number.isFinite(when) && when < Date.now() - 24 * 60 * 60 * 1000;
    });
    expect(overdueInUpcoming, `past-dated bills filed as upcoming: ${JSON.stringify(overdueInUpcoming)}`).toHaveLength(0);
  });

  test('every countdown agrees with the date beside it', async ({ aiQuery }) => {
    const rows = await aiQuery<{ row: string; countdown: string; date: string; agrees: boolean }[]>(
      '{ row: string, countdown: string, date: string, agrees: boolean }[], every row ' +
      'that prints BOTH a relative countdown ("in 9 days", "due tomorrow") and an ' +
      `absolute date. Today is ${new Date().toISOString().slice(0, 10)}. Set agrees ` +
      'to false when the countdown does not match the date. Empty array if no row prints both.',
    );
    const wrong = (rows ?? []).filter((r) => r.agrees === false);
    expect(wrong, `countdowns disagreeing with their dates: ${JSON.stringify(wrong)}`).toHaveLength(0);
  });

  test('a bill opens its own detail rather than the row behind it', async ({ aiTap, aiAssert }) => {
    await aiTap('the first bill row in the list');
    await aiAssert(
      'a detail view for that specific bill is open — it names the bill and shows its ' +
      'amount and schedule. It is not the list screen unchanged and not a different bill',
    );
  });

  test('subscriptions and utilities are not double counted', async ({ aiAssert }) => {
    await aiAssert(
      'no bill appears twice in the same list, and no total on this screen counts ' +
      'the same bill under two different sections',
    );
  });
});
