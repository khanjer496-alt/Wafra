import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.env.BASE || 'http://127.0.0.1:8126';
const out = new URL('../../artifacts/e2e-redesign/', import.meta.url);
await mkdir(out, { recursive: true });
const results = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
// This is a synthetic local demo. Never send its data to production services.
await page.route('**/*', route => {
  const url = route.request().url();
  return url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:')
    ? route.continue() : route.abort();
});
page.setDefaultTimeout(8000);
let shot = 0;
async function check(name, action) {
  const start = Date.now();
  try {
    await action();
    results.push({ name, passed: true, durationMs: Date.now() - start });
    console.log('PASS ' + name);
  } catch (error) {
    results.push({ name, passed: false, durationMs: Date.now() - start, error: String(error) });
    console.log('FAIL ' + name + ': ' + String(error));
    await page.screenshot({ path: new URL(`failure-${++shot}.png`, out).pathname }).catch(() => {});
  }
}
async function go(path) {
  await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
}
async function exists(id) { await page.getByTestId(id).waitFor({ state: 'visible' }); }
async function screenshot(name) {
  await page.screenshot({ path: new URL(name + '.png', out).pathname, fullPage: false });
}
async function noPageOverflow() {
  const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(size.scroll <= size.width + 2, JSON.stringify(size));
}

