'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHarness,walk,text}=require('./reference-harness.cjs');const load=require('./load-typescript.cjs');
const root=path.resolve(__dirname,'../../..');const projection=load(path.join(root,'src/lib/reference-presentation.ts'));
const plain=x=>JSON.parse(JSON.stringify(x));
const select=(tree,predicate)=>{const n=walk(tree).find(predicate);assert.ok(n,'expected source element was rendered');return n;};
const button=(tree,label)=>select(tree,n=>n.props?.accessibilityLabel===label&&typeof n.props.onPress==='function');
const summary=(entries)=>({expenseFils:entries.reduce((s,[,v])=>s+v,0),incomeFils:0,byCategory:entries.map(([category,totalFils])=>({category,totalFils,share:0}))});

test('partial budgets aggregate only categories with an explicit positive limit',()=>{
 const rows=projection.spendingCategoryRows(summary([['rent',500000],['dining',25000]]),[{category:'dining',limitFils:100000}],true);
 const result=projection.limitedCategorySummary(rows);assert.equal(result.spentFils,25000);assert.equal(result.limitFils,100000);assert.equal(result.ratio,.25);assert.equal(rows.find(r=>r.category==='rent').limitFils,null);
});
test('no limit and zero spending remain distinct from a missing amount',()=>{
 const rows=projection.spendingCategoryRows(summary([]),[{category:'groceries',limitFils:100000}],true);assert.deepEqual(plain(rows),[{category:'groceries',spentFils:0,limitFils:100000,ratio:0,remainingFils:100000}]);
});
test('year/range reports do not silently compare their totals with monthly limits',()=>{
 const rows=projection.spendingCategoryRows(summary([['dining',50000]]),[{category:'dining',limitFils:100000},{category:'shopping',limitFils:100}],false);assert.equal(rows.length,1);assert.equal(rows[0].ratio,null);assert.equal(projection.limitedCategorySummary(rows).count,0);
});
test('nonpositive limits never cause Infinity or a fake overrun',()=>{
 const rows=projection.spendingCategoryRows(summary([['rent',10000],['dining',20000]]),[{category:'rent',limitFils:0},{category:'dining',limitFils:-10}],true);assert.ok(rows.every(r=>r.ratio===null));assert.equal(projection.limitedCategorySummary(rows).ratio,null);
});
test('over-limit arithmetic remains uncapped even though a progress graphic clamps',()=>{
 const r=projection.spendingCategoryRows(summary([['dining',12501]]),[{category:'dining',limitFils:10000}],true)[0];assert.equal(r.ratio,1.2501);assert.equal(r.remainingFils,-2501);
});
test('300 deterministic category ledgers reconcile exactly, without mutating source data',()=>{
 const cats=['rent','dining','shopping','utilities','other'];let seed=9041;
 for(let run=0;run<300;run++){seed=(seed*1664525+1013904223)>>>0;const entries=cats.map((c,i)=>[c,(seed>>>(i*4))%100000]);const budgets=cats.filter((_,i)=>((seed>>>i)&1)).map(c=>({category:c,limitFils:10001}));const sum=summary(entries);const before=JSON.stringify([sum,budgets]);const rows=projection.spendingCategoryRows(sum,budgets,true);assert.equal(rows.reduce((a,r)=>a+r.spentFils,0),sum.expenseFils);const limited=projection.limitedCategorySummary(rows);assert.equal(limited.spentFils,entries.filter(([c])=>budgets.some(b=>b.category===c)).reduce((a,[,v])=>a+v,0));assert.equal(JSON.stringify([sum,budgets]),before);}
});
const bill=(id,daysLeft,more={})=>({id,title:id,category:'utilities',kind:'bill',dateISO:`2026-09-${String(daysLeft+6).padStart(2,'0')}`,daysLeft,amountFils:10000,estimated:false,paid:false,...more});
test('estimated earlier renewals are never classified as confirmed overdue debt',()=>{
 const groups=projection.groupPaymentAgenda([bill('estimate',-1,{estimated:true,kind:'recurring'}),bill('confirmed',-1)],false);assert.deepEqual(plain(groups.map(g=>[g.key,g.items.map(x=>x.id)])),[['overdue',['confirmed']],['expected-earlier',['estimate']]]);
});
test('agenda is chronological and separates the seven-day boundary',()=>{
 const groups=projection.groupPaymentAgenda([bill('later',8),bill('seven',7),bill('tomorrow',1),bill('today',0)],false);assert.deepEqual(plain(groups.map(g=>[g.key,g.items.map(x=>x.id)])),[['soon',['today','tomorrow','seven']],['later',['later']]]);
});
test('paid items appear only in All, regardless of their past due date',()=>{
 const items=[bill('paid',-2,{paid:true}),bill('open',0)];assert.equal(projection.groupPaymentAgenda(items,false).flatMap(g=>g.items).length,1);assert.equal(projection.groupPaymentAgenda(items,true).at(-1).key,'paid');
});
test('agenda sorting does not rewrite dates, amounts or its input array',()=>{const items=[bill('later',8),bill('today',0)];const before=JSON.stringify(items);projection.groupPaymentAgenda(items,true);assert.equal(JSON.stringify(items),before)});

