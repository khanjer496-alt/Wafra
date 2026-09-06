// Smoke suite: visits every screen of the four-tab IA, opens each detail
// sheet, exercises the import paste flow, the paywall, hidden-unlock defenses, and
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

/**
 * Flow's composition tiles: the ramp step each row is tinted with, and the
 * ink of the glyph drawn on it. `onRampColor` picks the ink by luminance, so
 * the pair is only correct if it clears the 3:1 a graphical object needs —
 * a 26px tile is not text and does not get the 4.5:1 bar.
 */
/**
 * The composition rows on Flow.
 *
 * These used to be 26x26 tiles with a category glyph on a colour ramp, and this
 * helper looked for exactly that. The row is an 8px swatch now — theme.ts says
 * category identity comes from the WORD, not from a hue, so the tile restated
 * what the label already said. Nothing was wrong with the app when this started
 * failing; the selector was describing a design that no longer ships, and it
 * failed by finding NOTHING, which reads as "the rows sum to 0" rather than as
 * "I could not see the rows". Match the swatch, and keep the money invariant
 * the assertion actually exists for.
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
  const pageBg = parse(getComputedStyle(document.body).backgroundColor) || [20, 18, 15];
  for (const el of document.querySelectorAll('div')) {
    if (el.childElementCount) continue;
    const r = el.getBoundingClientRect();
    if (Math.round(r.width) !== 8 || Math.round(r.height) !== 8) continue;
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (!(top && (el.contains(top) || top.contains(el)))) continue;
    // A solid swatch has no ink of its own, so what has to stay legible is its
    // EDGE against the page. The fill deliberately matches this row's segment in
    // the bar, and the ramp's tail steps sit at 2.0-2.8:1 — they cannot be
    // lifted without collapsing the ramp — so the border is what makes the
    // swatch visible, and the border is what this measures.
    const cs = getComputedStyle(el);
    const bg = parse(cs.borderTopColor) ?? parse(cs.backgroundColor);
    const ink = pageBg;
    if (!bg || !ink) continue;
    const a = lum(bg), b = lum(ink);
    out.push({
      label: (el.parentElement?.textContent || '').trim().slice(0, 24),
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
await page.waitForTimeout(2200);

// ── Home ──────────────────────────────────────────────────────────────
ok('home hero states the net result', !!(await visibleText(page, /Net after spending/i)));
ok('home splits income and spending', !!(await visibleText(page, /^SPENT$/i)));
ok('home lists upcoming obligations', !!(await visibleText(page, /^COMING UP$/i)));
ok('home links to all activity', !!(await visibleText(page, /ALL ACTIVITY/i)));

// The journal Home no longer invents one aggregate for unlike obligations.
// Every visible payment row states its own date and exact amount. Read those
// rows from the accessibility contract and verify that the same amount is
// painted in the row, catching clipping or mismatched money without coupling
// the check to the retired card composition.
{
  const payments = await page.evaluate(() => {
    const section = document.querySelector('[data-testid="journal-payments"]');
    if (!section) return [];
    return [...section.querySelectorAll('[role="button"][aria-label$=" AED"]')].map((node) => ({
      label: node.getAttribute('aria-label') || '',
      text: (node.textContent || '').replace(/\s+/g, ''),
    }));
  });
  const sound = payments.every(({ label, text }) => {
    const match = label.match(/, ([\d,]+(?:\.\d{1,2})?) AED$/);
    return !!match && text.includes(match[1].replace(/\s+/g, ''));
  });
  ok(`home: every upcoming payment keeps its date and exact amount (${payments.length} rows)`,
    payments.length > 0 && sound);
}

// Entry detail sheet.
//
// Whichever merchant Home happens to be showing. The seed is generated
// relative to today, so a hard-coded name ("Amazon.ae") passes until the date
// rolls and the top six rows shift — a suite failure that says nothing about
// the app. Read the first row and its account off the screen instead.
const firstEntry = await page.evaluate(() => {
  const section = document.querySelector('[data-testid="journal-activity"]');
  const row = [...(section?.querySelectorAll('[role="button"][aria-label]') ?? [])].find(
    (node) => /, (?:plus|minus) [\d,.]+ AED$/i.test(node.getAttribute('aria-label') || ''),
  );
  if (!row) return null;
  const label = row.getAttribute('aria-label') || '';
  const parts = label.split(', ');
  return { label, title: parts[0] || '', account: parts[2] || '' };
});
ok('home lists an entry to open', !!firstEntry?.title && !!firstEntry?.label);
if (!firstEntry) throw new Error('Home rendered no accessible journal transaction row');
await tapLabel(page, firstEntry.label, 1200);
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
await tapTab(page, 'Spending');
ok('spending titles the screen', !!(await visibleText(page, /^Spending$/)));
// Read the labelled figure before scrolling down to its composition rows.
// The amount itself is an accessible Money group rather than one leaf text
// node, so resolve it inside the same summary cell as the label instead of
// depending on how React Native Web happens to split currency and digits.
const flowTotalLabel = await visibleText(page, /^Total spent$/i);
const flowTotalHeading = flowTotalLabel ? await flowTotalLabel.evaluate((label) => {
  let scope = label.parentElement;
  while (scope && scope !== document.body) {
    const node = [...scope.querySelectorAll('[aria-label^="AED "]')].find((candidate) => {
      const r = candidate.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (node) return node.getAttribute('aria-label');
    scope = scope.parentElement;
  }
  return null;
}) : null;
ok('flow shows limits', !!(await visibleText(page, /^LIMITS$/i)));
/**
 * The Total spent figure and the composition rows are the same exact money.
 * Read the rows from their accessibility contract, not viewport coordinates:
 * the list can extend beyond the fold, and every tab remains mounted.
 */
{
  const tiles = await compTiles(page);
  const perTile = await page.evaluate(() =>
    [...document.querySelectorAll('[role="button"][aria-label$="see entries"]')]
      .filter((row) => row.getBoundingClientRect().width > 0)
      .map((row) => {
        const values = [...row.querySelectorAll('div,span')]
          .filter((node) => node.childElementCount === 0)
          .map((node) => (node.textContent || '').trim())
          .filter((value) => /^[\d,]+(?:\.\d{1,2})?$/.test(value));
        return values.at(-1) ?? '';
      }),
  );
  const figures = perTile.map(money);
  const sum = figures.reduce((a, b) => a + b, 0);
  const headingCents = flowTotalHeading ? Math.round(money(flowTotalHeading) * 100) : NaN;
  const rowCents = Math.round(sum * 100);
  ok(`flow: the Total spent heading equals the category rows (${flowTotalHeading} vs ${(rowCents / 100).toFixed(2)})`,
    figures.length > 0 && figures.every(Number.isFinite)
      && Number.isFinite(headingCents) && headingCents === rowCents);

  // The swatch edge is the graphical identity mark: 3:1 or it disappears.
  const worst = tiles.reduce((m, x) => (x.contrast < m.contrast ? x : m), tiles[0] ?? { contrast: 0, label: 'none' });
  ok(`flow: every category swatch is visible against the page (worst ${worst.contrast}:1 on "${worst.label}")`,
    tiles.length > 0 && tiles.every((x) => x.contrast >= 3));
}

