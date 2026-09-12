// Fresh real-export onboarding regression matrix. Every scenario gets isolated
// empty financial storage; no device state, native permission, or SMS is mocked
// into a browser success. Export with EXPO_PUBLIC_WAFRA_E2E_DEMO=1 first.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const { STATE_KEY, createWebSeed } = require('./universal-review-fixtures.cjs');
const BASE = process.env.BASE ?? 'http://localhost:8126';
const OUT = process.env.OUT ?? '/tmp/wafra-onboarding-extreme';
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const FILTER = process.env.CASE_FILTER ? new RegExp(process.env.CASE_FILTER) : null;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {});
const results = [];
const observations = [];

const copy = {
  en: {
    welcome: 'Your money. A clearer picture.', choose: 'Choose how to start',
    focus: 'What do you want to understand first?', tracking: 'How do you track money today?',
    preview: 'Wafra does the organizing.', privacy: 'Your data stays under your control.',
    connect: 'Choose how to connect', capture: 'Start your way',
    complete: 'Begin with something real.', next: 'Continue', back: 'Back',
    manual: /^Start manually\./, add: 'Add my first entry', close: 'Close',
    landing: ['Open Spending', 'Open Bills', 'Open Home', 'Open Home'],
    personalize: 'Make it yours', edit: 'Edit your preferences',
    goals: 'Your goals', budget: 'Your spending plan', save: 'Save plan', skip: 'Set this up later',
    organize: 'Organize this alert', reset: 'See the alert again',
  },
  ar: {
    welcome: 'أموالك. بصورة أوضح.', choose: 'اختر كيف تبدأ',
    focus: 'ما الذي تريد فهمه أولاً؟', tracking: 'كيف تتابع أموالك اليوم؟',
    preview: 'وفرة يتولى التنظيم.', privacy: 'بياناتك تبقى تحت سيطرتك.',
    connect: 'اختر طريقة الربط', capture: 'ابدأ بطريقتك',
    complete: 'ابدأ بعملية حقيقية.', next: 'متابعة', back: 'رجوع',
    manual: /^ابدأ يدوياً\./, add: 'أضف أول عملية لي', close: 'إغلاق',
    landing: ['افتح المصروفات', 'افتح الفواتير', 'افتح الرئيسية', 'افتح الرئيسية'],
    personalize: 'خصّص تجربتك', edit: 'عدّل تفضيلاتك',
    goals: 'أهدافك', budget: 'خطة إنفاقك', save: 'حفظ الخطة', skip: 'إعداد هذا لاحقاً',
    organize: 'نظّم هذا التنبيه', reset: 'شاهد التنبيه مجدداً',
  },
};
const focuses = ['spending', 'bills', 'cashflow', 'overview'];
const trackings = ['none', 'bank-apps', 'spreadsheet', 'finance-app'];
const stages = ['welcome', 'focus', 'tracking', 'preview', 'privacy', 'capture', 'complete'];
const landingPaths = ['/flow', '/bills', '/', '/'];
const control = (page, name, role = 'button') => page.getByRole(role, { name, exact: true });

function emptySeed(language) {
  return createWebSeed().map(([key, value]) => {
    if (key !== STATE_KEY) return [key, value];
    const state = JSON.parse(value);
    Object.assign(state, {
      ledgerMoney: null, accounts: [], budgets: [], bills: [], cardDues: [], goals: [],
      onboardingPlan: null, onboardingProfile: null, onboardingCurrencyEvidence: null,
      onboarded: false, captureOptOut: false, historyImport: null, lastScanTs: 0,
      language, languagePreference: language, userName: 'there',
      themePreference: 'system', marketId: '', txChunks: 0,
    });
    return [key, JSON.stringify(state)];
  });
}

async function saved(page) {
  return page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key) ?? '{}');
    const transactions = state.transactions ?? Array.from({ length: state.txChunks ?? 0 },
      (_, i) => JSON.parse(localStorage.getItem(`${key}:tx:${i}`) ?? '[]')).flat();
    return { ...state, transactions };
  }, STATE_KEY);
}

