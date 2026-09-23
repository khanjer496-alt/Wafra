import { test, expect, openApp, money, sumMoney } from '../fixture';

/**
 * Spending is the screen where a category breakdown and a headline total are
 * printed within a thumb's width of each other. If they are computed over
 * different windows, different accounts, or with transfers counted on one side
 * only, nothing on the screen says so.
 */
test.describe('spending', () => {
  test.beforeEach(async ({ page, aiWaitFor, aiTap }) => {
    await openApp(page, aiWaitFor);
    await aiTap('the "Spending" tab in the bottom tab bar');
  });

  test('categories sum to the total above them', async ({ aiQuery }) => {
    const view = await aiQuery<{ total: string; categories: { name: string; amount: string }[] }>(
      '{ total: string, categories: { name: string, amount: string }[] }, the total ' +
      'spend figure shown on this screen and every category row with its amount. ' +
      'Scroll is not needed — report only what the category breakdown contains.',
    );

    const total = money(view?.total);
    test.skip(!Number.isFinite(total) || !view?.categories?.length, 'no category breakdown rendered');

    const sum = sumMoney(view.categories.map((c) => c.amount));
    const tolerance = Math.max(1, view.categories.length / 2);
    expect(
      Math.abs(Math.abs(total) - Math.abs(sum)),
      `total ${view.total} vs categories summing to ${sum} (${view.categories.length} rows)`,
    ).toBeLessThanOrEqual(tolerance);
  });

  test('a truncated list does not sit under a total that covers more', async ({ aiAssert }) => {
    // "Top 5 categories" over a total for all twenty is the exact shape of a
    // bug that shipped here: both figures correct, the pairing wrong.
    await aiAssert(
      'if the category list is limited to a few rows — "Top 5", "See all", a cut-off ' +
      'list — then the total printed above it is explicitly labelled as covering ' +
      'those rows only, or the screen otherwise makes clear the total is wider than ' +
      'the list. A bare total over a truncated list fails this check.',
    );
  });

  test('opening a category shows that category, and its rows sum to its own total', async ({ aiTap, aiQuery }) => {
    await aiTap('the first category row in the spending breakdown');

    const detail = await aiQuery<{ category: string; total: string; rows: { title: string; amount: string }[] }>(
      '{ category: string, total: string, rows: { title: string, amount: string }[] }, ' +
      'the category name this detail screen is showing, its total, and the ' +
      'transaction rows listed on it with their amounts.',
    );

    expect(detail?.category, 'category detail did not name a category').toBeTruthy();
    const total = money(detail?.total);
    test.skip(!Number.isFinite(total) || !detail?.rows?.length, 'category detail rendered no rows');

    const sum = sumMoney(detail.rows.map((r) => r.amount));
    // A detail screen may page its rows. Only assert the direction that can
    // never be right: rows adding up to MORE than the total they belong to.
    expect(
      Math.abs(sum) - Math.abs(total),
      `${detail.category}: rows sum to ${sum}, above a total of ${detail.total}`,
    ).toBeLessThanOrEqual(Math.max(1, detail.rows.length / 2));
  });

  test('income is not printed as spending', async ({ aiAssert }) => {
    // Salary landing in a spend breakdown is the single loudest wrong number
    // this app can show, and it is one sign flip away at all times.
    await aiAssert(
      'no row in the spending breakdown is an income or salary payment, and no ' +
      'spending figure is shown as a negative number that reads as money received',
    );
  });
});
