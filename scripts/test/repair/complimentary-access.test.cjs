'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const hostLoad = require('./load-typescript.cjs');
const clock = { remaining: 900000, grantRemainingMs() { return clock.remaining; } };
const logic = hostLoad(path.join(root,'src/lib/complimentary-access.ts'),{'@/lib/complimentary-clock':clock});
const { complimentaryAccessUntil, createComplimentaryDevice } = logic;
const { isProActive, hasNonTrialAccess, TRIAL_DURATION_MS } = hostLoad(path.join(root,'src/lib/purchases.ts'),{'@/lib/complimentary-access':logic,'react-native':{Platform:{OS:'android'}}});
const { bankNotificationAdmissionExpiresAt } = hostLoad(path.join(root,'src/lib/trusted-bank-notification-packages.ts'),{'@/lib/complimentary-access':logic});
const NOW = Date.parse('2026-11-06T00:00:00.000Z');
const CODE = 'A'.repeat(43); // Test-only constant. Never a configured credential.
const expired = { pro: false, founderPro: false, trialStartTs: NOW - TRIAL_DURATION_MS - 1 };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve=r; }); return {promise,resolve}; };
function harness(overrides={}) {
  let secret = null;
  const io = { now:()=>NOW, read:async()=>secret, store:async code=>{secret=code;},
    remove:async()=>{secret=null;}, verify:async()=>'granted', anchor:()=>true, clearAnchor:()=>true, ...overrides };
  return {io, device:createComplimentaryDevice(io), getSecret:()=>secret};
}

test('fresh installs with no code do not reach the network; malformed input never enters storage',async()=>{
  let requests=0;
  const h=harness({verify:async()=>{requests++;return 'granted';}});
  assert.equal((await h.device.refresh()).status,'absent');
  assert.equal((await h.device.redeem('short')).status,'denied');
  assert.equal(requests,0); assert.equal(h.getSecret(),null);
});
test('reusable grant unlocks real Pro after trial and does not manufacture a purchase',async()=>{
  const h=harness();
  const result=await h.device.redeem(CODE); assert.equal(result.status,'granted');
  const s={...expired,complimentaryIssuedAt:result.issuedAt};
  assert.equal(isProActive(expired,NOW),false); assert.equal(isProActive(s,NOW),true);
  assert.equal(hasNonTrialAccess(s,NOW),true); assert.equal(s.pro,false); assert.equal(s.founderPro,false);
  assert.equal(bankNotificationAdmissionExpiresAt(s,NOW), 0, 'never convert grant into a native wall-clock lease');
  assert.equal(isProActive(s,NOW+900000),false); assert.equal(bankNotificationAdmissionExpiresAt(s,NOW+900000),0);
  assert.equal(complimentaryAccessUntil(NOW,NOW-1),0);
  clock.remaining=0;assert.equal(isProActive(s,NOW),false);clock.remaining=900000;
  assert.equal(isProActive({...s,pro:true},NOW+900000),true);
  await h.device.clear(); assert.equal(h.getSecret(),null);
  assert.equal((await h.device.redeem(CODE)).status,'granted');
});
test('unavailable verifier cannot mint or extend a grant; uniform denial drops access and backs off',async()=>{
  let verdict='granted', now=NOW;
  const h=harness({verify:async()=>verdict,now:()=>now});
  const r=await h.device.redeem(CODE);now+=300000; verdict='unavailable';
  assert.equal((await h.device.refresh()).status,'unavailable');assert.equal(h.getSecret(),CODE);
  assert.equal(complimentaryAccessUntil(r.issuedAt,now+600000),0);
  verdict='denied';assert.equal((await h.device.refresh()).status,'denied');assert.equal(h.getSecret(),CODE);
  assert.equal((await h.device.refresh()).status,'unavailable');now+=120000;verdict='granted';
  assert.equal((await h.device.refresh()).status,'granted');
});
test('an in-flight request cannot put a bearer back after erase',async()=>{
  const g=deferred(),h=harness({verify:()=>g.promise});
  const request=h.device.redeem(CODE);await h.device.clear();g.resolve('granted');
  assert.equal((await request).status,'superseded');assert.equal(h.getSecret(),null);
});
test('erase is serialized after a SecureStore write already issued',async()=>{
  const entered=deferred(),release=deferred(),events=[];
  const h=harness({store:async()=>{entered.resolve();await release.promise;events.push('store');},remove:async()=>{events.push('remove');}});
  const request=h.device.redeem(CODE);await entered.promise;const erase=h.device.clear();release.resolve();
  assert.equal((await request).status,'superseded');await erase;assert.deepEqual(events,['store','remove']);
});
test('a failed SecureStore write or missing boot clock cannot grant access',async()=>{
  const a=harness({store:async()=>{throw Error('unavailable');}});
  assert.equal((await a.device.redeem(CODE)).status,'unavailable');
  const b=harness({anchor:()=>false});assert.equal((await b.device.redeem(CODE)).status,'unavailable');
});
test('removal still erases the credential if native clock storage fails',async()=>{
  const h=harness({clearAnchor:()=>{throw Error('locked');}});
  assert.equal((await h.device.redeem(CODE)).status,'granted');
  await assert.rejects(h.device.clear(),/clear lease/);
  assert.equal(h.getSecret(),null);
});
test('system-clock jumps and a slow response cannot enlarge a lease',async()=>{
  let now=NOW; const h=harness({now:()=>now,verify:async()=>{now+=900001;return 'granted';}});
  assert.equal((await h.device.redeem(CODE)).status,'unavailable');assert.equal(h.getSecret(),null);
});

// Exercise the actual store handlers, substituting only parsing/dispatch to isolate the backup boundary.
function storeAction(name,bindings) {
  const file=path.join(root,'src/lib/store.tsx'), source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let body; const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(source)===name)body=node.initializer.arguments[0];ts.forEachChild(node,visit);};visit(source);
  assert.ok(body);
  return vm.runInNewContext(ts.transpileModule('('+body.getText(source)+')',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,bindings);
}
test('real backup export strips grant and restore cannot import or extend it',()=>{
  const state={...expired,hydrated:true,complimentaryIssuedAt:NOW,transactions:[{id:'own'}]};
  const authoritativeState={current:state};
  const exported=JSON.parse(storeAction('exportBackup',{authoritativeState})());
  assert.equal(Object.hasOwn(exported.data,'complimentaryIssuedAt'),false);
  const injected={complimentaryIssuedAt:NOW+60000,pro:true,founderPro:true,trialStartTs:NOW,transactions:[]};let restored;
  const restore=storeAction('restoreBackup',{authoritativeState,parseBackupForRestore:()=>injected,dispatch:a=>{restored=a.state;}});
  assert.equal(restore('test'),true);assert.equal(restored.complimentaryIssuedAt,NOW);assert.equal(restored.pro,false);
  authoritativeState.current={...expired};assert.equal(restore('test'),true);assert.equal(restored.complimentaryIssuedAt,undefined);
});
