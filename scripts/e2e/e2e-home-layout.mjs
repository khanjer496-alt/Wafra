import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

// A fresh EXPO_PUBLIC_WAFRA_E2E_DEMO=1 export, disposable browser profiles,
// and a synthetic ledger only. No device storage or existing profile is used.
const base = (process.env.BASE ?? 'http://localhost:8126').replace(/\/$/, '');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname));
const out = path.resolve(process.env.OUT ?? 'artifacts/e2e-home-layout');
await mkdir(out, { recursive: true });
const prefsKey = 'wafra/ui/home-widgets/v1';
const ids = ['greeting', 'overview', 'today', 'week', 'capture', 'due', 'upcoming', 'activity', 'assistant', 'insight'];
const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(executablePath) ? { executablePath } : {});
const results = []; const errors = []; let assertions = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };

async function expose(locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.evaluate(node => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = node.getBoundingClientRect();
      const excess = r.bottom - (innerHeight - 135);
      if (excess <= 0) break;
      let parent = node.parentElement;
      while (parent && !(parent.scrollHeight > parent.clientHeight + 4 && parent.clientHeight > 160)) parent = parent.parentElement;
      if (!parent) break;
      parent.scrollTop += excess + 16;
    }
  });
}
async function tap(locator) {
  for (const target of (await locator.all()).reverse()) {
    if (!await target.isVisible()) continue;
    await expose(target);
    const onTop = await target.evaluate(node => {
      const r = node.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!hit && (node.contains(hit) || hit.contains(node));
    });
    if (!onTop) continue;
    await target.click(); await target.page().waitForTimeout(150); return;
  }
  throw new Error(`No reachable control: ${locator}`);
}
async function settle(page) { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(200); }
async function shot(page, name, anchor) {
  if (anchor) await expose(anchor);
  await settle(page); await page.screenshot({ path: path.join(out, name + '.png') });
}
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), prefsKey);
const rows = page => page.getByTestId('home-customize-sections').locator('[data-testid^="home-customize-"]')
  .evaluateAll((nodes, valid) => nodes.map(node => node.getAttribute('data-testid').replace('home-customize-', ''))
    .filter(id => valid.includes(id)), ids);
const sections = page => page.locator('[data-testid^="home-section-"]').evaluateAll(nodes => nodes
  .filter(node => node.getBoundingClientRect().width > 0)
  .map(node => node.getAttribute('data-testid').replace('home-section-', '')));

async function seed(page, language, incomeFils = 50000) {
  await page.clock.setFixedTime(new Date('2026-09-27T08:00:00Z'));
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  const sample = page.getByRole('button', { name: /Start with sample data/i });
  if (await sample.isVisible().catch(() => false)) await tap(sample);
  await page.getByTestId('home-spending-total').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !!localStorage.getItem('wafra/state/v1'));
  await page.evaluate(({ language, prefsKey, incomeFils }) => {
    const key = 'wafra/state/v1'; const state = JSON.parse(localStorage.getItem(key));
    delete state.txChunks; delete state.txChunkOrder;
    Object.assign(state, { onboarded: true, language, languagePreference: language, userName: 'QA',
      monthStartDay: 1, themePreference: 'system', marketId: 'AE', ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
      captureOptOut: true, historyImport: null, onboardingPlan: null, onboardingCurrencyEvidence: null,
      accounts: [{ id: 'qa', name: 'QA cash', kind: 'cash', openingFils: 0, color: '#1F6B52' }],
      transactions: [
        { id: 'qa-coffee', title: 'QA coffee', date: '2026-09-27', type: 'expense', amountFils: 1234, category: 'dining', accountId: 'qa', source: 'manual', userEdited: true },
        { id: 'qa-pay', title: 'QA salary', date: '2026-09-01', type: 'income', amountFils: incomeFils, category: 'salary', accountId: 'qa', source: 'manual', userEdited: true },
      ], bills: [{ id: 'qa-netflix', title: 'Netflix', category: 'entertainment', amountFils: 999, dueDay: 28, paidMonths: [], accountId: 'qa' }],
      budgets: [], cardDues: [], goals: [], notSubscriptions: [], merchantOverrides: {}, billAliases: {}, privateMode: true });
    localStorage.setItem(key, JSON.stringify(state));
    localStorage.removeItem(prefsKey);
  }, { language, prefsKey, incomeFils });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('home-section-overview').waitFor({ state: 'visible' });
  await settle(page);
}

