'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {createRequire}=require('node:module');const ts=require('typescript');const crypto=require('node:crypto');
const load=require('./load-typescript.cjs');const root=path.resolve(__dirname,'../../..');const build=path.join(root,'scripts/test/build');
const source=name=>path.join(root,'src/lib',`${name}.ts`);
const categories=load(source('categories'),{'@/lib/i18n':require(path.join(build,'i18n.js'))});
const custom=load(source('custom-categories'),{'@/lib/categories':categories});
const dependencies={};for(const[,dep]of fs.readFileSync(source('backup-validation'),'utf8').matchAll(/from ['"](@\/lib\/[^'"]+)['"]/g)){const candidate=path.join(build,dep.slice(6)+'.js');if(fs.existsSync(candidate))dependencies[dep]=require(candidate);}
const validate=load(source('backup-validation'),{...dependencies,'@/lib/categories':categories,'@/lib/custom-categories':custom}).isValidBackupState;
// Use the shipping store and existing platform harness; only fresh core modules
// and entropy/build gates are injected so these tests don't need a shared rebuild.
function fixture({platform='android',grant=false}={}){
 const loaderPath=path.join(root,'scripts/perf/load-store.cjs');const module={exports:{}};
 const overrides={'@/lib/categories':categories,'@/lib/custom-categories':custom,'@/lib/backup-validation':{isValidBackupState:validate},'expo-crypto':{randomUUID:crypto.randomUUID},'@/lib/founder-pro':{isAutomaticFounderProBuild:()=>grant},'react-native':{AppState:{addEventListener:()=>({remove(){}})},I18nManager:{isRTL:false,allowRTL(){},forceRTL(){}},Platform:{OS:platform}}};
 const body=fs.readFileSync(loaderPath,'utf8').replace('const resolve = (id) => {','const resolve = (id) => { if (Object.hasOwn(overrides,id)) return overrides[id];');
 Function('require','module','exports','__dirname','overrides',body)(createRequire(loaderPath),module,module.exports,path.dirname(loaderPath),overrides);
 const {reducer,store}=module.exports.loadStore();
 const hydrate=(state={})=>reducer({hydrated:false,accounts:[],transactions:[]},{type:'hydrate',state:{onboarded:true,marketId:'AE',country:'AE',language:'en',ledgerMoney:{schemaVersion:2,currency:'AED',exponent:2},accounts:[],transactions:[],...state}});
 return{reducer,hydrate,store};
}
const expense=`custom:expense:${'a'.repeat(32)}`,income=`custom:income:${'b'.repeat(32)}`,orphan=`custom:expense:${'c'.repeat(32)}`;
const catalog=[{id:expense,name:'Pet supplies',type:'expense'},{id:income,name:'Side work',type:'income'}];
const tx={id:'tx',type:'expense',amountFils:1000,category:expense,accountId:'cash',title:'Pet food',date:'2026-09-30',source:'manual'};
test('store atomically creates normalized categories, enforces duplicate/limit and reset semantics',()=>{
 const{reducer,hydrate}=fixture();let state=hydrate();state=reducer(state,{type:'createCustomCategory',category:{id:expense,name:' Pet   supplies ',type:'expense'}});
 assert.equal(state.customCategories[0].name,'Pet supplies');
 const repeated=reducer(state,{type:'createCustomCategory',category:{id:income,name:'PET SUPPLIES',type:'income'}});assert.equal(repeated.customCategories.length,1);
 const restored=reducer(state,{type:'restore',state:{...state,customCategories:catalog}});assert.equal(restored.customCategories.length,2);
 assert.equal(reducer(restored,{type:'clearAll'}).customCategories.length,0);
 assert.equal(reducer({...state,hydrated:false},{type:'createCustomCategory',category:catalog[1]}).customCategories.length,1);
});
test('all actual monetary category ingress rejects unregistered or wrong-direction custom references',()=>{
 const{reducer,hydrate}=fixture();const state=hydrate({customCategories:catalog,transactions:[tx],bills:[{id:'bill',title:'Vet',category:expense,amountFils:1000,dueDay:1,paidMonths:[]}]});
 for(const action of [
 {type:'addTransaction',transaction:{...tx,id:'new',category:orphan}},
 {type:'addTransaction',transaction:{...tx,id:'new',category:income}},
 {type:'editTransaction',id:'tx',patch:{category:orphan}},
 {type:'editTransaction',id:'tx',patch:{splits:[{category:expense,amountFils:500},{category:orphan,amountFils:500}]}},
 {type:'upsertBudget',budget:{category:income,limitFils:1000}},
 {type:'addBill',bill:{id:'newbill',title:'X',category:orphan,amountFils:100,dueDay:1,paidMonths:[]}},
 {type:'editBill',id:'bill',patch:{category:income}},
 {type:'setMerchantOverride',merchant:'shop',category:orphan,direction:'expense',applyToExisting:true},
 {type:'setBillAlias',sourceTitle:'Vet',billIdentity:'account:1234',alias:{title:'Pets',category:income},applyToExisting:false},
 {type:'promoteReviewAlert',transaction:{...tx,id:'review',category:orphan},reviewTray:state.reviewTray,ledgerMoney:state.ledgerMoney},
 {type:'setReviewTray',reviewTray:{...state.reviewTray,templateRules:[{templateKey:'test',category:orphan,type:'expense'}]}},
 {type:'importBatch',transactions:[{...tx,id:'new',category:orphan}],newAccounts:[],newDues:[],newBills:[],snapshots:{},updates:[],newHints:{},bankNames:{},cardTypes:{},lastScanTs:0},
 {type:'importBatch',transactions:[],newAccounts:[],newDues:[],newBills:[],snapshots:{},updates:[{id:'tx',type:'income'}],newHints:{},bankNames:{},cardTypes:{},lastScanTs:0},
 ])assert.throws(()=>reducer(state,action),/registered category/,action.type);
 assert.equal(state.transactions.length,1);assert.equal(state.transactions[0].amountFils,1000);
});
test('registered custom categories work in transactions, splits, budgets, bills, and scoped merchant rules',()=>{
 const{reducer,hydrate}=fixture();let state=hydrate({customCategories:catalog});
 state=reducer(state,{type:'addTransaction',transaction:tx});assert.equal(state.transactions[0].category,expense);
 state=reducer(state,{type:'editTransaction',id:'tx',patch:{splits:[{category:expense,amountFils:600},{category:'other',amountFils:400}]}});assert.equal(state.transactions[0].splits[0].category,expense);
 state=reducer(state,{type:'upsertBudget',budget:{category:expense,limitFils:2000}});assert.equal(state.budgets[0].category,expense);
 state=reducer(state,{type:'addBill',bill:{id:'bill',title:'Vet',category:expense,amountFils:1000,dueDay:1,paidMonths:[]}});assert.equal(state.bills[0].category,expense);
 state=reducer(state,{type:'setMerchantOverride',merchant:'Pet food',category:expense,direction:'expense',applyToExisting:true});assert.equal(state.merchantOverrides['expense:pet food'],expense);
 assert.equal(validate(state),true);
});
test('local hydration keeps orphan historical money and allows unrelated edits while blocking reassignment',()=>{
 const{reducer,hydrate}=fixture();const state=hydrate({transactions:[{...tx,category:orphan}],customCategories:[]});
 assert.equal(state.transactions.length,1);assert.equal(state.transactions[0].category,orphan);
 assert.equal(categories.categoryLabel(orphan,'en',state.customCategories),'Custom category');
 const edited=reducer(state,{type:'editTransaction',id:'tx',patch:{title:'Actual merchant'}});assert.equal(edited.transactions[0].category,orphan);
 assert.throws(()=>reducer(state,{type:'addTransaction',transaction:{...tx,id:'new',category:orphan}}),/registered category/);
 assert.equal(validate(state),false,'external backup must not claim an absent catalog');
});
test('backup checks every custom reference and all catalog invariants',()=>{
 const{hydrate}=fixture();const valid=hydrate({customCategories:catalog,transactions:[tx]});assert.equal(validate(valid),true);
 for(const patch of [
 {customCategories:[]},{customCategories:[{...catalog[0],type:'income'}]},
 {transactions:[{...tx,splits:[{category:expense,amountFils:500},{category:orphan,amountFils:500}]}]},
 {budgets:[{category:income,limitFils:100}]},
 {bills:[{id:'b',title:'X',category:orphan,amountFils:100,dueDay:1,paidMonths:[]}]},
 {merchantOverrides:{'income:test':expense}},
 {billAliases:{test:{title:'Other name',category:income}}},
 {reviewTray:{...valid.reviewTray,templateRules:[{category:orphan,type:'expense'}]}},
 ])assert.equal(validate({...valid,...patch}),false,JSON.stringify(patch));
 assert.equal(validate(hydrate()),true,'legacy catalog omission remains valid');
});
test('automatic founder grant only applies at native hydrate and preserves existing entitlements',()=>{
 for(const platform of ['android','ios','web']){const{reducer,hydrate}=fixture({platform,grant:true});const state=hydrate({trialStartTs:1,pro:false});assert.equal(state.founderPro,platform!=='web');assert.equal(state.pro,false);assert.equal(state.trialStartTs,1);assert.equal(reducer(state,{type:'restore',state:{...state,founderPro:false}}).founderPro,false);}
 const{hydrate}=fixture({grant:false});assert.equal(hydrate({founderPro:true}).founderPro,true);assert.equal(hydrate({founderPro:false}).founderPro,false);
 const fresh=fixture({grant:true}).hydrate();assert.equal(fresh.founderPro,true);assert.ok(fresh.trialStartTs>1);
});

