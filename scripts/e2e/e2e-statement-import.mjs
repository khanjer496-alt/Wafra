// Browser acceptance of statement setup and honest range presentation.
// Native SecureStore is unavailable on web: encrypted relay upload/drain is
// covered by statement-client-audit and capture-review-admission, not faked here.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const BASE=(process.env.BASE??'http://localhost:8126').replace(/\/$/,'');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(BASE).hostname));
const OUT=path.resolve(process.env.OUT??'artifacts/statement-import-browser');
await mkdir(OUT,{recursive:true});
const executablePath=process.env.CHROMIUM_PATH??'/opt/pw-browsers/chromium';
const browser=await chromium.launch(existsSync(executablePath)?{executablePath}:{});
const KEY='wafra/state/v1';
const results=[];
try {
 const bootstrap=await browser.newPage();
 await bootstrap.route('**/*',route=>route.request().url().startsWith(BASE+'/')?route.continue():route.abort());
 await bootstrap.goto(BASE+'/',{waitUntil:'networkidle'});
 await bootstrap.getByTestId('home-spending-total').waitFor();
 await bootstrap.waitForFunction(key=>JSON.parse(localStorage.getItem(key)??'{}').txChunks>0,KEY);
 const meta=await bootstrap.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
 await bootstrap.close();
 for(const theme of ['light','dark']) for(const privateMode of [false,true]) {
  const name=`${theme}-${privateMode?'private':'ready'}`;
  const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:theme,reducedMotion:'reduce',timezoneId:'Asia/Dubai'});
  const outbound=[];
  await context.route('**/*',route=>{
   const url=route.request().url();
   if(url.startsWith(BASE+'/')||url.startsWith('blob:')||url.startsWith('data:'))return route.continue();
   outbound.push(url);return route.abort();
  });
  await context.addInitScript(({key,state})=>{
   if(localStorage.getItem('wafra/e2e-statement-seeded'))return;
   localStorage.setItem(key,JSON.stringify(state));
   localStorage.setItem(key+':tx:0','[]');
   localStorage.setItem('wafra/e2e-statement-seeded','1');
  },{key:KEY,state:{...meta,language:'en',languagePreference:'en',themePreference:theme,privateMode,
   captureOptOut:true,dailySummary:false,ledgerMoney:{schemaVersion:2,currency:'AED',exponent:2},
   accounts:[],txChunks:0,txChunkOrder:'oldest-first',bills:[],cardDues:[],budgets:[],goals:[],historyImport:null,
   statementCoverage:[{id:'synthetic-range',sourceKey:'issuer:1234567890abcdef:card:credit:1234',label:'Test Bank Card •1234',
    startDate:'2026-01-20',endDate:'2026-08-02',format:'csv',importedAt:1}],
  }});
  const page=await context.newPage();page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  try{
   await page.goto(BASE+'/statement-import',{waitUntil:'networkidle'});
   await page.getByTestId('statement-import').waitFor();
   if(privateMode){
    await page.getByTestId('statement-private').waitFor();
    assert.equal(await page.getByRole('radio').count(),0);
    assert.equal(await page.getByTestId('statement-choose').count(),0);
   } else {
    const detect=page.getByRole('radio',{name:'Detect from file',exact:true});
    const day=page.getByRole('radio',{name:'Day / month',exact:true});
    const month=page.getByRole('radio',{name:'Month / day',exact:true});
    assert.equal(await detect.getAttribute('aria-checked'),'true');
    for(const selected of [day,month,detect]){
     await selected.scrollIntoViewIfNeeded();await selected.click();
     assert.equal(await selected.getAttribute('aria-checked'),'true');
     assert.equal(await page.getByRole('radio',{checked:true}).count(),1);
    }
    assert.equal(await page.getByTestId('statement-choose').isEnabled(),true);
    const text=await page.locator('body').innerText();
    assert.ok(text.includes('Imported transaction dates'));
    assert.ok(text.includes('Dates of imported transactions; this does not prove every transaction or month is present.'));
    assert.ok(text.includes('Test Bank Card •1234'));
    assert.ok(!text.includes('No gaps through')&&!text.includes('Missing:'));
   }
   assert.deepEqual(errors,[]);
   // No live pairing or financial upload is allowed by this acceptance suite.
   assert.ok(!outbound.some(url=>/\/v1\/(?:pair|import|sync|ack)/.test(url)));
   await page.screenshot({path:path.join(OUT,`${name}.png`),fullPage:true});
   if(!privateMode){
    await page.getByText('Imported transaction dates',{exact:true}).scrollIntoViewIfNeeded();
    assert.equal(await page.getByText('Imported transaction dates',{exact:true}).isVisible(),true);
    await page.screenshot({path:path.join(OUT,`${name}-ranges.png`),fullPage:true});
   }
   results.push({name,passed:true});console.log(`PASS ${name}`);
  }catch(error){
   results.push({name,passed:false,error:String(error),errors});
   await writeFile(path.join(OUT,`${name}-failure.txt`),await page.locator('body').innerText());
   await page.screenshot({path:path.join(OUT,`${name}-failure.png`),fullPage:true});
   console.error(`FAIL ${name}: ${error}`);
  }finally{await context.close();}
 }
}finally{
 await browser.close();
 await writeFile(path.join(OUT,'results.json'),JSON.stringify({boundary:'Browser setup, date choice, privacy and observed ranges only. Native encrypted upload/drain remains source-tested.',results},null,2));
}
const failed=results.filter(row=>!row.passed).length;
console.log(`${results.length-failed} passed, ${failed} failed`);process.exitCode=failed?1:0;
