const fs=require('fs'),path=require('path'),Module=require('module');
const root=process.cwd(),build=path.join(root,'scripts/test/build');
const filename=path.join(build,'ios-background-alert-parser.js');
let code=fs.readFileSync(filename,'utf8');
if(!code.includes('const ignore = () => ({'))throw Error('diagnostic instrument missing');
code=code.replace('const ignore = () => ({','const ignore = () => (console.error(new Error().stack), {');
const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(build);mod._compile(code,filename);
const rows=require(path.join(root,'scripts/test/repair/credit-settlement-review-probes.json'));
const wanted=new Set(['change-reviewer-ebc:CR2-S2','change-reviewer-ebc:CR2-N1','reviewer-ebc:NU17','reviewer-ebc:NC00','reviewer-ebc:T9']);
const parse=mod.exports.parseIosBackgroundAlert;
const result=[];
for(const row of rows.filter(r=>wanted.has(r.id))){
 const stacks=[],old=console.error;console.error=(...args)=>stacks.push(String(args[0]));
 let native;try{native=parse({v:1,context:{v:1,country:'AE',parserMarket:'AE',ledgerMoney:{currency:'AED',exponent:2},sourceHash:'0'.repeat(64)},sender:row.sender,body:row.body,observedAt:Date.parse('2026-11-14T10:00:00Z')});}finally{console.error=old;}
 const srcLines=fs.readFileSync(filename,'utf8').split('\n');
 const why=stacks.map(stack=>{const match=/ios-background-alert-parser.js:(\d+):/.exec(stack);return {stack,call:match?srcLines[Number(match[1])-1]:null};});
 require(path.join(build,'country.js')).setActiveCountry('AE');require(path.join(build,'markets.js')).setActiveMarket('AE');require(path.join(build,'markets.js')).setLedgerCurrency('AED',2);
 const event=require(path.join(build,'launch-alert-parser.js')).inspectGenericBankEventForReview(row.body,row.sender);
 result.push({id:row.id,body:row.body,native,why,event});
}
fs.writeFileSync('native-diagnostic.json',JSON.stringify(result,null,2));
