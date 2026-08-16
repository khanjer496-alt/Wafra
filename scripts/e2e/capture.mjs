/**
 * Screenshot every Wafra surface from the exported web build.
 *
 * This is the harness the visual reviewers run against. It exists because there
 * is no iOS simulator and no Android emulator on the build box, so the web
 * export is the only way to actually LOOK at a screen rather than read its code.
 *
 * Two rules learned the hard way, both still true:
 *
 *  - Tabs must be reached by clicking, not by URL. Every screen stays mounted
 *    behind the current one, so a text match can land on a hidden screen, and a
 *    cold route load throws the (harmless, upstream) hydration error.
 *  - Caps labels are a CSS `text-transform`, so the DOM text is still title
 *    case. Pass getByText a STRING (case-insensitive) or a regex with /i.
 *
 * Usage:
 *   node scripts/e2e/capture.mjs --out DIR [--scheme dark] [--lang en] [--base URL]
 *   node scripts/e2e/capture.mjs --out DIR --all      # both schemes, both languages
 *
 *   # Web review captures at App Store dimensions — never upload these:
 *   node scripts/e2e/capture.mjs --out DIR --store [--device iphone-6.9] [--all]
 *   node scripts/e2e/capture.mjs --out DIR --store --device iphone-6.5
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { stripAlpha, readPngHeader } from './png-rgb.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const BASE = arg('base', process.env.BASE ?? 'http://localhost:8126');
const OUT = arg('out', process.env.OUT);
const CHROMIUM =
  process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

if (!OUT) {
  console.error('capture: --out DIR is required');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

/**
 * Viewports.
 *
 * `review` is the everyday one and must not move: it is the size every visual
 * review so far has been read at.
 *
 * The `store` entries let reviewers inspect compositions at App Store pixel
 * dimensions. They are web renders, not upload assets; launch screenshots must
 * come from the signed native Release build on the target platform.
 * Each width/height below is a real iPhone's logical size, chosen so that
 * logical x scale lands exactly on an accepted size with no rounding:
 *
 *   440 x 956 @3 = 1320 x 2868   accepted 6.9" size
 *   428 x 926 @3 = 1284 x 2778   accepted 6.5" size
 *
 * Sizes verified against Apple's "Screenshot specifications" page (App Store
 * Connect help) on 2026-08-06. Apple accepts three portrait sizes for the 6.9"
 * class — 1260x2736, 1290x2796 and 1320x2868 — and 1320x2868 is the native
 * panel of the current Pro Max, so it is the default here. RE-CHECK THE PAGE
 * AT UPLOAD TIME; Apple revises it whenever the hardware line changes.
 *
 * A submission needs the 6.9" set. 6.5" is only required if 6.9" is absent —
 * Apple scales 6.9" down for every smaller display class automatically.
 */
const DEVICES = {
  review: { width: 390, height: 844, scale: 2 },
  'iphone-6.9': { width: 440, height: 956, scale: 3, label: '6.9-inch (required)' },
  'iphone-6.5': { width: 428, height: 926, scale: 3, label: '6.5-inch (fallback)' },
};

/** Tab surfaces, reached by clicking the tab bar. */
const TABS = [
  ['home', 'Home'],
  ['flow', 'Flow'],
  ['bills', 'Bills'],
  ['wallet', 'Wallet'],
];

/**
 * Pushed screens, reached by URL. Paths are EXTENSIONLESS: the export writes
 * `settings.html`, but the client router only matches `/settings` and renders
 * "Unmatched Route" for anything else. scripts/e2e/serve.mjs does that rewrite —
 * a plain `python3 -m http.server` will 404 on every one of these.
 */
const PUSHED = [
  ['transactions', '/transactions'],
  ['stats', '/stats'],
  ['settings', '/settings'],
  ['cards', '/cards'],
  ['import-sms', '/import-sms'],
  ['add-transaction', '/add-transaction'],
  ['accuracy', '/accuracy'],
  ['pro', '/pro'],
];

/**
 * The web store-dimension review cut: six surfaces, in listing order.
 *
 * Not the same list as the review sweep, and deliberately shorter — Apple
 * allows up to ten screenshots per display size, but the listing is read left
 * to right and the first two carry it. Settings, import-sms and accuracy are
 * diagnostic screens; they belong in the review sweep and nowhere near a store
 * page. `kind` says how the surface is reached, because tabs must be CLICKED
 * (see the header note above) while pushed screens are routed to.
 */
