/**
 * Navigation suite: press every pressable, on every screen, and check that
 * something actually happens.
 *
 * The app's most expensive defect has twice been a tap that leads nowhere. A
 * budget warning's "See the breakdown" pointed at `/budgets`, which has never
 * been a route; then most of Flow's "Worth knowing" cards pointed at `/stats`
 * and `/budgets`. Both shipped because nothing in the test suites ever pressed
 * anything — the smoke suite reads screens, it does not operate them.
 *
 * The second shape of the same bug is subtler and has no error screen at all:
 * a card whose destination is the screen it is already drawn on. `router.push
 * ('/flow')` from Flow is a no-op, so the row has a chevron, the row is
 * pressable, and pressing it does nothing forever. That is what this suite
 * calls a dead control, and it is checked here for every insight.
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = 'http://localhost:8126';
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

/* ── Reaching things ──────────────────────────────────────────────────── */

/**
 * Bring an element on screen and say whether it is the thing that would
 * actually receive the tap.
 *
 * Every screen stays mounted behind the current one, so a locator match is
 * routinely a control on a screen the user cannot see. Two steps, the same
 * pair the smoke suite learned: the browser's minimal scroll, then a nudge
 * past the floating tab bar — which the minimal scroll parks things under and
 * which the hit test below then correctly calls covered.
 */
const bringForward = async (el) => {
  await el.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
  await el.evaluate((node) => {
    const BAR = 130;
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
  return el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const cx = Math.min(Math.max(r.x + r.width / 2, 1), window.innerWidth - 2);
    const cy = Math.min(Math.max(r.y + r.height / 2, 1), window.innerHeight - 2);
    const top = document.elementFromPoint(cx, cy);
    return !!top && (node.contains(top) || top.contains(node));
  }).catch(() => false);
};

/** Click whatever carries this aria-label or exact text and is on top. */
async function tapKey(page, key, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const els = [
      ...(await page.getByLabel(key, { exact: true }).all()),
      ...(await page.getByText(key, { exact: true }).all()),
    ];
    for (const el of els) {
      if (await bringForward(el)) {
        await el.click({ timeout: 5000 });
        return true;
      }
    }
    await page.waitForTimeout(200);
  }
  return false;
}

const tapTab = async (page, name) => {
  await page.getByRole('tab', { name }).click({ timeout: 8000 });
  await page.waitForTimeout(1200);
};

/**
 * Every pressable on the screen that is on top right now, keyed so it can be
 * found again after the screen is re-entered.
 *
 * `[tabindex]` is how react-native-web emits a Pressable; role is only set
 * where the screen bothered with accessibilityRole, so it cannot be the
 * selector on its own.
 */
const visibleControls = (page) => page.evaluate(() => {
  const out = [];
  const sel = '[tabindex], [role="button"], [role="tab"], [role="switch"], [role="link"]';
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) continue;
    if (r.bottom < 0 || r.top > window.innerHeight) continue;
    const cx = Math.min(Math.max(r.x + r.width / 2, 1), window.innerWidth - 2);
    const cy = Math.min(Math.max(r.y + r.height / 2, 1), window.innerHeight - 2);
    const top = document.elementFromPoint(cx, cy);
    if (!(top && (el.contains(top) || top.contains(el)))) continue;
    const key = el.getAttribute('aria-label') ?? (el.textContent || '').trim();
    if (key) out.push(key.slice(0, 60));
  }
  return out;
});

/** The topmost scroller — the one belonging to the screen on top. */
const scrollTo = (page, y) => page.evaluate((v) => {
  const scr = [...document.querySelectorAll('div')].filter(
    (d) => d.scrollHeight > d.clientHeight + 20 && d.clientHeight > 250
      && d.getBoundingClientRect().width > 200,
  );
  const el = scr[scr.length - 1];
  if (el) el.scrollTop = v;
}, y);

/** Every pressable on a screen, including the ones below the fold. */
async function everyControl(page) {
  const seen = new Set();
  for (let y = 0; y <= 2400; y += 500) {
    await scrollTo(page, y);
    await page.waitForTimeout(220);
    for (const k of await visibleControls(page)) seen.add(k);
  }
  await scrollTo(page, 0);
  await page.waitForTimeout(150);
  return [...seen];
}

const url = (page) => page.evaluate(() => location.pathname + location.search);
const bodyText = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());