try {
  for (const [language, scheme, width, scale] of [
    ['en', 'light', 390, 1], ['ar', 'dark', 320, 1], ['en', 'dark', 390, 1.8], ['ar', 'light', 390, 1.8],
    ['ar', 'dark', 320, 3.1],
  ]) {
    const name = `${language}-${scheme}-${width}-${scale}`;
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme,
      locale: language === 'ar' ? 'ar-AE' : 'en-AE', timezoneId: 'Asia/Dubai', reducedMotion: 'reduce' });
    await context.addInitScript(fontScale => { window.__WAFRA_E2E_FONT_SCALE__ = fontScale; }, scale);
    await context.route('**/*', route => {
      const url = route.request().url(); return url.startsWith(base + '/') || /^(data|blob):/.test(url) ? route.continue() : route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push({ name, error: String(error) }));
    const customize = page.getByTestId('home-customize-screen');
    const toggle = id => page.getByTestId(`home-customize-toggle-${id}`).getByRole('switch');
    async function open() {
      await tap(page.getByTestId('home-customize-link'));
      await customize.waitFor({ state: 'visible' }); await settle(page);
    }
    async function done() {
      await tap(page.getByTestId('home-customize-done'));
      await page.getByTestId('home-customize-link').waitFor({ state: 'visible' }); await settle(page);
    }
    async function setVisible(id, visible) {
      const wrapper = page.getByTestId(`home-customize-toggle-${id}`);
      const control = (await wrapper.getAttribute('role')) === 'switch' ? wrapper : toggle(id);
      const current = await control.getAttribute('aria-checked');
      if ((current === 'true') !== visible) await tap(control);
      check(await control.getAttribute('aria-checked'), String(visible), `${id} switch state`);
      await page.waitForFunction(({ key, id, visible }) => {
        const prefs = JSON.parse(localStorage.getItem(key) ?? 'null');
        return prefs && prefs.hidden.includes(id) !== visible;
      }, { key: prefsKey, id, visible });
    }
    try {
      const hugeIncome = scale === 3.1;
      await seed(page, language, hugeIncome ? 123456789 : 50000);
      const defaultRendered = await sections(page);
      check(defaultRendered.includes('overview') && defaultRendered.includes('week') && defaultRendered.includes('capture'), true, 'primary content renders by default');
      check(await page.getByTestId('home-fill-past').count(), 1, 'fixture exposes the optional import prompt before hiding capture');
      check(await page.getByTestId('home-screen').getByRole('img', { name: language === 'ar' ? 'نمطك' : 'Your pattern', exact: true }).count(), 1,
        'personal pattern is present before hiding greeting');
      await open();
      const defaultOrder = await rows(page);
      check([...defaultOrder].sort(), [...ids].sort(), 'all ten Home sections are customizable');
      check(await page.getByTestId('home-customize-fixed').count(), 0, 'money overview and capture are not fixed choices');
      await shot(page, `${name}-customize`, page.getByTestId('home-customize-overview'));
      // Move a former sheet section above former band content using actual buttons.
      for (let attempt = 0; attempt < ids.length; attempt++) {
        const order = await rows(page);
        if (order.indexOf('activity') < order.indexOf('overview')) break;
        await tap(page.getByTestId('home-customize-up-activity'));
      }
      const movedOrder = await rows(page);
      check(movedOrder.indexOf('activity') < movedOrder.indexOf('overview'), true, 'activity moves across the old band/sheet boundary');
      await page.waitForFunction(({ key, order }) => JSON.stringify(JSON.parse(localStorage.getItem(key) ?? '{}').order) === JSON.stringify(order), { key: prefsKey, order: movedOrder });
      await done();
      const displayed = await sections(page);
      check(displayed.indexOf('activity') < displayed.indexOf('overview'), true, 'Home actually follows the new complete order');
      const activityBox = await page.getByTestId('home-section-activity').boundingBox();
      const overviewBox = await page.getByTestId('home-section-overview').boundingBox();
      check(activityBox.y < overviewBox.y, true, 'rendered geometry agrees with reordered content');
      await shot(page, `${name}-reordered`, page.getByTestId('home-section-activity'));
      if (hugeIncome) {
        const card = page.getByTestId('home-section-overview');
        const normalize = value => String(value).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
          .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0)).replace(/٬|,/g, '').replace(/٫/g, '.');
        check(normalize(await card.getByTestId('home-income-summary').innerText()).includes('1234567.89'), true, 'full million-size income is printed');
        check(normalize(await card.getByTestId('home-net-summary').innerText()).includes('1234555.55'), true, 'full net reconciles income minus 12.34');
        for (const id of ['home-spending-total', 'home-income-summary', 'home-net-summary']) {
          const metric = card.getByTestId(id);
          await expose(metric);
          const measured = await metric.evaluate(node => {
            const card = node.closest('[data-testid="home-section-overview"]');
            const cardBox = card.getBoundingClientRect();
            const leaves = [...node.querySelectorAll('*')].filter(child => child.children.length === 0
              && /[0-9٠-٩۰-۹]/.test(child.textContent));
            return { count: leaves.length, clipped: leaves.filter(child => {
              const r = child.getBoundingClientRect();
              return child.scrollWidth > child.clientWidth + 1 || r.left < cardBox.left - 1 || r.right > cardBox.right + 1
                || r.left < -1 || r.right > innerWidth + 1;
            }).map(child => child.textContent) };
          });
          check(measured.count > 0, true, `${id}: measured actual numeric text`);
          check(measured.clipped, [], `${id}: full amount fits the moved card and viewport at 320px / 3.1 scale`);
          await shot(page, `${name}-${id}-fits`, metric);
        }
      }
      await open();
      for (const id of ['overview', 'week', 'capture']) await setVisible(id, false);
      await done();
      for (const id of ['overview', 'week', 'capture']) check(await page.getByTestId(`home-section-${id}`).count(), 0, `${id} hidden on Home`);
      for (const id of ['home-fill-past', 'home-capture-ready', 'journal-import-controls']) {
        check(await page.getByTestId(id).count(), 0, `${id}: optional capture content follows its visibility`);
      }
      check(await page.getByTestId('home-spending-total').count(), 0, 'primary total is actually hidden');
      check(await page.getByTestId('home-week').count(), 0, 'daily graph is actually hidden');
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByTestId('home-customize-link').waitFor({ state: 'visible' }); await settle(page);
      for (const id of ['overview', 'week', 'capture']) check(await page.getByTestId(`home-section-${id}`).count(), 0, `${id} stays hidden after reload`);
      check((await stored(page)).order, movedOrder, 'whole-content reorder survives reload');
      await open();
      for (const id of ids) await setVisible(id, false);
      await done();
      check(await sections(page), [], 'every optional Home section can be hidden');
      for (const id of ['home-fill-past', 'home-capture-ready', 'journal-import-controls']) {
        check(await page.getByTestId(id).count(), 0, `${id}: no optional capture card remains when all hidden`);
      }
      check(await page.getByTestId('home-screen').getByRole('img', { name: language === 'ar' ? 'نمطك' : 'Your pattern', exact: true }).count(), 0,
        'hiding greeting also hides the personal pattern');
      await tap(page.getByTestId('home-settings'));
      await page.getByTestId('settings-screen').waitFor({ state: 'visible' });
      await settle(page);
      await tap(page.getByRole('button', { name: language === 'ar' ? 'رجوع' : 'Back', exact: true }));
      await page.getByTestId('home-customize-link').waitFor({ state: 'visible' });
      await shot(page, `${name}-all-hidden`, page.getByTestId('home-customize-link'));
      await open(); // Reachable even with everything hidden.
      await tap(page.getByTestId('home-customize-reset'));
      await page.waitForFunction(key => {
        const prefs = JSON.parse(localStorage.getItem(key) ?? 'null'); return prefs && prefs.hidden.length === 0;
      }, prefsKey);
      check(await rows(page), defaultOrder, 'reset restores the default full order');
      check((await stored(page)).hidden, [], 'reset restores visibility');
      await done();
      check(await sections(page), defaultRendered, 'reset restores the same available content');
      check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'no document horizontal overflow');
      await shot(page, `${name}-reset`, page.getByTestId('home-section-overview'));
      results.push({ name, passed: true }); console.log(`PASS ${name}`);
    } catch (error) {
      results.push({ name, passed: false, error: String(error) });
      await page.screenshot({ path: path.join(out, `${name}-failure.png`) }).catch(() => {});
      console.error(`FAIL ${name}: ${error}`);
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ assertions, results, errors,
    scope: 'Synthetic local browser ledger; font-scale emulation, not native-device proof.' }, null, 2));
}
assert.deepEqual(errors, [], 'no runtime page errors');
assert.ok(results.every(result => result.passed), 'Home layout regression failed');
console.log(`${results.length} cases, ${assertions} assertions passed`);
