// Synthetic local ledger: creation, assignment, reload, search and backup labels.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:8134';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(BASE).hostname));
const OUT = path.resolve(process.env.OUT ?? 'artifacts/e2e-custom-categories');
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const results = [];
function readPersistedLedger() {
  const state = JSON.parse(localStorage.getItem('wafra/state/v1'));
  if (!state.transactions) {
    const blocks = Array.from({ length: state.txChunks ?? 0 }, (_, i) => JSON.parse(localStorage.getItem(`wafra/state/v1:tx:${i}`)));
    if (state.txChunkOrder === 'oldest-first') blocks.reverse();
    state.transactions = blocks.flat();
  }
  return state;
}


const moneySnapshot = state => state.transactions.map(row => [row.id, row.type, row.amountFils, row.date, row.accountId]).sort((a,b) => a[0].localeCompare(b[0]));
async function tap(locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.evaluate(node => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const excess = node.getBoundingClientRect().bottom - (innerHeight - 125);
      if (excess <= 0) break;
      let parent = node.parentElement;
      while (parent && !(parent.scrollHeight > parent.clientHeight + 4 && parent.clientHeight > 160)) parent = parent.parentElement;
      if (!parent) break;
      parent.scrollTop += excess + 12;
    }
  });
  await locator.click();
}
async function transactions(page, merchant, type) {
  const query=new URLSearchParams();
  if(merchant)query.set('merchant',merchant);
  if(type)query.set('type',type);
  await page.goto(`${BASE}/transactions${query.size?'?'+query:''}`, { waitUntil: 'networkidle' });
  await page.getByTestId('transactions-summary').waitFor({timeout:30000});
}
async function createAndAssign(page, name, screenshot) {
  await page.getByTestId('transaction-details-link').first().click();
  await page.getByTestId('entry-category-chip').click();
  await page.getByTestId('category-create-open').click();
  await page.getByTestId('category-create-name').fill(name);
  if (screenshot) {
    await page.getByTestId('category-create-save').scrollIntoViewIfNeeded();
    await page.screenshot({path:screenshot});
  }
  await page.getByTestId('category-create-save').click();
  assert.equal(await page.getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByTestId('entry-detail-actions').getByRole('button',{name:'Done',exact:true}).click();
  await page.waitForFunction(name => {
    const meta=JSON.parse(localStorage.getItem('wafra/state/v1'));
    const category=meta.customCategories?.find(row=>row.name===name);
    const rows=meta.transactions??Array.from({length:meta.txChunks??0},(_,i)=>JSON.parse(localStorage.getItem(`wafra/state/v1:tx:${i}`))??[]).flat();
    return !!category&&rows.some(row=>row.category===category.id);
  },name);
}
async function dataScreen(page) {
  await page.goto(`${BASE}/`,{waitUntil:'networkidle'});
  await page.getByTestId('home-spending-total').waitFor();
  await tap(page.getByLabel('Settings',{exact:true}));
  await page.getByTestId('settings-screen').waitFor();
  await tap(page.getByText('Data and help',{exact:true}));
  await page.getByTestId('settings-data-screen').waitFor();
}
async function backup(page,file) {
  const event=page.waitForEvent('download');
  await tap(page.getByText('Back up to a file',{exact:true}));
  const download=await event;
  assert.equal(download.suggestedFilename(),'wafra-backup.json');
  await download.saveAs(file);
  return JSON.parse(await readFile(file,'utf8'));
}

try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: theme, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.context().route('**/*', route => {
      const url=route.request().url();
      return url.startsWith(BASE+'/')||url.startsWith('blob:')||url.startsWith('data:')?route.continue():route.abort();
    });
    try {
      await page.goto(`${BASE}/transactions?merchant=Apple%20Store%20US`, { waitUntil: 'networkidle' });
      await page.getByTestId('transactions-summary').waitFor({ timeout: 30000 });
      await page.waitForFunction(() => localStorage.getItem('wafra/state/v1') !== null);
      const before = await page.evaluate(readPersistedLedger);
      await page.getByTestId('transaction-details-link').click();
      await page.getByTestId('entry-category-chip').click();
      await page.getByTestId('category-create-open').click();
      await page.getByTestId('category-create-name').fill('Groceries');
      await page.getByTestId('category-create-save').click();
      await page.getByText('A category with this name already exists.', { exact: true }).waitFor();
      await page.getByTestId('category-create-name').fill('Photography');
      await page.screenshot({ path: `${OUT}/${theme}-expense-form.png` });
      await page.getByTestId('category-create-save').click();
      const selected = page.getByRole('button', { name: 'Photography', exact: true });
      assert.equal(await selected.getAttribute('aria-pressed'), 'true');
      await page.screenshot({ path: `${OUT}/${theme}-created.png` });
      await page.getByTestId('entry-detail-actions').getByRole('button', { name: 'Done', exact: true }).click();
      await page.waitForFunction(() => {
        const meta = JSON.parse(localStorage.getItem('wafra/state/v1'));
        const rows = meta.transactions ?? Array.from({ length: meta.txChunks ?? 0 }, (_, i) => JSON.parse(localStorage.getItem(`wafra/state/v1:tx:${i}`)) ?? []).flat();
        return rows.some(t => t.category.startsWith('custom:expense:'));
      });
      const after = await page.evaluate(readPersistedLedger);
      assert.equal(after.customCategories.length, 1);
      const category = after.customCategories[0];
      assert.equal(category.name, 'Photography');
      assert.match(category.id, /^custom:expense:[a-f0-9]{32}$/);
      assert.deepEqual(after.transactions.map(t => [t.id,t.amountFils,t.date,t.accountId]), before.transactions.map(t => [t.id,t.amountFils,t.date,t.accountId]));
      await page.goto(`${BASE}/transactions?q=Photography`, { waitUntil: 'networkidle' });
      await page.getByTestId('transactions-summary').waitFor();
      assert.match(await page.getByTestId('transactions-summary').innerText(), /^1 transaction\b/);
      await page.getByTestId('transaction-details-link').click();
      await page.getByRole('button', { name: 'Category: Photography', exact: true }).waitFor();
      await page.screenshot({ path: `${OUT}/${theme}-reloaded.png` });
      // Income has its own catalog, yet category names remain globally unique.
      await transactions(page,'Salary','income');
      await createAndAssign(page,'Tutoring',`${OUT}/${theme}-income-form.png`);
      const withIncome=await page.evaluate(readPersistedLedger);
      const incomeCategory=withIncome.customCategories.find(row=>row.name==='Tutoring');
      assert.match(incomeCategory.id,/^custom:income:[a-f0-9]{32}$/);
      assert.ok(withIncome.transactions.some(row=>row.type==='income'&&row.category===incomeCategory.id));
      assert.deepEqual(moneySnapshot(withIncome),moneySnapshot(before));

      // Switching direction must not trap an already selected category chip.
      await transactions(page);
      await page.getByTestId('transactions-filter-button').click();
      const filter=page.getByTestId('transaction-filter-sheet');
      await filter.waitFor();
      await tap(filter.getByRole('button',{name:/^Categories:/}));
      await tap(filter.getByRole('button',{name:'Photography',exact:true}));
      await tap(filter.getByRole('button',{name:'+ Income',exact:true}));
      const expenseChip=filter.getByRole('button',{name:'Photography',exact:true});
      assert.equal(await expenseChip.getAttribute('aria-pressed'),'true');
      await expenseChip.scrollIntoViewIfNeeded();
      await page.screenshot({path:`${OUT}/${theme}-filter-cross-direction.png`});
      await tap(expenseChip);
      assert.equal(await filter.getByRole('button',{name:'Photography',exact:true}).count(),0);
      await tap(filter.getByRole('button',{name:'Tutoring',exact:true}));
      await tap(filter.getByRole('button',{name:'− Expense',exact:true}));
      const incomeChip=filter.getByRole('button',{name:'Tutoring',exact:true});
      assert.equal(await incomeChip.getAttribute('aria-pressed'),'true');
      await tap(incomeChip);
      assert.equal(await filter.getByRole('button',{name:'Tutoring',exact:true}).count(),0);
      await page.getByTestId('transaction-filter-apply').click();

      // Exercise the real download and restore controls, changing data through
      // the UI first so a no-op restore cannot accidentally satisfy the test.
      await dataScreen(page);
      const backupFile=path.join(OUT,`${theme}-backup.json`);
      const original=await backup(page,backupFile);
      assert.equal(original.data.customCategories.length,2);
      await transactions(page,'Apple Store US');
      await createAndAssign(page,'Temporary category');
      assert.equal((await page.evaluate(readPersistedLedger)).customCategories.length,3);
      await dataScreen(page);
      const chooser=page.waitForEvent('filechooser');
      await tap(page.getByText('Restore from a backup',{exact:true}));
      await (await chooser).setFiles(backupFile);
      await page.getByText('Restore backup?',{exact:true}).waitFor();
      await tap(page.getByRole('button',{name:'Restore',exact:true}));
      await page.waitForFunction(()=>JSON.parse(localStorage.getItem('wafra/state/v1'))?.customCategories?.length===2);
      await page.reload({waitUntil:'networkidle'});
      const restored=await page.evaluate(readPersistedLedger);
      assert.deepEqual(restored.customCategories,original.data.customCategories);
      assert.deepEqual(moneySnapshot(restored),moneySnapshot(original.data));
      for (const saved of original.data.transactions.filter(row=>row.category.startsWith('custom:'))) {
        assert.equal(restored.transactions.find(row=>row.id===saved.id)?.category,saved.category);
      }
      for(const name of ['Photography','Tutoring']) {
        await page.goto(`${BASE}/transactions?q=${encodeURIComponent(name)}`,{waitUntil:'networkidle'});
        await page.getByTestId('transactions-summary').waitFor();
        assert.match(await page.getByTestId('transactions-summary').innerText(),/^1 transaction\b/);
        await page.getByTestId('transaction-details-link').click();
        await page.getByRole('button',{name:`Category: ${name}`,exact:true}).waitFor();
        await page.screenshot({path:`${OUT}/${theme}-restored-${name.toLowerCase()}.png`});
      }
      assert.deepEqual(errors, []);
      results.push({ theme, passed: true, scenarios: ['expense creation','duplicate refusal','income creation','direction-filter removal','search/reload','UI backup restore'], transactions:restored.transactions.length });
    } catch (error) {
      await page.screenshot({ path: `${OUT}/${theme}-failure.png` });
      results.push({ theme, passed: false, error: String(error), errors });
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
await writeFile(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
assert.ok(results.every(r => r.passed));
