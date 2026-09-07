import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

// Only the synthetic local demo is allowed. Never use a live customer ledger.
const base = process.env.BASE || 'http://127.0.0.1:8126';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname));
const out = path.resolve('artifacts/e2e-home-cashflow');
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const errors = [];
const results = [];
const minor = value => {
  const normalized = String(value).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0))
    .replace(/[\u061c\u200e\u200f]/g, '').replace(/٬/g, ',').replace(/٫/g, '.').replace(/−/g, '-');
  const match = normalized.match(/[+-]?\d[\d,]*(?:\.\d{1,2})?/);
  assert.ok(match, `No amount in ${value}`);
  return Math.round(Number(match[0].replace(/,/g, '')) * 100);
};
try {
  for (const language of ['en', 'ar']) {
    for (const mode of ['light', 'dark']) {
      for (const width of [320, 390]) {
        const context = await browser.newContext({ viewport: { width, height: 900 },
          locale: language === 'ar' ? 'ar-AE' : 'en-AE', colorScheme: mode, reducedMotion: 'reduce' });
        await context.route('**/*', route => {
          const url = route.request().url();
          return url.startsWith(base + '/') || url.startsWith('data:') || url.startsWith('blob:')
            ? route.continue() : route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(12000);
        page.on('pageerror', error => errors.push(String(error)));
        const name = `${language}-${mode}-${width}`;
        try {
          await page.goto(base + '/', { waitUntil: 'networkidle' });
          const summary = page.getByTestId('reference-home-summary');
          await summary.waitFor({ state: 'visible' });
          await page.evaluate(() => document.fonts.ready);
          const incoming = page.getByTestId('home-income-summary');
          const outgoing = page.getByTestId('home-spending-total');
          const net = page.getByTestId('home-net-summary');
          const labels = await Promise.all([incoming, outgoing, net].map(row => row.getAttribute('aria-label')));
          const visible = await Promise.all([incoming, outgoing, net].map(row => row.innerText()));
          assert.match(labels[0], language === 'ar' ? /^الدخل,/ : /^Money in,/);
          assert.match(labels[1], language === 'ar' ? /^المصروفات,/ : /^Money out,/);
          assert.match(labels[2], language === 'ar' ? /^الصافي,/ : /^Net,/);
          const amounts = labels.map(minor);
          assert.deepEqual(visible.map(minor), amounts, 'visible and accessible amounts are identical');
          assert.equal(amounts[2], amounts[0] - amounts[1], 'net reconciles exactly in cents');
          const background = await summary.evaluate(node => {
            for (let n = node; n; n = n.parentElement) {
              const value = getComputedStyle(n).backgroundColor;
              if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') return value;
            }
            return null;
          });
          assert.equal(background, mode === 'dark' ? 'rgb(20, 18, 15)' : 'rgb(244, 241, 234)');
          for (const row of [incoming, outgoing, net]) {
            await row.scrollIntoViewIfNeeded();
            const clipped = await row.evaluate(node => [...node.querySelectorAll('*')]
              .filter(n => n.children.length === 0 && n.textContent.trim())
              .some(n => n.scrollWidth > n.clientWidth + 1 || n.getBoundingClientRect().right > innerWidth + 1
                || n.getBoundingClientRect().left < -1));
            assert.equal(clipped, false, 'every complete amount fits the viewport');
          }
          await page.evaluate(() => {
            for (const n of document.querySelectorAll('*')) if (n.scrollTop) n.scrollTop = 0;
          });
          await page.screenshot({ path: path.join(out, `${name}.png`) });
          await incoming.click();
          await page.waitForURL(/transactions.*type=income/);
          await page.goBack();
          await outgoing.waitFor({ state: 'visible' });
          await outgoing.click();
          await page.waitForURL(/\/flow/);
          results.push({ name, passed: true });
          console.log('PASS ' + name);
        } catch (error) {
          results.push({ name, passed: false, error: String(error) });
          await page.screenshot({ path: path.join(out, `${name}-failure.png`) }).catch(() => {});
          console.log('FAIL ' + name + ': ' + String(error));
        } finally { await context.close(); }
      }
    }
  }
} finally {
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ results, errors,
    scope: 'Synthetic local browser data; not the installed phone app or private bank messages' }, null, 2));
  await browser.close();
}
assert.deepEqual(errors, []);
assert.ok(results.every(result => result.passed), 'Home cashflow browser checks failed');
console.log(`${results.length} Home cashflow browser cases passed`);