const STORE_SURFACES = [
  { kind: 'tab', name: 'home', label: 'Home' },
  { kind: 'tab', name: 'flow', label: 'Flow' },
  { kind: 'push', name: 'stats', path: '/stats' },
  { kind: 'tab', name: 'bills', label: 'Bills' },
  { kind: 'tab', name: 'wallet', label: 'Wallet' },
  { kind: 'push', name: 'transactions', path: '/transactions' },
];

const settle = (page, ms = 900) => page.waitForTimeout(ms);

/**
 * Wait until the layout stops moving.
 *
 * A fixed sleep is not enough: `Section` (src/components/ui/layout.tsx) gives
 * every section a staggered FadeInDown, so Settings' six sections are still
 * sliding past each other a full two seconds in — screenshots taken on a timer
 * catch two legible layers of text overlapping and manufacture layout bugs that
 * do not exist on device. Poll the geometry instead and shoot once it is still.
 */
async function waitForStable(page, { tries = 40, needed = 3, gap = 150 } = {}) {
  let last = '';
  let steady = 0;
  for (let i = 0; i < tries; i++) {
    const now = await page
      .evaluate(() => {
        const nodes = [...document.querySelectorAll('div,span,svg')].slice(0, 400);
        return nodes.map((n) => {
          const r = n.getBoundingClientRect();
          return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}`;
        }).join('|');
      })
      .catch(() => '');
    if (now && now === last) {
      if (++steady >= needed) return true;
    } else {
      steady = 0;
    }
    last = now;
    await page.waitForTimeout(gap);
  }
  return false;
}

/** Wait for the E2E-only demo ledger embedded by the screenshot export. */
async function bootWithDemoLedger(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await settle(page, 2200);
  return !!(await page.getByText(/Net after spending.*so far this month/i).first().isVisible().catch(() => false));
}

/**
 * Set the UI language, then reload so RTL applies.
 *
 * Written straight into persisted state rather than driven through Settings.
 * The Settings row is a toggle whose subtitle reads "English · العربية restarts
 * the app" in BOTH states, so probing it for the Arabic word always answered
 * yes — the toggle never fired and every "Arabic" screenshot came out
 * byte-identical to the English one. Storage is the only unambiguous source.
 */
async function setLanguage(page, lang) {
  const changed = await page.evaluate((want) => {
    const KEY = 'wafra/state/v1';
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return false;
    const meta = JSON.parse(raw);
    meta.language = want;
    window.localStorage.setItem(KEY, JSON.stringify(meta));
    return true;
  }, lang);
  if (!changed) console.log(`! could not set language=${lang}: no persisted state`);
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await settle(page, 1200);
  await waitForStable(page);
  return changed;
}

/**
 * Write one screenshot, and in store mode make the web review image opaque.
 *
 * The verification is not decoration. `deviceScaleFactor` is advisory — a
 * viewport Chromium cannot honour, a stray zoom, or a scrollbar all silently
 * shift the output by a pixel or two, and a 1319-wide PNG is rejected by App
 * Store Connect with the same generic message as a 1080-wide one. Cheaper to
 * fail here, loudly, than in the upload dialog.
 */
async function shoot(page, file, { store, expect }) {
  const buf = await page.screenshot();
  const out = store ? stripAlpha(buf) : buf;
  fs.writeFileSync(file, out);

  if (!store) return true;
  const h = readPngHeader(out);
  const ok = h.width === expect.width && h.height === expect.height && h.colorType === 2;
  if (!ok) {
    console.log(
      `! ${file}: got ${h.width}x${h.height} colourType ${h.colorType}, ` +
        `wanted ${expect.width}x${expect.height} colourType 2`,
    );
  }
  return ok;
}

async function captureRun(browser, { scheme, lang, device = 'review', store = false }) {
  const dev = DEVICES[device];
  const expect = { width: dev.width * dev.scale, height: dev.height * dev.scale };
  const suffix = lang === 'en' ? scheme : `${scheme}-${lang}`;
  const prefix = store ? `appstore-${device.replace('iphone-', '')}-${scheme}-${lang}` : suffix;
  const ctx = await browser.newContext({
    viewport: { width: dev.width, height: dev.height },
    deviceScaleFactor: dev.scale,
    colorScheme: scheme,
    // iPhone 15-ish UA so any platform branch takes the mobile path.
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  const booted = await bootWithDemoLedger(page);
  if (!booted) console.log(`! ${suffix}: onboarding gate not cleared`);
  if (lang !== 'en') await setLanguage(page, lang);

  /** Bring a tab surface forward by clicking it — never by URL. */
  async function openTab(name, tabLabel) {
    const idx = TABS.findIndex(([n]) => n === name);
    const tab = page.getByRole('tab', { name: tabLabel }).first();
    if (await tab.isVisible().catch(() => false)) {
      await tab.click().catch(() => {});
    } else {
      // Arabic relabels the tabs; fall back to positional order.
      await page.getByRole('tab').nth(idx).click().catch(() => {});
    }
  }

  // Store mode shoots a shorter, ordered, numbered cut; the review sweep still
  // walks every surface exactly as it always has.
  const surfaces = store
    ? STORE_SURFACES.map((s, i) => ({ ...s, file: `${String(i + 1).padStart(2, '0')}-${s.name}` }))
    : [
        ...TABS.map(([name, label]) => ({ kind: 'tab', name, label, file: name })),
        ...PUSHED.map(([name, path]) => ({ kind: 'push', name, path, file: name })),
      ];

  let bad = 0;
  for (const s of surfaces) {
    if (s.kind === 'tab') {
      // A pushed Expo Router screen sits above the tabs. Return to the tab
      // navigator before tapping, otherwise a hidden tab can miss and three
      // differently named files all capture the previous pushed route.
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle' }).catch(() => {});
      await settle(page, 250);
      await openTab(s.name, s.label);
    }
    else await page.goto(BASE + s.path, { waitUntil: 'networkidle' }).catch(() => {});
    await settle(page, 400);
    await waitForStable(page);
    if (!(await shoot(page, `${OUT}/${prefix}-${s.file}.png`, { store, expect }))) bad++;
    console.log(`shot ${prefix}-${s.file}`);
  }

  if (store) {
    const files = fs.readdirSync(OUT)
      .filter((file) => file.startsWith(`${prefix}-`) && file.endsWith('.png'));
    const byHash = new Map();
    for (const file of files) {
      const hash = createHash('sha256').update(fs.readFileSync(`${OUT}/${file}`)).digest('hex');
      const matches = byHash.get(hash) ?? [];
      matches.push(file);
      byHash.set(hash, matches);
    }
    const duplicates = [...byHash.values()].filter((matches) => matches.length > 1);
    for (const matches of duplicates) {
      console.log(`! duplicate store frames: ${matches.join(', ')}`);
      bad += matches.length - 1;
    }
  }
  if (bad) console.log(`! ${prefix}: ${bad} file(s) failed the size/alpha check`);
  if (bad) process.exitCode = 1;

  // Hydration noise on cold route loads is upstream and expected; drop it so a
  // real error stands out. See scripts/e2e/README.md.
  const real = [...new Set(errors)].filter(
    (e) => !/Minified React error #(418|423|425)|Hydration failed|did not match/i.test(e),
  );
  if (real.length) {
    console.log(`\n--- ${suffix} console errors ---`);
    for (const e of real.slice(0, 12)) console.log(e);
  }
  await ctx.close();
}

const store = flag('store');
const device = store ? arg('device', 'iphone-6.9') : 'review';
// Only meaningful in store mode; the review sweep always uses `review`, and
// validating unconditionally rejected the default run outright.
if (store && (!DEVICES[device] || device === 'review')) {
  console.error(
    `capture: unknown --device ${device}; expected one of ` +
      Object.keys(DEVICES).filter((d) => d !== 'review').join(', '),
  );
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: CHROMIUM });

const combos = flag('all')
  ? [
      { scheme: 'dark', lang: 'en' },
      { scheme: 'light', lang: 'en' },
      { scheme: 'dark', lang: 'ar' },
      { scheme: 'light', lang: 'ar' },
    ]
  : [{ scheme: arg('scheme', 'dark'), lang: arg('lang', 'en') }];

if (store) {
  const d = DEVICES[device];
  console.log(
    `store mode: ${device} ${d.label} -> ${d.width * d.scale}x${d.height * d.scale} px, RGB, no alpha\n`,
  );
}

for (const run of combos) await captureRun(browser, { ...run, device, store });

await browser.close();
console.log(`\ncaptured -> ${OUT}`);
