// Smoke suite: visits every screen of the four-tab IA, opens each detail
// sheet, exercises the import paste flow, the paywall, hidden-unlock defenses, and
// trial expiry.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:8126';
const OUT = process.env.OUT;
if (OUT) mkdirSync(OUT, { recursive: true });
const results = [];
let pass = 0, fail = 0;
const ok = (name, cond) => {
  results.push({ name, passed: !!cond });
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
      // Bring it on screen first. This helper used to test only what already
      // happened to be in the viewport, so any section that moved below the
      // fold — as Flow's chart did when it gained value labels — read as
      // missing. Two steps: the browser's minimal scroll, then a nudge past
      // the floating tab bar, which the minimal scroll parks the element
      // underneath and which the hit test below then correctly calls covered.
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

/**
 * Every screen stays mounted, so matching on tab text would also match the
 * screen title behind it. The tab bar's Pressables carry role="tab".
 */
const tapTab = async (page, label) => {
  await page.getByRole('tab', { name: label }).click({ timeout: 8000 });
  await page.waitForTimeout(1400);
};

/* ── Reading the screen, not just probing it ───────────────────────────
 *
 * Everything below exists because the bugs that reach users here are
 * arithmetic and layout: a heading that does not equal the rows printed
 * under it, a figure ellipsised to "1…", a glyph the same colour as the
 * tile it sits on. Presence assertions cannot see any of those, so these
 * helpers read the painted screen — text, position and colour — and the
 * assertions further down do sums on what they find.
 */

/** Every leaf text run that is actually painted, with its box and colour. */
const paintedText = (page) => page.evaluate(() => {
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('div,span,h1,h2,h3,h4,h5,h6')) {
    if (el.children.length) continue;
    const s = (el.textContent || '').trim();
    if (!s) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.bottom < 0 || r.top > window.innerHeight) continue;
    const cx = Math.min(Math.max(r.x + r.width / 2, 0), window.innerWidth - 1);
    const cy = Math.min(Math.max(r.y + r.height / 2, 0), window.innerHeight - 1);
    const top = document.elementFromPoint(cx, cy);
    if (!(top && (el.contains(top) || top.contains(el)))) continue;
    const key = `${Math.round(r.y)}|${Math.round(r.x)}|${s}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      t: s,
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      // numberOfLines truncation shows as an ellipsis; overflow shows as a
      // scrollWidth wider than the box. Both mean a figure the user cannot read.
      clipped: el.scrollWidth > el.clientWidth + 1 || /…/.test(s),
    });
  }
  return out;
});

/**
 * Text drawn on top of other text, within one screen.
 *
 * Scoped to the subtree that holds `anchor`, because every screen stays
 * mounted and laid out: comparing across the whole document would call the
 * Home hero a collision with the Bills header. It cannot use `paintedText`
 * either — the run that LOSES the collision is by definition not on top, so
 * a hit test would filter away exactly the evidence.
 */
const overlappingText = (page, anchor) => page.evaluate((anchorText) => {
  let el = [...document.querySelectorAll('div,span')].find(
    (e) => !e.children.length && (e.textContent || '').trim().startsWith(anchorText),
  );
  while (el && !(el.getBoundingClientRect().height > 300)) el = el.parentElement;
  if (!el) return [];
  const b = [];
  for (const n of el.querySelectorAll('div,span')) {
    if (n.children.length) continue;
    const s = (n.textContent || '').trim();
    if (!s) continue;
    const r = n.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > window.innerHeight) continue;
    b.push({ s, x: r.x, y: r.y, w: r.width, h: r.height });
  }
  const hits = [];
  for (let i = 0; i < b.length; i++) {
    for (let j = i + 1; j < b.length; j++) {
      const ox = Math.min(b[i].x + b[i].w, b[j].x + b[j].w) - Math.max(b[i].x, b[j].x);
      const oy = Math.min(b[i].y + b[i].h, b[j].y + b[j].h) - Math.max(b[i].y, b[j].y);
      if (ox > 8 && oy > 8) hits.push([b[i].s.slice(0, 28), b[j].s.slice(0, 28)]);
    }
  }
  return hits;
}, anchor);

/** "AED 1,234" / "1,234" → 1234. NaN when there is no figure in the string. */
const money = (s) => {
  const m = String(s).replace(/[^\d.,-]/g, '').replace(/,/g, '');
  return m === '' || m === '-' ? NaN : Number(m);
};

/** The scheme the app is actually painting in, read off the page fill. */
const paintedScheme = (page) => page.evaluate(() => {
  let n = document.elementFromPoint(6, 300), bg = '';
  while (n) {
    const c = getComputedStyle(n).backgroundColor;
    if (c && c !== 'rgba(0, 0, 0, 0)') { bg = c; break; }
    n = n.parentElement;
  }
  const [r, g, b] = (bg.match(/\d+/g) || [0, 0, 0]).map(Number);
  return (r + g + b) / 3 > 128 ? 'light' : 'dark';
});

// The dev container ships Chromium at a fixed path; a CI runner installs it
// where Playwright expects. Use the pinned path only when it is really there,
// or the suite fails to launch on whichever of the two it was not written on.
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(
  existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {},
);
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, colorScheme: 'dark' });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
let aborted = null;

try {
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2200);

// ── Home ──────────────────────────────────────────────────────────────
ok('home hero focuses on spending instead of a total balance',
  await page.getByTestId('home-spending-total').isVisible() &&
  await page.getByText('Recorded balances', { exact: true }).count() === 0);
ok('home splits income and spending', await page.getByTestId('home-spending-total').count() === 1 && await page.getByTestId('home-income-summary').count() === 1);
ok('home lists due or upcoming obligations', !!(await visibleText(page, /^(Due & overdue|Due payments|Upcoming|Coming up)$/i)));
ok('home links to all activity', !!(await visibleText(page, /ALL ACTIVITY/i)));

// Ledger & Light splits due/upcoming widgets and exposes the row's text as
// its accessible name. The old journal-payments aria-label no longer exists.
// Keep every painted title/date/amount, then reconcile these exact figures and
// dates against the independent Bills agenda presentation below.
const homePayments = await page.evaluate(() => {
  const now = new Date();
  return [...document.querySelectorAll('[data-testid="home-widget-due"], [data-testid="home-widget-upcoming"]')]
    .flatMap(section => [...section.querySelectorAll('[role="button"]')])
    .filter(node => (node.textContent || '').trim()) // exclude empty section chevrons
    .map(node => {
      const leaves = [...node.querySelectorAll('div,span')].filter(n => !n.children.length && n.textContent.trim());
      return { fields: leaves.map(n => n.textContent.trim()),
        clipped: leaves.some(n => n.scrollWidth > n.clientWidth + 1 || /…/.test(n.textContent)),
        today: [now.getFullYear(), now.getMonth(), now.getDate()] };
    });
});
const paymentDayOffset = (phrase) => {
  if (/^today$/i.test(phrase)) return 0;
  if (/^tomorrow$/i.test(phrase)) return 1;
  const future = phrase.match(/^in (\d+) days?$/i);
  if (future) return Number(future[1]);
  const late = phrase.match(/^(\d+) days? late$/i);
  return late ? -Number(late[1]) : NaN;
};
ok(`home: every payment exposes a readable date and exact amount (${homePayments.length} rows)`,
  homePayments.length > 0 && homePayments.every(({ fields, clipped }) =>
    fields.length === 3 && fields[0] && Number.isFinite(paymentDayOffset(fields[1])) &&
    /^[\d,]+(?:\.\d{1,2})?$/.test(fields[2]) && !clipped));

// Entry detail sheet.
//
// Whichever merchant Home happens to be showing. The seed is generated
// relative to today, so a hard-coded name ("Amazon.ae") passes until the date
// rolls and the top six rows shift — a suite failure that says nothing about
// the app. Read the first row and its account off the screen instead.
const firstEntry = await page.evaluate(() => {
  const section = document.querySelector('[data-testid="home-widget-activity"]');
  const candidates = [...(section?.querySelectorAll('[data-testid="transaction-details-link"]') ?? [])];
  // Exercise actual nonzero cents: rounding 251.36 must fail this test, while
  // an integer-only specimen cannot detect that regression.
  const row = candidates.find(node => /, (?:plus|minus) [\d,]+\.(?!00\b)\d{2} AED$/i.test(node.getAttribute('aria-label') || ''));
  if (!row) return null;
  const label = row.getAttribute('aria-label') || '';
  const parts = label.split(', ');
  return { label, title: parts[0] || '', account: parts[2] || '' };
});
ok('home lists an entry to open', !!firstEntry?.title && !!firstEntry?.label);
if (!firstEntry) throw new Error('Home rendered no accessible transaction Details row with nonzero cents');
await tapLabel(page, firstEntry.label, 1200);
ok('entry sheet opens on a row', !!(await visibleText(page, /TRANSACTION DETAILS/i)));
ok(`entry sheet names the account (${firstEntry.account})`,
  !!(await visibleText(page, firstEntry.account)));
await tapText(page, 'Edit transaction', 1000);
ok('entry sheet switches to editing', !!(await visibleText(page, /DESCRIPTION/i)));

/**
 * Editing an entry must not move its amount.
 *
 * The form used to be seeded from the rounded DISPLAY string, so opening AED
 * 76.99 and changing only the category saved 77 — and stamped userEdited, so
 * no re-parse could heal it. Change the category and nothing else, save,
 * reopen, and the amount has to come back byte-identical.
 */
{
  const amountValue = () => page.getByTestId('entry-detail-sheet').getByRole('textbox', { name: 'Amount', exact: true }).inputValue();
  const before = await amountValue();
  ok(`edit form seeds the amount with its fils (${before})`, !!before && /\.\d\d$/.test(before));
  const chosenCategory = firstEntry.label.includes(', Charity,') ? 'Government' : 'Charity';
  await tapText(page, new RegExp(`^${chosenCategory}$`), 500);
  await tapText(page, /^SAVE CHANGES$/i, 500);
  // Saving a changed category asks whether to remember a merchant rule. Close
  // that real question before reopening the transaction. Never swallow a
  // failed save or navigate through the separate merchant-summary target.
  if (await visibleText(page, /^Remember for /i, 2500)) await tapLabel(page, 'Close', 500);
  await page.getByTestId('entry-detail-sheet').waitFor({ state: 'hidden' });
  const freshLabel = await page.getByTestId('home-widget-activity').getByTestId('transaction-details-link')
    .evaluateAll((nodes, title) => nodes.map(n => n.getAttribute('aria-label')).find(label => label.startsWith(`${title}, `)), firstEntry.title);
  ok('category edit saved and remains attached to the same transaction',
    !!freshLabel && freshLabel.includes(`, ${chosenCategory},`) && freshLabel.includes(`, ${firstEntry.account},`));
  if (!freshLabel) throw new Error('Edited transaction lost its Home Details control');
  await tapLabel(page, freshLabel, 500);
  await tapText(page, 'Edit transaction', 500);
  const after = await amountValue();
  ok(`editing only the category leaves the amount alone (${before} → ${after})`, !!before && before === after);
}
await tapLabel(page, 'Close', 900);

// ── Flow ──────────────────────────────────────────────────────────────
await tapTab(page, 'Spending');
ok('spending titles the screen', !!(await visibleText(page, /^Spending$/)));
// Read the labelled figure before scrolling down to its composition rows.
// The amount itself is an accessible Money group rather than one leaf text
// node, so resolve it inside the same summary cell as the label instead of
// depending on how React Native Web happens to split currency and digits.
const flowTotalHeading = (await page.getByTestId('spending-categories').innerText())
  .match(/\bAED\s*[\d,]+(?:\.\d+)?/)?.[0] ?? '';
ok('Spending presents a readable total before category rows', Number.isFinite(money(flowTotalHeading)));
// Categories own budgets now. Keep exact money and drill-down checks.
ok('Spending shows category limits with their spending', !!(await visibleText(page,/Categories with limits/i)));
{
  const rows=await page.locator('[data-testid="spending-categories"] [role="button"][aria-label]').evaluateAll(nodes=>nodes
    .map(n=>({label:n.getAttribute('aria-label'),text:n.textContent}))
    .filter(n=>/\. AED /.test(n.label)));
  const amounts=rows.map(n=>money(n.label.match(/\. (AED [\d,]+(?:\.\d+)?)/)?.[1]||''));
  ok(`Spending category rows reconcile to exact total (${rows.length} rows)`,rows.length>=5 && amounts.every(Number.isFinite) &&
    Math.round(amounts.reduce((a,b)=>a+b,0)*100)===Math.round(money(flowTotalHeading)*100));
  const row=rows[0];ok('Spending offers a category to inspect',!!row);
  if(row){
    const want=money(row.label.match(/\. (AED [\d,]+(?:\.\d+)?)/)?.[1]||'');
    await tapLabel(page,row.label);await tapText(page,'View activity',1500);
    ok('Category detail opens a scoped expense ledger', /category=/.test(page.url())&&/type=expense/.test(page.url()));
    const aggregate = page.getByTestId('transactions-net-total');
    let total;
    if (await aggregate.count()) {
      total = await aggregate.innerText();
    } else {
      // The single-result screen intentionally omits two identical totals.
      // Validate its one actual transaction instead of requiring a duplicate
      // summary to exist. Split/excluded contributions retain an aggregate.
      const summary = await page.getByTestId('transactions-summary').innerText();
      // Expo keeps the previous Home's recent-transaction buttons mounted.
      // Count only the row that is actually on top in the active ledger.
      const rows = await page.getByTestId('transaction-details-link').evaluateAll(nodes => nodes.filter(node => {
        const r = node.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return top && (node === top || node.contains(top));
      }).map(node => node.getAttribute('aria-label')));
      ok('a category without an aggregate contains exactly one transaction',
        /^1 transaction(?:\s|·|$)/.test(summary) && rows.length === 1);
      const label = rows[0];
      total = label?.match(/(?:plus|minus)\s+([\d,]+(?:\.\d+)?)\s+AED$/)?.[1] ?? '';
    }
    ok('Category ledger total equals the category amount',Math.round(Math.abs(money(total))*100)===Math.round(want*100));
    await tapLabel(page,'Back',1200);await tapTab(page,'Spending');
  }
}
await tapText(page,'Trends',800);
ok('Trends owns six-month cashflow',!!(await visibleText(page,/Income & spending/i)));
const months=await page.locator('[data-testid="spending-trends"] [role="button"][aria-label]').evaluateAll(nodes=>nodes
  .map(n=>({label:n.getAttribute('aria-label'),selected:n.getAttribute('aria-selected'),text:n.textContent}))
  .filter(n=>/Income:.*Spending:|No recorded activity/.test(n.label)));
ok('All six months expose readable cashflow or no-data',months.length===6);
ok('Exactly one month is selected',months.filter(m=>m.selected==='true').length===1);
ok('Trends includes merchant and change analysis',!!(await visibleText(page,'Top merchants'))&&!!(await visibleText(page,'What changed')));
await tapText(page,'Categories',700);
await tapLabel(page,/^Transport\. AED /,800);
await tapText(page,'Edit limits',800);
ok('Category limit editor remains reachable',!!(await visibleText(page,/MONTHLY LIMIT/i)));
ok('Limit editor preserves its merchant detail',!!(await visibleText(page,/WHERE IT WENT/i)));
// Opening the limit editor already closes the category detail sheet.
await tapLabel(page,'Close',500);

// ── Bills ─────────────────────────────────────────────────────────────
await tapTab(page, 'Bills');
ok('Bills has Upcoming and All views',!!(await visibleText(page,'Upcoming'))&&!!(await visibleText(page,'All')));
const agenda=page.locator('[data-testid="payment-agenda"]');
await agenda.waitFor({state:'visible'});
ok('Agenda states that recording a payment does not move money',/Recording a payment does not move money/.test(await agenda.innerText()));
await tapText(page,'All',600);
const rows=await agenda.locator('[role="button"][aria-label]').evaluateAll(nodes=>nodes.map(n=>({label:n.getAttribute('aria-label'),text:n.textContent})));
ok('Chronological agenda contains named obligations',rows.length>0 && rows.every(n=>/AED [\d,]+/.test(n.label)));
ok('Agenda amounts are exactly visible in their own rows',rows.every(n=>{
 const amount=n.label.match(/AED ([\d,]+(?:\.\d+)?)/)?.[1];
 return amount && n.text.replace(/\s/g,'').includes(amount);
}));
for (const payment of homePayments) {
  const [title, relativeDate, paintedAmount] = payment.fields;
  const offset = paymentDayOffset(relativeDate);
  const date = new Date(...payment.today);
  date.setDate(date.getDate() + offset);
  const agendaDate = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow'
    : `${date.getDate()} ${date.toLocaleString('en', { month: 'short' })}`;
  const matching = rows.filter(row => row.label.startsWith(`${title}. ${agendaDate}. `));
  ok(`Home payment agrees with Bills date and exact amount (${title}, ${relativeDate}, ${paintedAmount})`,
    Number.isFinite(offset) && matching.length > 0 && matching.some(row => {
      const amount = row.label.match(/AED ([\d,]+(?:\.\d+)?)/)?.[1];
      return amount && Math.round(money(amount) * 100) === Math.round(money(paintedAmount) * 100) &&
        row.text.replace(/\s/g, '').includes(amount);
    }));
}
// Monthly-equivalent headings and three buckets are intentionally retired.
// Verify estimates are identified and preserve the actual charge-history sum below.
ok('Predicted recurring charges remain identified as estimates',rows.some(n=>/Estimated/.test(n.label)));

// The subscription sheet prints "Total paid" above a scrollable history. Sum
// the complete scroll region, not only the rows currently inside the viewport:
// a correct lifetime total must include the rows the user can reach by scrolling.
await tapText(page, /^Netflix$/, 1400);
{
  const t = await paintedText(page);
  const label = t.find((x) => /^total paid$/i.test(x.t));
  const total = label && t.find((x) => x.y > label.y && x.y < label.y + 40 && /^AED/.test(x.t));
  const chargeTexts = await page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="subscription-history-scroll"]');
    if (!scroller) return [];
    return [...scroller.querySelectorAll('div,span')]
      .filter((node) => node.children.length === 0)
      .map((node) => (node.textContent || '').trim())
      .filter((text) => /^AED [\d,]+(?:\.\d+)?$/.test(text));
  });
  const charges = chargeTexts.map((text) => money(text));
  const sumMinor = charges.reduce((a, b) => a + Math.round(b * 100), 0);
  const sum = sumMinor / 100;
  ok(`bills: the subscription sheet's total equals its history rows (${total?.t} vs ${sum})`,
    !!total && charges.length > 0 && Math.round(money(total.t) * 100) === sumMinor);
}
await tapLabel(page, 'Close', 900);

