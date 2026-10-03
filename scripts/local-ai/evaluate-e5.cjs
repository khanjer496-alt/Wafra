#!/usr/bin/env node
// Actual shipped ONNX inference; install host ORT separately (see evaluation doc).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const { Tokenizer } = require('@huggingface/tokenizers');
const { createLoader } = require('../universal-test/load-ts.cjs');
const load = createLoader();
const production = load('@/lib/local-semantic-model');
const cache = process.env.WAFRA_EVAL_CACHE || '/tmp/wafra-local-ai-eval';
const ort = require(path.join(cache, 'node_modules/onnxruntime-node'));
const specs = [
 ['model.int8.onnx',34825743,'70fd5ee627d2392c1f201c4045ca1c37991db28e80eab3401ebc34b540c4f9a1'],
 ['tokenizer.json',2406512,'40b7d6f2e0b8b58a8ac14294b122a41560c61db46515a5f05871811892fc5f60'],
 ['tokenizer_config.json',1206,'606031684b9ac91d380bf254ee9027976904a22e0aa32423cf254f049bb957b2'],
];
const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
(async () => {
 fs.mkdirSync(cache,{recursive:true});
 for(const [name,bytes,sha] of specs){
  const file = path.join(cache,name);
  if(!fs.existsSync(file)){
   const response = await fetch(`https://github.com/khanjer496-alt/Wafra/releases/download/local-ai-e5-v1/${name}`);
   if(!response.ok) throw Error(`download ${name}: ${response.status}`);
   fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()));
  }
  const data = fs.readFileSync(file);
  if(data.length!==bytes || crypto.createHash('sha256').update(data).digest('hex')!==sha) throw Error(`artifact mismatch: ${name}`);
 }
 const tokenizer = new Tokenizer(read(path.join(cache,'tokenizer.json')),read(path.join(cache,'tokenizer_config.json')));
 const session = await ort.InferenceSession.create(path.join(cache,'model.int8.onnx'),{intraOpNumThreads:1,interOpNumThreads:1});
 const encoder = {
  manifest:{schemaVersion:1,modelVersion:'e5-arb-32768@e1b3907e6c83#int8-70fd5ee627d2',backend:'onnxruntime-react-native',graphFormat:'onnx',quantization:'dynamic-int8',embeddingDimensions:384,maximumCharacters:1000},
  async encode(text){
   const encoded=tokenizer.encode(text.trim().slice(0,1000),{return_token_type_ids:true});
   const ids=encoded.ids.slice(0,128), attention=encoded.attention_mask.slice(0,ids.length), types=(encoded.token_type_ids??new Array(ids.length).fill(0)).slice(0,ids.length);
   const tensor=a=>new ort.Tensor('int64',BigInt64Array.from(a,BigInt),[1,ids.length]);
   const output=await session.run({input_ids:tensor(ids),attention_mask:tensor(attention),token_type_ids:tensor(types)});
   const hidden=output.last_hidden_state;
   if(hidden.type!=='float32'||hidden.dims[2]!==384)throw Error('invalid hidden state');
   const pooled=new Float32Array(384);let count=0;
   for(let t=0;t<ids.length;t++){if(attention[t]!==1)continue;count++;for(let d=0;d<384;d++)pooled[d]+=hidden.data[t*384+d];}
   let norm=0;for(let d=0;d<384;d++){pooled[d]/=count;norm+=pooled[d]*pooled[d];}
   norm=Math.sqrt(norm);for(let d=0;d<384;d++)pooled[d]/=norm;
   return pooled;
  }
 };
 const fixture=read(path.join(root,'scripts/test/fixtures/local-ai-held-out.json'));
 const assistant=production.createLocalSemanticRetriever(encoder,read(path.join(root,'assets/local-ai/assistant-prototype-index.e5.int8.json')));
 const parser=production.createLocalSemanticRetriever(encoder,read(path.join(root,'assets/local-ai/parser-canonical-centroids.e5.int8.json')));
 const head=production.createLocalParserFamilyClassifier(encoder,read(path.join(root,'assets/local-ai/parser-family-head.e5.public.json')));
 const anchors=read(path.join(root,'scripts/test/fixtures/local-ai-anchor-parity.json'));
 const anchorParity=[];
 for(const [expectedPrototype,text] of anchors.anchors){
  const raw=await assistant.retrieve('assistant-intent',text);
  const prefixed=await assistant.retrieve('assistant-intent','query: '+text);
  anchorParity.push({text,expectedPrototype,raw,prefixed});
 }
 const rows=[];
 for(const domain of ['assistant','parser'])for(const [language,text,expected] of fixture[domain]){
  const start=performance.now();
  const candidate=await (domain==='assistant'?assistant:parser).retrieve(domain==='assistant'?'assistant-intent':'parser-family',text);
  const gate=production.gateLocalSemanticCandidate(candidate,domain==='assistant'?'assistant-intent':'parser-family');
  const prediction=gate.kind==='accepted'?(domain==='assistant'?gate.definition.tool:gate.definition.family):null;
  const headResult=domain==='parser'?await head.classify(text):undefined;
  rows.push({domain,language,text,expected,candidate,gate:gate.kind==='accepted'?'accepted':gate.reason,prediction,correct:prediction===expected,headPrediction:headResult?.family??null,headProbability:headResult?.probability??null,hostMs:Math.round(performance.now()-start)});
 }
 const agreement=rows.filter(r=>r.domain==='parser'&&r.prediction!==null&&r.prediction===r.headPrediction);
 const summary={reviewAgreement:{accepted:agreement.length,correctAccepted:agreement.filter(r=>r.prediction===r.expected).length,falseAccepts:agreement.filter(r=>r.prediction!==r.expected).length}};
 for(const domain of ['assistant','parser'])for(const method of (domain==='parser'?['prediction','headPrediction']:['prediction'])){
  const data=rows.filter(r=>r.domain===domain),accepted=data.filter(r=>r[method]!==null);
  summary[`${domain}.${method}`]={total:data.length,accepted:accepted.length,abstained:data.length-accepted.length,correctAccepted:accepted.filter(r=>r[method]===r.expected).length,falseAccepts:accepted.filter(r=>r[method]!==r.expected).length,correctAbstentions:data.filter(r=>r.expected===null&&r[method]===null).length,supported:data.filter(r=>r.expected!==null).length,top1Correct:method==='prediction'?data.filter(r=>r.expected!==null&&(domain==='assistant'?production.LOCAL_SEMANTIC_REGISTRY[r.candidate.prototypeId].tool:production.LOCAL_SEMANTIC_REGISTRY[r.candidate.prototypeId].family)===r.expected).length:undefined};
 }
 const report={generatedAt:new Date().toISOString(),provenance:fixture.provenance,scope:'Actual host model inference, production retrieval/gates. Parser inputs are already-redacted snippets, before deterministic eligibility gates; not end-to-end import safety.',runtime:{node:process.version,ort:require(path.join(cache,'node_modules/onnxruntime-node/package.json')).version,platform:process.platform,arch:process.arch},artifacts:specs,anchorParity,summary,rows};
 const output=process.argv[2]||path.join(root,'docs/test-evidence/2026-09-23-local-ai-model-evaluation.json');
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(summary,null,2));await session.release();
})().catch(error=>{console.error(error);process.exitCode=1;});
