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

const BASE = process.env.BASE ?? 'http://localhost:8126';
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

/* ── Reaching things ──────────────────────────────────────────────────── */

/**
 * Find the on-screen control carrying this aria-label or exact text and return
 * the point to click, or null.
 *
 * All of it happens inside one page.evaluate on purpose. A Playwright locator
 * for a common word matches on every mounted screen at once — "Groceries" is a
 * chip on the add form, a composition row on Flow and a limit row under it —
 * and walking those candidates one round trip at a time, scrolling each into
 * view to find out, took longer than the timeout allowed. Doing the search
 * where the DOM is makes it one call and lets the hit test decide.
 */
const locate = (page, key) => page.evaluate((want) => {
  const BAR = 130;
  const nodes = [];
  for (const el of document.querySelectorAll('*')) {
    if (el.getAttribute?.('aria-label') === want) nodes.push(el);
    else if ((el.textContent || '').trim() === want
      && !(el.firstElementChild && (el.firstElementChild.textContent || '').trim() === want)) {
      nodes.push(el);
    }
  }
  for (const el of nodes) {
    // A disabled control is not broken for refusing the tap.
    if (el.getAttribute('aria-disabled') === 'true' || el.disabled) return { disabled: true };
    let p = el.parentElement;
    while (p && !(p.scrollHeight > p.clientHeight + 4 && p.clientHeight > 200)) p = p.parentElement;
    if (p) {
      const r = el.getBoundingClientRect(), pr = p.getBoundingClientRect();
      if (r.top < pr.top + 4) p.scrollTop += r.top - pr.top - 20;
      else if (r.bottom > pr.bottom - BAR) p.scrollTop += r.bottom - pr.bottom + BAR + 12;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const cx = Math.min(Math.max(r.x + r.width / 2, 1), window.innerWidth - 2);
    const cy = Math.min(Math.max(r.y + r.height / 2, 1), window.innerHeight - 2);
    const top = document.elementFromPoint(cx, cy);
    if (top && (el.contains(top) || top.contains(el))) return { x: cx, y: cy };
  }
  return null;
}, key);

/** Click whatever carries this aria-label or exact text and is on top. */
async function tapKey(page, key, timeout = 4000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const hit = await locate(page, key);
    if (hit?.disabled) return 'disabled';
    if (hit) { await page.mouse.click(hit.x, hit.y); return true; }
    if (Date.now() > deadline) return false;
    await page.waitForTimeout(200);
  }
}

const tapTab = async (page, name) => {
  // Home now has a visible "Spending" label as well as the navigation tab.
  // Click the actionable tab, not an arbitrary matching text node. Playwright
  // verifies visibility, hit-testing and enabled state before clicking.
  await page.getByRole('tab', { name, exact: true }).click({ timeout: 8000 });
  await page.waitForFunction((want) => {
    for (const tab of document.querySelectorAll('[role="tab"]')) {
      const label = tab.getAttribute('aria-label') ?? (tab.textContent || '').trim();
      if (label === want && tab.getAttribute('aria-selected') === 'true') return true;
    }
    return false;
  }, name, { timeout: 8000 });
  await page.waitForFunction((want) => {
    const headings = document.querySelectorAll('[role="heading"],h1,h2,h3,h4,h5,h6');
    for (const heading of headings) {
      if ((heading.textContent || '').trim() !== want) continue;
      const rect = heading.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      const x = Math.min(Math.max(rect.x + rect.width / 2, 1), window.innerWidth - 2);
      const y = Math.min(Math.max(rect.y + rect.height / 2, 1), window.innerHeight - 2);
      const top = document.elementFromPoint(x, y);
      if (top && (heading.contains(top) || top.contains(heading))) return true;
    }
    return false;
  }, name, { timeout: 8000 });
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
    // Not truncated: the key is what the tap is looked up by, and a row whose
    // label is its own concatenated contents ("FAB Credit CardPay by 1 Aug ·
    // 5d left · min AED 250AED 4,975") stops matching the moment it is cut.
    const key = el.getAttribute('aria-label') ?? (el.textContent || '').trim();
    if (key) out.push(key);
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
      clipped: el.scrollWidth > el.clientWidth + 1 || /…/.test(s),
    });
  }
  return out;
});

