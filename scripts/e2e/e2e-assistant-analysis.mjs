// Acceptance for local analysis against an explicitly seeded web export.
// Synthetic records only; this does not establish native device behavior.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:8126';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(BASE).hostname));
const OUT = path.resolve(process.env.ASSISTANT_ANALYSIS_EVIDENCE ?? 'artifacts/e2e-assistant-analysis');
const FILTER = process.env.ASSISTANT_ANALYSIS_CASE_FILTER ? new RegExp(process.env.ASSISTANT_ANALYSIS_CASE_FILTER) : null;
const SCENARIO_FILTER = process.env.ASSISTANT_ANALYSIS_SCENARIO_FILTER ? new RegExp(process.env.ASSISTANT_ANALYSIS_SCENARIO_FILTER) : null;
const STATE = 'wafra/state/v1';
const NOW = '2026-09-12T12:00:00Z';
const accounts = [
  { id: 'ask-main', name: 'Everyday account', kind: 'bank', openingFils: 0, color: '#166CA2' },
  { id: 'ask-travel', name: 'Travel card', kind: 'card', openingFils: 0, color: '#AD4D38' },
  { id: 'ask-reserve', name: 'Reserve account', kind: 'bank', openingFils: 0, color: '#497945' },
];
const tx = (id, title, amountFils, category = 'groceries', date = '2026-09-05', extra = {}) => ({
  id, title, amountFils, category, date, type: 'expense', accountId: 'ask-main', source: 'manual',
  ts: Date.parse(date + 'T12:00:00Z'), ...extra,
});
const queryRows = [
  tx('current-cafe', 'Cafe', 2000, 'dining'), tx('current-market', 'Main Market', 3000),
  tx('current-mixed', 'Mixed basket', 10000, 'groceries', '2026-09-05', {
    splits: [{ category: 'groceries', amountFils: 6000 }, { category: 'shopping', amountFils: 3000 }, { category: 'rent', amountFils: 1000 }],
  }),
  tx('current-rent', 'Landlord', 20000, 'rent'),
  tx('current-travel-cafe', 'Cafe', 4000, 'dining', '2026-09-05', { accountId: 'ask-travel' }),
  tx('current-travel-market', 'Main Market', 5000, 'groceries', '2026-09-05', { accountId: 'ask-travel' }),
  tx('current-reserve-cafe', 'Cafe', 9000, 'dining', '2026-09-05', { accountId: 'ask-reserve' }),
  tx('prior-cafe', 'Cafe', 1000, 'dining', '2026-08-05'), tx('prior-market', 'Main Market', 2000, 'groceries', '2026-08-05'),
  tx('prior-mixed', 'Mixed basket', 8000, 'groceries', '2026-08-05', {
    splits: [{ category: 'groceries', amountFils: 2000 }, { category: 'shopping', amountFils: 5000 }, { category: 'rent', amountFils: 1000 }],
  }),
  tx('prior-rent', 'Landlord', 19000, 'rent', '2026-08-05'),
  tx('prior-travel-cafe', 'Cafe', 3000, 'dining', '2026-08-05', { accountId: 'ask-travel' }),
  tx('prior-travel-market', 'Main Market', 4000, 'groceries', '2026-08-05', { accountId: 'ask-travel' }),
  tx('prior-reserve-cafe', 'Cafe', 8000, 'dining', '2026-08-05', { accountId: 'ask-reserve' }),
];
const driverRows = [
  ...queryRows,
  tx('reserve-mixed', 'Mixed basket', 50000, 'groceries', '2026-09-05', { accountId: 'ask-reserve' }),
  tx('reserve-mixed-prior', 'Mixed basket', 40000, 'groceries', '2026-08-05', { accountId: 'ask-reserve' }),
];
const patternRows = [
  ...['05', '06', '07', '08'].flatMap(month => [
    tx(`stream-${month}`, 'Stream Plus', 1000, 'entertainment', `2026-${month}-05`),
    tx(`storage-${month}`, 'Storage', 2500, 'software', `2026-${month}-06`),
  ]),
  tx('stream-current', 'Stream Plus', 1500, 'entertainment', '2026-09-05'),
  tx('storage-current', 'Storage', 2000, 'software', '2026-09-06'),
  ...['2026-06-02', '2026-06-17', '2026-07-09', '2026-07-23', '2026-08-20'].map((date, i) =>
    tx(`cedar-prior-${i}`, 'Cedar Market', 1000, 'groceries', date)),
  tx('cedar-current', 'Cedar Market', 6000, 'groceries', '2026-09-08'),
  tx('cedar-future', 'Cedar Market', 99000, 'groceries', '2026-09-20'),
  tx('cafe-close-1', 'Cafe', 700, 'dining', '2026-09-09', { source: 'sms', userEdited: true, ts: Date.parse('2026-09-09T12:00:00Z') }),
  tx('cafe-close-2', 'Cafe', 700, 'dining', '2026-09-09', { source: 'sms', userEdited: true, ts: Date.parse('2026-09-09T12:01:00Z') }),
  tx('cafe-date-only', 'Cafe', 700, 'dining', '2026-09-09', { source: 'sms', userEdited: true, ts: undefined }),
  tx('cafe-other-account', 'Cafe', 700, 'dining', '2026-09-09', { accountId: 'ask-travel', source: 'sms', userEdited: true, ts: Date.parse('2026-09-09T12:00:00Z') }),
];

