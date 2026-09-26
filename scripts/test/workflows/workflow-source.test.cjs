'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
const root=path.resolve(__dirname,'../../..');
const manifest=require('./protected-handlers.json');
const source=file=>ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const traverse=(node,cb)=>{cb(node);ts.forEachChild(node,n=>traverse(n,cb));};
test('60 protected action bodies match their individually reviewed fingerprints',()=>{
 assert.equal(manifest.records.length,60);const printer=ts.createPrinter({removeComments:true});
 for(const record of manifest.records){const sf=source(record.file);let found=null;traverse(sf,n=>{if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.name.text===record.name)found=n.initializer});
  assert.ok(found,`${record.file}:${record.name}`);const value=printer.printNode(ts.EmitHint.Unspecified,found,sf);
  assert.equal(crypto.createHash('sha256').update(value).digest('hex'),record.sha256,`${record.file}:${record.name} changed`);
 }
});
test('workflow copy has matching nonempty English/Arabic keys',()=>{
 const sf=source('src/lib/workflow-copy.ts'),objects={};traverse(sf,n=>{if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&['en','ar'].includes(n.name.text)){let v=n.initializer;if(ts.isAsExpression(v))v=v.expression;objects[n.name.text]=Object.fromEntries(v.properties.map(p=>[p.name.getText(sf),p.initializer.text]));}});
 assert.deepEqual(Object.keys(objects.en).sort(),Object.keys(objects.ar).sort());for(const[key,value]of Object.entries(objects.ar)){assert.ok(value?.trim(),key);assert.match(value,/[\u0600-\u06ff]/,key);}
});
test('workflow consumers have real imports for their current localized presentation',()=>{
 const files=['settings','import-sms','ios-setup','feedback','review-alerts','categorise','pro','trusted-devices'].map(n=>`src/app/${n}.tsx`).concat('src/components/onboarding-gate.tsx');
 for(const file of files){const sf=source(file),names=new Set();for(const n of sf.statements)if(ts.isImportDeclaration(n)&&n.importClause?.namedBindings&&ts.isNamedImports(n.importClause.namedBindings))for(const element of n.importClause.namedBindings.elements)names.add(element.name.text);
  if(file.endsWith('/onboarding-gate.tsx')){
   // Design language E: the steps are their own modules with their own copy.
   for(const name of ['WelcomeStep','NameStep','GoalsStep','WatchStep','RemindersStep','PatternStep','PaywallStep','onboardingECopy','t','useLanguage','useEMotion'])assert.ok(names.has(name),`${file}: ${name} import`);
   assert.ok(!names.has('SetupIllustration')&&!names.has('workflowCopy'),'Welcome uses its example pattern and current translated copy');
  }else if(file.endsWith('/ios-setup.tsx')){
   for(const name of ['SetupHeader','SetupShell','ChecklistRow','AutomationGuide','iosSetupJourneyCopy','t','useLanguage'])assert.ok(names.has(name),`${file}: ${name} import`);
   assert.ok(!names.has('WorkflowHero')&&!names.has('workflowCopy'),'iOS setup has one heading before its actionable checklist');
  }else if(file.endsWith('/import-sms.tsx')){
   // 2026-09-23 screen polish: imports drop the repeated hero heading and lead with their step indicator.
   assert.ok(names.has('ImportSteps'),`${file}: step indicator import`);
   assert.ok(!names.has('WorkflowHero'),'Imports do not repeat the screen heading in a hero');
  }else{
   assert.ok(names.has('workflowCopy'),`${file}: copy import`);
   if(file.endsWith('/settings.tsx')){
    assert.ok(names.has('useLocalSearchParams'),'Settings resolves its recovery deep-links');
    assert.match(fs.readFileSync(path.join(root,file),'utf8'), /testID="settings-imports"[\s\S]*onLayout/);
    assert.ok(!names.has('WorkflowNavigation'),'Settings retains its current continuous sections');
    assert.ok(!names.has('WorkflowHero'),'Settings must not duplicate its page heading');
   }else if(file.endsWith('/review-alerts.tsx')){
    assert.ok(!names.has('WorkflowHero'),'Review alerts has one compact intro instead of a repeated hero');
    assert.match(fs.readFileSync(path.join(root,file),'utf8'),/testID="review-alerts-intro"/);
   }else if(file.endsWith('/pro.tsx')){
    assert.ok(!names.has('WorkflowHero'),'Pro does not repeat its page heading in a hero');
   }else if(file.endsWith('/trusted-devices.tsx')||file.endsWith('/feedback.tsx')){
    // Design language E: the band carries the plain title; no hero repeats it.
    assert.ok(names.has('BandScaffold')&&!names.has('WorkflowHero'),`${file}: band screen without a repeated hero`);
   }else assert.ok(names.has('WorkflowHero'),`${file}: surface import`);
  }
 }
});