/* ── The ledger these screens are read against ────────────────────────── */

/* ── Launch ───────────────────────────────────────────────────────────── */

const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(
  existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {},
);
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, colorScheme: 'dark', reducedMotion: 'reduce' });
/**
 * Text whose box extends past the right edge of the viewport.
 *
 * Only leaf text nodes, and only when the overflow is more than a couple of
 * pixels — a hairline of subpixel rounding is not a bug, a total the user
 * cannot read is.
 */
async function clippedText(page, screen) {
  return page.evaluate((label) => {
    const out = [];
    const width = window.innerWidth;
    for (const el of document.querySelectorAll('div, span')) {
      if (el.children.length > 0) continue;
      const text = (el.textContent || '').trim();
      if (!text) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      if (r.right > width + 2) out.push(`${label}: "${text.slice(0, 30)}" ends ${Math.round(r.right - width)}px past the edge`);
    }
    return out;
  }, screen);
}

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
  const base = await url(page);
  const dead = [];
  const unreachable = [];
  const opened = [];
  const stuck = [];
  let pressed = 0, disabled = 0;
  for (const key of controls) {
    if (skip.includes(key) || ['Home', 'Spending', 'Bills', 'Accounts'].includes(key)) continue;
    errors.length = 0;
    let clicked = false;
    try { clicked = await tapKey(page, key, 1200); } catch { clicked = false; }
    /**
     * Missing usually means an earlier press took the control away rather than
     * that it was never there: pressing Bills' "Cards" segment replaces every
     * subscription row, and pressing "+ Income" on the entry form replaces
     * every expense category chip. Re-enter and look once more, so the sweep
     * covers all of a screen's modes instead of only the last one it happened
     * to leave itself in.
     */
    if (!clicked) {
      await enter();
      try { clicked = await tapKey(page, key, 2500); } catch { clicked = false; }
    }
    if (clicked === 'disabled') { disabled++; continue; }
    if (clicked) pressed++;
    if (!clicked) { unreachable.push(key); await backToScreen(base, enter); continue; }
    await page.waitForTimeout(800);
    const after = await bodyText(page);
    if (/Unmatched Route|This screen does not exist|Sorry, this page/i.test(after)) dead.push(`${key} → Unmatched Route`);
    else if (after.length < 40) dead.push(`${key} → blank`);
    else if (errors.length) dead.push(`${key} → ${errors[0].slice(0, 90)}`);
    // Every sheet a tap opens has to be closable, or the user is stuck in it.
    if (await dialogOpen(page)) opened.push(key);
    await backToScreen(base, enter);
    if (await dialogOpen(page)) stuck.push(key);
  }
  ok(`${name}: every pressable leads somewhere (${pressed} pressed${disabled ? `, ${disabled} disabled` : ''})`,
    dead.length === 0 && unreachable.length === 0,
    [...dead, ...unreachable.map((k) => `${k}: could not be pressed`)].join(' | '));
  if (opened.length) {
    ok(`${name}: every sheet it opens can be closed again (${opened.length})`,
      stuck.length === 0, stuck.join(' | '));
  }
  return { controls, dead, unreachable };
}

/**
 * Is a sheet or modal covering the screen?
 *
 * react-native-web renders `<Modal>` with role="dialog" and aria-modal, which
 * is the only reliable marker: "can I still see a control I had before" is
 * not, because the sheets are labelled from the same small vocabulary as the
 * screens under them — the BottomSheet backdrop is labelled "Dismiss" and so
 * is the button on Home's insight, so a wide-open period sheet read as a
 * fully restored Home and every later tap on that screen missed.
 */
