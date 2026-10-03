'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTypescript = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const source = name => path.join(root, 'src/lib', `${name}.ts`);
function load(name, overrides = {}) {
  const dependencies = {};
  for (const [, dependency] of fs.readFileSync(source(name), 'utf8').matchAll(/from ['"](@\/lib\/[^'"]+)['"]/g)) {
    const moduleName = dependency.slice('@/lib/'.length);
    const built = path.join(__dirname, '../build', `${moduleName}.js`);
    if (fs.existsSync(built)) dependencies[dependency] = require(built);
  }
  return loadTypescript(source(name), { ...dependencies, ...overrides });
}
const dedupe = load('dedupe');
const { buildImportPlan } = load('import-plan', { '@/lib/dedupe': dedupe });
const heal = load('heal', { '@/lib/dedupe': dedupe });
const { materializeImportBatch, applyMaterializedImportBatch } = load('ledger-import', { '@/lib/dedupe': dedupe, '@/lib/heal': heal });
const { summarizeCoverage } = load('statement-coverage');
const now = new Date('2026-09-30T12:00:00Z');
const noon = Date.parse('2026-08-13T12:00:00Z');
const base = () => ({ hydrated: true, privateMode: true,
  ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  accounts: [], transactions: [], budgets: [], bills: [], goals: [], cardDues: [],
  accountHints: {}, merchantOverrides: {}, billAliases: {}, lastScanTs: 0, parserVersion: 0 });
const statement = (bank, upload, changes = {}) => ({ kind: 'transaction', type: 'expense',
  amountFils: 2500, currency: 'AED', merchant: 'CAFE', date: '2026-08-13',
  dueDay: null, minDueFils: null, card: null, reference: null, transferHint: false,
  snapshotFils: null, snapshotKind: null, categoryGuess: 'dining', categoryDeliberate: true,
  captureSource: 'pdf', smsTs: noon, statementImportId: upload.repeat(32), bankHint: bank, ...changes });
let serial = 0;
function apply(rows, state = base()) {
  const plan = buildImportPlan(rows, state, 0, now);
  return { plan, state: applyMaterializedImportBatch(state,
    materializeImportBatch(plan.batch, state, prefix => `${prefix}-${++serial}`)) };
}
for (const [first, second] of [['ADCB', 'HSBC'], ['HSBC', 'ADCB'], ['مصرف ألف', 'مصرف باء']]) {
  test(`${first}/${second}: bank-only statements retain issuer across persistence and do not erase equal purchases`, () => {
    const initial = apply([statement(first, 'a')]);
    const stored = JSON.parse(JSON.stringify(initial.state));
    const next = apply([statement(second, 'b')], stored);
    assert.equal(next.plan.txCount, 1, 'a different bank purchase must survive');
    assert.equal(next.state.transactions.length, 2);
    const replay = apply([statement(first, 'c'), statement(second, 'd')], next.state);
    assert.equal(replay.plan.txCount, 2, 'different files cannot prove ownership from the bank alone');
    assert.equal(replay.state.transactions.length, 4);
  });
}
test('current-month-only coverage does not fabricate missing months in the future', () => {
  const result = summarizeCoverage([{ id: 'coverage', sourceKey: 'card:credit:1234', label: 'Card',
    startDate: '2026-09-01', endDate: '2026-09-25', format: 'pdf', importedAt: 1 }], 'en', now);
  assert.equal(result[0].missing.length, 0);
});

test('a PDF synthetic midday clock cannot impersonate a live alert with the same amount', () => {
  const card = { id: 'adcb', name: 'ADCB Card', bankName: 'ADCB', kind: 'card', cardType: 'credit',
    last4: '1234', openingFils: 0, color: '#000' };
  const live = { id: 'live', type: 'expense', amountFils: 2500, category: 'dining',
    accountId: card.id, title: 'CAFE', date: '2026-08-13', source: 'sms', ts: noon,
    smsKey: `s${noon}-2500`, captureInstrument: { kind: 'credit', last4: '1234', bankIdentity: 'adcb' } };
  const state = { ...base(), accounts: [card], transactions: [live] };
  const result = apply([statement('HSBC', 'a')], state);
  assert.equal(result.plan.txCount, 1, 'different bank is not the live source');
  assert.equal(result.state.transactions.length, 2);
});

