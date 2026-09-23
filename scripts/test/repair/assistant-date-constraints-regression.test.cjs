'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname,'../../..');
const source = path.join(root,'src/lib/wafra-assistant.ts');
const dependencies = {};
for(const [,name] of fs.readFileSync(source,'utf8').matchAll(/from '@\/lib\/([^']+)'/g)) {
 const built = path.join(root,'scripts/test/build',`${name}.js`);
 if(fs.existsSync(built)) dependencies[`@/lib/${name}`] = require(built);
}
const engine = load(source,dependencies);
const grounding = load(path.join(root,'src/lib/local-assistant-grounding.ts'),{'@/lib/wafra-assistant':engine});
const format = require('../build/format.js');
const now = new Date('2026-09-23T12:00:00Z');
const selected = {mode:'month',key:'2026-07'};
const state = {transactions:[{id:'one',title:'Cedar Market',type:'expense',category:'groceries',amountFils:1000,date:'2026-09-02',accountId:'cash'}],accounts:[{id:'cash',name:'Cash',type:'cash'}],bills:[],cardDues:[],budgets:[],notSubscriptions:[],monthStartDay:1};
const plan = question => engine.planAssistantQuestion(state,grounding.normalizeLocalAssistantQuestion(question),now,null,selected);
const plain = value => JSON.parse(JSON.stringify(value));
test('ISO calendar month and explicit year are accepted instead of losing the requested scope',()=>{
 assert.deepEqual(plain(plan('How much did I spend during 2024-02?').period),{mode:'month',key:'2024-02'});
 assert.deepEqual(plain(plan('How much did I spend at Cedar Market in 2025?')),{tool:'merchant-breakdown',period:{mode:'year',year:2025},merchant:'Cedar Market'});
 assert.deepEqual(plain(plan('How much income did I receive during all time?').period),{mode:'all'});
});
test('explicit ISO months remain calendar dates with salary-day periods',()=>{
 format.setMonthStartDay(25);
 try {
  assert.deepEqual(plain(plan('How much did I spend in 2024-02?').period),{mode:'range',from:'2024-02-01',to:'2024-02-29'});
  assert.deepEqual(plain(plan('How much did I spend?').period),selected);
 } finally {format.setMonthStartDay(1);}
});
test('malformed and unsupported date constraints fail closed',()=>{
 for(const q of ['spending in 2026-13','spending in 2026-00','spending in 2026-02-30','spending in 2026-09-99','spending in 0000','spending since 2026-08','spending before 2026','spending in 2026-09x']) assert.equal(plan(q).tool,'help',q);
});
test('new date support cannot swallow unsupported amount, location or unknown-merchant constraints',()=>{
 for(const q of ['How much did I spend over 250 in 2026-08?','How much did I spend only in Abu Dhabi in 2026?','How much did I spend at Missing Shop during 2026-08?','How much did I spend during 2026-08 excluding refunded transactions?']) assert.equal(plan(q).tool,'help',q);
});
test('Arabic question punctuation does not break an existing exact phrase or discard qualifiers',()=>{
 assert.equal(plan('كم صرفت هذا الشهر؟').tool,'spending-total');
 assert.deepEqual(plain(plan('كم صرفت هذا الشهر؟').period),{mode:'month',key:'2026-09'});
 assert.equal(plan('كم صرفت هذا الشهر في الرياض؟').tool,'help');
});

test('ordinary cardinal rankings preserve limits, dates, categories and exclusions',()=>{
 const cases = [
  ['Show the eight biggest transactions for 2025.', 'largest-purchases',8,{mode:'year',year:2025}],
  ['Rank the top two categories during 2024-02.', 'top-categories',2,{mode:'month',key:'2024-02'}],
  ['Which four merchants received most of my money in 2025?', 'top-merchants',4,{mode:'year',year:2025}],
 ];
 for(const [question,tool,limit,period] of cases) {
  const result=plan(question); assert.equal(result.tool,tool,question); assert.equal(result.limit,limit,question); assert.deepEqual(plain(result.period),period,question);
 }
 const scoped=plan('For groceries in 2024-02, show the two largest purchases excluding Cedar Market.');
 assert.equal(scoped.tool,'largest-purchases');assert.equal(scoped.limit,2);assert.equal(scoped.category,'groceries');assert.deepEqual(plain(scoped.excludedMerchants),['Cedar Market']);
 for(const question of ['Show my eleven largest purchases','Rank my top two categories above 80 in 2025','Which four merchants took most of my money only in Dubai in 2025?']) assert.equal(plan(question).tool,'help',question);
});
test('income arrival and recording language preserve dates and unsupported predicates',()=>{
 for(const question of ['What income have I recorded in 2025?','How much income arrived during 2024-02?','What income was recorded in 2025?']) assert.equal(plan(question).tool,'income-total',question);
 for(const question of ['How much income arrived only in Dubai during 2024-02?','How much income arrived above 800 in 2025?','How much income did I record from Missing Employer in 2025?']) assert.equal(plan(question).tool,'help',question);
});
test('explicit selected-period language uses the UI selection instead of an old conversation month',()=>{
 for(const question of ['Total spending during my chosen reporting period.','What did I spend in the date range I selected?']) assert.deepEqual(plain(plan(question).period),selected,question);
 const prior={tool:'spending-total',period:{mode:'month',key:'2026-03'}};
 assert.deepEqual(plain(engine.planAssistantQuestion(state,'Show spending in the selected period',now,prior,selected).period),selected);
 for(const question of ['Spending in the selected period last month','Spending in the selected period over 500','Spending in the selected period only in Dubai']) assert.equal(plan(question).tool,'help',question);
});


test('normalization cannot silently drop a second ranking or an unsupported historical scope',()=>{
 for(const question of ['Show three largest purchases and the top two merchants','Show subscriptions in my selected period','Upcoming payments for my chosen date range']) assert.equal(plan(question).tool,'help',question);
});


test('income recording imperatives and raw internal markers remain unsupported',()=>{
 for(const question of ['record income','record my income','add income','record income for 2025','Can you record income for 2025?','spending selectedreportingperiod']) assert.equal(plan(question).tool,'help',question);
 assert.equal(plan('What income did I record in 2025?').tool,'income-total');
});


test('explicit numeric year is a calendar year even with a salary-day reporting boundary',()=>{
 format.setMonthStartDay(25);
 try {
  assert.deepEqual(plain(plan('Total spending in 2025').period),{mode:'range',from:'2025-01-01',to:'2025-12-31'});
  assert.deepEqual(plain(plan('Total spending in the selected period').period),selected);
 } finally {format.setMonthStartDay(1);}
});
test('two selected-period endpoints never collapse into an implicit previous-period comparison',()=>{
 assert.equal(plan('Compare spending in the selected period versus the selected period').tool,'help');
 assert.equal(plan('Compare the period I selected with my chosen period').tool,'help');
});
