'use strict';
const fs=require('fs'),vm=require('vm'),crypto=require('crypto'),assert=require('node:assert/strict');
const load=require(process.cwd()+'/scripts/universal-test/load-ts.cjs').createLoader();
const sms=load('@/lib/sms-parser'),launch=load('@/lib/launch-alert-parser'),capture=load('@/lib/auto-import'),history=load('@/lib/historical-import'),tray=load('@/lib/alert-review-tray');
load('@/lib/country').setActiveCountry('AE');load('@/lib/markets').setActiveMarket('AE');load('@/lib/markets').setLedgerCurrency('AED',2);
const native={};vm.runInNewContext(fs.readFileSync('modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.js','utf8'),native);const meta=JSON.parse(fs.readFileSync('modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.meta.json'));
const canonical=JSON.parse(fs.readFileSync('.github/patch-probe/canonical-controls.json'));
const matrix=JSON.parse(fs.readFileSync('.github/patch-probe/matrix-controls.json')).map(x=>({...x,sender:'ENBD',kind:x.ownership==='explicit-selected-return'?'linked':'generic',noteMinorUnits:null}));
const mandatory=JSON.parse(fs.readFileSync('.github/patch-probe/mandatory-controls.json')).map(x=>({...x,kind:x.source==='income:25000'?'linked':x.history.reviewCandidates===0?'plain':'generic',noteMinorUnits:x.history.review?.amountMinorUnits??null}));
const at=Date.parse('2026-11-14T10:00:00Z');const results=[],failures=[];
for(const row of [...canonical,...matrix,...mandatory]){
 const session=launch.createLaunchAlertSession({overrides:{},activeMarket:'AE',pinnedCurrency:'AED',bestEffort:{enabled:true,country:'AE'}});
 const source=sms.parseSms(row.body,{}, {sender:row.sender}),dated=sms.parseSms(row.body,{}, {sender:row.sender,observedAt:at}),parsed=session.parse(row.body,row.sender,session.inspect(row.body,row.sender),undefined,at);
 const decision=capture.inspectSourceFreeRefusedAlert({source:row.body,sender:row.sender,observedAt:at,channel:'inbox',session,acceptedExpense:parsed?.type==='expense'?parsed:undefined});
 const record=JSON.stringify({v:1,id:crypto.createHash('sha256').update(row.id).digest('hex'),text:row.body,sender:row.sender,receivedAt:new Date(at).toISOString()});
 const imported=history.parseHistoricalMessageRecords([record],{},new Date(at),new Set(),session);
 const n=JSON.parse(native.wafraNativeAlertParse(JSON.stringify({v:1,context:{v:1,country:'AE',parserMarket:'AE',ledgerMoney:{currency:'AED',exponent:2},sourceHash:meta.sourceHash},sender:row.sender,body:row.body,observedAt:at})));
 const result={...row,source,dated,session:parsed,capture:decision,history:imported,native:n};results.push(result);
 try{
  const type=row.kind==='linked'?'income':'expense';
  for(const item of [source,dated,parsed,imported.parsed[0]]){assert.equal(item?.type,type);assert.equal(item.amountFils,25000);assert.equal(item.currency,'AED');}
  assert.equal(imported.parsed.length,1);
  assert.equal(n.route,row.kind==='linked'?'review':'parsed');assert.equal(n.notification.style,row.kind==='linked'?'review':'movement');assert.equal(n.notification.direction,row.kind==='linked'?'credit':'debit');assert.deepEqual(n.notification.amount,{currency:'AED',minorUnits:'25000',exponent:2});
  if(row.kind==='generic'){
   assert.equal(imported.reviewCandidates.length,1);const note=imported.reviewCandidates[0];assert.equal(note.kind,'universal');assert.equal(note.event.status,'informational');assert.equal(note.event.direction,'none');assert.equal(note.event.amount.value?.minorUnits??null,row.noteMinorUnits===null?null:String(row.noteMinorUnits));assert.equal(tray.isMoneyMovementReview(note),false);
   assert.equal(decision.kind,'review');assert.equal(decision.candidate.event.direction,'none');assert.equal(decision.candidate.event.status,'informational');assert.equal(decision.candidate.event.amount.value?.minorUnits??null,row.noteMinorUnits===null?null:String(row.noteMinorUnits));
  }else assert.equal(imported.reviewCandidates.length,0);
 }catch(e){failures.push({id:row.id,kind:row.kind,message:String(e.stack||e)});}
}
fs.writeFileSync('owned-split-results.json',JSON.stringify({sourceHash:meta.sourceHash,bundleSha256:meta.bundleSha256,canonicalCount:canonical.length,matrixCount:matrix.length,mandatoryCount:mandatory.length,results,failures,limits:['Exact caller results in explicit synthetic AE/AED context','Native generated JS in Node VM; not shipped Hermes0.14.1/device','No ledger mutation']},null,2));
console.log(JSON.stringify({cases:results.length,failures:failures.length}));if(failures.length)process.exitCode=1;
