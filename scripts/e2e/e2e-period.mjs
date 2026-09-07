// Focused E2E: the global reporting period reflects on Home, Flow, and
// Activity, and survives a reload.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:8126';
let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}`); }
};

// The router keeps hidden screens mounted; hit-test so we only return an
// element that is actually on top at its own centre point.
async function visibleText(page, text, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const els = await page.getByText(text, { exact: false }).all();
    for (const el of els.reverse()) {
      if (!(await el.isVisible().catch(() => false))) continue;
      await el.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
      // scrollIntoViewIfNeeded does the MINIMAL scroll, which parks the
      // element flush with the bottom edge — underneath the floating tab bar,
      // where the hit test below correctly reports it as covered. Nudge the
      // scroller until it clears that strip, the same as a user would.
      await el.evaluate((node) => {
        const BAR = 120;
        for (let i = 0; i < 4; i++) {
          const r = node.getBoundingClientRect();
          const over = r.bottom - (window.innerHeight - BAR);
          if (over <= 0) break;
          let p = node.parentElement;
          while (p && !(p.scrollHeight > p.clientHeight + 4 && p.clientHeight > 200)) p = p.parentElement;
          if (!p) break;
          p.scrollTop += over + 12;
        }
      }).catch(() => {});
      const onTop = await el.evaluate((node) => {
        const r = node.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const cx = Math.min(Math.max(r.x + r.width / 2, 0), window.innerWidth - 1);
        const cy = Math.min(Math.max(r.y + r.height / 2, 0), window.innerHeight - 1);
        const top = document.elementFromPoint(cx, cy);
        return !!top && (node.contains(top) || top.contains(node));
      }).catch(() => false);
      if (onTop) return el;
    }
    await page.waitForTimeout(200);
  }
  return null;
}

async function tapText(page, text, settle = 800) {
  console.log(`  → tap ${text}`);
  const el = await visibleText(page, text);
  if (!el) throw new Error(`not found: ${text}`);
  await el.scrollIntoViewIfNeeded();
  await el.click({ timeout: 8000 });
  await page.waitForTimeout(settle);
}

/** Several mounted screens can share a label; click the one on top. */
async function tapLabel(page, label, settle = 900) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    for (const el of await page.getByLabel(label).all()) {
      // Same two-step as visibleText: a control can sit off screen or under
      // the floating tab bar, and neither means it is missing.
      await el.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
      await el.evaluate((node) => {
        const BAR = 120;
        for (let i = 0; i < 4; i++) {
          const r = node.getBoundingClientRect();
          const over = r.bottom - (window.innerHeight - BAR);
          if (over <= 0) break;
          let p = node.parentElement;
          while (p && !(p.scrollHeight > p.clientHeight + 4 && p.clientHeight > 200)) p = p.parentElement;
          if (!p) break;
          p.scrollTop += over + 12;
        }
      }).catch(() => {});
      const onTop = await el.evaluate((node) => {
        const r = node.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!top && (node.contains(top) || top.contains(node));
      }).catch(() => false);
      if (onTop) {
        await el.click({ timeout: 8000 });
        await page.waitForTimeout(settle);
        return;
      }
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`no visible control labelled: ${label}`);
}

const tapTab = async (page, label) => {
  await page.getByRole('tab', { name: label }).click({ timeout: 8000 });
  await page.waitForTimeout(1300);
};

/** Escape a visible period label for a role-name regular expression. */
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Home's redesigned period control is labelled with the period itself, while
 * the other tabs use the longer "Reporting period: … Tap to change" label.
 * Match both accessible contracts exactly and let Playwright perform the real
 * pointer-actionability checks instead of duplicating them with a brittle
 * centre-point hit test.
 */
async function tapPeriod(page, periodText, settle = 1200) {
  const name = new RegExp(
    `^(?:Reporting period:\\s*)?${escapeRegex(periodText)}(?:\\.\\s*Tap to change\\.)?$`,
    'i',
  );
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    for (const button of (await page.getByRole('button', { name }).all()).reverse()) {
      if (!(await button.isVisible().catch(() => false))) continue;
      await button.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
      try {
        await button.click({ timeout: 3000 });
        await page.waitForTimeout(settle);
        return;
      } catch {}
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`no active reporting-period control for: ${periodText}`);
}

// The dev container ships Chromium at a fixed path; a CI runner installs it
// where Playwright expects. Use the pinned path only when it is really there,
// or the suite fails to launch on whichever of the two it was not written on.
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(
  existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {},
);
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2200);

const shortMonth = (offset = 0) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return d.toLocaleString('en', { month: 'short' });
};
const monthPeriod = (offset = 0) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return d.toLocaleString('en', { month: 'short', year: 'numeric' });
};

// 1) Home opens on the current month, live.
ok('home: period pill shows the current month', !!(await visibleText(page, shortMonth())));
ok('home: the spending summary is visible', await page.getByTestId('home-spending-total').isVisible());

// 2) The pill opens the sheet; Last month re-scopes the hero.
await tapPeriod(page, monthPeriod(), 1200);
ok('sheet: reporting period opens', !!(await visibleText(page, /^Reporting period$/i)));
await tapText(page, /^Last month$/i, 1200);
ok('home: past month applies beside the hero',
  !!(await visibleText(page, monthPeriod(-1))) && await page.getByTestId('home-spending-total').isVisible());

// 3) Spending follows the same period.
await tapTab(page, 'Spending');
ok('spending: pill carries the selected month', !!(await visibleText(page, shortMonth(-1))));
ok('spending: summary rail states total spending', !!(await visibleText(page, /^Total spent$/i)));

// 4) All time from Spending's own pill.
await tapPeriod(page, monthPeriod(-1), 1200);
await tapText(page, /^All time$/i, 1200);
ok('spending: all time applies', !!(await visibleText(page, 'All time')));

// 5) Year mode from Home, and Activity inherits the scope.
await tapTab(page, 'Home');
await tapPeriod(page, 'All time', 1200);
await tapText(page, /^This year$/i, 1200);
const yr = String(new Date().getFullYear());
ok('home: year mode applies', !!(await visibleText(page, yr)));

await tapText(page, 'All activity', 1600);
ok('activity: header carries the selected scope', !!(await visibleText(page, `· ${yr}`)));
await tapLabel(page, 'Back', 1200);

// 6) The spending-first Home opens the category breakdown; its activity view
// preserves the same period and provides an explicitly expense-filtered ledger.
await page.getByTestId('home-spending-total').click();
await page.waitForTimeout(1000);
ok('Home spending opens the category breakdown', /\/flow/.test(page.url()));
await tapText(page, /^Activity$/, 800);
await tapText(page, 'View all spending', 1600);
ok('activity: the spending drill-down arrives pre-filtered', /type=expense/.test(page.url()) &&
  !!(await visibleText(page, /\d+ filters?/i)));
await tapLabel(page, 'Back', 1200);

// 7) Persistence: a reload must not show onboarding again (chunked storage).
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
ok('persistence: reload keeps onboarded state',
  !(await visibleText(page, 'Your bank already texts you', 2500)));
ok('persistence: reload keeps the ledger', await page.getByTestId('home-spending-total').isVisible());

ok('no page errors', errors.length === 0);
if (errors.length) console.log(errors.slice(0, 3));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
