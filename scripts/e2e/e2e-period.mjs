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
await page.waitForTimeout(1500);
const sample = await visibleText(page, 'Start with sample data', 6000);
if (sample) { await sample.click(); await page.waitForTimeout(2200); }

const shortMonth = (offset = 0) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return d.toLocaleString('en', { month: 'short' });
};

// 1) Home opens on the current month, live.
ok('home: period pill shows the current month', !!(await visibleText(page, shortMonth())));
ok('home: hero reads live', !!(await visibleText(page, /SAVED SO FAR|OVERSPENT SO FAR/i)));

// 2) The pill opens the sheet; Last month re-scopes the hero.
await tapLabel(page, /Reporting period/, 1200);
ok('sheet: reporting period opens', !!(await visibleText(page, 'REPORTING PERIOD')));
await tapText(page, 'LAST MONTH', 1200);
ok('home: past month names itself in the hero', !!(await visibleText(page, `in ${shortMonth(-1)}`)));

// 3) Flow follows the same period.
await tapTab(page, 'Flow');
ok('flow: pill carries the selected month', !!(await visibleText(page, shortMonth(-1))));
ok('flow: subtitle states the out total', !!(await visibleText(page, /^Out /)));

// 4) All time from Flow's own pill.
await tapLabel(page, /Reporting period/, 1200);
await tapText(page, 'ALL TIME', 1200);
ok('flow: all time applies', !!(await visibleText(page, 'All time')));

// 5) Year mode from Home, and Activity inherits the scope.
await tapTab(page, 'Home');
await tapLabel(page, /Reporting period/, 1200);
await tapText(page, 'THIS YEAR', 1200);
const yr = String(new Date().getFullYear());
ok('home: year mode applies', !!(await visibleText(page, yr)));

await tapLabel(page, 'See all', 1600);
ok('activity: header carries the selected scope', !!(await visibleText(page, `· ${yr}`)));
await tapLabel(page, 'Back', 1200);

// 6) Home's Out cell deep-links to Activity, pre-filtered to spending. Caps
// are a CSS transform, so the DOM text is still "Out".
await tapText(page, /^Out$/, 1600);
ok('activity: Out deep-link arrives pre-filtered', !!(await visibleText(page, /\d+ filters?/i)));
await tapLabel(page, 'Back', 1200);

// 7) Persistence: a reload must not show onboarding again (chunked storage).
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
ok('persistence: reload keeps onboarded state',
  !(await visibleText(page, 'Your bank already texts you', 2500)));
ok('persistence: reload keeps the ledger', !!(await visibleText(page, /LEAVING SOON|TODAY/i)));

ok('no page errors', errors.length === 0);
if (errors.length) console.log(errors.slice(0, 3));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