/** "AED 1,234" / "1,234" → 1234. NaN when there is no figure in the string. */
const money = (s) => {
  const m = String(s).replace(/[^\d.,-]/g, '').replace(/,/g, '');
  return m === '' || m === '-' ? NaN : Number(m);
};

/** Every leaf text run that is actually painted, with its box. */
const paintedText = (page) => page.evaluate(() => {
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('div,span')) {
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
      clipped: el.scrollWidth > el.clientWidth + 1 || /…/.test(s),
    });
  }
  return out;
});

/* ── The ledger these screens are read against ────────────────────────── */

/**
 * The sample ledger has no subscriptions, no card due and no bill, so three of
 * the four tabs are half empty on it and the controls that only exist next to
 * data — "Mark paid", "Remind me", the subscription sheet — cannot be pressed
 * at all. Write a ledger that has one of everything.
 *
 * Six grocery merchants on purpose: the limit sheet lists the top four under a
 * total that covers all of them, so a truncation with no remainder shows up
 * only once there are more merchants than rows.
 */
const seed = (page) => page.evaluate(() => {
  const K = 'wafra/state/v1';
  const meta = JSON.parse(localStorage.getItem(K));
  const chunks = Number(meta.txChunks) || 0;
  const txs = [];
  for (let i = 0; i < chunks; i++) {
    txs.push(...JSON.parse(localStorage.getItem(`${K}:tx:${i}`) || '[]'));
    localStorage.removeItem(`${K}:tx:${i}`);
  }
  const iso = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
  let n = 0;
  const add = (title, category, amountFils, daysAgo, accountId = 'acc-card') =>
    txs.push({ id: `nav-${n++}`, type: 'expense', amountFils, category, accountId, title, date: iso(daysAgo), source: 'sms' });
  for (const d of [4, 34, 64, 94]) add('Netflix', 'entertainment', 5550, d);
  for (const d of [9, 39, 69, 99]) add('Spotify', 'entertainment', 2250, d);
  for (const [d, a] of [[6, 28000], [36, 45000], [66, 31000], [96, 39000]]) add('SEWA Bill', 'utilities', a, d, 'acc-enbd');
  for (const d of [11, 41, 71, 101]) add('Al Adil Trading', 'groceries', 30000, d);
  for (const [m, a] of [['Union Coop', 9100], ['Choithrams', 7300], ['Viva Supermarket', 5100]]) {
    add(m, 'groceries', a, 3);
  }
  delete meta.txChunks;
  meta.transactions = txs;
  meta.cardDues = [{
    id: 'nav-due', accountId: 'acc-card',
    dueDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
    totalDueFils: 497500, minDueFils: 25000, paidFils: 0,
  }];
  meta.bills = [{
    id: 'nav-bill', title: 'Salik top-up', amountFils: 10000, category: 'transport',
    dueDay: 12, accountId: 'acc-enbd', paidMonths: [],
  }];
  localStorage.setItem(K, JSON.stringify(meta));
});

/* ── Launch ───────────────────────────────────────────────────────────── */

const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(
  existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {},
);
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, colorScheme: 'dark' });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const s = m.text();
  // Chromium's own network noise is not the app's problem.
  if (/Failed to load resource|favicon/i.test(s)) return;
  errors.push(s);
});

const reload = async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1700);
};

await reload();
const start = await page.getByText('Start with sample data').first();
if (await start.count()) { await start.click().catch(() => {}); await page.waitForTimeout(2400); }
await seed(page);
await reload();

/* ── 1. Press everything ──────────────────────────────────────────────── */

/**
 * Press every pressable on a screen and report the ones that fail.
 *
 * "Fails" is deliberately narrow — Unmatched Route, a blank screen, or a
 * thrown error — because plenty of controls legitimately paint nothing new:
 * a segment that is already selected, a toggle whose platform support is
 * native-only. The dead-destination check that catches the actual bug class
 * is a separate, sharper assertion further down.
 */
