'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const loadTypescript=require('./load-typescript.cjs');
const root=path.resolve(__dirname,'../../..');
const cache=new Map();
const owned=new Set(['categories','custom-categories','transaction-filter','insights','dashboard-projection','recap','reimbursement-report','ledger-export','capture-toast','charge-alert','wafra-assistant','diagnostic-export','feedback','wafra-assistant-ai','on-device-assistant','motion-android-copy','merchant-spending']);
function load(name){
 if(cache.has(name))return cache.get(name);
 const file=path.join(root,'src/lib',`${name}.ts`),deps={};
 for(const [,key]of fs.readFileSync(file,'utf8').matchAll(/from ['"](@\/lib\/[^'"]+)['"]/g)){
  const dep=key.slice(6),built=path.join(root,'scripts/test/build',`${dep}.js`);
  if(owned.has(dep))deps[key]=load(dep);else if(fs.existsSync(built))deps[key]=require(built);
 }
 const result=loadTypescript(file,deps);cache.set(name,result);return result;
}
const expense=`custom:expense:${'a'.repeat(32)}`,income=`custom:income:${'b'.repeat(32)}`;
const catalog=[{id:expense,name:'School Trip 2026',type:'expense'},{id:income,name:'Freelance Work',type:'income'}];
const bank={id:'bank',name:'Everyday',kind:'bank',openingFils:0,color:'#000'};
const tx=(changes={})=>({id:'purchase',title:'Tickets',category:expense,type:'expense',amountFils:2500,accountId:'bank',source:'manual',date:'2026-09-12',...changes});
const state=(changes={})=>({hydrated:true,accounts:[bank],transactions:[tx(),tx({id:'income',type:'income',category:income,amountFils:5000,title:'Client'})],budgets:[],bills:[],goals:[],cardDues:[],merchantOverrides:{},accountHints:{},notSubscriptions:[],cancelledSubscriptions:{},customCategories:catalog,ledgerMoney:{schemaVersion:2,currency:'AED',exponent:2},marketId:'AE',lastScanTs:0,historyImport:null,transferInternalIds:[],...changes});
const now=new Date('2026-09-30T12:00:00Z');
test('search indexes explicit catalog labels and renames without mutating older indexes or totals',()=>{
 const f=load('transaction-filter'),row=tx();
 const original=f.createTransactionFilterIndex([row],'en',undefined,catalog);
 assert.ok(original.search(original.ordered('newest')[0]).includes('school trip 2026'));
 const renamed=f.createTransactionFilterIndex([row],'ar',undefined,[{...catalog[0],name:'رحلة المدرسة'}]);
 assert.ok(renamed.search(renamed.ordered('newest')[0]).includes('رحلة المدرسة'));
 assert.ok(!renamed.search(renamed.ordered('newest')[0]).includes('school trip 2026'));
 assert.ok(original.search(original.ordered('newest')[0]).includes('school trip 2026'));
 assert.equal(row.amountFils,2500);
});
test('CSV custom labels are escaped as literal spreadsheet text and money remains exact',()=>{
 const csv=load('ledger-export').buildLedgerCsv([tx()],[bank],{currency:'AED',exponent:2},[{...catalog[0],name:'=HYPERLINK("x")'}]);
 assert.match(csv,/'=HYPERLINK\(""x""\)/);
 assert.match(csv,/,25\.00,AED,/);assert.ok(!csv.includes(expense));
});
test('explicit expense report shows custom names through existing HTML escaping',()=>{
 const html=load('reimbursement-report').buildExpenseReportHtml({transactions:[tx()],accounts:[bank],currency:'AED',language:'en',from:'2026-09-01',to:'2026-09-30',customCategories:[{...catalog[0],name:'<img src=x onerror=alert(1)>'}]});
 assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
 assert.ok(!html.includes('<img src=x'));assert.ok(!html.includes('undefined'));
});
test('capture toast uses local catalog but app lock exposes no custom label',()=>{
 const toast=load('capture-toast');
 assert.ok(toast.liveCaptureToastContent(tx(),{currency:'AED',exponent:2},'en',true,catalog).message.includes(catalog[0].name));
 assert.equal(toast.liveCaptureToastContent(tx(),{currency:'AED',exponent:2},'en',false,catalog),null);
});
test('insight budget copy and category totals retain custom identity',()=>{
 const i=load('insights');
 const rows=[tx(),tx({id:'repeat',date:'2026-09-13'})];
 const summary=i.summarizeMonth(rows,{mode:'month',key:'2026-09'},new Set(['bank']),new Set());
 assert.equal(summary.expenseFils,5000);assert.equal(summary.byCategory[0].category,expense);
 const insights=i.buildInsights(rows,[{category:expense,limitFils:3000}],{mode:'month',key:'2026-09'},now,[],new Set(['bank']),new Set(),{customCategories:catalog,includeRecurringAnalysis:false});
 assert.ok(insights.some(item=>item.title.includes(catalog[0].name)));
});
test('deterministic assistant resolves custom name containing a year without interpreting it as a date',()=>{
 const a=load('wafra-assistant');
 const request=a.planAssistantQuestion(state(),'How much did I spend on School Trip 2026 this month?',now);
 assert.equal(request.tool,'category-breakdown',JSON.stringify(request));assert.equal(request.category,expense);
 assert.equal(request.period.key,'2026-09');
 const answer=a.executeAssistantTool(state(),request,now);
 assert.ok(JSON.stringify(answer).includes(catalog[0].name));
 assert.ok(JSON.stringify(answer).includes('25'));
});
test('deterministic assistant accepts registered custom filters and rejects invented IDs',()=>{
 const a=load('wafra-assistant');
 const request={tool:'income-total',period:{mode:'month',key:'2026-09'},category:income};
 const answer=a.executeAssistantTool(state(),request,now);
 assert.ok(JSON.stringify(answer).includes('50'));
 const rejected=a.executeAssistantTool(state(),{...request,category:`custom:income:${'c'.repeat(32)}`},now);
 assert.match(JSON.stringify(rejected),/could not identify every category/i);
});
test('assistant category correction preserves direction for custom income categories',()=>{
 const result=load('wafra-assistant').planAssistantCorrection(state(),'Client is Freelance Work');
 assert.equal(result.kind,'merchant-category');assert.equal(result.category,income);assert.equal(result.direction,'income');
 const mismatch=load('wafra-assistant').planAssistantCorrection(state(),'Tickets is Freelance Work');
 assert.equal(mismatch.kind,'clarification');
});

test('split-category search names the custom portion without changing allocations',()=>{
 const split=tx({category:'other',splits:[{category:expense,amountFils:1000},{category:'groceries',amountFils:1500}]});
 const index=load('transaction-filter').createTransactionFilterIndex([split],'en',undefined,catalog);
 assert.ok(index.search(index.ordered('newest')[0]).includes('school trip 2026'));
 assert.ok(index.search(index.ordered('newest')[0]).includes('groceries'));
 assert.deepEqual(split.splits.map(p=>p.amountFils),[1000,1500]);
});
test('recap category rankings name custom groups and preserve exact totals',()=>{
 const r=load('recap'),snapshot=r.projectRecap(state(),r.recapDescriptor('month','2026-09'));
 assert.ok(snapshot.topCategories.some(item=>item.label===catalog[0].name));
 assert.equal(snapshot.expenseFils??snapshot.spendingFils??snapshot.totalSpendFils,2500);
});
test('model-generated category IDs remain builtin-only',()=>{
 const ai=load('wafra-assistant-ai');
 assert.equal(ai.isAssistantToolRequest({tool:'spending-total',period:{mode:'month',key:'2026-09'},category:expense}),false);
 assert.ok(!JSON.stringify(load('on-device-assistant').ASK_PLAN_SCHEMA).includes(expense));
 assert.ok(!JSON.stringify(load('on-device-assistant').ASK_PLAN_SCHEMA).includes(catalog[0].name));
});
test('deterministic custom category matching respects explicit merchant identity',()=>{
 const a=load('wafra-assistant'),s=state({transactions:[tx({title:catalog[0].name,category:'shopping'})]});
 const merchant=a.planAssistantQuestion(s,'How much did I spend at School Trip 2026 this month?',now);
 assert.equal(merchant.tool,'merchant-breakdown');assert.equal(merchant.merchant,catalog[0].name);
 const category=a.planAssistantQuestion(s,'How much did I spend on School Trip 2026 this month?',now);
 assert.equal(category.tool,'category-breakdown');assert.equal(category.category,expense);
});


test('model fallback guard catches custom labels in quoted and explicit merchant syntax without substring guesses',()=>{
 const a=load('wafra-assistant');
 for(const question of ['School Trip 2026', 'Mystery at School Trip 2026?', '"School Trip 2026"', 'Ｓｃｈｏｏｌ  Trip 2026']) {
  assert.equal(a.hasKnownCustomCategoryMention(question,catalog),true,question);
 }
 assert.equal(a.hasKnownCustomCategoryMention('School Trip 20260',catalog),false);
 assert.equal(a.hasKnownCustomCategoryMention('School Trip 2026',[]),false);
});

test('custom labels cannot hijack ordinary income or month vocabulary',()=>{
 const a=load('wafra-assistant');
 const s=state({customCategories:[{...catalog[0],name:'Income'},{id:`custom:expense:${'d'.repeat(32)}`,type:'expense',name:'May'}]});
 const ordinaryIncome=a.planAssistantQuestion(s,'How much income did I receive this month?',now);
 assert.equal(ordinaryIncome.tool,'income-total');assert.equal(ordinaryIncome.category,undefined);
 const may=a.planAssistantQuestion(s,'How much did I spend in May?',now);
 assert.equal(may.period.key,'2026-05');
 assert.equal(may.category,undefined);
 const explicit=a.planAssistantQuestion(s,'How much did I spend on Income this month?',now);
 assert.equal(explicit.category,expense);
});

test('multiple custom and builtin category scopes survive both list orders and exclusions',()=>{
 const a=load('wafra-assistant'),food=`custom:expense:${'c'.repeat(32)}`;
 const s=state({customCategories:[{...catalog[0],name:'Pets'},{id:food,name:'Food',type:'expense'}]});
 for(const names of ['Pets and Food','Food and Pets']){
  const request=a.planAssistantQuestion(s,`How much did I spend on ${names} this month?`,now);
  assert.equal(request.tool,'spending-total',JSON.stringify(request));
  assert.deepEqual([...request.categories].sort(),[expense,food].sort());
 }
 for(const names of ['Pets and groceries','groceries and Pets']){
  const request=a.planAssistantQuestion(s,`How much did I spend on ${names} this month?`,now);
  assert.equal(request.tool,'spending-total',JSON.stringify(request));
  assert.deepEqual([...request.categories].sort(),[expense,'groceries'].sort());
 }
 const excluded=a.planAssistantQuestion(s,'How much did I spend this month excluding Food and Pets?',now);
 assert.deepEqual([...excluded.excludedCategories].sort(),[expense,food].sort());
});
