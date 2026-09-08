'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createWorkflowHarness,walk,text}=require('./workflow-harness.cjs');
const byLabel=(tree,label)=>walk(tree).find(n=>n.props?.onPress&&n.props.accessibilityLabel===label);
const boundary=(tree,name)=>walk(tree).find(n=>n.type==='Boundary'&&n.props.name===name);
const pending=(id='pending',overrides={})=>({id,sourceKey:'test-fixture:'+id,observedAt:Date.now()-60000,expiresAt:Date.now()+86400000,channel:'inbox',parserVersion:1,market:'AE',institution:'emirates-nbd',grammar:'test-purchase',amount:{currency:'AED',minorUnits:'12345',exponent:2},direction:'debit',family:'purchase',rail:null,instrument:{kind:'card',last4:'1234'},...overrides});
for(const language of ['en','ar'])for(const theme of ['light','dark']){
 test(`settings panels render with actual copy and no writes: ${language}/${theme}`,()=>{
  for(const section of ['preferences','imports','privacy','help']){
   const h=createWorkflowHarness({language,theme,params:{section}}),tree=h.renderScreen('settings'),words=h.deps['@/components/workflows/workflow-copy'].workflowCopy(language);
   assert.ok(text(tree).includes(words.settingsTitle)||text(tree).includes(words.privacyTitle));
   const selected=walk(tree).filter(n=>n.props?.accessibilityState?.selected&&n.props?.accessibilityLabel);
   assert.ok(selected.some(n=>n.props.accessibilityLabel===({preferences:words.preferences,imports:words.capture,privacy:words.privacy,help:words.help})[section]));
   assert.deepEqual(h.events,[]);
  }
 });
 test(`review separates unconfirmed entries: ${language}/${theme}`,()=>{
  const h=createWorkflowHarness({language,theme,state:{reviewTray:{pending:[pending(),pending('expired',{expiresAt:Date.now()-1,amount:{currency:'AED',minorUnits:'99999',exponent:2}})]}}});
  const tree=h.renderScreen('review-alerts'),words=h.deps['@/components/workflows/workflow-copy'].workflowCopy(language);
  assert.ok(text(tree).includes(words.reviewBody));assert.ok(text(tree).includes('123.45'));assert.ok(!text(tree).includes('999.99'));
  assert.deepEqual(h.events,[]);
 });
}
test('settings navigation is explicit and does not change preferences',()=>{
 const h=createWorkflowHarness(),tree=h.renderScreen('settings');
 byLabel(tree,h.deps['@/components/workflows/workflow-copy'].workflowCopy('en').privacy).props.onPress();
 assert.deepEqual(h.events,[['state',0,'privacy']]);
});
test('unknown settings deep-link falls back to preferences',()=>{
 const h=createWorkflowHarness({params:{section:'erase-now'}}),tree=h.renderScreen('settings');
 const n=byLabel(tree,h.deps['@/components/workflows/workflow-copy'].workflowCopy('en').preferences);
 assert.equal(n.props.accessibilityState.selected,true);assert.deepEqual(h.events,[]);
});
test('review action preserves source reviewId rather than silently inserting money',()=>{
 const h=createWorkflowHarness({state:{reviewTray:{pending:[pending('source-identity')]}}}),tree=h.renderScreen('review-alerts');
 const button=walk(tree).find(n=>n.props?.accessibilityLabel?.startsWith(h.deps['@/lib/i18n'].t('reviewAlertReview'))&&n.props.onPress);
 button.props.onPress();assert.deepEqual(JSON.parse(JSON.stringify(h.events)),[['route',{pathname:'/add-transaction',params:{reviewId:'source-identity'}}]]);
});
test('dismiss requests confirmation; confirmation alone calls retained dismissal handler',async()=>{
 const item=pending('review-to-dismiss'),h=createWorkflowHarness({state:{reviewTray:{pending:[item]}}}),tree=h.renderScreen('review-alerts');
 walk(tree).find(n=>n.props?.onPress&&n.props.accessibilityLabel?.startsWith(h.deps['@/lib/i18n'].t('dismiss')+'.')).props.onPress();
 assert.deepEqual(h.events,[['state',0,item]]);assert.equal(boundary(tree,'ConfirmSheet').props.visible,false);
 const confirmed=createWorkflowHarness({state:{reviewTray:{pending:[item]}},states:{0:item}}),next=confirmed.renderScreen('review-alerts');
 const sheet=boundary(next,'ConfirmSheet');assert.equal(sheet.props.visible,true);assert.equal(sheet.props.destructive,true);
 sheet.props.onConfirm();await Promise.resolve();await Promise.resolve();
 assert.ok(confirmed.events.some(e=>e[0]==='dismissReviewAlert'&&e[1]===item.id&&e[2]==='dismissed'));
 assert.ok(!confirmed.events.some(e=>e[0]==='editTransaction'));
});
test('empty review does not display invented pending counts',()=>{
 const h=createWorkflowHarness(),tree=h.renderScreen('review-alerts'),words=h.deps['@/components/workflows/workflow-copy'].workflowCopy('en');
 assert.ok(text(tree).includes(words.complete));assert.ok(!text(tree).includes(words.pending));assert.deepEqual(h.events,[]);
});
test('review renders currency minor-unit exponents without truncating cents',()=>{
 for(const[exponent,minorUnits,expected]of [[0,'125','125'],[2,'5','0.05'],[3,'12567','12.567']]){
  const h=createWorkflowHarness({state:{reviewTray:{pending:[pending('amount',{amount:{currency:'TEST',minorUnits,exponent}})]}}});
  assert.ok(text(h.renderScreen('review-alerts')).includes('TEST '+expected));
 }
});
test('categorisation displays affected count and applies merchant rule only after selection',()=>{
 const merchant={merchant:'Fixture Market',key:'fixture-market',count:7,totalFils:23456,lastDate:'2026-09-05'};
 const h=createWorkflowHarness({merchantSummary:{merchants:[merchant],rowCount:7},states:{0:merchant.key}}),tree=h.renderScreen('categorise');
 assert.ok(text(tree).includes('7'));assert.ok(text(tree).includes(merchant.merchant));assert.deepEqual(h.events,[]);
 const picker=walk(tree).find(n=>n.props?.onPress&&n.props.accessibilityLabel===h.deps['@/lib/categories'].getCategory('dining').label);
 assert.ok(picker,'category choice exists');picker.props.onPress();
 assert.ok(h.events.some(e=>e[0]==='setMerchantOverride'&&e[1]===merchant.merchant&&e[2]==='dining'&&e[3]===true));
});
for(const language of ['en','ar'])test(`onboarding shows an inline labeled example without adding money: ${language}`,()=>{
 const h=createWorkflowHarness({language,empty:true,state:{onboarded:false,onboardingPlan:null},states:{2:true}}),tree=h.renderScreen('onboarding');
 const t=h.deps['@/lib/i18n'].t;
 assert.ok(text(tree).includes(t('onboardHeadline')));assert.ok(!text(tree).includes('42,500'));
 const example=walk(tree).find(n=>n.props?.testID==='onboarding-example');
 assert.ok(example,'the actual local sample is embedded on welcome');
 assert.ok(text(example).includes(t('onboardSampleLabel')));
 assert.ok(text(example).includes(t('onboardSampleNote')));
 assert.ok(text(example).includes('AED 24.50'));
 assert.ok(byLabel(example,t('onboardSampleAction')),'the sample offers its real reveal action');
 assert.ok(byLabel(tree,t('onboardChooseStart')),'setup remains available before trying the example');
 assert.ok(!walk(tree).some(n=>n.props?.testID==='setup-illustration'));
 assert.equal(h.state.transactions.length,0);assert.equal(h.state.accounts.length,0);
 assert.deepEqual(h.events,[],'rendering sample and setup controls performs no writes or setup actions');
});
test('import progress labels only the supplied current step',()=>{
 const h=createWorkflowHarness(),{ImportSteps}=h.deps['@/components/workflows/workflow-surfaces'];
 const tree=ImportSteps({current:'review'}),words=h.deps['@/components/workflows/workflow-copy'].workflowCopy('en');
 const labels=walk(tree).map(n=>n.props?.accessibilityLabel).filter(Boolean);
 assert.ok(labels.some(label=>label.includes(words.review)&&label.includes(words.stepCurrent)));
 assert.ok(labels.some(label=>label.includes(words.source)&&label.includes(words.stepComplete)));
 assert.deepEqual(h.events,[]);
});
test('decorative setup illustration is hidden from assistive reading',()=>{
 const h=createWorkflowHarness(),tree=h.deps['@/components/workflows/workflow-surfaces'].SetupIllustration();
 assert.equal(tree.props.accessible,false);assert.equal(tree.props.importantForAccessibility,'no-hide-descendants');
});

