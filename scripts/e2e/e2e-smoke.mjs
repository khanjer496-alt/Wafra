// Smoke suite: visits every screen of the four-tab IA, opens each detail
// sheet, exercises the import paste flow, the paywall, founder unlock, and
// trial expiry.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:8126';
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

/**
 * Flow's composition tiles: the ramp step each row is tinted with, and the
 * ink of the glyph drawn on it. `onRampColor` picks the ink by luminance, so
 * the pair is only correct if it clears the 3:1 a graphical object needs —
 * a 26px tile is not text and does not get the 4.5:1 bar.
 */
const compTiles = (page) => page.evaluate(() => {
  const parse = (c) => {
    const m = c.trim().startsWith('#')
      ? [1, 3, 5].map((i) => parseInt(c.trim().slice(i, i + 2), 16))
      : (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    return m.length === 3 && m.every((n) => Number.isFinite(n)) ? m : null;
  };
  const lum = (rgb) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  };
  const out = [];
  for (const svg of document.querySelectorAll('svg')) {
    const tile = svg.parentElement;
    if (!tile) continue;
    const r = tile.getBoundingClientRect();
    if (Math.round(r.width) !== 26 || Math.round(r.height) !== 26) continue;
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (!(top && (tile.contains(top) || top.contains(tile)))) continue;
    const mark = svg.querySelector('path,circle,rect,line');
    const bg = parse(getComputedStyle(tile).backgroundColor);
    const ink = mark && parse(mark.getAttribute('stroke') || getComputedStyle(mark).stroke);
    if (!bg || !ink) continue;
    const a = lum(bg), b = lum(ink);
    out.push({
      label: (tile.parentElement?.textContent || '').trim().slice(0, 24),
      contrast: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100,
    });
  }
  return out;
});

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

// "Leaving in N days" prints one total over three rows and a remainder. The
// total covers the whole list, so the column only reconciles if the rows plus
// the "+N more" figure come back to it — the bug this replaced showed AED
// 70,976 over rows adding to 15,785 with nothing to say where the rest was.
{
  const t = await paintedText(page);
  const head = t.find((x) => /leaving in \d+ days/i.test(x.t));
  if (!head) {
    ok('home: leaving-soon total equals its rows', false);
  } else {
    const total = money(t.find((x) => Math.abs(x.y - head.y) < 8 && /^AED/.test(x.t))?.t ?? '');
    // Between this heading and the next section. Only bare figures count: the
    // dates beside them ("25 Jul · 1 day late") are not money.
    const next = t.find((x) => x.y > head.y + 20 && /recent activity/i.test(x.t));
    const limit = next ? next.y : Infinity;
    const figures = t
      .filter((x) => x.y > head.y + 12 && x.y < limit && /^[\d,]+$/.test(x.t))
      .map((x) => money(x.t));
    const sum = figures.reduce((a, b) => a + b, 0);
    ok(`home: leaving-soon total equals its rows plus the remainder (${total} vs ${sum})`,
      Number.isFinite(total) && total === sum);
  }
}

// Entry detail sheet.
//
// Whichever merchant Home happens to be showing. The seed is generated
// relative to today, so a hard-coded name ("Amazon.ae") passes until the date
// rolls and the top six rows shift — a suite failure that says nothing about
// the app. Read the first row and its account off the screen instead.
const firstEntry = await page.evaluate(() => {
  const heads = [...document.querySelectorAll('*')].filter(
    (n) => n.children.length === 0 && /^recent activity$/i.test((n.textContent || '').trim()),
  );
  if (!heads.length) return null;
  const y = heads[0].getBoundingClientRect().bottom;
  const leaves = [...document.querySelectorAll('*')]
    .filter((n) => n.children.length === 0 && (n.textContent || '').trim())
    .map((n) => ({ t: n.textContent.trim(), r: n.getBoundingClientRect() }))
    .filter((x) => x.r.top > y && x.r.width > 0)
    .sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
  const meta = leaves.find((x) => / · /.test(x.t));
  if (!meta) return null;
  // A row's title sits directly above its "Category · Account" meta line IN
  // THE SAME COLUMN. The column part is not decoration: when a merchant has
  // no logo the icon tile shows its initials as text ("en" for ENOC Fuel),
  // and that tile sits lower than the title, so "the leaf directly above the
  // meta line" returned the monogram. The suite then tapped a two-letter
  // string that matched eight elements, opened nothing, and died looking for
  // EDIT ENTRY — a failure that said nothing about the app.
  const title = leaves
    .filter((x) => x.r.top < meta.r.top && Math.abs(x.r.left - meta.r.left) < 4)
    .pop();
  if (!title) return null;
  // "Category · Account" and "Category · Account · 14:32" both exist — the
  // account is always the second field, never the last one.
  return { title: title.t, account: meta.t.split(' · ')[1] };
});
ok('home lists an entry to open', !!firstEntry?.title);
await tapText(page, firstEntry.title, 1200);
ok('entry sheet opens on a row', !!(await visibleText(page, /ENTRY DETAIL/i)));
ok(`entry sheet names the account (${firstEntry.account})`,
  !!(await visibleText(page, firstEntry.account)));
