// Real-export first-run acceptance. Every case uses a new browser context.
// Build with EXPO_PUBLIC_WAFRA_E2E_DEMO=1, then set BASE and optionally OUT.
// The empty persisted seed precedes the first navigation, so the E2E export
// cannot load its ordinary demo ledger. No native device or user data is used.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const { STATE_KEY, createWebSeed } = require('./universal-review-fixtures.cjs');
const BASE = process.env.BASE ?? 'http://localhost:8126';
const OUT = process.env.OUT ?? '/tmp/wafra-onboarding-e2e';
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {});
const results = [];
const scaleByPage = new WeakMap();

const copy = {
  en: {
    headline: 'Your money, finally clear.', firstLine: 'Your money,', example: 'Examples from your region',
    choose: 'Build my money picture', nameTitle: 'What should we call you?', namePlaceholder: 'Your name',
    nameSkip: 'Skip for now', namePrivacy: 'Used only to personalize Wafra on this device.',
    focus: 'What do you want to understand first?', namedFocus: 'Sam, what do you want to understand first?',
    focusChoice: 'Bills & subscriptions', tracking: 'How do you track money today?',
    trackingChoice: 'I check my bank apps',
    alerts: 'How does your bank tell you about a payment?', alertsChoice: 'App notifications only',
    intention: 'What would make money feel easier?', intentionChoice: 'Stay ahead of bills',
    preview: 'Your starting view is ready.', namedPreview: 'Sam, your starting view is ready.',
    capture: 'Start your way', back: 'Back',
    next: 'Continue',
    manual: /^Start manually\./, complete: 'Add your first entry.',
    add: 'Add my first entry', landing: 'Open Bills', landingPath: '/bills', saveTransaction: 'Save transaction',
  },
  ar: {
    headline: 'أموالك، واضحة أخيراً.', firstLine: 'أموالك،', example: 'أمثلة من منطقتك',
    choose: 'ابنِ صورتي المالية', nameTitle: 'بماذا تحب أن نناديك؟', namePlaceholder: 'اسمك',
    nameSkip: 'تخطي الآن', namePrivacy: 'يُستخدم فقط لتخصيص وفرة على هذا الجهاز.',
    focus: 'ما الذي تريد فهمه أولاً؟', namedFocus: 'Sam، ما الذي تريد فهمه أولاً؟',
    focusChoice: 'الفواتير والاشتراكات', tracking: 'كيف تتابع أموالك اليوم؟',
    trackingChoice: 'أراجع تطبيقات البنك',
    alerts: 'كيف يخبرك بنكك بعملية الدفع؟', alertsChoice: 'إشعارات التطبيق فقط',
    intention: 'ما الذي سيجعل إدارة المال أسهل؟', intentionChoice: 'أبقى متقدماً على الفواتير',
    preview: 'صورتك الأولى جاهزة.', namedPreview: 'Sam، صورتك الأولى جاهزة.',
    capture: 'ابدأ بطريقتك', back: 'رجوع',
    next: 'متابعة',
    manual: /^ابدأ يدوياً\./, complete: 'أضف أول عملية.',
    add: 'أضف أول عملية لي', landing: 'افتح الفواتير', landingPath: '/bills', saveTransaction: 'حفظ العملية',
  },
};

