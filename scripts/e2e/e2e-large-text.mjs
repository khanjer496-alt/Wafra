// Larger Text (Dynamic Type) layout audit.
//
// iOS Settings → Accessibility → Display & Text Size → Larger Text raises the
// app's font scale up to ~3.1x (AX4) and ~3.6x (AX5). React Native Web never
// reports a font scale, so the seeded E2E export emulates it: the harness sets
// `window.__WAFRA_E2E_FONT_SCALE__` before the bundle runs and
// src/lib/e2e-font-scale.ts makes Dimensions report it and scales every
// ThemedText/TextField the way native Text does (maxFontSizeMultiplier and
// allowFontScaling={false} included). Icons, fixed boxes and spacing stay put,
// exactly as they do on a phone.
//
// For every surface × scale × viewport × language it reads the painted screen:
//   overflow   — a visible text or control past the left/right viewport edge
//                (outside horizontal scrollers)
//   clipped    — text cut by its own box or a clipping ancestor, including a
//                numberOfLines ellipsis on a money figure
//   truncated  — any other numberOfLines ellipsis (reported, not failed:
//                truncation there is a design decision with a full a11y label)
//   overlap    — two painted text runs, or two controls, drawn over each other
//   unreachable— a control that cannot be scrolled fully on screen and hit
//   broken-word— a word split across lines (a squeezed column)
//   cramped    — a scroll area squeezed under 30% of the screen by chrome
//
//   node scripts/e2e/e2e-large-text.mjs            # full matrix, writes JSON
//   SCALES=3.1 LANGS=ar VIEWPORTS=375x667 SURFACES=home,bills node ...
//   SHOTS=dir  # also screenshot each surface (small PNG, first viewport)
//   STRICT=1   # exit non-zero when a failure is found
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:8126';
const list = (value, fallback) => (value ? value.split(',').map((s) => s.trim()).filter(Boolean) : fallback);
const SCALES = list(process.env.SCALES, ['1', '1.35', '2', '3.1']).map(Number);
const VIEWPORTS = list(process.env.VIEWPORTS, ['375x667', '430x932']).map((v) => {
  const [width, height] = v.split('x').map(Number);
  return { width, height, name: v };
});
const LANGS = list(process.env.LANGS, ['en', 'ar']);
const OUT = process.env.OUT ?? 'artifacts/e2e-large-text';
const SHOTS = process.env.SHOTS;
const STRICT = process.env.STRICT === '1';
// SLOW=2 doubles every settle wait on a loaded machine.
const SLOW = Number(process.env.SLOW ?? 1) || 1;
mkdirSync(OUT, { recursive: true });
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/* ── Surfaces ────────────────────────────────────────────────────────────
 * `tab` is reached by the tab bar (tabs must be clicked, see capture.mjs);
 * `path` by URL through serve.mjs's extensionless rewrite. `then` operates the
 * screen into the state to audit. Each returns the root to audit: the open
 * dialog when one is up, otherwise the screen on top.
 */
const clickOnTop = async (page, locator) => {
  for (const el of await locator.all()) {
    await el.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
    const onTop = await el.evaluate((node) => {
      const r = node.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      const top = document.elementFromPoint(
        Math.min(Math.max(r.x + r.width / 2, 0), innerWidth - 1),
        Math.min(Math.max(r.y + r.height / 2, 0), innerHeight - 1));
      return !!top && (node.contains(top) || top.contains(node));
    }).catch(() => false);
    if (onTop) { await el.click({ timeout: 5000 }); return true; }
  }
  return false;
};
const tab = (name) => async (page) => {
  await page.getByTestId(`main-tab-${name}`).click({ timeout: 8000 });
  await page.waitForTimeout(900 * SLOW);
};
const segment = (screenTestId, index) => async (page) => {
  const tabs = page.locator(`[data-testid="${screenTestId}"] [role="tablist"]`).first().locator('[role="tab"]');
  await clickOnTop(page, tabs.nth(index));
  await page.waitForTimeout(700 * SLOW);
};

