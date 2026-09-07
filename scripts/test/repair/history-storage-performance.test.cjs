'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const load=require('./load-typescript.cjs');
const {createLedgerPersistence}=load(process.env.WAFRA_HISTORY_PERSISTENCE_SOURCE ?? path.resolve(__dirname,'../../../src/lib/ledger-persistence.ts'));
// Persistence crosses JSON/native boundaries; compare serialized records, not VM prototypes.
const equalData=(actual,expected)=>assert.deepEqual(JSON.parse(JSON.stringify(actual)),JSON.parse(JSON.stringify(expected)));
const KEY='wafra/history-perf-test';
const rows=n=>Array.from({length:n},(_,i)=>({id:`fixture-${i}`,date:'2026-09-07',ts:2000000-i,amountFils:i+1,source:'sms',title:'Synthetic purchase',accountId:'fixture',type:'expense',category:'other'}));
const progress=(status,n=0)=>({status,cursor:status==='complete'?null:{beforeDateMs:2000000-n,beforeId:100000-n},scanned:n,found:n,startedAt:1,updatedAt:2,error:status==='failed'?'page-failed':null});
const state=(transactions,status='running')=>({hydrated:true,onboarded:true,transactions,historyImport:status?progress(status,transactions.length):null});
function harness(size=4,data=new Map()) {
 const calls=[];let fail=false;
 const storage={async getItem(k){return data.get(k)??null},async multiGet(keys){return keys.map(k=>[k,data.get(k)??null])},
 async multiSet(entries){if(fail){fail=false;throw Error('injected atomic failure')}calls.push(entries.map(e=>[...e]));for(const[k,v]of entries)data.set(k,v)},
 async multiRemove(keys){for(const k of keys)data.delete(k)},async destroy(){data.clear()}};
 const chunkTransactions=transactions=>{const out=[];for(let end=transactions.length;end>0;end-=size)out.push(JSON.stringify(transactions.slice(Math.max(0,end-size),end)));return out};
 const make=()=>createLedgerPersistence({prefix:KEY,chunkSize:size,currentChunkOrder:'oldest-first',chunkTransactions,storage,migrateLegacyState:async()=>false});
 const read=()=>{const meta=JSON.parse(data.get(KEY));const chunks=Array.from({length:meta.txChunks},(_,i)=>JSON.parse(data.get(KEY+':tx:'+i)));if(meta.txChunkOrder==='oldest-first')chunks.reverse();return{meta,transactions:chunks.flat()}};
 return{p:make(),make,data,calls,read,failNext(){fail=true},chunksInLastWrite(){return calls.at(-1).filter(([key])=>key!==KEY)}};
}
test('appending older history writes the tail page, not previously saved full chunks',async()=>{
 const h=harness();await h.p.load();const all=rows(12);await h.p.save(state(all.slice(0,8)));await h.p.save(state(all));
 assert.equal(h.chunksInLastWrite().length,1);assert.equal(h.chunksInLastWrite()[0][0],KEY+':tx:2');equalData(h.read().transactions,all);assert.equal(h.read().meta.txChunkOrder,'newest-first');
});
test('partial end chunks change but preceding complete history chunks remain untouched',async()=>{
 const h=harness();await h.p.load();const all=rows(10);await h.p.save(state(all.slice(0,6)));await h.p.save(state(all));
 equalData(h.chunksInLastWrite().map(([k])=>k),[KEY+':tx:1',KEY+':tx:2']);equalData(h.read().transactions,all);
});
for(const status of ['paused','failed','running'])test(`${status} survives process restart without reversing data or rewriting committed history`,async()=>{
 const h=harness();await h.p.load();const all=rows(12);await h.p.save(state(all.slice(0,8),status));h.p=h.make();const loaded=await h.p.load();equalData(loaded.transactions,all.slice(0,8));
 await h.p.save(state([...loaded.transactions,...all.slice(8)]));assert.equal(h.chunksInLastWrite().length,1);equalData(h.read().transactions,all);
});
test('completion converts the layout even when the transaction array reference did not change',async()=>{
 const h=harness();await h.p.load();const all=rows(10);await h.p.save(state(all));await h.p.save(state(all,'complete'));
 assert.equal(h.read().meta.txChunkOrder,'oldest-first');assert.equal(h.read().meta.historyImport.status,'complete');assert.equal(h.read().meta.historyImport.cursor,null);equalData(h.read().transactions,all);
 const fresh=await h.make().load();equalData(fresh.transactions,all);
});
test('new arrivals after completion keep the pre-existing oldest-first efficiency',async()=>{
 const h=harness();await h.p.load();const all=rows(10);await h.p.save(state(all));await h.p.save(state(all,'complete'));const next=[{...all[0],id:'newest',ts:3000000},...all];
 await h.p.save(state(next,'complete'));assert.equal(h.chunksInLastWrite().length,1);equalData(h.read().transactions,next);
});
test('interleaved newer capture, healing, removal and account reassignment preserve exact rows',async()=>{
 const h=harness();await h.p.load();let all=rows(12);await h.p.save(state(all));all=[{...all[0],id:'live',ts:3000000},...all];await h.p.save(state(all));
 all=all.filter((_,i)=>i!==3).map((r,i)=>i===7?{...r,title:'Edited',userEdited:true,accountId:'other'}:r);await h.p.save(state(all));equalData(h.read().transactions,all);equalData((await h.make().load()).transactions,all);
});
test('failed final write leaves the old layout and cursor intact; retry restores all chunks',async()=>{
 const h=harness();await h.p.load();const all=rows(10);await h.p.save(state(all));const before=[...h.data];h.failNext();await assert.rejects(h.p.save(state(all,'complete')),/injected/);equalData([...h.data],before);
 await h.p.save(state(all,'complete'));assert.equal(h.chunksInLastWrite().length,3);assert.equal(h.read().meta.historyImport.status,'complete');equalData(h.read().transactions,all);
});
test('failed intermediate page cannot advance cursor or lose prior records',async()=>{
 const h=harness();await h.p.load();const all=rows(12);await h.p.save(state(all.slice(0,8)));const before=[...h.data];h.failNext();await assert.rejects(h.p.save(state(all)));equalData([...h.data],before);
 await h.p.save(state(all));assert.equal(h.chunksInLastWrite().length,3);equalData(h.read().transactions,all);
});
test('metadata-only saves after legacy hydration do not reinterpret layout',async()=>{
 const h=harness();const all=rows(8);h.data.set(KEY,JSON.stringify({txChunks:2,userName:'Fixture'}));h.data.set(KEY+':tx:0',JSON.stringify(all.slice(0,4)));h.data.set(KEY+':tx:1',JSON.stringify(all.slice(4)));
 const loaded=await h.p.load();await h.p.save({...loaded,hydrated:true,userName:'Changed'});assert.equal(h.chunksInLastWrite().length,0);assert.equal(h.read().meta.txChunkOrder,'newest-first');equalData(h.read().transactions,all);
});
test('starting history on an already populated ledger changes format once and preserves old rows',async()=>{
 const h=harness();await h.p.load();const all=rows(12);const first=all.slice(0,8);await h.p.save(state(first,null));await h.p.save(state(first));equalData(h.read().transactions,first);assert.equal(h.read().meta.txChunkOrder,'newest-first');
 await h.p.save(state(all));assert.equal(h.chunksInLastWrite().length,1);equalData(h.read().transactions,all);
});
test('empty pages, zero rows, history removal and blocked writes stay safe',async()=>{
 const h=harness();assert.equal(await h.p.save(state(rows(1))),false);await h.p.load();const all=rows(0);await h.p.save(state(all));await h.p.save(state(all,'complete'));equalData(h.read().transactions,[]);
 h.p.block();const before=[...h.data];assert.equal(await h.p.save(state(rows(4))),false);equalData([...h.data],before);
});
test('100 seeded history/live/edit/remove sequences round-trip both layouts exactly',async()=>{
 let seed=1729;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n};
 for(let sample=0;sample<100;sample++){const h=harness(1+random(8));await h.p.load();let all=rows(3+random(20));
 for(let step=0;step<8;step++){const status=['running','paused','failed','complete'][random(4)];await h.p.save(state(all,status));equalData(h.read().transactions,all);h.p=h.make();all=(await h.p.load()).transactions;
 all=all.map((r,i)=>i===random(all.length)?{...r,title:'Edited '+step}:r);if(random(2))all.push({...rows(1)[0],id:`extra-${sample}-${step}`});else all=[{...rows(1)[0],id:`live-${sample}-${step}`},...all];if(all.length>4&&random(2))all.splice(random(all.length),1);}
 }
});