await tapText(page, 'EDIT ENTRY', 1000);
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
  const amountValue = () => page.evaluate(() => {
    for (const i of document.querySelectorAll('input')) {
      const r = i.getBoundingClientRect();
      if (r.width && r.height && /^\d+(\.\d+)?$/.test(i.value)) return i.value;
    }
    return null;
  });
  const before = await amountValue();
  ok(`edit form seeds the amount with its fils (${before})`, !!before && /\.\d\d$/.test(before));
  // The category row is a horizontal scroller; reach a chip that is not the
  // current one without touching any other field.
  const picked = await page.evaluate(() => {
    const row = [...document.querySelectorAll('div')].find(
      (d) => d.scrollWidth > d.clientWidth + 40 && d.clientHeight < 80 && d.clientHeight > 20,
    );
    if (row) row.scrollLeft = row.scrollWidth;
    return !!row;
  });
  await page.waitForTimeout(500);
  if (picked) await tapText(page, /^Charity$|^Government$|^Other$/, 900).catch(() => {});
  await tapText(page, /^SAVE CHANGES$/i, 1600).catch(() => {});
  await page.waitForTimeout(600);
  await tapText(page, firstEntry.title, 1200).catch(() => {});
  await tapText(page, 'EDIT ENTRY', 1100).catch(() => {});
  const after = await amountValue();
  ok(`editing only the category leaves the amount alone (${before} → ${after})`, !!before && before === after);
}
await tapLabel(page, 'Close', 900);

// ── Flow ──────────────────────────────────────────────────────────────
await tapTab(page, 'Flow');
ok('flow titles the screen', !!(await visibleText(page, /^Flow$/)));
ok('flow shows limits', !!(await visibleText(page, /^LIMITS$/i)));
/**
 * The "Out AED X" heading and the composition list beneath it are the same
 * quantity: the list covers 100% of the total, tail pooled into "N more". So
 * the heading has to be totalled the way the rows are SHOWN — rounding once
 * over rows that each round themselves is how three categories of AED 10.50
 * came to read 11 · 11 · 11 under a heading of 32.
 */
{
  const tiles = await compTiles(page);
  const t = await paintedText(page);
  // "Out AED 11,375 · …" is one paragraph; the figure is its first AED run,
  // and it sits above the composition bar.
  const heading = t.find((x) => /^AED [\d,]+$/.test(x.t) && x.y < 110);
  const rows = t.filter((x) => /^[\d,]+$/.test(x.t));
  // A row's figure is the right-most plain number on the tile's own line.
  const perTile = (await page.evaluate(() => {
    const ys = [];
    for (const svg of document.querySelectorAll('svg')) {
      const tile = svg.parentElement;
      if (!tile) continue;
      const r = tile.getBoundingClientRect();
      if (Math.round(r.width) === 26 && Math.round(r.height) === 26) ys.push(Math.round(r.y));
    }
    return ys;
  })).map((y) => {
    const on = rows.filter((x) => Math.abs(x.y - y) < 20);
    return on.length ? money(on[on.length - 1].t) : NaN;
  });
  const sum = perTile.reduce((a, b) => a + b, 0);
  ok(`flow: the Out heading equals the category rows (${heading?.t} vs ${sum})`,
    !!heading && perTile.length > 0 && perTile.every(Number.isFinite) && money(heading.t) === sum);

  // The glyph on a ramp tile is a graphical object: 3:1 or it is decoration.
  // `onRampColor` flips the ink by luminance, and the threshold has to land
  // where the two inks actually cross over, not where they look like they do.
  const worst = tiles.reduce((m, x) => (x.contrast < m.contrast ? x : m), tiles[0] ?? { contrast: 0, label: 'none' });
  ok(`flow: every category glyph is legible on its ramp step (worst ${worst.contrast}:1 on "${worst.label}")`,
    tiles.length > 0 && tiles.every((x) => x.contrast >= 3));
}