async function assertNoInventedMoney(page, onboarded = false) {
  const state = await saved(page);
  for (const key of ['transactions', 'accounts', 'budgets', 'bills', 'cardDues', 'goals']) {
    assert.deepEqual(state[key], [], `${key}: preferences and examples must not create financial rows`);
  }
  assert.equal(state.ledgerMoney, null);
  assert.equal(state.onboardingCurrencyEvidence, null);
  assert.equal(state.historyImport, null);
  assert.deepEqual(state.reviewTray.pending, []);
  assert.deepEqual(state.localCaptureQualifications, []);
  assert.equal(state.onboarded, onboarded);
  return state;
}

// Hidden navigator screens remain mounted. Match exposed controls only, and
// retain the extra scroll that moves controls clear of the floating tab bar.
async function exposed(locator, timeout = 9000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    for (const item of await locator.all()) {
      if (!await item.isVisible()) continue;
      await item.scrollIntoViewIfNeeded({ timeout: 600 }).catch(() => {});
      const hit = await item.evaluate((node) => {
        for (let p = node; p; p = p.parentElement) {
          if (p.getAttribute('aria-hidden') === 'true' || getComputedStyle(p).opacity === '0') return false;
        }
        let r = node.getBoundingClientRect();
        if (document.querySelector('[role="tab"][aria-selected="true"]')) {
          let parent = node.parentElement;
          while (parent && !(parent.scrollHeight > parent.clientHeight + 4 && parent.clientHeight > 200)) parent = parent.parentElement;
          if (parent && r.bottom > innerHeight - 120) parent.scrollTop += r.bottom - innerHeight + 132;
          r = node.getBoundingClientRect();
        }
        const x = Math.min(innerWidth - 1, Math.max(1, r.x + r.width / 2));
        const y = Math.min(innerHeight - 1, Math.max(1, r.y + r.height / 2));
        const top = document.elementFromPoint(x, y);
        return r.width > 0 && r.height > 0 && !!top && (node.contains(top) || top.contains(node));
      }).catch(() => false);
      if (hit) return item;
    }
    await pageTick();
  }
  throw new Error(`No exposed UI match: ${locator}`);
}
const pageTick = () => new Promise((resolve) => setTimeout(resolve, 60));
async function click(page, name) { await (await exposed(control(page, name))).click(); }
async function radio(page, testId, index) {
  const choices = page.getByTestId(testId).getByRole('radio');
  assert.equal(await choices.count(), 4, 'all four preferences must be offered');
  await (await exposed(choices.nth(index))).click();
  assert.equal(await choices.nth(index).getAttribute('aria-checked'), 'true');
}
async function heading(page, c, stage) { await exposed(page.getByRole('heading', { name: c[stage], exact: true })); }
async function durable(page, stage) {
  await page.waitForFunction(({ key, stage }) => JSON.parse(localStorage.getItem(key) ?? '{}').onboardingProfile?.stage === stage,
    { key: STATE_KEY, stage });
  // Allow the normal debounce to settle after a second UI update to the same stage.
  await page.waitForTimeout(800);
}
async function reach(page, c, target, focus = 0, tracking = 0) {
  await heading(page, c, 'welcome');
  if (target === 'welcome') return;
  await click(page, c.choose); await heading(page, c, 'focus');
  if (target === 'focus') return;
  await radio(page, 'onboarding-focus-options', focus);
  await click(page, c.next); await heading(page, c, 'tracking');
  if (target === 'tracking') return;
  await radio(page, 'onboarding-tracking-options', tracking);
  await click(page, c.next); await heading(page, c, 'preview');
  if (target === 'preview') return;
  await click(page, c.next); await heading(page, c, 'privacy');
  if (target === 'privacy') return;
  await click(page, c.connect); await heading(page, c, 'capture');
  if (target === 'capture') return;
  await click(page, c.manual); await heading(page, c, 'complete');
}