test('synthetic PDF clock cannot replace another merchant on the same card', () => {
  const card = { id: 'adcb', name: 'ADCB Card', bankName: 'ADCB', kind: 'card', cardType: 'credit',
    last4: '1234', openingFils: 0, color: '#000' };
  const live = { id: 'live', type: 'expense', amountFils: 2500, category: 'dining',
    accountId: card.id, title: 'CAFE', date: '2026-08-13', source: 'sms', ts: noon,
    smsKey: `s${noon}-2500`, captureInstrument: { kind: 'credit', last4: '1234', bankIdentity: 'adcb' } };
  const state = { ...base(), accounts: [card], transactions: [live] };
  const result = apply([statement('ADCB', 'a', { merchant: 'BOOK SHOP', card: {kind:'credit',last4:'1234'} })], state);
  assert.equal(result.plan.txCount, 1);
  assert.equal(result.state.transactions.length, 2);
  assert.ok(result.state.transactions.some(row => row.id === 'live' && row.title === 'CAFE'));
});

test('same-file repeated purchases survive even when synthetic clocks are less than two minutes apart', () => {
  const first = statement('ADCB', 'a');
  const second = statement('ADCB', 'a', { smsTs: noon - 60_000 });
  const result = apply([first, second]);
  assert.equal(result.plan.txCount, 2);
  assert.equal(result.state.transactions.length, 2);
  assert.equal(dedupe.reconcileCaptureDuplicates(result.state.transactions).length, 2);
  assert.equal(apply([first, second], result.state).plan.txCount, 0, 'exact file redelivery is idempotent');
  assert.equal(apply([statement('ADCB', 'b'), statement('ADCB', 'b', {smsTs:noon-60_000})], result.state).plan.txCount, 2, 'unknown-account files cannot establish overlap');
});

test('an unlabelled statement cannot consume an alert without positive account ownership', () => {
  const initial = apply([statement('ADCB', 'a')]).state;
  const live = statement('HSBC', 'b', { captureSource: undefined, statementImportId: undefined,
    card: {kind:'credit',last4:'1234'}, sender:'HSBC', smsTs: noon });
  const different = apply([live], initial);
  assert.equal(different.plan.txCount, 1);
  assert.equal(different.state.transactions.length, 2);
  const same = apply([{ ...live, bankHint: 'ADCB', sender:'ADCB', smsTs: noon + 60_000 }], initial);
  assert.equal(same.plan.txCount, 1);
});

test('same-card statement and live alert still pair once when the clocks happen to collide', () => {
  const row = statement('ADCB', 'a', {card:{kind:'credit',last4:'1234'}});
  const initial = apply([row]).state;
  const live = { ...row, captureSource: undefined, statementImportId: undefined, sender: 'ADCB' };
  const result = apply([live], initial);
  assert.equal(result.plan.txCount, 0);
  assert.equal(result.state.transactions.length, 1);
  assert.equal(apply([row], result.state).plan.txCount, 0);
});

test('same-upload synthetic clocks do not merge two genuine card settlement receipts', () => {
  const receipt = statement('ADCB', 'a', { kind:'cardPayment',type:'income',cardPaymentSide:'receipt',
    transferHint:true,card:{kind:'credit',last4:'1234'},merchant:'Card payment'});
  const result=apply([receipt,{...receipt,smsTs:noon-60_000}]);
  assert.equal(result.plan.txCount, 2);
  assert.equal(result.state.transactions.length, 2);
  assert.equal(apply([receipt,{...receipt,smsTs:noon-60_000}],result.state).plan.txCount,0);
});

test('retained provider identity can still replay after binding a live alert to a statement', () => {
  const row = statement('ADCB','a',{card:{kind:'credit',last4:'1234'}});
  const initial = apply([row]).state;
  const live = { ...row,captureSource:undefined,statementImportId:undefined,sourceEventId:'a9988',
    sender:'ADCB',smsTs:noon+60_000 };
  const bound = apply([live],initial);
  assert.equal(bound.plan.txCount,0);
  assert.equal(apply([live],bound.state).plan.txCount,0);
  assert.equal(bound.state.transactions.length,1);
});