async function pressEverything(name, enter, { skip = [] } = {}) {
  await enter();
  const controls = await everyControl(page);
  const dead = [];
  const unreachable = [];
  for (const key of controls) {
    if (skip.includes(key) || ['Home', 'Flow', 'Bills', 'Wallet'].includes(key)) continue;
    await enter();
    errors.length = 0;
    let clicked = false;
    try { clicked = await tapKey(page, key, 3500); } catch { clicked = false; }
    if (!clicked) { unreachable.push(key); continue; }
    await page.waitForTimeout(950);
    const after = await bodyText(page);
    if (/Unmatched Route|This screen does not exist|Sorry, this page/i.test(after)) dead.push(`${key} → Unmatched Route`);
    else if (after.length < 40) dead.push(`${key} → blank`);
    else if (errors.length) dead.push(`${key} → ${errors[0].slice(0, 90)}`);
  }
  ok(`${name}: every pressable leads somewhere (${controls.length} controls, ${unreachable.length} off-screen)`,
    dead.length === 0, dead.join(' | '));
  return { controls, dead, unreachable };
}

const home = async () => { await reload(); };
const flow = async () => { await reload(); await tapTab(page, 'Flow'); };
const bills = async () => { await reload(); await tapTab(page, 'Bills'); };
const wallet = async () => { await reload(); await tapTab(page, 'Wallet'); };

await pressEverything('home', home);
await pressEverything('flow', flow);
await pressEverything('bills · subs', bills);
await pressEverything('bills · cards', async () => { await bills(); await tapKey(page, 'Cards 1'); await page.waitForTimeout(700); });
await pressEverything('bills · fixed', async () => { await bills(); await tapKey(page, 'Fixed 5'); await page.waitForTimeout(700); });
await pressEverything('wallet', wallet);
await pressEverything('transactions', async () => { await home(); await tapKey(page, 'See all'); await page.waitForTimeout(1200); });
await pressEverything('settings', async () => { await home(); await tapKey(page, 'Settings'); await page.waitForTimeout(1300); },
  // Erasing the ledger and cycling the language both make every later
  // control on the screen a different control; they get their own passes.
  { skip: ['Erase everything on this phone', 'Language', 'Country pack'] });
await pressEverything('cards', async () => { await wallet(); await tapKey(page, 'See all'); await page.waitForTimeout(1300); });
await pressEverything('pro', async () => {
  await home(); await tapKey(page, 'Settings'); await page.waitForTimeout(1200);
  await tapKey(page, 'Wafra Pro'); await page.waitForTimeout(1300);
});
await pressEverything('accuracy', async () => {
  await home(); await tapKey(page, 'Settings'); await page.waitForTimeout(1200);
  await tapKey(page, 'Improve accuracy'); await page.waitForTimeout(1300);
});
await pressEverything('import', async () => {
  await wallet(); await tapKey(page, 'Paste a bank message'); await page.waitForTimeout(1400);
});
await pressEverything('add entry', async () => {
  await home(); await tapKey(page, 'Add an entry'); await page.waitForTimeout(1400);
});

/* ── 2. Nothing offers a destination it is already at ─────────────────── */

/**
 * Flow's "Worth knowing" cards.
 *
 * Each draws a chevron and is a Pressable, so each promises a screen. Seven of
 * twelve insight kinds used to promise `/stats` or `/budgets`, which have never
 * been routes; that was fixed by pointing them all at `/flow` — the screen the
 * section is drawn on, where `router.push` is a no-op. The chevron survived
 * both bugs. This presses every card there is and requires the route to move.
 */
{
  await flow();
  const cards = await page.evaluate(() => {
    let head = [...document.querySelectorAll('div,span')].find(
      (e) => !e.children.length && /^worth knowing$/i.test((e.textContent || '').trim()),
    );
    while (head && !head.querySelector?.('[role="button"][aria-label]')) head = head.parentElement;
    return head ? [...head.querySelectorAll('[role="button"][aria-label]')].map((n) => n.getAttribute('aria-label')) : [];
  });
  ok(`flow: "Worth knowing" has cards to press (${cards.length})`, cards.length >= 3);
  const inert = [];
  for (const label of cards) {
    await flow();
    const before = await url(page);
    if (!(await tapKey(page, label, 4000))) { inert.push(`${label} (unreachable)`); continue; }
    await page.waitForTimeout(1100);
    const after = await url(page);
    if (after === before) inert.push(label);
  }
  ok(`flow: every "Worth knowing" card goes somewhere other than Flow (${cards.length} pressed)`,
    inert.length === 0, inert.join(' | '));
}