ok('flow shows the six-month pair chart', !!(await visibleText(page, /IN VS OUT/i)));

/**
 * A bar you cannot read a number off is a shape, not a figure. Six columns,
 * two figures each, an average in the header — and nothing truncated: `nano`
 * at column width used to cut "13.5k" down to "1…".
 */
{
  const t = await paintedText(page);
  const months = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/i;
  const cols = t.filter((x) => months.test(x.t)).sort((a, b) => a.x - b.x);
  // The pair is written once above its column; the month sits under the bars.
  const above = (x) => cols.length && x.y < cols[0].y && x.y > cols[0].y - 200;
  const values = t.filter((x) => /^[\d.]+[kM]?$/.test(x.t) && above(x));
  // A month with no ledger at all writes one em dash, not two zeros: two
  // 2%-floor stubs labelled "0 0" claim a month of perfect balance, which is
  // a different statement from "nothing was recorded".
  const dashes = t.filter((x) => x.t.trim() === '—' && above(x));
  ok(`flow: every column is accounted for — ${values.length / 2} with figures, ${dashes.length} empty, over ${cols.length} columns`,
    cols.length === 6 && values.length % 2 === 0 && values.length / 2 + dashes.length === cols.length);
  ok('flow: no chart figure is truncated', values.length > 0 && values.every((x) => !x.clipped));
  const header = t.find((x) => /avg$/i.test(x.t));
  ok(`flow: the chart header states the average (${header?.t})`, !!header && /^[+−-]/.test(header.t));
}

/**
 * A composition row opens the entries behind it, and the list it opens has to
 * total the figure that was tapped. An all-time drill-down from a row read in
 * one month would show a set that cannot add up to it.
 *
 * Read off the row ELEMENT, not off screen coordinates: every screen stays
 * mounted, so Home's "Out 12,465" sits at the same y as a Flow row and a
 * coordinate scan picks it up first.
 */
{
  const row = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[aria-label$="see entries"]')].find(
      (n) => n.getBoundingClientRect().width > 0,
    );
    if (!el) return null;
    const figures = [...el.querySelectorAll('*')]
      .filter((n) => n.children.length === 0 && /^[\d,]+$/.test((n.textContent || '').trim()))
      .map((n) => n.textContent.trim());
    return { label: el.getAttribute('aria-label'), figure: figures[figures.length - 1] };
  });
  ok('flow: the composition offers a category to open', !!row?.figure);
  if (row?.figure) {
    await tapLabel(page, row.label, 1800);
    ok(`flow: a category row opens Activity (${row.label})`,
      !!(await visibleText(page, /transactions? ·/i)));
    const total = await page.evaluate(() => {
      const el = [...document.querySelectorAll('*')].find(
        (n) => n.children.length === 0 && /^[+−-]\s?AED/.test((n.textContent || '').trim())
          && n.getBoundingClientRect().width > 0,
      );
      return el ? el.textContent.trim() : null;
    });
    const want = Number(row.figure.replace(/,/g, ''));
    const got = total ? Number(total.replace(/[^\d]/g, '')) : NaN;
    ok(`flow: and that list totals what the row said (row ${want}, list ${got})`,
      Number.isFinite(got) && got === want);
    await tapLabel(page, 'Back', 1400);
    await tapTab(page, 'Flow');
  }
}

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

/**
 * The sample ledger has no detected subscriptions and no card due, so the two
 * segments that carry a total cannot be exercised by it. Write a ledger that
 * does: two monthly charges at .50, which the "AED X/mo" heading can only
 * match by totalling the rows the way they are shown; a utility, which varies
 * like a bill; and two merchants that recur without being either — the ones
 * that used to be filed under a utilities heading.
 */
