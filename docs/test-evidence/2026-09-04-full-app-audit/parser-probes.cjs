// Read-only probes against modules freshly compiled by scripts/test/run.sh.
/* global __dirname */
const root = require('node:path').resolve(__dirname, '../../..');
const from = name => require(`${root}/scripts/test/build/${name}`);
const markets = from('markets');
const {parseSmsBatch} = from('sms-parser');
const {createLaunchAlertSession} = from('launch-alert-parser');
const {interpretBankAlert} = from('bank-alert-interpreter');
const {buildImportPlan} = from('import-plan');
const {formatAED} = from('format');
const {inspectUniversalAlert} = from('alert-market-detection');
const tray = from('alert-review-tray');
const spec = (currency,exponent) => ({schemaVersion:2,currency,exponent});
const state = (currency,exponent) => ({hydrated:true,accounts:[],transactions:[],cardDues:[],bills:[],budgets:[],goals:[],accountHints:{},merchantOverrides:{},lastScanTs:0,marketId:'AE',ledgerMoney:spec(currency,exponent),privateMode:false});
const pin = (currency,exponent) => { markets.setLedgerCurrency(null); markets.setActiveMarket('AE'); markets.setLedgerCurrency(currency,exponent); };
const project = rows => rows.map(x => ({type:x.type,title:x.title,amountMinor:x.amountFils,category:x.category,rendered:formatAED(x.amountFils)}));
const output = {currency:[],pasteSalary:{},oldAndroidReview:{}};
const enbd = require(`${root}/scripts/test/fixtures/uae-bank-formats`)[0];
for (const [currency,exponent] of [['USD',2],['KWD',3]]) {
  pin(currency,exponent);
  const session = createLaunchAlertSession({overrides:{}});
  const automatic = session.parse(enbd.body,enbd.bank,session.inspect(enbd.body,enbd.bank));
  for (const [channel,parsed] of [['paste',parseSmsBatch(enbd.body)],['automatic',[automatic].filter(Boolean)]]) {
    const planned = buildImportPlan(parsed,state(currency,exponent),0).batch.transactions;
    output.currency.push({fixtureId:enbd.id,provenance:enbd.evidence,ledger:spec(currency,exponent),channel,parsedCurrency:parsed[0]?.currency,planned:project(planned)});
  }
}
pin('AED',2);
const salary = 'Payroll credit: AED 7,500.00 was posted to your account 1234.';
output.pasteSalary.provenance = 'existing synthetic regression in bank-alert-interpreter.test.js';
for (const [channel,parsed] of [['paste',parseSmsBatch(salary)],['automatic',[interpretBankAlert({source:salary,sender:'FAB',market:'AE'}).parsed]]]) {
  output.pasteSalary[channel] = project(buildImportPlan(parsed,state('AED',2),0).batch.transactions);
}
const chase = require(`${root}/scripts/test/fixtures/global-alert-formats`)[0];
const observedAt = Date.parse('2026-07-01T10:00:00Z');
const now = Date.parse('2026-09-04T10:00:00Z');
const candidate = tray.prepareReviewAlert({id:'audit_review_id_00001',sourceKey:'audit_review_key_0001',observedAt,channel:'inbox',inspection:inspectUniversalAlert({source:chase.body,sender:chase.sender})});
const admission = tray.admitPreparedReviewAlert(tray.emptyAlertReviewTray(),candidate,now);
output.oldAndroidReview = {fixtureId:chase.id,provenance:chase.provenance,observedAt:new Date(observedAt).toISOString(),discoveredAt:new Date(now).toISOString(),expiresAt:new Date(candidate.expiresAt).toISOString(),outcome:admission.outcome,reason:admission.reason,pending:admission.state.pending.length};
console.log(JSON.stringify(output,null,2));