/**
 * Home carries one insight with its own "See the breakdown" button. It shares
 * the destination with the cards above, so it fails and passes with them —
 * check it separately anyway, because the button is the one control on Home
 * whose entire purpose is to go somewhere.
 */
{
  await home();
  const before = await url(page);
  ok('home: the insight offers a breakdown', await tapKey(page, 'See the breakdown', 4000));
  await page.waitForTimeout(1100);
  ok(`home: "See the breakdown" leaves Home (${before} → ${await url(page)})`, (await url(page)) !== before);
}

/* ── 3. Named destinations land where they say ────────────────────────── */

const goesTo = async (name, enter, key, pattern) => {
  await enter();
  const reached = await tapKey(page, key, 5000);
  await page.waitForTimeout(1200);
  const at = await url(page);
  ok(`${name} (${key} → ${at})`, reached && pattern.test(at), reached ? at : 'not reachable');
};

await goesTo('home: the In cell opens income', home, 'In', /type=income/);
await goesTo('home: the Out cell opens spending', home, 'Out', /type=expense/);
await goesTo('home: "All activity" opens the ledger', home, 'ALL ACTIVITY', /^\/transactions/);
await goesTo('home: the search action opens the ledger', home, 'See all', /^\/transactions/);
await goesTo('home: the sliders action opens settings', home, 'Settings', /^\/settings/);
await goesTo('home: the add button opens the entry form', home, 'Add an entry', /^\/add-transaction/);
await goesTo('flow: a composition row drills into its category', flow, 'Groceries, see entries', /category=groceries/);
await goesTo('flow: the pooled slice hands over every category it stands for', flow, '5 more, see entries', /category=[a-z]+%2C/);
await goesTo('wallet: "See all" opens the cards screen', wallet, 'See all', /^\/cards/);
await goesTo('wallet: the scan block opens the import screen', wallet, 'Paste a bank message', /^\/import-sms/);
await goesTo('settings: Wafra Pro opens the paywall',
  async () => { await home(); await tapKey(page, 'Settings'); await page.waitForTimeout(1200); },
  'Wafra Pro', /^\/pro/);
await goesTo('settings: "Improve accuracy" opens the report screen',
  async () => { await home(); await tapKey(page, 'Settings'); await page.waitForTimeout(1200); },
  'Improve accuracy', /^\/accuracy/);

/* ── 4. Back gets you out of every pushed screen ──────────────────────── */

for (const [name, enter] of [
  ['transactions', async () => { await home(); await tapKey(page, 'See all'); }],
  ['settings', async () => { await home(); await tapKey(page, 'Settings'); }],
  ['add-transaction', async () => { await home(); await tapKey(page, 'Add an entry'); }],
  ['cards', async () => { await wallet(); await tapKey(page, 'See all'); }],
  ['import-sms', async () => { await wallet(); await tapKey(page, 'Paste a bank message'); }],
]) {
  await enter();
  await page.waitForTimeout(1300);
  const pushed = await url(page);
  const left = (await tapKey(page, 'Back', 3000)) || (await tapKey(page, 'Close', 3000));
  await page.waitForTimeout(1100);
  ok(`${name}: Back returns to the tab you came from (${pushed} → ${await url(page)})`,
    left && (await url(page)) !== pushed);
}

/* ── 5. Totals equal the rows printed under them ──────────────────────── */

/**
 * Home's hero is three figures that have to be one arithmetic. It once read
 * "63,039 in, 8,815 out, saved 54,223" — a subtraction off by one, in 40px
 * type, because each cell rounded itself and the net was measured separately.
 */
{
  await home();
  const t = await paintedText(page);
  const hero = t.find((x) => /^[\d,]+$/.test(x.t) && x.h > 34);
  const inCell = t.find((x) => /^in$/i.test(x.t));
  const outCell = t.find((x) => /^out$/i.test(x.t));
  const figureUnder = (label) => {
    if (!label) return NaN;
    const c = t.filter((x) => /^[\d,]+$/.test(x.t) && x.y > label.y && x.y < label.y + 60
      && Math.abs(x.x - label.x) < 40);
    return c.length ? money(c[0].t) : NaN;
  };
  const inFils = figureUnder(inCell), outFils = figureUnder(outCell);
  ok(`home: the hero equals In minus Out (${inFils} − ${outFils} = ${money(hero?.t ?? '')})`,
    !!hero && Number.isFinite(inFils) && Number.isFinite(outFils)
      && money(hero.t) === inFils - outFils);
}

