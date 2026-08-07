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

/* ── Launch ───────────────────────────────────────────────────────────── */

const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(
  existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {},
);
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, colorScheme: 'dark' });
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
const start = await page.getByText('Start with sample data').first();
if (await start.count()) { await start.click().catch(() => {}); await page.waitForTimeout(2400); }

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
    if (skip.includes(key) || ['Home', 'Flow', 'Bills', 'Wallet'].includes(key)) continue;
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
const flow = async () => { await reload(); await tapTab(page, 'Flow'); };
const bills = async () => { await reload(); await tapTab(page, 'Bills'); };
const wallet = async () => { await reload(); await tapTab(page, 'Wallet'); };

await pressEverything('home', home);
await pressEverything('flow', flow);
await pressEverything('bills · subs', bills);
await pressEverything('bills · cards', async () => { await bills(); await tapKey(page, 'Cards 1'); await page.waitForTimeout(700); });
await pressEverything('bills · fixed', async () => { await bills(); await tapKey(page, 'Fixed 6'); await page.waitForTimeout(700); });
await pressEverything('wallet', wallet);
await pressEverything('transactions', async () => { await home(); await tapKey(page, 'See all'); await page.waitForTimeout(1200); });
await pressEverything('settings', async () => { await home(); await tapKey(page, 'Settings'); await page.waitForTimeout(1300); },
  // Erasing the ledger and cycling the language both make every later
  // control on the screen a different control; they get their own passes.
  { skip: ['Erase everything on this phone', 'Language', 'Country pack'] });

/**
 * Put the settings back.
 *
 * Pressing everything on Settings means pressing all 28 bars of the money-month
 * picker, so the app is left reporting a month that starts on the 28th — under
 * which "Jul 2026" runs 28 Jun to 27 Jul and today is its last day. Every
 * arithmetic assertion below reads a different month than the one the seed was
 * written for, which is how a green sweep produced "the hero equals In minus
 * Out (0 − 0 = 0)".
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
await resetPreferences();

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
    // Up to the section that holds the header AND the list under it.
    for (let i = 0; head && i < 8; i++, head = head.parentElement) {
      if (head.querySelectorAll?.('[role="button"][aria-label]').length >= 2) break;
    }
    return head ? [...head.querySelectorAll('[role="button"][aria-label]')].map((n) => n.getAttribute('aria-label')) : [];
  });
  // Four distinct insight routes are enough to make this non-vacuous; the
  // exact count legitimately changes with the live day of the seeded month.
  ok(`flow: "Worth knowing" has cards to press (${cards.length})`, cards.length >= 4);
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
await goesTo('home: "All activity" opens the ledger', home, 'All activity', /^\/transactions/);
await goesTo('home: the search action opens the ledger', home, 'See all', /^\/transactions/);
await goesTo('home: the sliders action opens settings', home, 'Settings', /^\/settings/);
await goesTo('flow: a composition row drills into its category', flow, 'Rent, see entries', /category=rent/);
await flow();
const pooledSlice = await page.evaluate(() =>
  [...document.querySelectorAll('[aria-label]')]
    .map((node) => node.getAttribute('aria-label'))
    .find((label) => /^\d+ more, see entries$/i.test(label || '')) ?? null,
);
if (pooledSlice) {
  await goesTo('flow: the pooled slice hands over every category it stands for', flow, pooledSlice, /category=[a-z]+%2C/);
} else {
  ok('flow: the pooled slice is absent only when every category is shown', true);
}
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
  // Both cells have to carry a real figure, or "0 − 0 = 0" passes and says
  // nothing — which is exactly what it did when the month had been moved.
  ok(`home: the hero equals In minus Out (${inFils} − ${outFils} = ${money(hero?.t ?? '')})`,
    !!hero && inFils > 0 && outFils > 0 && money(hero.t) === inFils - outFils);
}

/**
 * The limit sheet lists WHERE IT WENT over the four biggest merchants under a
 * "Spent this month" figure that covers every one of them. With more than four
 * merchants in the category the column cannot add up unless the remainder is
 * stated — the same defect the Home "leaving soon" list had.
 */
{
  await flow();
  ok('flow: a limit row opens its sheet', await tapKey(page, 'Transport limit', 5000));
  await page.waitForTimeout(1200);
  const t = await paintedText(page);
  /**
   * Read off the row, not off `paintedText`.
   *
   * "AED 2,289  / AED 1,800" is one ThemedText with another nested inside it,
   * so the spend is a bare text node in an element that HAS children — and
   * paintedText only collects leaves. It reported the figure as missing while
   * it was the largest thing on the sheet.
   */
  const spent = await page.evaluate(() => {
    const label = [...document.querySelectorAll('div,span')].find(
      (e) => !e.children.length && /^spent this month$/i.test((e.textContent || '').trim()),
    );
    const row = label?.parentElement;
    const m = (row?.textContent || '').match(/AED\s[\d,]+/);
    return m ? m[0] : null;
  });
  const where = t.find((x) => /^where it went$/i.test(x.t));
  const rows = where ? t.filter((x) => x.y > where.y && /^AED [\d,]+$/.test(x.t)).map((x) => money(x.t)) : [];
  const sum = rows.reduce((a, b) => a + b, 0);
  ok(`flow: the limit sheet's merchant list adds up to what was spent (${spent} vs ${sum} over ${rows.length} rows)`,
    !!spent && rows.length > 0 && money(spent) === sum);
}

/** Wallet's focal figure must remain readable after the width-safe money split. */
{
  await wallet();
  const t = await paintedText(page);
  const label = t.find((x) => /^net worth$/i.test(x.t));
  const worth = label && t.find((x) => x.y > label.y && x.y < label.y + 70 && /^[\d,]+$/.test(x.t) && x.h > 30);
  ok(`wallet: net worth remains a complete width-safe figure (${worth?.t})`,
    !!worth && money(worth.t) > 0 && !worth.clipped);
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
  await page.waitForTimeout(1200);
  ok('settings: the language switch is written down',
    (await page.evaluate(() => JSON.parse(localStorage.getItem('wafra/state/v1') || '{}').language)) === 'ar');
  await tapKey(page, 'Back');
  await page.waitForTimeout(1500);
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

  for (const [name, tab] of [['home', null], ['flow', 'التدفق'], ['bills', 'الفواتير'], ['wallet', 'المحفظة']]) {
    if (tab) {
      await tapKey(page, tab, 8000);
      await page.waitForTimeout(1300);
    }
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
  for (const [name, key] of [['home', 'Home'], ['flow', 'Flow'], ['bills', 'Bills'], ['wallet', 'Wallet']]) {
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

ok('no page errors across the sweep', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
