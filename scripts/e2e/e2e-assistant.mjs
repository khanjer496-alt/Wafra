// Real exported-web interactions with synthetic English/USD records. This is
// browser acceptance, not evidence of native keyboard or device behavior.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:8126';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(BASE).hostname));
const OUT = path.resolve(process.env.ASSISTANT_EVIDENCE ?? 'artifacts/e2e-assistant');
const FILTER = process.env.ASSISTANT_CASE_FILTER ? new RegExp(process.env.ASSISTANT_CASE_FILTER) : null;
const STATE = 'wafra/state/v1';
const NOW = '2026-09-12T12:00:00Z';
const MERCHANT = 'Cedar "Express" \\ West';
const CURRENT_TOTAL = 25302;
const PREVIOUS_TOTAL = 8333;
const GROCERY_TOTAL = 15525;
const results = [], errors = [], blockedRequests = [], layouts = [];
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch(process.env.ASSISTANT_BROWSER_CHANNEL
  ? { channel: process.env.ASSISTANT_BROWSER_CHANNEL } : {});

const money = minor => `USD ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const minor = text => {
  const match = String(text).match(/\d[\d,]*(?:\.\d{1,2})?/);
  assert.ok(match, `Missing amount: ${text}`);
  return Math.round(Number(match[0].replace(/,/g, '')) * 100);
};
const screen = page => page.locator('[data-testid="assistant-screen"]:visible').last();
const turns = page => screen(page).getByTestId('assistant-turn');
const evidence = page => page.locator('[data-testid="assistant-evidence"]:visible').last();
const detail = page => page.locator('[data-testid="entry-detail-sheet"]:visible').last();
const tx = (id, title, amountFils, category = 'groceries', date = '2026-09-05', extra = {}) => ({
  id, title, amountFils, category, date, type: 'expense', accountId: 'ask-bank', source: 'manual',
  ts: Date.parse(date + 'T12:00:00Z'), ...extra,
});
const transactions = [
  tx('ask-salary', 'Salary', 125000, 'salary', '2026-09-01', { type: 'income' }),
  tx('ask-old-salary', 'Salary', 110000, 'salary', '2026-08-01', { type: 'income' }),
  tx('ask-starbucks-downtown', 'Starbucks Downtown', 2000, 'dining'),
  tx('ask-starbucks-airport', 'Starbucks Airport', 3000, 'dining'),
  tx('ask-old-starbucks', 'Starbucks Downtown', 1000, 'dining', '2026-08-05'),
  tx('ask-carrefour', 'Carrefour', 7000),
  tx('ask-old-carrefour', 'Carrefour', 5000, 'groceries', '2026-08-05'),
  tx('ask-old-groceries', 'Previous groceries', 2000, 'groceries', '2026-08-05'),
  tx('ask-quoted', MERCHANT, 777, 'dining'),
  tx('ask-old-quoted', MERCHANT, 333, 'dining', '2026-08-05'),
  tx('ask-split', 'Mixed basket', 10000, 'groceries', '2026-09-05', {
    splits: [{ category: 'groceries', amountFils: 6000 }, { category: 'shopping', amountFils: 4000 }],
  }),
  ...Array.from({ length: 25 }, (_, i) => tx(`ask-pantry-${String(i).padStart(2, '0')}`, `Pantry purchase ${i + 1}`, 101)),
];

async function intercept(context, scenario) {
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(BASE).origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    blockedRequests.push({ scenario, origin: url.origin, resource: route.request().resourceType() });
    return route.abort();
  });
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name + '.png') });
}
async function check(name, page, fn) {
  try { const value = await fn(); results.push({ name, passed: true, evidence: value }); console.log('PASS ' + name); }
  catch (error) {
    results.push({ name, passed: false, error: String(error) }); console.error('FAIL ' + name + ': ' + String(error));
    await shot(page, name + '-failure').catch(() => {});
    await writeFile(path.join(OUT, name + '-failure.txt'), await page.locator('body').innerText()).catch(() => {});
  }
  await writeFile(path.join(OUT, 'results.json'), JSON.stringify({ results, errors, blockedRequests, layouts }, null, 2));
}
async function click(locator) { await locator.scrollIntoViewIfNeeded(); await locator.click(); }
async function composerLayout(page, name) {
  const value = await screen(page).evaluate(node => {
    const box = id => {
      const r = node.querySelector(`[data-testid="${id}"]`).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
    };
    const clipping = [];
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode;
      if (!text.textContent.trim() || text.parentElement?.closest('script,style,svg')) continue;
      let hidden = false;
      for (let parent = text.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (parent.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          hidden = true; break;
        }
      }
      if (hidden) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const rect of range.getClientRects()) {
        if (rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1)) {
          clipping.push({ text: text.textContent.trim(), left: rect.left, right: rect.right }); break;
        }
      }
    }
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, clipping,
      composer: box('assistant-composer'), input: box('assistant-input'), send: box('assistant-send') };
  });
  layouts.push({ name, ...value });
  assert.ok(value.scrollWidth <= value.width + 1, 'the page must not overflow horizontally');
  assert.deepEqual(value.clipping, [], 'painted words, including merchant choices, must fit inside the viewport');
  for (const key of ['composer', 'input', 'send']) {
    const box = value[key];
    assert.ok(box.y >= 0 && box.bottom <= value.height + 1 && box.x >= -1 && box.right <= value.width + 1,
      `${key} must stay inside the viewport: ${JSON.stringify(value)}`);
  }
  assert.ok(value.input.height >= 48 && value.input.height <= 161, 'input height is bounded');
  assert.ok(value.send.width >= 48 && value.send.height >= 48, 'send retains its touch target');
  return value;
}
async function latestVisible(page) {
  await page.waitForFunction(() => {
    const active = [...document.querySelectorAll('[data-testid="assistant-screen"]')]
      .filter(node => node.getBoundingClientRect().width > 0).at(-1);
    const latest = active?.querySelectorAll('[data-testid="assistant-turn"]');
    const answer = latest?.[latest.length - 1]?.getBoundingClientRect();
    const composer = active?.querySelector('[data-testid="assistant-composer"]')?.getBoundingClientRect();
    return answer && composer && answer.bottom <= composer.top + 1;
  }, null, { timeout: 12000 });
}
async function ask(page, question) {
  const before = await turns(page).count();
  await screen(page).getByTestId('assistant-input').fill(question);
  await screen(page).getByTestId('assistant-send').click();
  const answer = turns(page).nth(before);
  await answer.waitFor({ state: 'visible' });
  await latestVisible(page);
  return answer;
}
async function newChat(page) {
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="assistant-screen"]')]
    .filter(node => node.getBoundingClientRect().width > 0)
    .every(node => node.querySelectorAll('[data-testid="assistant-turn"]').length === 0));
}
async function closeSheet(sheet) { await sheet.getByRole('button', { name: 'Close', exact: true }).click(); }

let meta;
try {
  const bootstrap = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await intercept(bootstrap, 'bootstrap');
  const first = await bootstrap.newPage();
  await first.goto(BASE + '/', { waitUntil: 'networkidle' });
  await first.getByTestId('reference-home-summary').waitFor({ state: 'visible' });
  await first.waitForFunction(key => JSON.parse(localStorage.getItem(key) ?? '{}').txChunks > 0, STATE);
  meta = await first.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE);
  assert.ok(meta.accounts.length > 1, 'run against an explicitly seeded E2E demo export');
  await bootstrap.close();

  async function contextFor(name, width = 390, mode = 'light', monthStartDay = 1) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, locale: 'en-US',
      colorScheme: mode, reducedMotion: 'reduce' });
    await intercept(context, name);
    await context.addInitScript(({ state, rows, key }) => {
      if (localStorage.getItem('wafra/assistant-e2e-seeded')) return;
      localStorage.setItem(key, JSON.stringify(state));
      localStorage.setItem(key + ':tx:0', JSON.stringify(rows));
      localStorage.setItem('wafra/assistant-e2e-seeded', '1');
    }, { key: STATE, rows: transactions, state: {
      ...meta, language: 'en', languagePreference: 'en', themePreference: mode, captureOptOut: true,
      privateMode: true, dailySummary: false, monthStartDay, ledgerMoney: { schemaVersion: 2, currency: 'USD', exponent: 2 },
      accounts: [{ id: 'ask-bank', name: 'Everyday account', kind: 'bank', openingFils: 0, color: '#166CA2' }],
      txChunks: 1, txChunkOrder: 'oldest-first', bills: [], cardDues: [], budgets: [], goals: [],
      notSubscriptions: [], merchantOverrides: {}, billAliases: {}, historyImport: null,
    } });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    await page.clock.setFixedTime(new Date(NOW));
    page.on('pageerror', error => errors.push({ scenario: name, error: String(error) }));
    return { context, page };
  }

  for (const width of [390, 320]) for (const mode of ['light', 'dark']) {
    const name = `en-${mode}-${width}`;
    if (FILTER && !FILTER.test(name)) continue;
    const { context, page } = await contextFor(name, width, mode);
    try {
      await check(name + '-conversation', page, async () => {
        await page.goto(BASE + '/', { waitUntil: 'networkidle' });
        await page.getByTestId('home-widget-assistant').waitFor({ state: 'visible' });
        await page.getByTestId('home-widget-assistant').scrollIntoViewIfNeeded();
        await shot(page, name + '-home');
        await click(page.getByTestId('home-widget-assistant'));
        await screen(page).getByTestId('assistant-input').waitFor({ state: 'visible' });
        await composerLayout(page, name + '-initial');
        await shot(page, name + '-initial');
        assert.match(await (await ask(page, 'How much salary did I receive?')).innerText(), /USD 1,250(?:\.00)?/);
        assert.match(await (await ask(page, 'What did I pay at Carrefour last month?')).innerText(), /USD 50(?:\.00)?/);
        const unknown = await (await ask(page, 'How much did I spend at Unknown Example Shop?')).innerText();
        assert.ok(!unknown.includes(money(CURRENT_TOTAL)) && /clarif|match|find|which|recogn/i.test(unknown), unknown);
        const ambiguous = await (await ask(page, 'How much did I spend at Starbucks?')).innerText();
        assert.ok(!ambiguous.includes(money(CURRENT_TOTAL)) && /which|choose|match|clarif/i.test(ambiguous), ambiguous);
        await composerLayout(page, name + '-four-answers');
        await shot(page, name + '-four-answers');
        const input = screen(page).getByTestId('assistant-input');
        const small = (await input.boundingBox()).height;
        await input.fill('Explain my grocery spending and the purchases behind it.\n'.repeat(18));
        await page.waitForFunction(() => document.querySelector('[data-testid="assistant-input"]')?.getBoundingClientRect().height > 48);
        const expanded = await composerLayout(page, name + '-multiline');
        assert.ok(expanded.input.height > small, 'multiline input must grow when text wraps');
        await shot(page, name + '-multiline');
        await newChat(page);
        assert.equal(await turns(page).count(), 0);
        assert.equal(await input.inputValue(), '');
        return { unknown, ambiguous, input: expanded.input };
      });

      await check(name + '-evidence-and-refresh', page, async () => {
        await page.goto(BASE + '/assistant', { waitUntil: 'networkidle' });
        const answer = await ask(page, 'How much did I spend on groceries this month?');
        assert.ok((await answer.innerText()).includes(money(GROCERY_TOTAL)));
        await click(answer.getByRole('button', { name: 'View transactions', exact: true }));
        const sheet = evidence(page); await sheet.waitFor({ state: 'visible' });
        assert.equal(minor(await sheet.getByTestId('assistant-evidence-total').innerText()), GROCERY_TOTAL);
        assert.match(await sheet.innerText(), /27 recorded transactions/);
        assert.equal(await sheet.getByTestId('assistant-evidence-row').count(), 20);
        const firstAmounts = await sheet.getByTestId('assistant-evidence-contribution').allTextContents();
        await click(sheet.getByRole('button', { name: 'Next page', exact: true }));
        assert.equal(await sheet.getByTestId('assistant-evidence-row').count(), 7);
        const secondAmounts = await sheet.getByTestId('assistant-evidence-contribution').allTextContents();
        assert.equal([...firstAmounts, ...secondAmounts].reduce((sum, text) => sum + minor(text), 0), GROCERY_TOTAL);
        const split = sheet.getByTestId('assistant-evidence-row').filter({ hasText: 'Mixed basket' });
        assert.equal(minor(await split.getByTestId('assistant-evidence-contribution').innerText()), 6000);
        assert.match(await split.innerText(), /Included portion of a USD 100(?:\.00)? transaction/);
        await click(split);
        const original = detail(page); await original.waitFor({ state: 'visible' });
        assert.match(await original.innerText(), /100(?:\.00)?/);
        await shot(page, name + '-split-original');
        await closeSheet(original);
        await click(sheet.getByRole('button', { name: 'Previous page', exact: true }));
        await click(sheet.getByTestId('assistant-evidence-row').filter({ hasText: 'Carrefour' }));
        await detail(page).getByRole('button', { name: 'Edit transaction', exact: true }).click();
        await detail(page).getByRole('textbox', { name: 'Amount', exact: true }).fill('75.00');
        await detail(page).getByRole('button', { name: 'Save changes', exact: true }).click();
        await sheet.getByText('Your ledger has changed since this answer.', { exact: true }).waitFor({ state: 'visible' });
        await shot(page, name + '-stale');
        await sheet.getByRole('button', { name: 'Refresh answer', exact: true }).click();
        await sheet.waitFor({ state: 'hidden' });
        assert.ok((await answer.innerText()).includes(money(GROCERY_TOTAL + 500)));
        assert.ok(!(await answer.innerText()).includes('Your ledger has changed since this answer.'));
        await composerLayout(page, name + '-refreshed');
        await shot(page, name + '-refreshed');
        return { count: 27, beforeMinor: GROCERY_TOTAL, afterMinor: GROCERY_TOTAL + 500 };
      });

      await check(name + '-comparison-groups', page, async () => {
        await page.goto(BASE + '/assistant', { waitUntil: 'networkidle' });
        const answer = await ask(page, 'Why did my groceries spending change?');
        await click(answer.getByRole('button', { name: 'View transactions', exact: true }));
        const sheet = evidence(page); await sheet.waitFor({ state: 'visible' });
        const groups = sheet.getByRole('button', { name: /^(?:First period|Comparison period)$/ });
        assert.equal(await groups.count(), 2, 'comparison evidence keeps periods separate');
        const labels = await groups.allTextContents();
        assert.notEqual(labels[0], labels[1]);
        const current = minor(await sheet.getByTestId('assistant-evidence-total').innerText());
        await click(groups.nth(1));
        const previous = minor(await sheet.getByTestId('assistant-evidence-total').innerText());
        assert.equal(current, GROCERY_TOTAL + 500);
        assert.equal(previous, 7000);
        assert.match(await sheet.innerText(), /2 recorded transactions/);
        await shot(page, name + '-comparison-previous');
        await closeSheet(sheet);
        await newChat(page);
        return { labels, current, previous };
      });

      await check(name + '-largest-purchases', page, async () => {
        await page.goto(BASE + '/assistant', { waitUntil: 'networkidle' });
        const answer = await ask(page, 'Top 3 largest purchases this month');
        await click(answer.getByRole('button', { name: 'View transactions', exact: true }));
        const sheet = evidence(page); await sheet.waitFor({ state: 'visible' });
        assert.match(await sheet.innerText(), /3 recorded transactions/);
        assert.match(await sheet.innerText(), /largest purchases|top 3/i);
        const rows = await sheet.getByTestId('assistant-evidence-contribution').allTextContents();
        assert.deepEqual(rows.map(minor), [10000, 7500, 3000], 'evidence must contain only the ranked top three, in amount order');
        assert.equal(minor(await sheet.getByTestId('assistant-evidence-total').innerText()), 20500,
          'ranking evidence total must sum its three visible records');
        await shot(page, name + '-largest-purchases');
        return { count: rows.length, totalMinor: 20500 };
      });
    } finally { await context.close(); }
  }

  if (!FILTER || FILTER.test('context-period-reselect')) {
    const name = 'context-period-reselect';
    const { context, page } = await contextFor(name);
    try {
      await check(name, page, async () => {
        await page.goto(BASE + '/assistant', { waitUntil: 'networkidle' });
        const answer = await ask(page, 'How much did I spend last month?');
        assert.ok((await answer.innerText()).includes(money(PREVIOUS_TOTAL)));
        await screen(page).getByRole('button', { name: /Change reporting period: Aug/ }).click();
        const dialog = page.locator('[role="dialog"]:visible').last();
        const choices = await Promise.all(['Last month', 'This month'].map(label =>
          dialog.getByRole('button', { name: label, exact: true }).evaluate(node => getComputedStyle(node).backgroundColor)));
        assert.notEqual(choices[0], choices[1], 'period picker must distinguish the month shown by the conversation');
        assert.equal(choices[1], 'rgba(0, 0, 0, 0)', 'This month must not look selected while the conversation shows August');
        await dialog.getByRole('button', { name: 'This month', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('[data-testid="assistant-turn"]'));
        assert.equal(await turns(page).count(), 0, 'explicit period selection starts fresh even when global period already matches');
        const current = await ask(page, 'How much did I spend?');
        assert.ok((await current.innerText()).includes(money(CURRENT_TOTAL)));
        await shot(page, name);
        return { amountMinor: CURRENT_TOTAL };
      });
    } finally { await context.close(); }
  }

  for (const monthStartDay of [1, 25]) {
    const name = 'direct-route-start-day-' + monthStartDay;
    if (FILTER && !FILTER.test(name)) continue;
    const { context, page } = await contextFor(name, 390, 'light', monthStartDay);
    try {
      await check(name, page, async () => {
        await page.goto(BASE + '/assistant?question=' + encodeURIComponent('How much did I spend?'), { waitUntil: 'networkidle' });
        await turns(page).first().waitFor({ state: 'visible' });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await latestVisible(page);
        assert.equal(await turns(page).count(), 1, 'hydration must preserve exactly one route answer');
        const answer = await turns(page).first().innerText();
        assert.ok(answer.includes(money(CURRENT_TOTAL)), answer);
        await click(turns(page).first().getByRole('button', { name: 'View transactions', exact: true }));
        const text = await evidence(page).innerText();
        assert.ok(text.includes(monthStartDay === 25 ? '2026-08-25' : '2026-09-01'), text);
        await shot(page, name);
        return { answer, evidence: text };
      });
    } finally { await context.close(); }
  }

  for (const source of ['home', 'flow', 'merchant']) {
    const name = 'context-' + source;
    if (FILTER && !FILTER.test(name)) continue;
    const { context, page } = await contextFor(name);
    try {
      await check(name, page, async () => {
        await page.goto(BASE + (source === 'merchant' ? '/merchant?name=' + encodeURIComponent(MERCHANT) : '/'), { waitUntil: 'networkidle' });
        const scope = source === 'merchant' ? page.getByTestId('merchant-detail') : page.getByTestId('reference-home-summary');
        await scope.getByRole('button', { name: /Sep(?:tember)? 2026/ }).click();
        await page.getByRole('button', { name: 'Last month', exact: true }).click();
        if (source === 'flow') {
          await page.getByRole('tab', { name: 'Spending', exact: true }).click();
          await page.getByTestId('spending-ask-wafra').getByRole('button').click();
        } else if (source === 'merchant') await page.getByTestId('merchant-ask-wafra').getByRole('button').click();
        else { await click(page.getByTestId('home-widget-assistant')); await ask(page, 'How much did I spend?'); }
        await turns(page).first().waitFor({ state: 'visible' });
        await latestVisible(page);
        const answer = await turns(page).first().innerText();
        assert.match(answer, /Aug(?:ust)? 2026|2026-08/);
        if (source === 'home' || source === 'flow') assert.ok(answer.includes(money(PREVIOUS_TOTAL)), answer);
        else {
          assert.ok(answer.includes(JSON.stringify(MERCHANT)), 'context prompt preserves the complete quoted name');
          assert.ok(answer.includes('3.33'), answer);
          await screen(page).getByTestId('assistant-input').fill('draft follow-up');
          await page.setViewportSize({ width: 320, height: 844 });
          await composerLayout(page, name + '-rerender');
          assert.equal(await turns(page).count(), 1, 'route question runs once across rerenders');
          await newChat(page);
          assert.equal(await turns(page).count(), 0, 'new chat does not replay its route question');
        }
        await shot(page, name);
        return { answer };
      });
    } finally { await context.close(); }
  }
} finally {
  await writeFile(path.join(OUT, 'results.json'), JSON.stringify({ results, errors, blockedRequests, layouts,
    scope: 'Fresh exported web app, English synthetic USD fixture only; external requests blocked. No native device claim.' }, null, 2));
  await browser.close();
}
assert.deepEqual(errors, [], 'browser runtime errors');
assert.ok(results.length > 0 && results.every(item => item.passed), 'Ask Wafra browser acceptance failed');
console.log(`${results.length} Ask Wafra browser cases passed`);
