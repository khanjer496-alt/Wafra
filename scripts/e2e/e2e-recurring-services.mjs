// Service-scoped recurrence acceptance on a fresh local demo export.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = (process.env.BASE ?? 'http://localhost:8126').replace(/\/$/, '');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(BASE).hostname));
const OUT = path.resolve(process.env.OUT ?? 'artifacts/audit2-browser/recurring-services');
await mkdir(OUT, { recursive: true });
const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(executablePath) ? { executablePath } : {});
const STATE = 'wafra/state/v1';
const results = [];
const keyFor = (provider, tail) => `service:${JSON.stringify([provider.toLowerCase(), `consumer:${tail}`])}`;
const receiptRows = (provider) => ['1111', '2222'].flatMap((tail, i) => ['07', '08', '09'].map(month => ({
  id: `${provider}-${tail}-${month}`, type: 'expense', title: provider === 'E&' ? 'Etisalat Quickpay' : provider,
  category: provider === 'E&' ? 'telecom' : 'entertainment', accountId: 'service-bank', amountFils: 10000,
  source: 'sms', date: `2026-${month}-${i ? '15' : '01'}`, billIdentity: `consumer:${tail}`,
  ...(provider === 'E&' ? { paymentFlowSide: 'receipt' } : {}),
})));

async function tap(locator) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    for (const node of (await locator.all()).reverse()) {
      if (!await node.isVisible()) continue;
      await node.scrollIntoViewIfNeeded();
      await node.evaluate(el => {
        for (let i = 0; i < 4; i++) {
          const excess = el.getBoundingClientRect().bottom - (innerHeight - 125);
          if (excess <= 0) break;
          let parent = el.parentElement;
          while (parent && !(parent.scrollHeight > parent.clientHeight + 4 && parent.clientHeight > 160)) parent = parent.parentElement;
          if (!parent) break;
          parent.scrollTop += excess + 12;
        }
      });
      if (await node.evaluate(el => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!hit && (el.contains(hit) || hit.contains(el));
      })) { await node.click(); return; }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`No reachable control: ${locator}`);
}
async function openBills(page) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.getByTestId('home-spending-total').waitFor();
  await tap(page.getByRole('tab', { name: 'Bills', exact: true }));
  await page.getByTestId('bills-summary').waitFor();
}
const agendaRows = (page, tail) => page.getByTestId('payment-agenda').getByRole('button', { name: new RegExp(`^[^\\n]*•••• ${tail}\\.`) });
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE);
async function closeSheet(page) { await tap(page.getByRole('button', { name: 'Close', exact: true })); }
async function screenshot(page, name) {
  await page.evaluate(() => { for (const node of document.querySelectorAll('*')) if (node.scrollTop) node.scrollTop = 0; });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

try {
  const bootstrap = await browser.newPage();
  await bootstrap.goto(BASE + '/', { waitUntil: 'networkidle' });
  await bootstrap.getByTestId('home-spending-total').waitFor();
  await bootstrap.waitForFunction(key => JSON.parse(localStorage.getItem(key) ?? '{}').txChunks > 0, STATE);
  const meta = await stored(bootstrap);
  await bootstrap.close();
  for (const theme of ['light', 'dark']) for (const provider of ['E&', 'Netflix']) {
    const name = `${theme}-${provider === 'E&' ? 'utilities' : 'subscription'}`;
    if (process.env.CASE && !name.includes(process.env.CASE)) continue;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme, reducedMotion: 'reduce', timezoneId: 'UTC' });
    await context.route('**/*', route => {
      const url = route.request().url();
      return url.startsWith(BASE + '/') || url.startsWith('blob:') || url.startsWith('data:') ? route.continue() : route.abort();
    });
    await context.addInitScript(({ state, rows, key }) => {
      if (localStorage.getItem('wafra/e2e-services-seeded')) return;
      localStorage.setItem(key, JSON.stringify(state));
      localStorage.setItem(key + ':tx:0', JSON.stringify(rows));
      localStorage.setItem('wafra/e2e-services-seeded', '1');
    }, { key: STATE, rows: receiptRows(provider), state: { ...meta,
      language: 'en', languagePreference: 'en', themePreference: theme, captureOptOut: true,
      privateMode: false, dailySummary: false, monthStartDay: 1, ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
      accounts: [{ id: 'service-bank', name: 'Everyday account', kind: 'bank', openingFils: 100000, color: '#166CA2' }],
      txChunks: 1, txChunkOrder: 'oldest-first', bills: [], cardDues: [], budgets: [], goals: [],
      notSubscriptions: [], cancelledSubscriptions: {}, merchantOverrides: {}, billAliases: {}, historyImport: null,
    } });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    await page.clock.setFixedTime(new Date('2026-09-30T12:00:00Z'));
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => {
      if (/Encountered two children with the same key/i.test(message.text())) errors.push(message.text());
    });
    const checks = [];
    try {
      await openBills(page);
      for (const tail of ['1111', '2222']) {
        assert.equal(await agendaRows(page, tail).count(), 1, `one recognizable ${tail} row`);
        assert.equal(await agendaRows(page, tail).locator('[data-testid^="merchant-logo-"]').count(), 1, 'canonical merchant logo retained');
        assert.match(await agendaRows(page, tail).innerText(), /estimated/i,
          'a past receipt establishes history, not a confirmed future amount');
      }
      assert.match(await page.getByTestId('bills-summary').innerText(), /200\.00/);
      const pinIds = await page.locator('[data-testid^="bills-timeline-payment-"]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-testid')));
      assert.equal(pinIds.length, 2);
      assert.equal(new Set(pinIds).size, 2, 'timeline keys distinguish the services');
      checks.push('two recognizable logo rows, AED 200 total and unique timeline identities');
      await screenshot(page, `${name}-bills`);
      await tap(agendaRows(page, '2222'));
      assert.match(await page.getByTestId('bill-detail-head').innerText(), /2222/);
      const facts = await page.getByTestId('bill-detail-facts').innerText();
      assert.match(facts, /(?:Payments|Charges)\s*3/);
      assert.match(facts, /Total paid\s*AED 300/);
      const history = await page.getByTestId('subscription-history-scroll').innerText();
      assert.equal((history.match(/100/g) ?? []).length, 3);
      assert.match(history, /15/);
      assert.doesNotMatch(history, /(?:Jul|Aug|Sep) 1(?:,|\s)|1 (?:Jul|Aug|Sep)/);
      checks.push('second service opens exactly its own three payments and AED 300 total');
      await screenshot(page, `${name}-second-detail`);
      await page.getByTestId('subscription-history-scroll').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(OUT, `${name}-second-history.png`) });
      await closeSheet(page);
      if (provider === 'E&') {
        await tap(agendaRows(page, '1111'));
        await tap(page.getByTestId('bill-detail-remind'));
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).bills.length === 1, STATE);
        assert.equal((await stored(page)).bills[0].importIdentity, 'consumer:1111');
        assert.equal(await agendaRows(page, '2222').count(), 1, 'tracking one service keeps sibling visible');
        // Home shows the current month's tracked obligations; September is
        // already paid, so advance to the first unpaid occurrence.
        await page.clock.setFixedTime(new Date('2026-10-01T12:00:00Z'));
        await page.goto(BASE + '/', { waitUntil: 'networkidle' });
        await page.getByTestId('home-spending-total').waitFor();
        const firstHome = page.getByRole('button', { name: /^E& · •••• 1111\./ });
        await firstHome.waitFor();
        await firstHome.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(OUT, `${name}-home-reminder.png`) });
        await tap(firstHome);
        await page.waitForURL(/\/bills/);
        await tap(agendaRows(page, '1111'));
        assert.match(await page.getByTestId('bill-detail-head').innerText(), /1111/);
        await closeSheet(page);
        checks.push('Home tracked reminder retains masked service label and navigates to Bills with the correct service detail');
        await page.clock.setFixedTime(new Date('2026-09-30T12:00:00Z'));
        await openBills(page);
        assert.equal((await stored(page)).bills[0].importIdentity, 'consumer:1111');
        assert.equal(await agendaRows(page, '2222').count(), 1);
        checks.push('reminder scoped to first service and sibling survives reload');
        await tap(agendaRows(page, '2222'));
        await tap(page.getByRole('button', { name: 'Not a subscription', exact: true }));
        await tap(page.getByRole('button', { name: 'Remove', exact: true }));
        await page.waitForFunction(({ key, service }) => JSON.parse(localStorage.getItem(key)).notSubscriptions.includes(service), { key: STATE, service: keyFor(provider, '2222') });
        assert.deepEqual((await stored(page)).notSubscriptions, [keyFor(provider, '2222')]);
        assert.equal(await agendaRows(page, '1111').count(), 1);
        assert.equal(await agendaRows(page, '2222').count(), 0);
        await openBills(page);
        assert.equal(await agendaRows(page, '1111').count(), 1);
        assert.equal(await agendaRows(page, '2222').count(), 0);
        checks.push('dismissal scoped to second service and persisted without hiding first');
      } else {
        await tap(agendaRows(page, '1111'));
        await tap(page.getByTestId('bill-detail-mark-cancelled'));
        await tap(page.getByRole('button', { name: 'Mark as cancelled', exact: true }));
        await page.waitForFunction(({ key, service }) => !!JSON.parse(localStorage.getItem(key)).cancelledSubscriptions[service], { key: STATE, service: keyFor(provider, '1111') });
        assert.deepEqual(Object.keys((await stored(page)).cancelledSubscriptions), [keyFor(provider, '1111')]);
        await closeSheet(page);
        assert.equal(await agendaRows(page, '2222').count(), 1);
        assert.equal(await agendaRows(page, '1111').count(), 0);
        await openBills(page);
        assert.equal(await agendaRows(page, '2222').count(), 1);
        assert.equal(await agendaRows(page, '1111').count(), 0);
        await tap(page.getByTestId('bills-segment-all'));
        await tap(page.getByTestId(`bills-still-paying-${keyFor(provider, '1111')}`));
        await page.waitForFunction(({ key, service }) => !JSON.parse(localStorage.getItem(key)).cancelledSubscriptions[service], { key: STATE, service: keyFor(provider, '1111') });
        await openBills(page);
        for (const tail of ['1111', '2222']) assert.equal(await agendaRows(page, tail).count(), 1);
        checks.push('cancellation persisted for first service only; Still paying restores it without altering sibling');
      }
      await screenshot(page, `${name}-persisted`);
      assert.deepEqual(errors, []);
      results.push({ name, passed: true, checks });
      console.log(`PASS ${name}: ${checks.join('; ')}`);
    } catch (error) {
      results.push({ name, passed: false, checks, error: String(error), errors });
      await writeFile(path.join(OUT, `${name}-failure-state.json`), JSON.stringify(await stored(page), null, 2));
      await writeFile(path.join(OUT, `${name}-failure.txt`), await page.locator('body').innerText());
      await page.screenshot({ path: path.join(OUT, `${name}-failure.png`) });
      console.error(`FAIL ${name}: ${error}`);
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  await writeFile(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
}
const failed = results.filter(result => !result.passed).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
