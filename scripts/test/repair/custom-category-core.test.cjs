'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const load=require('./load-typescript.cjs');
const root=path.resolve(__dirname,'../../..');
const categories=load(path.join(root,'src/lib/categories.ts'),{'@/lib/i18n':{getLanguage:()=> 'en'}});
const custom=load(path.join(root,'src/lib/custom-categories.ts'),{'@/lib/categories':categories});
const expense=`custom:expense:${'a'.repeat(32)}`;
const income=`custom:income:${'b'.repeat(32)}`;
const catalog=[{id:expense,name:'Pet supplies',type:'expense'},{id:income,name:'Side work',type:'income'}];
test('opaque category IDs prove direction structurally but assignment also requires catalog registration',()=>{
 assert.equal(categories.isCustomCategoryId(expense),true);
 for(const value of ['custom:expense:Pet supplies','custom:expense:'+ 'a'.repeat(31),'custom:expense:'+ 'A'.repeat(32),'other'])assert.equal(categories.isCustomCategoryId(value),false);
 assert.equal(categories.categorySupportsType(expense,'expense'),true);
 assert.equal(categories.categorySupportsType(expense,'income'),false);
 assert.equal(categories.isRegisteredCategory(expense,[]),false);
 assert.equal(categories.isRegisteredCategory(expense,catalog),true);
 assert.equal(categories.categorySupportsType('other','income'),true);
});
test('display catalog is explicit and does not leak between ledgers',()=>{
 assert.equal(categories.categoryLabel(expense,'en',catalog),'Pet supplies');
 assert.equal(categories.categoryLabel(expense,'ar',[]),'فئة مخصصة');
 assert.equal(categories.getCategory(expense).label,'Custom category');
 assert.equal(categories.categoriesForType('expense',catalog).filter(x=>x.id===expense).length,1);
 assert.equal(categories.categoriesForType('income',catalog).some(x=>x.id===expense),false);
 assert.equal(categories.categoryLabel('groceries','ar',catalog),'البقالة');
});
test('names are normalized and bounded by Unicode codepoints',()=>{
 assert.equal(custom.normalizeCustomCategoryName('  Pet   supplies  '),'Pet supplies');
 assert.equal(custom.normalizeCustomCategoryName('é'.repeat(40)),'é'.repeat(40));
 for(const name of ['', ' '.repeat(3),'é'.repeat(41),'Pets\nfood','bad\u202Ename','bad\u200Bname'])assert.equal(custom.normalizeCustomCategoryName(name),null);
});
test('creation refuses builtin English/Arabic and custom duplicate names in every direction',()=>{
 for(const name of ['groceries',' البقالة ','PET SUPPLIES'])assert.deepEqual(JSON.parse(JSON.stringify(custom.prepareCustomCategory(name,'income',catalog,`custom:income:${'c'.repeat(32)}`))),{ok:false,reason:'duplicate-name'});
 const prepared=custom.prepareCustomCategory('  Family   care ','expense',catalog,`custom:expense:${'c'.repeat(32)}`);
 assert.equal(prepared.ok,true);assert.equal(prepared.category.name,'Family care');
 assert.equal(prepared.category.id.includes('Family'),false);
});
test('catalog limits, matching ID direction, duplicates and normalized storage are validated',()=>{
 assert.equal(custom.isValidCustomCategoryCatalog(catalog),true);
 for(const value of [null,[{...catalog[0],type:'income'}],[catalog[0],catalog[0]],[{...catalog[0],name:'Groceries'}],[{...catalog[0],name:' Pet supplies'}]])assert.equal(custom.isValidCustomCategoryCatalog(value),false);
 const full=Array.from({length:100},(_,index)=>({id:`custom:expense:${index.toString(16).padStart(32,'0')}`,name:`Item ${index}`,type:'expense'}));
 assert.equal(custom.isValidCustomCategoryCatalog(full),true);
 assert.equal(custom.prepareCustomCategory('Extra','expense',full,expense).reason,'limit');
 assert.equal(custom.isValidCustomCategoryCatalog([...full,{id:expense,name:'Extra',type:'expense'}]),false);
});