test('feedback displays the exact source payload before Send and does not send on render',()=>{
 const h=createWorkflowHarness({states:{0:'The category label is hard to read.'}}),tree=h.renderScreen('feedback');
 const content=text(tree),send=h.deps['@/lib/i18n'].t('feedbackSend');
 assert.ok(content.indexOf('WAFRA FEEDBACK')<content.lastIndexOf(send));assert.ok(content.includes('nothing from the ledger is attached'));
 assert.ok(!content.includes('Fixture Market'));assert.deepEqual(h.events,[]);
 const action=walk(tree).find(n=>n.props?.onPress&&n.props.accessibilityLabel===send);assert.ok(action);action.props.onPress();
 assert.deepEqual(h.events,[['state',1,true]]);
});
test('feedback submission is reachable only through the confirmation callback',async()=>{
 const h=createWorkflowHarness({states:{0:'Fixture message',1:true}}),tree=h.renderScreen('feedback'),sheet=boundary(tree,'ConfirmSheet');
 assert.equal(sheet.props.visible,true);assert.deepEqual(h.events,[]);sheet.props.onConfirm();await Promise.resolve();await Promise.resolve();
 const submitted=h.events.find(e=>e[0]==='submitFeedback');assert.ok(submitted);assert.equal(submitted[1].detail,'none');
});
for(const platform of ['android','ios'])test(`paywall does not manufacture a storefront price: ${platform}`,()=>{
 const h=createWorkflowHarness({platform,state:{pro:false,founderPro:false}}),tree=h.renderScreen('pro');
 const content=text(tree);assert.ok(!content.includes('US$9.99'));assert.ok(!content.includes('US$74.99'));
 assert.ok(content.includes(h.deps['@/lib/i18n'].t('priceUnavailable')));assert.deepEqual(h.events,[]);
});
test('unpaired trusted devices preserves privacy disclosure and makes no connection on render',()=>{
 const h=createWorkflowHarness({state:{privateMode:true},states:{2:false}}),tree=h.renderScreen('trusted-devices');
 assert.ok(text(tree).includes(h.deps['@/components/workflows/workflow-copy'].workflowCopy('en').devicesTitle));assert.deepEqual(h.events,[]);
});
for(const language of ['en','ar'])test(`iOS setup renders actual checklist without invoking permission or install: ${language}`,()=>{
 const h=createWorkflowHarness({language,platform:'ios',states:{0:{loading:false,supported:true,shortcutAvailable:false,stage:'shortcut',readiness:'not-added',opening:false,failure:null},2:true,3:true}}),tree=h.renderScreen('ios-setup');
 assert.ok(walk(tree).some(n=>n.props?.testID==='ios-message-setup-checklist'));assert.deepEqual(h.events,[]);
});
