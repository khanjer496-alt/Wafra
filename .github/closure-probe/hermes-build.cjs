const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
const helper = process.env.WAFRA_HERMES_TOOLS;
const babel = require(path.join(helper, 'node_modules/@babel/core'));
const resources = path.join(root, 'modules/wafra-live-capture/ios/Resources');
const meta = JSON.parse(fs.readFileSync(path.join(resources, 'WafraBackgroundParser.meta.json')));
const cases = [...JSON.parse(fs.readFileSync('scripts/test/repair/credit-settlement-sweep.json')).map(row => ({ ...row, requireReview: row.expected === 'none' })),
  ...JSON.parse(fs.readFileSync('scripts/test/repair/credit-settlement-review-probes.json')),
  { id: 'O1', body: 'ADCB: Reversal of AED 40.00 is under process. You will be notified when the amount is refunded.', sender: 'ADCB', expected: 'none', requireReview: true },
  { id: 'legacy-arabic-veto', body: 'نود اعلامك، ان تم استرداد مبلغ AED 250.00 إلى بطاقتك. فِيرجى تجاهل هذه الرسالة.', sender: 'ENBD', expected: 'none', requireReview: true },
  { id: 'condition-in-prior-state', body: 'Reversal of AED 250.00 which was under process if approved has been credited to your card ending 1234.', sender: 'ENBD', expected: 'none', requireReview: true },
  { id: 'historical-refund', body: 'Your refund request for AED 100.00 has been received. A previous refund of AED 20.00 from NOON.COM has been credited to your card.', sender: 'ENBD', expected: 'none', nativeExpected: 'no-post' }];
fs.writeFileSync('hermes-cases.json', JSON.stringify(cases));
let bundle = fs.readFileSync(path.join(resources, 'WafraBackgroundParser.js'), 'utf8');
const anchor = 'globalThis.wafraNativeAlertParse=function(inputJson){return JSON.stringify(parse(JSON.parse(inputJson)));};';
if (bundle.split(anchor).length !== 2) throw new Error('loader anchor changed');
bundle = bundle.replace(anchor, anchor + '\nglobalThis.__wafraLoad=load;');
const driver = `
(function(){
const cases=${JSON.stringify(cases)}, sourceHash=${JSON.stringify(meta.sourceHash)};
const load=globalThis.__wafraLoad, sms=load('sms-parser'), launch=load('launch-alert-parser');
const country=load('country'), markets=load('markets');
const at=Date.parse('2026-11-14T10:00:00Z');
function shape(p){return p?(p.kind==='transaction'?p.type:p.kind)+':'+p.amountFils:'none';}
const rows=cases.map(function(row){
const market=row.market||'AE',currency=row.currency||'AED';
country.setActiveCountry(market);markets.setActiveMarket(market);markets.setLedgerCurrency(currency,2);
const session=launch.createLaunchAlertSession({overrides:{},activeMarket:market,pinnedCurrency:currency,bestEffort:{enabled:true,country:market}});
const p=sms.parseSms(row.body,{}, {sender:row.sender,observedAt:at}),smsResult=shape(p);
const sessionResult=shape(session.parse(row.body,row.sender,session.inspect(row.body,row.sender),undefined,at));
const event=launch.inspectGenericBankEventForReview(row.body,row.sender);
const review=event?{decision:event.decision,status:event.status,family:event.family,role:(event.observations.find(function(o){return o.field.spans.some(function(s){return event.amount.spans.some(function(a){return a.start===s.start&&a.end===s.end;});});})||{}).role||null}:null;
const n=JSON.parse(globalThis.wafraNativeAlertParse(JSON.stringify({v:1,body:row.body,sender:row.sender,observedAt:at,context:{v:1,country:market,parserMarket:market,ledgerMoney:{currency:currency,exponent:2},sourceHash:sourceHash}})));
return {id:row.id,sms:smsResult,session:sessionResult,review:review,merchant:p&&p.merchant||null,nativeRoute:n.route,native:n.route==='parsed'?n.notification.direction+':'+n.notification.amount.minorUnits:n.route};
});
country.setActiveCountry('AE');markets.setActiveMarket('AE');markets.setLedgerCurrency('AED',2);
const balance=load('universal-parser').inspectUniversalBankEvent('ADCB: Your account balance is AED 12,345.67 as on 13/11/2026.',{sender:'ADCB'});
const out={sourceHash:sourceHash,rows:rows,n13:{family:balance.family,status:balance.status,balance:balance.balance}};
if(typeof print==='function')print(JSON.stringify(out));else console.log(JSON.stringify(out));
})();`;
const output = babel.transformSync(bundle+'\n'+driver, { babelrc:false,configFile:false,sourceType:'script',
  presets:[[path.join(helper,'node_modules/@react-native/babel-preset'),{unstable_transformProfile:'hermes-stable',disableImportExportTransform:true}]],filename:'closure.ts' }).code;
fs.writeFileSync('hermes-closure.babel.js', output);