test('all four real tab components execute in both themes and languages, standard and large text',()=>{
 for(const theme of ['light','dark'])for(const language of ['en','ar'])for(const largeText of [false,true])for(const screen of ['home','flow','bills','wallet']){const h=createHarness({theme,language,largeText});assert.ok(walk(h.render(screen)).length>20);assert.equal(h.events.filter(e=>e[0]!=='state').length,0,'render must not write money or navigate');}
});
test('Spending exposes three views, not a separate Stats button',()=>{const h=createHarness(),tree=h.render('flow');const tabs=walk(tree).filter(n=>n.props?.accessibilityRole==='tab');assert.deepEqual(tabs.map(n=>n.props.accessibilityLabel),['Categories','Activity','Trends']);button(tree,'Trends').props.onPress();assert.deepEqual(h.events.at(-1),['state',0,'trends'])});
test('legacy Stats URL redirects into Spending Trends',()=>{assert.equal(createHarness().render('stats').props.href,'/flow?view=trends')});
test('category rows carry exact totals and edit actions',()=>{const h=createHarness(),tree=h.render('flow');assert.match(text(tree),/5,360\.00/);assert.match(text(tree),/3,870\.00/);const dining=select(tree,n=>n.props?.accessibilityLabel?.startsWith('Dining.')&&n.props.onPress);dining.props.onPress();assert.deepEqual(h.events.at(-1),['state',5,'dining'])});
test('category filter controls the one category list',()=>{const h=createHarness({states:{1:'unlimited'}}),tree=h.render('flow');const categories=walk(tree).filter(n=>n.props?.accessibilityLabel?.includes('No category limit')&&n.props.onPress);assert.equal(categories.length,1);assert.ok(categories[0].props.accessibilityLabel.startsWith('Other.'))});
test('category detail passes the selected category into the existing limit sheet',()=>{const h=createHarness({states:{5:'dining'}}),tree=h.render('flow');const sheet=select(tree,n=>n.type==='Sheet');const edit=select(sheet,n=>n.props?.accessibilityLabel==='Edit limits');edit.props.onPress();assert.deepEqual(h.events.slice(-2),[['state',4,'dining'],['state',5,null]])});
test('category history survives the Stats merge and opens the same selected money month',()=>{const h=createHarness({states:{5:'dining'}}),tree=h.render('flow');const history=select(tree,n=>n.props?.testID==='category-history');const buttons=walk(history).filter(n=>n.props?.accessibilityRole==='button');assert.equal(buttons.length,6);buttons[0].props.onPress();assert.deepEqual(plain(h.events.at(-1)),['period',{mode:'month',key:'2026-04'}])});
test('Activity excludes income, internal transfers and archived-account expenses',()=>{
 const h=createHarness({params:{view:'activity'}});h.state.accounts.push({id:'closed',name:'Closed',kind:'bank',openingFils:0,archived:true});
 h.state.transactions.push({id:'transfer',title:'Own transfer never expense',amountFils:10000,type:'expense',isTransfer:true,category:'other',accountId:'enbd',date:'2026-09-06'},{id:'archived',title:'Archived expense',amountFils:20000,type:'expense',category:'other',accountId:'closed',date:'2026-09-06'});
 const txt=text(h.render('flow'));assert.ok(!txt.includes('Own transfer never expense'));assert.ok(!txt.includes('Archived expense'));assert.ok(!txt.includes('Salary'));assert.ok(txt.includes('Talabat'));
});
test('Activity search hands the same merchant query to the full ledger route',()=>{const h=createHarness({params:{view:'activity'},states:{2:'Talabat'}}),tree=h.render('flow');assert.ok(text(tree).includes('Talabat'));assert.ok(!text(tree).includes('ENOC'));button(tree,'View all spending').props.onPress();assert.deepEqual(h.events.at(-1),['route','/transactions?type=expense&q=Talabat'])});
test('Activity limits eager row rendering to eight without dropping the full-ledger link',()=>{
 const h=createHarness({params:{view:'activity'}});h.state.transactions=Array.from({length:100},(_,i)=>({id:'t'+i,title:'Unique merchant '+i,amountFils:100,type:'expense',category:'other',accountId:'enbd',date:'2026-09-06'}));const tree=h.render('flow');assert.equal(walk(tree).filter(n=>n.props?.testID==='transaction-details-link'&&n.props?.accessibilityLabel?.includes('Unique merchant')&&n.props.onPress).length,8);button(tree,'View all spending');
});
test('Trends chart selection changes the shared period',()=>{const h=createHarness({params:{view:'trends'}}),tree=h.render('flow');const month=select(tree,n=>n.props?.accessibilityLabel?.startsWith('April 2026.')&&n.props.onPress);month.props.onPress();assert.deepEqual(plain(h.events.at(-1)),['period',{mode:'month',key:'2026-04'}])});
test('Trends merchant rows open the selected merchant summary',()=>{const h=createHarness({params:{view:'trends'}}),tree=h.render('flow');const row=select(tree,n=>n.props?.accessibilityLabel?.startsWith('Talabat,')&&n.props.onPress);row.props.onPress();assert.equal(h.events.at(-1)[1],'/merchant?name=Talabat')});
test('Bills agenda opens its original bill details, without recording a payment',()=>{const h=createHarness(),tree=h.render('bills');select(tree,n=>n.props?.accessibilityLabel?.startsWith('DEWA.')&&n.props.onPress).props.onPress();assert.deepEqual(h.events.at(-1),['state',4,'dewa']);assert.ok(!h.events.some(e=>e[0]==='markBillPaid'))});
test('Bills keeps Upcoming / All and the existing add-bill sheet',()=>{const h=createHarness(),tree=h.render('bills');button(tree,'All').props.onPress();assert.deepEqual(h.events.at(-1),['state',0,'all']);const scaffold=select(tree,n=>n.type==='Scaffold');scaffold.props.header.actions[0].onPress();assert.deepEqual(h.events.at(-1),['state',7,true])});
test('Add bill validates amount and due day before writing',()=>{
 const invalid=createHarness({states:{7:true,8:'Etisalat',9:'200',10:'32'}});const bad=select(invalid.render('bills'),n=>n.type==='Sheet');const saveBad=select(bad,n=>n.props?.accessibilityLabel==='Save reminder');assert.equal(saveBad.props.disabled,true);
 const valid=createHarness({states:{7:true,8:'Etisalat',9:'200.49',10:'7'}});const good=select(valid.render('bills'),n=>n.type==='Sheet');const save=select(good,n=>n.props?.accessibilityLabel==='Save reminder');assert.ok(!save.props.disabled);save.props.onPress();const call=valid.events.find(e=>e[0]==='addBill');assert.equal(call[1].amountFils,20049);assert.equal(call[1].dueDay,7);
});
test('Bills records a payment only through the retained confirmation callback',()=>{
 const h=createHarness({states:{4:'dewa'}}),tree=h.render('bills');const sheet=select(tree,n=>n.type==='Sheet'&&n.props.title==='DEWA');select(sheet,n=>n.props?.accessibilityLabel==='Record as paid').props.onPress();assert.ok(!h.events.some(e=>e[0]==='markBillPaid'));const confirmation=h.events.find(e=>e[0]==='state'&&e[1]===5)?.[2];assert.equal(typeof confirmation.onConfirm,'function');confirmation.onConfirm();assert.ok(h.events.some(e=>e[0]==='markBillPaid'&&e[1]==='dewa'));
});
test('Accounts visibly separates bank balances, credit cards and cash',()=>{const h=createHarness(),tree=h.render('wallet'),txt=text(tree);for(const label of ['Bank accounts','Credit cards','Cash'])assert.ok(txt.includes(label));assert.ok(txt.includes('42,500.00'));assert.ok(!txt.includes('45,300.00'),'credit debt must not inflate balances')});
test('Accounts exposes a visible management action for every account',()=>{const h=createHarness(),tree=h.render('wallet');const controls=walk(tree).filter(n=>n.props?.accessibilityLabel?.startsWith('Manage account:'));assert.equal(controls.length,4);controls[0].props.onPress();assert.equal(h.events.at(-1)[2].id,'enbd')});
test('unknown credit-card amount is not silently presented as zero debt',()=>{const h=createHarness({state:{cardDues:[]}});const card=h.state.accounts.find(a=>a.id==='credit');delete card.snapshotFils;delete card.snapshotKind;const tree=h.render('wallet');const row=select(tree,n=>n.props?.accessibilityLabel?.startsWith('NBD credit card.')&&n.props.onPress);assert.ok(row.props.accessibilityLabel.includes('No recorded figure'));assert.ok(!row.props.accessibilityLabel.includes('AED 0.00'))});
test('Arabic numeric fields keep the Arabic face and original input text',()=>{const h=createHarness({language:'ar'});const field=h.deps['@/components/ui/text-field'].TextField({label:'المبلغ',value:'١٢٫٥٠',numeric:true,onChangeText:v=>h.events.push(['input',v])});const input=select(field,n=>n.type==='TextInput');const style=Object.assign({},...input.props.style.flat(Infinity).filter(Boolean));assert.equal(style.fontFamily,'NotoKufiArabic-Regular');assert.equal(input.props.keyboardType,'decimal-pad');input.props.onChangeText('١٢٫٧٥');assert.deepEqual(h.events.at(-1),['input','١٢٫٧٥'])});
test('TextField forwards focus/blur callbacks instead of swallowing validation events',()=>{const h=createHarness();const f=h.deps['@/components/ui/text-field'].TextField({label:'Amount',value:'1',numeric:true,onChangeText(){},onFocus:()=>h.events.push(['focus']),onBlur:()=>h.events.push(['blur'])});const input=select(f,n=>n.type==='TextInput');input.props.onFocus({});input.props.onBlur({});assert.ok(h.events.some(e=>e[0]==='focus'));assert.ok(h.events.some(e=>e[0]==='blur'))});
test('transaction details retain the exact cents and a read-before-edit flow',()=>{const h=createHarness();const tx={...h.state.transactions[1],amountFils:62049};const tree=h.renderDetail(tx);assert.ok(text(tree).includes('620.49'));assert.ok(!walk(tree).some(n=>n.type==='TextInput'));assert.ok(walk(tree).some(n=>n.props?.onPress));assert.ok(!h.events.some(e=>e[0]==='editTransaction'))});
test('transaction editing preserves cents and saves only after explicit action',()=>{
 const h=createHarness({states:{0:true,1:'Talabat',2:'620.49',3:'dining',4:'enbd',5:'2026-09-03',6:false}});const tree=h.renderDetail();const save=select(tree,n=>n.props?.accessibilityLabel==='Save changes');assert.ok(!h.events.some(e=>e[0]==='editTransaction'));save.props.onPress();const call=h.events.find(e=>e[0]==='editTransaction');assert.equal(call[2].amountFils,62049);assert.equal(call[2].accountId,'enbd');assert.equal(call[2].date,'2026-09-03');
});
test('all changed source modules parse and all local imports resolve',()=>{
 const ts=require('typescript');let checked=0;
 const sourceFiles=["src/app/(tabs)/bills.tsx", "src/app/(tabs)/flow.tsx", "src/app/(tabs)/wallet.tsx", "src/app/stats.tsx", "src/app/transactions.tsx", "src/components/app-root-layout.tsx", "src/components/bills/payment-agenda.tsx", "src/components/entry-detail-sheet.tsx", "src/components/reference-home-summary.tsx", "src/components/spending/spending-overview.tsx", "src/components/spending/spending-trends.tsx", "src/components/tab-bar.tsx", "src/components/themed-text.tsx", "src/components/ui/category-avatar.tsx", "src/components/ui/controls.tsx", "src/components/ui/layout.tsx", "src/components/ui/segmented-control.tsx", "src/components/ui/text-field.tsx", "src/components/wallet/account-groups.tsx", "src/components/wallet/balance-overview.tsx", "src/constants/theme.ts", "src/lib/i18n.ts", "src/lib/reference-presentation.ts", "src/screens/journal-home-screen.tsx"];
 for(const name of sourceFiles){const file=path.join(root,name);checked++;const src=fs.readFileSync(file,'utf8'),parsed=ts.createSourceFile(file,src,ts.ScriptTarget.Latest,true);assert.equal(parsed.parseDiagnostics.length,0,file);
  for(const st of parsed.statements)if(ts.isImportDeclaration(st)&&st.moduleSpecifier.text.startsWith('@/')){const stem=path.join(root,'src',st.moduleSpecifier.text.slice(2));assert.ok(['','.ts','.tsx','.web.ts','.web.tsx','/index.ts','/index.tsx'].some(ext=>fs.existsSync(stem+ext)),st.moduleSpecifier.text);}
 }assert.ok(checked>=20);
});
