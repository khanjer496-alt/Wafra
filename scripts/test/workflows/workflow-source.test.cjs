'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
const root=path.resolve(__dirname,'../../..');
const manifest=require('./protected-handlers.json');
const source=file=>ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const traverse=(node,cb)=>{cb(node);ts.forEachChild(node,n=>traverse(n,cb));};
test('61 protected action bodies match their individually reviewed fingerprints',()=>{
 assert.equal(manifest.records.length,61);const printer=ts.createPrinter({removeComments:true});
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
   for(const name of ['MoneyPreview','t','useLanguage','useMotionPreference'])assert.ok(names.has(name),`${file}: ${name} import`);
   assert.ok(!names.has('SetupIllustration')&&!names.has('workflowCopy'),'Welcome uses its inline example and current translated copy');
  }else if(file.endsWith('/ios-setup.tsx')){
   for(const name of ['ScreenHeader','ChecklistRow','IosSetupJourney','t','useLanguage'])assert.ok(names.has(name),`${file}: ${name} import`);
   assert.ok(!names.has('WorkflowHero')&&!names.has('workflowCopy'),'iOS setup has one heading before its actionable checklist');
  }else{
   assert.ok(names.has('workflowCopy'),`${file}: copy import`);
   if(file.endsWith('/review-alerts.tsx')){
    assert.ok(!names.has('WorkflowHero'),'Review alerts has one compact intro instead of a repeated hero');
    assert.match(fs.readFileSync(path.join(root,file),'utf8'),/testID="review-alerts-intro"/);
   }else assert.ok(names.has('WorkflowHero'),`${file}: surface import`);
  }
 }
});

// Execute the shipping preference handlers as well as fingerprinting them.
// Their route behavior changed intentionally; no native service is involved.
const onboardingAction=(name,inputs)=>{
 const sf=source('src/components/onboarding-gate.tsx');let found;
 traverse(sf,n=>{if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.name.text===name)found=n.initializer});
 assert.ok(found,`shipping ${name} exists`);
 const action=ts.createPrinter().printNode(ts.EmitHint.Unspecified,found,sf);
 const js=ts.transpileModule(`const action = ${action}; action();`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 require('node:vm').runInNewContext(js,inputs);
};
test('optional goals and budget Back actions return to their actual entry points',()=>{
 for(const[activeStep,expected]of [['capture','welcome'],['goals','capture'],['budget','goals'],['scanning','capture'],['complete','capture']]){
  const events=[];
  onboardingAction('goBack',{activeStep,personalizing:true,QUESTION_STEPS:['goals','budget'],params:{},setStep:step=>events.push(step),router:{setParams:()=>assert.fail('no callback should be cleared')}});
  assert.deepEqual(events,[expected],activeStep);
 }
 const events=[];
 onboardingAction('goBack',{activeStep:'complete',QUESTION_STEPS:['goals','budget'],params:{onboarding:'complete'},setStep:step=>events.push(['step',step]),router:{setParams:params=>events.push(['params',Object.keys(params),params.onboarding])}});
 assert.deepEqual(events,[['step','capture'],['params',['onboarding'],undefined]]);
});
test('saving optional preferences records only the chosen plan and returns to capture',()=>{
 const plan={goalIds:['travel'],budgetId:'flexible'},events=[];
 onboardingAction('finishPreferences',{plan,setOnboardingPlan:value=>events.push(['plan',value]),setPersonalizing:value=>events.push(['personalizing',value]),setStep:value=>events.push(['step',value])});
 assert.deepEqual(events,[['plan',plan],['personalizing',false],['step','capture']]);
});
test('new workflow files transpile without syntax errors',()=>{
 for(const file of ['src/components/workflows/workflow-copy.ts','src/components/workflows/workflow-surfaces.tsx']){
 const result=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
 assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,file);
 }
});