// ── Wallet ────────────────────────────────────────────────────────────
await tapTab(page, 'Accounts');
ok('wallet shows the recorded-balance snapshot', !!(await visibleText(page, /^Recorded balances$/i)));
ok('Accounts separates bank and credit accounts', !!(await visibleText(page, /^Bank accounts$/i)) && !!(await visibleText(page, /^Credit cards$/i)));
ok('wallet lists goals', !!(await visibleText(page, /SAVINGS GOALS/i)));

// ── Activity ──────────────────────────────────────────────────────────
await tapTab(page, 'Home');
await tapText(page, 'All activity', 1600);
ok('activity opens scoped to the period', !!(await visibleText(page, /\d+ transactions? ·/i)));
// Keep the visible wording concise without making search inaccessible.
const activitySearch = page.getByPlaceholder('Merchant or category', { exact: true });
ok('activity offers a visible and editable search field',
  await activitySearch.count() === 1 && await activitySearch.isVisible() && await activitySearch.isEditable());
ok('activity search retains its full accessible name',
  await activitySearch.getAttribute('aria-label') === 'Search merchants or categories');
await tapLabel(page, 'Back', 1200);

// ── Settings ──────────────────────────────────────────────────────────
await tapLabel(page, 'Settings', 1400);
{
 // Settings now presents task sections in one scrollable screen. Read each
 // actual heading sequentially: parallel scroll attempts race one another.
 const sections=[];
 for (const title of ['Money','Imports','Notifications','Appearance & language','Privacy','Data','Support & feedback']) {
   sections.push(!!(await visibleText(page,new RegExp(`^${title}$`,'i'))));
 }
 ok('Settings exposes its money, import, appearance, privacy, data and support sections',sections.every(Boolean));
}
ok('Settings keeps Pro and trial status reachable',!!(await visibleText(page,'Wafra Pro'))&&!!(await visibleText(page,/Free trial · \d day/)));
ok('Support keeps feedback reachable',!!(await visibleText(page,'Send feedback')));
ok('Privacy retains app lock',!!(await visibleText(page,'App lock')));

