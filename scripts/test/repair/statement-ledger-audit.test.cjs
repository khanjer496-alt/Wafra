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

// ---------------------------------------------------------------------------
// Statement <-> live-alert overlap: one purchase, one ledger row, whichever
// channel arrives first and however the card network spells the merchant.
// ---------------------------------------------------------------------------
const { parseSms } = require('../build/sms-parser.js');
const markets = require('../build/markets.js');
const { statementDescriptorsAgree } = dedupe;
let alertSerial = 0;
function alert(body, sender, iso) {
  const at = Date.parse(iso);
  const parsed = parseSms(body, {}, { sender, observedAt: at });
  assert.ok(parsed, `alert parses: ${body}`);
  const { raw: _raw, ...rest } = parsed;
  return { ...rest, raw: body, date: parsed.date ?? iso.slice(0, 10), smsTs: at, sender,
    channel: 'inbox', sourceEventId: `stmt-overlap-${++alertSerial}` };
}
/** A statement row as the relay hands it over: midday file clock, upload id, ordinal. */
function fileRow(upload, index, date, merchant, amountFils, changes = {}) {
  return { kind: 'transaction', type: 'expense', amountFils, currency: 'AED', merchant, date,
    dueDay: null, minDueFils: null, card: { kind: 'credit', last4: '1234' }, reference: null,
    transferHint: false, snapshotFils: null, snapshotKind: null, categoryGuess: 'other',
    categoryDeliberate: false, captureSource: 'pdf', smsTs: Date.parse(`${date}T12:00:00Z`) + index,
    statementImportId: upload.repeat(32), statementRowIndex: index, ...changes };
}
function ledger(currency = 'AED') {
  return { ...base(), ledgerMoney: { schemaVersion: 2, currency, exponent: 2 } };
}
const spendOf = (state) => state.transactions.filter((t) => t.type === 'expense').reduce((n, t) => n + t.amountFils, 0);
const enbd = (amount, merchant, day) =>
  alert(`Purchase of AED ${amount} with Credit Card ending 1234 at ${merchant} on ${day}/09/2026. Avl Cr. Limit AED 20,000.00`,
    'EmiratesNBD', `2026-09-${day}T10:00:00Z`);

test('UAE statement descriptors with country, web, city and branch tails reconcile with the prior SMS', () => {
  markets.setActiveMarket('AE'); markets.setLedgerCurrency('AED', 2);
  const pairs = [['CARREFOUR MOE', 'CARREFOUR MOE DUBAI ARE'], ['NOON.COM', 'NOON.COM DUBAI ARE'],
    ['TALABAT', 'TALABAT.COM DUBAI ARE'], ['CAREEM', 'CAREEM RIDE DUBAI ARE'],
    ['LULU HYPERMARKET', 'LULU HYPERMARKET AL BARSHA DUBAI ARE'], ['STARBUCKS', 'STARBUCKS DUBAI MALL DUBAI ARE'],
    ['ENOC 1023', 'ENOC 1023 DUBAI ARE'], ['SPINNEYS JLT', 'SPINNEYS JLT DUBAI']];
  pairs.forEach(([sms, descriptor], i) => {
    const day = String(i + 1).padStart(2, '0');
    const amount = (100 + i).toFixed(2);
    const live = apply([enbd(amount, sms, day)], ledger());
    const result = apply([fileRow('a', 0, `2026-09-${day}`, descriptor, 10000 + i * 100)], live.state);
    assert.equal(result.plan.txCount, 0, `${sms} / ${descriptor}`);
    assert.equal(result.state.transactions.length, 1, `${sms} / ${descriptor}`);
    // And the reverse arrival: the statement first, the SMS later.
    const filed = apply([fileRow('b', 0, `2026-09-${day}`, descriptor, 10000 + i * 100)], ledger());
    const reverse = apply([enbd(amount, sms, day)], filed.state);
    assert.equal(reverse.state.transactions.length, 1, `reverse ${sms} / ${descriptor}`);
  });
});

test('Saudi statement descriptors with city and country tails reconcile with the prior SMS', () => {
  markets.setActiveMarket('SA'); markets.setLedgerCurrency('SAR', 2);
  try {
    const pairs = [['PANDA', 'PANDA RIYADH SAU'], ['JARIR BOOKSTORE', 'JARIR BOOKSTORE RIYADH SA'],
      ['HUNGERSTATION', 'HUNGERSTATION JEDDAH SAU'], ['DANUBE', 'DANUBE JEDDAH'],
      ['NAHDI PHARMACY', 'NAHDI PHARMACY RIYADH'], ['PANDA', 'شراء نقاط بيع PANDA RIYADH']];
    pairs.forEach(([sms, descriptor], i) => {
      const day = String(i + 1).padStart(2, '0');
      const live = apply([alert(`Purchase of SAR ${(100 + i).toFixed(2)} with Credit Card ending 1234 at ${sms}. Available limit SAR 9,000.00.`,
        'AlRajhiBank', `2026-09-${day}T10:00:00Z`)], ledger('SAR'));
      const result = apply([fileRow('c', 0, `2026-09-${day}`, descriptor, 10000 + i * 100, { currency: 'SAR' })], live.state);
      assert.equal(result.state.transactions.length, 1, `${sms} / ${descriptor}`);
    });
  } finally {
    markets.setActiveMarket('AE'); markets.setLedgerCurrency('AED', 2);
  }
});

