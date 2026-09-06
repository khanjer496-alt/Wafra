// Synthetic identity-collision controls; these add no bank-format coverage.
const assert = require('node:assert/strict');
const { buildImportPlan } = require('./build/import-plan.js');
const { parseSms } = require('./build/sms-parser.js');
const { reconcileCaptureDuplicates } = require('./build/dedupe.js');
const { inspectUniversalBankEvent } = require('./build/universal-parser.js');
const { planConfirmedUniversalImport } = require('./build/universal-import.js');
const { prepareUniversalReviewAlert, admitPreparedReviewAlert, emptyAlertReviewTray, resolveReviewAlert, normalizeAlertReviewTray } = require('./build/alert-review-tray.js');
let passed = 0, failed = 0;
function test(name, run) { try { run(); passed++; console.log('✓ '+name); } catch(e) { failed++; console.log('✗ '+name+' '+e.message); } }
const oldTs=Date.parse('2026-07-01T10:00:00Z'),newTs=Date.parse('2026-09-05T11:00:00Z');
const account={id:'old-card',name:'Card',kind:'card',cardType:'credit',last4:'4844',openingFils:0};
const newAccount={...account,id:'new-card',last4:'9999'};
const old={id:'restored-old',source:'sms',type:'expense',amountFils:8950,accountId:account.id,category:'shopping',title:'Original Shop',date:'2026-07-01',ts:oldTs,smsKey:'ha123',captureInstrument:{last4:'4844',kind:'credit'}};
const state={hydrated:true,accounts:[account,newAccount],transactions:[old],budgets:[],bills:[],goals:[],cardDues:[],accountHints:{},merchantOverrides:{},lastScanTs:0,parserVersion:0,ledgerMoney:{schemaVersion:2,currency:'AED',exponent:2},reviewTray:emptyAlertReviewTray()};
const purchase={...parseSms('Purchase of AED 89.50 with Credit Card ending 4844 at CARREFOUR.'),amountFils:25000,merchant:'New Merchant',card:{last4:'9999',kind:'credit'},date:'2026-09-05',smsTs:newTs,sender:'ENBD',channel:'inbox',sourceEventId:'a123'};
test('reused Android provider ID adds new purchase without moving restored money',()=> { const p=buildImportPlan([purchase],state,newTs); assert.equal(p.txCount,1); assert.equal(p.batch.transactions[0].smsKey,`ha123t${newTs}`); assert.deepEqual(p.batch.updates,[]); });
test('same Android source timestamp preserves booked value across parser correction',()=> { const p=buildImportPlan([{...purchase,smsTs:oldTs,date:old.date}],state,oldTs); assert.equal(p.txCount,0); assert(p.batch.updates.every(u=>u.amountFils===undefined)); });
for(const reason of ['declined','exact-provider-duplicate']) test('reused Android ID cannot remove unrelated row: '+reason,()=> { const p=buildImportPlan([],state,newTs,undefined,[{smsTs:newTs,sender:'ENBD',channel:'inbox',sourceEventId:'a123',reason}]); assert.deepEqual(p.batch.updates,[]); });
test('hydration preserves reused IDs at distinct source times',()=>assert.equal(reconcileCaptureDuplicates([old,{...old,id:'new-row',ts:newTs,date:'2026-09-05',amountFils:25000,title:'New Merchant',captureInstrument:{last4:'9999',kind:'credit'}}]).length,2));
const event=inspectUniversalBankEvent('Purchase AED 250.00 with card ending 9999 at New Merchant on 2026-09-05.');
const confirmation={confirmed:true,postingStatus:'posted',amount:event.amount.value,direction:'debit',accountId:'new-card',title:'New Merchant',category:'shopping',date:'2026-09-05',sourceKey:'android_message_review_source_a123',observedAt:newTs};
test('generic confirmation preserves reused Android provider occurrence',()=> { const p=planConfirmedUniversalImport(state,event,confirmation); assert.equal(p.outcome,'ready'); assert.equal(p.batch.transactions[0].smsKey,`ha123t${newTs}`); });
test('generic confirmation still detects same old provider occurrence',()=>assert.equal(planConfirmedUniversalImport(state,event,{...confirmation,observedAt:oldTs}).outcome,'duplicate'));
const item=(id,ts)=>prepareUniversalReviewAlert({id,sourceKey:'android_message_review_source_a123',observedAt:ts,channel:'inbox',event});
const first=item('provider_review_original',newTs),second=item('provider_review_reused',newTs+1000);
test('review staging keeps same provider ID with distinct observed times',()=> { const a=admitPreparedReviewAlert(emptyAlertReviewTray(),first,newTs); const b=admitPreparedReviewAlert(a.state,second,newTs+1000); assert.equal(b.outcome,'admitted'); assert.equal(normalizeAlertReviewTray(b.state,newTs+1000).pending.length,2); });
test('timed dismissal suppresses only its original provider occurrence',()=> { const a=admitPreparedReviewAlert(emptyAlertReviewTray(),first,newTs); const resolved=resolveReviewAlert(a.state,first.id,'dismissed',newTs); assert.equal(resolved.tombstones[0].sourceKey,`ha123t${newTs}`); assert.equal(admitPreparedReviewAlert(resolved,second,newTs+1000).outcome,'admitted'); assert.equal(admitPreparedReviewAlert(resolved,first,newTs+1000).outcome,'duplicate'); });
test('old Android tombstone without source time cannot suppress a new source',()=> { const tray={...emptyAlertReviewTray(),tombstones:[{sourceKey:'ha123',resolvedAt:newTs,expiresAt:newTs+100000,outcome:'dismissed'}]}; assert.equal(admitPreparedReviewAlert(tray,second,newTs+1000).outcome,'admitted'); });
test('Android input without source timestamp fails before a cursor or money plan',()=>assert.throws(()=>buildImportPlan([{...purchase,smsTs:undefined}],state,newTs),/original timestamp/));
test('distinct provider IDs at identical time preserve two purchases',()=> { const p=buildImportPlan([purchase,{...purchase,sourceEventId:'a124'}],{...state,transactions:[]},newTs); assert.equal(p.txCount,2); assert.deepEqual(p.batch.transactions.map(t=>t.smsKey),[`ha123t${newTs}`,`ha124t${newTs}`]); });
test('same source legacy and composed keys reconcile once after reload',()=> { const rows=reconcileCaptureDuplicates([old,{...old,id:'new-copy',smsKey:`ha123t${oldTs}`}]); assert.equal(rows.length,1); assert.equal(rows[0].amountFils,old.amountFils); });
test('a legacy Android key with missing original time cannot suppress confirmed review',()=> assert.equal(planConfirmedUniversalImport({...state,transactions:[{...old,ts:undefined}]},event,confirmation).outcome,'ready'));
test('two old Android keys without original source time are not enough to merge money',()=>assert.equal(reconcileCaptureDuplicates([{...old,ts:undefined},{...old,id:'unknown-copy',ts:undefined}]).length,2));
for(const kind of ['billDue','cardStatement']) test('reused Android ID cannot sweep a prior purchase as '+kind,()=> { const p=buildImportPlan([{...purchase,kind}],state,newTs); assert(!p.batch.updates.some(u=>u.id===old.id&&u.remove)); });
test('decline of exact original Android event still removes a prior parser error',()=> { const p=buildImportPlan([],state,oldTs,undefined,[{smsTs:oldTs,sender:'ENBD',channel:'inbox',sourceEventId:'a123',reason:'declined'}]); assert.deepEqual(p.batch.updates,[{id:old.id,remove:true}]); });
for(const sourceKey of ['ha123t9999999999999999','ha123t-1','ha123t01','android_message_review_source_a00123']) test('malformed timed Android source fails review admission: '+sourceKey,()=> { assert.equal(prepareUniversalReviewAlert({...first,sourceKey}),null); });
test('encoded review identity cannot disagree with its original observed timestamp',()=>assert.equal(prepareUniversalReviewAlert({...first,sourceKey:`ha123t${newTs-1}`}),null));
test('generic confirmation rejects a source key encoded for a different timestamp',()=>assert.equal(planConfirmedUniversalImport(state,event,{...confirmation,sourceKey:`ha123t${newTs-1}`}).reason,'invalid-source'));
for (const sourceKey of ['ha123t01', `ha123t${oldTs}`]) {
  const unsafe = { ...old, smsKey: sourceKey, ts: newTs, date: purchase.date,
    amountFils: purchase.amountFils, title: purchase.merchant, captureInstrument: { last4:'9999', kind:'credit' } };
  test('malformed or contradictory stored key preserves both rows through hydration: '+sourceKey,()=> {
    const rows=[unsafe,{...unsafe,id:'another-money-row',viaPush:true}];
    assert.deepEqual(reconcileCaptureDuplicates(rows),rows);
  });
  test('unsafe stored Android identity cannot enter fuzzy import matching: '+sourceKey,()=> {
    const p=buildImportPlan([{...purchase,sourceEventId:undefined}],{...state,transactions:[unsafe]},newTs);
    assert.equal(p.txCount,1); assert.deepEqual(p.batch.updates,[]);
  });
}
for (const sourceEventId of ['a123t01', `a123t${oldTs}`]) {
  test('parsed invalid or contradictory Android source fails atomically: '+sourceEventId,()=>assert.throws(()=>buildImportPlan([{...purchase,sourceEventId}],state,newTs)));
  test('declined invalid or contradictory Android source fails before old-money lookup: '+sourceEventId,()=>assert.throws(()=>buildImportPlan([],state,newTs,undefined,[{smsTs:newTs,sender:'ENBD',channel:'inbox',sourceEventId,reason:'declined'}])));
}
test('conflicting restored encoded time cannot suppress an explicitly confirmed source',()=> {
  const unsafe={...old,smsKey:`ha123t${oldTs}`,ts:newTs};
  assert.equal(planConfirmedUniversalImport({...state,transactions:[unsafe]},event,{...confirmation,observedAt:oldTs}).outcome,'ready');
});
for (const smsKey of ['harchived-message', 'h'+'a'+'1'.repeat(63)]) test('existing opaque and valid Apple identities retain authoritative matching: '+smsKey,()=> {
  assert.equal(reconcileCaptureDuplicates([{...old,smsKey},{...old,id:'same-opaque-source',smsKey,ts:newTs}]).length,1);
});
test('a valid composed source with matching original time remains importable',()=> {
  assert.equal(buildImportPlan([{...purchase,sourceEventId:`a123t${newTs}`}],{...state,transactions:[]},newTs).txCount,1);
});
console.log(`\n${passed} passed, ${failed} failed`); process.exitCode=failed?1:0;