await page.evaluate(() => {
  const K = 'wafra/state/v1';
  const meta = JSON.parse(localStorage.getItem(K));
  const chunks = Number(meta.txChunks) || 0;
  const txs = [];
  for (let i = 0; i < chunks; i++) {
    txs.push(...JSON.parse(localStorage.getItem(`${K}:tx:${i}`) || '[]'));
    localStorage.removeItem(`${K}:tx:${i}`);
  }
  const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
  let n = 0;
  const add = (title, category, amountFils, daysAgo, accountId = 'acc-card') =>
    txs.push({ id: `e2e-${n++}`, type: 'expense', amountFils, category, accountId, title, date: iso(daysAgo), source: 'sms' });
  for (const d of [4, 34, 64, 94]) add('Netflix', 'entertainment', 5550, d);
  for (const d of [9, 39, 69, 99]) add('Spotify', 'entertainment', 2250, d);
  for (const [d, a] of [[6, 28000], [36, 45000], [66, 31000], [96, 39000]]) add('SEWA Bill', 'utilities', a, d, 'acc-enbd');
  for (const d of [7, 37, 67, 97]) add('Urbanclap Home Services', 'home-services', 15000, d);
  for (const d of [11, 41, 71, 101]) add('Al Adil Trading', 'groceries', 30000, d);
  delete meta.txChunks;
  meta.transactions = txs;
  localStorage.setItem(K, JSON.stringify(meta));
});
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2200);
await tapTab(page, 'Bills');

// The "AED X/mo" heading sits directly above the rows it totals.
{
  const t = await paintedText(page);
  const head = t.find((x) => /\/mo$/.test(x.t));
  const rows = t.filter((x) => /^AED [\d,]+$/.test(x.t) && head && x.y > head.y + 12).map((x) => money(x.t));
  const sum = rows.reduce((a, b) => a + b, 0);
  ok(`bills: the monthly total equals the subscription rows (${head?.t} vs ${sum})`,
    !!head && rows.length > 0 && money(head.t) === sum);
  ok('bills: no recurring row label is ellipsised',
    t.filter((x) => x.clipped).length === 0);
}

// The subscription sheet prints "Total paid" directly above the charges it is
// the total of, so the same rule applies as on Flow: total it the way the
// rows are shown, or the column visibly fails to add up.
await tapText(page, /^Netflix$/, 1400);
{
  const t = await paintedText(page);
  const label = t.find((x) => /^total paid$/i.test(x.t));
  const total = label && t.find((x) => x.y > label.y && x.y < label.y + 40 && /^AED/.test(x.t));
  const history = t.find((x) => /^history$/i.test(x.t));
  const charges = history ? t.filter((x) => x.y > history.y && /^AED [\d,]+$/.test(x.t)).map((x) => money(x.t)) : [];
  const sum = charges.reduce((a, b) => a + b, 0);
  ok(`bills: the subscription sheet's total equals its history rows (${total?.t} vs ${sum})`,
    !!total && charges.length > 0 && money(total.t) === sum);
}
// This sheet's close control carries no accessibility label, so dismiss it
// the other way it offers: a tap on the backdrop.
await page.mouse.click(206, 40);
await page.waitForTimeout(900);

await tapText(page, /Fixed \d/i, 1200);
{
  const t = await paintedText(page);
  const other = t.find((x) => /^other repeat payments$/i.test(x.t));
  const utilities = t.find((x) => /^utilities & fixed bills$/i.test(x.t));
  ok('bills fixed: "Other repeat payments" has its own section', !!other);
  ok('bills fixed: utilities are a separate block from it',
    !!other && !!utilities && other.y !== utilities.y);
  // A grocer under a utilities heading reads as a bug even when the
  // recurrence is real: it must sit below the "other" heading, not the
  // utilities one.
  const grocer = t.find((x) => /Al Adil/i.test(x.t));
  ok('bills fixed: a recurring shop is filed under "other", not utilities',
    !!grocer && !!other && grocer.y > other.y);
  ok('bills fixed: no recurring row label is ellipsised',
    t.filter((x) => x.clipped).length === 0);
}

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

/**
 * Appearance. The context is `colorScheme: 'dark'`, so picking Light has to
 * turn the WHOLE app over — every colour flows through `useTheme`, which
 * flows through `useColorScheme`, so a screen that stayed dark would mean
 * one of them is reading the OS directly.
 */
{
  ok('settings offers an Appearance section', !!(await visibleText(page, 'Appearance')));
  for (const opt of ['System', 'Light', 'Dark']) {
    ok(`appearance offers ${opt}`, !!(await visibleText(page, opt)));
  }
  const acrossTheApp = async (want) => {
    const seen = [await paintedScheme(page)];
    await tapLabel(page, 'Back', 1300);
    seen.push(await paintedScheme(page));
    for (const t of ['Flow', 'Bills', 'Wallet']) {
      await tapTab(page, t);
      seen.push(await paintedScheme(page));
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
await tapTab(page, 'Wallet');
await tapText(page, /Paste a bank message|Inbox scanned/, 1600);
ok('import page loads', !!(await visibleText(page, 'PARSE PASTED TEXT')));
await tapText(page, 'TRY SAMPLE', 1200);
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