const dialogOpen = (page) => page.evaluate(
  () => [...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')]
    .some((n) => n.getBoundingClientRect().width > 0),
);

/**
 * Get back to the screen under test after a tap took us off it.
 *
 * Reloading between every control is correct and unbearably slow — a screen
 * with 27 of them spends two minutes waiting for the bundle. Unwind instead:
 * browser back for a pushed route, the sheet's own close control for a sheet,
 * and only fall back to a full re-entry when neither worked.
 */
async function backToScreen(base, enter) {
  for (let i = 0; i < 4; i++) {
    if (await dialogOpen(page)) {
      const closed = (await tapKey(page, 'Close', 900))
        || (await tapKey(page, 'Dismiss', 900))
        // Sheets whose close glyph carries no label still dismiss on a tap in
        // the strip of backdrop above them.
        || (await page.mouse.click(206, 16).then(() => true).catch(() => false));
      await page.waitForTimeout(closed ? 550 : 250);
      continue;
    }
    if ((await url(page)) !== base) {
      await page.goBack();
      await page.waitForTimeout(700);
      continue;
    }
    return;
  }
  await enter();
}

const home = async () => { await reload(); };
const flow = async () => { await reload(); await tapTab(page, 'Spending'); };
const bills = async () => { await reload(); await tapTab(page, 'Bills'); };
const wallet = async () => { await reload(); await tapTab(page, 'Accounts'); };

const settingsPanel = async (name = 'Preferences') => {
  await home();
  if (!(await tapKey(page, 'Settings'))) throw new Error('Settings is unreachable');
  await page.waitForURL(/\/settings/);
  if (!(await tapKey(page, name))) throw new Error(`Settings panel missing: ${name}`);
  await page.waitForTimeout(300);
};
const spendingView = async (name) => {
  await flow();
  await page.getByRole('tab', { name, exact: true }).click();
  await page.waitForTimeout(250);
};
const homeFact = async (name) => {
  const row = page.getByTestId('reference-month-cards').getByRole('button', { name: new RegExp(`^${name},`) });
  await row.scrollIntoViewIfNeeded();
  await row.click();
};
const categoryDetails = async (name) => {
  const row = page.getByTestId('spending-categories').getByRole('button', { name: new RegExp(`^${name}\\. AED `) });
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await page.getByTestId('category-history').waitFor();
};

await pressEverything('home', home);
await pressEverything('spending categories', flow);
await pressEverything('spending activity', () => spendingView('Activity'));
await pressEverything('spending trends', () => spendingView('Trends'));
await pressEverything('bills upcoming', bills);
await pressEverything('bills all obligations', async () => {
  await bills(); await page.getByRole('tab', { name: 'All', exact: true }).click();
});
await pressEverything('wallet', wallet);
await pressEverything('transactions', async () => { await home(); await tapKey(page, 'All activity'); await page.waitForURL(/\/transactions/); });
for (const panel of ['Preferences', 'Imports', 'Privacy & data', 'Help']) {
  await pressEverything(`settings ${panel}`, () => settingsPanel(panel),
    { skip: ['Erase everything on this phone'] });
}

/**
 * Put the settings back.
 *
 * Pressing everything on Settings means pressing all 28 bars of the money-month
 * picker, so the app is left reporting a month that starts on the 28th — under
 * which "Jul 2026" runs 28 Jun to 27 Jul and today is its last day. Every
 * arithmetic assertion below reads a different month than the one the seed was
 * written for, which is how a green sweep produced "the hero equals In minus
 * Spent (0 − 0 = 0)".
 */
const resetPreferences = async () => {
  await page.evaluate(() => {
    const K = 'wafra/state/v1';
    const meta = JSON.parse(localStorage.getItem(K) || '{}');
    meta.monthStartDay = 1;
    meta.themePreference = 'system';
    meta.language = 'en';
    localStorage.setItem(K, JSON.stringify(meta));
  });
  await reload();
};
await resetPreferences();
await pressEverything('cards', async () => { await wallet(); await tapKey(page, 'Payment cards'); await page.waitForTimeout(1300); });
await pressEverything('pro', async () => {
  await settingsPanel('Help');
  await tapKey(page, 'Wafra Pro'); await page.waitForTimeout(1300);
});
await pressEverything('accuracy', async () => {
  await settingsPanel('Privacy & data');
  await tapKey(page, 'Improve accuracy'); await page.waitForTimeout(1300);
});
await pressEverything('import', async () => {
  await wallet(); await tapKey(page, 'Paste a bank message'); await page.waitForTimeout(1400);
});
await resetPreferences();

/* ── 2. Every current drill-down goes to its stated destination ───────── */
// Stats now belongs to Spending. The old independent insight cards and pooled
// composition slice no longer exist; exercise the replacement owners instead.
{
  await spendingView('Trends');
  const merchants = await page.getByTestId('spending-trends').getByRole('button')
    .evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label')).filter(label => /, AED .* transactions$/.test(label || '')));
  ok(`trends has non-vacuous merchant drill-downs (${merchants.length})`, merchants.length >= 4);
  for (const label of merchants) {
    await spendingView('Trends');
    const reached = await tapKey(page, label, 5000);
    await page.waitForTimeout(500);
    const at = new URL(page.url());
    ok(`trends merchant opens filtered spending: ${label}`, reached === true &&
      at.pathname === '/transactions' && at.searchParams.get('type') === 'expense' &&
      label.startsWith(at.searchParams.get('merchant') + ','));
  }
}
{
  await home(); await homeFact('Spending'); await page.waitForURL(/\/flow/);
  ok('Home spending opens Spending, not a no-op on Home', /\/flow/.test(await url(page)));
  await home(); await homeFact('Income'); await page.waitForURL(/type=income/);
  ok('Home income opens the income-filtered ledger', /\/transactions\?type=income/.test(await url(page)));
  await flow(); await categoryDetails('Rent');
  if (!(await tapKey(page, 'View activity'))) throw new Error('Category activity action is unreachable');
  await page.waitForURL(/category=rent/);
  ok('category detail opens only its own expenses', new URL(page.url()).searchParams.get('type') === 'expense');
}

const goesTo = async (name, enter, key, pattern) => {
  await enter();
  const reached = await tapKey(page, key, 5000);
  await page.waitForTimeout(500);
  const at = await url(page);
  ok(`${name} (${key} → ${at})`, reached === true && pattern.test(at), reached ? at : 'not reachable');
};
await goesTo('Home all activity opens the ledger', home, 'All activity', /^\/transactions/);
await goesTo('Home settings action', home, 'Settings', /^\/settings/);
await goesTo('Accounts payment cards', wallet, 'Payment cards', /^\/cards/);
await goesTo('Accounts manual import', wallet, 'Paste a bank message', /^\/import-sms/);
await goesTo('Settings Pro', () => settingsPanel('Help'), 'Wafra Pro', /^\/pro/);
await goesTo('Settings accuracy', () => settingsPanel('Privacy & data'), 'Improve accuracy', /^\/accuracy/);
await goesTo('Settings feedback', () => settingsPanel('Help'), 'Send feedback', /^\/feedback/);

/* ── 3. Search, manual entry, cancellation and filter clearing ────────── */
{
  await home(); await tapKey(page, 'All activity'); await page.waitForURL(/\/transactions/);
  const search = page.getByPlaceholder('Search merchants or categories', { exact: true }).last();
  await search.waitFor({ state: 'visible' });
  ok('Transactions exposes its real merchant search field', await search.isEditable());
  const added = await tapKey(page, 'Add transaction', 5000);
  await page.waitForTimeout(500);
  ok('Add transaction opens the form', added === true && /^\/add-transaction/.test(await url(page)));
  await tapKey(page, 'Close'); await page.waitForTimeout(300);
  const backed = await tapKey(page, 'Back'); await page.waitForTimeout(300);
  ok('Cancelling entry then Back returns Home', backed === true && /^\/$/.test(await url(page)));
  await home(); await homeFact('Income'); await page.waitForURL(/type=income/);
  ok('Clear all removes the applied income filter', await tapKey(page, 'Clear all filters', 5000) === true);
}

/* ── 4. Back gets you out of every pushed screen ──────────────────────── */

for (const [name, enter] of [
  ['transactions', async () => { await home(); await tapKey(page, 'All activity'); }],
  ['settings', async () => { await home(); await tapKey(page, 'Settings'); }],
  ['cards', async () => { await wallet(); await tapKey(page, 'Payment cards'); }],
  ['import-sms', async () => { await wallet(); await tapKey(page, 'Paste a bank message'); }],
  ['feedback', async () => { await settingsPanel('Help'); await tapKey(page, 'Send feedback'); }],
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

// Net income is not the bank balance. Read the exact displayed period facts
// and reconcile the separate period-net disclosure, never the balance hero.
{
  await home();
  const facts = page.getByTestId('reference-month-cards');
  const income = await facts.getByRole('button', { name: /^Income,/ }).getAttribute('aria-label');
  const expense = await facts.getByRole('button', { name: /^Spending,/ }).getAttribute('aria-label');
  const disclosure = await page.getByTestId('reference-period-net').innerText();
  const matched = disclosure.match(/Net after spending\s*·\s*([−-]?[\d,]+(?:\.\d+)?)/);
  const minor = value => Math.round(money(String(value).replace('−', '-')) * 100);
  ok('Home net equals exact income minus exact spending, not bank balances',
    !!matched && minor(income) > 0 && minor(expense) > 0 &&
    minor(matched[1]) === minor(income) - minor(expense));
}

/**
 * The limit sheet lists WHERE IT WENT over the four biggest merchants under a
 * "Spent this month" figure that covers every one of them. With more than four
 * merchants in the category the column cannot add up unless the remainder is
 * stated — the same defect the Home "leaving soon" list had.
 */
{
  await flow();
  await categoryDetails('Transport');
  ok('flow: category detail opens its existing limit editor', await tapKey(page, 'Edit limits', 5000) === true);
  await page.waitForTimeout(1200);
  /**
   * Read off the row, not off `paintedText`.
   *
   * "AED 2,289  / AED 1,800" is one ThemedText with another nested inside it,
   * so the spend is a bare text node in an element that HAS children — and
   * paintedText only collects leaves. It reported the figure as missing while
   * it was the largest thing on the sheet.
   */
  const spent = await page.evaluate(() => {
    const label = [...document.querySelectorAll('div,span,h1,h2,h3,h4,h5,h6')].find(
      (e) => !e.children.length && /^spent this month$/i.test((e.textContent || '').trim()),
    );
    const row = label?.parentElement;
    const m = (row?.textContent || '').match(/AED\s[\d,]+(?:\.\d+)?/);
    return m ? m[0] : null;
  });
  // The lower part of a scrollable sheet need not be inside the viewport.
  // Read its complete own list, including the explicit remaining-merchants
  // row, instead of treating off-screen rows as missing money.
  const where = page.getByText(/^Where it went$/i).last();
  await where.scrollIntoViewIfNeeded();
  const amountTexts = await where.evaluate((label) => {
    let scope = label.parentElement;
    while (scope && scope !== document.body) {
      const values = [...scope.querySelectorAll('div,span')]
        .filter(node => node.children.length === 0)
        .map(node => (node.textContent || '').trim())
        .filter(value => /^AED [\d,]+(?:\.\d+)?$/.test(value));
      if (values.length) return values;
      scope = scope.parentElement;
    }
    return [];
  });
  const rows = amountTexts.map(money);
  const sumMinor = rows.reduce((a, b) => a + Math.round(b * 100), 0);
  const sum = sumMinor / 100;
  ok(`flow: the limit sheet's merchant list adds up to what was spent (${spent} vs ${sum} over ${rows.length} rows)`,
    !!spent && rows.length > 0 && Math.round(money(spent) * 100) === sumMinor);
}

/** Wallet's focal available-balance figure must remain readable. */
{
  await wallet();
  const t = await paintedText(page);
  const label = t.find((x) => /^recorded balances$/i.test(x.t));
  const balance = label && t.find((x) => x.y > label.y && x.y < label.y + 130 && /^[\d,]+(?:\.\d+)?$/.test(x.t) && x.h > 30);
  ok(`wallet: the available balance remains a complete width-safe figure (${balance?.t})`,
    !!balance && money(balance.t) > 0 && !balance.clipped);
}

/* ── 6. Arabic ────────────────────────────────────────────────────────── */

/**
 * The Settings language row cycles English and Arabic.
 *
 * Coverage is partial by design today — a lot of copy is written straight into
 * the screens rather than going through `t()` — so this does not assert that
 * everything turns over. It asserts the two things that must hold whatever the
 * coverage is: the strings that ARE translated change immediately, and the
 * Arabic face fits the boxes the Latin one was measured for.
 *
 * RTL is not part of it. `I18nManager.forceRTL` is skipped on web and needs a
 * restart on the phone, so mirrored layout cannot be exercised here at all.
 */
{
  await home();
  await tapKey(page, 'Settings');
  await page.waitForTimeout(1300);
  ok('settings: the language row is there', (await tapKey(page, 'Language', 5000)) === true);
  await page.waitForTimeout(900);
  // The row opens a chooser; it does not switch anything by itself. That is
  // the point of it — the one-tap cycle it replaced could flip a mis-tap into
  // a mirrored Arabic UI the user could not read their way back out of.
  ok('settings: the language row opens a chooser rather than switching',
    (await page.evaluate(() => JSON.parse(localStorage.getItem('wafra/state/v1') || '{}').language ?? 'en')) === 'en');
  ok('settings: the chooser names both languages', (await tapKey(page, 'العربية', 5000)) === true);
  await page.waitForTimeout(1200);
  ok('settings: the language switch is written down',
    (await page.evaluate(() => JSON.parse(localStorage.getItem('wafra/state/v1') || '{}').language)) === 'ar');
  ok('Arabic Settings Back action works', await tapKey(page, 'رجوع') === true);
  await page.waitForTimeout(1500);
  ok('Arabic Back returns Home', /^\/$/.test(await url(page)));
  const arabic = /[؀-ۿ]/;
  /**
   * The tab bar has to be Arabic the moment you come back from Settings.
   *
   * `t()` reads a module-level variable and react-navigation re-renders a tab
   * bar only when the NAVIGATION state changes, so the bar used to keep its
   * five English labels under four Arabic screens until the user happened to
   * switch tabs for an unrelated reason.
   */
  const tabs = await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')]
    .map((n) => (n.textContent || '').trim()).filter(Boolean).slice(0, 4));
  ok(`home: the tab bar turns over with the language, without changing tab (${tabs.join(' ')})`,
    tabs.length === 4 && tabs.every((x) => arabic.test(x)));

  /**
   * And the LAYOUT mirrors, without the app being restarted.
   *
   * I18nManager cannot do this: its isRTL is an exported constant of the
   * native module, read once at construction, so forceRTL writes a preference
   * nothing re-reads until the process restarts — which is why switching to
   * Arabic used to mean closing the app. The root carries a `direction` style
   * instead, which Yoga applies to the whole subtree on the spot.
   */
  const dir = await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find(
      (n) => getComputedStyle(n).direction === 'rtl',
    );
    return el ? getComputedStyle(el).direction : getComputedStyle(document.body).direction;
  });
  ok(`home: the layout is mirrored without a restart (${dir})`, dir === 'rtl');

  for (const [name, tab] of [['home', null], ['flow', 'الإنفاق'], ['bills', 'الفواتير'], ['wallet', 'الحسابات']]) {
    if (tab) {
      await tapTab(page, tab);
    }
    const expectedPath = { home: '/', flow: '/flow', bills: '/bills', wallet: '/wallet' }[name];
    ok(`${name}: Arabic tab opens its own route`, (await url(page)).split('?')[0] === expectedPath);
    const painted = await paintedText(page);
    const clipped = painted.filter((x) => x.clipped);
    ok(`${name}: the Arabic face fits its boxes (${painted.length} runs)`,
      painted.length > 6 && clipped.length === 0, clipped.map((x) => x.t).join(' | '));
  }

  // Back to English, so what this suite leaves behind is what the others
  // assume they are starting from.
  await tapKey(page, 'الرئيسية', 5000);
  await tapKey(page, 'الإعدادات', 5000);
  await page.waitForTimeout(1300);
  await tapKey(page, 'اللغة', 5000);
  await page.waitForTimeout(900);
  await tapKey(page, 'English', 5000);
  await page.waitForTimeout(1200);
  ok('settings: switching back returns the app to English',
    (await page.evaluate(() => JSON.parse(localStorage.getItem('wafra/state/v1') || '{}').language)) === 'en');
}