test('statement issuer metadata validates without allowing arbitrary text or source injection', () => {
  const {reducer}=require('../../perf/load-store.cjs').loadStore();
  const validate=load('backup-validation').isValidBackupState;
  const state=reducer({hydrated:false,accounts:[],transactions:[]},{type:'hydrate',state:base()});
  const imported=apply([statement('مصرف ألف','a')],state).state;
  assert.equal(validate(imported),true);
  for(const bad of ['', 'a\nissuer', 'bank!name', 'a'.repeat(241)]) {
    assert.equal(validate({...imported,transactions:imported.transactions.map(row=>({...row,statementBank:bad}))}),false);
  }
  assert.equal(validate({...imported,transactions:imported.transactions.map(row=>({...row,captureSource:'notification'}))}),false);
  const legacy={...imported,transactions:imported.transactions.map(({statementBank,...row})=>row)};
  assert.equal(validate(legacy),true,'older rows remain restorable without inventing an issuer');
});

test('sparse transaction ranges cannot prove complete or missing months even with account identity', () => {
  const result=summarizeCoverage([{id:'sparse',sourceKey:'card:credit:1234',label:'Card',
    startDate:'2026-01-20',endDate:'2026-08-02',format:'pdf',importedAt:1}],'en',now);
  assert.equal(result[0].identified,true);
  assert.equal(result[0].canAssessCompleteness,false);
  assert.equal(result[0].missing.length,0);
});

test('a matched statement row cannot heal an unrelated live row sharing its synthetic clock', () => {
  const card={id:'adcb',name:'ADCB Card',bankName:'ADCB',kind:'card',cardType:'credit',last4:'1234',openingFils:0,color:'#000'};
  const live=(id,title,ts)=>({id,type:'expense',amountFils:2500,category:'dining',accountId:card.id,title,
    date:'2026-08-13',source:'sms',ts,smsKey:`s${ts}-2500`,captureInstrument:{kind:'credit',last4:'1234',bankIdentity:'adcb'}});
  const state={...base(),accounts:[card],transactions:[live('cafe','Card purchase',noon),live('book','BOOK SHOP',noon+3600_000)]};
  const result=apply([statement('ADCB','a',{merchant:'BOOK SHOP',card:{kind:'credit',last4:'1234'}})],state);
  assert.equal(result.plan.txCount,0,'the real book-shop alert explains the statement row');
  assert.equal(result.plan.batch.updates.length,0,'a different row at synthetic noon must not be healed');
  assert.equal(result.state.transactions.find(row=>row.id==='cafe').title,'Card purchase');
});

for (const bank of ['ADCB','HSBC']) test(`${bank}: edited push identity cannot consume a different statement using its synthetic clock`, () => {
  const card={id:'adcb',name:'ADCB Card',bankName:'ADCB',kind:'card',cardType:'credit',last4:'1234',openingFils:0,color:'#000'};
  const live={id:'edited',type:'expense',amountFils:2500,category:'dining',accountId:card.id,title:'My lunch',
    date:'2026-08-13',source:'sms',viaPush:true,userEdited:true,titleEdited:true,ts:noon,smsKey:`s${noon}-2500`,
    captureInstrument:{kind:'credit',last4:'1234',bankIdentity:'adcb'}};
  const result=apply([statement(bank,'a',{merchant:'BOOK SHOP',card:bank==='ADCB'?{kind:'credit',last4:'1234'}:null})],
    {...base(),accounts:[card],transactions:[live]});
  assert.equal(result.plan.txCount,1);
  assert.equal(result.state.transactions.length,2);
  assert.equal(result.state.transactions.find(row=>row.id==='edited').title,'My lunch');
});

