'use strict';
const fs=require('fs'),vm=require('vm'),crypto=require('crypto');
const load=require(process.cwd()+'/scripts/universal-test/load-ts.cjs').createLoader();
const sms=load('@/lib/sms-parser'),launch=load('@/lib/launch-alert-parser'),capture=load('@/lib/auto-import'),history=load('@/lib/historical-import');
load('@/lib/country').setActiveCountry('AE');load('@/lib/markets').setActiveMarket('AE');load('@/lib/markets').setLedgerCurrency('AED',2);
const native={};vm.runInNewContext(fs.readFileSync('modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.js','utf8'),native);
const meta=JSON.parse(fs.readFileSync('modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.meta.json'));
const at=Date.parse('2026-11-14T10:00:00Z'),debit='AED 250.00 was debited from your card ending 1234 at NOON.';
const bodies=[debit,`It is false that a service charge was applied, ${debit}`,`It is false that a service charge was assessed, ${debit}`,'It is false that after a service charge was applied your card ending 1234 was charged, AED 250.00 was debited at NOON.','It is false that your card ending 1234 was charged after a service charge was applied, AED 250.00 was debited at NOON.','A service charge of AED 25.00 was debited from your account ending 1234.'];
const rows=[];
for(const base of bodies) for(const note of ['', ' Your refund request for AED 40.00 is pending.', ' Your refund, AED 100.00, has been credited to your card.']){
 const body=base+note, session=launch.createLaunchAlertSession({overrides:{},activeMarket:'AE',pinnedCurrency:'AED',bestEffort:{enabled:true,country:'AE'}});
 const source=sms.parseSms(body,{}, {sender:'ENBD'}),dated=sms.parseSms(body,{}, {sender:'ENBD',observedAt:at}),parsed=session.parse(body,'ENBD',session.inspect(body,'ENBD'),undefined,at);
 const decision=capture.inspectSourceFreeRefusedAlert({source:body,sender:'ENBD',observedAt:at,channel:'inbox',session,acceptedExpense:parsed?.type==='expense'?parsed:undefined});
 const record=JSON.stringify({v:1,id:crypto.createHash('sha256').update(body).digest('hex'),text:body,sender:'ENBD',receivedAt:new Date(at).toISOString()});
 const imported=history.parseHistoricalMessageRecords([record],{},new Date(at),new Set(),session);
 const result=JSON.parse(native.wafraNativeAlertParse(JSON.stringify({v:1,context:{v:1,country:'AE',parserMarket:'AE',ledgerMoney:{currency:'AED',exponent:2},sourceHash:meta.sourceHash},sender:'ENBD',body,observedAt:at})));
 rows.push({body,source,dated,session:parsed,decision,history:imported,native:result});
}
fs.writeFileSync('service-ownership-results.json',JSON.stringify({sourceHash:meta.sourceHash,rows},null,2));
