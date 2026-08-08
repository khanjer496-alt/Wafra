import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});
await page.goto('http://localhost:8132', { waitUntil: 'networkidle' });
await page.waitForTimeout(2200);
const start = page.getByText('Start with sample data').first();
if (await start.count()) { await start.click().catch(() => {}); await page.waitForTimeout(2600); }
await page.getByRole('tab', { name: 'Flow' }).click({ timeout: 8000 });
await page.waitForTimeout(1800);

const probe = () => page.evaluate(() => {
  const leaf = (s) => [...document.querySelectorAll('*')].find(
    (n) => n.children.length === 0 && n.textContent?.trim() === s,
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
    media: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    card: surfaceAbove(leaf('Total out')),
    tabInk: tab ? getComputedStyle(tab).color : null,
  };
});

const dark = await probe();
console.log('1. loaded dark        ', JSON.stringify(dark));

await page.emulateMedia({ colorScheme: 'light' });
await page.waitForTimeout(1500);
const light = await probe();
console.log('2. media -> light     ', JSON.stringify(light));

await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(1500);
const back = await probe();
console.log('3. media -> dark again', JSON.stringify(back));

const ok =
  light.card !== dark.card &&
  light.tabInk !== dark.tabInk &&
  back.card === dark.card &&
  back.tabInk === dark.tabInk;
console.log(ok ? 'PASS: the live theme switch is followed, both ways' : 'FAIL: still stale');
await browser.close();
process.exit(ok ? 0 : 1);
