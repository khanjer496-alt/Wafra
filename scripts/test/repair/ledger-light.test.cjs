'use strict';
// Execute actual components with named native/service substitutions. Not device rendering.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness, walk, text } = require('./reference-harness.cjs');
const { harness } = require('./journal-harness.cjs');
const root=path.resolve(__dirname,'../../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const style=n=>Object.assign({},...[n.props.style].flat(Infinity).filter(Boolean));
for(const [mode,bg,ink,accent,expense] of [
 ['light','#F4F1EA','#16130F','#1F6B52','#A3402D'],
 ['dark','#14120F','#F2EFE8','#57B894','#E0836B'],
]) {
 test(`${mode}: original Claude paper/charcoal and semantic ink are exact`,()=>{
  const h=createHarness({theme:mode});
  assert.equal(h.theme.background,bg);assert.equal(h.theme.text,ink);
  assert.equal(h.theme.primary,accent);assert.equal(h.theme.expense,expense);
 });
 test(`${mode}: money uses Geist Mono; text uses Geist`,()=>{
  const h=createHarness({theme:mode});const Text=h.deps['@/components/themed-text'].ThemedText;
  assert.equal(style(Text({children:'Body'})).fontFamily,'Geist-Regular');
  assert.equal(style(Text({type:'amount',children:'12.50'})).fontFamily,'GeistMono-SemiBold');
  assert.equal(style(Text({type:'smallBold',tabular:true,children:'12.50'})).fontFamily,'GeistMono-SemiBold');
 });
 test(`${mode}: category identity is a neutral glyph, not a coloured card`,()=>{
  const h=createHarness({theme:mode});const C=h.deps['@/components/ui/category-avatar'].CategoryAvatar;
  for(const category of ['dining','transport','shopping']) {
   const tree=C({category});
   assert.ok(walk(tree).every(n=>!style(n).backgroundColor || style(n).backgroundColor==='transparent'));
  }
 });
 test(`${mode}: original W-arrow geometry is shared by app and launcher renderer`,()=>{
  const s=read('src/components/wafra-logo.tsx');
  const paths=[...s.matchAll(/\bd="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(paths,['M8 15 L15.5 33 L23 19 L30.5 33 L40 11.5','M34 11.5 H40 V17.5']);
  assert.doesNotMatch(s,/LinearGradient|rotate|opacity=/);
  assert.match(read('scripts/render-icons.mjs'),/paths\.length !== 2/);
 });
 test(`${mode}: tabs retain all four routes without delayed entrance or focus transforms`,()=>{
  const h=createHarness({theme:mode}),tree=h.tabTree('home');
  const tabs=walk(tree).filter(n=>n.props.accessibilityRole==='tab');assert.equal(tabs.length,4);
  assert.equal(tabs.filter(n=>n.props.accessibilityState?.selected).length,1);
  for(const tab of tabs)tab.props.onPress();
  assert.deepEqual(h.events.map(e=>e[1]),['flow','bills','wallet']);
  assert.equal(h.events.length,3,'selected tab must not enqueue duplicate navigation');
  assert.doesNotMatch(read('src/components/tab-bar.tsx'),/withSpring|entering=|useSharedValue|activePill/);
 });
}
for(const language of ['en','ar']) {
 for(const status of ['running','paused','failed','complete']) {
  test(`${language} ${status}: SMS progress reflects durable counts, never a made-up total`,()=>{
   const h=createHarness({language});
   const C=h.deps['@/components/history-reading-status'].HistoryReadingStatus;
   const tree=C({progress:{status,scanned:1234,found:57,error:status==='failed'?'page-failed':undefined},onResume:()=>h.events.push(['resume'])});
   assert.deepEqual(h.events,[]);assert.match(text(tree),/1,234/);assert.match(text(tree),/57/);
   assert.doesNotMatch(text(tree),/%|ETA|\d+ of \d+|notify you when/i);
   const action=walk(tree).filter(n=>n.props.onPress);
   assert.equal(action.length,['paused','failed'].includes(status)?1:0);
   assert.equal(walk(tree).filter(n=>n.type==='ActivityIndicator').length,status==='running'?1:0);
   if(action.length){action[0].props.onPress();assert.deepEqual(h.events,[['resume']]);}
   if(language==='ar')assert.doesNotMatch(text(tree),/Messages checked|Transactions found|Reading SMS/);
  });
 }
}
test('permission recovery opens settings through the original history callback',async()=>{
 const h=harness({history:{status:'failed',scanned:1234,found:57,error:'inbox-access'}});
 const action=walk(h.tree).find(n=>n.props?.accessibilityLabel==='openPhoneSettings');
 assert.ok(action);action.props.onPress();await Promise.resolve();await Promise.resolve();
 assert.deepEqual(h.events,[['permissions'],['resume']]);
});
test('background behaviour copy asks the user to keep the app open',()=>{
 const h=createHarness();const C=h.deps['@/components/history-reading-status'].HistoryReadingStatus;
 assert.match(text(C({progress:{status:'running',scanned:1,found:0},onResume(){}})),/Keep the app open/);
});
test('native font embedding and runtime names agree with original source families',()=>{
 const c=JSON.parse(read('app.json'));const fonts=c.expo.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-font')[1].fonts;
 for(const family of ['Geist-Regular','Geist-Medium','Geist-SemiBold','GeistMono-Regular','GeistMono-Medium','GeistMono-SemiBold','NotoKufiArabic-Regular','NotoKufiArabic-Bold']) {
  assert.ok(fonts.includes(`./assets/fonts/${family}.ttf`));
  assert.ok(read('src/components/app-root-layout.tsx').includes(`'${family}'`));
 }
 assert.ok(!fonts.some(p=>p.includes('IBM')));
 assert.equal(c.expo.android.adaptiveIcon.backgroundColor,'#1F6B52');
});
test('read-only overview surfaces are not forced green cards or gradients',()=>{
 for(const p of ['src/components/reference-home-summary.tsx','src/components/wallet/balance-overview.tsx','src/components/workflows/workflow-surfaces.tsx']) {
  assert.doesNotMatch(read(p),/LinearGradient|#032521|#062D28|#F6FBF7/);
 }
 assert.match(read('src/components/ui/layout.tsx'),/detailTable: \{ borderTopWidth: 1, borderBottomWidth: 1/);
});
