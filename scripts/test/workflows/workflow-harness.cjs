'use strict';
// Source execution with named, explicit native/service substitutes. Not an Expo renderer.
const path=require('node:path');
const load=require('../repair/load-typescript.cjs');
const {createHarness,walk,text}=require('../repair/reference-harness.cjs');
const root=path.resolve(__dirname,'../../..');
function createWorkflowHarness(options={}) {
 const h=createHarness(options),d=h.deps,native=d['react-native'],jsx=h.jsx;
 const record=name=>(...args)=>{h.events.push([name,...args]);return Promise.resolve()};
 native.Platform.OS=options.platform??'android';native.Platform.Version=36;
 native.Platform.select=x=>x[native.Platform.OS]??x.default;
 native.FlatList=p=>jsx('View',{...p,children:[p.ListHeaderComponent,p.data.length?p.data.map((item,index)=>p.renderItem({item,index})):p.ListEmptyComponent]});
 native.I18nManager={isRTL:h.lang==='ar'};native.Linking={openURL:record('openURL'),canOpenURL:async()=>true};
 native.Share={share:record('share')};native.AccessibilityInfo={announceForAccessibility:record('announce')};
 d['@/hooks/use-reduced-motion']={useReducedMotion:()=>true,useMotionPreference:()=>({ready:true,reducedMotion:true})};
 d.react.useLayoutEffect=()=>{};
 d['expo-router'].useFocusEffect=()=>{};
 d['expo-router'].useGlobalSearchParams=()=>options.params??{};
 d['expo-router'].usePathname=()=>options.path??'/';
 d['expo-router'].useRouter=()=>({push:p=>h.events.push(['route',p]),replace:p=>h.events.push(['replace',p]),back:()=>h.events.push(['back']),canGoBack:()=>true});
 d['expo-router'].Stack={Screen:()=>null};
 d['expo-status-bar']={StatusBar:()=>null};
 d['react-native-safe-area-context'].SafeAreaView=p=>jsx('View',p);
 d['react-native-reanimated'].default.ScrollView=p=>jsx('ScrollView',p);
 d['react-native-reanimated'].FadeIn=d['react-native-reanimated'].FadeInDown;
 d['@/components/ui/section-header']={SectionHeader:p=>jsx('SectionHeader',p)};
 h.local('@/components/ui/layout');h.local('@/components/wafra-logo');
 h.local('@/lib/workflow-copy','src/lib/workflow-copy.ts');
 h.local('@/components/onboarding/money-preview');
 const copy=h.local('@/components/workflows/workflow-copy','src/components/workflows/workflow-copy.ts');
 d['./workflow-copy']=copy;h.local('@/components/workflows/workflow-surfaces');
 h.local('@/components/ui/action-icon-button');h.local('@/components/ui/screen-header');
 d['@/components/themed-view']={ThemedView:p=>jsx('View',{...p,style:[{backgroundColor:h.theme.background},p.style]})};
 d['@/components/storage-recovery']={StorageRecovery:p=>jsx('Boundary',{name:'StorageRecovery',...p})};
 d['expo-constants']={__esModule:true,default:{expoConfig:{version:'test',extra:{}},platform:{},executionEnvironment:'standalone'}};
 for(const name of ['expo-document-picker','expo-local-authentication','expo-print','expo-sharing','expo-crypto','expo-device'])d[name]={};
 const store=d['@/lib/store'].useStore();
 for(const name of ['dismissReviewAlert','setAppLock','setDailySummary','setPrivateMode','setTheme','setThemePreference','setLanguage','setMarket','ensureDurable','setOnboarded','setOnboardingPlan','importBackup','clearAll'])store[name]=record(name);
 Object.assign(h.state,{appLock:false,dailySummary:false,themePreference:'system',founderPro:false,pro:true,storageFailure:null,...options.state});
 Object.assign(store,{storageFailure:null,storageRecoveryState:null,hydrationFailed:false});
 Object.assign(d['@/lib/purchases'],{trialDaysLeft:()=>0});
 Object.assign(d['@/lib/markets'],{MARKETS:[{id:'AE',name:'United Arab Emirates',currency:{display:'AED',code:'AED'}}],canSelectMarket:()=>true});
 d['@/lib/uncategorised']={uncategorisedMerchants:()=>options.merchantSummary??{merchants:[],rowCount:0},overrideAppliesTo:()=>false};
 d['@/lib/alert-review-tray']={isUniversalReviewAlert:item=>item.kind==='universal'};
 d['@/components/universal-review-fields']={universalMoneyLabel:v=>v?`${v.currency} ${v.amountMinor/100}`:''};
 d['@/components/diagnostic-export-control']={DiagnosticExportControl:()=>null};
 d['@/lib/ledger-export']={buildLedgerCsv:()=>''};
 d['@/lib/share-text']={readBackupPickerCopy:async()=>null,shareText:record('shareText'),shareTextFile:record('shareTextFile')};
 d['@/lib/accuracy']={unreadFormatCount:()=>0,noFormatsReason:()=>null};
 d['@/lib/background-relay']={clearBackgroundRelayRows:record('clearBackgroundRelayRows'),getChargeAlertPreference:async()=>false,setChargeAlertsEnabled:record('setChargeAlertsEnabled'),disableRelayBackgroundSync:record('disableRelayBackgroundSync')};
 Object.assign(d['@/lib/notifications'],{cancelDailySummary:record('cancelDailySummary'),requestNotificationPermission:async()=>false,syncDailySummary:record('syncDailySummary')});
 Object.assign(d['@/lib/auto-import'],{hasSmsPermission:async()=>false,requestSmsPermission:record('requestSmsPermission'),requestSmsDeliveryPermission:record('requestSmsDeliveryPermission')});
 d['@/lib/founder-pro']={EMPTY_FOUNDER_TAP_SEQUENCE:[],isFounderUnlockBuild:()=>false,recordFounderTap:()=>({})};
 d['@/lib/public-links']={configuredPublicUrl:()=>null};
 d['@/lib/relay']={getRelayConfig:async()=>null,getRelayConfigStrict:async()=>null,isLegacyShortcutCaptureActive:()=>false,isRelayPlatform:()=>false,RelayError:class extends Error{},unpairDevice:record('unpairDevice')};
 d['@/lib/capture']={eraseIosCaptureStore:record('eraseIosCaptureStore'),isCaptureAvailable:()=>false,setIosCaptureEnabled:record('setIosCaptureEnabled')};
 d['@/lib/ios-history-setup']={createIosHistoryPostEraseCleanup:()=>()=>{},eraseIosHistorySessions:record('eraseIosHistorySessions')};
 d['@/lib/ios-message-onboarding']={clearIosMessageSetupProgress:record('clearIosMessageSetupProgress'),dispatchIosMessageSetup:record('dispatchIosMessageSetup'),loadIosMessageSetupProgress:async()=>null};
 d['@/lib/shortcut-cleanup']={openShortcutsApp:record('openShortcutsApp'),shortcutCleanupApplies:()=>false};
 d['@/lib/reimbursement-report']={buildExpenseReportHtml:()=>'',reportExpenses:()=>[]};
 d['../../modules/notification-reader']={};d['../../modules/sms-reader']={};
 d['@/lib/trusted-bank-notification-packages']={isBankNotificationCaptureAvailable:()=>false};
 Object.assign(d['@/lib/launch-performance'],{isInternalLaunchDiagnosticsEnabled:()=>false,serializeLaunchMetrics:()=>''});
 // The real preference preset module has no native runtime; keep it source-executing.
 h.local('@/lib/onboarding','src/lib/onboarding.ts');
 function renderScreen(screen,props={}){
  if(screen==='review-alerts'){
   h.local('@/lib/review-alert-copy','src/lib/review-alert-copy.ts');
   h.local('@/components/universal-review-fields');
  }
  if(screen==='feedback'){
   d['@/lib/sms-parser']={STRUCTURAL_TITLES:new Set()};
   d['@/lib/feedback-wire']=load(path.join(root,'src/lib/feedback-wire.ts'),d,{TextEncoder});
   h.local('@/lib/feedback','src/lib/feedback.ts');
   d['@/lib/feedback'].submitFeedback=async payload=>{h.events.push(['submitFeedback',payload]);return {id:'fixture-receipt'}};
   d['@/lib/feedback-transport']={FeedbackSendError:class extends Error{}};
   d['@/lib/parser-research-source']={isParserResearchBuild:()=>false};
  }
  if(screen==='pro'){
   h.local('@/lib/purchases','src/lib/purchases.ts');
   d['@/lib/billing']={isBillingAvailable:()=>false,loadStorePrices:async()=>null,purchasePro:record('purchasePro'),restorePro:record('restorePro'),subscriptionManagementUrl:async()=>null};
   store.setPro=record('setPro');
  }
  if(screen==='trusted-devices')h.local('@/lib/trusted-device-contract','src/lib/trusted-device-contract.ts');
  if(screen==='ios-setup'){
   // Actual state/step logic, with unavailable native resources and service I/O.
   d['@/lib/ios-local-capture-protocol']={IOS_LOCAL_CAPTURE_SHORTCUT_URL:null,iosLocalCaptureTestUrl:()=>null,normalizeIosLocalCaptureShortcutUrl:()=>null};
   // Execute the new, pure capture-health/journey modules too. Only native
   // services remain substituted; UI and completion logic are never mocked.
   d['./ios-capture-health']=h.local('@/lib/ios-capture-health','src/lib/ios-capture-health.ts');
   h.local('@/lib/ios-setup-journey','src/lib/ios-setup-journey.ts');
   d['./capture-health']=h.local('@/components/ios-message-setup/capture-health');
   h.local('@/components/ios-message-setup/setup-journey');
   h.local('@/lib/ios-capture-setup','src/lib/ios-capture-setup.ts');
   Object.assign(d['@/lib/ios-history-setup'],{historyShortcutInstallUrl:()=>null,iosSupportsMessageHistory:()=>true});
   for(const name of ['checklist-row','automation-guide','details-sheet'])h.local('@/components/ios-message-setup/'+name);
  }

  const file=screen==='onboarding'?'src/components/onboarding-gate.tsx':`src/app/${screen}.tsx`;
  const module=load(path.join(root,file),d,{process:{env:{EXPO_PUBLIC_WAFRA_E2E_DEMO:'1'}},__DEV__:false});
  return screen==='onboarding'?module.OnboardingGate({children:null,...props}):module.default(props);
 }
 return {...h,renderScreen};
}
module.exports={createWorkflowHarness,walk,text};