test('a different business behind the same brand, or a different merchant, stays a second row', () => {
  for (const [sms, descriptor] of [['AMAZON.AE', 'AMAZON CAFE DUBAI ARE'], ['NETFLIX.COM', 'NETFLIX CAR RENTAL DUBAI ARE'],
    ['CARREFOUR MOE', 'CARREFOUR CAFE MOE DUBAI ARE'], ['NOON.COM', 'CARREFOUR MOE DUBAI ARE']]) {
    const live = apply([enbd('55.00', sms, '10')], ledger());
    const result = apply([fileRow('d', 0, '2026-09-10', descriptor, 5500)], live.state);
    assert.equal(result.state.transactions.length, 2, `${sms} / ${descriptor}`);
  }
  for (const [a, b] of [['Amazon', 'AMAZON CAFE DUBAI ARE'], ['Urban Company', 'Urban Restaurant'],
    ['KFC', 'KFC KITCHEN EQUIPMENT'], ['Salary', 'Card payment'], ['Purchase', 'NOON.COM DUBAI ARE'],
    // Sub-brands are separate services, however the brand opens them.
    ['Uber', 'UBER EATS'], ['Careem', 'CAREEM FOOD'], ['Amazon', 'AMAZON PRIME'], ['Noon', 'NOON FOOD'],
    ['Emirates', 'EMIRATES NBD'],
    // Location words never collapse two different names to a shared one.
    ['AIR ARABIA', 'AIR KUWAIT'], ['FLY DUBAI', 'FLY EMIRATES'], ['Home Centre', 'HOME BOX'],
    ['Toys Kingdom', 'TOYS R US'], ['CITY CENTRE DEIRA', 'CITY CENTRE MIRDIF'], ['Dubai Mall', 'DUBAI TAXI'],
    ['Dubai Mall', 'DUBAI MALL PARKING'],
    // Two different station numbers are two stations.
    ['ENOC 1023', 'ENOC 1088 DUBAI ARE'],
    // A purchase whose descriptor mentions a card payment is not a settlement.
    ['Card payment', 'DEBIT CARD PAYMENT CARREFOUR'], ['ATM withdrawal', 'ATM DEPOSIT']]) {
    assert.equal(statementDescriptorsAgree(a, b), false, `${a} / ${b}`);
  }
  for (const [a, b] of [['Noon', 'NOON.COM DUBAI ARE'], ['Salary', 'SALARY ACME TRADING LLC'],
    ['ATM withdrawal', 'ATM WDL 0042 ADCB MARINA'], ['Incoming transfer', 'INWARD REMITTANCE FROM JOHN SMITH'],
    ['Card •1234 payment', 'PAYMENT RECEIVED - THANK YOU'], ['Lulu Hypermarket', 'POS PURCHASE LULU HYPERMARKET'],
    ['ENOC 1023', 'ENOC 1023 DUBAI ARE'], ['ENOC', 'ENOC 1023 DUBAI ARE'], ['Uber', 'UBER *TRIP'],
    ['Panda', 'شراء نقاط بيع PANDA RIYADH']]) {
    assert.equal(statementDescriptorsAgree(a, b), true, `${a} / ${b}`);
  }
});

test('a PDF and a CSV of the same month add nothing, even when the CSV appends a country code', () => {
  const pdf = [fileRow('e', 0, '2026-08-27', 'CARREFOUR MOE DUBAI', 24550),
    fileRow('e', 1, '2026-09-05', 'NOON.COM DUBAI', 18900), fileRow('e', 2, '2026-09-20', 'TALABAT.COM DUBAI', 4500)];
  const first = apply(pdf, ledger());
  assert.equal(first.state.transactions.length, 3);
  const csv = pdf.map((row, i) => ({ ...row, captureSource: 'csv', statementImportId: '6'.repeat(32),
    statementRowIndex: i, merchant: `${row.merchant} ARE` }));
  const second = apply(csv, first.state);
  assert.equal(second.plan.txCount, 0);
  assert.equal(spendOf(second.state), 24550 + 18900 + 4500);
});

