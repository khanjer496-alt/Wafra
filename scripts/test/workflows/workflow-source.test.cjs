'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
const root=path.resolve(__dirname,'../../..');
const manifest=require('./protected-handlers.json');
const source=file=>ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const traverse=(node,cb)=>{cb(node);ts.forEachChild(node,n=>traverse(n,cb));};
test('61 protected action bodies retain their preceding implementation',()=>{
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
test('workflow consumers have real imports, not imports hidden in comments',()=>{
 const files=['settings','import-sms','ios-setup','feedback','review-alerts','categorise','pro','trusted-devices'].map(n=>`src/app/${n}.tsx`).concat('src/components/onboarding-gate.tsx');
 for(const file of files){const sf=source(file),names=new Set();for(const n of sf.statements)if(ts.isImportDeclaration(n)&&n.importClause?.namedBindings&&ts.isNamedImports(n.importClause.namedBindings))for(const element of n.importClause.namedBindings.elements)names.add(element.name.text);
 assert.ok(names.has('workflowCopy'),`${file}: copy import`);
 if(file.endsWith('/review-alerts.tsx')){
  assert.ok(!names.has('WorkflowHero'),'Review alerts has one compact intro instead of a repeated hero');
  assert.match(fs.readFileSync(path.join(root,file),'utf8'),/testID="review-alerts-intro"/);
 }else assert.ok(names.has(file.includes('onboarding')?'SetupIllustration':'WorkflowHero'),`${file}: surface import`);}
});
test('new workflow files transpile without syntax errors',()=>{
 for(const file of ['src/components/workflows/workflow-copy.ts','src/components/workflows/workflow-surfaces.tsx']){
 const result=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
 assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,file);
 }
});