await check('Home renders the implemented reference layout', async () => {
  await go('/'); await exists('reference-home-summary');
  await exists('home-spending-total'); await exists('home-income-summary');
  assert.equal(await page.getByTestId('reference-quick-actions').count(), 0);
  assert.equal(await page.getByText('Recorded balances', { exact: true }).count(), 0);
  await screenshot('home-dark');
});
await check('Four bottom tabs are present and actionable', async () => {
  for (const [name,id] of [['Spending','spending-categories'],['Bills','payment-agenda'],['Accounts','account-groups'],['Home','reference-home-summary']]) {
    await page.getByRole('tab', { name, exact: true }).click();
    await exists(id);
  }
});
await check('Categories, Activity and Trends stay inside Spending', async () => {
  await go('/flow'); await exists('spending-categories');
  await page.getByRole('tab', { name: 'Activity', exact: true }).click(); await exists('spending-activity');
  await page.getByRole('tab', { name: 'Trends', exact: true }).click(); await exists('spending-trends');
  await page.getByRole('tab', { name: 'Categories', exact: true }).click(); await exists('spending-categories');
});
await check('Every spending category shows its share of total spending', async () => {
  await go('/flow');
  const shares = page.locator('[data-testid^="spending-share-"]');
  assert.ok(await shares.count() > 0);
  for (const share of await shares.all()) {
    assert.match(await share.innerText(), /(?:<)?\d+(?:\.\d+)?%\s+of spending/);
  }
});
await check('Bills filters subscriptions and utilities while preserving due-date sections', async () => {
  await go('/bills');
  const agenda = page.getByTestId('payment-agenda');
  await exists('payment-agenda');
  const sectionOrder = ['overdue', 'expected-earlier', 'soon', 'later', 'paid'];
  const visiblePayments = async () => {
    const sections = agenda.locator('[data-testid^="bills-"]');
    const keys = await sections.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid').replace('bills-', '')));
    assert.ok(keys.length > 0, 'The selected payment family must have populated due-date sections');
    assert.ok(keys.every((key, index) => sectionOrder.includes(key) &&
      (index === 0 || sectionOrder.indexOf(key) > sectionOrder.indexOf(keys[index - 1]))),
    `Payment sections must retain urgency/date order: ${keys}`);
    const labels = await sections.getByRole('button').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
    assert.ok(labels.length > 0 && labels.every(label => /AED [\d,]+/.test(label)), 'Payments expose their amounts');
    return labels;
  };
  // Bills has two views (Next 30 days / All); the payment families are
  // filters inside All.
  const allTab = page.getByRole('tab', { name: 'All', exact: true });
  await allTab.click();
  assert.equal(await allTab.getAttribute('aria-selected'), 'true');
  const selectFamily = async (name) => {
    const filter = page.getByTestId(`bills-filter-${name}`);
    await filter.click();
    assert.equal(await filter.getAttribute('aria-selected'), 'true');
    return visiblePayments();
  };
  const subscriptions = await selectFamily('subscriptions');
  for (const title of ['Netflix', 'Amazon Prime']) {
    assert.ok(subscriptions.some(label => label.startsWith(`${title}. `)), `${title} must appear in Subscriptions`);
  }
  assert.ok(subscriptions.every(label => !/^(?:DEWA|E&|du|Etisalat)/.test(label)), 'Utilities must not leak into Subscriptions');
  const utilities = await selectFamily('utilities');
  for (const title of ['DEWA Bill', 'Etisalat Postpaid', 'du Home Internet']) {
    assert.ok(utilities.some(label => label.startsWith(`${title}. `)), `${title} must appear in Utilities`);
  }
  assert.ok(utilities.every(label => !subscriptions.includes(label)), 'The payment families must be disjoint');
  assert.ok(utilities.every(label => !/^(?:Netflix|Spotify(?: Premium)?|YouTube Premium|Amazon Prime|Fitness First)\. /.test(label)),
    'Subscriptions must not leak into Utilities');
  const all = await selectFamily('everything');
  assert.ok([...subscriptions, ...utilities].every(label => all.includes(label)), 'All restores both complete payment families');
});
await check('Spending search responds to input and recovers', async () => {
  await go('/flow?view=activity'); await exists('spending-activity');
  const input = page.getByRole('textbox', { name: 'Search spending', exact: true });
  await input.fill('definitely-no-such-merchant-qa');
  await page.getByText('No matching expenses', { exact: true }).waitFor({ state: 'visible' });
  await input.fill('');
  assert.ok(await page.getByTestId('spending-activity').getByRole('button').count() > 1);
});
await check('A category opens history and its expense-filtered transaction ledger', async () => {
  await go('/flow');
  const rows = page.getByTestId('spending-categories').locator('[data-testid^="spending-category-"][aria-label*=". AED"]');
  assert.ok(await rows.count() > 0, 'No category has an accessible amount');
  const categoryId = (await rows.first().getAttribute('data-testid')).replace('spending-category-', '');
  const categoryName = (await rows.first().getAttribute('aria-label')).split('. AED')[0];
  await rows.first().click(); await exists('category-history');
  await page.getByRole('button', { name: 'View transactions', exact: true }).click();
  await page.waitForURL(/transactions.*category=/);
  const destination = new URL(page.url());
  assert.equal(destination.pathname, '/transactions');
  assert.equal(destination.searchParams.get('category'), categoryId);
  assert.equal(destination.searchParams.get('type'), 'expense');
  await exists('transactions-summary');
  assert.match(await page.getByTestId('transactions-summary').innerText(), /\b2 filters\b/);
  const entries = await page.getByTestId('transaction-details-link').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
  assert.ok(entries.length > 0, 'The category ledger must render transactions');
  assert.ok(entries.every(label => label.includes(`, ${categoryName},`) && /, minus [\d,]+(?:\.\d+)? AED$/.test(label)),
    `The visible ledger must contain only ${categoryName} expenses: ${entries}`);
});
await check('The old Stats route opens Spending trends', async () => {
  await go('/stats'); await exists('spending-trends');
  assert.ok(page.url().includes('/flow'), page.url());
});
for (const mode of ['dark','light']) {
  await page.emulateMedia({ colorScheme: mode });
  for (const [name,path,id] of [['home','/','reference-home-summary'],['spending','/flow','spending-categories'],['bills','/bills','payment-agenda'],['accounts','/wallet','account-groups']]) {
    await check(`${name} ${mode} renders without page overflow`, async () => {
      await go(path); await exists(id); await noPageOverflow(); await screenshot(name + '-' + mode);
    });
  }
}
for (const path of ['/settings','/feedback','/import-sms','/ios-setup','/review-alerts','/categorise','/pro','/add-transaction','/transactions','/cards','/currency','/accuracy']) {
  await check('Route mounts: ' + path, async () => {
    await go(path);
    const body = await page.locator('body').innerText();
    assert.ok(body.trim().length > 30, 'Empty screen');
    assert.doesNotMatch(body, /Unmatched Route|This screen does not exist|Something went wrong/i);
    await noPageOverflow();
    await screenshot(path.slice(1));
  });
}
for (const width of [320,430]) {
  await page.setViewportSize({ width, height: 900 });
  for (const path of ['/','/flow','/flow?view=trends','/bills','/wallet','/settings']) {
    await check(`${width}px route ${path}`, async () => { await go(path); await noPageOverflow(); });
  }
}
await check('No JavaScript page errors across the route sweep', async () => assert.deepEqual(errors, []));
await writeFile(new URL('results.json', out), JSON.stringify({ source: process.env.GITHUB_SHA || 'local checked-in-source working tree', results, errors }, null, 2));
await writeFile(new URL('last-page.txt', out), await page.locator('body').innerText());
await browser.close();
const failed = results.filter(r => !r.passed).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