ok('flow shows the six-month pair chart', !!(await visibleText(page, /INCOME VS SPENT · 6 MONTHS/i)));

// Bring the chart body itself into view once, then inspect every semantic
// month column rather than only the fraction still inside the viewport.
await visibleText(page, /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/i);

/**
 * Each of the six month columns carries a complete accessibility sentence.
 * On this phone width it also paints either two compact figures or one em dash;
 * inspect the whole column subtree so scrolling cannot turn six columns into
 * an apparent one-and-a-half.
 */
{
  const cols = await page.evaluate(() =>
    [...document.querySelectorAll('[role="img"][aria-label]')]
      .filter((node) => {
        const label = node.getAttribute('aria-label') || '';
        const r = node.getBoundingClientRect();
        return r.width > 0 && r.height > 0
          && /, (?:income .*spending .*|no activity recorded)$/i.test(label);
      })
      .map((node) => {
        const label = node.getAttribute('aria-label') || '';
        const leaves = [...node.querySelectorAll('div,span')]
          .filter((child) => child.childElementCount === 0)
          .map((child) => ({
            text: (child.textContent || '').trim(),
            clipped: child.scrollWidth > child.clientWidth + 1 || /…/.test(child.textContent || ''),
          }));
        return {
          label,
          values: leaves.filter(({ text }) => /^≈?[\d.]+[kM]?$/i.test(text)),
          dashes: leaves.filter(({ text }) => text === '—').length,
        };
      }),
  );
  const accounted = cols.every((col) =>
    /no activity recorded/i.test(col.label)
      ? col.values.length === 0 && col.dashes === 1
      : col.values.length === 2 && col.dashes === 0,
  );
  ok(`flow: every column is accounted for — ${cols.length} semantic month columns`,
    cols.length === 6 && accounted);
  const figures = cols.flatMap((col) => col.values);
  ok('flow: no chart figure is truncated', figures.length > 0 && figures.every((x) => !x.clipped));
  const t = await paintedText(page);
  const header = t.find((x) => /avg$/i.test(x.t));
  ok(`flow: the chart header states the average (${header?.t})`, !!header && /^[+−-]/.test(header.t));
}

