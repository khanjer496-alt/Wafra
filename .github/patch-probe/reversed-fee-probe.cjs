'use strict';
const fs=require('fs'),vm=require('vm'),crypto=require('crypto');
const load=require(process.cwd()+'/scripts/universal-test/load-ts.cjs').createLoader();
const sms=load('@/lib/sms-parser'),launch=load('@/lib/launch-alert-parser'),capture=load('@/lib/auto-import'),history=load('@/lib/historical-import');
load('@/lib/country').setActiveCountry('AE');load('@/lib/markets').setActiveMarket('AE');load('@/lib/markets').setLedgerCurrency('AED',2);
const resources=require(process.cwd()+'/scripts/generate-ios-background-parser.cjs').buildParserResources();
const native={};vm.runInNewContext(resources.bundle,native);const meta=resources.metadata;
const at=Date.parse('2026-11-14T10:00:00Z'),debit='AED 250.00 was debited from your card ending 1234 at NOON.';
const bodies=['Annual fee AED 250.00 charged\nto card 1234 was reversed.','Annual fee AED 250.00 charged\nto card 1234.','Annual fee AED 250.00 charged\nto card 1234. Your refund request for AED 40.00 is pending.'];
const rows=[];
for(const body of bodies){
 const session=launch.createLaunchAlertSession({overrides:{},activeMarket:'AE',pinnedCurrency:'AED',bestEffort:{enabled:true,country:'AE'}});
 const source=sms.parseSms(body,{}, {sender:'FAB'}),dated=sms.parseSms(body,{}, {sender:'FAB',observedAt:at}),parsed=session.parse(body,'FAB',session.inspect(body,'FAB'),undefined,at);
 const decision=capture.inspectSourceFreeRefusedAlert({source:body,sender:'FAB',observedAt:at,channel:'inbox',session,acceptedExpense:parsed?.type==='expense'?parsed:undefined});
 const record=JSON.stringify({v:1,id:crypto.createHash('sha256').update(body).digest('hex'),text:body,sender:'FAB',receivedAt:new Date(at).toISOString()});
 const imported=history.parseHistoricalMessageRecords([record],{},new Date(at),new Set(),session);
 const result=JSON.parse(native.wafraNativeAlertParse(JSON.stringify({v:1,context:{v:1,country:'AE',parserMarket:'AE',ledgerMoney:{currency:'AED',exponent:2},sourceHash:meta.sourceHash},sender:'FAB',body,observedAt:at})));
 rows.push({body,source,dated,session:parsed,decision,history:imported,native:result});
}
fs.writeFileSync(process.argv[2] || "reversed-fee-results.json",JSON.stringify({sourceHash:meta.sourceHash,bundleSha256:meta.bundleSha256,moduleCount:meta.moduleCount,nativeEngine:'Node VM; in-memory exact-source generation; not shipped resources or device',rows},null,2));
