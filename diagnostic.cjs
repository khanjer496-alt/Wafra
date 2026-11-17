const load=require('./scripts/universal-test/load-ts.cjs').createLoader();
const sms=load('@/lib/sms-parser'), g=load('@/lib/principal-posting-guards'), b=load('@/lib/best-effort-autopost'), u=load('@/lib/universal-parser');
load('@/lib/country').setActiveCountry('AE');load('@/lib/markets').setActiveMarket('AE');load('@/lib/markets').setLedgerCurrency('AED',2);
for(const prefix of ['', 'Your transaction pending approval is separate. ', 'Your payment pending processing is separate; ']) {
 const body=prefix+'AED 250.00 was debited from your card ending 1234 at NOON.';
 const start=body.indexOf('AED'); const span={start,end:start+10};
 console.log(JSON.stringify({body,pending:g.hasSelectedPendingTransaction(body),completion:g.isCompletedExpensePrincipal(body,span),incomplete:g.isIncompletePrincipal(body,span,true),nonPosting:sms.nonPostingReason(body),unsafe:b.isNotAutoPostableMoney(body),noncompleted:b.hasNonCompletedWording(body,'AE','ENBD'),source:sms.parseSms(body,{}, {sender:'ENBD'}),universal:u.inspectUniversalBankEvent(body,{sender:'ENBD'})}));
}
