import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.BASE ?? 'http://localhost:8154';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const out = process.env.OUT ?? 'artifacts/e2e-home-pattern';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [], errors = [];
try {
  for (const language of ['en', 'ar']) for (const profile of ['bare', 'legacy', 'full']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 },
      colorScheme: 'dark', reducedMotion: 'reduce', locale: language === 'ar' ? 'ar-AE' : 'en-AE' });
    await context.route('**/*', route => route.request().url().startsWith(base + '/') || /^(data|blob):/.test(route.request().url())
      ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!localStorage.getItem('wafra/state/v1'));
    await page.evaluate(({ language, profile }) => {
      const key = 'wafra/state/v1'; const state = JSON.parse(localStorage.getItem(key));
      delete state.txChunks; delete state.txChunkOrder; delete state.wafraGoals;
      Object.assign(state, { userName: 'there', language, languagePreference: language,
        themePreference: 'dark', onboarded: true, privateMode: true, captureOptOut: true,
        historyImport: null, onboardingPlan: null, onboardingCurrencyEvidence: null,
        transactions: [], budgets: [], bills: [], cardDues: [], accounts: [], dailySummary: false });
      if (profile !== 'bare') Object.assign(state, {
        dailySummary: true,
        bills: [{ id: 'qa', title: 'Synthetic bill', category: 'utilities', amountFils: 100, dueDay: 28, paidMonths: [] }],
        accounts: [{ id: 'qa-card', name: 'QA card', kind: 'card', cardType: 'credit', openingFils: 0, color: '#1F6B52' }],
      });
      if (profile === 'full') Object.assign(state, {
        userName: language === 'ar' ? 'نورة' : 'Sara',
        wafraGoals: ['salary', 'bills', 'subscriptions', 'spend-less', 'cash-cards'],
        budgets: [{ category: 'groceries', limitFils: 10000 }, { category: 'dining', limitFils: 10000 }],
      });
      localStorage.setItem(key, JSON.stringify(state));
      localStorage.removeItem('wafra/ui/home-widgets/v1');
    }, { language, profile });
    await page.reload({ waitUntil: 'networkidle' });
    const pattern = page.getByTestId('home-personal-pattern');
    await pattern.waitFor({ state: 'visible' });
    await page.evaluate(() => document.fonts.ready);
    const box = await pattern.boundingBox();
    const expected = profile === 'bare' ? [24, 24] : profile === 'legacy' ? [132, 24] : [159, 51];
    assert.equal(box.width, expected[0]); assert.equal(box.height, expected[1]);
    assert.ok(box.x >= 0 && box.x + box.width <= 390, 'artwork stays within the phone');
    if (profile !== 'full') assert.equal(await pattern.locator('svg').count(), 1, 'nameless anchor shows the real Wafra mark');
    else assert.match(await pattern.innerText(), language === 'ar' ? /ن/ : /S/);
    assert.equal(await pattern.evaluate(node => getComputedStyle(node).direction), language === 'ar' ? 'rtl' : 'ltr');
    const name = `${language}-${profile}`;
    await page.screenshot({ path: `${out}/${name}.png` });
    results.push({ name, passed: true, width: box.width, height: box.height });
    console.log(`PASS ${name}`);
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(`${out}/results.json`, JSON.stringify({ results, errors,
    scope: 'Synthetic local browser profiles; no physical-device claim' }, null, 2));
}
assert.deepEqual(errors, []);
assert.equal(results.length, 6);
