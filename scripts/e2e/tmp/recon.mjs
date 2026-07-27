import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = 'http://localhost:8126';
const CHROMIUM = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, colorScheme: 'dark' });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
for (const el of await page.getByText('Start with sample data').all()) {
  await el.click().catch(() => {});
}
await page.waitForTimeout(2500);

/** Every pressable actually painted on the topmost screen. */
const pressables = () => page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('[tabindex], [role="button"], [role="tab"], [role="switch"], [role="link"]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) continue;
    if (r.bottom < -2000 || r.top > window.innerHeight + 4000) continue;
    out.push({
      label: el.getAttribute('aria-label'),
      role: el.getAttribute('role'),
      text: (el.textContent || '').trim().slice(0, 50),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    });
  }
  return out;
});

const tapTab = async (name) => {
  await page.getByRole('tab', { name }).click({ timeout: 8000 });
  await page.waitForTimeout(1400);
};

const dump = async (name) => {
  const p = await pressables();
  console.log(`\n===== ${name} (${p.length}) =====`);
  for (const x of p) console.log(`  [${x.role ?? '-'}] label=${JSON.stringify(x.label)} text=${JSON.stringify(x.text)} @${x.x},${x.y} ${x.w}x${x.h}`);
};

await dump('HOME');
await tapTab('Flow'); await dump('FLOW');
await tapTab('Bills'); await dump('BILLS');
await tapTab('Wallet'); await dump('WALLET');

await browser.close();
