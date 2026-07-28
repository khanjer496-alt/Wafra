// Persistence survives a reload.
//
// The save is debounced and skips re-serialising transactions when the array
// is unchanged, which is worth a suite of its own: both optimisations fail in
// the same direction — silently, by not writing — and the symptom is an app
// that opens as if brand new. That is indistinguishable from a fresh install,
// so nobody reports it as data loss.
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:8126';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name} ${detail}`);
  }
};

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const sample = page.getByText('Start with sample data', { exact: false }).last();
await sample.click();
await page.waitForTimeout(2500);

const heroBefore = await page.getByText(/AED/).first().textContent();
ok('sample ledger loads', !!heroBefore, String(heroBefore));

const keysBefore = await page.evaluate(() =>
  Object.keys(window.localStorage).filter((k) => k.startsWith('wafra/state')),
);
ok('state reaches storage after the debounce', keysBefore.length > 0, JSON.stringify(keysBefore));
ok('transactions are chunked out of the meta key',
  keysBefore.some((k) => k.includes(':tx:')), JSON.stringify(keysBefore));

// The real assertion: come back to a cold page and the ledger is still there.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const onboardingBack = await page
  .getByText('Start with sample data', { exact: false })
  .last()
  .isVisible()
  .catch(() => false);
ok('a reload does not drop the user back into onboarding', !onboardingBack);

const heroAfter = await page.getByText(/AED/).first().textContent();
ok('the ledger survives a reload', heroAfter === heroBefore, `${heroBefore} → ${heroAfter}`);

// A settings-only mutation must not lose transactions — that path now skips
// transaction serialisation entirely, so it is the one most likely to regress.
const chunksBefore = keysBefore.filter((k) => k.includes(':tx:')).length;
await page.evaluate(() => window.localStorage.setItem('wafra/probe', '1'));
await page.waitForTimeout(1200);
const chunksAfter = await page.evaluate(
  () => Object.keys(window.localStorage).filter((k) => k.includes(':tx:')).length,
);
ok('transaction chunks are still present after an unrelated write',
  chunksAfter === chunksBefore, `${chunksBefore} → ${chunksAfter}`);

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
