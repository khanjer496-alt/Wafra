'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {validate, compileAsk, schemas, prompts} = require('../../local-ai/qualification-contract.cjs');
const bank = {decision:'candidate',family:'purchase',direction:'debit',amount_text:'123.45',currency_text:'AED',merchant_text:'SHOP'};
const ask = {tool:'spending-total',period:null,merchant:null,category:null,excludedMerchant:null,limit:null,withinDays:null};
const bankInput = 'Paid AED 123.45 at SHOP.';
test('strict keys, explicit nulls and enums reject malformed outputs', () => {
 assert.equal(validate('bank', bankInput, bank).valid,true);
 for(const out of [{...bank,extra:1},{...bank,amount_text:123.45},{...bank,merchant_text:''},{...bank,family:'salary'}]) assert.equal(validate('bank',bankInput,out).valid,false);
 for(const out of [{...ask,extra:1},{...ask,period:''},{...ask,limit:'5'},{...ask,category:'food'},{tool:'help'}]) assert.equal(validate('ask','spending',out).valid,false);
 assert.equal(schemas.bank.additionalProperties,false); assert.match(prompts.ask,/2026-09-23/);
});
test('money grounding uses whole numeric spans rather than decimal or thousands prefixes', () => {
 for(const amount_text of ['123','23.45','123.4','3.45']) assert.equal(validate('bank',bankInput,{...bank,amount_text}).valid,false,amount_text);
 assert.equal(validate('bank','Paid AED 1,234.50 at SHOP.',{...bank,amount_text:'234.50'}).valid,false);
 assert.equal(validate('bank',bankInput,{...bank,merchant_text:'OTHER'}).valid,false);
 assert.equal(validate('bank',bankInput,{...bank,currency_text:'USD'}).valid,false);
});
test('abstentions require unknown classification and JSON null for all extracted fields', () => {
 const out={decision:'abstain',family:'unknown',direction:'unknown',amount_text:null,currency_text:null,merchant_text:null};
 assert.equal(validate('bank','Balance AED 123',out).valid,true);
 assert.equal(validate('bank',bankInput,{...out,family:'purchase'}).valid,false);
 assert.equal(validate('bank',bankInput,{...out,amount_text:'123.45'}).valid,false);
 assert.equal(validate('bank',bankInput,{...bank,amount_text:null}).valid,false);
});
test('valid calendar dates, chronological ranges and allowed argument sets are enforced', () => {
 for(const period of ['2026-02-29/2026-03-01','2026-09-24/2026-09-23','2026-13','0000','2026-9','2026-02-30/2026-03-01']) assert.equal(validate('ask','spending',{...ask,period}).valid,false,period);
 for(const period of [null,'2026-09','2026','all','2024-02-29/2024-03-01']) assert.equal(validate('ask','spending',{...ask,period}).valid,true,String(period));
 assert.equal(validate('ask','subscriptions',{...ask,tool:'subscriptions',merchant:'subscriptions'}).valid,false);
 assert.equal(validate('ask','top merchants',{...ask,tool:'top-merchants',limit:11}).valid,false);
 assert.equal(validate('ask','upcoming',{...ask,tool:'upcoming-payments',withinDays:91}).valid,false);
 assert.equal(validate('ask','help',{...ask,tool:'help',period:'all'}).valid,false);
});
test('merchant constraints must be literal complete spans and help cannot retain filters', () => {
 assert.equal(validate('ask','spending at Talabat excluding Amazon',{...ask,merchant:'Talabat',excludedMerchant:'Amazon'}).valid,true);
 assert.equal(validate('ask','spending at Talabat',{...ask,merchant:'Tala'}).valid,false);
 assert.equal(validate('ask','spending at Talabat',{...ask,merchant:'talabat'}).valid,false);
 assert.equal(validate('ask','spending at Talabat',{...ask,merchant:'Unknown'}).valid,false);
});
test('compilation preserves explicit fields and leaves null defaults absent', () => {
 assert.deepEqual(compileAsk({...ask,period:'2026-09',merchant:'SHOP',excludedMerchant:'OTHER'}),{tool:'spending-total',period:{mode:'month',key:'2026-09'},merchant:'SHOP',excludedMerchants:['OTHER']});
 assert.deepEqual(compileAsk({...ask,tool:'upcoming-payments'}),{tool:'upcoming-payments'});
 assert.deepEqual(compileAsk({...ask,tool:'help'}),{tool:'help'});
});


test('signed numeric spans cannot silently lose their sign', () => {
 assert.equal(validate('bank','Paid AED -123.45 at SHOP.',bank).valid,false);
 assert.equal(validate('bank','Paid AED -123.45 at SHOP.',{...bank,amount_text:'-123.45'}).valid,true);
});

test('fully scoped compilations also pass the existing production request validator', () => {
 const path = require('node:path');
 const load = require('./load-typescript.cjs');
 const categories = load(path.resolve(__dirname,'../../../src/lib/categories.ts'),{'@/lib/i18n':{getLanguage:()=> 'en'}});
 const boundary = load(path.resolve(__dirname,'../../../src/lib/wafra-assistant-ai.ts'),{'@/lib/categories':categories});
 for(const output of [{...ask,period:'2026-09'}, {...ask,tool:'top-merchants',period:'2026',limit:3}, {...ask,tool:'upcoming-payments',withinDays:7}, {...ask,tool:'subscriptions'}]) {
  assert.equal(validate('ask','recorded finances',output).valid,true);
  assert.equal(boundary.isAssistantToolRequest(compileAsk(output)),true,output.tool);
 }
});
