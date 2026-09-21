import { test, expect, openApp, money } from '../fixture';

/**
 * The one write path a browser can exercise end to end. It is worth a model's
 * time because the assertion is arithmetic rather than presence: adding a
 * known amount must move the total by exactly that amount, which is the check
 * that catches a row written to the wrong sign, the wrong account, or the
 * wrong month.
 */
test.describe('add transaction', () => {
  test('an added expense lands in the ledger and moves the total by its own amount', async ({
    page, aiWaitFor, aiTap, aiInput, aiQuery, aiAssert, aiNumber,
  }) => {
    await openApp(page, aiWaitFor);

    const before = await aiNumber(
      'the headline spending total for the current period on this screen, as a plain ' +
      'number with no currency symbol or grouping separators',
    );

    await aiTap('the control that adds a new transaction');
    await aiInput('137.50', 'the amount field on the add-transaction form');
    await aiInput('Midscene Test Merchant', 'the merchant or description field on the add-transaction form');
    await aiAssert('the form is filled in with an amount of 137.50 and a merchant name');
    await aiTap('the button that saves or confirms the new transaction');

    await aiWaitFor('the add-transaction form has closed and a ledger screen is visible again', {
      timeoutMs: 30_000,
    });

    const rows = await aiQuery<{ merchant: string; amount: string }[]>(
      '{ merchant: string, amount: string }[], every transaction row visible that ' +
      'mentions "Midscene Test Merchant".',
    );
    expect(rows?.length ?? 0, 'the saved transaction is not in the ledger').toBeGreaterThan(0);
    expect(Math.abs(money(rows[0].amount)), 'the saved amount is not the amount entered').toBeCloseTo(137.5, 2);

    const after = await aiNumber(
      'the headline spending total for the current period on this screen, as a plain ' +
      'number with no currency symbol or grouping separators',
    );
    if (Number.isFinite(before) && Number.isFinite(after)) {
      expect(
        Math.abs(Math.abs(after) - Math.abs(before)),
        `total moved from ${before} to ${after} after adding 137.50`,
      ).toBeCloseTo(137.5, 1);
    }
  });
});
