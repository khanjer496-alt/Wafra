'use strict';
// Actual source components, with explicit native/store boundaries. Not an Expo renderer.
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const nativeStyles = { create: s => s, hairlineWidth: 1, flatten: s => Object.assign({}, ...(Array.isArray(s) ? s.flat(Infinity).filter(Boolean) : [s])) };
const themes = load(path.join(root, 'src/constants/theme.ts'), { '@/global.css': {}, 'react-native': { Platform: { select: x => x.android } } });
function createHarness(options = {}) {
  class Clock extends Date { constructor(...args){ super(...(args.length?args:['2026-09-06T12:00:00Z'])); } static now(){return Date.parse('2026-09-06T12:00:00Z');} }
  const events=[]; const lang=options.language??'en'; const theme=themes.Colors[options.theme??'light'];
  let hookIndex=0;
  const react = { memo: f=>f, isValidElement: n=>!!n?.props, Fragment:'Fragment', useMemo:f=>f(),  useCallback:f=>f, useDeferredValue:v=>v,
    useRef:v=>({current:v}), useEffect(){}, useId:()=>`id-${hookIndex++}`, forwardRef:f=>p=>f(p,null),
    useState: initial => { const i=hookIndex++; return [Object.hasOwn(options.states??{},i) ? options.states[i] : typeof initial==='function'?initial():initial,
      value=>events.push(['state',i,value])]; },
  };
  const jsx = (type, props={}, key) => typeof type==='function' ? type(props) : ({type,props,key});
  const runtime={jsx,jsxs:jsx,Fragment:'Fragment'};
  const amount=(fils, opts={})=>(fils/100).toLocaleString(lang==='ar'?'ar-AE':'en-AE', {minimumFractionDigits:opts.decimals===false?0:2,maximumFractionDigits:opts.decimals===false?0:2});
  const formatAED=(fils,opts)=>`${lang==='ar'?'د.إ':'AED'} ${amount(fils,opts)}`;
  const i18n=load(path.join(root,'src/lib/i18n.ts'));i18n.setLanguage(lang);
  const format={ formatAED, formatAmount:amount, formatCompactAED:f=>amount(f,{decimals:false}),
    monthKey:d=>String(d instanceof Date?d.toISOString():d).slice(0,7),
    monthLabel:(k,short=false)=>new Date(k+'-01T12:00:00Z').toLocaleDateString(lang==='ar'?'ar-AE':'en-GB',{month:short?'short':'long',year:'numeric'}),
    shiftMonthKey:(k,n)=>{const d=new Date(k+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);return d.toISOString().slice(0,7)},
    shortDate:d=>new Date(d+'T12:00:00Z').toLocaleDateString(lang==='ar'?'ar-AE':'en-GB',{month:'short',day:'numeric'}),
    weekdayShort:d=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d], weekdayName:d=>['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d],
    toISODate:d=>d.toISOString().slice(0,10),clockTime:()=>'',parseAmountToFils:s=>isFinite(Number(s))?Math.round(Number(s)*100):null,
    totalAsShown:a=>a.reduce((s,v)=>s+v,0),fullDateTime:tx=>tx.date,friendlyDate:d=>format.shortDate(d),
  };
  const native={View:'View',ActivityIndicator:'ActivityIndicator',Text:'Text',TextInput:'TextInput',Pressable:'Pressable',ScrollView:p=>jsx('ScrollView',p),RefreshControl:'RefreshControl',StyleSheet:nativeStyles,
    Platform:{OS:'android',select:x=>x.android},AppState:{addEventListener:()=>({remove(){}})},Alert:{alert:m=>events.push(['alert',m])},useWindowDimensions:()=>({width:options.width??390,fontScale:options.largeText?1.3:1})};
  const period=options.period??{mode:'month',key:'2026-09'};
  const periodModule={inPeriod:(date,p)=>typeof p==='string'?date.slice(0,7)===p:p.mode==='month'?date.slice(0,7)===p.key:true,
    periodLabel:p=>p.mode==='month'?format.monthLabel(p.key,true):'This year',toPeriod:p=>typeof p==='string'?{mode:'month',key:p}:p,
    comparablePreviousPeriod:p=>p.mode==='month'?{mode:'month',key:format.shiftMonthKey(p.key,-1)}:null};
  const accounts=[
    {id:'enbd',name:'Emirates NBD',kind:'bank',bankName:'Emirates NBD',last4:'4821',openingFils:0,snapshotKind:'balance',snapshotFils:2500000,snapshotTs:1788681600000,color:'#166CA2'},
    {id:'adcb',name:'ADCB',kind:'bank',bankName:'ADCB',last4:'8310',openingFils:0,snapshotKind:'balance',snapshotFils:1700000,snapshotTs:1788681600000,color:'#BD364C'},
    {id:'credit',name:'NBD credit card',kind:'card',bankName:'Emirates NBD',cardType:'credit',last4:'0294',openingFils:0,snapshotKind:'outstanding',snapshotFils:280000,color:'#166CA2'},
    {id:'cash',name:'Cash wallet',kind:'cash',openingFils:50000,color:'#997349'},
  ];
  const transactions=[
    ['rent','Rent',180000,'rent'],['dining','Talabat',62000,'dining'],['transport','ENOC',48000,'transport'],['shopping','Amazon',42000,'shopping'],
    ['utilities','DEWA',31000,'utilities'],['entertainment','Cinema',24000,'entertainment'],['other','Other spending',149000,'other'],
  ].map(([id,title,amountFils,category],i)=>({id,title,amountFils,category,date:`2026-09-0${Math.min(6,2+i)}`,type:'expense',accountId:'enbd',source:'sms'}));
  transactions.push({id:'salary',title:'Salary',amountFils:830000,category:'salary',date:'2026-09-01',type:'income',accountId:'enbd',source:'sms'});
  for(let n=4;n<=8;n++)transactions.push({id:'old-'+n,title:'Past spending',amountFils:400000+n*12000,category:'dining',date:`2026-0${n}-05`,type:'expense',accountId:'enbd',source:'sms'});
  const budgets=[['rent',250000],['dining',150000],['transport',50000],['shopping',100000],['utilities',50000],['entertainment',50000]].map(([category,limitFils])=>({category,limitFils}));
  const bills=[{id:'dewa',title:'DEWA',category:'utilities',amountFils:32000,dueDay:8,paidMonths:[],accountId:'enbd'},
    {id:'telecom',title:'Etisalat',category:'telecom',amountFils:20000,dueDay:7,paidMonths:[],accountId:'enbd'}];
  const cardDues=[{id:'statement',accountId:'credit',dueDate:'2026-09-10',totalDueFils:280000,minDueFils:14000,paidFils:0}];
  const subs=[{title:'Netflix',category:'entertainment',lastAmountFils:4000,avgAmountFils:4000,monthlyEquivalentFils:4000,cadence:'monthly',status:'active',group:'subscription',nextExpectedISO:'2026-09-12',lastChargedISO:'2026-08-12',accountId:'credit'},
    {title:'Spotify',category:'entertainment',lastAmountFils:2200,avgAmountFils:2200,monthlyEquivalentFils:2200,cadence:'monthly',status:'active',group:'subscription',nextExpectedISO:'2026-09-18',lastChargedISO:'2026-08-18',accountId:'credit'}];
  const state={hydrated:true,onboarded:true,language:lang,accounts,transactions,budgets,bills,cardDues,goals:[],captureOptOut:false,historyImport:null,
    privateMode:true,notSubscriptions:[],merchantOverrides:{},marketId:'AE',ledgerMoney:{currency:'AED',exponent:2},reviewTray:{pending:[]},...options.state};
  if(options.empty){state.transactions=[];state.accounts=[];state.budgets=[];state.bills=[];state.cardDues=[];}
  const store={state,getStateSnapshot:()=>state,getStateGeneration:()=>0};
  for(const name of ['editTransaction','deleteTransaction','setMerchantOverride','addAccount','editAccount','deleteAccount','addGoal','editGoal','deleteGoal','mergeRenewedCard','markCardsDistinct','addBill','deleteBill','markBillPaid','setNotSubscription','payCardDue','upsertBudget','deleteBudget','applyFxUpdates','setCaptureOptOut','beginHistoryImport'])store[name]=(...args)=>{events.push([name,...args]);return Promise.resolve()};
  const deps={react,'react/jsx-runtime':runtime,'react-native':native,'@/constants/theme':themes,'@/global.css':{},
    'expo-router':{useRouter:()=>({push:p=>events.push(['route',p]),back:()=>events.push(['back'])}),useLocalSearchParams:()=>options.params??{},Redirect:p=>jsx('Redirect',p)},
    'expo-linear-gradient':{LinearGradient:p=>jsx('Gradient',p)},
    '@/hooks/use-theme':{useTheme:()=>theme},'@/hooks/use-language':{useLanguage:()=>lang},'@/hooks/use-large-text-layout':{useLargeTextLayout:()=>!!options.largeText},
    '@/hooks/use-ledger-money':{useLedgerMoney:()=>null},
    '@/hooks/use-screen-entering':{useScreenEntering:()=>()=>undefined},'@/hooks/use-color-scheme':{useColorScheme:()=>options.theme??'light'},
    '@/hooks/use-reduced-motion':{useReducedMotion:()=>true},'@/lib/haptics':{tapped(){}},'@react-navigation/native':{useIsFocused:()=>true},
    '@/lib/i18n':i18n,
    '@/lib/format':format,'@/lib/markets':{ledgerCurrencyCode:()=> 'AED',ledgerCurrencyDisplay:()=>lang==='ar'?'د.إ':'AED'},
    '@/lib/period':periodModule,'@/lib/period-context':{usePeriod:()=>({period,setPeriod:p=>events.push(['period',p])})},
    '@/lib/store':{useStore:()=>store},
    '@/components/ui/screen-scaffold':{ScreenScaffold:p=>jsx('Scaffold',p),useScreenContentInsets:()=>({contentInset:{top:0},contentContainerStyle:{}})},
    '@/components/ui/bottom-sheet':{BottomSheet:p=>p.visible?jsx('Sheet',p):null},
    '@/components/ui/spring-pressable':{SpringPressable:p=>jsx('Pressable',p)},
    '@/components/ui/platform-symbol':{PlatformSymbol:p=>p.fallback},
    '@/hooks/use-auto-import':{usePullToRefresh:()=>({refreshing:false,onRefresh:()=>events.push(['refresh'])}),useAutoImport:()=>({captureState:'waiting-for-alert',needsPermission:false,runAutoImport:async()=>events.push(['refresh'])})},
    '@/lib/auto-import':{isSmsScanningAvailable:()=>false,openSmsPermissionSettings:async()=>{}},
    '@/lib/fx':{buildReferenceFxUpdates:async()=>[]},'@/lib/fx-summary':{summarizeForeignActivity:()=>({groups:[]})},
    '@/lib/cash-flow':{summarizeCashOutflow:()=>({totalFils:536000,cardPaymentsFils:0,accountOutflowFils:536000})},
    '@/components/lock-gate':{usePrivacyGateCleared:()=>true},'@/lib/purchases':{isProActive:()=>true},
    '@/lib/notifications':{syncPaymentReminders:async()=>{}},'@/lib/launch-performance':{markLaunchPhase(){}},
    '@/components/ui/toast':{useToast:()=>({show:m=>events.push(['toast',m])})},
    '@/components/ui/states':{EmptyMonth:p=>jsx('EmptyMonth',p),SkeletonRows:p=>jsx('SkeletonRows',p)},
  };
  const animated={View:'View'};const fade={delay(){return this},duration(){return this}};
  deps['react-native-reanimated']={__esModule:true,default:animated,FadeInDown:fade,ReduceMotion:{System:'system'},
    useAnimatedStyle:f=>f(),useSharedValue:v=>({value:v}),withSpring:v=>v,withTiming:v=>v,Easing:{bezier:()=>null},interpolate:(v,a,b)=>b[0]+(v-a[0])/(a[1]-a[0])*(b[1]-b[0])};
  deps['react-native-svg']={__esModule:true,default:'svg',Circle:'circle',Line:'line',Path:'path',Rect:'rect',Defs:'defs',LinearGradient:'linearGradient',Stop:'stop'};
  const local=(name,filename)=>deps[name]=load(path.join(root,filename??name.replace('@/', 'src/')+'.tsx'),deps,{Date:Clock});
  local('@/lib/reference-copy','src/lib/reference-copy.ts');
  local('@/lib/currency-metadata','src/lib/currency-metadata.ts');
  local('@/lib/ledger-money','src/lib/ledger-money.ts');
  local('@/lib/ledger','src/lib/ledger.ts');local('@/lib/splits','src/lib/splits.ts');local('@/lib/balances','src/lib/balances.ts');local('@/lib/categories','src/lib/categories.ts');
  local('@/lib/merchant-spending','src/lib/merchant-spending.ts');
  local('@/lib/merchant-spending-copy','src/lib/merchant-spending-copy.ts');
  deps['@/lib/subscriptions']={detectSubscriptions:()=>options.empty?[]:subs,activeSubscriptions:s=>s,stoppedSubscriptions:()=>[],trueSubscriptions:s=>s,
    fixedCommitments:()=>[],billCommitments:()=>[],otherCommitments:()=>[],daysUntilNext:s=>Math.round((Date.parse(s.nextExpectedISO)-Date.parse('2026-09-06'))/86400000),
    recurringPaymentAccount:(tx,accounts)=>accounts.find(a=>a.id===tx.accountId)};
  local('@/lib/transaction-filter','src/lib/transaction-filter.ts');
  local('@/lib/insights','src/lib/insights.ts');local('@/lib/analytics','src/lib/analytics.ts');local('@/lib/reference-presentation','src/lib/reference-presentation.ts');
  const summary=deps['@/lib/insights'].summarizeMonth(state.transactions,period,new Set(state.accounts.map(a=>a.id)),new Set());
  deps['@/lib/cards']={openDues:()=>state.cardDues.map(due=>({due,daysLeft:4,remainingFils:due.totalDueFils,status:'upcoming',minimumKnown:true})),recentlySettledDues:()=>[],
    reissueSuggestions:()=>[],isInactiveAccount:(_s,a)=>!!a.archived,cardFigure:(_s,a)=>({kind:a.cardType==='credit'?'owed':a.snapshotFils===undefined&&a.kind!=='cash'?'unknown':'balance',fils:a.snapshotFils??(a.kind==='cash'?a.openingFils:null)})};
  deps['@/lib/bills']={billsForMonth:()=>state.bills.map(bill=>({bill,status:'upcoming',daysLeft:bill.dueDay-6,dueISO:`2026-09-${String(bill.dueDay).padStart(2,'0')}`}))};
  deps['@/lib/leaving-soon']={daysPhrase:n=>lang==='ar'?`خلال ${n} أيام`:`In ${n} days`};
  deps['@/lib/dashboard-projection']={projectDashboard:()=>({hero:{...summary,netFils:summary.incomeFils-summary.expenseFils},live:true,
    activityRows:state.transactions.filter(tx=>tx.date.slice(0,7)==='2026-09').slice(0,4),accountById:new Map(state.accounts.map(a=>[a.id,a])),internalTransactionIds:new Set(),
    unreadFormats:{count:0,shouldPrompt:false},uncategorised:{shouldPrompt:false,summary:{merchants:[]}},
    upcoming:{items:state.bills.map(b=>({id:b.id,title:b.title,kind:'bill',amountFils:b.amountFils,daysLeft:b.dueDay-6,dateISO:`2026-09-0${b.dueDay}`,billId:b.id}))}})};
  local('@/components/themed-text');local('@/components/ui/icon');local('@/components/ui/money');local('@/components/ui/category-avatar');
  local('@/components/merchant-spending-link');
  deps['@/components/ui/merchant-avatar']={MerchantAvatar:p=>deps['@/components/ui/category-avatar'].CategoryAvatar(p)};
  deps['@/components/ui/tile']={AccountTile:({account,size=32})=>jsx('AccountIcon',{account,size}),CategoryTile:p=>deps['@/components/ui/category-avatar'].CategoryAvatar(p)};
  deps['@/components/ui/action-icon-button']={ActionIconButton:p=>jsx('Pressable',{...p,children:deps['@/components/ui/icon'].Icon({name:p.icon,size:20,color:theme.text})})};
  local('@/components/ui/segmented-control');local('@/components/ui/controls');local('@/components/ui/progress-bar');local('@/components/ui/text-field');
  deps['@/components/ui/period-pill']={SectionHeader:p=>jsx('SectionHeader',p)};
  for(const [module,name] of [['period-sheet','PeriodSheet'],['entry-detail-sheet','EntryDetailSheet'],['card-payment-sheet','CardPaymentSheet'],['bill-detail-sheet','BillDetailSheet'],
    ['card-detail-sheet','CardDetailSheet'],['ui/amount-sheet','AmountSheet'],['ui/choice-sheet','ChoiceSheet'],['ui/confirm-sheet','ConfirmSheet'],['ui/category-chips','CategoryChips'],['limit-sheet','LimitSheet']]) {
    deps['@/components/'+module]={[name]:p=>jsx('Boundary',{...p,name})};
  }
  local('@/components/ui/category-chips');
  local('@/components/wafra-logo');
  local('@/lib/ledger-light-copy','src/lib/ledger-light-copy.ts');
  local('@/components/history-reading-status');
  local('@/components/transaction-row');local('@/components/reference-home-summary');
  local('@/components/spending/spending-overview');local('@/components/spending/spending-trends');
  local('@/components/bills/payment-agenda');local('@/components/wallet/balance-overview');local('@/components/wallet/account-groups');
  deps['react-native-safe-area-context']={useSafeAreaInsets:()=>({top:0,bottom:10,left:0,right:0})};
  deps['@/components/ui/tab-bar-metrics']={useTabBarMetrics:()=>({measuredHeight:78,setMeasuredHeight(){}})};
  local('@/components/tab-bar');
  function loadDetail() {
    deps['@/lib/fx'].formatOriginalCurrency=(f,c)=>c+' '+amount(f);
    deps['@/lib/sms-parser']={overrideFitsDirection:()=>false};
    deps['@/lib/uncategorised']={overrideAppliesTo:()=>false};
    deps['@/components/ui/section-header']={SectionHeader:p=>jsx('SectionHeader',p)};
    local('@/components/ui/layout');
    local('@/components/entry-detail-sheet');
  }
  const renderDetail=(transaction=state.transactions[1])=>{hookIndex=0;loadDetail();return deps['@/components/entry-detail-sheet'].EntryDetailSheet({transaction,onClose:()=>events.push(['close'])});};
  const render=screen=>{hookIndex=0;const file=screen==='home'?'src/screens/journal-home-screen.tsx':screen==='stats'?'src/app/stats.tsx':`src/app/(tabs)/${screen}.tsx`;
    return load(path.join(root,file),deps,{Date:Clock}).default();};
  const tabTree=screen=>deps['@/components/tab-bar'].WafraTabBar({state:{index:['home','flow','bills','wallet'].indexOf(screen),routes:['index','flow','bills','wallet'].map(name=>({key:name,name}))},navigation:{emit:()=>({defaultPrevented:false}),navigate:name=>events.push(['route',name])}});
  return {render,renderDetail,tabTree,events,deps,theme,lang,jsx,state,format,local};
}
function walk(node,out=[]){if(Array.isArray(node))node.forEach(n=>walk(n,out));else if(node&&typeof node==='object'){out.push(node);walk(node.props?.children,out);walk(node.props?.footer,out);}return out}
function text(node){if(typeof node==='boolean')return '';return Array.isArray(node)?node.map(text).join(' '):node&&typeof node==='object'?text(node.props?.children):node??''}
module.exports={createHarness,walk,text};