function emptySeed(language) {
  return createWebSeed().map(([key, value]) => {
    if (key !== STATE_KEY) return [key, value];
    const state = JSON.parse(value);
    Object.assign(state, {
      ledgerMoney: null, accounts: [], budgets: [], bills: [], cardDues: [], goals: [],
      onboardingPlan: null, onboardingCurrencyEvidence: null, onboarded: false,
      captureOptOut: false, historyImport: null, lastScanTs: 0,
      language, languagePreference: language, userName: 'there',
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

async function assertEmpty(page, { onboarded = false, optOut } = {}) {
  const saved = await ledger(page);
  for (const field of ['transactions', 'accounts', 'budgets', 'bills', 'cardDues', 'goals']) {
    assert.deepEqual(saved[field], [], `${field} must remain empty; examples/preferences are not money`);
  }
  assert.equal(saved.ledgerMoney, null, 'regional examples must not establish ledger currency');
  assert.equal(saved.onboardingCurrencyEvidence, null, 'the example must not become currency evidence');
  assert.equal(saved.historyImport, null, 'browser/manual setup must not manufacture an import');
  assert.deepEqual(saved.reviewTray.pending, [], 'the sample must not create a pending alert');
  assert.deepEqual(saved.localCaptureQualifications, [], 'the sample must not qualify real capture');
  assert.equal(saved.onboarded, onboarded, 'completion must reflect the explicit user action');
  if (optOut !== undefined) assert.equal(saved.captureOptOut, optOut);
  return saved;
}

async function assertExampleDidNotPersist(page) {
  // Production state writes have a 700ms debounce. An immediate storage read
  // could falsely pass while a demonstration's accidental write was queued.
  await page.waitForTimeout(900);
  await assertEmpty(page, { optOut: false });
  assert.equal((await ledger(page)).onboardingPlan, null, 'the sample cannot complete preferences');
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

const control = (page, name, role = 'button') => page.getByRole(role, { name, exact: true });
async function click(page, name, role = 'button') {
  await (await exposed(control(page, name, role))).click();
}

// Browser text-only stress, not proof of native Dynamic Type. Double actual
// text font size and line height without changing the viewport or zooming
// controls. Read all original metrics before changing any ancestor element.
async function textScale(page) {
  if (scaleByPage.get(page) !== 2) return;
  await page.evaluate(() => {
    const targets = [...document.querySelectorAll('div,span,p,h1,h2,h3,h4,h5,h6,button,a')]
      .filter((node) => !node.dataset.e2eTextScale && [...node.childNodes]
        .some((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim()))
      .map((node) => {
        const style = getComputedStyle(node);
        return { node, size: parseFloat(style.fontSize), line: parseFloat(style.lineHeight) };
      });
    for (const { node, size, line } of targets) {
      node.style.setProperty('font-size', `${size * 2}px`, 'important');
      if (Number.isFinite(line)) node.style.setProperty('line-height', `${line * 2}px`, 'important');
      node.dataset.e2eTextScale = '2';
    }
  });
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

async function stage(page, title, artifact, action) {
  await exposed(page.getByRole('heading', { name: title, exact: true }));
  await textScale(page);
  await exposed(page.getByRole('heading', { name: title, exact: true }));
  await noClippedText(page);
  await shot(page, artifact);
  if (action) {
    const target = await exposed(control(page, action));
    assert.ok((await target.boundingBox()).height >= 44, 'primary actions keep a 44px minimum touch target');
    await shot(page, `${artifact}-action`);
  }
}

async function capture(page, c, artifact) {
  await stage(page, c.capture, artifact, c.manual);
  const options = page.getByTestId('onboarding-start-options');
  assert.equal(await options.getByRole('button').count(), 1, 'web offers exactly one manual capture choice');
  await exposed(options.getByRole('button', { name: c.manual }));
  assert.equal(await page.getByTestId('onboarding-market-money-scene').count(), 0, 'capture setup replaces the welcome examples');
  await assertEmpty(page);
}

async function choose(page, name, groupId, artifact) {
  await click(page, name, 'radio');
  const group = page.getByTestId(groupId);
  assert.equal(await group.getByRole('radio', { name, exact: true }).getAttribute('aria-checked'), 'true',
    'The chosen option exposes its selected state to assistive technology');
  assert.equal(await group.getByRole('radio', { checked: true }).count(), 1, 'Only one option is selected');
  await textScale(page);
  await noClippedText(page);
  await shot(page, artifact);
}

async function reachCapture(page, c, artifact, { saveName = false, resume = false } = {}) {
  await click(page, c.choose);
  await stage(page, c.nameTitle, `${artifact}-name`, c.nameSkip);
  await exposed(page.getByText(c.namePrivacy, { exact: true }));
  assert.equal(await control(page, c.next).isEnabled(), false, 'Blank name cannot be submitted');
  if (saveName) {
    await page.getByRole('textbox', { name: c.namePlaceholder, exact: true }).fill('  Sam  ');
    await exposed(page.getByTestId('onboarding-name-preview'));
    await click(page, c.next);
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).userName === 'Sam', STATE_KEY);
  } else {
    await click(page, c.nameSkip);
  }
  await stage(page, saveName ? c.namedFocus : c.focus, `${artifact}-focus`, c.next);
  if (resume) {
    await page.reload({ waitUntil: 'networkidle' });
    await stage(page, c.namedFocus, `${artifact}-name-resumed`, c.next);
    assert.equal((await ledger(page)).userName, 'Sam', 'Personalization survives a fresh page load');
  }
  await choose(page, c.focusChoice, 'onboarding-focus-options', `${artifact}-focus-selected`);
  await click(page, c.next);
  await stage(page, c.tracking, `${artifact}-tracking`, c.next);
  await choose(page, c.trackingChoice, 'onboarding-tracking-options', `${artifact}-tracking-selected`);
  await click(page, c.next);
  await stage(page, c.alerts, `${artifact}-alerts`, c.next);
  await choose(page, c.alertsChoice, 'onboarding-alerts-options', `${artifact}-alerts-selected`);
  await click(page, c.next);
  await stage(page, c.intention, `${artifact}-intention`, c.next);
  await choose(page, c.intentionChoice, 'onboarding-intention-options', `${artifact}-intention-selected`);
  await click(page, c.next);
  await stage(page, saveName ? c.namedPreview : c.preview, `${artifact}-preview`, c.choose);
  const preview = page.getByTestId('onboarding-product-preview').first();
  await exposed(preview);
  for (const day of ['12', '18']) {
    const dayLabel = await exposed(preview.getByText(day, { exact: true }));
    const lineCount = await dayLabel.evaluate(node => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const lines = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0)
        .map(rect => Math.round(rect.top));
      return new Set(lines).size;
    });
    assert.equal(lineCount, 1, `Due day ${day} must remain a single readable number at the current text size`);
  }
  await assertEmpty(page, { optOut: false });
  await click(page, c.choose);
  await capture(page, c, `${artifact}-capture`);
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).onboardingProfile?.stage === 'capture', STATE_KEY);
  const profile = (await ledger(page)).onboardingProfile;
  assert.equal(profile.focus, 'bills');
  assert.equal(profile.tracking, 'bank-apps');
  assert.equal(profile.alerts, 'notifications');
  assert.equal(profile.intention, 'stay-ahead');
}

async function completion(page, c, artifact, addFirstEntry = false) {
  await click(page, c.manual);
  await stage(page, c.complete, artifact, c.add);
  await exposed(control(page, c.landing));
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).captureOptOut === true, STATE_KEY);
  await assertEmpty(page, { optOut: true });
  await click(page, addFirstEntry ? c.add : c.landing);
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).onboarded === true, STATE_KEY);
  await assertEmpty(page, { onboarded: true, optOut: true });
  if (addFirstEntry) {
    await page.waitForURL(/\/add-transaction(?:\?|$)/);
    await exposed(control(page, c.saveTransaction));
  } else {
    assert.equal(new URL(page.url()).pathname, c.landingPath);
  }
  assert.equal(await page.getByTestId('onboarding-welcome').count(), 0);
  await page.reload({ waitUntil: 'networkidle' });
  await assertEmpty(page, { onboarded: true, optOut: true });
  assert.equal(await page.getByTestId('onboarding-welcome').count(), 0, 'manual completion survives reload');
}

