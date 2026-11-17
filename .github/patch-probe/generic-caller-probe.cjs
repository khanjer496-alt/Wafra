const fs=require('fs'),vm=require('vm'),crypto=require('crypto');
const path='modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.js';const bundle=fs.readFileSync(path,'utf8');const expected='5b5108ae493327d3bc52dcdcaf241ffb1379dd18ecec5e2a0b3a5e2c0f05aa4e';if(crypto.createHash('sha256').update(bundle).digest('hex')!==expected)throw Error('unexpected bundle');
const marker='globalThis.wafraNativeAlertParse=';if(!bundle.includes(marker))throw Error('debug attachment marker missing');const ctx={};vm.runInNewContext(bundle.replace(marker,'globalThis.wafraDebugLoad=load;'+marker),ctx);const load=ctx.wafraDebugLoad;
const body='AED 250.00 was debited from your card ending 1234 at NOON.COM on 12/11/2026. The refund has been credited to your card.';const at=Date.parse('2026-11-14T10:00:00Z');const sourceHash='2a1e2d3d98f3c7eaeb4a77a2f7710b3871b01655ac7c4c3bc60ef7d683ba288f';const rows=[];
for(const pinned of ['AED',null])for(const sender of ['ENBD','']){
 load('country').setActiveCountry('AE');load('markets').setActiveMarket('AE');load('markets').setLedgerCurrency(pinned,2);
 const session=load('launch-alert-parser').createLaunchAlertSession({overrides:{},activeMarket:'AE',pinnedCurrency:pinned,bestEffort:{enabled:true,country:'AE'}});
 const source=load('sms-parser').parseSms(body,{}, {sender,observedAt:at});const direct=load('bank-alert-interpreter').interpretBankAlert({source:body,sender,market:'AE',observedAt:at});const parsed=session.parse(body,sender,session.inspect(body,sender),undefined,at);
 const native=JSON.parse(ctx.wafraNativeAlertParse(JSON.stringify({v:1,context:{v:1,country:'AE',parserMarket:'AE',ledgerMoney:pinned?{currency:'AED',exponent:2}:null,sourceHash},body,sender,observedAt:at})));
 rows.push({pinned,sender,source,direct,parsed,native});
}
fs.writeFileSync(process.argv[2],JSON.stringify({head:'6fa41a0a65b38ff09e8076342bc19be855f377bc',bundleSHA256:expected,body,observedAt:at,limits:['Qualified generated JS executed in Node VM, not shipped device','Only in-memory export of existing private module loader added; no source/resource file changed','History in unpinned mode not exercised'],rows},null,2));