/**
 * Appearance. The context is `colorScheme: 'dark'`, so picking Light has to
 * turn the WHOLE app over — every colour flows through `useTheme`, which
 * flows through `useColorScheme`, so a screen that stayed dark would mean
 * one of them is reading the OS directly.
 */
{
  ok('settings offers an Appearance & language section', !!(await visibleText(page, /^Appearance & language$/i)));
  for (const opt of ['System', 'Light', 'Dark']) {
    ok(`appearance offers ${opt}`, !!(await visibleText(page, opt)));
  }
  const acrossTheApp = async (want) => {
    const seen = [await paintedScheme(page)];
    if (OUT) await page.screenshot({ path: path.join(OUT, `${want}-settings.png`), fullPage: true });
    await tapLabel(page, 'Back', 1300);
    seen.push(await paintedScheme(page));
    if (OUT) await page.screenshot({ path: path.join(OUT, `${want}-home.png`), fullPage: true });
    for (const t of ['Spending', 'Bills', 'Accounts']) {
      await tapTab(page, t);
      seen.push(await paintedScheme(page));
      if (OUT) await page.screenshot({ path: path.join(OUT, `${want}-${t.toLowerCase()}.png`), fullPage: true });
    }
    await tapTab(page, 'Home');
    await tapLabel(page, 'Settings', 1500);
    return seen.every((s) => s === want);
  };
  await tapText(page, 'Light', 1200);
  ok('appearance: Light turns the whole app over while the OS is dark', await acrossTheApp('light'));
  await tapText(page, 'Dark', 1200);
  ok('appearance: Dark pins it back', await acrossTheApp('dark'));
  await tapText(page, 'System', 1200);
  ok('appearance: System follows the OS again', await acrossTheApp('dark'));
  ok('appearance: System says it is following the phone',
    !!(await visibleText(page, /Following your phone/)));
}

