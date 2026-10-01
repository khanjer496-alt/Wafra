// Complete the backup task: download, replace local state, restore, and verify.
// Fresh local demo export and disposable synthetic browser ledgers only.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = (process.env.BASE ?? 'http://localhost:8126').replace(/\/$/, '');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(BASE).hostname));
const OUT = path.resolve(process.env.OUT ?? 'artifacts/e2e-backup-restore');
await mkdir(OUT, { recursive: true });
const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(executablePath) ? { executablePath } : {});
const results = [];
const STATE = 'wafra/state/v1';

async function tap(locator) {
  for (const target of (await locator.all()).reverse()) {
    if (!await target.isVisible()) continue;
    await target.scrollIntoViewIfNeeded();
    await target.evaluate(node => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const excess = node.getBoundingClientRect().bottom - (innerHeight - 125);
        if (excess <= 0) break;
        let parent = node.parentElement;
        while (parent && !(parent.scrollHeight > parent.clientHeight + 4 && parent.clientHeight > 160)) parent = parent.parentElement;
        if (!parent) break;
        parent.scrollTop += excess + 12;
      }
    });
    const onTop = await target.evaluate(node => {
      const r = node.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!hit && (node.contains(hit) || hit.contains(node));
    });
    if (onTop) { await target.click(); return; }
  }
  throw new Error(`No reachable control: ${locator}`);
}
async function dataScreen(page) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.getByTestId('home-spending-total').waitFor();
  await tap(page.getByLabel('Settings', { exact: true }));
  await page.getByTestId('settings-screen').waitFor();
  await tap(page.getByText('Data and help', { exact: true }));
  await page.getByTestId('settings-data-screen').waitFor();
}
async function backup(page, file) {
  const event = page.waitForEvent('download');
  await tap(page.getByText('Back up to a file', { exact: true }));
  const download = await event;
  assert.equal(download.suggestedFilename(), 'wafra-backup.json');
  await download.saveAs(file);
  return JSON.parse(await readFile(file, 'utf8'));
}
async function choose(page, file) {
  const event = page.waitForEvent('filechooser');
  await tap(page.getByText('Restore from a backup', { exact: true }));
  await (await event).setFiles(file);
  await page.getByText('Restore backup?', { exact: true }).waitFor({ state: 'visible', timeout: 8000 });
}
// The demo contains legacy merchant labels. Backup restore intentionally runs
// receiving-build migrations; allow these specific canonical names while
// still comparing every other field, amount, date, account and row exactly.
const legacyDemoTitles = {
  'Amazon.ae': 'Amazon', 'DEWA Bill': 'DEWA', 'ENOC Fuel': 'ENOC',
  'Spotify Premium': 'Spotify', 'Etisalat Postpaid': 'Etisalat',
};
const snapshot = backup => ({
  userName: backup.data.userName,
  accounts: backup.data.accounts,
  ledgerMoney: backup.data.ledgerMoney,
  transactions: backup.data.transactions.map(row => ({ ...row, title: legacyDemoTitles[row.title] ?? row.title })),
});

try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await context.route('**/*', route => {
      const url = route.request().url();
      return url.startsWith(BASE + '/') || url.startsWith('blob:') || url.startsWith('data:')
        ? route.continue() : route.abort();
    });
    try {
      await dataScreen(page);
      const file = path.join(OUT, `${theme}-backup.json`);
      const original = await backup(page, file);
      assert.ok(original.data.transactions.length > 0, 'A real synthetic ledger was exported');
      assert.ok(original.data.accounts.length > 0);
      // Alter a disposable fixture after export so a no-op restore cannot pass.
      const changed = 'Changed after backup';
      // Unmount the app before editing its stored fixture: a pending store save
      // in the live document can otherwise overwrite our deliberately changed
      // state between localStorage.setItem and the next navigation.
      const fixtureUrl = BASE + '/__backup-fixture__';
      await page.route(fixtureUrl, route => route.fulfill({
        status: 200, contentType: 'text/html', body: '<!doctype html><title>Backup fixture</title>',
      }));
      await page.goto(fixtureUrl);
      await page.evaluate(({ key, changed }) => {
        const state = JSON.parse(localStorage.getItem(key));
        state.userName = changed;
        localStorage.setItem(key, JSON.stringify(state));
      }, { key: STATE, changed });
      await page.unroute(fixtureUrl);
      await dataScreen(page);
      assert.equal((await backup(page, path.join(OUT, `${theme}-changed.json`))).data.userName, changed);
      await choose(page, file);
      await page.screenshot({ path: path.join(OUT, `${theme}-confirmation.png`) });
      await tap(page.getByText('Restore', { exact: true }));
      await page.waitForFunction(({ key, name }) => JSON.parse(localStorage.getItem(key))?.userName === name,
        { key: STATE, name: original.data.userName });
      await dataScreen(page); // Cold load verifies persisted restored content.
      assert.deepEqual(snapshot(await backup(page, path.join(OUT, `${theme}-restored.json`))), snapshot(original));
      await choose(page, { name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"other"}') });
      await tap(page.getByText('Restore', { exact: true }));
      const error = page.getByTestId('settings-restore-error');
      await error.waitFor({ state: 'visible' });
      assert.match(await error.innerText(), /does not look like a Wafra backup/);
      await error.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(OUT, `${theme}-invalid-file.png`) });
      assert.deepEqual(snapshot(await backup(page, path.join(OUT, `${theme}-after-invalid.json`))), snapshot(original),
        'Invalid input leaves every original ledger row and amount intact');
      assert.deepEqual(errors, []);
      results.push({ theme, passed: true, transactions: original.data.transactions.length });
      console.log(`PASS ${theme}: backup roundtrip, persisted exact ledger, visible invalid-file rejection`);
    } catch (error) {
      results.push({ theme, passed: false, error: String(error) });
      await page.screenshot({ path: path.join(OUT, `${theme}-failure.png`) }).catch(() => {});
      console.error(`FAIL ${theme}: ${error}`);
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  await writeFile(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
}
const failed = results.filter(result => !result.passed).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