const results = [], errors = [], blockedRequests = [];
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch(process.env.ASSISTANT_BROWSER_CHANNEL ? { channel: process.env.ASSISTANT_BROWSER_CHANNEL } : {});
const screen = page => page.locator('[data-testid="assistant-screen"]:visible').last();
const turns = page => screen(page).getByTestId('assistant-turn');
const evidence = page => page.locator('[data-testid="assistant-evidence"]:visible').last();
const detail = page => page.locator('[data-testid="entry-detail-sheet"]:visible').last();
const minor = value => {
  const match = String(value).match(/\d[\d,]*(?:\.\d{1,2})?/);
  assert.ok(match, `Missing money: ${value}`);
  return Math.round(Number(match[0].replace(/,/g, '')) * 100);
};
const amounts = value => [...String(value).matchAll(/USD\s+([\d,]+(?:\.\d{1,2})?)/g)].map(match => minor(match[1]));
async function click(locator) { await locator.scrollIntoViewIfNeeded(); await locator.click(); }
async function shot(page, name) { await page.screenshot({ path: path.join(OUT, name + '.png') }); }
async function close(sheet) { await sheet.getByRole('button', { name: 'Close', exact: true }).click(); }
async function reset(page) {
  await page.goto(BASE + '/assistant', { waitUntil: 'networkidle' });
  await screen(page).getByTestId('assistant-input').waitFor({ state: 'visible' });
}
async function ask(page, question) {
  const before = await turns(page).count();
  await screen(page).getByTestId('assistant-input').fill(question);
  await screen(page).getByTestId('assistant-send').click();
  const answer = turns(page).nth(before);
  await answer.waitFor({ state: 'visible' });
  return answer;
}
async function intercept(context, name) {
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(BASE).origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    blockedRequests.push({ name, origin: url.origin, resource: route.request().resourceType() });
    return route.abort();
  });
}
async function check(name, page, fn) {
  if (SCENARIO_FILTER && !SCENARIO_FILTER.test(name)) return;
  try { results.push({ name, passed: true, evidence: await fn() }); console.log('PASS ' + name); }
  catch (error) {
    results.push({ name, passed: false, error: String(error) }); console.error('FAIL ' + name + ': ' + String(error));
    await shot(page, name + '-failure').catch(() => {});
    await writeFile(path.join(OUT, name + '-failure.txt'), await page.locator('body').innerText()).catch(() => {});
  }
  await writeFile(path.join(OUT, 'results.json'), JSON.stringify({ results, errors, blockedRequests }, null, 2));
}
async function proof(page, expectedTotal, expectedCount, expectedContributions, label) {
  const sheet = evidence(page); await sheet.waitFor({ state: 'visible' });
  if (label) await click(sheet.getByRole('button', { name: label, exact: true }));
  assert.equal(minor(await sheet.getByTestId('assistant-evidence-total').innerText()), expectedTotal);
  assert.match(await sheet.innerText(), new RegExp(`${expectedCount} recorded transaction${expectedCount === 1 ? '' : 's'}`));
  assert.equal(await sheet.getByTestId('assistant-evidence-row').count(), expectedCount);
  const values = (await sheet.getByTestId('assistant-evidence-contribution').allTextContents()).map(minor);
  assert.equal(values.reduce((sum, amount) => sum + amount, 0), expectedTotal);
  if (expectedContributions) assert.deepEqual([...values].sort((a, b) => a - b), [...expectedContributions].sort((a, b) => a - b));
  return { total: expectedTotal, count: expectedCount, values, text: await sheet.innerText() };
}
async function answerProof(page, answer, expectedTotal, expectedCount, expectedContributions) {
  await click(answer.getByRole('button', { name: 'View transactions', exact: true }));
  const value = await proof(page, expectedTotal, expectedCount, expectedContributions);
  await close(evidence(page));
  return value;
}
async function persistedRows(page) {
  return page.evaluate(key => {
    const meta = JSON.parse(localStorage.getItem(key));
    return Array.from({ length: meta.txChunks }, (_, index) => JSON.parse(localStorage.getItem(`${key}:tx:${index}`) ?? '[]')).flat()
      .sort((a, b) => a.id.localeCompare(b.id));
  }, STATE);
}
async function layout(page) {
  const value = await screen(page).evaluate(node => {
    const rect = node.querySelector('[data-testid="assistant-composer"]').getBoundingClientRect();
    const overflow = [...node.querySelectorAll('[data-testid="assistant-finding"], [data-testid="assistant-coverage"]')]
      .map(item => ({ text: item.textContent, rect: item.getBoundingClientRect().toJSON() }))
      .filter(item => item.rect.left < -1 || item.rect.right > innerWidth + 1);
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
      composer: rect.toJSON(), overflow };
  });
  assert.ok(value.scrollWidth <= value.width + 1, 'page must fit the viewport');
  assert.deepEqual(value.overflow, [], 'finding and data coverage cards fit the viewport');
  assert.ok(value.composer.top >= 0 && value.composer.bottom <= value.height + 1, 'composer remains on screen');
  return value;
}

