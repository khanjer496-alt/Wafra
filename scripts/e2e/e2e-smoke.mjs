// Smoke suite: visits EVERY screen, exercises the import page paste flow,
// the subscription detail sheet, the paywall, founder unlock, and trial expiry.
import { chromium } from 'playwright';

const BASE = 'http://localhost:8126';
let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}`); }
};

async function visibleText(page, text, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const els = await page.getByText(text).all();
    for (const el of els) {
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
  const el = await visibleText(page, text);
  if (!el) throw new Error(`not found: ${text}`);
  await el.scrollIntoViewIfNeeded();
  await el.click({ timeout: 8000 });
}
const tapTab = async (page, label) => {
  const el = page.getByText(label, { exact: true }).last();
  await el.click();
  await page.waitForTimeout(1200);
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, colorScheme: 'dark' });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'networkidle' });
const gs = await visibleText(page, 'Get started', 5000);
if (gs) {
  await gs.click();
  await page.waitForTimeout(600);
  const sample = await visibleText(page, 'Explore with sample data', 5000);
  if (sample) { await sample.scrollIntoViewIfNeeded(); await sample.click(); }
  await page.waitForTimeout(1500);
}
ok('home loads after onboarding', !!(await visibleText(page, 'Good ')));

// Bills tab + subscription detail sheet
await tapTab(page, 'Bills');
ok('bills tab shows subscriptions segment', !!(await visibleText(page, /Subscriptions \(/)));

// 3-tab layout: cards due and utilities get their own segments
await page.getByText(/Cards due \(/).last().click();
await page.waitForTimeout(700);
ok('cards-due segment renders', !!(await visibleText(page, /Pay by|No card payments due/)));
await page.getByText(/Utilities \(/).last().click();
await page.waitForTimeout(700);
ok('utilities segment renders',
  !!(await visibleText(page, /Utilities & fixed bills|No utilities yet|Long-press a reminder/)));
await page.getByText(/Subscriptions \(/).last().click();
await page.waitForTimeout(500);

const subRow = page.getByText(/monthly · last/).first();
if (await subRow.count()) {
  await subRow.click();
  await page.waitForTimeout(900);
  ok('subscription detail sheet opens', !!(await visibleText(page, 'Subscribed for')));
  ok('detail sheet shows paying card', !!(await visibleText(page, 'Paid with')));
  await tapText(page, '✕').catch(() => page.mouse.click(206, 200));
  await page.waitForTimeout(600);
} else { ok('subscription detail sheet opens', false); ok('detail sheet shows paying card', false); }

// Wallet → Cards page
await tapTab(page, 'Wallet');
ok('wallet shows net worth', !!(await visibleText(page, 'Net worth')));
await tapText(page, 'See all');
await page.waitForTimeout(1200);
ok('cards page renders a card tile', !!(await visibleText(page, /CREDIT|DEBIT/)));
await page.goBack();
await page.waitForTimeout(900);

// Settings via the gear button (top-right, left of the + button).
// RN-web Pressables carry no role, so target the two 42px header buttons
// by geometry and click the leftmost (gear).
const gearPos = await page.evaluate(() => {
  const tops = [];
  document.querySelectorAll('div').forEach((d) => {
    const r = d.getBoundingClientRect();
    if (r.y > 15 && r.y < 130 && r.x > 220 && r.width > 30 && r.width < 60 && r.height > 30 && r.height < 60) {
      tops.push({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    }
  });
  tops.sort((a, z) => a.x - z.x);
  return tops[0] ?? null;
});
if (gearPos) { await page.mouse.click(gearPos.x, gearPos.y); await page.waitForTimeout(1100); }
ok('settings opens from wallet gear', !!(await visibleText(page, 'Wafra Pro')));
ok('settings shows free trial state', !!(await visibleText(page, /Free trial · \d day/)));

// Import page: paste flow uses the modern plan pipeline
await tapText(page, 'Import from bank SMS');
await page.waitForTimeout(1100);
ok('import page loads', !!(await visibleText(page, 'Parse pasted text')));
await tapText(page, 'Try sample');
await page.waitForTimeout(900);
ok('paste parse shows plan summary', !!(await visibleText(page, /new transactions?/)));
const importBtn = await visibleText(page, /Import \d+ transaction/);
ok('import button offers the plan', !!importBtn);
if (importBtn) { await importBtn.click(); await page.waitForTimeout(1000); }

// Paywall
// Import's router.back() lands back on Settings — paywall is one tap away.
await tapText(page, 'Wafra Pro');
await page.waitForTimeout(1000);
ok('paywall renders plans', !!(await visibleText(page, 'Get Wafra Pro')));
ok('paywall shows trial chip', !!(await visibleText(page, 'FREE TRIAL ACTIVE')));
await page.goBack();
await page.waitForTimeout(800);

// Founder unlock: 7 taps on the settings logo
const about = await page.getByText('Know where it goes. Watch it grow.', { exact: false }).first();
await about.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
// The tappable logo is the ~36px svg above the about text.
const logoPos = await page.evaluate(() => {
  const svgs = [...document.querySelectorAll('svg')]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width >= 30 && r.width <= 60 && r.y > 0 && r.y < window.innerHeight);
  const r = svgs[svgs.length - 1];
  return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
});
for (let i = 0; i < 7; i++) {
  await page.mouse.click(logoPos.x, logoPos.y);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(700);
const proStored = await page.evaluate(
  () => JSON.parse(localStorage.getItem('wafra/state/v1') || '{}').pro === true,
);
ok('founder unlock activates Pro', proStored);

// Trial expiry: rewind the trial clock, drop pro, reload → hard paywall banner
await page.evaluate(() => {
  const raw = localStorage.getItem('wafra/state/v1');
  const meta = JSON.parse(raw);
  meta.trialStartTs = Date.now() - 10 * 86400000;
  meta.pro = false;
  localStorage.setItem('wafra/state/v1', JSON.stringify(meta));
});
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
ok('expired trial pauses tracking on home', !!(await visibleText(page, 'Trial ended · tracking paused')));

// Budgets + Insights + transactions still render
await tapTab(page, 'Budgets');
ok('budgets renders', !!(await visibleText(page, /Budget|budget/)));
await tapTab(page, 'Insights');
ok('insights renders', (await page.getByText('Cashflow · 6 months').count()) > 0);

ok('no page errors', errors.length === 0);
if (errors.length) console.log(errors.slice(0, 3));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
