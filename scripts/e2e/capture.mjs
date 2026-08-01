/**
 * Screenshot every Wafra surface from the exported web build.
 *
 * This is the harness the visual reviewers run against. It exists because there
 * is no iOS simulator and no Android emulator on the build box, so the web
 * export is the only way to actually LOOK at a screen rather than read its code.
 *
 * Two rules learned the hard way, both still true:
 *
 *  - Tabs must be reached by clicking, not by URL. Every screen stays mounted
 *    behind the current one, so a text match can land on a hidden screen, and a
 *    cold route load throws the (harmless, upstream) hydration error.
 *  - Caps labels are a CSS `text-transform`, so the DOM text is still title
 *    case. Pass getByText a STRING (case-insensitive) or a regex with /i.
 *
 * Usage:
 *   node scripts/e2e/capture.mjs --out DIR [--scheme dark] [--lang en] [--base URL]
 *   node scripts/e2e/capture.mjs --out DIR --all      # both schemes, both languages
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const BASE = arg('base', process.env.BASE ?? 'http://localhost:8126');
const OUT = arg('out', process.env.OUT);
const CHROMIUM =
  process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

if (!OUT) {
  console.error('capture: --out DIR is required');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

/** Tab surfaces, reached by clicking the tab bar. */
const TABS = [
  ['home', 'Home'],
  ['flow', 'Flow'],
  ['bills', 'Bills'],
  ['wallet', 'Wallet'],
];

/**
 * Pushed screens, reached by URL. Paths are EXTENSIONLESS: the export writes
 * `settings.html`, but the client router only matches `/settings` and renders
 * "Unmatched Route" for anything else. scripts/e2e/serve.mjs does that rewrite —
 * a plain `python3 -m http.server` will 404 on every one of these.
 */
const PUSHED = [
  ['transactions', '/transactions'],
  ['stats', '/stats'],
  ['settings', '/settings'],
  ['cards', '/cards'],
  ['import-sms', '/import-sms'],
  ['add-transaction', '/add-transaction'],
  ['accuracy', '/accuracy'],
  ['pro', '/pro'],
];

const settle = (page, ms = 900) => page.waitForTimeout(ms);

/**
 * Wait until the layout stops moving.
 *
 * A fixed sleep is not enough: `Section` (src/components/ui/layout.tsx) gives
 * every section a staggered FadeInDown, so Settings' six sections are still
 * sliding past each other a full two seconds in — screenshots taken on a timer
 * catch two legible layers of text overlapping and manufacture layout bugs that
 * do not exist on device. Poll the geometry instead and shoot once it is still.
 */
async function waitForStable(page, { tries = 40, needed = 3, gap = 150 } = {}) {
  let last = '';
  let steady = 0;
  for (let i = 0; i < tries; i++) {
    const now = await page
      .evaluate(() => {
        const nodes = [...document.querySelectorAll('div,span,svg')].slice(0, 400);
        return nodes.map((n) => {
          const r = n.getBoundingClientRect();
          return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}`;
        }).join('|');
      })
      .catch(() => '');
    if (now && now === last) {
      if (++steady >= needed) return true;
    } else {
      steady = 0;
    }
    last = now;
    await page.waitForTimeout(gap);
  }
  return false;
}

/** Click by visible label, hit-testing so we never hit a mounted-but-hidden screen. */
async function tapText(page, label) {
  const matches = page.getByText(label, { exact: false });
  const n = await matches.count();
  for (let i = 0; i < n; i++) {
    const el = matches.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const box = await el.boundingBox().catch(() => null);
    if (!box) continue;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const onTop = await page.evaluate(
      ([px, py, text]) => {
        const hit = document.elementFromPoint(px, py);
        return !!hit && (hit.textContent ?? '').toLowerCase().includes(text.toLowerCase());
      },
      [x, y, label],
    );
    if (!onTop) continue;
    await page.mouse.click(x, y);
    return true;
  }
  return false;
}

/** Clear the first-run gate with the demo ledger loaded, so screens have data. */
async function bootWithSampleData(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await settle(page, 1400);
  // 'Read my inbox' is Android-only; on web the primary is 'Continue', which
  // leads to the choose step. Either path ends at 'Start with sample data'.
  for (let i = 0; i < 3; i++) {
    if (await tapText(page, 'Start with sample data')) {
      await settle(page, 1400);
      return true;
    }
    if (await tapText(page, 'Continue')) {
      await settle(page, 900);
      continue;
    }
    break;
  }
  return false;
}

/**
 * Set the UI language, then reload so RTL applies.
 *
 * Written straight into persisted state rather than driven through Settings.
 * The Settings row is a toggle whose subtitle reads "English · العربية restarts
 * the app" in BOTH states, so probing it for the Arabic word always answered
 * yes — the toggle never fired and every "Arabic" screenshot came out
 * byte-identical to the English one. Storage is the only unambiguous source.
 */
async function setLanguage(page, lang) {
  const changed = await page.evaluate((want) => {
    const KEY = 'wafra/state/v1';
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return false;
    const meta = JSON.parse(raw);
    meta.language = want;
    window.localStorage.setItem(KEY, JSON.stringify(meta));
    return true;
  }, lang);
  if (!changed) console.log(`! could not set language=${lang}: no persisted state`);
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await settle(page, 1200);
  await waitForStable(page);
  return changed;
}

async function captureRun(browser, { scheme, lang }) {
  const suffix = lang === 'en' ? scheme : `${scheme}-${lang}`;
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
    // iPhone 15-ish UA so any platform branch takes the mobile path.
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  const booted = await bootWithSampleData(page);
  if (!booted) console.log(`! ${suffix}: onboarding gate not cleared`);
  if (lang !== 'en') await setLanguage(page, lang);

  for (const [name, tabLabel] of TABS) {
    const idx = TABS.findIndex(([n]) => n === name);
    const tab = page.getByRole('tab', { name: tabLabel }).first();
    if (await tab.isVisible().catch(() => false)) {
      await tab.click().catch(() => {});
    } else {
      // Arabic relabels the tabs; fall back to positional order.
      await page.getByRole('tab').nth(idx).click().catch(() => {});
    }
    await settle(page, 400);
    await waitForStable(page);
    await page.screenshot({ path: `${OUT}/${suffix}-${name}.png` });
    console.log(`shot ${suffix}-${name}`);
  }

  for (const [name, path] of PUSHED) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' }).catch(() => {});
    await settle(page, 400);
    await waitForStable(page);
    await page.screenshot({ path: `${OUT}/${suffix}-${name}.png` });
    console.log(`shot ${suffix}-${name}`);
  }

  // Hydration noise on cold route loads is upstream and expected; drop it so a
  // real error stands out. See scripts/e2e/README.md.
  const real = [...new Set(errors)].filter(
    (e) => !/Minified React error #(418|423|425)|Hydration failed|did not match/i.test(e),
  );
  if (real.length) {
    console.log(`\n--- ${suffix} console errors ---`);
    for (const e of real.slice(0, 12)) console.log(e);
  }
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: CHROMIUM });

const runs = flag('all')
  ? [
      { scheme: 'dark', lang: 'en' },
      { scheme: 'light', lang: 'en' },
      { scheme: 'dark', lang: 'ar' },
      { scheme: 'light', lang: 'ar' },
    ]
  : [{ scheme: arg('scheme', 'dark'), lang: arg('lang', 'en') }];

for (const run of runs) await captureRun(browser, run);

await browser.close();
console.log(`\ncaptured -> ${OUT}`);