test('edited stored statement does not act as a live push clock for a new alert', () => {
  const card={id:'adcb',name:'ADCB Card',bankName:'ADCB',kind:'card',cardType:'credit',last4:'1234',openingFils:0,color:'#000'};
  const row=statement('ADCB','a',{card:{kind:'credit',last4:'1234'}});
  const initial=apply([row],{...base(),accounts:[card]}).state;
  initial.transactions=initial.transactions.map(row=>({...row,viaPush:true,userEdited:true,titleEdited:true,title:'My lunch'}));
  const live={...row,captureSource:undefined,statementImportId:undefined,sender:'ADCB',merchant:'BOOK SHOP'};
  const result=apply([live],initial);
  assert.equal(result.plan.txCount,1);
  assert.equal(result.state.transactions.length,2);
});


for (const card of [null, {kind:'credit',last4:'1234'}]) test(`same file with ${card?'identified':'unknown'} account survives synthetic-clock changes without duplicate money`, () => {
  const rows = [statement('ADCB','a',{card,statementRowIndex:0,smsTs:noon-12*3600_000}),
    statement('ADCB','a',{card,statementRowIndex:1,smsTs:noon-12*3600_000+60_000})];
  const first = apply(rows);
  assert.equal(first.plan.txCount,2,'identical purchases inside a new file must both survive');
  const replay = apply(rows.map((row,index)=>({...row,smsTs:noon+index*60_000})), first.state);
  assert.equal(replay.plan.txCount,0,'same persisted file rows match one-to-one despite clock drift');
  assert.equal(replay.state.transactions.length,2);
});

test('one persisted file row cannot consume two repeated rows in a later delivery', () => {
  const first = apply([statement('ADCB','a',{statementRowIndex:0,smsTs:noon-12*3600_000})]);
  const replay = apply([statement('ADCB','a',{statementRowIndex:0}),statement('ADCB','a',{statementRowIndex:1,smsTs:noon+60_000})],first.state);
  assert.equal(replay.plan.txCount,1);
  assert.equal(replay.state.transactions.length,2);
});

test('an exact-clock persisted match is consumed before matching another row by file identity', () => {
  const row=statement('ADCB','a',{statementRowIndex:0});
  const first=apply([row]);
  const replay=apply([row,{...row,statementRowIndex:1,smsTs:noon+60_000}],first.state);
  assert.equal(replay.plan.txCount,1);
  assert.equal(replay.state.transactions.length,2);
});


test('unassigned income is not positive ownership for cross-file statement matches', () => {
  const row=statement('ADCB','a',{type:'income',merchant:'SALARY',categoryGuess:'business',categoryDeliberate:true});
  const first=apply([row]);
  const next=apply([{...row,statementImportId:'b'.repeat(32)}],first.state);
  assert.equal(next.plan.txCount,1);
});


test('same-file identical purchases delivered on separate relay pages retain distinct ordinals', () => {
  const first=apply([statement('ADCB','a',{statementRowIndex:0})]);
  const second=apply([statement('ADCB','a',{statementRowIndex:1,smsTs:noon-121_000})],first.state);
  assert.equal(second.plan.txCount,1);
  assert.equal(second.state.transactions.length,2);
  const replay=apply([statement('ADCB','a',{statementRowIndex:1,smsTs:noon+43_200_000}),statement('ADCB','a',{statementRowIndex:0,smsTs:noon-43_200_000})],second.state);
  assert.equal(replay.plan.txCount,0);
  assert.equal(replay.state.transactions.length,2);
});

test('legacy no-ordinal clock drift is preserved rather than guessed as a replay', () => {
  const first=apply([statement('ADCB','a')]);
  const next=apply([statement('ADCB','a',{smsTs:noon-121_000})],first.state);
  assert.equal(next.plan.txCount,1);
});

test('same file ordinal cannot change posted amount/date/direction silently', () => {
  const row=statement('ADCB','a',{statementRowIndex:0});
  const first=apply([row]);
  for(const changes of [{amountFils:2501},{date:'2026-08-14'},{type:'income'}]) {
    assert.throws(()=>apply([{...row,...changes}],first.state),/Statement row identity conflicts/);
  }
});