async function scenario(name, { language = 'en', width = 412, text = 1, reducedMotion = false } = {}, run) {
  const context = await browser.newContext({
    viewport: { width, height: 915 }, locale: language === 'ar' ? 'ar-AE' : 'en-US',
    colorScheme: 'light', reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  await context.route('**/*', route => {
    const url = route.request().url();
    return url.startsWith(BASE + '/') || url.startsWith('data:') || url.startsWith('blob:')
      ? route.continue() : route.abort();
  });
  scaleByPage.set(page, text);
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await context.addInitScript((entries) => {
      // Observe real CSS animation starts; a late getAnimations() snapshot
      // alone could pass after an incorrectly animated reveal had finished.
      window.__wafraOnboardingExampleAnimations = [];
      document.addEventListener('animationstart', (event) => {
        if (event.target?.closest?.('[data-testid="onboarding-market-money-scene"]')) {
          window.__wafraOnboardingExampleAnimations.push(event.animationName);
        }
      }, true);
      // A reload must read what the application saved, never reseed it.
      if (localStorage.getItem('wafra/e2e-onboarding-seeded') === '1') return;
      for (const [key, value] of entries) localStorage.setItem(key, value);
      localStorage.setItem('wafra/e2e-onboarding-seeded', '1');
    }, emptySeed(language));
    await page.goto(new URL('/', BASE).href, { waitUntil: 'networkidle' });
    const c = copy[language];
    const originalHeadlineSize = await (await exposed(page.getByText(c.firstLine, { exact: true })))
      .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
    await stage(page, c.headline, `${name}-welcome`, c.choose);
    await assertEmpty(page, { optOut: false });
    if (text === 2) {
      const size = await page.getByText(c.firstLine, { exact: true }).evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
      assert.ok(Math.abs(size - originalHeadlineSize * 2) < 0.5,
        'the large-text case actually doubles the current design headline');
    }
    if (language === 'ar') {
      assert.equal(await page.getByTestId('onboarding-welcome').evaluate((node) => getComputedStyle(node).direction), 'rtl');
    }
    if (reducedMotion) assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
    await run(page, c, name);
    assert.deepEqual(errors, [], 'no uncaught application error');
    results.push({ name, passed: true, language, width, textScale: text, reducedMotion });
    console.log(`✓ onboarding: ${name}`);
  } catch (error) {
    await shot(page, `${name}-FAILED`).catch(() => {});
    results.push({ name, passed: false, error: error.stack ?? String(error) });
    console.error(`✗ onboarding: ${name}\n${error.stack ?? error}`);
  } finally {
    await context.close();
  }
}

try {
  await scenario('regional-example-name-choices-resume', {}, async (page, c, name) => {
    const example = page.getByTestId('onboarding-market-money-scene');
    assert.equal(await example.count(), 1);
    await exposed(example.getByText(c.example, { exact: true }));
    assert.equal(await example.locator('[aria-label]').count(), 3, 'The regional welcome shows three distinct sample alerts');
    assert.equal(await page.getByRole('dialog').count(), 0, 'the example is inline, without a modal');
    await assertExampleDidNotPersist(page);
    await reachCapture(page, c, name, { saveName: true, resume: true });
    await click(page, c.back);
    await stage(page, c.namedPreview, `${name}-preview-back`, c.choose);
    await click(page, c.back);
    await stage(page, c.intention, `${name}-intention-back`, c.next);
    assert.equal(await control(page, c.intentionChoice, 'radio').getAttribute('aria-checked'), 'true', 'Back retains the chosen intention');
    await click(page, c.back);
    await stage(page, c.alerts, `${name}-alerts-back`, c.next);
    assert.equal(await control(page, c.alertsChoice, 'radio').getAttribute('aria-checked'), 'true', 'Back retains how the bank delivers alerts');
    await click(page, c.back);
    await stage(page, c.tracking, `${name}-tracking-back`, c.next);
    assert.equal(await control(page, c.trackingChoice, 'radio').getAttribute('aria-checked'), 'true', 'Back retains the tracking choice');
    await click(page, c.back);
    await stage(page, c.namedFocus, `${name}-focus-back`, c.next);
    assert.equal(await control(page, c.focusChoice, 'radio').getAttribute('aria-checked'), 'true', 'Back retains the Bills destination');
    await click(page, c.next);
    await click(page, c.next);
    await click(page, c.next);
    await click(page, c.next);
    await stage(page, c.namedPreview, `${name}-preview-restored`, c.choose);
    await click(page, c.choose);
    await capture(page, c, `${name}-saved`);
    assert.equal((await assertEmpty(page)).onboardingPlan, null, 'Journey choices must not fabricate a financial plan');
    await page.reload({ waitUntil: 'networkidle' });
    await capture(page, c, `${name}-resumed`);
    assert.equal((await ledger(page)).onboardingProfile.intention, 'stay-ahead');
    await completion(page, c, `${name}-manual`);
  });

  await scenario('skip-name-first-entry', {}, async (page, c, name) => {
    await reachCapture(page, c, name);
    assert.equal((await ledger(page)).userName, 'there', 'Skipping the name does not invent personalization');
    assert.equal((await ledger(page)).onboardingPlan, null, 'personalization is optional');
    await completion(page, c, `${name}-manual`, true);
  });

  for (const language of ['en', 'ar']) {
    await scenario(`${language}-320-large-text-reduced-motion`, { language, width: 320, text: 2, reducedMotion: true }, async (page, c, name) => {
      await exposed(page.getByTestId('onboarding-market-money-scene').getByText(c.example, { exact: true }));
      await textScale(page);
      await noClippedText(page);
      const animations = await page.getByTestId('onboarding-market-money-scene').evaluate((node) =>
        node.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length);
      assert.equal(animations, 0, 'Reduce Motion suppresses sample reveal animation');
      await shot(page, `${name}-organized`);
      await assertExampleDidNotPersist(page);
      assert.deepEqual(await page.evaluate(() => window.__wafraOnboardingExampleAnimations), [],
        'Reduce Motion must prevent sample CSS animation starts, including completed animations');
      await reachCapture(page, c, name);
      assert.equal((await ledger(page)).onboardingPlan, null, 'Journey choices leave financial plans empty');
      await completion(page, c, `${name}-manual`);
    });
  }
} finally {
  await browser.close();
  writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({
    base: BASE, generatedAt: new Date().toISOString(),
    scope: 'Chromium real web export with isolated empty storage; 200% browser text stress. No native permission, Dynamic Type, real SMS, or Shortcuts proof.',
    results,
  }, null, 2));
}
const failed = results.filter((result) => !result.passed).length;
console.log(`${results.length - failed}/${results.length} onboarding scenarios passed. Artifacts: ${OUT}`);
if (failed) process.exitCode = 1;