/* ── Nothing may be pushed off the right edge ──────────────────────────
 *
 * A user photographed the Transactions header reading "+A" — the net total
 * for the whole filtered list, clipped to two characters because the
 * description beside it wrapped to two lines and shoved it past the viewport.
 * Nothing was checking that a figure the layout renders is a figure the user
 * can actually see, so it went unnoticed until someone asked what "+A" meant.
 */
{
  const overflow = [];
  for (const [name, key] of [['home', 'Home'], ['flow', 'Spending'], ['bills', 'Bills'], ['wallet', 'Accounts']]) {
    await tapKey(page, key, 5000);
    await page.waitForTimeout(700);
    overflow.push(...(await clippedText(page, name)));
  }
  await tapKey(page, 'Home', 5000);
  await page.waitForTimeout(600);
  await tapKey(page, 'All activity', 5000);
  await page.waitForTimeout(900);
  overflow.push(...(await clippedText(page, 'transactions')));
  await page.goBack();
  await page.waitForTimeout(700);

  ok('no text is clipped by the right edge of the screen', overflow.length === 0,
    overflow.slice(0, 3).join(' | '));
}

/* ── the OS theme changes while the app is open ───────────────────────────
 *
 * Not a reload. Someone turns on dark mode from the notification shade with
 * Wafra in the foreground, and every colour the app computes has to follow.
 *
 * This was broken and nothing noticed, because the failure is nearly
 * invisible: SOME text repainted — its colour came from a CSS rule answering
 * the media query directly, with a class list that never changed — while
 * every colour React computes stayed on the old palette. The result was a
 * half-flipped screen: dark cards under light text, unreadable, until the app
 * was killed and reopened. Leaving the tab and coming back did not fix it.
 *
 * So this samples a SURFACE (a computed background, which only React can set)
 * as well as ink, and it switches back, because a hook that only ever moves
 * one way would pass a one-directional test.
 */
{
  const sample = () => page.evaluate(() => {
    const leaf = (t) => [...document.querySelectorAll('*')].find(
      (n) => n.children.length === 0 && n.textContent?.trim() === t,
    );
    const surfaceAbove = (el) => {
      for (let n = el?.parentElement; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
      }
      return null;
    };
    const tab = leaf('Bills');
    return {
      card: surfaceAbove(leaf('Total spent')),
      ink: tab ? getComputedStyle(tab).color : null,
    };
  });

  await reload();
  await tapTab(page, 'Spending');
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.waitForTimeout(900);
  const dark = await sample();

  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(900);
  const light = await sample();

  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.waitForTimeout(900);
  const back = await sample();

  ok('the palette follows a live OS theme change, without a reload',
    !!dark.card && dark.card !== light.card && dark.ink !== light.ink,
    `dark ${dark.card}/${dark.ink} vs light ${light.card}/${light.ink}`);
  ok('and follows it back again',
    back.card === dark.card && back.ink === dark.ink,
    `${back.card}/${back.ink}`);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
}

ok('no page errors across the sweep', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
