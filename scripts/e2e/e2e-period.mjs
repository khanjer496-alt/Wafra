// Focused E2E: global period selector reflects on Home, Analytics, Transactions, Budgets.
import { chromium } from 'playwright';

const BASE = 'http://localhost:8126';
let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}`); }
};

// Router keeps hidden screens mounted; hit-test so we only return an element
// that is actually on top at its own center point.
async function visibleText(page, text, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const els = await page.getByText(text, { exact: false }).all();
    for (const el of els.reverse()) {
      if (!(await el.isVisible().catch(() => false))) continue;
      await el.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
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

async function tapText(page, text) {
  console.log(`  → tap ${text}`);
  const el = await visibleText(page, text);
  if (!el) throw new Error(`not found: ${text}`);
  await el.scrollIntoViewIfNeeded();
  await el.click({ timeout: 8000 });
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'networkidle' });

// Onboarding: welcome → (choose) → sample data
const getStarted = await visibleText(page, 'Get started', 4000);
if (getStarted) {
  await getStarted.click();
  await page.waitForTimeout(500);
  const sample = await visibleText(page, 'Explore with sample data', 4000);
  if (sample) {
    await sample.scrollIntoViewIfNeeded();
    await sample.click();
  }
  await page.waitForTimeout(1000);
}

// 1) Home shows the period chip with the current month and live balance (no end-of caption)
const nowLabel = new Date().toLocaleString('en', { month: 'short' });
ok('home: period chip shows current month', !!(await visibleText(page, nowLabel)));
ok('home: hero shows live net caption', !!(await visibleText(page, 'so far this month')));

// 2) Open the period sheet from Home, choose Last month
await tapText(page, nowLabel);
ok('sheet: reporting period sheet opens', !!(await visibleText(page, 'Reporting period')));
await tapText(page, 'Last month');
await page.waitForTimeout(600);
const prevShort = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toLocaleString('en', { month: 'short' }); })();
ok('home: past month hero caption names the month', !!(await visibleText(page, `in ${prevShort}`)));

// 3) Analytics follows the same period
await tapText(page, 'Insights');
await page.waitForTimeout(600);
const prev = new Date(); prev.setDate(1); prev.setMonth(prev.getMonth() - 1);
const prevLabel = prev.toLocaleString('en', { month: 'long' });
ok('stats: title shows selected past month', !!(await visibleText(page, prevLabel)));
ok('stats: Spent label replaces Projected', !!(await visibleText(page, 'Spent')));

// 4) Switch to All time from Analytics title
await tapText(page, 'Tap to change period');
await tapText(page, 'All time');
await page.waitForTimeout(600);
ok('stats: all-time title', !!(await visibleText(page, 'All time')));

// 5) Budgets falls back to current month in non-month mode
await tapText(page, 'Budgets');
await page.waitForTimeout(600);
const thisMonthLong = new Date().toLocaleString('en', { month: 'long' });
ok('budgets: non-month period falls back to current month', !!(await visibleText(page, thisMonthLong)));

// 6) Year mode via sheet on Home + transactions default scope
await tapText(page, 'Home');
await page.waitForTimeout(400);
await tapText(page, 'Good ');  // greeting sits inside the period-chip pressable
await tapText(page, 'This year');
await page.waitForTimeout(600);
const yr = String(new Date().getFullYear());
ok('home: year chip active', !!(await visibleText(page, yr)));

await tapText(page, 'See all');
await page.waitForTimeout(800);
ok('transactions: summary shows selected year scope', !!(await visibleText(page, `· ${yr}`)));
await page.goBack();
await page.waitForTimeout(600);

// 7) Home In tap-through opens transactions filtered to income
await tapText(page, 'In AED');
await page.waitForTimeout(800);
ok('transactions: In deep-link applies a filter', !!(await visibleText(page, '1 filter')));
await page.goBack();
await page.waitForTimeout(600);

// 8) Cashflow bar tap jumps the period to that month
await tapText(page, 'Insights');
await page.waitForTimeout(600);
const twoBack = new Date(); twoBack.setDate(1); twoBack.setMonth(twoBack.getMonth() - 2);
const twoBackShort = twoBack.toLocaleString('en', { month: 'short' });
const twoBackLong = twoBack.toLocaleString('en', { month: 'long' });
const cashflow = await visibleText(page, 'Cashflow');
if (cashflow) await cashflow.scrollIntoViewIfNeeded();
await tapText(page, twoBackShort);
await page.waitForTimeout(700);
ok('stats: tapping a cashflow bar opens that month', !!(await visibleText(page, twoBackLong)));

// 9) Persistence: reloading must NOT show onboarding again (chunked storage)
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
ok('persistence: reload keeps onboarded state', !(await visibleText(page, 'Get started', 2500)));
ok('persistence: reload keeps data (hero caption present)', !!(await visibleText(page, 'so far this month')));

ok('no page errors', errors.length === 0);
if (errors.length) console.log(errors.slice(0, 3));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
