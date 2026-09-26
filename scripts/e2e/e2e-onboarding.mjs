// Real-export design E first-run acceptance. Fresh synthetic contexts only.
// Test the shipped journey and native-style text-scale emulation; never seed money.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
const { STATE_KEY, createWebSeed } = require('./universal-review-fixtures.cjs');
const load = require('../universal-test/load-ts.cjs').createLoader();
const { onboardingECopy } = load('@/lib/onboarding-e-copy');
const BASE = process.env.BASE ?? 'http://localhost:8151';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(BASE).hostname));
const OUT = process.env.OUT ?? '/private/tmp/wafra-onboarding-e-final';
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {});
const results = [];
function emptySeed(language) {
  return createWebSeed().map(([key, value]) => {
    if (key !== STATE_KEY) return [key, value];
    const state = JSON.parse(value);
    Object.assign(state, {
      ledgerMoney: null, accounts: [], budgets: [], bills: [], cardDues: [], goals: [],
      onboardingPlan: null, onboardingCurrencyEvidence: null, onboarded: false,
      captureOptOut: false, historyImport: null, lastScanTs: 0,
      language, languagePreference: language, userName: 'there', wafraGoals: [], dailySummary: false,
      themePreference: 'system', marketId: '', txChunks: 0,
    });
    return [key, JSON.stringify(state)];
  });
}

async function ledger(page) {
  return page.evaluate((key) => {
    const meta = JSON.parse(localStorage.getItem(key) ?? '{}');
    const transactions = meta.transactions ?? Array.from({ length: meta.txChunks ?? 0 },
      (_, i) => JSON.parse(localStorage.getItem(`${key}:tx:${i}`) ?? '[]')).flat();
    return { ...meta, transactions };
  }, STATE_KEY);
}

// RN-web keeps the navigator mounted below onboarding. An offscreen or
// covered match must never satisfy a test of an exposed control.
async function exposed(locator, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const item of await locator.all()) {
      if (!await item.isVisible()) continue;
      await item.scrollIntoViewIfNeeded({ timeout: 500 }).catch(() => {});
      const hit = await item.evaluate((node) => {
        for (let p = node; p; p = p.parentElement) {
          if (p.getAttribute('aria-hidden') === 'true' || getComputedStyle(p).opacity === '0') return false;
        }
        const r = node.getBoundingClientRect();
        const x = Math.max(1, Math.min(innerWidth - 1, r.x + r.width / 2));
        const y = Math.max(1, Math.min(innerHeight - 1, r.y + r.height / 2));
        const top = document.elementFromPoint(x, y);
        return r.width > 0 && r.height > 0 && !!top && (node.contains(top) || top.contains(node));
      }).catch(() => false);
      if (hit) return item;
    }
    await new Promise((resolve) => setTimeout(resolve, 70));
  }
  throw new Error(`No exposed UI match: ${locator}`);
}

async function noClippedText(page) {
  const clipped = await page.evaluate(() => {
    const failures = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const text = walk.currentNode;
      const node = text.parentElement;
      if (!node || !text.textContent.trim() || node.closest('script,style,svg')) continue;
      let hidden = false;
      for (let p = node; p; p = p.parentElement) {
        const css = getComputedStyle(p);
        if (p.getAttribute('aria-hidden') === 'true' || css.display === 'none' ||
          css.visibility === 'hidden' || css.opacity === '0') { hidden = true; break; }
      }
      if (hidden) continue;
      const box = node.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      // Collapsed trailing spaces have Range rectangles outside the line's
      // layout box. Inspect painted words, not those invisible spaces.
      const runs = [];
      for (const match of text.textContent.matchAll(/\S+/gu)) {
        const range = document.createRange();
        range.setStart(text, match.index);
        range.setEnd(text, match.index + match[0].length);
        runs.push(...range.getClientRects());
      }
      const badRun = runs.find((r) => r.width > 0 && (r.left < -2 || r.right > innerWidth + 2 ||
        r.left < box.left - 2 || r.right > box.right + 2));
      // Cairo's font metric rectangle is taller than its line box even when
      // every glyph paints correctly. Check actual hidden lines instead of
      // treating that metric overhang as clipping. Vertical scroll is allowed.
      const css = getComputedStyle(node);
      const lineHeight = parseFloat(css.lineHeight);
      const lineCount = runs.length && Number.isFinite(lineHeight)
        ? Math.round((Math.max(...runs.map((r) => r.top)) - Math.min(...runs.map((r) => r.top))) / lineHeight) + 1 : 0;
      const hiddenLines = ['hidden', 'clip'].includes(css.overflowY) &&
        lineCount * lineHeight > node.clientHeight + 2;
      if (badRun || hiddenLines) {
        failures.push({ text: text.textContent.trim(), box: { x: box.x, width: box.width, height: box.height },
          ...(badRun ? { run: { x: badRun.x, width: badRun.width, height: badRun.height } } : { hiddenLines: lineCount }) });
      }
    }
    return failures;
  });
  assert.deepEqual(clipped, [], 'onboarding text must fit its box and viewport');
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}


