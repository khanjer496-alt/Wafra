import { test, expect, openApp, money, sumMoney } from '../fixture';

/**
 * Home is the screen every session starts on, and the defects it has shipped
 * have all been arithmetic or typographic rather than thrown exceptions: a
 * headline total that did not equal the rows printed under it, a figure
 * ellipsised to "1…", a heading whose window did not match what it counted.
 */
test.describe('home', () => {
  test.beforeEach(async ({ page, aiWaitFor }) => {
    await openApp(page, aiWaitFor);
  });

  test('the headline figure is money, labelled, and complete', async ({ aiAssert, aiQuery }) => {
    await aiAssert(
      'the largest figure on the screen is a money amount with a visible currency ' +
      'and a label saying what it measures and over what period',
    );

    const clipped = await aiQuery<string[]>(
      'string[], every money amount on screen that is cut off, truncated, or ends ' +
      'in an ellipsis so the reader cannot see all of its digits. Empty array if none.',
    );
    expect(clipped ?? [], 'money figures were truncated').toHaveLength(0);
  });

  test('net equals income minus spending', async ({ aiQuery }) => {
    // Home prints Spending, Income and Net within one card, so the screen
    // carries its own proof. This is the check that catches a transfer counted
    // on one side only, a refund signed the wrong way, or a period that moved
    // under one figure and not the others — none of which throws.
    const hero = await aiQuery<{ spending: string; income: string; net: string }>(
      '{ spending: string, income: string, net: string }, the spending total, the ' +
      'income total and the net figure from the summary at the top of this screen, ' +
      'each exactly as printed including its sign.',
    );

    const spending = money(hero?.spending);
    const income = money(hero?.income);
    const net = money(hero?.net);
    test.skip(![spending, income, net].every(Number.isFinite), 'no income/net summary on this screen');

    // Spending is printed unsigned; net carries the sign. Compare magnitudes
    // against the subtraction rather than assuming either convention.
    expect(
      Math.abs(net - (income - Math.abs(spending))),
      `net ${hero.net} does not equal income ${hero.income} minus spending ${hero.spending}`,
    ).toBeLessThanOrEqual(0.02);
  });

  test('the spending breakdown adds up to the figure that links to it', async ({ aiQuery, aiTap }) => {
    const headline = await aiQuery<{ total: string; period: string }>(
      '{ total: string, period: string }, the spending total at the top of this ' +
      'screen and the period label beside it.',
    );
    const total = money(headline?.total);
    test.skip(!Number.isFinite(total), 'no spending total on this screen');

    await aiTap('the control that opens the spending breakdown from the summary');

    const rows = await aiQuery<{ category: string; amount: string }[]>(
      '{ category: string, amount: string }[], every category row in the breakdown ' +
      'that just opened, with its amount.',
    );
    test.skip(!rows?.length, 'the breakdown rendered no rows');

    const sum = sumMoney(rows.map((r) => r.amount));
    const tolerance = Math.max(1, rows.length / 2);
    expect(
      Math.abs(Math.abs(total) - Math.abs(sum)),
      `${headline.period}: ${headline.total} over ${rows.length} rows summing to ${sum}`,
    ).toBeLessThanOrEqual(tolerance);
  });

  test('no empty state is shown while the ledger has data', async ({ aiAssert }) => {
    // The store hydrates asynchronously and the screen it paints meanwhile is
    // the empty state. Shown after hydration, it is a lie about the user's data.
    await aiAssert(
      'the screen shows real transaction or balance data. It does not show an ' +
      'empty state, a "no transactions yet" message, a loading skeleton, or zeros ' +
      'standing in for figures that exist',
    );
  });

  test('every period label agrees with the figures it heads', async ({ aiQuery }) => {
    const headings = await aiQuery<{ heading: string; contradiction: string | null }[]>(
      '{ heading: string, contradiction: string | null }[], each heading or caption ' +
      'on screen that names a time window (for example "This month", "Last 30 days", ' +
      '"Leaving in 9 days"). For each, set contradiction to a short description if ' +
      'the figures or rows under it plainly do not match that window, otherwise null.',
    );
    const wrong = (headings ?? []).filter((h) => h.contradiction);
    expect(wrong, `period headings disagreed with their content: ${JSON.stringify(wrong)}`).toHaveLength(0);
  });

  test('nothing is drawn on top of anything else', async ({ aiAssert }) => {
    await aiAssert(
      'no text on this screen overlaps other text, and no figure is drawn in a ' +
      'colour that matches the surface behind it closely enough to be unreadable',
    );
  });
});