function sourceCallback(name,nextName,bindings){
 const source=fs.readFileSync(path.join(root,'src/lib/store.tsx'),'utf8');
 const start=source.indexOf(`  const ${name} = useCallback`),end=source.indexOf(`  const ${nextName} = useCallback`,start);
 assert.ok(start>=0&&end>start);
 const compiled=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 return Function(...Object.keys(bindings),compiled+`\nreturn ${name};`)(...Object.values(bindings));
}
test('public create action returns only registered opaque IDs and rejects concurrent duplicate requests before rerender',()=>{
 const{reducer,hydrate}=fixture();const authoritativeState={current:hydrate()};
 const dispatch=action=>(authoritativeState.current=reducer(authoritativeState.current,action));
 const create=sourceCallback('createCustomCategory','addTransaction',{authoritativeState,dispatch,useCallback:fn=>fn,randomUUID:crypto.randomUUID,prepareCustomCategory:custom.prepareCustomCategory});
 const first=create('Pets','expense');assert.equal(first.ok,true);assert.ok(/^custom:expense:[a-f0-9]{32}$/.test(first.id));
 assert.equal(authoritativeState.current.customCategories[0].id,first.id);
 assert.deepEqual(JSON.parse(JSON.stringify(create('pets','income'))),{ok:false,reason:'duplicate-name'});
 assert.equal(authoritativeState.current.customCategories.length,1);
});
test('backup callbacks retain custom catalogs while preserving installation grant across restore and clear',()=>{
 const{reducer,hydrate,store}=fixture({grant:true});const authoritativeState={current:hydrate({customCategories:catalog,transactions:[tx],trialStartTs:1,pro:false})};
 const dispatch=action=>(authoritativeState.current=reducer(authoritativeState.current,action));
 const restore=sourceCallback('restoreBackup','loadDemoData',{authoritativeState,dispatch,useCallback:fn=>fn,parseBackupForRestore:store.parseBackupForRestore});
 const backup=JSON.stringify({app:'wafra',version:1,data:{...authoritativeState.current,founderPro:false,pro:true,trialStartTs:Date.now()}});
 assert.equal(restore(backup),true);assert.equal(authoritativeState.current.customCategories.length,2);assert.equal(authoritativeState.current.founderPro,true);assert.equal(authoritativeState.current.pro,false);assert.equal(authoritativeState.current.trialStartTs,1);
 const billing=reducer(authoritativeState.current,{type:'setPro',pro:false});assert.equal(billing.founderPro,true);
 const erased=reducer(billing,{type:'clearAll'});assert.equal(erased.founderPro,true);assert.equal(erased.customCategories.length,0);assert.equal(erased.trialStartTs,1);
});

