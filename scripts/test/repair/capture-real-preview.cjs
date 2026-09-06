'use strict';
// Runs only against the explicitly seeded demo export, never a user's ledger.
// No native/device/performance claim follows from these browser captures.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

async function main() {
  const out = path.resolve('repair-evidence/browser');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const report = { scope: 'Actual Expo web export with synthetic demo data; not a physical Android test', screens: [] };
  try {
    for (const colorScheme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      for (const [name, route] of [['home', '/'], ['flow', '/flow'], ['bills', '/bills'], ['wallet', '/wallet'], ['transactions', '/transactions']]) {
        await page.goto(`http://localhost:8126${route}`, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(1500);
        await page.screenshot({ path: path.join(out, `${name}-${colorScheme}-390.png`), fullPage: true });
        report.screens.push({ name, colorScheme, url: page.url(), text: await page.locator('body').innerText(),
          tabs: await page.getByRole('tab').evaluateAll((nodes) => nodes.map((node) => ({ text: node.textContent, label: node.getAttribute('aria-label') }))),
          buttons: await page.getByRole('button').evaluateAll((nodes) => nodes.slice(0, 40).map((node) => ({ text: node.textContent, label: node.getAttribute('aria-label') }))),
          summaryVisible: name === 'home' ? await page.getByTestId('journal-summary').isVisible() : undefined,
          errors: [...errors] });
      }
      await context.close();
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
  if (report.screens.length !== 10 || report.screens.some((screen) => screen.errors.length > 0 || (screen.name === 'home' && !screen.summaryVisible))) {
    throw new Error('Exported screen capture exposed a runtime or Home-route failure; see report.json');
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
