const assert = require('node:assert/strict');
const {test} = require('node:test');
const {QUERY,PROJECT,probe} = require('../../ci/android-managed-submit-probe.cjs');
const response = body => ({ok:true,body:(async function*(){yield Buffer.from(JSON.stringify(body));})()});
const data = {data:{meActor:{id:'synthetic-actor'},app:{byId:{id:PROJECT,androidAppCredentials:[{applicationIdentifier:'app.wafra.android',googleServiceAccountKeyForSubmissions:{id:'synthetic-key-reference'}}]}}}};
test('fixed metadata query never requests private fields or mutations',()=>{
  assert.match(QUERY,/^query WafraAndroidManagedSubmissionPresence/);
  assert.doesNotMatch(QUERY,/mutation|privateKey|keyJson|clientEmail|accessToken|sessionSecret|__schema/);
});
test('missing existing token does not make any request',async()=>{
  const value=await probe('',()=>{throw Error('must not call');});assert.equal(value.tokenConfigured,false);assert.equal(value.authenticated,false);
});
test('matched assignment emits only booleans and never proves track rights',async()=>{
  const result=await probe('synthetic-not-a-real-token',async(url,options)=>{
    assert.equal(url,'https://api.expo.dev/graphql');assert.equal(options.redirect,'error');assert.equal(JSON.parse(options.body).variables.appId,PROJECT);return response(data);
  });
  assert.equal(result.submissionCredentialAssigned,true);assert.equal(result.trackPermissionsProven,false);
  assert.deepEqual(new Set(Object.values(result).map(v=>typeof v)),new Set(['boolean']));
  assert.doesNotMatch(JSON.stringify(result),/synthetic|token-reference|actor|@/);
});
test('wrong app, duplicate binding or no assignment remain unproven',async()=>{
  for(const mode of ['wrong-app','duplicate','missing-key']) {
    const value=structuredClone(data),app=value.data.app.byId;
    if(mode==='wrong-app')app.id='other';
    else if(mode==='duplicate')app.androidAppCredentials.push(app.androidAppCredentials[0]);
    else app.androidAppCredentials[0].googleServiceAccountKeyForSubmissions=null;
    assert.equal((await probe('synthetic',async()=>response(value))).submissionCredentialAssigned,false);
  }
});
test('provider errors, oversized responses and credential-bearing exceptions never escape',async()=>{
  for(const request of [async()=>({ok:false}),async()=>response({errors:[{message:'private DO_NOT_EMIT'}]}),async()=>response({data:'x'.repeat(17000)}),async()=>{throw Error('secret DO_NOT_EMIT');}]) {
    const result=await probe('synthetic',request);assert.equal(result.submissionCredentialAssigned,false);assert.doesNotMatch(JSON.stringify(result),/DO_NOT_EMIT/);
  }
});
