'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const load=require(process.cwd()+'/scripts/universal-test/load-ts.cjs').createLoader();
const sms=load('@/lib/sms-parser'),launch=load('@/lib/launch-alert-parser'),history=load('@/lib/historical-import'),capture=load('@/lib/auto-import'),tray=load('@/lib/alert-review-tray'),imp=load('@/lib/universal-import'),promotion=load('@/lib/review-promotion'),universal=load('@/lib/universal-parser');
const cases=require('./selected-retention-cohorts.json');
const meta=JSON.parse(fs.readFileSync('modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.meta.json'));const native={};vm.runInNewContext(fs.readFileSync('modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.js','utf8'),native);
const at=Date.parse('2026-11-14T10:00:00Z'),now=at+1000;
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function confirmation(item){
 const e=item.event;if(!e)return {eligibilityOnly:tray.isMoneyMovementReview(item),registeredPromotionNotExercised:true};
 const amounts=[e.amount?.value,...(e.amount?.alternatives||[])].filter(Boolean);const instruments=e.instrument?.evidence==='ambiguous'?e.instrument.alternatives:[e.instrument?.value||null];
 const directions=['credit','debit'].includes(e.direction)?[e.direction]:['debit','credit'];const attempts=[];
 for(const amount of amounts)for(const instrument of instruments)for(const direction of directions){
  // Synthetic authoritative state uses source currency to isolate semantic authority
  // from unrelated FX failure. Exact historical or physical UI context is not claimed.
  const state={hydrated:true,marketId:amount.currency==='SAR'?'SA':'AE',ledgerMoney:load('@/lib/ledger-money').ledgerMoneySpec(amount.currency),reviewTray:{...tray.emptyAlertReviewTray(),pending:[item]},accounts:[{id:'synthetic-owned',kind:instrument?.kind==='card'?'card':'bank',name:'Synthetic source-bound account',last4:instrument?.last4||undefined,openingFils:0,color:'#111'}],transactions:[],budgets:[],bills:[],cardDues:[],goals:[],accountHints:{},merchantOverrides:{},lastScanTs:0};
  const choice={confirmed:true,postingStatus:'posted',amount,direction,accountId:'synthetic-owned',title:'Synthetic reviewed movement',category:'other',date:'2026-11-14',sourceKey:item.sourceKey,observedAt:item.observedAt,...(instrument?{instrument}:{})};
  const command={reviewId:item.id,type:direction==='credit'?'income':'expense',title:choice.title,category:choice.category,accountId:choice.accountId,date:choice.date,betweenOwnAccounts:false,universal:{confirmed:true,postingStatus:'posted',amount,expectedSourceKey:item.sourceKey,expectedObservedAt:item.observedAt,...(instrument?{instrument}:{})}};
  attempts.push({choice,sourceCurrencyLedger:state.ledgerMoney,adapter:imp.planConfirmedUniversalImport(state,e,choice),hostPromotion:promotion.planReviewPromotion(state,command,'synthetic-tx-'+attempts.length,now),forcedStatusOnlyAdapter:imp.planConfirmedUniversalImport(state,{...e,status:'posted'},choice),forcedStatusOnlyHost:promotion.planReviewPromotion({...state,reviewTray:{...state.reviewTray,pending:[{...item,event:{...e,status:'posted'}}]}},command,'synthetic-forced-'+attempts.length,now)});
 }
 return {eligibilityOnly:tray.isMoneyMovementReview(item),fullyPopulatedAttempts:attempts,noGroundedMoneyChoice:!amounts.length};
}
const out=[];
for(const row of cases)for(const country of row.contexts){
 try{
  const currency=country==='SA'?'SAR':'AED';load('@/lib/country').setActiveCountry(country);load('@/lib/markets').setActiveMarket(country);load('@/lib/markets').setLedgerCurrency(currency,2);
  const session=launch.createLaunchAlertSession({overrides:{},activeMarket:country,pinnedCurrency:currency,bestEffort:{enabled:true,country}});
  const source=sms.parseSms(row.body,{}, {sender:row.sender,observedAt:at}),parsed=session.parse(row.body,row.sender,session.inspect(row.body,row.sender),undefined,at);
  const record=JSON.stringify({v:1,id:sha(row.body+row.sender),text:row.body,sender:row.sender,receivedAt:new Date(at).toISOString()});
  const imported=history.parseHistoricalMessageRecords([record],{},new Date(at),new Set(),session);
  const decision=capture.inspectSourceFreeRefusedAlert({source:row.body,sender:row.sender,observedAt:at,channel:'inbox',session,acceptedExpense:parsed?.type==='expense'?parsed:undefined});
  const n=JSON.parse(native.wafraNativeAlertParse(JSON.stringify({v:1,body:row.body,sender:row.sender,observedAt:at,context:{v:1,country,parserMarket:country,ledgerMoney:{currency,exponent:2},sourceHash:meta.sourceHash}})));
  out.push({...row,context:{country,currency,exponent:2,observedAt:at,newExplicitContext:true},source,session:parsed,native:n,capture:decision,history:imported,reviewConfirmations:imported.reviewCandidates.map(item=>({item,confirmation:confirmation(item)}))});
 }catch(e){out.push({...row,country,error:String(e.stack||e)});}
}
// Real universal parser -> valid complete host promotion and adapter, with no storage mutation.
const body='Purchase of SAR 50.00 with card 1234 at NOON.';load('@/lib/country').setActiveCountry('SA');load('@/lib/markets').setActiveMarket('SA');load('@/lib/markets').setLedgerCurrency('SAR',2);
const event=universal.inspectUniversalBankEvent(body,{sender:'AlRajhiBank'});const key='apple_message_review_source_'+sha(body);const positive={kind:'universal',id:'positive-control-review',sourceKey:key,observedAt:at,expiresAt:at+86400000,channel:'inbox',parserVersion:1,event};
const control={body,event,result:confirmation(positive)};
const summary={head:process.env.GITHUB_SHA,sourceHash:meta.sourceHash,bundleSha256:meta.bundleSha256,cases:cases.length,contexts:out.length,errors:out.filter(x=>x.error).length,limits:['Source currency confirmation ledger isolates semantics from FX gates','No real ledger mutation, UI/device or original context reconstruction','Native JS Node VM; no shipped Hermes claim'],positiveControl:control};

