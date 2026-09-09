// Uses the existing opt-in E2E demo build. Never connects to an inbox.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://127.0.0.1:8126';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(BASE).hostname), 'Synthetic local app only');
const OUT = process.env.EVIDENCE_DIR ?? 'artifacts/e2e-transaction-ui';
mkdirSync(OUT, { recursive: true });
const results = [];
const browser = await chromium.launch();
async function exposed(locator, page) {
  assert.equal(await locator.count(), 1, 'Expected exactly one action');
  const geometry = await locator.evaluate(node => {
    const r = node.getBoundingClientRect(), p = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height, hit:!!p && (p === node || node.contains(p)) };
  });
  const viewport = page.viewportSize();
  assert.ok(geometry.width > 20 && geometry.height >= 44, JSON.stringify(geometry));
  assert.ok(geometry.x >= -1 && geometry.y >= -1 && geometry.right <= viewport.width + 1 && geometry.bottom <= viewport.height + 1 && geometry.hit, JSON.stringify(geometry));
}
try {
  for (const [width,height,theme] of [[360,780,'dark'],[390,844,'light'],[320,568,'dark'],[390,420,'dark']]) {
    const name = `${width}x${height}-${theme}`;
    const page = await browser.newPage({ viewport:{width,height}, colorScheme:theme, reducedMotion:'reduce' });
    const errors = [];page.on('pageerror', error => errors.push(String(error)));
    try {
      await page.goto(`${BASE}/transactions`, { waitUntil:'networkidle' });
      const summary = page.getByTestId('transactions-summary');
      await summary.waitFor({state:'visible', timeout:30000});
      const search = page.getByPlaceholder('Merchant or category', {exact:true});
      assert.equal(await page.getByText('Search transactions', {exact:true}).count(),1);
      assert.equal(await search.count(),1);
      assert.equal(await search.getAttribute('aria-label'),'Search merchants or categories');
      const inputFits = await search.evaluate(node => {
        const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),s=getComputedStyle(node);
        ctx.font=`${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
        return ctx.measureText(node.placeholder).width <= node.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) + 1;
      });
      assert.ok(inputFits, 'Search placeholder clipped');
      await search.fill('Noon');await page.waitForTimeout(350);
      await page.screenshot({path:`${OUT}/${name}-search.png`});
      await search.fill('');await page.waitForTimeout(350);
      const net=page.getByTestId('transactions-net-total');
      assert.ok((await net.innerText()).includes('Net total'));
      assert.ok(await summary.evaluate(node => node.scrollWidth <= node.clientWidth+1), 'Summary overflows');
      await page.screenshot({path:`${OUT}/${name}-transactions.png`});
      const rowLabel=await page.locator('[role="button"][aria-label]').evaluateAll(nodes => nodes.map(n=>n.getAttribute('aria-label')).find(label=>/, (?:plus|minus) .* AED$/i.test(label)));
      assert.ok(rowLabel,'No transaction row in seeded build');
      await page.getByRole('button',{name:rowLabel,exact:true}).first().click();
      const sheet=page.getByTestId('entry-detail-sheet');await sheet.waitFor({state:'visible'});
      const footer=page.getByTestId('entry-detail-actions');
      await exposed(footer.getByRole('button',{name:'Edit transaction',exact:true}),page);
      await exposed(footer.getByRole('button',{name:'Delete',exact:true}),page);
      assert.equal(await sheet.getByText('Transaction date',{exact:true}).count(),1);
      assert.equal(await sheet.getByText(/filed \d/i).count(),0);
      await page.screenshot({path:`${OUT}/${name}-detail.png`});
      const before=await footer.boundingBox();
      await sheet.evaluate(node=>{
        const scroll=[...node.querySelectorAll('div')].find(n=>n.scrollHeight>n.clientHeight+4 && /auto|scroll/.test(getComputedStyle(n).overflowY));
        if(scroll)scroll.scrollTop=scroll.scrollHeight;
      });
      await page.waitForTimeout(100);
      const after=await footer.boundingBox();assert.ok(Math.abs(after.y-before.y)<1, 'Footer moves with content');
      await footer.getByRole('button',{name:'Edit transaction',exact:true}).click();
      await exposed(footer.getByRole('button',{name:'Save changes',exact:true}),page);
      await exposed(footer.getByRole('button',{name:'Cancel',exact:true}),page);
      await page.screenshot({path:`${OUT}/${name}-edit.png`});
      await footer.getByRole('button',{name:'Cancel',exact:true}).click();
      await exposed(footer.getByRole('button',{name:'Delete',exact:true}),page);
      // One real result must not look like three transactions. The monetary
      // projection is unchanged; only identical summary/subtotal labels go.
      await page.goto(`${BASE}/transactions?merchant=Apple%20Store%20US`, { waitUntil:'networkidle' });
      await summary.waitFor({state:'visible'});
      assert.match(await summary.innerText(), /^1 transaction\b/);
      assert.equal(await page.getByTestId('transaction-details-link').count(), 1);
      assert.equal(await page.getByTestId('transactions-net-total').count(), 0);
      assert.equal(await page.getByTestId('transaction-day-total').count(), 0);
      await page.getByRole('button', { name:'Clear all filters', exact:true }).waitFor({state:'visible'});
      await page.screenshot({path:`${OUT}/${name}-single-result.png`});
      assert.deepEqual(errors,[]);
      results.push({name,passed:true,scope:height===420?'Constrained browser viewport, not a native keyboard':'Real Expo web rendering'});
    } catch (error) {
      results.push({name,passed:false,error:String(error),pageErrors:errors});
      await page.screenshot({path:`${OUT}/${name}-failure.png`}).catch(()=>{});
    } finally {await page.close();writeFileSync(`${OUT}/browser-results.json`,JSON.stringify(results,null,2));}
  }
} finally {await browser.close();}
console.log(JSON.stringify(results,null,2));
assert.ok(results.length===4 && results.every(r=>r.passed),'Transaction UI browser acceptance failed');