// Execute the shipping preference handlers as well as fingerprinting them.
// Their route behavior changed intentionally; no native service is involved.
const onboardingAction=(name,inputs,transitionAllowed=true)=>{
 const sf=source('src/components/onboarding-gate.tsx');let found;
 traverse(sf,n=>{if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.name.text===name)found=n.initializer});
 assert.ok(found,`shipping ${name} exists`);
 const action=ts.createPrinter().printNode(ts.EmitHint.Unspecified,found,sf);
 const js=ts.transpileModule(`const action = ${action}; action();`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 let transitionChecks=0;
 require('node:vm').runInNewContext(js,{...inputs,beginStepTransition:()=>{
  transitionChecks++;return transitionAllowed;
 }});
 assert.equal(transitionChecks,1,`shipping ${name} checks the transition guard exactly once`);
};
test('main onboarding Back actions follow the integrated journey',()=>{
 // Design language E: welcome, name (1), goals (2), watch (3), reminders (4),
 // first payment (5: capture on Android, live on iPhone, complete for its
 // result), then the pattern and the paywall. Each Back saves the stage the
 // earlier step owns, so a relaunch resumes where the person now is.
 const cases=[
  ['android','paywall','pattern',null],['android','pattern','complete',null],
  ['android','complete','capture','capture'],['android','capture','reminders','alerts'],
  ['ios','live','reminders','alerts'],['ios','complete','live','capture'],
  ['android','reminders','watch','tracking'],['android','watch','goals','focus'],
  ['android','goals','name','welcome'],['android','name','welcome','welcome'],
 ];
 for(const[os,activeStep,expected,journey]of cases){
  const events=[];
  onboardingAction('goBack',{Platform:{OS:os},activeStep,params:{},previewMode:false,setStep:step=>events.push(['step',step]),
   saveJourney:stage=>events.push(['journey',stage]),preferredName:'Naser',
   setNameDraft:value=>events.push(['nameDraft',value]),setNameSaveFailed:value=>events.push(['nameFailed',value]),
   router:{setParams:()=>assert.fail('no callback should be cleared')}});
  const expectedEvents=[['step',expected]];
  if(journey)expectedEvents.push(['journey',journey]);
  if(activeStep==='goals')expectedEvents.push(['nameDraft','Naser'],['nameFailed',false]);
  assert.deepEqual(events,expectedEvents,`${os} ${activeStep}`);
 }
 const events=[];
 onboardingAction('goBack',{Platform:{OS:'android'},activeStep:'complete',params:{onboarding:'complete'},previewMode:false,setStep:step=>events.push(['step',step]),
  saveJourney:stage=>events.push(['journey',stage]),preferredName:null,setNameDraft:()=>{},setNameSaveFailed:()=>{},
  router:{setParams:params=>events.push(['params',Object.keys(params),params.onboarding])}});
 assert.deepEqual(events,[['step','capture'],['journey','capture'],['params',['onboarding'],undefined]]);
});
test('obsolete optional goals and budget wizard handlers are absent from the shipping gate',()=>{
 const text=fs.readFileSync(path.join(root,'src/components/onboarding-gate.tsx'),'utf8');
 assert.doesNotMatch(text,/activeStep === 'budget'|finishPreferences|onboardPersonalizeOptional|setOnboardingPlan/);
 // Goals are wafraGoals (no money); the only budgets are limits the person dialled.
 assert.match(text,/setGoals\(goalsDraft\)/);
 assert.match(text,/watchBudgetChanges\(watchDraft, state\.budgets\)/);
});
test('blocked onboarding Back transitions preserve the integrated journey',()=>{
 for(const activeStep of ['paywall','pattern','complete','capture','live','reminders','watch','goals','name','welcome']){
  const events=[];
  onboardingAction('goBack',{Platform:{OS:'android'},activeStep,params:activeStep==='complete'?{onboarding:'complete'}:{},previewMode:false,
   setStep:step=>events.push(['step',step]),saveJourney:stage=>events.push(['journey',stage]),
   preferredName:null,setNameDraft:()=>{},setNameSaveFailed:()=>{},
   router:{setParams:params=>events.push(['params',params])}},false);
  assert.deepEqual(events,[],`${activeStep}: a blocked press cannot navigate, persist progress or clear the callback`);
 }
});
test('new workflow files transpile without syntax errors',()=>{
 for(const file of ['src/components/workflows/workflow-copy.ts','src/components/workflows/workflow-surfaces.tsx']){
 const result=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
 assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,file);
 }
});
