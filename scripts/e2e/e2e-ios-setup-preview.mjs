// iPhone setup design preview (2026-09-25 simplification) on the real web export.
//
// The web build cannot run the iOS branches (Shortcuts, Messages automation),
// so /setup-preview draws the same presentational components those screens
// use, with fixed states. This suite checks every state in English and Arabic,
// light and dark, at default and doubled text, on a small and a large phone:
// the heading and primary action are on screen or reachable by scrolling,
// nothing overflows sideways, Arabic lays out right to left, and no text is
// clipped. It saves small PNGs as design evidence.
//
// Build with EXPO_PUBLIC_WAFRA_E2E_DEMO=1, serve it, then:
//   BASE=http://localhost:8126 OUT=docs/design/... node scripts/e2e/e2e-ios-setup-preview.mjs
// No device, Dynamic Type, Shortcuts, or Messages proof is claimed here.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const { STATE_KEY, createWebSeed } = require('./universal-review-fixtures.cjs');
const BASE = process.env.BASE ?? 'http://localhost:8126';
const OUT = process.env.OUT ?? '/tmp/wafra-ios-setup-preview';
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
mkdirSync(OUT, { recursive: true });

// [file name, route query, expected heading text per language, forced-dark?]
const SCREENS = [
  ['01-past-statements', 'screen=past', { en: 'Bring in your past spending', ar: 'أضف مصروفاتك السابقة' }, true],
  ['02-statement-import-onboarding', 'screen=statement&mode=onboarding', { en: 'What to download', ar: 'ما الذي تنزّله' }, true],
  ['03-statement-progress', 'screen=statement-progress&mode=settings', { en: 'Statement 2 of 3', ar: 'الكشف 2 من 3' }, false],
  ['04-statement-result', 'screen=statement-result&mode=settings', { en: 'Needs review', ar: 'للمراجعة' }, false],
  ['05-statement-error', 'screen=statement-error&mode=settings', { en: 'What to download', ar: 'ما الذي تنزّله' }, false],
  ['06-live-capture', 'screen=live', { en: 'Catch new transactions', ar: 'التقط العمليات الجديدة' }, true],
  ['07-guide-1-add', 'screen=add&mode=onboarding', { en: 'Add the shortcut', ar: 'أضف الاختصار' }, true],
  ['08-guide-2-test-failed', 'screen=test-fail&mode=onboarding', { en: 'Test it', ar: 'اختبره' }, true],
  ['09-guide-3-1-open', 'screen=automate-1&mode=onboarding', { en: 'Open Shortcuts', ar: 'افتح الاختصارات' }, true],
  ['10-guide-3-3-space', 'screen=automate-3&mode=onboarding', { en: 'Type one space', ar: 'اكتب مسافة واحدة' }, true],
  ['11-guide-3-5-pick', 'screen=automate-5&mode=onboarding', { en: 'Pick the shortcut', ar: 'اختر الاختصار' }, true],
  ['12-guide-done', 'screen=done&mode=onboarding', { en: 'Test passed', ar: 'نجح الاختبار' }, true],
  ['13-guide-settings', 'screen=add&mode=settings', { en: 'Add the shortcut', ar: 'أضف الاختصار' }, false],
];

function seed(language) {
  return createWebSeed().map(([key, value]) => {
    if (key !== STATE_KEY) return [key, value];
    const state = JSON.parse(value);
    Object.assign(state, { language, languagePreference: language, themePreference: 'system', onboarded: true });
    return [key, JSON.stringify(state)];
  });
}

