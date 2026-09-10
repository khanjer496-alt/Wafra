// Opt-in, synthetic browser build only. Does not read an inbox or alter a phone.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://127.0.0.1:8126';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(BASE).hostname));
const OUT = process.env.UI_CLEANUP_EVIDENCE ?? 'artifacts/e2e-ui-cleanup';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const results = [];
async function visibleAction(button, page) {
  await button.waitFor({ state: 'visible' });
  const box = await button.boundingBox(), viewport = page.viewportSize();
  assert.ok(box && box.height >= 44 && box.y >= 0 && box.y + box.height <= viewport.height + 1,
    'Pinned action is outside the usable viewport: ' + JSON.stringify(box));
}
try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: theme, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    const routes = [
      ['home', '/'], ['spending', '/flow'], ['bills', '/bills'], ['accounts', '/wallet'],
      ['settings', '/settings'], ['capture-settings', '/settings?section=imports'],
      ['privacy', '/settings?section=privacy'], ['data', '/settings?section=data'],
      ['help', '/settings?section=help'], ['transactions', '/transactions'],
      ['merchant', '/merchant?name=Talabat'], ['merchants', '/merchants'],
      ['add-transaction', '/add-transaction'], ['imports', '/import-sms'],
      ['review-alerts', '/review-alerts'], ['review-transfers', '/review-transfers'],
      ['categories', '/categorise'], ['accuracy', '/accuracy'], ['feedback', '/feedback'],
      ['currency', '/currency'], ['cards', '/cards'], ['trusted-devices', '/trusted-devices'],
    ];
    for (const [name, route] of routes) {
      await page.goto(BASE + route, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(100);
      const metrics = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, text: document.body.innerText.length }));
      assert.ok(metrics.text > 10, `${theme}/${name}: blank page`);
      assert.ok(metrics.scrollWidth <= metrics.width + 1, `${theme}/${name}: page overflows horizontally`);
      await page.screenshot({ path: `${OUT}/${theme}-${name}.png` });
      results.push({ theme, screen: name, rendered: true });
    }
    await page.goto(BASE + '/transactions', { waitUntil: 'networkidle' });
    const summary = page.getByTestId('transactions-summary');
    const before = await summary.textContent();
    await page.getByRole('button', { name: 'Filter transactions', exact: true }).click();
    const sheet = page.getByTestId('transaction-filter-sheet');
    await sheet.waitFor({ state: 'visible' });
    const footer = page.getByTestId('transaction-filter-sheet-footer');
    await visibleAction(footer.getByRole('button', { name: /^Show / }), page);
    await sheet.getByRole('button', { name: '+ Income', exact: true }).click();
    await page.waitForTimeout(250);
    assert.equal(await summary.textContent(), before, 'Draft chip must not rebuild the visible result summary behind the modal');
    await page.screenshot({ path: `${OUT}/${theme}-filters-draft.png` });
    await footer.getByRole('button', { name: /^Show / }).click();
    await sheet.waitFor({ state: 'detached' });
    await page.waitForTimeout(200);
    assert.notEqual(await summary.textContent(), before, 'Apply must update the actual result set');
    await page.getByRole('button', { name: 'Filter transactions', exact: true }).click();
    await sheet.getByRole('button', { name: '− Expense', exact: true }).click();
    const committed = await summary.textContent();
    await sheet.getByRole('button', { name: 'Close', exact: true }).click();
    await sheet.waitFor({ state: 'detached' });
    assert.equal(await summary.textContent(), committed, 'Closing the sheet must discard the draft');
    assert.deepEqual(errors, [], `${theme}: runtime errors`);
    results.push({ theme, filterDraftApplyCancel: true, fixedFooter: true });
    await page.close();
  }
} finally {
  writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ renderedScreens: results.filter(r => r.rendered).length, filterFlows: results.filter(r => r.filterDraftApplyCancel).length, output: OUT }));