// ── Import ────────────────────────────────────────────────────────────
await tapText(page, 'Improve accuracy', 1200);
ok('accuracy screen opens', !!(await visibleText(page, /reads clean|could not be fully read/)));
await tapLabel(page, 'Back', 1200);

// Reached in-app from Wallet: a cold load of an exported route hits the
// known expo-router hydration bailout (see scripts/e2e/README.md).
await tapLabel(page, 'Back', 1200);
await tapTab(page, 'Accounts');
await tapText(page, /Paste a bank message|Inbox scanned/, 1600);
ok('import page loads', !!(await visibleText(page, /^Parse pasted text$/i)));
await tapText(page, /^Try sample$/i, 1200);
ok('paste parse reports what matched', !!(await visibleText(page, /MATCHED/i)));
const fileBtn = await visibleText(page, /FILE \d+ ENTR/i);
ok('import offers to file the plan', !!fileBtn);
// The parse result must land BELOW the box it was parsed from, not on top of
// it. Presence assertions read straight through text drawn over other text.
{
  const hits = await overlappingText(page, 'Paste one or more');
  ok(`import: the parse result does not overlap the paste box (${hits.length} collisions)`,
    hits.length === 0);
  if (hits.length) console.log(hits.slice(0, 4));
}

// ── Paywall ───────────────────────────────────────────────────────────
await tapLabel(page, 'Back', 1200);
await tapTab(page, 'Home');
await tapLabel(page, 'Settings', 1400);
await page.setViewportSize({ width: 402, height: 874 });
await tapText(page, 'Wafra Pro', 1400);
{
  const hits = await overlappingText(page, 'Wafra Pro');
  ok(`paywall: purchase controls do not overlap plan content at 402×874 (${hits.length} collisions)`,
    hits.length === 0);
  if (hits.length) console.log(hits.slice(0, 4));
}
ok('paywall renders plans', !!(await visibleText(page, /GET WAFRA PRO/i)));
ok('paywall shows the remaining trial', !!(await visibleText(page, /Free trial · \d day/)));

