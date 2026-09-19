'use strict';
// Execute real presentation components with named native/service substitutes.
// These tests are not native rendering or physical-device validation.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, walk, text } = require('./reference-harness.cjs');
const { createWorkflowHarness } = require('../workflows/workflow-harness.cjs');
const flatten = value => Object.assign({}, ...[value].flat(Infinity).filter(Boolean));
const style = node => flatten(typeof node.props.style === 'function' ? node.props.style({pressed:false}) : node.props.style);
const lum = hex => {
 const c=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
 return c[0]*.2126+c[1]*.7152+c[2]*.0722;
};
const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
for(const theme of ['light','dark']) {
 test(`${theme}: unfocused and focused input boundaries meet contrast floor`,()=>{
  for(const focused of [false,true]) {
   const h=createHarness({theme,states:{0:focused}});
   const tree=h.deps['@/components/ui/text-field'].TextField({label:'Amount',value:'12.50',numeric:true,onChangeText(){}},null);
   const frames=walk(tree).filter(n=>style(n).borderColor===h.theme.controlBorder);
   assert.equal(frames.length,1);assert.ok(contrast(style(frames[0]).borderColor,style(frames[0]).backgroundColor)>=3);
  }
 });
 test(`${theme}: segment selection, labels and touch targets survive large text`,()=>{
  const h=createHarness({theme,largeText:true});
  const tree=h.deps['@/components/ui/segmented-control'].SegmentedControl({label:'Spending',value:'a',segments:[{value:'a',label:'Categories'},{value:'b',label:'Activity'}],onChange:v=>h.events.push(['select',v])});
  assert.equal(style(tree).flexDirection,'column');assert.equal(tree.props.role,'tablist');
  const tabs=walk(tree).filter(n=>n.props.accessibilityRole==='tab');assert.equal(tabs.length,2);
  assert.equal(tabs[0].props.accessibilityState.selected,true);assert.equal(tabs[1].props.accessibilityState.selected,false);
  for(const tab of tabs)assert.ok(style(tab).minHeight>=48);
  assert.ok(contrast(style(tabs[0]).backgroundColor,style(tree).backgroundColor)>=3);
  tabs[1].props.onPress();assert.deepEqual(h.events,[['select','b']]);
 });
}
for(const language of ['en','ar']) {
 test(`${language}: unknown balance differs from an exact known zero`,()=>{
  const make=known=>{
   const h=createHarness({language});
   return h.deps['@/components/wallet/balance-overview'].BalanceOverview({theme:h.theme,largeText:true,balanceCoverageText:'Coverage fixture',balanceFils:0,knownBalanceCount:known,duesTotalFils:0,cashOutTotalFils:0,cashOutCardPaymentsFils:0,cashOutAccountOutflowFils:0,currencies:[],currenciesTotalFils:0,activeSourceCount:1,onOpenBills(){},onOpenCurrency(){},onAddAccount(){}});
  };
  assert.match(text(make(0)),/—/);assert.doesNotMatch(text(make(1)),/—/);assert.match(text(make(1)),/0\.00/);
 });
 test(`${language}: balance overview stays focused on recorded account balances`,()=>{
  const h=createHarness({language,largeText:true});
  const tree=h.deps['@/components/wallet/balance-overview'].BalanceOverview({theme:h.theme,largeText:true,balanceCoverageText:'Coverage fixture',balanceFils:125,knownBalanceCount:1,activeSourceCount:1,onAddAccount(){}});
  assert.equal(walk(tree).filter(n=>n.props.onPress).length,0,'an existing account should not expose unrelated dues/cash-flow navigation inside the balance hero');
  assert.match(text(tree),/1\.25/);
  assert.match(text(tree),/Coverage fixture/);
 });
 test(`${language}: setup checklist exposes status and a usable hit target`,()=>{
  const h=createHarness({language});const C=h.local('@/components/ios-message-setup/checklist-row').ChecklistRow;
  for(const status of ['not-started','in-progress','complete','skipped']) {
   const tree=C({title:'Fixture',status,expanded:true,step:1,onPress:()=>h.events.push(['open']),children:null});
   const b=walk(tree).find(n=>n.props.onPress);assert.ok(style(b).minHeight>=44);
   assert.ok(b.props.accessibilityLabel.includes(b.props.accessibilityValue.text));assert.equal(b.props.accessibilityState.expanded,true);
   b.props.onPress();
  }
  assert.equal(h.events.length,4);
 });
 test(`${language}: welcome money scene is display-only and never writes the ledger`,()=>{
  // Name personalization plus focus/tracking/intention now sit ahead of
  // resumeReady; slot 8 represents the hydrated/resume-ready gate in this
  // source-executed harness.
  // states[10] is the gate's `resumeReady`, by hook order — see workflow-ui.test.cjs.
  const h=createWorkflowHarness({language,state:{onboarded:false,marketId:'AE'},states:{10:true}}),tree=h.renderScreen('onboarding'),t=h.deps['@/lib/i18n'].t;
  const scene=walk(tree).find(n=>n.props.testID==='onboarding-market-money-scene');assert.ok(scene);
  assert.ok(walk(tree).some(n=>n.props.accessibilityLabel===t('onboardChooseStart')));
  // Region-aware examples come from the market pack, not an invented partner list.
  for(const bank of ['Emirates NBD','FAB','ADCB'])assert.ok(text(scene).includes(bank),bank);
  assert.match(text(scene),/120\.00/);
  assert.match(text(scene),/7,062\.00/);
  assert.ok(text(scene).includes(t('onboardSceneAlertsToPicture')));
  // Nothing inside the scene is pressable, so the example cannot reach the store.
  assert.ok(!walk(scene).some(n=>n.props.onPress));
  assert.deepEqual(h.events,[]);
 });
}
test('centralized reference translations have equal, nonempty EN/AR keys',()=>{
 const h=createHarness();const tables=h.deps['@/lib/reference-copy'];
 assert.equal(Object.keys(tables).length,5);
 for(const[name,table]of Object.entries(tables)){
  assert.deepEqual(Object.keys(table.en).sort(),Object.keys(table.ar).sort(),name);
  for(const value of Object.values(table.ar))assert.match(typeof value==='function'?value(2):value,/[\u0600-\u06ff]/);
 }
});
