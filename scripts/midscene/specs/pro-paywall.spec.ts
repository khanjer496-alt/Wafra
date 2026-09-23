import { test, expect, openApp } from '../fixture';

/**
 * The paywall is the one screen where a placeholder reaching production costs
 * money directly: a price that failed to load renders as an empty string or a
 * raw product identifier, and the screen still looks finished.
 *
 * Nothing here completes a purchase. Wafra's rules forbid an agent making one,
 * and a web export has no store to make it against.
 */
test.describe('pro', () => {
  test.beforeEach(async ({ page, aiWaitFor, aiTap }) => {
    await openApp(page, aiWaitFor);
    await aiTap('the control that opens the Pro, upgrade or subscription screen');
  });

  test('the price is a real price', async ({ aiQuery }) => {
    const offers = await aiQuery<{ plan: string; price: string }[]>(
      '{ plan: string, price: string }[], each subscription plan offered with its ' +
      'price exactly as printed.',
    );
    test.skip(!offers?.length, 'no plans rendered in this build');

    const broken = offers.filter((o) => {
      const price = String(o.price ?? '');
      // A store product id, a templating placeholder, or a literal price
      // failure are all things this screen has no other way of reporting.
      return price.trim() === ''
        || /undefined|null|nan|\{\{|\$\{|com\.[a-z0-9.]+/i.test(price)
        || !/\d/.test(price);
    });
    expect(broken, `plans with an unusable price: ${JSON.stringify(broken)}`).toHaveLength(0);
  });

  test('what Pro includes is stated, and the billing period with it', async ({ aiAssert }) => {
    await aiAssert(
      'the screen says what the paid tier includes and states the billing period for ' +
      'each price (per month, per year). A bare figure with no period fails this check',
    );
  });

  test('the free tier is not misrepresented', async ({ aiAssert }) => {
    await aiAssert(
      'nothing on this screen claims a capability the app does not have, and the ' +
      'free tier is described rather than hidden — the user can tell what they keep ' +
      'without paying',
    );
  });

  test('dismissing the paywall returns to the app', async ({ aiTap, aiAssert }) => {
    await aiTap('the control that closes or dismisses this screen');
    await aiAssert(
      'the paywall is closed and an ordinary app screen is visible again. The app is ' +
      'not stuck behind the paywall and no purchase was started',
    );
  });
});
