import { test, expect, openApp } from '../fixture';

/**
 * Activity is the screen a user reaches for when they are looking for one
 * specific payment, so the failures that matter are a search that does not
 * narrow, a filter that does not clear, and a row that opens the wrong detail.
 */
test.describe('transactions', () => {
  test.beforeEach(async ({ page, aiWaitFor, aiTap }) => {
    await openApp(page, aiWaitFor);
    await aiTap('the "Spending" tab in the bottom tab bar');
    await aiTap('the control that opens the full activity or transaction list');
  });

  test('search narrows the list to what was typed', async ({ aiQuery, aiInput, aiAssert }) => {
    const before = await aiQuery<{ merchant: string }[]>(
      '{ merchant: string }[], the merchant or title of every transaction row visible.',
    );
    test.skip(!before?.length, 'no transactions rendered');

    const term = String(before[0].merchant ?? '').split(/\s+/)[0];
    test.skip(!term || term.length < 3, 'no usable search term in the first row');

    await aiInput(term, 'the search field on the activity screen');
    await aiAssert(
      `every transaction row now visible is related to "${term}". No unrelated ` +
      'merchant is still listed, and the screen is not blank',
    );
  });

  test('clearing the search restores the full list', async ({ aiInput, aiTap, aiQuery }) => {
    await aiInput('zzzznotamerchant', 'the search field on the activity screen');
    await aiTap('the control that clears the search field');

    const rows = await aiQuery<{ merchant: string }[]>(
      '{ merchant: string }[], the merchant or title of every transaction row visible now.',
    );
    expect(rows?.length ?? 0, 'the list stayed empty after clearing the search').toBeGreaterThan(0);
  });

  test('a search with no matches says so instead of showing a blank screen', async ({ aiInput, aiAssert }) => {
    await aiInput('zzzzqqxnotamerchant', 'the search field on the activity screen');
    await aiAssert(
      'the screen explains that nothing matched the search. It is not a bare blank ' +
      'area, and it does not still show unrelated transactions',
    );
  });

  test('a row opens its own transaction', async ({ aiTap, aiQuery, aiAssert }) => {
    const rows = await aiQuery<{ merchant: string; amount: string }[]>(
      '{ merchant: string, amount: string }[], the first three transaction rows visible.',
    );
    test.skip(!rows?.length, 'no transactions rendered');

    await aiTap('the first transaction row in the list');
    await aiAssert(
      `a detail view is open for the transaction "${rows[0].merchant}" showing ` +
      `${rows[0].amount}. The merchant and the amount both match the row that was tapped`,
    );
  });
});