// Browser text-only stress, not a substitute for native Dynamic Type.
async function doubleText(page) {
  await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('div,span,p,h1,h2,h3,button,a')]
      .filter((node) => !node.dataset.extremeScaled && [...node.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim()))
      .map((node) => ({ node, size: parseFloat(getComputedStyle(node).fontSize), line: parseFloat(getComputedStyle(node).lineHeight) }));
    for (const { node, size, line } of nodes) {
      node.style.setProperty('font-size', `${size * 2}px`, 'important');
      if (Number.isFinite(line)) node.style.setProperty('line-height', `${line * 2}px`, 'important');
      node.dataset.extremeScaled = '1';
    }
  });
}
async function noHorizontalClipping(page) {
  const failures = await page.evaluate(() => {
    const bad = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const text = walk.currentNode; const node = text.parentElement;
      if (!node || !text.textContent.trim() || node.closest('script,style,svg')) continue;
      let hidden = false;
      for (let p = node; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (p.getAttribute('aria-hidden') === 'true' || s.opacity === '0' || s.display === 'none' || s.visibility === 'hidden') hidden = true;
      }
      if (hidden) continue;
      const box = node.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      for (const word of text.textContent.matchAll(/\S+/gu)) {
        const range = document.createRange(); range.setStart(text, word.index); range.setEnd(text, word.index + word[0].length);
        for (const r of range.getClientRects()) {
          if (r.width > 0 && (r.left < -2 || r.right > innerWidth + 2 || r.left < box.left - 2 || r.right > box.right + 2)) {
            bad.push({ text: text.textContent.trim(), left: r.left, right: r.right, boxLeft: box.left, boxRight: box.right }); break;
          }
        }
      }
    }
    return bad;
  });
  assert.deepEqual(failures, [], 'painted words must fit the viewport and their text box');
}
async function shot(page, name) {
  // The persistent Back control shares the brief transition lock with the
  // forward action. Unlike Continue on an unanswered question, Back can always
  // become enabled, so it provides a real settled-state signal for screenshots.
  const back = page.getByRole('button', { name: /^(Back|رجوع)$/ }).first();
  if (await back.count()) {
    const deadline = Date.now() + 5000;
    while (!await back.isEnabled() && Date.now() < deadline) await page.waitForTimeout(30);
    assert.ok(await back.isEnabled(), 'navigation must settle before the screenshot');
  } else await page.waitForTimeout(220); // welcome has no navigation lock
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}

async function scenario(name, options, run) {
  if (FILTER && !FILTER.test(name)) return;
  const { language = 'en', width = 390, colorScheme = 'light', reducedMotion = false } = options;
  const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme,
    locale: language === 'ar' ? 'ar-AE' : 'en-US', reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await context.addInitScript((entries) => {
      window.__wafraExtremeExampleAnimations = [];
      document.addEventListener('animationstart', (event) => {
        if (event.target?.closest?.('[data-testid="onboarding-example"]')) {
          window.__wafraExtremeExampleAnimations.push(event.animationName);
        }
      }, true);
      if (localStorage.getItem('wafra/extreme-seeded')) return;
      for (const [key, value] of entries) localStorage.setItem(key, value);
      localStorage.setItem('wafra/extreme-seeded', '1');
    }, emptySeed(language));
    await page.goto(new URL('/', BASE).href, { waitUntil: 'networkidle' });
    await heading(page, copy[language], 'welcome');
    await assertNoInventedMoney(page);
    await run(page, copy[language], name);
    assert.deepEqual(errors, [], 'uncaught application errors');
    results.push({ name, passed: true, language, width, colorScheme, reducedMotion });
    console.log(`✓ extreme: ${name}`);
  } catch (error) {
    await shot(page, `${name}-FAILED`).catch(() => {});
    results.push({ name, passed: false, language, width, colorScheme, error: error.stack ?? String(error), applicationErrors: errors });
    console.error(`✗ extreme: ${name}\n${error.stack ?? error}`);
  } finally { await context.close(); }
  writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({
    base: BASE, generatedAt: new Date().toISOString(), browser: browser.version(), node: process.version,
    scope: 'Fresh real web export, isolated empty browser storage. Browser text stress and horizontal painted-word fit; no native Dynamic Type, real SMS, or Shortcuts proof.',
    results, observations,
  }, null, 2));
}

