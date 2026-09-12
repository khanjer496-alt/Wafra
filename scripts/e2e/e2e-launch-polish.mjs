// Fresh exported-web qualification. Synthetic demo storage only; this is not
// native Dynamic Type, device performance, or signed-build evidence.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:18126';
const OUT = path.resolve(process.env.POLISH_EVIDENCE ?? 'docs/test-evidence/2026-09-12-security-launch-polish/browser');
const STATE = 'wafra/state/v1';
const FILTER = process.env.POLISH_CASE_FILTER ? new RegExp(process.env.POLISH_CASE_FILTER) : null;
const TEXT_STRESS = process.env.WAFRA_E2E_TEXT_STRESS === '1';
const RESULT_FILE = process.env.POLISH_RESULT_FILE ?? (TEXT_STRESS ? 'text-stress-results.json' : 'acceptance-results.json');
const PROFILES = [
  {width:390,large:false,label:'390'},
  {width:320,large:false,label:'320-default'},
  ...(TEXT_STRESS ? [{width:320,large:true,label:'320-text200'}] : []),
];
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const results = [], requests = [], errors = [], layouts = [], cdnResponses = [];
const expectedDomains = new Set(['choithrams.com','bankfab.com','emiratesnbd.com','alrajhibank.com.sa','nestogroup.com','sharafdg.com','starbucks.com']);
const words = {
  en: { home:'Home', spending:'Spending', activity:'Activity', bills:'Bills', accounts:'Accounts', privacy:'Messages & privacy', review:'Review online features', close:'Close', cancel:'Cancel' },
  ar: { home:'الرئيسية', spending:'المصروفات', activity:'العمليات', bills:'الفواتير', accounts:'الحسابات', privacy:'الرسائل والخصوصية', review:'مراجعة الميزات المتصلة', close:'إغلاق', cancel:'إلغاء' },
};
async function intercept(context, name, permitImages) {
  await context.route('**/*', route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === new URL(BASE).origin || ['data:','blob:'].includes(url.protocol)) return route.continue();
    requests.push({ scenario:name, url:url.href, resource:request.resourceType() });
    // Count AND block forbidden searches. Only fixed reviewed image domains may
    // reach the CDN; fixtures contain no actual account or message data.
    if (permitImages && url.hostname === 'cdn.brandfetch.io' && request.resourceType() === 'image' &&
      expectedDomains.has(decodeURIComponent(url.pathname.replace('/domain/', '')))) return route.continue();
    return route.abort();
  });
}
async function check(name, action, page) {
  try { const evidence=await action(); results.push({name,passed:true,evidence}); console.log('PASS '+name); }
  catch(error) { results.push({name,passed:false,error:String(error)}); console.error('FAIL '+name+': '+String(error));
    if(page) await page.screenshot({path:path.join(OUT,name.replace(/[^a-z0-9-]/gi,'-')+'-failure.png')}).catch(()=>{}); }
}
async function readState(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}'), STATE);
}
async function bigText(page) {
  await page.evaluate(() => {
    for(const node of document.querySelectorAll('div,span,p,h1,h2,h3,button,a,input')) {
      if(node.dataset.polishScaled || !([...node.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim())||node.tagName==='INPUT')) continue;
      const style=getComputedStyle(node);const size=parseFloat(style.fontSize),line=parseFloat(style.lineHeight);
      node.style.setProperty('font-size',size*2+'px','important');
      if(Number.isFinite(line))node.style.setProperty('line-height',line*2+'px','important');
      node.dataset.polishScaled='1';
    }
  });
}
async function layout(page, name) {
  const value=await page.evaluate(() => {
    const clipping=[],nameless=[];
    const exposed=node=>{for(let p=node;p;p=p.parentElement){const s=getComputedStyle(p);if(p.getAttribute('aria-hidden')==='true'||s.opacity==='0'||s.display==='none'||s.visibility==='hidden')return false;}return true;};
    const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    while(walk.nextNode()){
      const text=walk.currentNode,node=text.parentElement;
      if(!node||!text.textContent.trim()||node.closest('script,style,svg')||!exposed(node))continue;
      const box=node.getBoundingClientRect(); if(box.width<1||box.height<1)continue;
      for(const word of text.textContent.matchAll(/\S+/gu)){
        const r=document.createRange();r.setStart(text,word.index);r.setEnd(text,word.index+word[0].length);
        for(const b of r.getClientRects())if(b.width>0&&(b.left< -2||b.right>innerWidth+2||b.left<box.left-2||b.right>box.right+2)){
          clipping.push({text:text.textContent.trim(),left:b.left,right:b.right,boxLeft:box.left,boxRight:box.right});break;
        }
      }
    }
    for(const node of document.querySelectorAll('[role="button"]')){
      const box=node.getBoundingClientRect();if(!exposed(node)||box.width<1||box.height<1)continue;
      if(!node.getAttribute('aria-label')&&!node.textContent.trim())nameless.push({testId:node.dataset.testid,html:node.outerHTML.slice(0,180)});
    }
    return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,clipping,nameless};
  });
  layouts.push({name,...value});
  assert.ok(value.scrollWidth<=value.width+2,JSON.stringify(value));
  assert.deepEqual(value.clipping,[],'painted text must fit horizontally');
  assert.deepEqual(value.nameless,[],'exposed buttons need an accessible name');
}
async function shot(page,name) {await page.screenshot({path:path.join(OUT,name+'.png'),fullPage:false});}
async function surface(page, route, id, name, large) {
  await page.goto(BASE+route,{waitUntil:'networkidle'});
  await page.getByTestId(id).waitFor({state:'visible'});
  if(large) await bigText(page);
  await shot(page,name);
  await check(name,async()=>{
    const body=await page.getByTestId(id).innerText();
    assert.ok(body.trim().length>15,'populated visible content required');
    await layout(page,name);
    return {characters:body.length};
  },page);
}
try {
  const initial=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  await intercept(initial,'bootstrap',false);
  const first=await initial.newPage();await first.goto(BASE+'/',{waitUntil:'networkidle'});
  await first.getByTestId('reference-home-summary').waitFor({state:'visible'});
  await first.waitForFunction(key=>{const raw=localStorage.getItem(key);if(!raw)return false;const state=JSON.parse(raw);return state.txChunks>0&&Array.from({length:state.txChunks},(_,i)=>localStorage.getItem(key+':tx:'+i)).every(Boolean);},STATE);
  const original=await first.evaluate(()=>Object.entries(localStorage));
  const meta=JSON.parse(original.find(([key])=>key===STATE)[1]);
  const financial=original.filter(([key])=>key.startsWith(STATE+':tx:')).flatMap(([,value])=>JSON.parse(value));
  assert.ok(financial.length>30&&meta.accounts.length>1,'a populated export demo is required');
  await initial.close();
  const now=Date.now();
  const today=new Date(now).toISOString().slice(0,10);
  financial.push(...[['polish_fixed','Choithrams',11100],['polish_unknown','Fixture Health Clinic',22200]].map(([id,title,amountFils],index)=>({
    id,title,amountFils,type:'expense',category:'groceries',date:today,ts:now+index,accountId:meta.accounts[0].id,source:'manual',
  })));
  meta.txChunks=1;meta.txChunkOrder='oldest-first';meta.captureOptOut=true;meta.dailySummary=false;
  function seed(language,mode,privateMode=false){return [[STATE,JSON.stringify({...meta,language,languagePreference:language,themePreference:mode,privateMode})],[STATE+':tx:0',JSON.stringify(financial)]];}
  async function contextFor(name,{language='en',mode='light',width=390,legacy=false}={}, browserInstance=browser){
    const context=await browserInstance.newContext({viewport:{width,height:844},colorScheme:mode,locale:language==='ar'?'ar-AE':'en-US',reducedMotion:'reduce'});
    await intercept(context,name,!legacy);
    await context.addInitScript(entries=>{if(!localStorage.getItem('wafra/polish-seeded')){for(const[key,value]of entries)localStorage.setItem(key,value);localStorage.setItem('wafra/polish-seeded','1');}},seed(language,mode,legacy));
    const page=await context.newPage();page.setDefaultTimeout(12000);
    page.on('pageerror',error=>errors.push({scenario:name,error:String(error)}));
    page.on('response',async response=>{if(response.url().startsWith('https://cdn.brandfetch.io/')){const headers=await response.allHeaders();cdnResponses.push({scenario:name,url:response.url(),status:response.status(),reason:headers['x-bf-error']??null,contentType:headers['content-type']??null,location:headers.location??null});}});
    return {context,page};
  }
  for(const language of ['en','ar'])for(const mode of ['light','dark'])for(const profile of PROFILES){
    const {width,large,label}=profile;
    const prefix=`${language}-${mode}-${label}`;
    if(FILTER&&!FILTER.test(prefix))continue;
    const{context,page}=await contextFor(prefix,{language,mode,width});
    for(const[route,id,label]of [['/','reference-home-summary','home'],['/flow','spending-categories','spending'],['/flow?view=activity','spending-activity','activity'],['/bills','payment-agenda','bills'],['/wallet','account-groups','accounts']]){
      await surface(page,route,id,prefix+'-'+label,large);
    }
    await page.goto(BASE+'/settings?section=imports',{waitUntil:'networkidle'});
    await page.getByTestId('settings-imports').waitFor({state:'attached'});
    await check(prefix+'-imports-target',async()=>{
      const box=await page.getByTestId('settings-imports').boundingBox();
      assert.ok(box.y>=-10&&box.y<180,JSON.stringify(box));
      assert.equal(await page.getByRole('switch',{name:/Private Mode|Saved local-only|الوضع الخاص|تفضيل المعالجة المحلية/}).count(),0);
      return box;
    },page);
    if(large)await bigText(page);
    await shot(page,prefix+'-settings-imports');
    await context.close();
  }
  for(const language of ['en','ar']){
    const name='legacy-'+language;if(FILTER&&!FILTER.test(name))continue;const{context,page}=await contextFor(name,{language,legacy:true});
    await page.goto(BASE+'/wallet',{waitUntil:'networkidle'});await page.getByTestId('account-groups').waitFor({state:'visible'});
    await check(name+'-logos-blocked',async()=>assert.equal(requests.filter(item=>item.scenario===name&&item.url.includes('cdn.brandfetch.io')).length,0),page);
    await page.goto(BASE+'/settings?section=privacy',{waitUntil:'networkidle'});
    const dialog=page.locator('[role="dialog"]:visible').last();await dialog.waitFor({state:'visible'});
    await check(name+'-privacy-saved',async()=>{
      assert.equal((await readState(page)).privateMode,true);
      await dialog.getByRole('button',{name:words[language].review,exact:true}).scrollIntoViewIfNeeded();
      assert.equal(await dialog.getByRole('button',{name:words[language].review,exact:true}).count(),1);
    },page);
    await shot(page,name+'-privacy');
    await dialog.getByRole('button',{name:words[language].review,exact:true}).click();
    const confirmation=page.locator('[role="dialog"]:visible').last();
    await confirmation.getByRole('button',{name:words[language].cancel,exact:true}).waitFor({state:'visible'});
    await shot(page,name+'-resume-confirmation');
    await confirmation.getByRole('button',{name:words[language].cancel,exact:true}).click();
    await check(name+'-cancel-preserves-optout',async()=>assert.equal((await readState(page)).privateMode,true),page);
    await context.close();
  }
  if(!FILTER||FILTER.test('cdn-mock')){
    const{context,page}=await contextFor('cdn-mock');
    // A one-pixel synthetic PNG proves the app image branch independently of
    // provider policy/availability. It is not evidence of the actual artwork.
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
    await context.route('https://cdn.brandfetch.io/domain/**',route=>{
      const url=new URL(route.request().url());
      const domain=decodeURIComponent(url.pathname.replace('/domain/',''));
      requests.push({scenario:'cdn-mock',url:url.href,resource:route.request().resourceType(),mocked:true});
      return expectedDomains.has(domain)?route.fulfill({status:200,contentType:'image/png',body:png}):route.abort();
    });
    await page.goto(BASE+'/',{waitUntil:'networkidle'});await page.getByTestId('reference-home-summary').waitFor({state:'visible'});
    await check('bundled-merchant-images-decode',async()=>{
      const images=page.locator('[data-testid^="merchant-logo-"] img').filter({visible:true});
      await images.first().waitFor({state:'visible'});
      const dimensions=await images.evaluateAll(nodes=>Promise.all(nodes.filter(node=>node.src.startsWith(location.origin)).map(async node=>{await node.decode();return {width:node.naturalWidth,height:node.naturalHeight};})));
      assert.ok(dimensions.length>0);assert.ok(dimensions.every(value=>value.width===128&&value.height===128));return dimensions;
    },page);
    for(const[route,domain]of [['/merchant?name=Choithrams','choithrams.com'],['/wallet','bankfab.com']]){
      await page.goto(BASE+route,{waitUntil:'networkidle'});
      await check('mocked-image-renders-'+domain,async()=>{
        const img=page.locator(`img[src*="cdn.brandfetch.io/domain/${domain}"]`).first();
        await img.waitFor({state:'visible'});await img.evaluate(node=>node.decode());
        assert.equal(await img.evaluate(node=>node.naturalWidth),1);
      },page);
    }
    await context.close();
  }
  if(!FILTER||FILTER.test('cdn-live')){
    // A normal headed browser distinguishes real embedding from the provider's
    // explicit automated_traffic rejection of headless Chrome. No UA override,
    // stealth flags, token changes, or other bypass is used.
    const headed=await chromium.launch({channel:'chrome',headless:false});
    try{
      const{context,page}=await contextFor('cdn-live',{},headed);
      await page.goto(BASE+'/merchant?name=Choithrams',{waitUntil:'networkidle'});
      await check('cdn-live-choithrams-decodes',async()=>{
        const img=page.locator('img[src*="cdn.brandfetch.io/domain/choithrams.com"]').first();
        await img.waitFor({state:'visible'});await img.evaluate(node=>node.decode());
        assert.ok(await img.evaluate(node=>node.naturalWidth>0));
        await shot(page,'headed-chrome-choithrams');
        return await img.evaluate(node=>({url:node.src,width:node.naturalWidth,height:node.naturalHeight}));
      },page);
      await page.goto(BASE+'/wallet',{waitUntil:'networkidle'});await page.getByTestId('account-groups').waitFor({state:'visible'});
      await check('cdn-live-bank-logos-decode',async()=>{
        const decoded=[];
        for(const domain of ['bankfab.com','emiratesnbd.com']){
          const img=page.locator(`img[src*="cdn.brandfetch.io/domain/${domain}"]`).first();
          await img.waitFor({state:'visible'});await img.evaluate(node=>node.decode());
          decoded.push(await img.evaluate(node=>({url:node.src,width:node.naturalWidth,height:node.naturalHeight})));
        }
        assert.ok(decoded.every(img=>img.width>0));await shot(page,'headed-chrome-bank-logos');return decoded;
      },page);
      await context.close();
    }finally{await headed.close();}
  }
  await check('zero-brandfetch-searches',async()=>assert.equal(requests.filter(item=>/api\.brandfetch\.io\/v2\/search/.test(item.url)).length,0));
  await check('fixed-merchant-and-bank-CDN-requests-preserved',async()=>{
    assert.ok(requests.some(item=>item.url.includes('cdn.brandfetch.io/domain/choithrams.com')),'fixed merchant artwork requested');
    assert.ok(requests.some(item=>item.url.includes('cdn.brandfetch.io/domain/bankfab.com')),'verified bank artwork requested');
  });
  await check('no-application-errors',async()=>assert.deepEqual(errors,[]));
}catch(error){results.push({name:'run',passed:false,error:error.stack??String(error)});console.error(error);}
finally{
  await browser.close();
  await writeFile(path.join(OUT,RESULT_FILE),JSON.stringify({source:'fresh main working-tree web export; synthetic demo plus two synthetic merchants',limits:'Browser only; React Native Web Dimensions.fontScale remains 1. CSS text enlargement does not activate native large-text layout branches. Native permissions/capture/signing not exercised.',textStress:{enabled:TEXT_STRESS,cssMultiplier:TEXT_STRESS?2:1,webDimensionsFontScale:1,nativeLargeTextBranchesCovered:false},results,requests,errors,layouts,cdnResponses},null,2)+'\n');
  const failed=results.filter(row=>!row.passed).length;console.log(`${results.length-failed} passed; ${failed} failed`);process.exitCode=failed?1:0;
}
