// Smoke suite: visits every screen of the four-tab IA, opens each detail
// sheet, exercises the import paste flow, the paywall, founder unlock, and
// trial expiry.
import { chromium } from 'playwright';

const BASE = 'http://localhost:8126';
let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}`); }
};

// The router keeps hidden screens mounted, so hit-test: only return an element
// that is actually on top at its own centre point.
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

async function tapText(page, text, settle = 900) {
  const el = await visibleText(page, text);
  if (!el) throw new Error(`not found: ${text}`);
  await el.scrollIntoViewIfNeeded();
  await el.click({ timeout: 8000 });
  await page.waitForTimeout(settle);
}

/**
 * Buttons carry accessibilityLabel, which RN-web emits as aria-label. Every
 * screen stays mounted, so several can share one label ("Back" exists on each
 * pushed screen) — click the one that is actually on top.
 */
async function tapLabel(page, label, settle = 900) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    for (const el of await page.getByLabel(label).all()) {
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

/**
 * Every screen stays mounted, so matching on tab text would also match the
 * screen title behind it. The tab bar's Pressables carry role="tab".
 */
const tapTab = async (page, label) => {
  await page.getByRole('tab', { name: label }).click({ timeout: 8000 });
  await page.waitForTimeout(1400);
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, colorScheme: 'dark' });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
ok('onboarding leads with the headline', !!(await visibleText(page, 'Your bank already texts you')));
const sample = await visibleText(page, 'Start with sample data', 6000);
if (sample) { await sample.click(); await page.waitForTimeout(2200); }

// ── Home ──────────────────────────────────────────────────────────────
ok('home hero states in minus out', !!(await visibleText(page, /IN MINUS OUT/i)));
ok('home splits in and out', !!(await visibleText(page, /^OUT$/i)));
ok('home lists what leaves next', !!(await visibleText(page, /LEAVING IN \d+ DAYS/i)));
ok('home links to all activity', !!(await visibleText(page, /ALL ACTIVITY/i)));

// Entry detail sheet
await tapText(page, 'Amazon.ae', 1200);
ok('entry sheet opens on a row', !!(await visibleText(page, /ENTRY DETAIL/i)));
ok('entry sheet names the account', !!(await visibleText(page, 'FAB Credit Card')));
await tapText(page, 'EDIT ENTRY', 1000);
ok('entry sheet switches to editing', !!(await visibleText(page, /DESCRIPTION/i)));
await tapLabel(page, 'Close', 900);

// ── Flow ──────────────────────────────────────────────────────────────
await tapTab(page, 'Flow');
ok('flow titles the screen', !!(await visibleText(page, /^Flow$/)));
ok('flow shows limits', !!(await visibleText(page, /^LIMITS$/i)));
ok('flow shows the six-month pair chart', !!(await visibleText(page, /IN VS OUT/i)));

// Limit editor sheet. The same category name also appears in the composition
// list above, which deep-links to Activity — target the limit row by label.
await tapLabel(page, 'Groceries limit', 1300);
ok('limit sheet opens', !!(await visibleText(page, /MONTHLY LIMIT/i)));
ok('limit sheet lists where it went', !!(await visibleText(page, /WHERE IT WENT/i)));
await tapLabel(page, 'Close', 900);

// ── Bills ─────────────────────────────────────────────────────────────
await tapTab(page, 'Bills');
ok('bills segments subs, cards and fixed', !!(await visibleText(page, /Subs \d/i)));
await tapText(page, /Cards \d/i, 1000);
ok('bills cards segment renders', !!(await visibleText(page, /Pay by|No card payments due/i)));
await tapText(page, /Fixed \d/i, 1000);
ok('bills fixed segment renders',
  !!(await visibleText(page, /Utilities & fixed bills|No utilities yet|Loans/i)));

// ── Wallet ────────────────────────────────────────────────────────────
await tapTab(page, 'Wallet');
ok('wallet shows net worth', !!(await visibleText(page, /NET WORTH/i)));
ok('wallet lists accounts', !!(await visibleText(page, /^ACCOUNTS$/i)));
ok('wallet lists goals', !!(await visibleText(page, /SAVINGS GOALS/i)));

// ── Activity ──────────────────────────────────────────────────────────
await tapTab(page, 'Home');
await tapLabel(page, 'See all', 1600);
ok('activity opens scoped to the period', !!(await visibleText(page, /\d+ transactions? ·/i)));
ok('activity offers a search field', !!(await page.getByPlaceholder(/Search merchants/i).count()));
await tapLabel(page, 'Back', 1200);

// ── Settings ──────────────────────────────────────────────────────────
await tapLabel(page, 'Settings', 1400);
ok('settings leads with Pro', !!(await visibleText(page, 'Wafra Pro')));
ok('settings shows the trial state', !!(await visibleText(page, /Free trial · \d day/)));
ok('settings pictures the money month', !!(await visibleText(page, /Starts on the/)));
ok('settings groups privacy', !!(await visibleText(page, 'App lock')));

// ── Import ────────────────────────────────────────────────────────────
await tapText(page, 'Improve accuracy', 1200);
ok('accuracy screen opens', !!(await visibleText(page, /reads clean|could not be fully read/)));
await tapLabel(page, 'Back', 1200);

// Reached in-app from Wallet: a cold load of an exported route hits the
// known expo-router hydration bailout (see scripts/e2e/README.md).
await tapLabel(page, 'Back', 1200);
await tapTab(page, 'Wallet');
await tapText(page, /Paste a bank message|Inbox scanned/, 1600);
ok('import page loads', !!(await visibleText(page, 'PARSE PASTED TEXT')));
await tapText(page, 'TRY SAMPLE', 1200);
ok('paste parse reports what matched', !!(await visibleText(page, /MATCHED/i)));
const fileBtn = await visibleText(page, /FILE \d+ ENTR/i);
ok('import offers to file the plan', !!fileBtn);

// ── Paywall ───────────────────────────────────────────────────────────
await tapLabel(page, 'Back', 1200);
await tapTab(page, 'Home');
await tapLabel(page, 'Settings', 1400);
await tapText(page, 'Wafra Pro', 1400);
ok('paywall renders plans', !!(await visibleText(page, /GET WAFRA PRO/i)));
ok('paywall shows the trial chip', !!(await visibleText(page, /FREE TRIAL ACTIVE/i)));

// ── Founder unlock: 7 taps on the mark in Settings' About block ────────
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await tapLabel(page, 'Settings', 1400);
const about = await visibleText(page, 'Know where it goes');
if (about) await about.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
const mark = page.getByLabel('Wafra', { exact: true }).last();
for (let i = 0; i < 7; i++) {
  await mark.click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(140);
}
await page.waitForTimeout(800);
const proStored = await page.evaluate(
  () => JSON.parse(localStorage.getItem('wafra/state/v1') || '{}').pro === true,
);
ok('founder unlock activates Pro', proStored);

// ── Trial expiry: rewind the clock, drop pro, reload → hard paywall ────
await page.evaluate(() => {
  const meta = JSON.parse(localStorage.getItem('wafra/state/v1'));
  meta.trialStartTs = Date.now() - 10 * 86400000;
  meta.pro = false;
  localStorage.setItem('wafra/state/v1', JSON.stringify(meta));
});
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
ok('expired trial pauses tracking on home', !!(await visibleText(page, 'Trial ended · tracking paused')));

ok('no page errors', errors.length === 0);
if (errors.length) console.log(errors.slice(0, 3));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
