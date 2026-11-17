const fs=require('fs'),vm=require('vm'),crypto=require('crypto');
const load=require(process.cwd()+'/scripts/universal-test/load-ts.cjs').createLoader();
const sms=load('@/lib/sms-parser'),launch=load('@/lib/launch-alert-parser'),interp=load('@/lib/bank-alert-interpreter'),history=load('@/lib/historical-import');
const body='AED 250.00 was debited from your card ending 1234 at NOON.COM on 12/11/2026. The refund has been credited to your card.';
const at=Date.parse('2026-11-14T10:00:00Z');const meta=JSON.parse(fs.readFileSync('modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.meta.json'));const native={};vm.runInNewContext(fs.readFileSync('modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.js','utf8'),native);const rows=[];
for(const pinned of ['AED',null])for(const sender of ['ENBD','']){
 load('@/lib/country').setActiveCountry('AE');load('@/lib/markets').setActiveMarket('AE');load('@/lib/markets').setLedgerCurrency(pinned,2);
 const session=launch.createLaunchAlertSession({overrides:{},activeMarket:'AE',pinnedCurrency:pinned,bestEffort:{enabled:true,country:'AE'}});
 const source=sms.parseSms(body,{}, {sender,observedAt:at});const direct=interp.interpretBankAlert({source:body,sender,market:'AE',observedAt:at});const parsed=session.parse(body,sender,session.inspect(body,sender),undefined,at);
 const record=JSON.stringify({v:1,id:crypto.createHash('sha256').update(body+sender).digest('hex'),text:body,sender,receivedAt:new Date(at).toISOString()});
 const imported=history.parseHistoricalMessageRecords([record],{},new Date(at),new Set(),session);
 const n=JSON.parse(native.wafraNativeAlertParse(JSON.stringify({v:1,context:{v:1,country:'AE',parserMarket:'AE',ledgerMoney:pinned?{currency:'AED',exponent:2}:null,sourceHash:meta.sourceHash},body,sender,observedAt:at})));
 rows.push({pinned,sender,source,direct,parsed,history:imported,native:n});
}
fs.writeFileSync(process.argv[2],JSON.stringify({head:'6fa41a0a65b38ff09e8076342bc19be855f377bc',sourceHash:meta.sourceHash,body,observedAt:at,rows},null,2));
