// Screenshot every screen in both schemes, navigating in-app.
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = 'http://localhost:8126';
const OUT = process.env.OUT ?? '/tmp/claude-0/-home-user-Wafra/5b4b2ea0-88d2-5a89-874b-f299965c2edd/scratchpad/audit';
mkdirSync(OUT, { recursive: true });
const CHROMIUM = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {});

const LANG = process.env.LANG_AR === '1';

for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 200)); });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);
  const s = page.getByText('Start with sample data').first();
  if (await s.count()) { await s.click().catch(() => {}); await page.waitForTimeout(2400); }

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
      txs.push({ id: `sh-${n++}`, type: 'expense', amountFils, category, accountId, title, date: iso(daysAgo), source: 'sms' });
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
    meta.bills = [{ id: 'bill-1', title: 'Salik top-up', amountFils: 10000, category: 'transport', dueDay: 12, accountId: 'acc-enbd', paidMonths: [] }];
    localStorage.setItem(K, JSON.stringify(meta));
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2400);

  const tapTab = async (n) => { await page.getByRole('tab', { name: n }).click({ timeout: 8000 }); await page.waitForTimeout(1400); };
  const tapKey = async (key) => {
    for (const el of [...(await page.getByLabel(key, { exact: true }).all()), ...(await page.getByText(key, { exact: true }).all())]) {
      await el.scrollIntoViewIfNeeded({ timeout: 800 }).catch(() => {});
      const onTop = await el.evaluate((node) => {
        const r = node.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return false;
        const cx = Math.min(Math.max(r.x + r.width / 2, 1), window.innerWidth - 2);
        const cy = Math.min(Math.max(r.y + r.height / 2, 1), window.innerHeight - 2);
        const t = document.elementFromPoint(cx, cy);
        return !!t && (node.contains(t) || t.contains(node));
      }).catch(() => false);
      if (onTop) { await el.click({ timeout: 5000 }); await page.waitForTimeout(1200); return true; }
    }
    return false;
  };
  const scrollTo = (v) => page.evaluate((y) => {
    const scr = [...document.querySelectorAll('div')].filter(
      (d) => d.scrollHeight > d.clientHeight + 20 && d.clientHeight > 250 && d.getBoundingClientRect().width > 200);
    const el = scr[scr.length - 1];
    if (el) el.scrollTop = y;
  }, v);
  const shot = async (name) => { await page.screenshot({ path: `${OUT}/${scheme}-${name}.png` }); console.log(`shot ${scheme}-${name}`); };

  if (LANG) {
    await tapKey('Settings'); await tapKey('Language'); await page.waitForTimeout(1200);
    await tapKey('Back'); await page.waitForTimeout(1000);
  }

  await shot('01-home');
  await scrollTo(900); await page.waitForTimeout(500); await shot('02-home-lower'); await scrollTo(0);
  await tapTab('Flow'); await shot('03-flow');
  await scrollTo(700); await page.waitForTimeout(500); await shot('04-flow-mid');
  await scrollTo(1400); await page.waitForTimeout(500); await shot('05-flow-worthknowing'); await scrollTo(0);
  await tapTab('Bills'); await shot('06-bills-subs');
  await tapKey('Cards 1'); await shot('07-bills-cards');
  await tapKey('Fixed 5'); await shot('08-bills-fixed');
  await tapTab('Wallet'); await shot('09-wallet');
  await scrollTo(700); await page.waitForTimeout(500); await shot('10-wallet-lower'); await scrollTo(0);
  await tapKey('See all'); await shot('11-cards'); await tapKey('Back');
  await tapTab('Home'); await tapKey('See all'); await shot('12-transactions');
  await tapKey('Back'); await page.waitForTimeout(800);
  await tapKey('Settings'); await shot('13-settings');
  await scrollTo(900); await page.waitForTimeout(500); await shot('14-settings-lower'); await scrollTo(0);
  await tapKey('Wafra Pro'); await shot('15-pro'); await tapKey('Back');
  await tapKey('Improve accuracy'); await shot('16-accuracy'); await tapKey('Back');
  await tapKey('Back'); await page.waitForTimeout(800);
  await tapTab('Wallet'); await tapKey('Paste a bank message'); await shot('17-import');
  await tapKey('Try sample'); await page.waitForTimeout(1200); await shot('18-import-parsed');
  await tapKey('Back'); await page.waitForTimeout(800);
  await tapKey('Add an entry'); await shot('19-add'); await tapKey('Close');
  // Sheets
  await tapTab('Flow'); await tapKey('Groceries limit'); await shot('20-limit-sheet'); await tapKey('Close');
  await tapTab('Home'); await tapKey('Talabat'); await page.waitForTimeout(400); await shot('21-entry-sheet'); await tapKey('Close');
  await tapKey('Reporting period: Jul 2026. Tap to change.').catch(() => {});
  await page.waitForTimeout(600); await shot('22-period-sheet');

  if (errors.length) { console.log(`--- ${scheme} errors ---`); for (const e of [...new Set(errors)].slice(0, 15)) console.log(e); }
  await ctx.close();
}
await browser.close();
