'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const contract = load(path.join(root, 'src/lib/cloud-import-contract.ts'));
const coverage = { sourceKey: 'card:credit:1234', label: 'Card', startDate: '2026-09-01', endDate: '2026-09-30' };
test('a partially read CSV never claims complete coverage', () => {
 const result = contract.parseCsvImportAccepted({ acceptedRows: 1, rejectedRows: 1, totalRows: 2, coverage });
 assert.equal(result.coverage, null);
});
test('impossible coverage dates are rejected', () => {
 for (const date of ['2026-02-30', '2026-13-01', '2026-00-01']) {
  assert.equal(contract.parsePdfImportAccepted({ acceptedRows: 1, pages: 1, coverage: { ...coverage, startDate: date, endDate: date } }), null);
 }
});
test('mixed account refusal reaches a specific client error', () => {
 assert.equal(contract.pdfImportError(422, { error: 'multiple_statement_accounts' }).code, 'multiple_statement_accounts');
});
const fs = require('node:fs');
const flowPath = path.join(root, 'src/lib/statement-import-flow.ts');
const flow = () => load(flowPath);
const page = overrides => ({ kind: 'imported', source: 'relay', transactions: 2, reviewAlerts: 0, ...overrides });
test('full Review capacity remains pending instead of reporting successful statement filing', async () => {
 const result = await flow().drainStatementQueue(async () => page({ transactions: 0, deferredReviews: 2, moreQueued: false }));
 assert.equal(result.complete, false); assert.equal(result.reason, 'review');
});
test('paused capture cannot be reported as a completed statement import', async () => {
 const result = await flow().drainStatementQueue(async () => page({ kind: 'up-to-date', source: 'none', transactions: 0 }));
 assert.equal(result.complete, false); assert.equal(result.reason, 'interrupted');
});
test('a later page error preserves earlier committed counts for the user', async () => {
 let calls = 0; const error = new Error('offline');
 const result = await flow().drainStatementQueue(async () => { if (++calls === 2) throw error; return page({ moreQueued: true }); });
 assert.equal(result.complete, false); assert.equal(result.imported, 2); assert.equal(result.error, error);
});
test('a later page can fill deferred reviews but a no-progress queue never loops', async () => {
 let calls = 0;
 const result = await flow().drainStatementQueue(async () => ++calls === 1 ? page({ moreQueued: true, deferredReviews: 1 }) : page({ transactions: 0, deferredReviews: 1, moreQueued: false }));
 assert.equal(calls, 2); assert.equal(result.complete, false); assert.equal(result.imported, 2);
});
test('generation or privacy interruption between pages stops further capture', async () => {
 let current = true, calls = 0;
 const result = await flow().drainStatementQueue(async () => { calls++; current = false; return page({ moreQueued: true }); }, () => current);
 assert.equal(calls, 1); assert.equal(result.complete, false); assert.equal(result.reason, 'interrupted');
});
test('web-picked statement uploads its actual browser File without native filesystem access', async () => {
 const bytes = new Blob(['Date,Description,Debit\n2026-09-01,Cafe,25.00'], { type: 'text/csv' });
 let sent, headers;
 const transport = load(path.join(root, 'src/lib/cloud-import.ts'), {
  'expo/fetch': { fetch: async (_url, init) => { sent = init.body; headers = init.headers; return { ok: true, status: 202, text: async () => JSON.stringify({acceptedRows:1,rejectedRows:0,totalRows:1,pages:1}) }; } },
  'expo-file-system': { File: class { constructor() { throw new Error('native filesystem unavailable'); } } },
  '@/lib/cloud-import-contract': contract,
 }, { AbortController });
 const result = await transport.uploadCsvStatement({baseUrl:'https://example.invalid',adminToken:'test'},
  {uri:'blob:local',name:'statement.csv',file:bytes}, {csv:{enabled:true,accepts:['text/csv'],maxBytes:1000}}, {currency:'AED',exponent:2});
 assert.equal(result.acceptedRows,1); assert.equal(sent,bytes);
 const caps={csv:{enabled:true,accepts:['text/csv'],maxBytes:1000},pdf:{enabled:true,accepts:['application/pdf'],maxBytes:1000}};
 for(const order of [null,'day-first','month-first']) {
  await transport.uploadCsvStatement({baseUrl:'https://example.invalid',adminToken:'test'},
   {uri:'blob:local',name:'statement.csv',file:bytes},caps,{currency:'AED',exponent:2},order);
  assert.equal(headers['x-wafra-date-order'],order??'unknown');
  await transport.uploadPdfStatement({baseUrl:'https://example.invalid',adminToken:'test'},
   {uri:'blob:local',name:'statement.pdf',file:bytes},caps,{currency:'AED',exponent:2},undefined,order);
  assert.equal(headers['x-wafra-date-order'],order??'unknown');
 }

});
function finishHarness(results) {
 const ts = require('typescript'), vm = require('node:vm');
 const source = fs.readFileSync(path.join(root, 'src/components/supplement-imports.tsx'), 'utf8');
 const body = source.slice(source.indexOf('  const finishQueuedImport = useCallback('), source.indexOf('\n  useEffect(() => {', source.indexOf('  const finishQueuedImport = useCallback(')));
 let generation = 1, summary = null; const events = [];
 const context = { useCallback: f => f, getStateGeneration: () => generation, aliveRef: {current:true},
  queuedRetryNeededRef:{current:false},queuedRetryContextRef:{current:null},
  setStatus: v => events.push(['status',v]),setError: v=>events.push(['error',v]),
  copy:{acceptedFiling:'filing',acceptedPending:'pending',syncFailed:'failed',syncNeedsReview:'review'},
  interpolate:v=>v, syncQueued:async()=>results.shift(),
  setSummary:f=>summary=f(summary), rememberCoverage:async v=>events.push(['coverage',v]),
  ensureDurable:async()=>events.push(['durable']),batchSummary:ctx=> {events.push(['batch',ctx]);return 'complete';},
  committed:()=>events.push(['committed']),failed:()=>events.push(['failed']),syncFailureReason:()=> 'failed',
  alreadyInWafra: load(path.join(root, 'src/lib/statement-batch.ts')).alreadyInWafra,
 };
 vm.runInNewContext(ts.transpileModule(body+'\nglobalThis.finish = finishQueuedImport;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText, context);
 return {context,events,get summary(){return summary},finish:context.finish,replace(){generation++}};
}
test('component completion records ranges only after a completed queue and durable save', async () => {
 const h=finishHarness([{complete:false,reason:'review',imported:2,review:1},{complete:true,imported:1,review:0}]);
 assert.equal(await h.finish(1,3,1,1,0,[coverage],1),false);
 assert.equal(h.events.some(e=>e[0]==='coverage'),false);
 assert.equal(h.summary.added,2);assert.equal(h.summary.skipped,1);
 const c=h.context.queuedRetryContextRef.current;
 assert.equal(await h.finish(c.files,c.accepted,c.rejected,c.pages,c.alreadyProcessed,c.ranges,c.generation,c.reportedImported,c.totalRejected,true),true);
 assert.equal(h.summary.added,3);assert.equal(h.summary.skipped,1);
 assert.equal(h.events.find(e=>e[0]==='batch')[1].rejected,1);
 assert.deepEqual(h.events.filter(e=>['coverage','durable','committed'].includes(e[0])).map(e=>e[0]),['coverage','durable','committed']);
});
test('component completion never attaches old coverage after ledger replacement', async () => {
 const h=finishHarness([{complete:true,imported:2,review:0}]);h.replace();
 assert.equal(await h.finish(1,2,0,1,0,[coverage],1),false);
 assert.equal(h.events.some(e=>e[0]==='coverage'),false);
});
test('a full page of reserved setup probes is pending rather than completed', async () => {
 const result=await flow().drainStatementQueue(async()=>page({transactions:0,moreQueued:false,queueBlocked:true}));
 assert.equal(result.complete,false);
});
test('durably saved rows remain counted when retiring the relay copy fails', async () => {
 const api=flow(), cause=new Error('ack failed');
 const result=await api.drainStatementQueue(async()=>{throw new api.StatementFilingError(cause,2,1)});
 assert.equal(result.imported,2);assert.equal(result.review,1);assert.equal(result.complete,false);assert.equal(result.error,cause);
});
test('new unlocked-file completion retains a previous pending batch range and skipped total', async () => {
 const h=finishHarness([{complete:false,reason:'review',imported:2,review:0},{complete:true,imported:1,review:0}]);
 await h.finish(1,2,1,1,0,[coverage],1);
 await h.finish(1,1,2,1,0,[{...coverage,sourceKey:'second'}],1);
 assert.equal(h.summary.added,3);assert.equal(h.summary.skipped,3);
 assert.equal(h.events.find(e=>e[0]==='coverage')[1].length,2);
 const report=h.events.find(e=>e[0]==='batch')[1];
 assert.equal(report.files,2);assert.equal(report.accepted,3);assert.equal(report.rejected,3);
});
test('rows read but not added are reported as already in Wafra, never folded into skipped', async () => {
 // 41 rows read, 40 new, one matched an alert already in the ledger.
 const h=finishHarness([{complete:true,imported:40,review:0}]);
 assert.equal(await h.finish(1,41,0,2,0,[coverage],1),true);
 assert.equal(h.summary.added,40);assert.equal(h.summary.already,1);assert.equal(h.summary.skipped,0);
 assert.equal(h.events.find(e=>e[0]==='batch')[1].already,1);
});
test('already-in-Wafra is not claimed while filing is still pending, and survives the retry', async () => {
 const h=finishHarness([{complete:false,reason:'review',imported:30,review:2},{complete:true,imported:5,review:0}]);
 await h.finish(1,41,3,2,0,[coverage],1);
 assert.equal(h.summary.already,undefined);
 const c=h.context.queuedRetryContextRef.current;
 await h.finish(c.files,c.accepted,c.rejected,c.pages,c.alreadyProcessed,c.ranges,c.generation,c.reportedImported,c.totalRejected,true,c.reportedOther);
 // 41 read = 35 added + 2 for review + 4 already there; the 3 unreadable rows are separate.
 assert.equal(h.summary.added,35);assert.equal(h.summary.review,2);assert.equal(h.summary.already,4);assert.equal(h.summary.skipped,3);
});
test('the already-in-Wafra count never goes negative and leaves out new dues and bills', () => {
 const {alreadyInWafra}=load(path.join(root,'src/lib/statement-batch.ts'));
 assert.equal(alreadyInWafra(41,40,0),1);
 assert.equal(alreadyInWafra(71,70,0,1),0);
 assert.equal(alreadyInWafra(3,5,0),0);
 assert.equal(alreadyInWafra(10,4,2,1),3);
});
test('the drain reports new dues and bills filed alongside transactions', async () => {
 const result=await flow().drainStatementQueue(async()=>page({transactions:70,dues:1,bills:0,moreQueued:false}));
 assert.equal(result.imported,70);assert.equal(result.filedOther,1);
});
test('protected retry checks current privacy before uploading bytes and current currency when allowed', async () => {
 const ts=require('typescript'),vm=require('node:vm');
 const source=fs.readFileSync(path.join(root,'src/components/supplement-imports.tsx'),'utf8');
 const body=source.slice(source.indexOf('  const retryProtectedPdf ='),source.indexOf('  const cancelProtectedPdf ='));
 let privateMode=true; const uploads=[];
 const pending={asset:{uri:'file:///locked.pdf',name:'locked.pdf'},file:{exists:true,delete(){}}};
 const currentMoney={currency:'USD',exponent:2};
 const ctx={cfg:{},capabilities:{},pendingPdf:pending,pdfPassword:'test-only',busy:null,
  queuedRetryInFlightRef:{current:false},state:{ledgerMoney:{currency:'AED',exponent:2}},
  getStateSnapshot:()=>({hydrated:true,privateMode,ledgerMoney:currentMoney}),getStateGeneration:()=>1,
  aliveRef:{current:true},dateOrder:null,newStatementRange:()=>null,inFlightPickerUris:new Set(),setBusy(){},setError(){},setPdfPassword(){},
  uploadPdfStatement:async(...args)=>{uploads.push(args);return {acceptedRows:1,rejectedRows:0,pages:1,alreadyProcessed:false}},
  setFileResults(){},fileImportedDetail:()=>'',finishQueuedImport:async()=>true,setPendingPdfs(){},
  setCurrencySheetVisible(){},copy:{fileLocked:'locked'},failed(){},CloudImportError:contract.CloudImportError,errorText:()=>'',
 };
 vm.runInNewContext(ts.transpileModule(body+'\nglobalThis.retry = retryProtectedPdf;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,ctx);
 await ctx.retry();assert.equal(uploads.length,0);
 privateMode=false;await ctx.retry();assert.equal(uploads.length,1);assert.equal(uploads[0][3],currentMoney);
 assert.equal(ctx.inFlightPickerUris.size,0);
});
test('a queue-full upload still drains accepted rows even when no file returned success', async () => {
 const ts=require('typescript'),vm=require('node:vm');
 const source=fs.readFileSync(path.join(root,'src/components/supplement-imports.tsx'),'utf8');
 const body=source.slice(source.indexOf('  const recoverQueuedRows ='),source.indexOf('  /** What one successfully uploaded file')) + source.slice(source.indexOf('  const pickAndUpload ='),source.indexOf('  /** One tap:'));
 let summary=null, drains=0, finishes=0;const money={currency:'AED',exponent:2};
 const noop=()=>{};
 const ctx={useCallback:f=>f,queuedRetryNeededRef:{current:false},pendingPdfs:[],state:{ledgerMoney:money},getStateSnapshot:()=>({hydrated:true,privateMode:false,ledgerMoney:money}),
  getStateGeneration:()=>1,aliveRef:{current:true},queuedRetryContextRef:{current:null},dateOrder:null,
  setCurrencySheetVisible:noop,setError:noop,setStatus:noop,setFileResults:noop,setSummary:v=>summary=typeof v==='function'?v(summary):v,
  setFilesOpen:noop,setBusy:noop,setLiveFiles:noop,setProgress:noop,setPendingPdfs:noop,setPdfPassword:noop,
  DocumentPicker:{getDocumentAsync:async()=>({canceled:false,assets:[{uri:'blob:fixture',name:'a.csv',mimeType:'text/csv'}]})},
  Platform:{OS:'web'},File:class{},inFlightPickerUris:new Set(),nextUploadDelay:()=>0,
  uploadCsvStatement:async()=>{throw new contract.CloudImportError('queue_full',429)},
  uploadPdfStatement:async()=>{throw Error('wrong type')},syncQueued:async()=>{drains++;return{imported:2,review:1,complete:true}},
  finishQueuedImport:async()=>{finishes++},rememberCoverage:async()=>{throw Error('failed file has no range')},
  CloudImportError:contract.CloudImportError,copy:{fileFailed:'failed',fileLocked:'locked'},interpolate:s=>s,
  errorText:()=> 'queue full',failed:noop,sleep:async()=>{},RATE_LIMIT_RETRY_MS:1,
  stopRequestedRef:{current:false},stopWakeRef:{current:null},setStopping:noop,setPacing:noop,BatchStopped:class extends Error{},
  statementBatches:{running:0,copies:new Set()},setSending:noop,
 };
 vm.runInNewContext(ts.transpileModule(body+'\nglobalThis.pick = pickAndUpload;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,ctx);
 await ctx.pick({}, {pdf:{accepts:['application/pdf']},csv:{accepts:['text/csv']}});
 assert.equal(drains,1);assert.equal(finishes,0);assert.equal(summary.added,2);assert.equal(summary.review,1);
});
function rereadHarness(responses, transactions = [], queued = []) {
 const ts=require('typescript'),vm=require('node:vm');
 const source=fs.readFileSync(path.join(root,'src/components/supplement-imports.tsx'),'utf8');
 const body=source.slice(source.indexOf('  const recoverQueuedRows ='),source.indexOf('  /** What one successfully uploaded file')) + source.slice(source.indexOf('  const pickAndUpload ='),source.indexOf('  /** One tap:'));
 const calls=[]; const results=[]; const money={currency:'AED',exponent:2}; const noop=()=>{};
 const ctx={useCallback:f=>f,queuedRetryNeededRef:{current:false},pendingPdfs:[],state:{ledgerMoney:money},
  getStateSnapshot:()=>({hydrated:true,privateMode:false,ledgerMoney:money,transactions}),
  getStateGeneration:()=>1,aliveRef:{current:true},queuedRetryContextRef:{current:null},dateOrder:null,
  setCurrencySheetVisible:noop,setError:noop,setStatus:noop,setFileResults:v=>results.push(...v),setSummary:noop,
  setFilesOpen:noop,setBusy:noop,setLiveFiles:noop,setProgress:noop,setPendingPdfs:noop,setPdfPassword:noop,
  DocumentPicker:{getDocumentAsync:async()=>({canceled:false,assets:[{uri:'blob:fixture',name:'a.csv',mimeType:'text/csv'}]})},
  Platform:{OS:'web'},File:class{},inFlightPickerUris:new Set(),nextUploadDelay:()=>0,
  uploadCsvStatement:async(...args)=>{calls.push(args[5]);const next=responses.shift();if(next instanceof Error||next instanceof contract.CloudImportError)throw next;return next;},
  uploadPdfStatement:async()=>{throw Error('wrong type')},
  // Filing the relay queue lands its rows in the ledger.
  syncQueued:async()=>{const n=queued.length;transactions.push(...queued.splice(0));return {imported:n,review:0,complete:true};},
  finishQueuedImport:async()=>{},rememberCoverage:async()=>{},newStatementRange:flow().newStatementRange,
  holdsStatementRows:flow().holdsStatementRows,fileImportedDetail:()=> 'ok',
  CloudImportError:contract.CloudImportError,copy:{fileFailed:'failed',fileLocked:'locked'},interpolate:s=>s,
  errorText:(e)=>e.code,failed:noop,sleep:async()=>{},RATE_LIMIT_RETRY_MS:1,
  stopRequestedRef:{current:false},stopWakeRef:{current:null},setStopping:noop,setPacing:noop,BatchStopped:class extends Error{},
  statementBatches:{running:0,copies:new Set()},setSending:noop,
 };
 vm.runInNewContext(ts.transpileModule(body+'\nglobalThis.pick = pickAndUpload;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,ctx);
 return {pick:()=>ctx.pick({}, {pdf:{accepts:['application/pdf']},csv:{accepts:['text/csv']}}),calls,results};
}
const ok202 = (id, alreadyProcessed=false) => ({acceptedRows:2,rejectedRows:0,totalRows:2,alreadyProcessed,statementImportId:id,coverage:null});
test('a file already processed for an empty ledger (reinstall, erase, older backup) is read again, not left as a dead end', async () => {
 const h=rereadHarness([ok202('a'.repeat(32),true), ok202('b'.repeat(32))]);
 await h.pick();
 assert.deepEqual(h.calls,[false,true]);
});
test('a file already processed whose rows this phone holds is not read again', async () => {
 const h=rereadHarness([ok202('a'.repeat(32),true)],[{statementImportId:'a'.repeat(32)}]);
 await h.pick();
 assert.deepEqual(h.calls,[false]);
});
test('a different-settings refusal about rows this phone does not hold is read again', async () => {
 const conflict=new contract.CloudImportError('statement_options_conflict',409,{statementImportId:'a'.repeat(32),previousDateOrder:'month-first'});
 const h=rereadHarness([conflict, ok202('b'.repeat(32))]);
 await h.pick();
 assert.deepEqual(h.calls,[false,true], JSON.stringify(h.results));
});
test('a different-settings refusal about rows this phone holds names the earlier order instead', async () => {
 const conflict=new contract.CloudImportError('statement_options_conflict',409,{statementImportId:'a'.repeat(32),previousDateOrder:'month-first'});
 const h=rereadHarness([conflict],[{statementOccurrences:[{importId:'a'.repeat(32),rowIndex:3}]}]);
 await h.pick();
 assert.deepEqual(h.calls,[false]);
 assert.equal(contract.pdfImportError(409,{error:'statement_options_conflict',statementImportId:'a'.repeat(32),previousDateOrder:'month-first'}).detail.previousDateOrder,'month-first');
 const screen=fs.readFileSync(path.join(root,'src/components/supplement-imports.tsx'),'utf8');
 assert.match(screen,/interpolate\(copy\.errOptionsConflictOrder, \{ order: order === 'day-first' \? copy\.dateDayFirst : copy\.dateMonthFirst \}\)/);
});
test('rows of the earlier read still waiting in the relay queue are filed first; the file is not read again', async () => {
 const queued=[{statementImportId:'a'.repeat(32)}];
 const h=rereadHarness([ok202('a'.repeat(32),true)],[],queued);
 await h.pick();
 assert.deepEqual(h.calls,[false]);
});
test('a parser-change refusal about rows this phone holds says so, and is not read again', async () => {
 const conflict=new contract.CloudImportError('statement_options_conflict',409,{statementImportId:'a'.repeat(32),reason:'parser'});
 const h=rereadHarness([conflict],[{statementImportId:'a'.repeat(32)}]);
 await h.pick();
 assert.deepEqual(h.calls,[false]);
 assert.equal(contract.pdfImportError(409,{error:'statement_options_conflict',statementImportId:'a'.repeat(32),reason:'parser'}).detail.reason,'parser');
 const screen=fs.readFileSync(path.join(root,'src/components/supplement-imports.tsx'),'utf8');
 assert.match(screen,/value\.detail\?\.reason === 'parser'\) return copy\.errParserRead/);
});
test('a file is held when the ledger holds ANY id the relay names for it (first read or re-read)', async () => {
 const response={...ok202('c'.repeat(32),true),statementImportIds:['a'.repeat(32),'c'.repeat(32)]};
 const h=rereadHarness([response],[{statementImportId:'a'.repeat(32)}]);
 await h.pick();
 assert.deepEqual(h.calls,[false]);
 const parsed=contract.parseCsvImportAccepted({acceptedRows:1,rejectedRows:0,totalRows:1,statementImportId:'c'.repeat(32),statementImportIds:['a'.repeat(32),'c'.repeat(32)]});
 assert.deepEqual([...parsed.statementImportIds],['a'.repeat(32),'c'.repeat(32)]);
 const conflict=contract.pdfImportError(409,{error:'statement_options_conflict',statementImportId:'c'.repeat(32),statementImportIds:['a'.repeat(32),'c'.repeat(32)],reason:'options'});
 assert.deepEqual([...conflict.detail.statementImportIds],['a'.repeat(32),'c'.repeat(32)]);
 assert.equal(contract.parseCsvImportAccepted({acceptedRows:1,rejectedRows:0,totalRows:1,statementImportIds:['nope']}).statementImportIds,undefined);
});
test('the upload asks for a re-read only when told to', async () => {
 const headers=[];
 const transport = load(path.join(root, 'src/lib/cloud-import.ts'), {
  'expo/fetch': { fetch: async (_url, init) => { headers.push(init.headers); return { ok: true, status: 202, text: async () => JSON.stringify({acceptedRows:1,rejectedRows:0,totalRows:1,pages:1}) }; } },
  'expo-file-system': { File: class { constructor() { throw new Error('native filesystem unavailable'); } } },
  '@/lib/cloud-import-contract': contract,
 }, { AbortController });
 const caps={csv:{enabled:true,accepts:['text/csv'],maxBytes:1000}};
 const file={uri:'blob:local',name:'s.csv',file:new Blob(['Date,Description,Debit\n2026-09-01,Cafe,25.00'],{type:'text/csv'})};
 await transport.uploadCsvStatement({baseUrl:'https://example.invalid',adminToken:'t'},file,caps,{currency:'AED',exponent:2});
 await transport.uploadCsvStatement({baseUrl:'https://example.invalid',adminToken:'t'},file,caps,{currency:'AED',exponent:2},null,true);
 assert.equal(headers[0]['x-wafra-statement-reread'],undefined);
 assert.equal(headers[1]['x-wafra-statement-reread'],'1');
});
test('holding a statement upload counts its own rows and its claims on matched rows', () => {
 const {holdsStatementRows}=flow();
 assert.equal(holdsStatementRows([],'a'.repeat(32)),false);
 assert.equal(holdsStatementRows([{statementImportId:'a'.repeat(32)}],'a'.repeat(32)),true);
 assert.equal(holdsStatementRows([{statementOccurrences:[{importId:'a'.repeat(32)}]}],'a'.repeat(32)),true);
 assert.equal(holdsStatementRows([{statementImportId:'b'.repeat(32)}],'a'.repeat(32)),false);
});
test('replayed or legacy files cannot claim a newly interpreted activity range', () => {
 const {newStatementRange}=flow();
 const accepted={statementImportId:'a'.repeat(32),alreadyProcessed:false,coverage};
 assert.equal(newStatementRange(accepted,[]),coverage);
 assert.equal(newStatementRange(accepted,[{statementImportId:'a'.repeat(32)}]),null);
 assert.equal(newStatementRange(accepted,[{statementOccurrences:[{importId:'a'.repeat(32),rowIndex:0}]}]),null);
 assert.equal(newStatementRange({...accepted,alreadyProcessed:true},[]),null);
 assert.equal(newStatementRange({...accepted,statementImportId:undefined},[]),null);
 for(const statementImportId of ['raw file name','b'.repeat(64),'']) {
  assert.equal(contract.parseCsvImportAccepted({acceptedRows:1,rejectedRows:0,totalRows:1,statementImportId}),null);
 }
});
test('statement screen errors say what happened: pairing failures, unusable passwords, the hourly limit', () => {
 const screen = fs.readFileSync(path.join(root, 'src/components/supplement-imports.tsx'), 'utf8');
 const copy = fs.readFileSync(path.join(root, 'src/lib/supplement-copy.ts'), 'utf8');
 // Connecting the phone fails before any upload, so it must not say rows may be queued.
 assert.match(screen, /if \(value instanceof RelayError\) return value\.retryable \? copy\.errNetwork : copy\.serviceError;/);
 assert.match(screen, /value\.code === 'pdf_password_incorrect' \|\| value\.code === 'pdf_password_required'\) return copy\.passwordWrong/);
 // The relay's statement budget is hourly; the copy must not promise a minute.
 assert.doesNotMatch(copy, /Wait a minute|انتظر دقيقة/);
 assert.match(screen, /returnKeyType="go"[\s\S]{0,120}onSubmitEditing=\{\(\) => \{ if \(pdfPassword && busy === null\) void retryProtectedPdf\(\); \}\}/);
});
