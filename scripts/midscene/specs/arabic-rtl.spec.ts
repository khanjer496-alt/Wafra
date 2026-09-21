import { test, expect, openApp } from '../fixture';

/**
 * Arabic is a supported language, not a translation layer bolted on, and the
 * defects it produces are layout defects: a mirrored row whose amount now
 * collides with its label, a currency stranded on the wrong side of its
 * figure, a heading that overflows because the Arabic string is longer.
 *
 * Wafra ships worldwide; this suite treats Arabic as one locale among several
 * rather than as the product's home market.
 */
test.describe('arabic', () => {
  test.beforeEach(async ({ page, aiWaitFor, aiTap }) => {
    await openApp(page, aiWaitFor);
    await aiTap('the control that opens Settings');
    await aiTap('the language setting');
    await aiTap('the option for Arabic');
  });

  test('the interface mirrors and stays legible', async ({ page, aiWaitFor, aiAssert }) => {
    await openApp(page, aiWaitFor);
    await aiAssert(
      'the interface is in Arabic and laid out right-to-left: labels start at the ' +
      'right edge and the layout is mirrored, not left-to-right text merely translated',
    );
    await aiAssert(
      'no Arabic label is clipped, truncated with an ellipsis, or overlapping the ' +
      'figure beside it',
    );
  });

  test('money still reads correctly in Arabic', async ({ aiQuery }) => {
    const figures = await aiQuery<{ text: string; problem: string | null }[]>(
      '{ text: string, problem: string | null }[], every money amount visible. Set ' +
      'problem to a short description when the amount is unreadable: digits reversed, ' +
      'a currency symbol detached from its figure or on the wrong side, a minus sign ' +
      'that has drifted away from its number. Otherwise null.',
    );
    const wrong = (figures ?? []).filter((f) => f.problem);
    expect(wrong, `money rendered wrongly under Arabic: ${JSON.stringify(wrong)}`).toHaveLength(0);
  });

  test('nothing is left untranslated in the main flow', async ({ aiTap, aiQuery }) => {
    await aiTap('the "Spending" tab in the bottom tab bar');
    const english = await aiQuery<string[]>(
      'string[], any interface label on this screen still written in English. Ignore ' +
      'merchant names, bank names, currency codes and proper nouns, which are not ' +
      'translated. Empty array if none.',
    );
    expect(english ?? [], 'untranslated interface labels under Arabic').toHaveLength(0);
  });
});
