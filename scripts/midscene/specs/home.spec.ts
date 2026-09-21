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

  test('the headline total equals the rows printed beneath it', async ({ aiQuery }) => {
    // The bug class this exists for: a total computed over the whole month and
    // a list showing a filtered subset, printed one above the other with
    // nothing saying they measure different things.
    const summary = await aiQuery<{ total: string; label: string; rows: { label: string; amount: string }[] }>(
      '{ total: string, label: string, rows: { label: string, amount: string }[] }, ' +
      'the headline total on this screen with the label that describes it, and the ' +
      'breakdown rows printed directly beneath that total with their amounts. ' +
      'Only include rows that belong to that breakdown.',
    );

    const total = money(summary?.total);
    test.skip(!Number.isFinite(total) || !summary?.rows?.length, 'no headline breakdown on this screen');

    const rows = sumMoney(summary.rows.map((r) => r.amount));
    // Rounding: each row is displayed to the nearest unit, so a breakdown of N
    // rows can differ from the stored total by up to N/2 units. Anything wider
    // than that is a real disagreement, not display rounding.
    const tolerance = Math.max(1, summary.rows.length / 2);
    expect(
      Math.abs(Math.abs(total) - Math.abs(rows)),
      `"${summary.label}" shows ${summary.total} over rows summing to ${rows}`,
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
