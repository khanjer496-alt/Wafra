'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHarness,walk,text} = require('./reference-harness.cjs');
const months = Array.from({length:6},(_,i)=>({key:`2026-0${i+4}`,incomeFils:i?100000:0,expenseFils:i?4200:0}));
function setup(options={}) {
 const h=createHarness(options);
 const props={months,selectedKey:'2026-04',merchants:[],movers:[],weekdays:[0,0,0,0,0,0,0],periodLabel:'September',comparisonLabel:null,
 onMonth:k=>h.events.push(['month',k]),onMerchant(){},onCategory(){}};
 const tree=h.deps['@/components/spending/spending-trends'].SpendingTrends(props);
 return {h,tree,all:walk(tree)};
}
for(const language of ['en','ar']) for(const width of [320,390]) {
 test(`${language} ${width} large text exposes all six named, actionable months`,()=>{
  const {h,all}=setup({language,width,largeText:true});
  const rows=all.filter(n=>String(n.props.testID||'').startsWith('cashflow-detail-'));
  assert.equal(rows.length,6);
  assert.equal(rows[0].props.accessibilityState.selected,true);
  assert.match(rows[0].props.accessibilityLabel, language==='ar'?/لا توجد حركات مسجلة/:/No recorded activity/);
  assert.doesNotMatch(rows[0].props.accessibilityLabel,/0\.00/);
  rows[3].props.onPress();assert.deepEqual(h.events.at(-1),['month','2026-07']);
  assert.match(text(rows[0]),/—/);
 });
}
test('Arabic labels are not rendered as tabular money',()=>{
 const {all}=setup({language:'ar',largeText:true});
 for(const label of ['الدخل','الإنفاق']) {
  const nodes=all.filter(n=>n.type==='Text'&&text(n)===label);
  assert.ok(nodes.length>=6);
  for(const n of nodes) {
   const styles=[n.props.style].flat(Infinity).filter(Boolean);
   assert.ok(!styles.some(s=>s.fontVariant?.includes('tabular-nums')));
   assert.ok(styles.some(s=>String(s.fontFamily).includes('Arabic')));
  }
 }
});
test('narrow Arabic layout has detail labels even with standard text',()=>{
 const {all}=setup({language:'ar',width:320});
 assert.equal(all.filter(n=>String(n.props.testID||'').startsWith('cashflow-detail-')).length,6);
});