/**
 * The limit sheet lists WHERE IT WENT over the four biggest merchants under a
 * "Spent this month" figure that covers every one of them. With more than four
 * merchants in the category the column cannot add up unless the remainder is
 * stated — the same defect the Home "leaving soon" list had.
 */
{
  await flow();
  ok('flow: a limit row opens its sheet', await tapKey(page, 'Groceries limit', 5000));
  await page.waitForTimeout(1200);
  const t = await paintedText(page);
  const spentLabel = t.find((x) => /^spent this month$/i.test(x.t));
  const spent = spentLabel && t.find((x) => Math.abs(x.y - spentLabel.y) < 14 && /^AED [\d,]+$/.test(x.t));
  const where = t.find((x) => /^where it went$/i.test(x.t));
  const rows = where ? t.filter((x) => x.y > where.y && /^AED [\d,]+$/.test(x.t)).map((x) => money(x.t)) : [];
  const sum = rows.reduce((a, b) => a + b, 0);
  ok(`flow: the limit sheet's merchant list adds up to what was spent (${spent?.t} vs ${sum} over ${rows.length} rows)`,
    !!spent && rows.length > 0 && money(spent.t) === sum);
}

/**
 * Wallet's net worth over its account rows. Only bank-quoted balances count,
 * and an account with none prints an em dash rather than a zero — so the sum
 * is over the rows that carry a figure, and the total must equal exactly that.
 */
{
  await wallet();
  const t = await paintedText(page);
  const label = t.find((x) => /^net worth$/i.test(x.t));
  const worth = label && t.find((x) => x.y > label.y && x.y < label.y + 70 && /^[\d,]+$/.test(x.t) && x.h > 30);
  const accounts = t.find((x) => /^accounts$/i.test(x.t));
  const next = t.find((x) => x.y > (accounts?.y ?? 0) + 20 && /^(inactive|savings goals)/i.test(x.t));
  const rows = accounts
    ? t.filter((x) => x.y > accounts.y && x.y < (next?.y ?? Infinity) && /^AED [\d,]+$/.test(x.t)).map((x) => money(x.t))
    : [];
  const sum = rows.reduce((a, b) => a + b, 0);
  ok(`wallet: net worth equals the account balances printed below it (${money(worth?.t ?? '')} vs ${sum} over ${rows.length} rows)`,
    !!worth && rows.length > 0 && money(worth.t) === sum);
}

/* ── 6. Arabic ────────────────────────────────────────────────────────── */

/**
 * The language row cycles English and Arabic. On the phone the flip needs a
 * restart for RTL, but the STRINGS change immediately on every platform — so
 * a screen that stayed English after the switch means a hard-coded label, and
 * a run that overflows its box means the Arabic face is not being measured.
 */
{
  await home();
  await tapKey(page, 'Settings');
  await page.waitForTimeout(1300);
  ok('settings: the language row is there', await tapKey(page, 'Language', 5000));
  await page.waitForTimeout(1200);
  await tapKey(page, 'Back');
  await page.waitForTimeout(1400);
  const arabic = /[؀-ۿ]/;
  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((n) => (n.textContent || '').trim()));
  ok(`home: the tab bar is in Arabic (${tabs.join(' ')})`, tabs.length === 4 && tabs.every((x) => arabic.test(x)));
  const t = await paintedText(page);
  ok('home: nothing is clipped in Arabic', t.filter((x) => x.clipped).length === 0,
    t.filter((x) => x.clipped).map((x) => x.t).join(' | '));
  for (const [name, tab] of [['flow', 'التدفق'], ['bills', 'الفواتير'], ['wallet', 'المحفظة']]) {
    await page.getByRole('tab', { name: tab }).click({ timeout: 8000 });
    await page.waitForTimeout(1300);
    const painted = await paintedText(page);
    ok(`${name}: renders in Arabic without clipping`,
      painted.length > 6 && painted.filter((x) => x.clipped).length === 0,
      painted.filter((x) => x.clipped).map((x) => x.t).join(' | '));
  }
  // Back to English so the state left behind is the one every other suite
  // assumes.
  await tapTab(page, 'الرئيسية');
  await tapKey(page, 'الإعدادات');
  await page.waitForTimeout(1300);
  await tapKey(page, 'اللغة');
  await page.waitForTimeout(1200);
}

ok('no page errors across the sweep', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
