'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..');const load=require('../../universal-test/load-ts.cjs').createLoader();
const sms=load('@/lib/sms-parser'),launch=load('@/lib/launch-alert-parser'),semantic=load('@/lib/bank-alert-interpreter'),history=load('@/lib/historical-import'),capture=load('@/lib/auto-import'),tray=load('@/lib/alert-review-tray');
const meta=JSON.parse(fs.readFileSync(path.join(root,'modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.meta.json'),'utf8'));const native={};vm.runInNewContext(fs.readFileSync(path.join(root,'modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.js'),'utf8'),native);
const at=Date.parse('2026-11-14T10:00:00Z');const fixtures=require('./credit-settlement-review-probes.json');
function run(body,sender,pinned){
 load('@/lib/country').setActiveCountry('AE');load('@/lib/markets').setActiveMarket('AE');load('@/lib/markets').setLedgerCurrency(pinned,2);
 const session=launch.createLaunchAlertSession({overrides:{},activeMarket:'AE',pinnedCurrency:pinned,bestEffort:{enabled:true,country:'AE'}});
 const source=sms.parseSms(body,{}, {sender,observedAt:at});const direct=semantic.interpretBankAlert({source:body,sender,market:'AE',observedAt:at});const parsed=session.parse(body,sender,session.inspect(body,sender),undefined,at);
 const input=JSON.stringify({v:1,id:crypto.createHash('sha256').update(body+sender).digest('hex'),text:body,sender,receivedAt:new Date(at).toISOString()});
 const imported=history.parseHistoricalMessageRecords([input],{},new Date(at),new Set(),session);
 const candidate=capture.inspectSourceFreeRefusedAlert({source:body,sender,observedAt:at,channel:'inbox',session,acceptedExpense:parsed?.type==='expense'?parsed:undefined});
 const result=JSON.parse(native.wafraNativeAlertParse(JSON.stringify({v:1,context:{v:1,country:'AE',parserMarket:'AE',ledgerMoney:pinned?{currency:pinned,exponent:2}:null,sourceHash:meta.sourceHash},body,sender,observedAt:at})));
 return {source,direct,parsed,imported,candidate,native:result};
}
const generic=fixtures.find(x=>x.id==='reviewer-0dd-control:09');
for(const pinned of ['AED',null])for(const sender of ['ENBD',''])test(`generic refund: ${pinned||'unset'} ledger, ${sender||'blank'} sender preserves source/direct/session/History debit`,()=>{
 const r=run(generic.body,sender,pinned);assert.equal(r.direct.outcome,'parsed');
 for(const p of [r.source,r.direct.parsed,r.parsed,r.imported.parsed[0]]){assert.equal(p?.type,'expense');assert.equal(p.amountFils,25000);assert.equal(p.currency,'AED');}
 assert.equal(r.imported.parsed.length,1);assert.equal(r.imported.reviewCandidates.length,1);
 const note=r.imported.reviewCandidates[0];assert.equal(note.kind,'universal');assert.equal(note.event.status,'informational');assert.equal(note.event.direction,'none');assert.equal(note.event.amount.value,null);assert.equal(tray.isMoneyMovementReview(note),false);
 assert.equal(r.candidate.kind,'review');assert.equal(r.candidate.candidate.event.direction,'none');assert.equal(r.candidate.candidate.event.amount.value,null);
 assert.equal(r.native.route,pinned?'parsed':'ignore');if(pinned){assert.equal(r.native.notification.direction,'debit');assert.deepEqual(r.native.notification.amount,{currency:'AED',minorUnits:'25000',exponent:2});}
});
for(const id of ['reviewer-0dd-control:10','note-apposition-money:4'])for(const pinned of ['AED',null])test(`${id}: ${pinned||'unset'} ledger retains proven owned credit`,()=>{
 const f=fixtures.find(x=>x.id===id);const r=run(f.body,'ENBD',pinned);assert.equal(r.direct.outcome,'parsed');
 for(const p of [r.source,r.direct.parsed,r.parsed,r.imported.parsed[0]]){assert.equal(p?.type,'income');assert.equal(p.amountFils,25000);assert.equal(p.currency,'AED');}
 assert.equal(r.imported.parsed.length,1);assert.equal(r.imported.reviewCandidates.length,0);assert.equal(r.native.route,pinned?'review':'ignore');if(pinned)assert.equal(r.native.notification.direction,'credit');
});
const held=require('./refund-matrix-oracle.cjs').buildOracleRows().filter(r=>r.lang==='EN'&&r.rule.startsWith('D8')&&((r.case.subject==='a refund of the same'&&r.case.verb==='processed and credited')||(r.case.subject==='merchant'&&r.case.verb==='refunded')));
assert.equal(held.length,8);
for(const f of held)for(const pinned of ['AED',null])test(`${f.id}: ${pinned||'unset'} ledger keeps existing exact-money hold`,()=>{
 const r=run(f.body,'ENBD',pinned);assert.equal(r.source,null);assert.equal(r.parsed,null);assert.equal(r.direct.outcome,f.case.subject==='merchant'?'refuse':'review');assert.equal(r.imported.parsed.length,0);assert.equal(r.imported.reviewCandidates.length,1);
 const item=r.imported.reviewCandidates[0];assert.equal(item.event.status,'informational');assert.equal(item.event.direction,'credit');assert.deepEqual(item.event.amount.value,{currency:'AED',minorUnits:'25000',exponent:2});assert.ok(item.event.issues.includes('unsettled-credit-not-posting'));assert.equal(tray.isMoneyMovementReview(item),false);assert.equal(r.native.route,pinned?'review':'ignore');
});
for(const pinned of ['AED',null])test(`pending40: ${pinned||'unset'} ledger preserves separate debit and its own note`,()=>{
 const body='AED 250.00 was debited from your card ending 1234 at NOON. Your refund request for AED 40.00 is pending.';const r=run(body,'ENBD',pinned);assert.equal(r.parsed?.type,'expense');assert.equal(r.parsed.amountFils,25000);assert.equal(r.imported.parsed.length,1);assert.equal(r.imported.reviewCandidates[0].event.direction,'none');assert.equal(r.imported.reviewCandidates[0].event.amount.value.minorUnits,'4000');assert.equal(tray.isMoneyMovementReview(r.imported.reviewCandidates[0]),false);
});