const SURFACES = [
  { name: 'home', tab: 'index' },
  { name: 'spending-categories', tab: 'flow' },
  { name: 'spending-activity', tab: 'flow', then: segment('reference-spending-screen', 1) },
  { name: 'spending-trends', tab: 'flow', then: segment('reference-spending-screen', 2) },
  { name: 'spending-category-sheet', tab: 'flow', then: async (page) => {
    await clickOnTop(page, page.locator('[data-testid^="spending-category-"][role="button"]'));
    await page.waitForTimeout(900 * SLOW);
  } },
  { name: 'bills', tab: 'bills' },
  { name: 'accounts', tab: 'wallet' },
  { name: 'transactions', path: '/transactions' },
  { name: 'transaction-detail', tab: 'index', then: async (page) => {
    await clickOnTop(page, page.getByTestId('home-widget-activity').getByTestId('transaction-details-link'));
    await page.waitForTimeout(900 * SLOW);
  } },
  { name: 'add-transaction', path: '/add-transaction' },
  { name: 'review-alerts', path: '/review-alerts' },
  { name: 'review-transfers', path: '/review-transfers' },
  { name: 'transfers', path: '/transfers' },
  { name: 'assistant', path: '/assistant' },
  { name: 'settings', path: '/settings' },
  { name: 'pro', path: '/pro' },
  { name: 'statement-import', path: '/statement-import' },
  { name: 'recap', path: '/recap' },
  { name: 'cards', path: '/cards' },
  { name: 'stats', path: '/stats' },
  { name: 'merchants', path: '/merchants' },
  { name: 'currency', path: '/currency' },
  { name: 'home-customize', path: '/home-customize' },
];
const ONLY = list(process.env.SURFACES, null);