const adcbAccount = { id: 'adcb-acct', name: 'ADCB Account •1001', kind: 'bank', bankName: 'ADCB', last4: '1001', openingFils: 0, color: '#000' };
const accountRow = (index, date, merchant, amountFils, changes = {}) =>
  fileRow('1', index, date, merchant, amountFils, { card: { kind: 'account', last4: '1001' }, ...changes });

test('a salary SMS and the statement salary line are one income', () => {
  const live = apply([alert('Salary of AED 15,000.00 has been credited to your account ending 1001', 'ADCBAlert', '2026-09-01T05:00:00Z')],
    { ...ledger(), accounts: [adcbAccount] });
  assert.equal(live.state.transactions.length, 1);
  const result = apply([accountRow(0, '2026-09-01', 'SALARY ACME TRADING LLC', 1500000,
    { type: 'income', categoryGuess: 'salary' })], live.state);
  assert.equal(result.plan.txCount, 0);
  const income = result.state.transactions.filter((t) => t.type === 'income');
  assert.equal(income.length, 1);
  assert.equal(income[0].amountFils, 1500000);
});

test('a debit-card purchase SMS and the account statement row for it are one purchase', () => {
  const live = apply([alert('Purchase of AED 312.40 with Debit Card ending 5678 at LULU HYPERMARKET, DUBAI on 05/09/2026. Avl balance AED 22,187.60',
    'ADCBAlert', '2026-09-05T14:00:00Z')], { ...ledger(), accounts: [adcbAccount] });
  const card = live.state.accounts.find((a) => a.last4 === '5678');
  assert.equal(card.cardType, 'debit');
  const row = accountRow(0, '2026-09-06', 'POS PURCHASE LULU HYPERMARKET', 31240);
  const result = apply([row], live.state);
  assert.equal(result.plan.txCount, 0);
  assert.equal(spendOf(result.state), 31240);
  // A credit card is a separate liability: never paired with an account row.
  const credit = { ...card, id: 'adcb-credit', cardType: 'credit' };
  const onCredit = { ...live.state, accounts: [adcbAccount, credit], transactions: live.state.transactions.map((t) =>
    ({ ...t, accountId: credit.id, captureInstrument: { ...t.captureInstrument, kind: 'credit' } })) };
  assert.equal(apply([row], onCredit).state.transactions.length, 2, 'credit card');
  // An untyped card with an untyped alert may be a credit card: no positive debit evidence.
  const untyped = { ...card, id: 'adcb-card', cardType: undefined };
  const onUntyped = { ...live.state, accounts: [adcbAccount, untyped], transactions: live.state.transactions.map((t) =>
    ({ ...t, accountId: untyped.id, captureInstrument: { ...t.captureInstrument, kind: 'unknown' } })) };
  assert.equal(apply([row], onUntyped).state.transactions.length, 2, 'untyped card');
  // Another bank's account statement does not explain this bank's debit card.
  const otherBank = { ...live.state, accounts: live.state.accounts.map((a) => a.id === adcbAccount.id ? { ...a, bankName: 'HSBC' } : a) };
  assert.equal(apply([row], otherBank).state.transactions.length, 2, 'different bank');
  // Equal money at a different merchant is a second purchase.
  assert.equal(apply([accountRow(0, '2026-09-06', 'POS PURCHASE CARREFOUR', 31240)], live.state).state.transactions.length, 2);
});

test('an Al Rajhi mada purchase and the Al Rajhi account statement row are one purchase', () => {
  markets.setActiveMarket('SA'); markets.setLedgerCurrency('SAR', 2);
  try {
    const rajhi = { id: 'rajhi-acct', name: 'Al Rajhi Account', kind: 'bank', bankName: 'Al Rajhi', last4: '7519', openingFils: 0, color: '#000' };
    const live = apply([alert('Purchase of SAR 245.00 with Mada Card ending 5566 at PANDA, RIYADH. Available balance SAR 14,755.00.',
      'AlRajhiBank', '2026-09-03T10:00:00Z')], { ...ledger('SAR'), accounts: [rajhi] });
    assert.equal(live.state.transactions.length, 1);
    const result = apply([fileRow('2', 0, '2026-09-03', 'شراء نقاط بيع PANDA RIYADH', 24500,
      { currency: 'SAR', card: { kind: 'account', last4: '7519' }, bankHint: 'Al Rajhi' })], live.state);
    assert.equal(result.plan.txCount, 0);
    assert.equal(result.state.transactions.length, 1);
  } finally {
    markets.setActiveMarket('AE'); markets.setLedgerCurrency('AED', 2);
  }
});

