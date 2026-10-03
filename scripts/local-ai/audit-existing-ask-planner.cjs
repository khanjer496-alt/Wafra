'use strict';
// Diagnostic reuse of the frozen 48-case set, not an independent holdout score.
const fs = require('node:fs');
const path = require('node:path');
const load = require('../test/repair/load-typescript.cjs');
const root = path.resolve(__dirname,'../..');
const source = path.join(root,'src/lib/wafra-assistant.ts');
const dependencies = {};
for (const [,name] of fs.readFileSync(source,'utf8').matchAll(/from '@\/lib\/([^']+)'/g)) {
 const built = path.join(root,'scripts/test/build',`${name}.js`);
 if(fs.existsSync(built)) dependencies[`@/lib/${name}`] = require(built);
}
const engine = load(source,dependencies);
const grounding = load(path.join(root,'src/lib/local-assistant-grounding.ts'),{'@/lib/wafra-assistant':engine});
const cases = require('../test/fixtures/local-ai-ask-v2.json');
const names = [...new Set(cases.flatMap(row => [row.expected.merchant,row.expected.excludedMerchant]).filter(Boolean))];
const state = {transactions:names.map((title,index) => ({id:`fixture-${index}`,title,type:'expense',category:'shopping',amountFils:1000,date:'2026-09-10',accountId:'cash'})),accounts:[{id:'cash',name:'Cash',type:'cash'}],bills:[],cardDues:[],budgets:[],notSubscriptions:[],monthStartDay:1};
const now = new Date('2026-09-23T12:00:00Z');
const selected = {mode:'month',key:'2026-07'};
const periodText = period => !period ? null : period.mode === 'month' ? period.key : period.mode === 'year' ? String(period.year) : period.mode === 'all' ? 'all' : `${period.from}/${period.to}`;
function matches(actual,expected,appDefaults = false) {
 const tool = ['merchant-breakdown','category-breakdown'].includes(actual.tool) ? 'spending-total' : actual.tool;
 if (tool !== expected.tool) return false;
 if (tool === 'help') return true;
 const allowed = new Set(['tool','period','merchant','category','excludedMerchants','limit','withinDays']);
 if(Object.keys(actual).some(key=> !allowed.has(key))) return false;
 if ((expected.period ?? selected.key) !== (periodText(actual.period) ?? selected.key)) return false;
 return (actual.merchant ?? null) === expected.merchant && (actual.category ?? null) === expected.category &&
  (actual.excludedMerchants?.[0] ?? null) === expected.excludedMerchant && (actual.excludedMerchants?.length ?? 0) <= 1 &&
  (actual.limit ?? (appDefaults && ['top-merchants','top-categories','largest-purchases'].includes(tool) ? 5 : null)) === (expected.limit ?? (appDefaults && ['top-merchants','top-categories','largest-purchases'].includes(tool) ? 5 : null)) &&
  (actual.withinDays ?? (appDefaults && tool === 'upcoming-payments' ? 30 : null)) === (expected.withinDays ?? (appDefaults && tool === 'upcoming-payments' ? 30 : null));
}
const rows = cases.map(row => {
 const actual = engine.planAssistantQuestion(state,grounding.normalizeLocalAssistantQuestion(row.text),now,null,selected);
 return {...row,actual,contractMatch:matches(actual,row.expected)};
});
const summaryFor = rows => ({supported:rows.filter(row=>row.expected.tool!=='help').length,
 strictContractRepresentationMatches:rows.filter(row=>row.expected.tool!=='help'&&matches(row.actual,row.expected)).length,
 appEquivalentScopeMatches:rows.filter(row=>row.expected.tool!=='help'&&matches(row.actual,row.expected,true)).length,
 expectedHelp:rows.filter(row=>row.expected.tool==='help').length,
 helpMatched:rows.filter(row=>row.expected.tool==='help'&&row.actual.tool==='help').length,
 appRequestsBeyondContract:rows.filter(row=>row.expected.tool==='help'&&row.actual.tool!=='help').map(row=>({id:row.id,actual:row.actual}))});
const result = {description:'Diagnostic on already-seen frozen48, not fresh qualification. Synthetic ledger intentionally seeds merchant names from expected labels; this isolates intent/date/filter behavior rather than testing merchant discovery. No AI inference or general accuracy claim. App-equivalent comparison permits actual ranking default5 and upcoming default30 but rejects extra filters. Multi-merchant OR is supported by app beyond this narrower model contract.',selectedPeriod:selected,summary:summaryFor(rows),rows};
if (process.argv[2]) fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result.summary));
if(process.argv[3]) {
 const baseline = JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
 console.log(JSON.stringify({baseline:summaryFor(baseline),changed:rows.filter(row=>JSON.stringify(row.actual)!==JSON.stringify(baseline.find(old=>old.id===row.id).actual)).map(row=>({id:row.id,matched:row.contractMatch,actual:row.actual}))},null,2));
}
