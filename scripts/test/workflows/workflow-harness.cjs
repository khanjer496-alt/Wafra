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
 // This harness renders explicitly; each render reads the current external
 // store snapshot. Async subscription/cancellation behavior has its own suite.
 d.react.useSyncExternalStore=(_subscribe,getSnapshot)=>getSnapshot();
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
 // The welcome scene reads real source; artwork, locale and the logo CDN are explicit boundaries.
 d['expo-image']={Image:p=>jsx('Image',p)};d['expo-localization']={getLocales:()=>[{regionCode:'AE'}]};
 d['@/lib/verified-logo-identities']={verifiedLogoUrl:()=>null};
 d['react-native-reanimated'].default.createAnimatedComponent=component=>component;
 Object.assign(d['react-native-reanimated'],{withDelay:(_delay,value)=>value,withSpring:value=>value,withRepeat:value=>value,Easing:{...d['react-native-reanimated'].Easing,out:easing=>easing,inOut:easing=>easing,cubic:value=>value,sin:value=>value,linear:value=>value}});
 h.local('@/lib/onboarding-bank-examples','src/lib/onboarding-bank-examples.ts');
 h.local('@/lib/onboarding-alert-examples','src/lib/onboarding-alert-examples.ts');
 h.local('@/components/onboarding/alive-scenes');
 // The country control renders for real; only its sheet chrome is a boundary,
 // so the closed state renders exactly the row a first-run user sees.
 d['@/components/ui/bottom-sheet']={BottomSheet:p=>p.visible?jsx('BottomSheet',p):null};
 h.local('@/lib/country-names','src/lib/country-names.ts');h.local('@/lib/country','src/lib/country.ts');
 h.local('@/components/country-picker-sheet');
 h.local('@/components/onboarding/country-confirm');
 d['./alive-scenes']=d['@/components/onboarding/alive-scenes'];h.local('@/components/onboarding/statement-scene');h.local('@/components/onboarding/setup-intro-step');
 const copy=h.local('@/components/workflows/workflow-copy','src/components/workflows/workflow-copy.ts');
 d['./workflow-copy']=copy;h.local('@/components/workflows/workflow-surfaces');
 h.local('@/components/ui/action-icon-button');h.local('@/components/ui/screen-header');
 d['@/components/onboarding/setup-shell']={SetupShell:p=>jsx('SetupShell',p),SetupHeader:p=>d['@/components/ui/screen-header'].ScreenHeader(p)};
 d['@/components/themed-view']={ThemedView:p=>jsx('View',{...p,style:[{backgroundColor:h.theme.background},p.style]})};
 d['@/components/storage-recovery']={StorageRecovery:p=>jsx('Boundary',{name:'StorageRecovery',...p})};
 d['@/components/ledger-currency-sheet']={LedgerCurrencySheet:p=>jsx('LedgerCurrencySheet',p),suggestedLedgerCurrency:()=> 'AED'};
 d['expo-constants']={__esModule:true,default:{expoConfig:{version:'test',extra:{}},platform:{},executionEnvironment:'standalone'}};
 for(const name of ['expo-document-picker','expo-local-authentication','expo-print','expo-sharing','expo-crypto','expo-device'])d[name]={};
 const store=d['@/lib/store'].useStore();
 for(const name of ['dismissReviewAlert','setAppLock','setDailySummary','setPrivateMode','setTheme','setThemePreference','setLanguage','setMarket','ensureDurable','setOnboarded','setOnboardingPlan','setOnboardingProfile','setAndroidCaptureSources','importBackup','clearAll'])store[name]=record(name);
 Object.assign(h.state,{appLock:false,dailySummary:false,themePreference:'system',founderPro:false,pro:true,userName:'',storageFailure:null,marketId:'AE',knownBanks:['Emirates NBD'],...options.state});
 Object.assign(store,{storageFailure:null,storageRecoveryState:null,hydrationFailed:false});
 Object.assign(d['@/lib/purchases'],{trialDaysLeft:()=>0});
 Object.assign(d['@/lib/markets'],{MARKETS:[{id:'AE',name:'United Arab Emirates',currency:{display:'AED',code:'AED'},banks:[{name:'Emirates NBD',domain:'emiratesnbd.com',color:'#2B4C9B'},{name:'FAB',domain:'bankfab.com',color:'#00A3E0'},{name:'ADCB',domain:'adcb.com',color:'#E4032E'}]}],canSelectMarket:()=>true});
 d['@/lib/uncategorised']={uncategorisedMerchants:()=>options.merchantSummary??{merchants:[],paymentPurposes:[],rowCount:0,totalFils:0},overrideAppliesTo:()=>false};
 d['@/lib/alert-review-tray']={isUniversalReviewAlert:item=>item.kind==='universal',
  isIosApplePayReview:require('../build/alert-review-tray.js').isIosApplePayReview,
  isIosNotificationReview:require('../build/alert-review-tray.js').isIosNotificationReview,
  ...Object.fromEntries(['isCurrencyConflictReview','recentlyExpiredReviewCount','recentlyLostReviewCount','reviewCaptureBacklog','reviewExpiresInDays','reviewTrayCapacity']
   .map(name=>[name,require('../build/alert-review-tray.js')[name]]))};
 d['@/components/universal-review-fields']={universalMoneyLabel:v=>v?`${v.currency} ${v.amountMinor/100}`:''};
 d['@/components/diagnostic-export-control']={DiagnosticExportControl:()=>null};
 d['@/components/tester-diagnostics-control']={TesterDiagnosticsControl:()=>null};
 d['@/lib/ledger-export']={buildLedgerCsv:()=>''};
 d['@/lib/sms-corpus-export']={isSmsCorpusExportAvailable:()=>false,sharePersonalDataForReview:record('sharePersonalDataForReview')};
 d['@/lib/share-text']={readBackupPickerCopy:async()=>null,shareText:record('shareText'),shareTextFile:record('shareTextFile')};
 d['@/lib/accuracy']={unreadFormatCount:()=>0,noFormatsReason:()=>null};
 d['@/lib/background-relay']={clearBackgroundRelayRows:record('clearBackgroundRelayRows'),getChargeAlertPreference:async()=>false,setChargeAlertsEnabled:record('setChargeAlertsEnabled'),disableRelayBackgroundSync:record('disableRelayBackgroundSync')};
 Object.assign(d['@/lib/notifications'],{cancelDailySummary:record('cancelDailySummary'),requestNotificationPermission:async()=>false,syncDailySummary:record('syncDailySummary')});
 Object.assign(d['@/lib/auto-import'],{hasSmsPermission:async()=>false,requestSmsPermission:record('requestSmsPermission'),requestSmsDeliveryPermission:record('requestSmsDeliveryPermission'),hasBankNotificationSystemAccess:()=>false,openBankNotificationAccessSettings:async()=>true,isSmsScanningAvailable:()=>true});
 d['@/lib/founder-pro']={EMPTY_FOUNDER_TAP_SEQUENCE:[],isFounderUnlockBuild:()=>false,recordFounderTap:()=>({})};
 d['@/lib/public-links']={configuredPublicUrl:()=>null};
 d['@/lib/relay']={getRelayConfig:async()=>null,getRelayConfigStrict:async()=>null,isLegacyShortcutCaptureActive:()=>false,isRelayPlatform:()=>false,RelayError:class extends Error{},unpairDevice:record('unpairDevice')};
 d['@/lib/capture']={eraseIosCaptureStore:record('eraseIosCaptureStore'),isCaptureAvailable:()=>false,setIosCaptureEnabled:record('setIosCaptureEnabled')};
 d['@/lib/ios-history-setup']={createIosHistoryPostEraseCleanup:()=>()=>{},eraseIosHistorySessions:record('eraseIosHistorySessions'),iosSupportsMessageHistory:()=>true};
 d['@/lib/ios-message-onboarding']={clearIosMessageSetupProgress:record('clearIosMessageSetupProgress'),dispatchIosMessageSetup:record('dispatchIosMessageSetup'),loadIosMessageSetupProgress:async()=>null};
 d['@/lib/shortcut-cleanup']={openShortcutsApp:record('openShortcutsApp'),shortcutCleanupApplies:()=>false};
 d['@/lib/growth-funnel']={
  GROWTH_PLACEMENTS:{onboarding:'onboarding_main',postImportPro:'post_import_pro',settingsPro:'settings_pro'},
  trackGrowthEvent:()=>{},
 };
 d['@/lib/reimbursement-report']={buildExpenseReportHtml:()=>'',reportExpenses:()=>[]};
 d['../../modules/notification-reader']={__esModule:true,default:{setCaptureEnabled:async()=>true}};d['../../modules/sms-reader']={};
 d['@/lib/trusted-bank-notification-packages']={isBankNotificationCaptureAvailable:()=>false,bankNotificationAdmissionExpiresAt:()=>Date.now()+86400000};
 Object.assign(d['@/lib/launch-performance'],{isInternalLaunchDiagnosticsEnabled:()=>false,serializeLaunchMetrics:()=>''});
 d['@/lib/growth-funnel']={GROWTH_PLACEMENTS:{onboarding:'onboarding_main',postImportPro:'post_import_pro',settingsPro:'settings_pro'},trackGrowthEvent:(...args)=>h.events.push(['growth',...args])};
 // The real preference preset module has no native runtime; keep it source-executing.
 h.local('@/lib/onboarding','src/lib/onboarding.ts');
 h.local('@/lib/android-capture-sources','src/lib/android-capture-sources.ts');
 // Settings and Data and help: the real copy, status helpers and row shapes.
 // Only the biometric probe is a native boundary; `null` is "not known yet".
 h.local('@/lib/biometric-kind','src/lib/biometric-kind.ts');
 h.local('@/lib/settings-copy','src/lib/settings-copy.ts');
 h.local('@/lib/settings-status','src/lib/settings-status.ts');
 d['@/components/biometric-glyph']={useBiometricKind:()=>options.biometricKind??null,BiometricGlyph:p=>jsx('BiometricGlyph',p)};
 h.local('@/components/settings-rows');
 function renderScreen(screen,props={}){
  if(screen==='review-alerts'){
   h.local('@/lib/review-alert-copy','src/lib/review-alert-copy.ts');
   h.local('@/components/universal-review-fields');
  }
  if(screen==='feedback'){
   d['@/lib/sms-parser']={STRUCTURAL_TITLES:new Set()};
   d['@/lib/feedback-wire']=load(path.join(root,'src/lib/feedback-wire.ts'),d,{TextEncoder});
   h.local('@/lib/feedback-copy','src/lib/feedback-copy.ts');
   h.local('@/lib/feedback','src/lib/feedback.ts');
   d['@/lib/feedback'].submitFeedback=async payload=>{h.events.push(['submitFeedback',payload]);return {id:'fixture-receipt'}};
   d['@/lib/feedback-transport']={FeedbackSendError:class extends Error{}};
   d['@/lib/parser-research-source']={isParserResearchBuild:()=>false};
  }
  if(screen==='pro'){
   h.local('@/lib/purchases','src/lib/purchases.ts');
   h.local('@/lib/pro-copy','src/lib/pro-copy.ts');
   d['@/lib/billing']={isBillingAvailable:()=>false,loadStorePrices:async()=>null,purchasePro:record('purchasePro'),restorePro:record('restorePro'),subscriptionManagementUrl:async()=>null};
   d['@/components/superwall-billing-context']={useWafraBilling:()=>({
    available:false,configured:false,configurationError:null,paywallStatus:'idle',
    fetchProOffers:async()=>[],purchasePro:async()=>'unavailable',
    presentProPaywall:async()=>{},restorePro:async()=>null,
   })};
   store.setPro=record('setPro');
  }
  if(screen==='trusted-devices')h.local('@/lib/trusted-device-contract','src/lib/trusted-device-contract.ts');
  if(screen==='ios-setup'){
   d['@/lib/ios-paged-setup']=load(path.join(root,'src/lib/ios-paged-setup.ts'),{}, {process:{env:{}}});
   // Actual state/step logic, with unavailable native resources and service I/O.
   d['@/lib/ios-local-capture-protocol']={IOS_LOCAL_CAPTURE_SHORTCUT_URL:null,iosLocalCaptureTestUrl:()=>null,normalizeIosLocalCaptureShortcutUrl:()=>null};
   // Execute the new, pure capture-health/journey modules too. Only native
   // services remain substituted; UI and completion logic are never mocked.
   d['./ios-capture-health']=h.local('@/lib/ios-capture-health','src/lib/ios-capture-health.ts');
   h.local('@/lib/ios-setup-journey','src/lib/ios-setup-journey.ts');
   h.local('@/lib/ios-shortcut-setup-copy','src/lib/ios-shortcut-setup-copy.ts');
   d['./capture-health']=h.local('@/components/ios-message-setup/capture-health');
   h.local('@/components/ios-message-setup/setup-journey');
   h.local('@/lib/ios-capture-setup','src/lib/ios-capture-setup.ts');
   // The actual pure per-source progress projections; storage stays recorded.
   const progressModule=load(path.join(root,'src/lib/ios-message-onboarding.ts'),{'@react-native-async-storage/async-storage':{},
    './ios-setup-journey':load(path.join(root,'src/lib/ios-setup-journey.ts')),'./ios-history-setup':{isIosHistoryShortcutInstalled:async()=>false}});
   Object.assign(d['@/lib/ios-message-onboarding'],{progressForSource:progressModule.progressForSource,recordedIosCaptureSource:progressModule.recordedIosCaptureSource});
   Object.assign(d['@/lib/ios-history-setup'],{historyShortcutInstallUrl:()=>null,iosSupportsMessageHistory:()=>true});
   for(const name of ['checklist-row','automation-guide','details-sheet','setup-step'])h.local('@/components/ios-message-setup/'+name);
  }

  if(screen==='onboarding'){
   h.local('@/lib/ios-statement-handoff','src/lib/ios-statement-handoff.ts');
   // Redesign additions run from source; the native capture status, the
   // backup picker and the ledger analytics are explicit boundaries.
   d['@/lib/capture']={...d['@/lib/capture'],getIosCaptureNativeModule:()=>null};
   d['@/lib/ios-capture-setup']=d['@/lib/ios-capture-setup']??{resolveIosSetupReadiness:()=>'not-added'};
   d['@/lib/subscriptions']={detectSubscriptions:()=>[]};
   d['@/lib/ledger']={...(d['@/lib/ledger']??{}),liveAccountIds:()=>new Set(),internalTransferIdsForState:()=>new Set(),isSpending:tx=>tx.type==='expense'};
   h.local('@/lib/splits','src/lib/splits.ts');
   h.local('@/lib/onboarding-ready','src/lib/onboarding-ready.ts');
   h.local('@/lib/ios-capture-checklist','src/lib/ios-capture-checklist.ts');
   h.local('@/lib/ios-shortcut-setup-copy','src/lib/ios-shortcut-setup-copy.ts');
   h.local('@/lib/onboarding-copy','src/lib/onboarding-copy.ts');
   d['@/components/ui/grow-bar']={GrowBar:p=>jsx('GrowBar',p)};
   for(const name of ['capture-checklist','ready-summary','sms-explainer'])h.local('@/components/onboarding/'+name);
  }
  const file=screen==='onboarding'?'src/components/onboarding-gate.tsx':`src/app/${screen}.tsx`;
  const module=load(path.join(root,file),d,{process:{env:{EXPO_PUBLIC_WAFRA_E2E_DEMO:'1'}},__DEV__:false});
  return screen==='onboarding'?module.OnboardingGate({children:null,...props}):module.default(props);
 }
 return {...h,renderScreen};
}
module.exports={createWorkflowHarness,walk,text};