try {
  for (let f = 0; f < 4; f++) for (let t = 0; t < 4; t++) {
    await scenario(`preferences-${focuses[f]}-${trackings[t]}`, { colorScheme: (f + t) % 2 ? 'dark' : 'light' }, async (page, c) => {
      await reach(page, c, 'capture', f, t);
      for (const previous of ['privacy', 'preview', 'tracking', 'focus', 'welcome']) {
        await click(page, c.back); await heading(page, c, previous);
        if (previous === 'tracking') assert.equal(await page.getByTestId('onboarding-tracking-options').getByRole('radio').nth(t).getAttribute('aria-checked'), 'true');
        if (previous === 'focus') assert.equal(await page.getByTestId('onboarding-focus-options').getByRole('radio').nth(f).getAttribute('aria-checked'), 'true');
      }
      await reach(page, c, 'complete', f, t);
      await durable(page, 'complete');
      const state = await assertNoInventedMoney(page);
      assert.equal(state.onboardingProfile.focus, focuses[f]);
      assert.equal(state.onboardingProfile.tracking, trackings[t]);
      assert.equal(state.captureOptOut, true);
      await click(page, c.landing[f]);
      await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).onboarded === true, STATE_KEY);
      await page.waitForURL((url) => url.pathname === landingPaths[f]);
      assert.equal(new URL(page.url()).pathname, landingPaths[f]);
      await assertNoInventedMoney(page, true);
    });
  }

  for (const target of stages) {
    await scenario(`reload-${target}`, {}, async (page, c, name) => {
      await reach(page, c, target, 1, 2);
      if (target !== 'welcome') await durable(page, target);
      await page.reload({ waitUntil: 'networkidle' });
      // A saved completion stage is not proof of a successful native setup.
      // Until final completion is durable, resume capture and retain choices.
      await heading(page, c, target === 'complete' ? 'capture' : target);
      await assertNoInventedMoney(page);
      await shot(page, name);
      if (target === 'tracking') assert.equal(await page.getByTestId('onboarding-focus-options').count(), 0);
    });
  }

  await scenario('rapid-taps-and-disabled-continue', {}, async (page, c, name) => {
    await click(page, c.choose); await heading(page, c, 'focus');
    assert.equal(await control(page, c.next).getAttribute('aria-disabled'), 'true', 'focus required before continuing');
    await radio(page, 'onboarding-focus-options', 0);
    await (await exposed(control(page, c.next))).dblclick({ delay: 30 });
    await heading(page, c, 'tracking');
    assert.equal(await control(page, c.next).getAttribute('aria-disabled'), 'true', 'tracking required before continuing');
    await radio(page, 'onboarding-tracking-options', 0);
    await (await exposed(control(page, c.next))).dblclick({ delay: 30 });
    await heading(page, c, 'preview');
    await shot(page, name);
    await assertNoInventedMoney(page);
  });

  await scenario('manual-back-and-completion-reload', { colorScheme: 'dark' }, async (page, c, name) => {
    await reach(page, c, 'complete', 1, 1);
    for (let i = 0; i < 3; i++) {
      await click(page, c.back); await heading(page, c, 'capture');
      await (await exposed(control(page, c.manual))).dblclick({ delay: 25 });
      await heading(page, c, 'complete');
    }
    await click(page, c.landing[1]);
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).onboarded === true, STATE_KEY);
    // Reopen the root entry instead of directly loading an exported nested
    // route, which has a separately known Expo static hydration limitation.
    await page.goto(new URL('/', BASE).href, { waitUntil: 'networkidle' });
    assert.equal(await page.getByTestId('onboarding-welcome').count(), 0);
    await assertNoInventedMoney(page, true);
    await shot(page, name);
  });

  await scenario('all-plan-options-cancel-and-save', {}, async (page, c, name) => {
    await reach(page, c, 'capture');
    await click(page, c.personalize); await heading(page, c, 'goals');
    const goals = page.getByRole('checkbox');
    assert.equal(await goals.count(), 3);
    // Deselect the default, then choose each independently and back out.
    await (await exposed(goals.nth(0))).click();
    for (let i = 0; i < 3; i++) { await (await exposed(goals.nth(i))).click(); await (await exposed(goals.nth(i))).click(); }
    assert.equal(await control(page, c.next).getAttribute('aria-disabled'), 'true',
      'an empty goal selection cannot advance');
    await click(page, c.skip); await heading(page, c, 'capture');
    assert.equal((await saved(page)).onboardingPlan, null, 'skip must not persist a plan');
    for (let i = 0; i < 3; i++) {
      await click(page, i ? c.edit : c.personalize);
      if (i === 0) await (await exposed(page.getByRole('checkbox').nth(0))).click();
      await click(page, c.next); await heading(page, c, 'budget');
      const choices = page.getByRole('radio'); assert.equal(await choices.count(), 3);
      await (await exposed(choices.nth(i))).click();
      await click(page, c.save); await heading(page, c, 'capture');
      await page.waitForFunction(({ key, budget }) => JSON.parse(localStorage.getItem(key)).onboardingPlan?.budgetId === budget,
        { key: STATE_KEY, budget: ['essentials', 'balanced', 'flexible'][i] });
      await assertNoInventedMoney(page);
    }
    await shot(page, name);
  });

  for (const language of ['en', 'ar']) for (const colorScheme of ['light', 'dark']) {
    await scenario(`visual-${language}-${colorScheme}`, { language, colorScheme }, async (page, c, name) => {
      await shot(page, `${name}-welcome`);
      await reach(page, c, 'capture', 1, 1);
      await noHorizontalClipping(page);
      await shot(page, `${name}-capture`);
      await click(page, c.manual); await heading(page, c, 'complete');
      await noHorizontalClipping(page);
      await shot(page, `${name}-complete`);
      await click(page, c.add);
      await page.waitForURL(/\/add-transaction(?:\?|$)/);
      await click(page, c.close);
      assert.equal(await page.getByTestId('onboarding-welcome').count(), 0,
        'canceling the first-entry form must not restart onboarding');
      await assertNoInventedMoney(page, true);
    });
  }

  for (const language of ['en', 'ar']) for (const width of [320, 390]) for (const colorScheme of ['light', 'dark']) {
    await scenario(`layout-${language}-${width}-${colorScheme}-200pct-reduce`, { language, width, colorScheme, reducedMotion: true }, async (page, c, name) => {
      assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
      if (language === 'ar') assert.equal(await page.getByTestId('onboarding-welcome').evaluate((node) => getComputedStyle(node).direction), 'rtl');
      for (const stage of stages) {
        await heading(page, c, stage);
        const title = page.getByRole('heading', { name: c[stage], exact: true });
        const baseline = await title.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
        await doubleText(page);
        const scaled = await title.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
        assert.ok(Math.abs(scaled - baseline * 2) < 0.5, `${stage}: the text actually doubled`);
        await noHorizontalClipping(page);
        await shot(page, `${name}-${stage}`);
        if (stage === 'welcome') {
          await click(page, c.organize); await doubleText(page); await noHorizontalClipping(page);
          const animations = await page.getByTestId('onboarding-example').evaluate((node) => node.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length);
          assert.equal(animations, 0);
          assert.deepEqual(await page.evaluate(() => window.__wafraExtremeExampleAnimations), [],
            'Reduce Motion must prevent animation starts, including short completed reveals');
          await click(page, c.reset); await click(page, c.choose);
        } else if (stage === 'focus') { await radio(page, 'onboarding-focus-options', 1); await click(page, c.next); }
        else if (stage === 'tracking') { await radio(page, 'onboarding-tracking-options', 3); await click(page, c.next); }
        else if (stage === 'preview') await click(page, c.next);
        else if (stage === 'privacy') await click(page, c.connect);
        else if (stage === 'capture') await click(page, c.manual);
        else {
          const action = await exposed(control(page, c.add));
          assert.ok((await action.boundingBox()).height >= 44, 'completion action is at least 44px tall');
          await shot(page, `${name}-completion-action`);
        }
      }
      await assertNoInventedMoney(page);
    });
  }
} finally { await browser.close(); }
const failed = results.filter((result) => !result.passed).length;
console.log(`${results.length - failed}/${results.length} extreme onboarding scenarios passed. Artifacts: ${OUT}`);
if (failed) process.exitCode = 1;
