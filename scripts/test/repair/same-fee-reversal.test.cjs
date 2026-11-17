'use strict';
const fs=require('fs'),vm=require('vm'),crypto=require('crypto');
const root=require('node:path').resolve(__dirname,'../../..');
const load=require(root+'/scripts/universal-test/load-ts.cjs').createLoader();
const sms=load('@/lib/sms-parser'),launch=load('@/lib/launch-alert-parser'),capture=load('@/lib/auto-import'),history=load('@/lib/historical-import');
load('@/lib/country').setActiveCountry('AE');load('@/lib/markets').setActiveMarket('AE');load('@/lib/markets').setLedgerCurrency('AED',2);
const resources={bundle:fs.readFileSync(root+'/'+'modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.js','utf8'),metadata:JSON.parse(fs.readFileSync(root+'/'+'modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.meta.json','utf8'))};
const native={};vm.runInNewContext(resources.bundle,native);const meta=resources.metadata;
const at=Date.parse('2026-11-14T10:00:00Z'),debit='AED 250.00 was debited from your card ending 1234 at NOON.';
const bodies=['Annual fee AED 250.00 charged\nto card 1234 was reversed.','Annual fee AED 250.00 charged\nto card 1234.','Annual fee AED 250.00 charged\nto card 1234. Your refund request for AED 40.00 is pending.'];
const assert=require('node:assert/strict'); const rows=[];
for(const body of bodies.flatMap(body=>[body,body.replace(/\n/g,' '),body.replace(' was reversed','\nwas reversed')])){
 const session=launch.createLaunchAlertSession({overrides:{},activeMarket:'AE',pinnedCurrency:'AED',bestEffort:{enabled:true,country:'AE'}});
 const source=sms.parseSms(body,{}, {sender:'FAB'}),dated=sms.parseSms(body,{}, {sender:'FAB',observedAt:at}),parsed=session.parse(body,'FAB',session.inspect(body,'FAB'),undefined,at);
 const decision=capture.inspectSourceFreeRefusedAlert({source:body,sender:'FAB',observedAt:at,channel:'inbox',session,acceptedExpense:parsed?.type==='expense'?parsed:undefined});
 const record=JSON.stringify({v:1,id:crypto.createHash('sha256').update(body).digest('hex'),text:body,sender:'FAB',receivedAt:new Date(at).toISOString()});
 const imported=history.parseHistoricalMessageRecords([record],{},new Date(at),new Set(),session);
 const result=JSON.parse(native.wafraNativeAlertParse(JSON.stringify({v:1,context:{v:1,country:'AE',parserMarket:'AE',ledgerMoney:{currency:'AED',exponent:2},sourceHash:meta.sourceHash},sender:'FAB',body,observedAt:at})));
 if(body.includes('was reversed')) {
   for(const item of [source,dated,parsed,...imported.parsed]) assert.notEqual(item?.type,'expense','same fee reversal cannot post a debit');
   assert.ok(result.route!=='parsed' || result.notification.direction!=='debit','native same fee reversal cannot post debit');
   assert.ok(imported.parsed.some(x=>x.type==='income'&&x.amountFils===25000&&x.currency==='AED') || imported.reviewCandidates.some(x=>x.event?.status==='informational'&&x.event?.amount?.value?.minorUnits==='25000'), 'owned AED250 reversal stays visible under existing credit policy');
 } else {
   for(const item of [source,dated,parsed,imported.parsed[0]]) { assert.equal(item?.type,'expense');assert.equal(item.amountFils,25000); }
   assert.equal(result.notification?.direction,'debit');assert.equal(result.notification.amount.minorUnits,'25000');
   if(body.includes('pending')) assert.ok(imported.reviewCandidates.some(x=>x.event?.amount?.value?.minorUnits==='4000'&&x.event.status==='informational'),'separate pending refund owns40');
 }
 rows.push({body,source,dated,session:parsed,decision,history:imported,native:result});
}
console.log(JSON.stringify({cases:rows.length,sourceHash:meta.sourceHash}));
