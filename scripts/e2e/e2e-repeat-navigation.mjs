import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.BASE ?? 'http://localhost:8139';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(base);
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  await settings.waitFor();
  // Same event turn reproduces taps queued while rendering is busy.
  await settings.evaluate(element => { element.click(); element.click(); });
  await page.waitForURL(`${base}/settings`);
  await page.getByRole('button', { name: 'Back', exact: true }).last().click();
  await page.waitForURL(`${base}/`);
  assert.equal(new URL(page.url()).pathname, '/');
  // Back must not leave a debounce lock that prevents reopening the page.
  await settings.click();
  await page.waitForURL(`${base}/settings`);
  await page.getByRole('button', { name: 'Back', exact: true }).last().click();
  await page.waitForURL(`${base}/`);
  console.log('PASS: repeated Settings taps, single Back, and immediate reopen');
} finally {
  await browser.close();
}