test('file ordinal persists through backup validation and legacy omission remains valid', () => {
  const {reducer}=require('../../perf/load-store.cjs').loadStore();
  const validate=load('backup-validation').isValidBackupState;
  const state=reducer({hydrated:false,accounts:[],transactions:[]},{type:'hydrate',state:base()});
  const imported=apply([statement('ADCB','a',{statementRowIndex:0})],state).state;
  assert.equal(imported.transactions[0].statementRowIndex,0);
  assert.equal(validate(imported),true);
  for(const changes of [{statementRowIndex:-1},{statementRowIndex:200},{statementRowIndex:0.5},{statementImportId:undefined},{captureSource:'shortcut'}]) {
    assert.equal(validate({...imported,transactions:imported.transactions.map(row=>({...row,...changes}))}),false);
  }
});


test('authoritative file ordinal replay preserves a user edited amount and date', () => {
  const row=statement('ADCB','a',{statementRowIndex:0});
  const first=apply([row]);
  first.state.transactions=first.state.transactions.map(tx=>({...tx,amountFils:3000,date:'2026-08-14',userEdited:true}));
  const replay=apply([{...row,smsTs:noon+43_200_000}],first.state);
  assert.equal(replay.plan.txCount,0);
  assert.equal(replay.state.transactions[0].amountFils,3000);
  assert.equal(replay.state.transactions[0].date,'2026-08-14');
});


for (const existingSource of ['live','statement']) test(`persisted ${existingSource} overlap cannot consume two same-file purchases across relay pages`, () => {
  const card={id:'adcb',name:'ADCB Card',bankName:'ADCB',kind:'card',cardType:'credit',last4:'1234',openingFils:0,color:'#000'};
  const live={id:'live',title:'CAFE',amountFils:2500,type:'expense',category:'dining',accountId:'adcb',source:'sms',date:'2026-08-13',ts:noon-3600_000,smsKey:`s${noon-3600_000}-2500`,captureInstrument:{kind:'credit',last4:'1234',bankIdentity:'adcb'}};
  const initial=existingSource==='live'?{...base(),accounts:[card],transactions:[live]}:
    apply([statement('ADCB','b',{card:{kind:'credit',last4:'1234'},statementRowIndex:0})],{...base(),accounts:[card]}).state;
  const row=statement('ADCB','a',{card:{kind:'credit',last4:'1234'},statementRowIndex:0});
  const first=apply([row],initial);
  assert.equal(first.plan.txCount,0);
  assert.deepEqual(JSON.parse(JSON.stringify(first.state.transactions[0].statementOccurrences)),[{importId:'a'.repeat(32),rowIndex:0,date:'2026-08-13',amountFils:2500,type:'expense',title:'CAFE'}]);
  assert.equal(first.state.transactions[0].captureSource,initial.transactions[0].captureSource,'primary capture provenance is retained');
  const restored=JSON.parse(JSON.stringify(first.state));
  const second=apply([{...row,statementRowIndex:1,smsTs:noon-121_000}],restored);
  assert.equal(second.plan.txCount,1);
  assert.equal(second.state.transactions.length,2);
  const retried=apply([{...row,smsTs:noon+43_200_000},{...row,statementRowIndex:1,smsTs:noon+43_079_000}],second.state);
  assert.equal(retried.plan.txCount,0);
  assert.equal(retried.state.transactions.length,2);
});

test('statement occurrence capacity fails before acknowledging a positively matched row', () => {
  const card={id:'adcb',name:'ADCB Card',bankName:'ADCB',kind:'card',cardType:'credit',last4:'1234',openingFils:0,color:'#000'};
  const first=apply([statement('ADCB','a',{card:{kind:'credit',last4:'1234'},statementRowIndex:0})],{...base(),accounts:[card]}).state;
  first.transactions=first.transactions.map(tx=>({...tx,statementOccurrences:Array.from({length:64},(_,i)=>({importId:i.toString(16).padStart(32,'0'),rowIndex:0}))}));
  assert.throws(()=>apply([statement('ADCB','b',{card:{kind:'credit',last4:'1234'},statementRowIndex:0})],first),/claim capacity exceeded/);
  assert.equal(apply([statement('ADCB','a',{card:{kind:'credit',last4:'1234'},statementRowIndex:0,smsTs:noon+43_200_000})],first).plan.txCount,0,'known exact occurrence needs no new claim capacity');
});