try {
  const bootstrap = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await intercept(bootstrap, 'bootstrap');
  const first = await bootstrap.newPage();
  await first.goto(BASE + '/', { waitUntil: 'networkidle' });
  await first.getByTestId('reference-home-summary').waitFor({ state: 'visible' });
  await first.waitForFunction(key => JSON.parse(localStorage.getItem(key) ?? '{}').txChunks > 0, STATE);
  const meta = await first.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE);
  assert.ok(meta.accounts.length > 1, 'Use an explicitly seeded E2E demo export');
  await bootstrap.close();

  async function contextFor(name, width, mode, rows) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, locale: 'en-US', timezoneId: 'UTC', colorScheme: mode, reducedMotion: 'reduce' });
    await intercept(context, name);
    await context.addInitScript(({ state, rows, key }) => {
      if (localStorage.getItem('wafra/assistant-analysis-seeded')) return;
      localStorage.setItem(key, JSON.stringify(state));
      localStorage.setItem(key + ':tx:0', JSON.stringify(rows));
      localStorage.setItem('wafra/assistant-analysis-seeded', '1');
    }, { key: STATE, rows, state: { ...meta,
      language: 'en', languagePreference: 'en', themePreference: mode, captureOptOut: true,
      privateMode: true, dailySummary: false, monthStartDay: 1, ledgerMoney: { schemaVersion: 2, currency: 'USD', exponent: 2 },
      accounts, txChunks: 1, txChunkOrder: 'oldest-first', bills: [], cardDues: [], budgets: [], goals: [],
      notSubscriptions: [], merchantOverrides: {}, billAliases: {}, historyImport: {
        status: 'paused', cursor: null, scanned: 40, found: 20, startedAt: Date.parse(NOW) - 60000, updatedAt: Date.parse(NOW), error: null,
      },
    } });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    await page.clock.setFixedTime(new Date(NOW));
    page.on('pageerror', error => errors.push({ name, error: String(error) }));
    return { context, page };
  }

  for (const width of [390, 320]) for (const mode of ['light', 'dark']) {
    const name = `en-${mode}-${width}`;
    if (FILTER && !FILTER.test(name)) continue;
    const queries = await contextFor(name + '-queries', width, mode, queryRows);
    try {
      const { page } = queries;
      await check(name + '-category-unions-and-split-exclusions', page, async () => {
        await reset(page);
        const union = await ask(page, 'How much did I spend on dining and groceries this month?');
        const combined = await answerProof(page, union, 29000, 6, [2000, 3000, 6000, 4000, 5000, 9000]);
        const excluded = await ask(page, 'Exclude groceries');
        const dining = await answerProof(page, excluded, 15000, 3, [2000, 4000, 9000]);
        await reset(page);
        const noRent = await ask(page, 'How much did I spend excluding rent this month?');
        const weighted = await answerProof(page, noRent, 32000, 6, [2000, 3000, 9000, 4000, 5000, 9000]);
        assert.match(weighted.text, /Included portion of a USD 100/);
        await shot(page, name + '-split-exclusions');
        return { combined, dining, weighted };
      });
      await check(name + '-account-and-merchant-union-followups', page, async () => {
        await reset(page);
        const union = await ask(page, 'How much did I spend on dining and groceries from Everyday account and Travel card this month?');
        const selected = await answerProof(page, union, 20000, 5, [2000, 3000, 6000, 4000, 5000]);
        assert.ok(!selected.text.includes('Reserve account'));
        const prior = await ask(page, 'What about last month?');
        const earlier = await answerProof(page, prior, 12000, 5, [1000, 2000, 2000, 3000, 4000]);
        await reset(page);
        const merchants = await ask(page, 'How much did I spend at Cafe and Main Market from Everyday account and Travel card this month?');
        const merchantUnion = await answerProof(page, merchants, 14000, 4, [2000, 3000, 4000, 5000]);
        const exclude = await ask(page, 'Exclude Main Market');
        const cafeOnly = await answerProof(page, exclude, 6000, 2, [2000, 4000]);
        const comparison = await ask(page, 'Compare last month');
        await click(comparison.getByRole('button', { name: 'View transactions', exact: true }));
        const current = await proof(page, 6000, 2, [2000, 4000], 'First period');
        const previous = await proof(page, 4000, 2, [1000, 3000], 'Comparison period');
        await close(evidence(page));
        return { selected, earlier, merchantUnion, cafeOnly, current, previous };
      });
      await check(name + '-exclude-rent-retains-comparison', page, async () => {
        await reset(page);
        await ask(page, 'How much did I spend this month?');
        await answerProof(page, await ask(page, 'Exclude rent'), 32000, 6);
        const comparison = await ask(page, 'Compare last month');
        await click(comparison.getByRole('button', { name: 'View transactions', exact: true }));
        const current = await proof(page, 32000, 6, undefined, 'First period');
        const previous = await proof(page, 25000, 6, undefined, 'Comparison period');
        assert.match(current.text, /2026-09-01/); assert.match(previous.text, /2026-08-01/);
        await close(evidence(page));
        await shot(page, name + '-comparison');
        return { current, previous, layout: await layout(page) };
      });
    } finally { await queries.context.close(); }

    const drivers = await contextFor(name + '-drivers', width, mode, driverRows);
    try {
      const { page } = drivers;
      await check(name + '-driver-proof-and-earlier-turn-explore', page, async () => {
        await reset(page);
        const comparison = await ask(page, 'Compare spending from Everyday account excluding rent September 2026 with August 2026');
        const grocery = comparison.getByTestId('assistant-finding').filter({ hasText: 'Groceries · category' });
        const mixed = comparison.getByTestId('assistant-finding').filter({ hasText: 'Mixed basket · merchant' });
        assert.deepEqual(amounts(await grocery.innerText()).slice(0, 3), [9000, 4000, 5000]);
        await click(grocery.getByRole('button', { name: 'Review transactions', exact: true }));
        const categoryCurrent = await proof(page, 9000, 2, [3000, 6000], 'Current contributions');
        const categoryPrevious = await proof(page, 4000, 2, [2000, 2000], 'Earlier contributions');
        await close(evidence(page));
        assert.deepEqual(amounts(await mixed.innerText()).slice(0, 3), [9000, 7000, 2000]);
        await click(mixed.getByRole('button', { name: 'Review transactions', exact: true }));
        const merchantCurrent = await proof(page, 9000, 1, [9000], 'Current contributions');
        const merchantPrevious = await proof(page, 7000, 1, [7000], 'Earlier contributions');
        await close(evidence(page));
        await ask(page, 'How much did I spend at Cafe from Reserve account this month?');
        const before = await turns(page).count();
        await click(mixed.getByRole('button', { name: 'Explore this', exact: true }));
        const explored = turns(page).nth(before); await explored.waitFor({ state: 'visible' });
        await click(explored.getByRole('button', { name: 'View transactions', exact: true }));
        const exploredCurrent = await proof(page, 9000, 1, [9000], 'First period');
        const exploredPrevious = await proof(page, 7000, 1, [7000], 'Comparison period');
        assert.ok(exploredCurrent.text.includes('Everyday account') && !exploredCurrent.text.includes('Reserve account'));
        assert.match(exploredCurrent.text, /2026-09-01/); assert.match(exploredPrevious.text, /2026-08-01/);
        await close(evidence(page));
        await shot(page, name + '-earlier-finding-explored');
        return { categoryCurrent, categoryPrevious, merchantCurrent, merchantPrevious, exploredCurrent, exploredPrevious, layout: await layout(page) };
      });
    } finally { await drivers.context.close(); }

    const patterns = await contextFor(name + '-patterns', width, mode, patternRows);
    try {
      const { page } = patterns;
      await check(name + '-recurring-increases-and-decreases', page, async () => {
        await reset(page);
        const answer = await ask(page, 'Which recurring charges changed this month?');
        assert.equal(await answer.getByTestId('assistant-finding').count(), 2);
        const records = [];
        for (const [title, currentAmount, median, priorTotal] of [['Stream Plus', 1500, 1000, 3000], ['Storage', 2000, 2500, 7500]]) {
          const finding = answer.getByTestId('assistant-finding').filter({ hasText: title });
          assert.deepEqual(amounts(await finding.innerText()).slice(0, 2), [currentAmount, median]);
          await click(finding.getByRole('button', { name: 'Review transactions', exact: true }));
          const current = await proof(page, currentAmount, 1, [currentAmount], 'Recorded charge');
          // Four stable priors are available. The analysis uses the latest
          // three so its median is an exact recorded amount, never a half unit.
          const previous = await proof(page, priorTotal, 3, [median, median, median], 'Earlier charges used for the median');
          assert.ok(previous.text.includes('2026-06') && previous.text.includes('2026-08'));
          await close(evidence(page));
          records.push({ title, current, previous });
        }
        await shot(page, name + '-recurring');
        return { records, layout: await layout(page) };
      });
      await check(name + '-unusual-baseline-coverage-and-refresh', page, async () => {
        await reset(page);
        const answer = await ask(page, 'Show unusual purchases this month');
        const finding = answer.getByTestId('assistant-finding').filter({ hasText: 'Cedar Market' });
        assert.deepEqual(amounts(await finding.innerText()).slice(0, 2), [6000, 1000]);
        await click(finding.getByRole('button', { name: 'Review transactions', exact: true }));
        const current = await proof(page, 6000, 1, [6000], 'Recorded charge');
        const previous = await proof(page, 5000, 5, [1000, 1000, 1000, 1000, 1000], 'Earlier charges used for the median');
        assert.ok(!previous.text.includes('2026-09-20') && !previous.text.includes('990'), 'future purchases cannot enter an earlier baseline');
        await close(evidence(page));
        const coverage = answer.getByTestId('assistant-coverage');
        await click(coverage.getByRole('button', { name: 'Data used', exact: true }));
        const coverageText = await coverage.innerText();
        assert.match(coverageText, /import is paused.*more records may remain/i);
        assert.match(coverageText, /Recorded activity: 2026-/);
        assert.match(coverageText, /Days without transactions do not prove missing imports/);
        await shot(page, name + '-coverage');
        await click(finding.getByRole('button', { name: 'Review transactions', exact: true }));
        const sheet = evidence(page);
        await click(sheet.getByTestId('assistant-evidence-row').filter({ hasText: 'Cedar Market' }));
        await detail(page).getByRole('button', { name: 'Edit transaction', exact: true }).click();
        await detail(page).getByRole('textbox', { name: 'Amount', exact: true }).fill('65.00');
        await detail(page).getByRole('button', { name: 'Save changes', exact: true }).click();
        await sheet.getByText('Your ledger has changed since this answer.', { exact: true }).waitFor({ state: 'visible' });
        await shot(page, name + '-finding-stale');
        await sheet.getByRole('button', { name: 'Refresh answer', exact: true }).click();
        await sheet.waitFor({ state: 'hidden' });
        const refreshed = answer.getByTestId('assistant-finding').filter({ hasText: 'Cedar Market' });
        assert.deepEqual(amounts(await refreshed.innerText()).slice(0, 2), [6500, 1000]);
        await click(refreshed.getByRole('button', { name: 'Review transactions', exact: true }));
        const after = await proof(page, 6500, 1, [6500], 'Recorded charge');
        await close(evidence(page));
        return { current, previous, coverage: coverageText, after, layout: await layout(page) };
      });
      await check(name + '-possible-duplicates-remain-review-only', page, async () => {
        await reset(page);
        const before = await persistedRows(page);
        const answer = await ask(page, 'Show possible duplicate charges this month');
        assert.equal(await answer.getByTestId('assistant-finding').count(), 1);
        const finding = answer.getByTestId('assistant-finding').filter({ hasText: 'Cafe' });
        assert.match(await finding.innerText(), /may be separate purchases.*no transaction has been changed/i);
        await click(finding.getByRole('button', { name: 'Review transactions', exact: true }));
        const records = await proof(page, 1400, 2, [700, 700]);
        assert.ok(records.text.includes('Everyday account') && !records.text.includes('Travel card'));
        const originalClocks = [];
        for (let index = 0; index < 2; index++) {
          await click(evidence(page).getByTestId('assistant-evidence-row').nth(index));
          const original = detail(page); await original.waitFor({ state: 'visible' });
          const text = await original.innerText();
          const clock = text.match(/12:0[01]/)?.[0];
          assert.ok(clock, 'the candidate opens an original captured record with its real clock');
          originalClocks.push(clock);
          await close(original);
        }
        assert.deepEqual(originalClocks.sort(), ['12:00', '12:01'], 'date-only controls cannot replace the two captured source records');
        assert.equal(await evidence(page).getByRole('button', { name: /delete|merge|remove/i }).count(), 0);
        await close(evidence(page));
        assert.deepEqual(await persistedRows(page), before, 'candidate analysis and review must not change any ledger record');
        await shot(page, name + '-duplicates');
        return { records, originalClocks, unchangedRecordCount: before.length, layout: await layout(page) };
      });
    } finally { await patterns.context.close(); }
  }
} finally {
  await writeFile(path.join(OUT, 'results.json'), JSON.stringify({ results, errors, blockedRequests,
    scope: 'Fresh exported web app, synthetic English/USD records; all external requests blocked. No native device claim.' }, null, 2));
  await browser.close();
}
assert.deepEqual(errors, [], 'browser runtime errors');
assert.ok(results.length > 0 && results.every(result => result.passed), 'Local Ask analysis browser acceptance failed');
console.log(`${results.length} local Ask analysis browser cases passed`);