const browser = await chromium.launch(existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {});
const results = [];
try {
  for (const language of ['en', 'ar']) {
    for (const scheme of ['light', 'dark']) {
      for (const [file, query, heading, forcedDark] of SCREENS) {
        // Forced-dark onboarding looks the same under either OS theme.
        if (forcedDark && scheme === 'light') continue;
        for (const [label, viewport, textScale] of [
          ['', { width: 390, height: 844 }, 1],
          ['-se-2x', { width: 375, height: 667 }, 2],
        ]) {
          const name = `${file}-${language}-${forcedDark ? 'night' : scheme}${label}`;
          if (ONLY && !ONLY.has(file)) continue;
          const context = await browser.newContext({
            viewport, deviceScaleFactor: 1, colorScheme: scheme, reducedMotion: 'reduce',
            locale: language === 'ar' ? 'ar-AE' : 'en-US',
          });
          const page = await context.newPage();
          // Offline apart from the export itself: no CDN logos, no relay.
          await context.route('**/*', (route) => {
            const url = route.request().url();
            return url.startsWith(BASE + '/') || url.startsWith('data:') || url.startsWith('blob:')
              ? route.continue() : route.abort();
          });
          const errors = [];
          page.on('pageerror', (error) => errors.push(String(error)));
          try {
            await context.addInitScript((entries) => {
              for (const [key, value] of entries) localStorage.setItem(key, value);
            }, seed(language));
            await page.goto(`${BASE}/setup-preview?${query}`, { waitUntil: 'networkidle' });
            const title = page.getByText(heading[language], { exact: true }).first();
            await title.waitFor({ state: 'attached', timeout: 15000 });
            if (textScale === 2) {
              await page.evaluate(() => {
                for (const node of document.querySelectorAll('div,span,p,button,a')) {
                  if (![...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim())) continue;
                  const style = getComputedStyle(node);
                  node.style.setProperty('font-size', `${parseFloat(style.fontSize) * 2}px`, 'important');
                  const line = parseFloat(style.lineHeight);
                  if (Number.isFinite(line)) node.style.setProperty('line-height', `${line * 2}px`, 'important');
                }
              });
              await page.waitForTimeout(150);
            }
            const layout = await page.evaluate(() => {
              const width = document.documentElement.clientWidth;
              let overflow = 0;
              for (const node of document.querySelectorAll('[role="button"], [role="header"], div')) {
                const box = node.getBoundingClientRect();
                if (box.width > 0 && box.height > 0 && getComputedStyle(node).visibility !== 'hidden' &&
                  (box.right > width + 1 || box.left < -1) && !node.closest('[aria-hidden="true"]')) overflow += 1;
              }
              const rtl = [...document.querySelectorAll('div')].some((node) => getComputedStyle(node).direction === 'rtl');
              return { overflow, rtl, scrollWidth: document.documentElement.scrollWidth, width };
            });
            assert.ok(layout.scrollWidth <= layout.width + 1, `${name}: no sideways page scroll`);
            if (language === 'ar') assert.ok(layout.rtl, `${name}: Arabic lays out right to left`);
            await title.scrollIntoViewIfNeeded().catch(() => {});
            // Scroll back to the top for the evidence image.
            await page.evaluate(() => {
              for (const node of document.querySelectorAll('div')) if (node.scrollTop) node.scrollTop = 0;
              window.scrollTo(0, 0);
            });
            const buttons = await page.locator('[role="button"]').count();
            assert.ok(buttons > 0, `${name}: has an action`);
            assert.deepEqual(errors, [], `${name}: no uncaught error`);
            await page.screenshot({ path: path.join(OUT, `${name}.png`) });
            results.push({ name, passed: true, overflowNodes: layout.overflow });
            console.log(`✓ ${name}`);
          } catch (error) {
            results.push({ name, passed: false, error: String(error?.message ?? error) });
            console.error(`✗ ${name}: ${error?.message ?? error}`);
          } finally {
            await context.close();
          }
        }
      }
    }
  }
} finally {
  await browser.close();
  writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({
    base: BASE, generatedAt: new Date().toISOString(),
    scope: 'Chromium, web E2E export, /setup-preview fixed states; 2x CSS text stress. No device, Dynamic Type, Shortcuts, or Messages proof.',
    results,
  }, null, 2));
}
const failed = results.filter((result) => !result.passed).length;
console.log(`${results.length - failed}/${results.length} iPhone setup preview states passed.`);
if (failed) process.exitCode = 1;