async function assertNoInventedMoney(page, { onboarded = false, optOut = false, explicitLimit = false, currency = null } = {}) {
  const saved = await ledger(page);
  for (const field of ['transactions', 'accounts', 'bills', 'cardDues', 'goals']) {
    assert.deepEqual(saved[field], [], `${field}: preferences and pattern examples cannot become financial records`);
  }
  assert.deepEqual(saved.budgets.map(b => ({ category: b.category, limitFils: b.limitFils })),
    explicitLimit ? [{ category: 'dining', limitFils: 5000 }] : [], 'only the deliberately dialled limit may be saved');
  assert.equal(saved.ledgerMoney?.currency ?? null, currency, 'currency is established only by explicit confirmation');
  assert.equal(saved.onboardingCurrencyEvidence, null, 'preferences do not invent bank currency evidence');
  assert.equal(saved.historyImport, null);
  assert.deepEqual(saved.reviewTray.pending, []);
  assert.deepEqual(saved.localCaptureQualifications, []);
  assert.equal(saved.onboarded, onboarded);
  assert.equal(saved.captureOptOut, optOut);
  return saved;
}
async function press(page, id) {
  const target = await exposed(page.getByTestId(id));
  assert.ok((await target.boundingBox()).height >= 44, `${id} has a 44px touch target`);
  await target.click();
}
async function stage(page, id, title, name) {
  const root = await exposed(page.getByTestId(id));
  await exposed(root.getByRole('heading', { name: title, exact: true }));
  await page.evaluate(() => document.fonts.ready);
  await noClippedText(page);
  await shot(page, `${name}-${id}`);
}
const cases = [
  { name: 'en-name-resume-back', language: 'en', width: 412, scale: 1, motion: 'no-preference', named: true, resume: true },
  { name: 'ar-confirmed-preferences-watch', language: 'ar', width: 390, scale: 1, motion: 'no-preference', named: true, explicitLimit: true },
  { name: 'en-320-large-reduced', language: 'en', width: 320, scale: 2, motion: 'reduce' },
  { name: 'ar-320-largest-reduced', language: 'ar', width: 320, scale: 3.1, motion: 'reduce' },
];
try {
  for (const scenario of cases) {
    const { name, language, width, scale, motion, named = false, resume = false, explicitLimit = false } = scenario;
    const words = onboardingECopy(language);
    const context = await browser.newContext({ viewport: { width, height: 915 }, locale: language === 'ar' ? 'ar-AE' : 'en-US',
      colorScheme: language === 'ar' ? 'dark' : 'light', reducedMotion: motion });
    await context.route('**/*', route => route.request().url().startsWith(BASE + '/') ? route.continue() : route.abort());
    await context.addInitScript(({ entries, scale }) => {
      window.__WAFRA_E2E_FONT_SCALE__ = scale;
      if (localStorage.getItem('wafra/e2e-onboarding-seeded') === '1') return;
      for (const [key, value] of entries) localStorage.setItem(key, value);
      localStorage.setItem('wafra/e2e-onboarding-seeded', '1');
    }, { entries: emptySeed(language), scale });
    const page = await context.newPage();
    const findings = [];
    const check = (condition, message) => { if (!condition) findings.push(message); };
    const errors = []; page.on('pageerror', error => errors.push(String(error)));
    try {
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await stage(page, 'onboarding-welcome', words.welcomeHeadline, name);
      const example = page.getByTestId('onboarding-example-pattern');
      assert.equal(await example.count(), 1);
      assert.ok((await example.innerText()).includes(words.exampleLabel), 'the mosaic is clearly an example');
      assert.equal(await page.getByRole('dialog').count(), 0);
      await page.waitForTimeout(950);
      let saved = await assertNoInventedMoney(page);
      assert.deepEqual(saved.wafraGoals ?? [], [], 'welcome example goals never persist');
      assert.equal(saved.onboardingPlan, null);
      if (language === 'ar') assert.equal(await example.evaluate(node => getComputedStyle(node).direction), 'rtl');
      if (scale > 1) {
        const body = page.getByText(words.welcomeBody, { exact: true });
        assert.ok(await body.evaluate(node => parseFloat(getComputedStyle(node).fontSize)) >= 30, 'body text is materially enlarged');
        assert.equal(await page.evaluate(() => window.__WAFRA_E2E_FONT_SCALE__), scale);
      }
      if (motion === 'reduce') assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
      await press(page, 'onboarding-get-started');
      await stage(page, 'onboarding-name', words.nameTitle, name);
      assert.equal(await page.getByTestId('onboarding-name-continue').isDisabled(), true, 'blank name cannot continue; Skip remains available');
      await exposed(page.getByTestId('onboarding-name-skip'));
      if (explicitLimit) {
        await press(page, 'onboarding-country-confirm');
        await (await exposed(page.getByRole('radio', { name: /الإمارات العربية المتحدة|United Arab Emirates/ }))).click();
        await press(page, 'onboarding-currency-confirm');
        await (await exposed(page.getByRole('radio', { name: 'AED', exact: true }))).click();
        await page.waitForTimeout(850);
        saved = await assertNoInventedMoney(page, { currency: 'AED' });
        assert.equal(saved.onboardingProfile.country, 'AE');
      }
      if (named) {
        await page.getByTestId('onboarding-name-input').fill('  Sam  ');
        await press(page, 'onboarding-name-continue');
      } else await press(page, 'onboarding-name-skip');
      await stage(page, 'onboarding-goals', words.goalsTitle, name);
      if (resume) {
        await page.reload({ waitUntil: 'networkidle' });
        await stage(page, 'onboarding-goals', words.goalsTitle, `${name}-resumed`);
        assert.equal((await ledger(page)).userName, 'Sam');
      }
      await press(page, 'onboarding-goal-bills');
      await press(page, 'onboarding-goal-subscriptions');
      check(await page.getByTestId('onboarding-goal-options').getByRole('checkbox', { checked: true }).count() === 2, 'Both selected goals must expose checked state');
      await press(page, 'onboarding-goals-continue');
      await stage(page, 'onboarding-watch', words.watchTitle, name);
      if (resume) {
        await press(page, 'onboarding-back');
        await stage(page, 'onboarding-goals', words.goalsTitle, `${name}-back`);
        check(await page.getByTestId('onboarding-goal-options').getByRole('checkbox', { checked: true }).count() === 2, 'Back must retain accessible checked goals');
        await press(page, 'onboarding-back');
        await stage(page, 'onboarding-name', words.nameTitle, `${name}-back`);
        assert.equal(await page.getByTestId('onboarding-name-input').inputValue(), 'Sam');
        await press(page, 'onboarding-name-continue');
        await stage(page, 'onboarding-goals', words.goalsTitle, `${name}-restored`);
        await press(page, 'onboarding-goals-continue');
        await stage(page, 'onboarding-watch', words.watchTitle, `${name}-restored`);
      }
      await press(page, 'onboarding-watch-dining');
      check(await page.getByTestId('onboarding-watch-dining').getAttribute('aria-checked') === 'true', 'Selected Watch category must expose checked state');
      if (explicitLimit) {
        await press(page, 'onboarding-watch-limit-raise');
        await press(page, 'onboarding-watch-limit-raise');
        await noClippedText(page);
        await press(page, 'onboarding-watch-continue');
      } else await press(page, 'onboarding-watch-skip');
      await stage(page, 'onboarding-reminders', words.remindersTitle, name);
      for (const id of ['onboarding-remind-bills', 'onboarding-remind-cards', 'onboarding-remind-daily']) await exposed(page.getByTestId(id));
      const dailySwitch = page.getByRole('switch', { name: `${words.remindDailyTitle}. ${words.remindDailyWhen}`, exact: true });
      assert.equal(await dailySwitch.isChecked(), true);
      await dailySwitch.click();
      assert.equal(await dailySwitch.isChecked(), false);
      await press(page, 'onboarding-reminders-not-now');
      await stage(page, 'onboarding-capture', words.captureTitle, name);
      const options = page.getByTestId('onboarding-start-options');
      assert.equal(await options.getByRole('button').count(), 1, 'web offers only honest manual capture');
      assert.ok((await page.getByTestId('onboarding-capture').innerText()).includes(words.captureBodyWeb));
      await page.waitForTimeout(850);
      saved = await assertNoInventedMoney(page, { explicitLimit, currency: explicitLimit ? 'AED' : null });
      assert.deepEqual(saved.wafraGoals, ['bills', 'subscriptions']);
      assert.equal(saved.dailySummary, false, 'notification opt-out wins over the suggested switch');
      await press(page, 'onboarding-source-manual');
      await stage(page, 'onboarding-complete', words.manualTitle, name);
      await page.waitForTimeout(850);
      await assertNoInventedMoney(page, { explicitLimit, currency: explicitLimit ? 'AED' : null, optOut: true });
      await press(page, 'onboarding-complete-continue');
      await stage(page, 'onboarding-pattern', words.patternTitle(named ? 'Sam' : null), name);
      await exposed(page.getByTestId('onboarding-pattern-mosaic'));
      await press(page, 'onboarding-pattern-continue');
      await stage(page, 'onboarding-paywall', words.paywallTitle, name);
      await exposed(page.getByTestId('onboarding-paywall-free'));
      assert.equal(await page.getByTestId('onboarding-paywall-pro').count(), 0, 'web cannot pretend native checkout is available');
      assert.ok((await page.getByTestId('onboarding-trial-timeline').innerText()).includes(words.trialTodayBodyOff), 'manual path never claims capture is enabled');
      await press(page, 'onboarding-paywall-free');
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '{}').onboarded === true, STATE_KEY);
      await page.getByTestId('onboarding-paywall').waitFor({ state: 'hidden' });
      await exposed(page.getByTestId('reference-home-summary'));
      assert.equal(new URL(page.url()).pathname, '/');
      saved = await assertNoInventedMoney(page, { explicitLimit, currency: explicitLimit ? 'AED' : null, optOut: true, onboarded: true });
      if (named) assert.equal(saved.userName, 'Sam');
      assert.equal(saved.pro, false); assert.equal(saved.founderPro, false);
      await page.reload({ waitUntil: 'networkidle' });
      await exposed(page.getByTestId('reference-home-summary'));
      assert.equal(await page.getByTestId('onboarding-welcome').count(), 0);
      await assertNoInventedMoney(page, { explicitLimit, currency: explicitLimit ? 'AED' : null, optOut: true, onboarded: true });
      assert.deepEqual(errors, []);
      assert.deepEqual(findings, [], 'All selected controls must expose their state');
      await shot(page, `${name}-home`);
      results.push({ ...scenario, passed: true }); console.log('PASS onboarding E ' + name);
    } catch (error) {
      await shot(page, `${name}-FAILED`).catch(() => {});
      await writeFileSync(path.join(OUT, `${name}-FAILED.txt`), await page.locator('body').innerText());
      results.push({ ...scenario, passed: false, error: error.stack ?? String(error), pageErrors: errors, findings });
      console.error('FAIL onboarding E ' + name, error);
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ base: BASE, results,
    scope: 'Synthetic Expo web journey; native-style text scaling is emulated. No native capture, purchase, or notification grant is claimed.' }, null, 2));
}
assert.ok(results.length === 4 && results.every(result => result.passed), 'Design E onboarding acceptance');