// ── Hidden-unlock defense: repeated VERSION taps must not grant Pro ──
//
// A founder bypass previously lived behind this gesture. Keep exercising the
// exact old trigger so a future refactor cannot accidentally restore it.
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await tapLabel(page, 'Settings', 1400);
const about = await visibleText(page, 'Know where it goes');
if (about) await about.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
const mark = await visibleText(page, /^Wafra\s+\d/);
ok('the version label is exposed for the old seven-tap trigger', !!mark);
if (!mark) throw new Error('No exposed Wafra version label for hidden-unlock regression');
for (let i = 0; i < 7; i++) {
  await mark.click({ timeout: 4000 });
  await page.waitForTimeout(140);
}
await page.waitForTimeout(800);
const entitlementStored = await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('wafra/state/v1') || '{}');
  return { pro: state.pro === true, founderPro: state.founderPro === true };
});
ok('repeated version taps cannot grant Pro', !entitlementStored.pro);
ok('repeated version taps cannot grant founder Pro', !entitlementStored.founderPro);

// ── Trial expiry: rewind the clock, drop pro, reload → hard paywall ────
await page.evaluate(() => {
  const meta = JSON.parse(localStorage.getItem('wafra/state/v1'));
  meta.trialStartTs = Date.now() - 10 * 86400000;
  meta.pro = false;
  localStorage.setItem('wafra/state/v1', JSON.stringify(meta));
});
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
// Web correctly says phone capture is unsupported instead of pretending to be
// Android/iOS. Verify expiry on the actual cross-platform entitlement surface.
await tapLabel(page, 'Settings', 1200);
await tapText(page, 'Wafra Pro', 1200);
ok('expired trial shows the paused-capture paywall', !!(await visibleText(
  page,
  'Automatic bank-alert capture is paused. Your ledger and manual entries still work.',
)));

ok('no page errors', errors.length === 0);
if (errors.length) console.log(errors.slice(0, 3));

} catch (error) {
  aborted = error.stack ?? String(error);
  console.error(aborted);
  if (OUT) await page.screenshot({ path: path.join(OUT, 'FAILED.png'), fullPage: true }).catch(() => {});
} finally {
  if (OUT) writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({
    base: BASE, generatedAt: new Date().toISOString(), browser: browser.version(),
    pass, fail, aborted, errors, results,
  }, null, 2));
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed${aborted ? ', suite aborted' : ''}`);
process.exitCode = fail || aborted ? 1 : 0;