test('orphan custom rules cannot poison automatic capture after local hydration',()=>{
 const{hydrate}=fixture();const state=hydrate({transactions:[{...tx,category:orphan}],customCategories:[],merchantOverrides:{'expense:pet food':orphan,'expense:shop':'shopping','legacy malformed':null},billAliases:{test:{title:'Old custom',category:orphan}}});
 assert.equal(state.transactions[0].category,orphan);assert.equal(state.transactions[0].amountFils,1000);
 assert.equal(state.merchantOverrides['expense:pet food'],undefined);assert.equal(state.merchantOverrides['expense:shop'],'shopping');assert.equal(state.billAliases.test,undefined);
});

test('existing builtin refund categories remain compatible at manual and import ingress',()=>{
 const{reducer,hydrate}=fixture();const state=hydrate();
 const refund={...tx,id:'refund',type:'income',category:'shopping'};
 const manual=reducer(state,{type:'addTransaction',transaction:refund});assert.equal(manual.transactions[0].category,'shopping');
 const imported=reducer(state,{type:'importBatch',importMoney:state.ledgerMoney,transactions:[{...refund,category:'dining'}],newAccounts:[],newDues:[],newBills:[],snapshots:{},updates:[],newHints:{},bankNames:{},cardTypes:{},lastScanTs:0});
 assert.equal(imported.transactions[0].category,'dining');
});
