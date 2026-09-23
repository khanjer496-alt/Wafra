import { test, expect, openApp, money } from '../fixture';

/**
 * Accounts carries the two figures a user trusts most and checks against their
 * bank app: a balance and a card's amount due. Both are derived, both can be
 * quietly wrong, and neither throws when it is.
 */
test.describe('accounts and cards', () => {
  test.beforeEach(async ({ page, aiWaitFor, aiTap }) => {
    await openApp(page, aiWaitFor);
    await aiTap('the "Accounts" tab in the bottom tab bar');
  });

  test('every balance is a figure with a currency, not a placeholder', async ({ aiQuery }) => {
    const accounts = await aiQuery<{ name: string; balance: string }[]>(
      '{ name: string, balance: string }[], every account or wallet row on this ' +
      'screen with the balance exactly as printed.',
    );
    test.skip(!accounts?.length, 'no accounts rendered');

    const broken = accounts.filter((a) => {
      const text = String(a.balance ?? '');
      // An em dash or "--" is the app deliberately refusing to quote an
      // unreliable balance, which is correct behaviour. "NaN", "undefined" and
      // an empty cell are not.
      if (/^[\s—–-]*$/.test(text)) return false;
      if (/nan|undefined|null|infinity/i.test(text)) return true;
      return !Number.isFinite(money(text));
    });
    expect(broken, `accounts with an unreadable balance: ${JSON.stringify(broken)}`).toHaveLength(0);
  });

  test('a card states what is owed and when, or says it does not know', async ({ aiAssert }) => {
    await aiAssert(
      'for each payment card shown, the screen either states an amount due together ' +
      'with a due date, or plainly says the statement is not yet known. It never ' +
      'shows an amount with no date, or a date with no amount',
    );
  });

  test('a settled card is not still shown as owing', async ({ aiQuery }) => {
    const cards = await aiQuery<{ card: string; status: string; due: string; contradiction: string | null }[]>(
      '{ card: string, status: string, due: string, contradiction: string | null }[], ' +
      'every payment card shown, its status wording, the amount it says is due, and ' +
      'a short contradiction description when the status and the amount disagree ' +
      '(for example "paid"/"settled" next to an outstanding amount above zero). ' +
      'Set contradiction to null when they agree.',
    );
    const wrong = (cards ?? []).filter((c) => c.contradiction);
    expect(wrong, `card status contradicts its balance: ${JSON.stringify(wrong)}`).toHaveLength(0);
  });

  test('opening an account shows that account', async ({ aiTap, aiAssert }) => {
    await aiTap('the first account row on the Accounts screen');
    await aiAssert(
      'a detail view for that account is open, naming it and listing its own ' +
      'transactions or statement. It is not a different account and not an error',
    );
  });
});