if(!control.result.fullyPopulatedAttempts?.some(x=>x.adapter.outcome==='ready'&&x.hostPromotion.outcome==='added'))throw new Error('positive complete confirmation control did not reach ready/added');
if(summary.errors)throw new Error('diagnostic rows have execution errors');
console.log(JSON.stringify({cases:summary.cases,contexts:summary.contexts,errors:summary.errors,positiveReady:true}));

const assert=require('node:assert/strict');
for(const row of out){
 assert.ok(!row.error,row.error);
 const forbid=row.groups.includes('U02_pending_approval_posted')||row.groups.includes('unresolved_confirmation_capable_ar_sar_17');
 const same=row.groups.includes('U06_same_money_note_direction_policy');
 if(forbid){
  assert.equal(row.source,null,row.id+' source nonposting');assert.equal(row.session,null,row.id+' session nonposting');assert.equal(row.history.parsed.length,0,row.id+' History nonposting');
  assert.notEqual(row.native.route,'parsed',row.id+' native nonposting');
  for(const item of row.reviewConfirmations)for(const choice of item.confirmation.fullyPopulatedAttempts||[]){
   for(const result of [choice.adapter,choice.hostPromotion,choice.forcedStatusOnlyAdapter,choice.forcedStatusOnlyHost]){
    assert.equal(result.outcome,'refused',row.id+' source cannot acquire authority');assert.ok(['not-posted','ignored-event'].includes(result.reason),row.id+' semantic refusal, not fixture failure: '+result.reason);
   }
  }
 }
 if(same){
  for(const value of [row.source,row.session,...row.history.parsed])assert.notEqual(value?.type,'expense',row.id+' completed same-money return cannot remain expense');
  assert.ok(row.history.parsed.some(x=>x.type==='income'&&x.amountFils===25000&&x.currency==='AED')||row.history.reviewCandidates.some(x=>x.event?.status==='informational'&&x.event?.direction==='credit'&&x.event?.amount?.value?.minorUnits==='25000'&&x.event.amount.value.currency==='AED'),row.id+' retain owned250 return');
 }
 if(row.groups.includes('genuine_purchase_control')){ assert.equal(row.source?.type,'expense');assert.equal(row.source.amountFils,4210);assert.equal(row.session?.type,'expense');assert.equal(row.history.parsed[0]?.amountFils,4210); }
 if(row.groups.includes('independent_pending_refund_control')){
  assert.equal(row.session?.type,'expense');assert.equal(row.session.amountFils,25000);assert.ok(row.history.reviewCandidates.some(x=>x.event?.status==='informational'&&x.event.amount.value?.minorUnits==='4000'));
 }
}
console.log(JSON.stringify({policyContexts:out.length,policyBodies:cases.length,positiveConfirmationReady:true}));
