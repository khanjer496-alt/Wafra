// Production-web UI regression with a large synthetic ledger. Not Android timing.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const { performanceLedger, now } = require('../test/fixtures/performance-ledger.cjs');
const { createWebSeed, STATE_KEY } = require('./universal-review-fixtures.cjs');
const { PARSER_VERSION } = require('../test/build/sms-parser.js');
const { TRANSFER_NORMALIZATION_VERSION } = require('../test/build/transfer-reconciliation.js');
const base = process.env.BASE ?? 'http://localhost:8128';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const out = path.resolve(process.env.PERFORMANCE_EVIDENCE ?? 'artifacts/performance-ui');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.PERFORMANCE_BROWSER_CHANNEL ? { channel: process.env.PERFORMANCE_BROWSER_CHANNEL } : {}),
  // The native app uses SQLCipher; browser localStorage's small quota is not a
  // meaningful Android ledger-size limit. This flag affects test contexts only.
  args: ['--unlimited-storage'],
});
const report = { scope: 'Synthetic production-web UI; action times include browser automation and are not phone latency.', rows: 15000, results: [], errors: [] };
try {
  const { transactions, ...state } = performanceLedger(report.rows);
  const meta = { ...JSON.parse(createWebSeed(null, now.getTime())[0][1]), ...state,
    parserVersion: PARSER_VERSION, transferNormalizationVersion: TRANSFER_NORMALIZATION_VERSION,
    transferInternalIds: [], txChunks: Math.ceil(transactions.length / 500), txChunkOrder: 'newest-first' };
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin
    ? route.continue() : route.abort());
  await context.addInitScript(({ meta, transactions, key }) => {
    if (localStorage.getItem('wafra/performance-seeded')) return;
    localStorage.setItem(key, JSON.stringify(meta));
    for (let i = 0; i < meta.txChunks; i++) localStorage.setItem(`${key}:tx:${i}`, JSON.stringify(transactions.slice(i * 500, (i + 1) * 500)));
    localStorage.setItem('wafra/performance-seeded', '1');
  }, { meta, transactions, key: STATE_KEY });
  const page = await context.newPage();
  await page.clock.install({ time: now });
  page.on('pageerror', error => report.errors.push(error.message));
  const painted = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function check(name, action) {
    const start = performance.now();
    await action();
    await painted();
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth > innerWidth + 2), false, `${name}: horizontal overflow`);
    report.results.push({ name, actionMs: Math.round(performance.now() - start) });
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    console.log(`PASS ${name}`);
  }
  await check('home-15000', async () => {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('home-spending-total').waitFor({ state: 'visible', timeout: 30000 });
  });
  for (const tab of ['Spending', 'Bills', 'Accounts', 'Home', 'Spending']) {
    await check(`tab-${tab.toLowerCase()}-${report.results.length}`, async () => {
      const button = page.getByRole('tab', { name: tab, exact: true });
      await button.click();
      await page.waitForFunction(label => [...document.querySelectorAll('[role="tab"]')]
        .some(el => (el.getAttribute('aria-label') ?? el.textContent).trim() === label && el.getAttribute('aria-selected') === 'true'), tab);
      if (tab === 'Home') {
        await page.getByTestId('home-spending-total').waitFor({ state: 'visible' });
      } else {
        // Selection changes before a lazy screen has rendered. A highlighted
        // tab over an empty body must not count as successful navigation.
        await page.waitForFunction(label => [...document.querySelectorAll('[role="heading"],h1,h2,h3,h4,h5,h6')].some(el => {
          if (el.textContent.trim() !== label) return false;
          const r = el.getBoundingClientRect();
          if (r.width < 4 || r.height < 4) return false;
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return top && (el.contains(top) || top.contains(el));
        }), tab, { timeout: 30000 });
      }
    });
  }
  const spending = page.getByTestId('reference-spending-screen').filter({ visible: true });
  for (const view of ['Trends', 'Activity', 'Categories']) {
    await check(`spending-${view.toLowerCase()}`, () => spending.getByText(view, { exact: true }).click());
  }
  await check('transactions-15000', async () => {
    await page.goto(`${base}/transactions`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Sample merchant 1', { exact: true }).first().waitFor({ state: 'visible', timeout: 30000 });
  });
  await check('ask-15000', async () => {
    await page.goto(`${base}/assistant`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('assistant-input').fill('How much did I spend?');
    await page.getByTestId('assistant-send').click();
    const answer = page.getByTestId('assistant-turn').last();
    await answer.waitFor({ state: 'visible', timeout: 30000 });
    const live = new Set(state.accounts.filter(account => !account.archived).map(account => account.id));
    const spending = transactions.filter(row => row.type === 'expense' && live.has(row.accountId) && row.date.startsWith('2026-09'));
    const expected = spending.reduce((sum, row) => sum + row.amountFils, 0);
    const text = await answer.innerText();
    const amount = text.match(/AED\s+([\d,]+(?:\.\d{1,2})?)/)?.[1];
    assert.ok(amount, 'Ask must calculate a monetary answer, not merely return help');
    assert.equal(Math.round(Number(amount.replaceAll(',', '')) * 100), expected);
    assert.ok(text.includes(`${spending.length} transactions`));
  });
  assert.deepEqual(report.errors, []);
  await context.close();
} finally {
  await browser.close();
  await writeFile(path.join(out, 'results.json'), JSON.stringify(report, null, 2) + '\n');
}
