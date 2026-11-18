'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),load=require(path.join(root,'scripts/universal-test/load-ts.cjs')).createLoader();
const sms=load('@/lib/sms-parser'),launch=load('@/lib/launch-alert-parser'),semantic=load('@/lib/bank-alert-interpreter'),history=load('@/lib/historical-import'),capture=load('@/lib/auto-import'),tray=load('@/lib/alert-review-tray'),imp=load('@/lib/universal-import'),promotion=load('@/lib/review-promotion');
const at=Date.parse('2026-11-14T10:00:00Z'),now=at+1000;
const native={},meta=JSON.parse(fs.readFileSync(path.join(root,'modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.meta.json'),'utf8'));vm.runInNewContext(fs.readFileSync(path.join(root,'modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.js'),'utf8'),native);
const cases=[{"id": "fd9789c5f106162382d440f65bcd6238afed59385406bffc24f8cce1a1311eda", "target": "card", "body": "تم خصم مبلغ 250.00 درهم من بطاقتك المنتهية بـ 1234 لدى NOON.COM. تم استرداد المبلغ إلى بطاقتك."}, {"id": "8675082fde76ea261f0f65a1784bc7b4a6cd0268da79a54db9138cd9025e701d", "target": "account", "body": "تم خصم مبلغ 250.00 درهم من بطاقتك المنتهية بـ 1234 لدى NOON.COM. تم استرداد المبلغ إلى حسابك."}],negatives=[{"id": "indefinite-amount", "body": "تم خصم مبلغ 250.00 درهم من بطاقتك المنتهية بـ 1234 لدى NOON.COM. تم استرداد مبلغ إلى بطاقتك."}, {"id": "different-explicit-amount", "body": "تم خصم مبلغ 250.00 درهم من بطاقتك المنتهية بـ 1234 لدى NOON.COM. تم استرداد مبلغ 100.00 درهم إلى بطاقتك."}, {"id": "future-return", "body": "تم خصم مبلغ 250.00 درهم من بطاقتك المنتهية بـ 1234 لدى NOON.COM. سيتم استرداد المبلغ إلى بطاقتك."}, {"id": "negated-return", "body": "تم خصم مبلغ 250.00 درهم من بطاقتك المنتهية بـ 1234 لدى NOON.COM. لم يتم استرداد المبلغ إلى بطاقتك."}, {"id": "conditional-return", "body": "تم خصم مبلغ 250.00 درهم من بطاقتك المنتهية بـ 1234 لدى NOON.COM. إذا تم استرداد المبلغ إلى بطاقتك، سيظهر لاحقاً."}, {"id": "competing-debit", "body": "تم خصم مبلغ 250.00 درهم من بطاقتك المنتهية بـ 1234 لدى NOON.COM. تم خصم مبلغ 100.00 درهم من بطاقتك المنتهية بـ 5678 لدى IKEA. تم استرداد المبلغ إلى بطاقتك."}, {"id": "generic-refund-event", "body": "تم خصم مبلغ 250.00 درهم من بطاقتك المنتهية بـ 1234 لدى NOON.COM. تمت معالجة طلب الاسترداد."}];
function observe(row){
 load('@/lib/country').setActiveCountry('AE');load('@/lib/markets').setActiveMarket('AE');load('@/lib/markets').setLedgerCurrency('AED',2);
 const body=row.body,sender='ENBD',session=launch.createLaunchAlertSession({overrides:{},activeMarket:'AE',pinnedCurrency:'AED',bestEffort:{enabled:true,country:'AE'}});
 const source=sms.parseSms(body,{}, {sender}),dated=sms.parseSms(body,{}, {sender,observedAt:at}),direct=semantic.interpretBankAlert({source:body,sender,market:'AE',observedAt:at}),parsed=session.parse(body,sender,session.inspect(body,sender),undefined,at);
 const candidate=capture.inspectSourceFreeRefusedAlert({source:body,sender,observedAt:at,channel:'inbox',session,acceptedExpense:parsed?.type==='expense'?parsed:undefined});
 const imported=history.parseHistoricalMessageRecords([JSON.stringify({v:1,id:/^[a-f0-9]{64}$/.test(row.id)?row.id:crypto.createHash('sha256').update(row.id).digest('hex'),text:body,sender,receivedAt:new Date(at).toISOString()})],{},new Date(at),new Set(),session);
 const preview=JSON.parse(native.wafraNativeAlertParse(JSON.stringify({v:1,context:{v:1,country:'AE',parserMarket:'AE',ledgerMoney:{currency:'AED',exponent:2},sourceHash:meta.sourceHash},sender,body,observedAt:at})));
 return {source,dated,direct,session:parsed,capture:candidate,history:imported,native:preview};
}
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


const results=[...cases,...negatives].map(row=>({...row,result:observe(row)}));fs.writeFileSync('arabic-caller-results.json',JSON.stringify({head:process.env.GITHUB_SHA,sourceHash:meta.sourceHash,rows:results},null,2));
