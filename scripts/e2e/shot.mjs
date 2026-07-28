// Render the exported web build and screenshot each screen.
//
// Screens are reached by tapping the tab bar, never by loading a route URL.
// Two reasons: a cold route load throws the expo-router hydration error
// documented in README, and the static export serves `/flow.html`, not
// `/flow`, so a plain `python3 -m http.server` 404s on the extensionless
// path and every shot after home is a server error page.
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:8126';
const OUT = process.env.OUT ?? '/tmp/wafra-shots';

// Index 0 is Home, which is already on screen after onboarding.
const TABS = ['home', 'flow', 'bills', 'wallet'];

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

  // Clear the onboarding gate with the sample ledger loaded, so every screen
  // below has something to draw.
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const sample = page.getByText('Start with sample data', { exact: false }).last();
  if (await sample.isVisible().catch(() => false)) {
    await sample.click().catch(() => {});
    await page.waitForTimeout(2000);
  }

  await page.screenshot({ path: `${OUT}/${scheme}-home.png` });
  console.log(`shot ${scheme}-home`);

  const tabs = await page.getByRole('tab').all();
  if (tabs.length < TABS.length) {
    console.log(`! only ${tabs.length} tabs found, expected ${TABS.length}`);
  }
  for (let i = 1; i < Math.min(tabs.length, TABS.length); i++) {
    await tabs[i].click().catch((e) => console.log(`! ${TABS[i]}: ${e.message}`));
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${OUT}/${scheme}-${TABS[i]}.png` });
    console.log(`shot ${scheme}-${TABS[i]}`);
  }

  if (errors.length) {
    console.log(`\n--- ${scheme} console errors ---`);
    for (const e of [...new Set(errors)].slice(0, 12)) console.log(e);
  }
  await ctx.close();
}

await browser.close();
