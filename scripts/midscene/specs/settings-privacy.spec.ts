import { test, expect, openApp } from '../fixture';

/**
 * Settings is read-only here on purpose. Wafra's screenmap rules forbid an
 * exploring agent from tapping erase, delete-account or delete-card, and a
 * model that is told to "explore settings" will eventually tap one. Every
 * assertion below reads; none of them acts on a destructive control.
 */
test.describe('settings', () => {
  test.beforeEach(async ({ page, aiWaitFor, aiTap }) => {
    await openApp(page, aiWaitFor);
    await aiTap('the control that opens Settings');
  });

  test('settings opens and groups its sections', async ({ aiAssert }) => {
    await aiAssert(
      'the Settings screen is open and its options are grouped under headings ' +
      'rather than listed as one undifferentiated column',
    );
  });

  test('destructive actions are marked as destructive', async ({ aiQuery }) => {
    const actions = await aiQuery<{ label: string; marked: boolean }[]>(
      '{ label: string, marked: boolean }[], every control on this screen that would ' +
      'erase, delete or reset the user\'s data. Set marked to true when it is ' +
      'visually distinguished as destructive (for example red text or a warning). ' +
      'Do not activate anything. Empty array if there are none.',
    );
    const unmarked = (actions ?? []).filter((a) => a.marked === false);
    expect(unmarked, `destructive controls not marked as such: ${JSON.stringify(unmarked)}`).toHaveLength(0);
  });

  test('the privacy section states where data lives', async ({ aiTap, aiAssert }) => {
    await aiTap('the Privacy or data section in Settings');
    await aiAssert(
      'this screen states plainly where the user\'s financial data is stored and ' +
      'what leaves the device, in specific terms rather than a generic reassurance',
    );
  });

  test('no screen leaks a key, token or raw identifier', async ({ aiQuery }) => {
    const leaks = await aiQuery<string[]>(
      'string[], any text visible on this screen that looks like a secret or an ' +
      'internal identifier rather than something meant for a user: an API key, a ' +
      'bearer token, a long random hex or base64 string, a raw database id, or a ' +
      'stack trace. Empty array if none.',
    );
    expect(leaks ?? [], 'settings surfaced internal values to the user').toHaveLength(0);
  });
});
