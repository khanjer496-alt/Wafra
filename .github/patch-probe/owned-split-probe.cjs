'use strict';
const fs=require('fs'),vm=require('vm'),crypto=require('crypto'),assert=require('node:assert/strict');
const load=require(process.cwd()+'/scripts/universal-test/load-ts.cjs').createLoader();
const sms=load('@/lib/sms-parser'),launch=load('@/lib/launch-alert-parser'),capture=load('@/lib/auto-import'),history=load('@/lib/historical-import'),tray=load('@/lib/alert-review-tray');
load('@/lib/country').setActiveCountry('AE');load('@/lib/markets').setActiveMarket('AE');load('@/lib/markets').setLedgerCurrency('AED',2);
const native={};vm.runInNewContext(fs.readFileSync('modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.js','utf8'),native);const meta=JSON.parse(fs.readFileSync('modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.meta.json'));
const canonical=JSON.parse(fs.readFileSync('.github/patch-probe/canonical-controls.json'));
const matrix=JSON.parse(fs.readFileSync('.github/patch-probe/matrix-controls.json')).map(x=>({...x,sender:'ENBD',kind:x.ownership==='explicit-selected-return'?'linked':'generic',noteMinorUnits:null}));
const mandatory=JSON.parse(fs.readFileSync('.github/patch-probe/mandatory-controls.json')).map(x=>({...x,kind:x.source==='income:25000'?'linked':x.history.reviewCandidates===0?'plain':'generic',noteMinorUnits:x.history.review?.amountMinorUnits??null}));
const at=Date.parse('2026-11-14T10:00:00Z'),now=at+1000;const results=[],failures=[];
const imp=load('@/lib/universal-import'),promotion=load('@/lib/review-promotion');
function confirmation(item){
 const e=item.event;if(!e)return {eligibilityOnly:tray.isMoneyMovementReview(item),registeredPromotionNotExercised:true};
 const amounts=[e.amount?.value,...(e.amount?.alternatives||[])].filter(Boolean);const instruments=e.instrument?.evidence==='ambiguous'?e.instrument.alternatives:[e.instrument?.value||null];
 const directions=['credit','debit'].includes(e.direction)?[e.direction]:['debit','credit'];const attempts=[];
 for(const amount of amounts)for(const instrument of instruments)for(const direction of directions){
  // Synthetic authoritative state uses source currency to isolate semantic authority
  // from unrelated FX failure. Exact historical or physical UI context is not claimed.
  const state={hydrated:true,marketId:amount.currency==='SAR'?'SA':'AE',ledgerMoney:load('@/lib/ledger-money').ledgerMoneySpec(amount.currency),reviewTray:{...tray.emptyAlertReviewTray(),pending:[item]},accounts:[{id:'synthetic-owned',kind:instrument?.kind==='card'?'card':'bank',name:'Synthetic source-bound account',last4:instrument?.last4||undefined,openingFils:0,color:'#111'}],transactions:[],budgets:[],bills:[],cardDues:[],goals:[],accountHints:{},merchantOverrides:{},lastScanTs:0};
  const choice={confirmed:true,postingStatus:'posted',amount,direction,accountId:'synthetic-owned',title:'Synthetic reviewed movement',category:'other',date:e.transactionDate?.value||'2026-11-14',sourceKey:item.sourceKey,observedAt:item.observedAt,...(instrument?{instrument}:{})};
  const command={reviewId:item.id,type:direction==='credit'?'income':'expense',title:choice.title,category:choice.category,accountId:choice.accountId,date:choice.date,betweenOwnAccounts:false,universal:{confirmed:true,postingStatus:'posted',amount,expectedSourceKey:item.sourceKey,expectedObservedAt:item.observedAt,...(instrument?{instrument}:{})}};
  attempts.push({choice,sourceCurrencyLedger:state.ledgerMoney,adapter:imp.planConfirmedUniversalImport(state,e,choice),hostPromotion:promotion.planReviewPromotion(state,command,'synthetic-tx-'+attempts.length,now),forcedStatusOnlyAdapter:imp.planConfirmedUniversalImport(state,{...e,status:'posted'},choice),forcedStatusOnlyHost:promotion.planReviewPromotion({...state,reviewTray:{...state.reviewTray,pending:[{...item,event:{...e,status:'posted'}}]}},command,'synthetic-forced-'+attempts.length,now)});
 }
 return {eligibilityOnly:tray.isMoneyMovementReview(item),fullyPopulatedAttempts:attempts,noGroundedMoneyChoice:!amounts.length};
}
for(const row of [...canonical,...matrix.map(x=>({...x,fromMatrix:true})),...mandatory]){
 const session=launch.createLaunchAlertSession({overrides:{},activeMarket:'AE',pinnedCurrency:'AED',bestEffort:{enabled:true,country:'AE'}});
 const source=sms.parseSms(row.body,{}, {sender:row.sender}),dated=sms.parseSms(row.body,{}, {sender:row.sender,observedAt:at}),parsed=session.parse(row.body,row.sender,session.inspect(row.body,row.sender),undefined,at);
 const decision=capture.inspectSourceFreeRefusedAlert({source:row.body,sender:row.sender,observedAt:at,channel:'inbox',session,acceptedExpense:parsed?.type==='expense'?parsed:undefined});
 const record=JSON.stringify({v:1,id:crypto.createHash('sha256').update(row.id).digest('hex'),text:row.body,sender:row.sender,receivedAt:new Date(at).toISOString()});
 const imported=history.parseHistoricalMessageRecords([record],{},new Date(at),new Set(),session);
 const n=JSON.parse(native.wafraNativeAlertParse(JSON.stringify({v:1,context:{v:1,country:'AE',parserMarket:'AE',ledgerMoney:{currency:'AED',exponent:2},sourceHash:meta.sourceHash},sender:row.sender,body:row.body,observedAt:at})));
 const result={...row,source,dated,session:parsed,capture:decision,history:imported,native:n};results.push(result);
 try{
  const strictCanonical=canonical.some(c=>c.kind==='linked'&&c.body===row.body&&c.sender===row.sender);
  const mayHold=row.fromMatrix&&row.kind==='linked'&&!strictCanonical;
  const isHeld=mayHold&&source===null&&dated===null&&parsed===null;
  if(isHeld){
   assert.equal(imported.parsed.length,0);assert.equal(imported.reviewCandidates.length,1);
   const held=imported.reviewCandidates[0];assert.equal(held.kind,'universal');assert.equal(held.event.status,'informational');assert.equal(held.event.direction,'credit');
   assert.deepEqual(held.event.amount.value,{currency:'AED',minorUnits:'25000',exponent:2});assert.equal(tray.isMoneyMovementReview(held),false);
   assert.ok(held.event.issues.includes('unsettled-credit-not-posting'),'actual held marker must survive');
   assert.equal(n.route,'review');assert.equal(n.notification.style,'review');assert.equal(n.notification.direction,'credit');assert.deepEqual(n.notification.amount,{currency:'AED',minorUnits:'25000',exponent:2});
   assert.equal(decision.kind,'review');assert.equal(decision.candidate.event.status,'informational');assert.equal(decision.candidate.event.direction,'credit');assert.deepEqual(decision.candidate.event.amount.value,{currency:'AED',minorUnits:'25000',exponent:2});
   result.fullConfirmation=confirmation(held);assert.ok(result.fullConfirmation.fullyPopulatedAttempts.length>0);
   for(const attempt of result.fullConfirmation.fullyPopulatedAttempts)for(const planned of [attempt.adapter,attempt.hostPromotion,attempt.forcedStatusOnlyAdapter,attempt.forcedStatusOnlyHost]){assert.equal(planned.outcome,'refused');assert.equal(planned.reason,'not-posted');}
   result.validatedRepresentation='held-owned-credit';continue;
  }
  const type=row.kind==='linked'?'income':'expense';
  for(const item of [source,dated,parsed,imported.parsed[0]]){assert.equal(item?.type,type);assert.equal(item.amountFils,25000);assert.equal(item.currency,'AED');}

  assert.equal(imported.parsed.length,1);
  assert.equal(n.route,row.kind==='linked'?'review':'parsed');assert.equal(n.notification.style,row.kind==='linked'?'review':'movement');assert.equal(n.notification.direction,row.kind==='linked'?'credit':'debit');assert.deepEqual(n.notification.amount,{currency:'AED',minorUnits:'25000',exponent:2});
  if(row.kind==='generic'){
   assert.equal(imported.reviewCandidates.length,1);const note=imported.reviewCandidates[0];assert.equal(note.kind,'universal');assert.equal(note.event.status,'informational');assert.equal(note.event.direction,'none');assert.equal(note.event.amount.value?.minorUnits??null,row.noteMinorUnits===null?null:String(row.noteMinorUnits));assert.equal(tray.isMoneyMovementReview(note),false);
   assert.equal(decision.kind,'review');assert.equal(decision.candidate.event.direction,'none');assert.equal(decision.candidate.event.status,'informational');assert.equal(decision.candidate.event.amount.value?.minorUnits??null,row.noteMinorUnits===null?null:String(row.noteMinorUnits));
  }else assert.equal(imported.reviewCandidates.length,0);
  result.validatedRepresentation=row.kind==='linked'?'posted-owned-credit':'debit-and-note';
 }catch(e){failures.push({id:row.id,kind:row.kind,message:String(e.stack||e)});}
}
const positiveBody='Purchase of AED 50.00 with card 1234 at NOON.';
const positiveEvent=load('@/lib/universal-parser').inspectUniversalBankEvent(positiveBody,{sender:'ENBD'});
const positiveItem={kind:'universal',id:'owned-positive-source-control',sourceKey:'apple_message_review_source_'+crypto.createHash('sha256').update(positiveBody).digest('hex'),observedAt:at,expiresAt:at+86400000,channel:'inbox',parserVersion:1,event:positiveEvent};
const positive=confirmation(positiveItem);if(!positive.fullyPopulatedAttempts.some(x=>x.adapter.outcome==='ready'&&x.hostPromotion.outcome==='added'))failures.push({id:'positive-bound-confirmation',positive});
const counts=results.reduce((d,x)=>(d[x.validatedRepresentation||'failed']=(d[x.validatedRepresentation||'failed']||0)+1,d),{});
fs.writeFileSync('owned-split-results.json',JSON.stringify({sourceHash:meta.sourceHash,bundleSha256:meta.bundleSha256,canonicalCount:canonical.length,matrixCount:matrix.length,mandatoryCount:mandatory.length,counts,positive,results,failures,limits:['Exact caller results in explicit synthetic AE/AED context','Native generated JS in Node VM; not shipped Hermes0.14.1/device','Full synthetic adapter/host planning; no ledger mutation']},null,2));
console.log(JSON.stringify({cases:results.length,counts,positiveReady:positive.fullyPopulatedAttempts.some(x=>x.adapter.outcome==='ready'&&x.hostPromotion.outcome==='added'),failures:failures.length}));if(failures.length)process.exitCode=1;