test('statement occurrence claims validate bounded unique indexes and survive user edits', () => {
  const validate=load('backup-validation').isValidBackupState;
  const {reducer}=require('../../perf/load-store.cjs').loadStore();
  const state=reducer({hydrated:false,accounts:[],transactions:[]},{type:'hydrate',state:base()});
  const first=apply([statement('ADCB','a',{statementRowIndex:0})],state).state;
  first.transactions=first.transactions.map(tx=>({...tx,statementOccurrences:[{importId:'b'.repeat(32),rowIndex:3}],userEdited:true,amountFils:3500}));
  assert.equal(validate(first),true);
  assert.equal(apply([statement('ADCB','b',{statementRowIndex:3,smsTs:noon+43_200_000})],first).plan.txCount,0);
  for(const bad of [[{importId:'bad',rowIndex:0}],[{importId:'b'.repeat(32),rowIndex:200}],Array.from({length:65},(_,i)=>({importId:'b'.repeat(32),rowIndex:i})),[{importId:'b'.repeat(32),rowIndex:0},{importId:'b'.repeat(32),rowIndex:0}]]) {
    assert.equal(validate({...first,transactions:first.transactions.map(tx=>({...tx,statementOccurrences:bad}))}),false);
  }
  const old=first.transactions[0];
  const updated=heal.applyHealPatch(old,{id:old.id,statementOccurrences:[{importId:'c'.repeat(32),rowIndex:1}],amountFils:2500,title:'Different'});
  assert.equal(updated.amountFils,3500);
  assert.equal(updated.title,old.title);
  assert.equal(updated.statementOccurrences.length,2);
});


test('a claim-only update cannot erase an earlier financial/parser patch in the same batch', () => {
  const tx=apply([statement('ADCB','a')]).state.transactions[0];
  const result=heal.applyHealUpdates([tx],[{id:tx.id,title:'Correct merchant',category:'shopping'},
    {id:tx.id,statementOccurrences:[{importId:'b'.repeat(32),rowIndex:0}]}]);
  assert.equal(result[0].title,'Correct merchant');
  assert.equal(result[0].category,'shopping');
  assert.equal(result[0].statementOccurrences.length,1);
});


for(const changes of [{date:'2026-08-14'},{amountFils:2501}]) test(`statement source facts survive a permitted live posting difference ${JSON.stringify(changes)}`, () => {
  const card={id:'adcb',name:'ADCB Card',bankName:'ADCB',kind:'card',cardType:'credit',last4:'1234',openingFils:0,color:'#000'};
  const live={id:'live',title:'CAFE',amountFils:2500,type:'expense',category:'dining',accountId:'adcb',source:'sms',date:'2026-08-13',ts:noon-3600_000,smsKey:`s${noon-3600_000}-2500`,captureInstrument:{kind:'credit',last4:'1234',bankIdentity:'adcb'}};
  const row=statement('ADCB','a',{card:{kind:'credit',last4:'1234'},statementRowIndex:0,...changes});
  const first=apply([row],{...base(),accounts:[card],transactions:[live]});
  assert.equal(first.plan.txCount,0);
  const replay=apply([{...row,smsTs:noon+43_200_000}],first.state);
  assert.equal(replay.plan.txCount,0);
  assert.equal(replay.state.transactions[0].date,'2026-08-13');
  assert.equal(replay.state.transactions[0].amountFils,2500);
  assert.throws(()=>apply([{...row,amountFils:2600,smsTs:noon+43_200_000}],first.state),/financial facts/);
});


test('a parser-shifted ordinal cannot replace a different named merchant of equal money', () => {
  const row=statement('ADCB','a',{statementRowIndex:0,merchant:'BOOK SHOP'});
  const first=apply([row]);
  for(const smsTs of [noon,noon+43_200_000]) assert.throws(()=>apply([{...row,merchant:'CAFE',smsTs}],first.state),/financial facts/);
  const edited={...first.state,transactions:first.state.transactions.map(tx=>({...tx,title:'My books',titleEdited:true,userEdited:true}))};
  assert.equal(apply([row],edited).plan.txCount,0);
});