/* ── The in-page audit ───────────────────────────────────────────────── */
function audit() {
  const W = innerWidth, H = innerHeight;
  const visible = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      if (n.getAttribute('aria-hidden') === 'true') return false;
    }
    return true;
  };
  // Root: the top-most open dialog, else the screen under the viewport centre.
  const dialogs = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].filter((d) => {
    const r = d.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && visible(d);
  });
  let root = dialogs[dialogs.length - 1] ?? null;
  if (!root) {
    let n = document.elementFromPoint(W / 2, Math.min(H * 0.35, H - 1));
    // Up to the first screen-sized box whose parent also holds other screens.
    while (n && n.parentElement && n.parentElement !== document.body) {
      const r = n.getBoundingClientRect();
      if (r.width >= W - 2 && r.height >= H * 0.85 && n.parentElement.children.length > 1) break;
      n = n.parentElement;
    }
    root = n ?? document.body;
  }
  const isScrollerY = (n) => {
    const cs = getComputedStyle(n);
    return /(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1;
  };
  const isScrollerX = (n) => {
    const cs = getComputedStyle(n);
    return /(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1;
  };
  const inHorizontalScroller = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) if (isScrollerX(n)) return true;
    return false;
  };
  const tabBar = document.querySelector('[data-testid^="main-tab-"]')?.parentElement ?? null;
  const tabBarShown = !dialogs.length && tabBar && visible(tabBar) && tabBar.getBoundingClientRect().height > 0 && !root.contains(tabBar);
  // Content scrolls beneath the floating tab bar by design; only overlaps
  // inside one scope count.
  const sameScope = (a, b) => !tabBarShown || tabBar.contains(a) === tabBar.contains(b);
  // The part of a box actually painted: cut by every scrolling or clipping
  // ancestor. Content scrolled out of its scroller cannot collide with a
  // sticky footer drawn outside it.
  const paintedRect = (el) => {
    const r = el.getBoundingClientRect();
    let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const b = n.getBoundingClientRect();
      x0 = Math.max(x0, b.left); y0 = Math.max(y0, b.top); x1 = Math.min(x1, b.right); y1 = Math.min(y1, b.bottom);
    }
    return { left: x0, top: y0, right: x1, bottom: y1, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
  };
  const label = (el) => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 48);
  const scopes = tabBarShown ? [root, tabBar] : [root];
  const leaves = scopes.flatMap((scope) => [...scope.querySelectorAll('div,span')]).filter((el) => {
    if (el.children.length && [...el.children].some((c) => c.tagName !== 'BR')) return false;
    if (!(el.textContent || '').trim()) return false;
    const r = el.getBoundingClientRect();
    // A column squeezed to zero width still paints its letters (one per line).
    return (r.width > 1 || r.height > 1) && visible(el);
  });
  const textRuns = leaves;
  const failures = [];
  const add = (kind, el, detail = '') => failures.push({ kind, text: label(el), detail });
  const money = (s) => /\d[\d,٬.]*\d|\d/.test(s) && /(AED|SAR|USD|د\.إ|ر\.س|[\d٠-٩][\d٠-٩,٬.]{2,})/.test(s);

  for (const el of textRuns) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const s = (el.textContent || '').trim();
    const ellipsis = cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none' && cs.webkitLineClamp !== '' && cs.webkitLineClamp !== undefined;
    const overflowX = el.scrollWidth > el.clientWidth + 1;
    const overflowY = el.scrollHeight > el.clientHeight + 2;
    if ((overflowX || overflowY) && (ellipsis || cs.overflow !== 'visible')) {
      if (ellipsis && !money(s)) add('truncated', el);
      else add('clipped', el, ellipsis ? 'ellipsis' : 'own box');
      continue;
    }
    if (!inHorizontalScroller(el) && (r.right > W + 1 || r.left < -1)) { add('overflow', el, `x ${Math.round(r.left)}..${Math.round(r.right)}`); continue; }
    // Cut by a clipping ancestor (fixed height + overflow hidden).
    for (let n = el.parentElement; n && n !== root.parentElement; n = n.parentElement) {
      const ncs = getComputedStyle(n);
      if (ncs.overflow === 'visible' && ncs.overflowX === 'visible' && ncs.overflowY === 'visible') continue;
      if (isScrollerY(n) || isScrollerX(n) || /(auto|scroll)/.test(ncs.overflowY + ncs.overflowX)) break;
      const b = n.getBoundingClientRect();
      if (r.bottom > b.bottom + 2 || r.top < b.top - 2 || r.right > b.right + 2 || r.left < b.left - 2) {
        // A rounded pill that merely paints a hairline over its text is not a cut.
        add('clipped', el, 'ancestor');
      }
      break;
    }
  }

  // A word split across lines ("Spendi / ng", or a name stacked one letter
  // per line in a squeezed column). Native Text breaks by character once a
  // word cannot fit, so this is what a phone draws too.
  for (const el of textRuns) {
    if (getComputedStyle(el).textOverflow === 'ellipsis') continue;
    const node = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    if (!node) continue;
    const text = node.textContent;
    const re = /[^\s\-–—/·]+/g;
    let m;
    while ((m = re.exec(text))) {
      if (m[0].length < 2) continue;
      const range = document.createRange();
      range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
      const tops = new Set([...range.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top)));
      if (tops.size > 1) { add('broken-word', el, m[0].slice(0, 24)); break; }
    }
  }

  // A scroll area squeezed to a sliver by chrome that grew around it (a sheet
  // header and sticky footer taking most of the screen).
  for (const n of root.querySelectorAll('div')) {
    if (!isScrollerY(n) || !visible(n)) continue;
    const b = paintedRect(n);
    if (b.height > 0 && b.height < H * 0.3 && n.scrollHeight > b.height * 1.5 && b.width > W * 0.6) {
      failures.push({ kind: 'cramped', text: label(n).slice(0, 32), detail: `${Math.round(b.height)}px of ${H}` });
    }
  }

  // Overlapping text runs (both painted; the loser is by definition not on top).
  const boxes = textRuns.map((el) => ({ el, r: paintedRect(el) }))
    .filter(({ r }) => r.width >= 4 && r.height >= 4);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el) || !sameScope(a.el, b.el)) continue;
      const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ox > 4 && oy > 4) failures.push({ kind: 'overlap', text: `${label(a.el)} ⟷ ${label(b.el)}`, detail: 'text' });
    }
  }

  // Controls: overlap and reachability.
  const controls = scopes.flatMap((scope) => [...scope.querySelectorAll('[role="button"],[role="tab"],[role="link"],[role="switch"],[role="checkbox"],[role="radio"],button,a[href],input,textarea')])
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && visible(el); });
  const outer = controls.filter((el) => !controls.some((o) => o !== el && o.contains(el)));
  for (let i = 0; i < outer.length; i++) {
    for (let j = i + 1; j < outer.length; j++) {
      if (!sameScope(outer[i], outer[j])) continue;
      const a = paintedRect(outer[i]), b = paintedRect(outer[j]);
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 6 && oy > 6) failures.push({ kind: 'overlap', text: `${label(outer[i])} ⟷ ${label(outer[j])}`, detail: 'controls' });
    }
  }
  // A control painted over text that is not its own (a header button over a
  // title that grew under it).
  for (const c of outer) {
    const a = paintedRect(c);
    for (const { el, r } of boxes) {
      if (c.contains(el) || el.contains(c) || !sameScope(c, el)) continue;
      const ox = Math.min(a.right, r.right) - Math.max(a.left, r.left);
      const oy = Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top);
      if (ox > 6 && oy > 6) failures.push({ kind: 'overlap', text: `${label(c)} ⟷ ${label(el)}`, detail: 'control over text' });
    }
  }
  for (const el of outer) {
    let scroller = null;
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) if (isScrollerY(n)) { scroller = n; break; }
    const saved = scroller ? scroller.scrollTop : 0;
    if (scroller) {
      const r0 = el.getBoundingClientRect(), s0 = scroller.getBoundingClientRect();
      const room = Math.min(s0.height, H);
      scroller.scrollTop += r0.top - (s0.top + Math.max(8, (room - Math.min(r0.height, room)) / 2));
    }
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + Math.min(r.height, 40) / 2;
    let ok = cx >= 0 && cx <= W && cy >= 0 && cy <= H;
    if (ok) {
      // Hit-tested, so a control parked under the floating tab bar at the
      // scroller's end, or under another control, counts as unreachable.
      const hit = document.elementFromPoint(cx, cy);
      ok = !!hit && (el.contains(hit) || hit.contains(el));
    }
    if (!ok && inHorizontalScroller(el)) ok = true;
    if (!ok) failures.push({ kind: 'unreachable', text: label(el), detail: `at ${Math.round(cx)},${Math.round(cy)}` });
    if (scroller) scroller.scrollTop = saved;
  }
  if (document.documentElement.scrollWidth > W + 1) failures.push({ kind: 'overflow', text: 'document', detail: `scrollWidth ${document.documentElement.scrollWidth}` });
  // One entry per kind+text.
  const seen = new Set();
  return failures.filter((f) => { const k = `${f.kind}|${f.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/* ── Run ─────────────────────────────────────────────────────────────── */
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {});
const results = [];
const startLedger = async (page, language) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('wafra/state/v1') || '{}').txChunks > 0, null, { timeout: 20000 });
  await page.evaluate((lang) => {
    const key = 'wafra/state/v1'; const meta = JSON.parse(localStorage.getItem(key));
    Object.assign(meta, { language: lang, languagePreference: lang });
    localStorage.setItem(key, JSON.stringify(meta));
  }, language);
};

try {
  for (const language of LANGS) {
    for (const viewport of VIEWPORTS) {
      for (const scale of SCALES) {
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height },
          colorScheme: 'light', locale: language === 'ar' ? 'ar-AE' : 'en-AE', reducedMotion: 'reduce' });
        await context.addInitScript((s) => { window.__WAFRA_E2E_FONT_SCALE__ = s; }, scale);
        await context.route('**/*', (route) => {
          const url = route.request().url();
          return url.startsWith(`${BASE}/`) || url === BASE || /^(?:data:|blob:)/.test(url) ? route.continue() : route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        await startLedger(page, language);
        for (const surface of SURFACES) {
          if (ONLY && !ONLY.includes(surface.name)) continue;
          const id = `${surface.name} ${language} ${viewport.name} @${scale}`;
          let failures;
          try {
            const url = surface.path ? `${BASE}${surface.path}` : BASE;
            // One retry: a cold route load occasionally never reaches network idle.
            await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
              .catch(() => page.goto(url, { waitUntil: 'load', timeout: 30000 }));
            await page.waitForTimeout(1200 * SLOW);
            if (surface.tab) await tab(surface.tab)(page);
            if (surface.then) await surface.then(page);
            await page.evaluate(() => document.fonts.ready);
            failures = await page.evaluate(audit);
            if (SHOTS && viewport === VIEWPORTS[0]) {
              await page.screenshot({ path: path.join(SHOTS, `${surface.name}-${language}-${viewport.name}-${scale}.png`) });
            }
          } catch (error) {
            failures = [{ kind: 'error', text: String(error).slice(0, 160), detail: '' }];
          }
          const hard = failures.filter((f) => f.kind !== 'truncated' && f.kind !== 'error');
          if (failures.some((f) => f.kind === 'error')) console.log(`! ${id}: harness error ${failures[0].text}`);
          results.push({ surface: surface.name, language, viewport: viewport.name, scale, failures });
          console.log(`${hard.length ? '✗' : '✓'} ${id}: ${hard.length} failures${failures.length - hard.length ? `, ${failures.length - hard.length} truncated` : ''}`);
          for (const f of hard.slice(0, 6)) console.log(`    ${f.kind}: ${f.text}${f.detail ? ` (${f.detail})` : ''}`);
        }
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
writeFileSync(path.join(OUT, 'large-text-audit.json'), JSON.stringify(results, null, 1));
const total = results.reduce((n, r) => n + r.failures.filter((f) => f.kind !== 'truncated' && f.kind !== 'error').length, 0);
const errors = results.filter((r) => r.failures.some((f) => f.kind === 'error')).length;
if (errors) console.log(`${errors} surface states could not be audited (harness error)`);
console.log(`\n${results.length} surface states, ${total} failures → ${path.join(OUT, 'large-text-audit.json')}`);
if (STRICT && (total || errors)) process.exit(1);