test('a statement posting date up to three days after the SMS is the same purchase; four is not', () => {
  for (const lag of [0, 1, 2, 3, 4]) {
    const live = apply([enbd('77.00', 'STARBUCKS', '10')], ledger());
    const result = apply([fileRow('3', 0, `2026-09-${10 + lag}`, 'STARBUCKS DUBAI MALL DUBAI ARE', 7700)], live.state);
    assert.equal(result.state.transactions.length, lag <= 3 ? 1 : 2, `lag ${lag}`);
  }
  // Two live alerts are never widened: equal coffees two days apart stay two.
  const twoAlerts = apply([enbd('77.00', 'STARBUCKS', '10'), enbd('77.00', 'STARBUCKS', '12')], ledger());
  assert.equal(twoAlerts.state.transactions.length, 2);
});

test('two genuine identical purchases on one day stay two rows on both channels', () => {
  const coffee = (hour) => alert('Purchase of AED 18.00 with Credit Card ending 1234 at STARBUCKS on 10/09/2026. Avl Cr. Limit AED 20,000.00',
    'EmiratesNBD', `2026-09-10T${hour}:00:00Z`);
  const rows = [fileRow('4', 0, '2026-09-10', 'STARBUCKS DUBAI ARE', 1800), fileRow('4', 1, '2026-09-10', 'STARBUCKS DUBAI ARE', 1800)];
  const both = apply(rows, apply([coffee('05'), coffee('09')], ledger()).state);
  assert.equal(both.state.transactions.length, 2);
  const oneAlert = apply(rows, apply([coffee('05')], ledger()).state);
  assert.equal(oneAlert.state.transactions.length, 2, 'the statement adds the coffee the SMS missed');
  // Three days of posting lag cannot let one alert absorb two statement rows.
  const lagged = apply([fileRow('5', 0, '2026-09-11', 'STARBUCKS', 1800), fileRow('5', 1, '2026-09-13', 'STARBUCKS', 1800)],
    apply([coffee('05')], ledger()).state);
  assert.equal(lagged.state.transactions.length, 2);
});

test('statement first, debit-card SMS later, then the same statement again: one row, no conflict', () => {
  const debit = { id: 'adcb-debit', name: 'ADCB Debit •5678', kind: 'card', cardType: 'debit', bankName: 'ADCB',
    last4: '5678', openingFils: 0, color: '#000' };
  const row = accountRow(0, '2026-09-06', 'POS PURCHASE LULU HYPERMARKET', 31240);
  const filed = apply([row], { ...ledger(), accounts: [adcbAccount, debit] });
  const sms = alert('Purchase of AED 312.40 with Debit Card ending 5678 at LULU HYPERMARKET, DUBAI on 05/09/2026. Avl balance AED 22,187.60',
    'ADCBAlert', '2026-09-05T14:00:00Z');
  const live = apply([sms], filed.state);
  assert.equal(live.state.transactions.length, 1);
  // The file row is never re-homed onto the card by the alert.
  assert.equal(live.state.transactions[0].accountId, adcbAccount.id);
  const again = apply([row], JSON.parse(JSON.stringify(live.state)));
  assert.equal(again.plan.txCount, 0);
  assert.equal(again.state.transactions.length, 1);
  // Forward order: SMS, statement, the same statement again.
  const forward = apply([row], apply([sms], { ...ledger(), accounts: [adcbAccount, debit] }).state);
  assert.equal(forward.state.transactions.length, 1);
  const forwardAgain = apply([row], JSON.parse(JSON.stringify(forward.state)));
  assert.equal(forwardAgain.plan.txCount, 0);
  assert.equal(forwardAgain.state.transactions.length, 1);
});

test('one alert is never claimed by rows from two different statements', () => {
  const live = apply([enbd('77.00', 'STARBUCKS', '28')], ledger());
  // September's file posts it on the 29th; October's file has another AED 77
  // posted on the 1st whose SMS was missed. Both are in each one's window.
  const september = apply([fileRow('7', 0, '2026-09-29', 'STARBUCKS DUBAI MALL DUBAI ARE', 7700)], live.state);
  assert.equal(september.state.transactions.length, 1);
  const october = apply([fileRow('8', 0, '2026-10-01', 'STARBUCKS DUBAI MALL DUBAI ARE', 7700)],
    JSON.parse(JSON.stringify(september.state)));
  assert.equal(october.state.transactions.length, 2, 'the October purchase is not erased');
  // A CSV reprint of the September row keeps its date and adds nothing.
  const reprint = apply([fileRow('9', 0, '2026-09-29', 'STARBUCKS DUBAI MALL DUBAI ARE', 7700, { captureSource: 'csv' })],
    JSON.parse(JSON.stringify(september.state)));
  assert.equal(reprint.plan.txCount, 0);
});
