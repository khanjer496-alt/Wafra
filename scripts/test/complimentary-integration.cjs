'use strict';
// Uses the isolated access Worker directly in process and
// a deterministic test-only credential. The environment contains no production bindings.
const path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const test=require('node:test');
const load=require('./repair/load-typescript.cjs');
const root=path.resolve(__dirname,'../..');
const {createLoader}=require('../universal-test/load-ts.cjs');
const logic=createLoader()('@/lib/complimentary-access');

test('Android client redeems against Worker, routes only to the expected host, and loses access after rotation',async()=>{
  const worker=(await import('../../access/src/index.js')).default;
  const code='B'.repeat(43),digest=s=>crypto.createHash('sha256').update(s).digest('hex');
  const env={COMPLIMENTARY_ACCESS_SHA256:digest(code),ACCESS_RATE_LIMITER:{limit:async()=>({success:true})}};
  const keys=new Map(),requests=[];
  const device=load(path.join(root,'src/lib/complimentary-device.ts'),{
    'react-native':{Platform:{OS:'android'}}, '@/lib/complimentary-access':logic,
    '@/lib/complimentary-clock':{anchorGrant:()=>true,clearGrantClock:()=>true},
    'expo-secure-store':{getItemAsync:async k=>keys.get(k)??null,setItemAsync:async(k,v)=>{keys.set(k,v);},deleteItemAsync:async k=>{keys.delete(k);}},
    'expo/fetch':{fetch:async(url,init)=>{
      assert.equal(url,'https://wafra-access.khanjer496.workers.dev/v1/access/complimentary');
      assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.equal(init.method,'POST');
      assert.equal(init.body,undefined);assert.equal(init.headers.Authorization,'Bearer '+code);
      assert.deepEqual(Object.keys(init.headers).sort(),['Accept','Authorization']);
      requests.push(url);
      const response=await worker.fetch(new Request(url,{method:init.method,headers:init.headers}),env);
      return {url,status:response.status,json:()=>response.json()};
    }},
  },{AbortController,setTimeout,clearTimeout}).complimentaryDevice;
  assert.equal((await device.refresh()).status,'absent');assert.equal(requests.length,0);
  assert.equal((await device.redeem(code)).status,'granted');
  assert.equal((await device.refresh()).status,'granted');
  env.COMPLIMENTARY_ACCESS_SHA256=digest('C'.repeat(43));
  assert.equal((await device.refresh()).status,'denied');assert.equal(keys.size,1);
  await device.clear();assert.equal(keys.size,0);
  assert.equal(requests.length,3);
});