/**
 * A composition row opens the entries behind it, and the list it opens has to
 * total the figure that was tapped. An all-time drill-down from a row read in
 * one month would show a set that cannot add up to it.
 *
 * Read off the row ELEMENT, not off screen coordinates: every screen stays
 * mounted, so Home's "Spent 12,465" sits at the same y as a Flow row and a
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
    await tapTab(page, 'Spending');
  }
}

// Limit editor sheet. The same category name also appears in the composition
// list above, which deep-links to Activity — target the limit row by label.
// Use a category that has current-period activity. A zero-spend category has
// no merchants to list, so asking it to prove "where it went" tested a state
// the sheet correctly does not render.
await tapLabel(page, 'Transport limit', 1300);
ok('limit sheet opens', !!(await visibleText(page, /MONTHLY LIMIT/i)));
ok('limit sheet lists where it went', !!(await visibleText(page, /WHERE IT WENT/i)));
await tapLabel(page, 'Close', 900);

// ── Bills ─────────────────────────────────────────────────────────────
await tapTab(page, 'Bills');
ok('bills segments recurring, cards and fixed', !!(await visibleText(page, /Recurring \d/i)));
await tapLabel(page, /Cards \d/i, 1000);
ok('bills cards segment renders', !!(await visibleText(page, /Outstanding|No card payments due/i)));
await tapLabel(page, /Fixed \d/i, 1000);
ok('bills fixed segment renders',
  !!(await visibleText(page, /Utilities & fixed bills|No utilities yet|Loans/i)));

// The shipped UAE demo now deliberately includes stable subscription, card
// due, utility and other-recurring histories. Exercise that public first-run
// state directly instead of mutating private persistence internals here.
await tapLabel(page, /Recurring \d/i, 900);

// The heading is a cadence-normalised monthly estimate, while each row
// deliberately shows its last or next charge. Those are not arithmetically
// comparable for weekly/yearly plans. Verify the total is finite, the segment
// count matches the rendered rows, and every row names the basis of its amount.
{
  const recurring = await page.evaluate(() => {
    const recurringTab = [...document.querySelectorAll('[role="tab"][aria-label]')]
      .find((node) => /^Recurring \d+$/i.test(node.getAttribute('aria-label') || '')
        && node.getBoundingClientRect().width > 0);
    const count = Number((recurringTab?.getAttribute('aria-label') || '').match(/\d+$/)?.[0] ?? NaN);
    const head = [...document.querySelectorAll('div,span')]
      .filter((node) => node.childElementCount === 0)
      .map((node) => (node.textContent || '').trim())
      .find((value) => /^AED [\d,]+(?:\.\d{1,2})? \/ month$/.test(value)) || '';
    const rows = [...document.querySelectorAll('[role="button"][aria-label]')]
      .filter((node) => {
        const label = node.getAttribute('aria-label') || '';
        return node.getBoundingClientRect().width > 0
          && /(?:Last charge|Estimated charge): AED [\d,]+(?:\.\d{1,2})?$/i.test(label);
      })
      .map((node) => node.getAttribute('aria-label') || '');
    return { count, head, rows };
  });
  ok(`bills: monthly estimate and ${recurring.rows.length}/${recurring.count} recurring charge bases render (${recurring.head})`,
    Number.isFinite(recurring.count) && recurring.count > 0
      && recurring.rows.length === recurring.count && Number.isFinite(money(recurring.head)));
  const t = await paintedText(page);
  ok('bills: no recurring row label is ellipsised',
    t.filter((x) => x.clipped).length === 0);
}

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
      .filter((text) => /^AED [\d,]+$/.test(text));
  });
  const charges = chargeTexts.map((text) => money(text));
  const sum = charges.reduce((a, b) => a + b, 0);
  ok(`bills: the subscription sheet's total equals its history rows (${total?.t} vs ${sum})`,
    !!total && charges.length > 0 && money(total.t) === sum);
}
await tapLabel(page, 'Close', 900);

await tapText(page, /Fixed \d/i, 1200);
{
  const t = await paintedText(page);
  const other = t.find((x) => /^other repeat payments$/i.test(x.t));
  const utilities = t.find((x) => /^utilities & fixed bills$/i.test(x.t));
  ok('bills fixed: "Other repeat payments" has its own section', !!other);
  ok('bills fixed: utilities are a separate block from it',
    !!other && !!utilities && other.y !== utilities.y);
  // A travel charge under a utilities heading reads as a bug even when the
  // recurrence is real: it must sit below the "other" heading, not the
  // utilities one.
  // Was Booking.com, which is not in this segment any more and should never have
  // been: the old demo generated three FX rows a month on a fixed day, and the
  // detector read them as a "183.58/mo, cancellable" commitment. The seed no
  // longer manufactures that, so the assertion now uses a repeat that is really
  // recurring — a Salik toll top-up, which is a genuine non-bill charge.
  const otherPayment = t.find((x) => /Salik/i.test(x.t));
  ok('bills fixed: a non-bill repeat is filed under "other", not utilities',
    !!otherPayment && !!other && otherPayment.y > other.y);
  ok('bills fixed: no recurring row label is ellipsised',
    t.filter((x) => x.clipped).length === 0);
}

// ── Wallet ────────────────────────────────────────────────────────────
await tapTab(page, 'Accounts');
ok('wallet shows the available-balance snapshot', !!(await visibleText(page, /AVAILABLE ACROSS ACCOUNTS/i)));
ok('wallet groups accounts and cards as money sources', !!(await visibleText(page, /MONEY SOURCES/i)));
ok('wallet lists goals', !!(await visibleText(page, /SAVINGS GOALS/i)));

// ── Activity ──────────────────────────────────────────────────────────
await tapTab(page, 'Home');
await tapText(page, 'All activity', 1600);
ok('activity opens scoped to the period', !!(await visibleText(page, /\d+ transactions? ·/i)));
ok('activity offers a search field', !!(await page.getByPlaceholder(/Search merchants/i).count()));
await tapLabel(page, 'Back', 1200);

// ── Settings ──────────────────────────────────────────────────────────
await tapLabel(page, 'Settings', 1400);
ok('settings leads with Pro', !!(await visibleText(page, 'Wafra Pro')));
ok('settings shows the trial state', !!(await visibleText(page, /Free trial · \d day/)));
{
  const groupedHeadings = await Promise.all(
    ['Money', 'Imports', 'Notifications', 'Appearance & language', 'Danger zone']
      .map((heading) => visibleText(page, heading)),
  );
  ok('settings shows the new grouped sections without a duplicate Current state',
    groupedHeadings.every(Boolean) && await page.getByText('Current state', { exact: true }).count() === 0);
}
ok('settings keeps feedback easy to find', !!(await visibleText(page, 'Send feedback')));
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
    for (const t of ['Spending', 'Bills', 'Accounts']) {
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
await tapTab(page, 'Accounts');
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
const mark = page.getByText(/^Wafra\s+\d/).last();
await mark.scrollIntoViewIfNeeded().catch(() => {});
for (let i = 0; i < 7; i++) {
  await mark.click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(140);
}
await page.waitForTimeout(800);
const proStored = await page.evaluate(
  () => JSON.parse(localStorage.getItem('wafra/state/v1') || '{}').pro === true,
);
ok('repeated version taps cannot grant Pro', !proStored);

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

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
