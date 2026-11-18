'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),load=require(path.join(root,'scripts/universal-test/load-ts.cjs')).createLoader();
const sms=load('@/lib/sms-parser'),launch=load('@/lib/launch-alert-parser'),history=load('@/lib/historical-import'),capture=load('@/lib/auto-import'),tray=load('@/lib/alert-review-tray');
load('@/lib/country').setActiveCountry('AE');load('@/lib/markets').setActiveMarket('AE');load('@/lib/markets').setLedgerCurrency('AED',2);
const meta=JSON.parse(fs.readFileSync(path.join(root,'modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.meta.json'),'utf8')),native={};vm.runInNewContext(fs.readFileSync(path.join(root,'modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.js'),'utf8'),native);
const at=Date.parse('2026-11-14T10:00:00Z'),rows=[];
for(const c of [{"id": "9a0c9df7fea4581377a4c2284ebe284237d08225c1127f3efe68a83fc1938647", "body": "Refund of AED 125.00 has not been debited from your account.", "sender": "EmiratesNBD"}, {"id": "3af57a2df7ccdf377f497940c18b82b854f6e452ab9394d8d690af7b00bfb94d", "body": "تم إلغاء عملية الشراء بمبلغ 50 درهم لدى نون", "sender": "ADCB"}]){
 const session=launch.createLaunchAlertSession({overrides:{},activeMarket:'AE',pinnedCurrency:'AED',bestEffort:{enabled:true,country:'AE'}});
 const source=sms.parseSms(c.body,{}, {sender:c.sender,observedAt:at}),parsed=session.parse(c.body,c.sender,session.inspect(c.body,c.sender),undefined,at);
 const decision=capture.inspectSourceFreeRefusedAlert({source:c.body,sender:c.sender,observedAt:at,channel:'inbox',session});
 const imported=history.parseHistoricalMessageRecords([JSON.stringify({v:1,id:c.id,text:c.body,sender:c.sender,receivedAt:new Date(at).toISOString()})],{},new Date(at),new Set(),session);
 const result=JSON.parse(native.wafraNativeAlertParse(JSON.stringify({v:1,context:{v:1,country:'AE',parserMarket:'AE',ledgerMoney:{currency:'AED',exponent:2},sourceHash:meta.sourceHash},sender:c.sender,body:c.body,observedAt:at})));
 const row={...c,context:{country:'AE',currency:'AED',exponent:2,observedAt:at},source,session:parsed,native:result,capture:decision,historyParsed:imported.parsed,historyReviews:imported.reviewCandidates};rows.push(row);
 assert.equal(source,null,c.id);assert.equal(parsed,null,c.id);assert.equal(result.route,'ignore',c.id);assert.equal(imported.parsed.length,0,c.id);assert.ok(!imported.reviewCandidates.some(tray.isMoneyMovementReview),c.id);
}
fs.writeFileSync('named-refusal-results.json',JSON.stringify({head:process.env.GITHUB_SHA,sourceHash:meta.sourceHash,policy:'named six refusal cases; informational optional; no posting authority',limits:'new declared AE/AED replay, not unavailable historical contexts',rows},null,2));
