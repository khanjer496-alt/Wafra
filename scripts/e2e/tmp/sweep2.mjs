// Recon pass 2: pushed screens, sheets, modals.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = 'http://localhost:8126';
const CHROMIUM = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, colorScheme: 'dark' });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1600);
{
  const btn = page.getByText('Start with sample data').first();
  if (await btn.count()) { await btn.click().catch(() => {}); await page.waitForTimeout(2400); }
}

// Seed subscriptions, a card due and a bill, so every Bills segment and every
// Wallet section has something in it.
await page.evaluate(() => {
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
    txs.push({ id: `sw-${n++}`, type: 'expense', amountFils, category, accountId, title, date: iso(daysAgo), source: 'sms' });
  for (const d of [4, 34, 64, 94]) add('Netflix', 'entertainment', 5550, d);
  for (const d of [9, 39, 69, 99]) add('Spotify', 'entertainment', 2250, d);
  for (const [d, a] of [[6, 28000], [36, 45000], [66, 31000], [96, 39000]]) add('SEWA Bill', 'utilities', a, d, 'acc-enbd');
  for (const d of [11, 41, 71, 101]) add('Al Adil Trading', 'groceries', 30000, d);
  delete meta.txChunks;
  meta.transactions = txs;
  meta.cardDues = [{
    id: 'due-1', accountId: 'acc-card',
    dueDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
    totalDueFils: 497500, minDueFils: 25000, paidFils: 0,
  }];
  meta.bills = [{
    id: 'bill-1', title: 'Salik top-up', amountFils: 10000, category: 'transport',
    dueDay: 12, accountId: 'acc-enbd', paidMonths: [],
  }];
  localStorage.setItem(K, JSON.stringify(meta));
});
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2400);

const controls = () => page.evaluate(() => {
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
    out.push({ label: el.getAttribute('aria-label'), role: el.getAttribute('role'), text: (el.textContent || '').trim().slice(0, 44) });
  }
  return out;
});
const scrollTo = (v) => page.evaluate((y) => {
  const scr = [...document.querySelectorAll('div')].filter(
    (d) => d.scrollHeight > d.clientHeight + 20 && d.clientHeight > 250 && d.getBoundingClientRect().width > 200,
  );
  const el = scr[scr.length - 1];
  if (el) el.scrollTop = y;
}, v);
const allControls = async () => {
  const seen = new Map();
  for (let y = 0; y < 3600; y += 500) {
    await scrollTo(y); await page.waitForTimeout(200);
    for (const c of await controls()) { const k = c.label ?? c.text; if (k && !seen.has(k)) seen.set(k, c); }
  }
  await scrollTo(0); await page.waitForTimeout(150);
  return [...seen.values()];
};
const url = () => page.evaluate(() => location.pathname + location.search);
const bodyText = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
const tapTab = async (n) => { await page.getByRole('tab', { name: n }).click({ timeout: 8000 }); await page.waitForTimeout(1200); };
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

const home = async () => { await page.goto(BASE, { waitUntil: 'networkidle' }); await page.waitForTimeout(1800); };
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
    try { clicked = await tapKey(key); } catch (e) { console.log(`  !! ${key.slice(0, 40)}: threw ${String(e).slice(0, 70)}`); continue; }
    if (!clicked) { console.log(`  ?? ${key.slice(0, 40)}: unreachable`); continue; }
    await page.waitForTimeout(1000);
    const after = { u: await url(), t: await bodyText() };
    const flags = [
      /Unmatched Route|This screen does not exist/i.test(after.t) ? 'UNMATCHED' : '',
      after.t.length < 40 ? 'BLANK' : '',
      after.u === before.u && after.t === before.t ? 'NO-CHANGE' : '',
      errors.length ? `ERR:${errors[0].slice(0, 100)}` : '',
    ].filter(Boolean).join(' ');
    console.log(`  ${flags ? '✗' : '·'} ${JSON.stringify(key).slice(0, 44)} → ${after.u}${flags ? '  [' + flags + ']' : ''}`);
  }
}

// await sweep("BILLS(seeded)', async () => { await home(); await tapTab('Bills'); });
await sweep('BILLS/cards', async () => { await home(); await tapTab('Bills'); await tapKey('Cards 1'); await page.waitForTimeout(700); });
await sweep('BILLS/fixed', async () => { await home(); await tapTab('Bills'); await tapKey('Fixed 5'); await page.waitForTimeout(700); });
await sweep('WALLET(seeded)', async () => { await home(); await tapTab('Wallet'); });
await sweep('TRANSACTIONS', async () => { await home(); await tapKey('See all'); await page.waitForTimeout(1200); });
await sweep('SETTINGS', async () => { await home(); await tapKey('Settings'); await page.waitForTimeout(1300); });
await sweep('PRO', async () => { await home(); await tapKey('Settings'); await page.waitForTimeout(1200); await tapKey('Wafra Pro'); await page.waitForTimeout(1300); });
await sweep('ACCURACY', async () => { await home(); await tapKey('Settings'); await page.waitForTimeout(1200); await tapKey('Improve accuracy'); await page.waitForTimeout(1300); });
await sweep('CARDS', async () => { await home(); await tapTab('Wallet'); await tapKey('See all'); await page.waitForTimeout(1300); });
await sweep('IMPORT-SMS', async () => { await home(); await tapTab('Wallet'); await tapKey('Paste a bank message'); await page.waitForTimeout(1400); });
await sweep('ADD-TRANSACTION', async () => { await home(); await tapKey('Add an entry'); await page.waitForTimeout(1400); });

console.log('\nERRORS:', errors.slice(0, 5));
await browser.close();
