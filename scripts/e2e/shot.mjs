// Render the exported web build and screenshot each redesigned screen.
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:8126';
const OUT =
  process.env.OUT ??
  '/tmp/claude-0/-home-user-base-template/20ce20de-e638-5062-8ab4-6bd892249017/scratchpad/shots';

const SCREENS = [
  ['home', '/'],
  ['flow', '/flow'],
  ['bills', '/bills'],
  ['wallet', '/wallet'],
  ['transactions', '/transactions'],
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});

for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  // Clear the onboarding gate once, with the sample ledger loaded, so every
  // screen below has something to draw.
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  for (const label of ['Get started', 'Explore with sample data']) {
    const el = page.getByText(label, { exact: false }).last();
    if (await el.isVisible().catch(() => false)) {
      await el.click().catch(() => {});
      await page.waitForTimeout(1200);
    }
  }

  for (const [name, path] of SCREENS) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${scheme}-${name}.png` });
    console.log(`shot ${scheme}-${name}`);
  }

  if (errors.length) {
    console.log(`\n--- ${scheme} console errors ---`);
    for (const e of [...new Set(errors)].slice(0, 12)) console.log(e);
  }
  await ctx.close();
}

await browser.close();
