// Recon: press every pressable on every screen, report what happens.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = 'http://localhost:8126';
const CHROMIUM = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, colorScheme: 'dark' });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));

const onboard = async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);
  const btn = page.getByText('Start with sample data').first();
  if (await btn.count()) { await btn.click().catch(() => {}); await page.waitForTimeout(2400); }
};
await onboard();

/**
 * Every pressable that is actually on top at its own centre. Keyed so it can
 * be found again after a reload.
 */
const controls = () => page.evaluate(() => {
  const out = [];
  const sel = '[tabindex], [role="button"], [role="tab"], [role="switch"], [role="link"]';
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) continue;
    // Scroll it into view first inside its own scroller.
    let p = el.parentElement;
    while (p && !(p.scrollHeight > p.clientHeight + 4 && p.clientHeight > 200)) p = p.parentElement;
    if (p) {
      const pr = p.getBoundingClientRect();
      if (r.top < pr.top || r.bottom > pr.bottom) p.scrollTop += r.top - pr.top - 120;
    }
    const rr = el.getBoundingClientRect();
    if (rr.bottom < 0 || rr.top > window.innerHeight) continue;
    const cx = Math.min(Math.max(rr.x + rr.width / 2, 1), window.innerWidth - 2);
    const cy = Math.min(Math.max(rr.y + rr.height / 2, 1), window.innerHeight - 2);
    const top = document.elementFromPoint(cx, cy);
    if (!(top && (el.contains(top) || top.contains(el)))) continue;
    out.push({
      label: el.getAttribute('aria-label'),
      role: el.getAttribute('role'),
      text: (el.textContent || '').trim().slice(0, 44),
    });
  }
  return out;
});

/** Scroll the topmost scroller a page at a time so everything gets enumerated. */
const scrollTop = (n) => page.evaluate((v) => {
  const scr = [...document.querySelectorAll('div')].filter(
    (d) => d.scrollHeight > d.clientHeight + 20 && d.clientHeight > 300 && d.getBoundingClientRect().width > 200,
  );
  const el = scr[scr.length - 1];
  if (el) el.scrollTop = v;
  return scr.length;
}, n);

const allControls = async () => {
  const seen = new Map();
  for (let y = 0; y < 4000; y += 600) {
    await scrollTop(y);
    await page.waitForTimeout(250);
    for (const c of await controls()) {
      const key = c.label ?? c.text;
      if (key && !seen.has(key)) seen.set(key, c);
    }
  }
  await scrollTop(0);
  await page.waitForTimeout(200);
  return [...seen.values()];
};

const url = () => page.evaluate(() => location.pathname + location.search);
const bodyText = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());

const tapTab = async (name) => {
  await page.getByRole('tab', { name }).click({ timeout: 8000 });
  await page.waitForTimeout(1200);
};

/** Click a control by label or text, hit-tested. */
const tapKey = async (key) => {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const els = [
      ...(await page.getByLabel(key, { exact: true }).all()),
      ...(await page.getByText(key, { exact: true }).all()),
    ];
    for (const el of els) {
      await el.scrollIntoViewIfNeeded({ timeout: 800 }).catch(() => {});
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
      const onTop = await el.evaluate((node) => {
        const r = node.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return false;
        const cx = Math.min(Math.max(r.x + r.width / 2, 1), window.innerWidth - 2);
        const cy = Math.min(Math.max(r.y + r.height / 2, 1), window.innerHeight - 2);
        const top = document.elementFromPoint(cx, cy);
        return !!top && (node.contains(top) || top.contains(node));
      }).catch(() => false);
      if (onTop) { await el.click({ timeout: 5000 }); return true; }
    }
    await page.waitForTimeout(200);
  }
  return false;
};

const SKIP = new Set(['Home', 'Flow', 'Bills', 'Wallet']);

async function sweep(name, reenter) {
  await reenter();
  const list = await allControls();
  console.log(`\n##### ${name}: ${list.length} pressables`);
  for (const c of list) {
    const key = c.label ?? c.text;
    if (!key || SKIP.has(key)) continue;
    await reenter();
    const before = { u: await url(), t: await bodyText() };
    errors.length = 0;
    let clicked = false;
    try { clicked = await tapKey(key); } catch (e) { console.log(`  !! ${key}: click threw ${String(e).slice(0, 80)}`); continue; }
    if (!clicked) { console.log(`  ?? ${key}: could not reach`); continue; }
    await page.waitForTimeout(1100);
    const after = { u: await url(), t: await bodyText() };
    const unmatched = /Unmatched Route|This screen does not exist/i.test(after.t);
    const blank = after.t.length < 40;
    const changed = after.u !== before.u || after.t !== before.t;
    const flags = [
      unmatched ? 'UNMATCHED' : '',
      blank ? 'BLANK' : '',
      changed ? '' : 'NO-CHANGE',
      errors.length ? `ERR:${errors[0].slice(0, 90)}` : '',
    ].filter(Boolean).join(' ');
    console.log(`  ${flags ? '✗' : '·'} ${JSON.stringify(key).slice(0, 46)} → ${after.u}${flags ? '  [' + flags + ']' : ''}`);
  }
}

const home = async () => { await page.goto(BASE, { waitUntil: 'networkidle' }); await page.waitForTimeout(1800); };

await sweep('HOME', home);
await sweep('FLOW', async () => { await home(); await tapTab('Flow'); });
await sweep('BILLS', async () => { await home(); await tapTab('Bills'); });
await sweep('WALLET', async () => { await home(); await tapTab('Wallet'); });

await browser.close();
