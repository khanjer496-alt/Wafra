const fs = require('fs');
const path = require('path');
const onboarding = require('./build/onboarding');
const i18n = require('./build/i18n');
const growth = require('./build/growth-funnel');
const backupValidation = require('./build/backup-validation');

let pass = 0;
let fail = 0;

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name}\n    got ${a}\n    want ${e}`);
  }
}

function ok(name, condition) {
  if (condition) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name}`);
  }
}

// A normal launch must recover the saved handoff without needing a callback URL.
const resume = onboarding.onboardingResumeDestination;
eq('cold iPhone launch resumes its pending setup',
  resume?.({ platform: 'ios', pendingIosSetup: true, hasSavedPlan: true, completedCallback: false }), 'ios-setup');
eq('a completed callback takes precedence over a stale setup flag',
  resume?.({ platform: 'ios', pendingIosSetup: true, hasSavedPlan: true, completedCallback: true }), 'complete');
eq('Android never follows an iPhone setup flag',
  resume?.({ platform: 'android', pendingIosSetup: true, hasSavedPlan: true, completedCallback: false }), 'capture');
eq('saved personalization resumes at capture instead of resetting answers',
  resume?.({ platform: 'ios', pendingIosSetup: false, hasSavedPlan: true, completedCallback: false }), 'capture');
eq('a new user starts at the interactive welcome',
  resume?.({ platform: 'ios', pendingIosSetup: false, hasSavedPlan: false, completedCallback: false }), 'welcome');
eq('a saved value-first stage resumes before optional planning',
  resume?.({ platform: 'ios', pendingIosSetup: false, hasSavedPlan: false, completedCallback: false, savedStage: 'tracking' }), 'tracking');
eq('spending focus opens Spending after setup', onboarding.onboardingLandingPath('spending'), '/flow');
eq('bills focus opens Bills after setup', onboarding.onboardingLandingPath('bills'), '/bills');
eq('cash-flow focus opens Home after setup', onboarding.onboardingLandingPath('cashflow'), '/');
eq('overview focus opens Home after setup', onboarding.onboardingLandingPath('overview'), '/');
eq('preferred name trims and collapses accidental whitespace',
  onboarding.normalizePreferredName('  Naser   Khanjar  '), 'Naser Khanjar');
eq('preferred name preserves Arabic and Unicode',
  onboarding.normalizePreferredName('  ناصر  '), 'ناصر');
eq('preferred name rejects an empty value', onboarding.normalizePreferredName('   \n\t '), null);
eq('preferred name is bounded by Unicode code points',
  Array.from(onboarding.normalizePreferredName('😀'.repeat(60))).length,
  onboarding.MAX_PREFERRED_NAME_LENGTH);

eq('Adapty-ready placement IDs are stable without initializing Adapty', growth.GROWTH_PLACEMENTS, {
  onboarding: 'onboarding_main',
  postImportPro: 'post_import_pro',
  settingsPro: 'settings_pro',
});
{
  const events = [];
  growth.trackGrowthEvent('onboarding_started');
  eq('growth events are a no-op until a provider sink is connected', events, []);
  growth.setGrowthEventSink((event, payload) => events.push([event, payload.focus ?? null]));
  growth.trackGrowthEvent('onboarding_focus_selected', { focus: 'bills' });
  eq('provider-neutral funnel can be connected later without changing screens', events,
    [['onboarding_focus_selected', 'bills']]);
  growth.setGrowthEventSink(() => { throw new Error('analytics unavailable'); });
  let blocked = false;
  try { growth.trackGrowthEvent('onboarding_completed', { focus: 'bills' }); } catch { blocked = true; }
  eq('analytics failure cannot block onboarding', blocked, false);
  growth.setGrowthEventSink(null);
}
{
  const profileState = {
    transactions: [],
    onboardingProfile: { v: 1, stage: 'privacy', focus: 'bills', tracking: 'bank-apps', startedAt: 10 },
  };
  eq('backup validation accepts the bounded source-free onboarding profile',
    backupValidation.isValidBackupState(profileState), true);
  eq('backup validation rejects unknown onboarding focus values',
    backupValidation.isValidBackupState({ ...profileState,
      onboardingProfile: { ...profileState.onboardingProfile, focus: 'crypto' } }), false);
  eq('backup validation rejects unknown onboarding stages',
    backupValidation.isValidBackupState({ ...profileState,
      onboardingProfile: { ...profileState.onboardingProfile, stage: 'paywall' } }), false);
  eq('backup validation rejects negative onboarding clocks',
    backupValidation.isValidBackupState({ ...profileState,
      onboardingProfile: { ...profileState.onboardingProfile, startedAt: -1 } }), false);
  for (const currency of ['USD', 'EUR', 'JPY', 'KWD']) {
    eq(`backup validation preserves global onboarding currency evidence (${currency})`,
      backupValidation.isValidBackupState({ ...profileState, onboardingCurrencyEvidence: currency }), true);
  }
  eq('backup validation rejects non-canonical currency evidence',
    backupValidation.isValidBackupState({ ...profileState, onboardingCurrencyEvidence: 'usd' }), false);
  eq('backup validation rejects ISO currencies whose exponent the ledger cannot represent',
    backupValidation.isValidBackupState({ ...profileState, onboardingCurrencyEvidence: 'CLF' }), false);
}

eq('onboarding defaults are complete and safe', onboarding.normalizeOnboardingAnswers({}), {
  marketId: 'AE',
  goalIds: ['emergency'],
  budgetId: 'balanced',
  monthStartDay: 1,
});

eq(
  'onboarding removes duplicate goals and enforces the two-goal cap',
  onboarding.normalizeOnboardingAnswers({
    marketId: 'SA',
    goalIds: ['travel', 'travel', 'home', 'emergency'],
    budgetId: 'flexible',
    monthStartDay: 28,
  }),
  {
    marketId: 'SA',
    goalIds: ['travel', 'home'],
    budgetId: 'flexible',
    monthStartDay: 28,
  },
);

eq(
  'onboarding rejects unsupported month start days',
  onboarding.normalizeOnboardingAnswers({ monthStartDay: 31 }).monthStartDay,
  1,
);

const saPlan = onboarding.buildOnboardingPlan(
  {
    marketId: 'SA',
    goalIds: ['emergency', 'home'],
    budgetId: 'flexible',
    monthStartDay: 25,
  },
  'ar',
);

eq('Saudi onboarding creates five real category budgets', saPlan.budgets.length, 5);
eq(
  'Saudi flexible preset writes the expected monthly total',
  saPlan.budgets.reduce((sum, budget) => sum + budget.limitFils, 0),
  1_010_000,
);
eq(
  'onboarding creates localized savings goals with market targets',
  saPlan.goals.map((goal) => [goal.title, goal.targetFils, goal.savedFils]),
  [
    ['صندوق الطوارئ', 2_500_000, 0],
    ['دفعة منزل أولى', 15_000_000, 0],
  ],
);

eq(
  'onboarding never creates money plans before currency is proven',
  onboarding.buildDeferredOnboardingPlan(
    { goalIds: ['emergency'], budgetId: 'balanced' },
    null,
    null,
    1,
    'en',
  ),
  null,
);
{
  const incomeBasis = typeof onboarding.onboardingIncomeBasis === 'function'
      ? onboarding.onboardingIncomeBasis([
        { id: 'refund', type: 'income', amountFils: 2_000_00, isTransfer: false, category: 'other', date: '2026-08-01' },
        { id: 'salary-a', type: 'income', amountFils: 500_00, isTransfer: false, category: 'salary', date: '2026-07-28' },
        { id: 'salary-b', type: 'income', amountFils: 480_00, isTransfer: false, category: 'salary', date: '2026-06-28' },
        { id: 'own-transfer', type: 'income', amountFils: 900_00, isTransfer: true, category: 'salary', date: '2026-08-02' },
        { id: 'expense', type: 'expense', amountFils: 1_000_00, isTransfer: false, category: 'salary', date: '2026-08-02' },
      ])
    : null;
  eq('starter plans use median confirmed salary and ignore transfers or windfalls', incomeBasis, 490_00);
}
eq(
  'one arbitrary credit cannot create a recurring starter budget',
  onboarding.onboardingIncomeBasis([
    { type: 'income', amountFils: 9_000_00, isTransfer: false, category: 'other', date: '2026-08-02' },
  ]),
  0,
);
{
  const usdPlan = onboarding.buildDeferredOnboardingPlan(
    { goalIds: ['travel'], budgetId: 'flexible' },
    'USD',
    500_00,
    1,
    'en',
  );
  eq('a proven worldwide ledger activates five income-relative limits',
    usdPlan?.budgets.map((budget) => [budget.category, budget.limitFils]),
    [
      ['groceries', 100_00],
      ['dining', 75_00],
      ['transport', 50_00],
      ['shopping', 60_00],
      ['entertainment', 40_00],
    ]);
  eq('worldwide goal templates scale in the real ledger currency',
    usdPlan?.goals.map((goal) => [goal.title, goal.targetFils, goal.savedFils]),
    [['A proper holiday', 500_00, 0]]);
}
eq(
  'a currency without income stays pending instead of inventing an amount',
  onboarding.buildDeferredOnboardingPlan(
    { goalIds: ['travel'], budgetId: 'flexible' },
    'USD',
    0,
    1,
    'en',
  ),
  null,
);
eq(
  'unsafe goal multiplication leaves the plan pending',
  onboarding.buildDeferredOnboardingPlan(
    { goalIds: ['home'], budgetId: 'balanced' },
    'USD',
    Number.MAX_SAFE_INTEGER,
    1,
    'en',
  ),
  null,
);
eq(
  'a proven SAR ledger activates the selected plan',
  onboarding.buildDeferredOnboardingPlan(
    { goalIds: ['home'], budgetId: 'essentials' },
    'SAR',
    2_500_00,
    25,
    'en',
  )?.answers,
  { currency: 'SAR', goalIds: ['home'], budgetId: 'essentials', monthStartDay: 25 },
);
eq(
  'locale-derived SAR money does not activate a plan without bank-alert proof',
  onboarding.buildDeferredOnboardingPlan(
    { goalIds: ['home'], budgetId: 'essentials' },
    'SAR',
    0,
    25,
    'en',
  ),
  null,
);

{
  const existingBudget = { category: 'dining', limitFils: 12345 };
  const existingGoal = {
    id: 'manual-goal', title: 'Emergency fund', emoji: 'target',
    targetFils: 50000, savedFils: 10000,
  };
  const merged = onboarding.mergeDeferredOnboardingPlan(
    [existingBudget],
    [existingGoal],
    [
      { category: 'dining', limitFils: 99999 },
      { category: 'shopping', limitFils: 20000 },
    ],
    [
      { id: 'starter-duplicate', title: 'Emergency fund', emoji: 'target', targetFils: 1, savedFils: 0 },
      { id: 'starter-travel', title: 'A proper holiday', emoji: 'plane', targetFils: 2, savedFils: 0 },
    ],
  );
  eq('deferred activation preserves a budget the user already configured', merged.budgets[0], existingBudget);
  eq('deferred activation adds only missing budget categories', merged.budgets.length, 2);
  eq('deferred activation preserves a matching user goal and its progress', merged.goals[0], existingGoal);
  eq('deferred activation adds only missing starter goals', merged.goals.length, 2);
}

eq('welcome preview uses a universal income example', i18n.t('onboardPreviewIncome', 'en'), 'Income received');
eq('welcome preview uses a universal bill example', i18n.t('onboardPreviewBill', 'en'), 'Upcoming bill');

const gateSource = fs.readFileSync(
  path.join(__dirname, '../../src/components/onboarding-gate.tsx'),
  'utf8',
);
const storeSource = fs.readFileSync(path.join(__dirname, '../../src/lib/store.tsx'), 'utf8');
const settingsSource = fs.readFileSync(path.join(__dirname, '../../src/app/settings.tsx'), 'utf8');
const i18nSource = fs.readFileSync(path.join(__dirname, '../../src/lib/i18n.ts'), 'utf8');
const iosSource = fs.readFileSync(path.join(__dirname, '../../src/app/ios-setup.tsx'), 'utf8');
const iosControllerSource = fs.readFileSync(
  path.join(__dirname, '../../src/lib/ios-capture-setup.ts'),
  'utf8',
);
const journalHomeSource = fs.readFileSync(
  path.join(__dirname, '../../src/screens/journal-home-screen.tsx'),
  'utf8',
);
const aliveScenesSource = fs.readFileSync(
  path.join(__dirname, '../../src/components/onboarding/alive-scenes.tsx'),
  'utf8',
);
const onboardingBankExamplesSource = fs.readFileSync(
  path.join(__dirname, '../../src/lib/onboarding-bank-examples.ts'),
  'utf8',
);

ok(
  'first-run personalization is one integrated journey without the optional goals/budget wizard',
  gateSource.includes("const JOURNEY_STEPS: readonly Step[] = ['focus', 'tracking', 'intention', 'preview']") &&
    gateSource.includes('<FocusChooser value={selectedFocus} onChange={chooseFocus}') &&
    gateSource.includes('<TrackingChooser value={selectedTracking} onChange={chooseTracking}') &&
    gateSource.includes('<IntentionChooser value={selectedIntention} onChange={chooseIntention}') &&
    !gateSource.includes('PLAN_STEPS') &&
    !gateSource.includes("activeStep === 'goals'") &&
    !gateSource.includes("activeStep === 'budget'") &&
    !gateSource.includes('onboardPersonalizeOptional'),
);
ok(
  'Settings can replay the latest name-personalized onboarding without mutating app state',
  /settingsViewOnboarding/.test(settingsSource) &&
    /router\.setParams\(\{ onboarding: 'preview' \}\)/.test(settingsSource) &&
    /const previewMode = state\.onboarded && params\.onboarding === 'preview'/.test(gateSource) &&
    /if \(previewMode\) return;[\s\S]{0,120}setOnboardingProfile/.test(gateSource) &&
    /if \(previewMode\) \{[\s\S]{0,160}setAndroidSmsReady\(true\)/.test(gateSource) &&
    /const openWafra = async[\s\S]*?if \(previewMode\) \{[\s\S]{0,120}closePreview\(\);[\s\S]{0,80}return;/.test(gateSource) &&
    /const openWafra = async[\s\S]*?setOnboarded\(\)/.test(gateSource) &&
    /if \(!previewMode\) trackGrowthEvent\(\.\.\.args\)/.test(gateSource),
);
eq('Settings explains onboarding replay is read-only',
  i18n.t('settingsViewOnboardingDetail', 'en'),
  'Replay the welcome flow without changing your data or settings');
ok(
  'name personalization morphs inside Welcome instead of becoming a fifth progress step',
  gateSource.includes('testID="onboarding-name-input"') &&
    gateSource.includes('testID="onboarding-name-preview"') &&
    /onboardChooseStart[\s\S]*?openNamePersonalization/.test(gateSource) &&
    /onboardNameSkip/.test(gateSource) &&
    /setUserName\(nextName\)[\s\S]*?saveJourney\('focus'\)[\s\S]*?ensureDurable\(\)/.test(gateSource) &&
    gateSource.includes("const JOURNEY_STEPS: readonly Step[] = ['focus', 'tracking', 'intention', 'preview']") &&
    !/JOURNEY_STEPS[^\n]*name/.test(gateSource),
);
ok(
  'Home greeting uses the durable onboarding name while preserving the skipped-name fallback',
  /state\.userName === 'there' \? null : normalizePreferredName\(state\.userName\)/.test(journalHomeSource) &&
    /const greeting = preferredName[\s\S]{0,180}greetingBase/.test(journalHomeSource),
);
ok(
  'saved preferred name personalizes later onboarding without touching financial data',
  /onboardFocusTitleNamed/.test(gateSource) &&
    /onboardPersonalizedTitleNamed/.test(gateSource) &&
    /case 'setUserName'[\s\S]{0,260}normalizePreferredName/.test(storeSource) &&
    !/setUserName[\s\S]{0,120}(?:addTransaction|importBatch|upsertBudget|addGoal)/.test(gateSource),
);
ok(
  'starter-plan copy waits for real income instead of implying country support',
  !/supported ledger currency/.test(i18nSource) &&
    /real income/i.test(i18nSource),
);
ok(
  'the store activates a deferred plan from real non-transfer income in any ledger currency',
  /onboardingIncomeBasis\(state\.transactions\)/.test(storeSource) &&
    /buildDeferredOnboardingPlan\([\s\S]*?state\.ledgerMoney\?\.currency,[\s\S]*?onboardingIncomeBasis\(state\.transactions\)/.test(storeSource),
);
ok(
  'welcome uses real Wafra identity and market-aware bank examples without ledger writes',
  /<WelcomeMoneyScene marketId=\{state\.marketId\} reducedMotion=\{reducedMotion\}/.test(gateSource) &&
    /WafraMark/.test(aliveScenesSource) &&
    /onboardingBankRegion/.test(aliveScenesSource) &&
    /verifiedLogoUrl/.test(aliveScenesSource) &&
    /activeStep === 'welcome'[\s\S]*?<WelcomeMoneyScene[\s\S]*?onboardChooseStart/.test(gateSource) &&
    /US:[\s\S]*GB:[\s\S]*FR:[\s\S]*DE:[\s\S]*IN:[\s\S]*QA:[\s\S]*KW:/.test(onboardingBankExamplesSource) &&
    !/useStore|importBatch|addTransaction|setOnboarded|setCaptureOptOut|loadDemoData/.test(aliveScenesSource) &&
    !/Gmail|Excel|fake contact/i.test(aliveScenesSource),
);
ok(
  'welcome money reveal drops real regional alerts and their bank logos independently',
  /function PosterAlertCard/.test(aliveScenesSource) &&
    /card\.value = withDelay[\s\S]*?withSpring/.test(aliveScenesSource) &&
    /logo\.value = withDelay[\s\S]*?withSpring/.test(aliveScenesSource) &&
    /translateY:[\s\S]*?-155/.test(aliveScenesSource) &&
    /translateY:[\s\S]*?-72/.test(aliveScenesSource) &&
    /onboardingAlertExamples/.test(aliveScenesSource) &&
    /onboardSceneAlertsToPicture/.test(aliveScenesSource) &&
    !/function MessageParse|function Token/.test(aliveScenesSource),
);
ok(
  'successful completion keeps Wafra identity and editorial result strips instead of a generic success card',
  /failedCompletion \|\| smsDenied[\s\S]{0,220}<Icon name="alert"[\s\S]{0,220}<WafraMark size=\{42\}/.test(gateSource) &&
    /resultCard:[\s\S]{0,420}borderTopWidth:[\s\S]{0,120}borderBottomWidth:/.test(gateSource) &&
    !/resultCard:[\s\S]{0,420}backgroundColor: night\.primarySoft/.test(gateSource),
);
ok(
  'Android capture exposes SMS, bank-app notifications, either, both, or manual',
  /onPress=\{\(\) => void runSetupAction\(startScan\)\}/.test(gateSource) &&
    /onPress=\{\(\) => void runSetupAction\(connectAndroidNotifications\)\}/.test(gateSource) &&
    /finishAndroidCapture/.test(gateSource) &&
    /onboardCaptureContinueBoth/.test(gateSource) &&
    /onboardCaptureContinueOne/.test(gateSource) &&
    /onPress=\{\(\) => void runSetupAction\(continueManually\)\}/.test(gateSource),
);
ok(
  'web preview offers manual tracking without a nonfunctional automatic choice',
  /Platform\.OS === 'android' \?/.test(gateSource) &&
    /\) : Platform\.OS === 'ios' \? \(/.test(gateSource) &&
    /<StartOption automatic=\{false\} disabled=\{setupBusy \|\| transitioning\} onPress=\{\(\) => void runSetupAction\(continueManually\)\}/.test(gateSource) &&
    /Platform\.OS === 'web' \? 'onboardManualChoiceWebBody'/.test(gateSource),
);
ok(
  'Android notification capture is a first-class source while neither automatic source is visually recommended',
  !/styles\.startOptionFeatured|recommendedPill|t\('recommended'\)/.test(gateSource) &&
    /NotificationReader/.test(gateSource) &&
    /androidNotificationReady/.test(gateSource) &&
    /androidSmsReady/.test(gateSource),
);
ok(
  'first-run gate exempts guided history routes only on iOS',
  /const isIosSetupRoute\s*=\s*Platform\.OS === 'ios'[\s\S]{0,180}pathname === '\/ios-setup'[\s\S]{0,100}pathname === '\/import-sms'/.test(gateSource) &&
    /const showOverlay\s*=[\s\S]{0,220}!isIosSetupRoute/.test(gateSource),
);
eq('iOS onboarding uses the compact bank-alert heading', i18n.t('onboardCaptureTitleIos', 'en'), 'Start your way');
eq('iOS onboarding explains that the capture choice can change', i18n.t('onboardCaptureBodyIos', 'en'), 'Choose what works for you. You can change this later.');
eq('iOS automatic choice explains the Shortcut and keeps history optional', i18n.t('onboardAutomaticChoiceIosBody', 'en'), 'Add one Wafra Shortcut, then turn on a Message automation. Past messages are optional.');
eq('iOS automatic action names the bank-alert connection', i18n.t('onboardAutomaticChoiceIos', 'en'), 'Connect bank alerts');
eq('iOS manual choice promises no Messages access', i18n.t('onboardManualChoiceIosBody', 'en'), 'Add entries yourself. No Messages access. Connect later.');
eq('iOS onboarding keeps the privacy summary to one line', i18n.t('onboardCapturePrivacyIos', 'en'), 'Processed on this iPhone. Nothing uploaded.');
eq(
  'Learn more distinguishes 30-day logical expiry from later physical cleanup',
  i18n.t('onboardCaptureLearnMoreRetention', 'en'),
  'Raw Message Content and Sender expire logically after 30 days. Physical deletion happens on the next capture or queue check, so protected bytes can remain longer.',
);
eq(
  'Learn more warns that the older automation can keep uploading selected alerts',
  i18n.t('onboardCaptureLearnMoreLegacy', 'en'),
  'An older Wafra Capture automation may continue uploading selected alerts until you remove or retire it.',
);
const universalSenderLabel = ['Any', 'Sender'].join(' ');
const universalSenderLabelArabic = ['أي', 'مرسل'].join(' ');
const iosVisibleCopyKeys = [
  'onboardCaptureTitleIos',
  'onboardCaptureBodyIos',
  'onboardAutomaticChoiceIos',
  'onboardAutomaticChoiceIosBody',
  'onboardManualChoiceIos',
  'onboardManualChoiceIosBody',
  'onboardCapturePrivacyIos',
  'iosLocalPrivacyBody',
  'iosMessageGuideSender',
];
const iosVisibleCopy = iosVisibleCopyKeys
  .flatMap((key) => [i18n.t(key, 'en'), i18n.t(key, 'ar')])
  .join(' ');
ok(
  'iOS onboarding keeps title, choice bodies, and privacy summary within the compact copy budget',
  ['en', 'ar'].every((language) =>
    i18n.t('onboardCaptureTitleIos', language).length <= 42 &&
      i18n.t('onboardAutomaticChoiceIosBody', language).length <= 92 &&
      i18n.t('onboardManualChoiceIosBody', language).length <= 92 &&
      i18n.t('onboardCapturePrivacyIos', language).length <= 64),
);
ok(
  'iOS onboarding keeps one automatic CTA, one manual fallback, and full details behind Learn more',
  /label=\{t\('onboardAutomaticChoiceIos'\)\}/.test(gateSource) &&
    /onboardManualChoiceIos/.test(gateSource) &&
    /<BottomSheet[\s\S]*?visible=\{learnMoreVisible\}[\s\S]*?onboardCaptureLearnMoreTitle/.test(gateSource) &&
    /label=\{t\('onboardCaptureLearnMoreAction'\)\}/.test(gateSource) &&
    !iosVisibleCopy.includes(universalSenderLabel) &&
    !iosVisibleCopy.includes(universalSenderLabelArabic),
);
ok(
  'forced-dark onboarding gives Learn more an explicit visible label and border',
  /label=\{t\('onboardCaptureLearnMoreAction'\)\}[\s\S]{0,180}labelColor=\{night\.text\}[\s\S]{0,120}style=\{\[styles\.learnMoreButton, styles\.ghost\]\}/.test(
    gateSource,
  ),
);
{
  const automaticBodies = ['onboardAutomaticChoiceAndroidBody'];
  ok(
    'Android automatic capture keeps its three-day Pro boundary before selection',
    automaticBodies.every((key) => {
      const en = i18n.t(key, 'en');
      const ar = i18n.t(key, 'ar');
      return /first 3 app days/.test(en) && /Wafra Pro/.test(en) &&
        /٣ أيام/.test(ar) && /وفرة برو/.test(ar);
    }),
  );
}
ok(
  'onboarding never invents scan progress and only reveals real imported results',
  /discoveredResult\.tx/.test(gateSource) &&
    /discoveredResult\.accounts/.test(gateSource) &&
    /discoveredResult\.bills/.test(gateSource) &&
    /state\.transactions\.length/.test(gateSource) &&
    /state\.bills\.length \+ state\.cardDues\.length/.test(gateSource) &&
    !/const \[progress\] = useState\(\{ scanned: 0, found: 0 \}\)/.test(gateSource) &&
    !/activeStep === 'scanning'/.test(gateSource) &&
    // The navigation guard only re-enables controls; it cannot manufacture
    // scan progress or import results. Any other timer still fails this gate.
    !/\bset(?:Timeout|Interval)\s*\(/.test(gateSource.replace(
      /stepTransitionTimer\.current = setTimeout\(\(\) => \{\s*stepTransitionTimer\.current = null;\s*setTransitioning\(false\);\s*\}, STEP_TRANSITION_MS\);/,
      '',
    )),
);
ok(
  'first run waits for encrypted hydration and exposes one integrated journey progress bar',
  /if \(!state\.hydrated\s*\|\|/.test(gateSource) &&
    /resumeReady/.test(gateSource) &&
    /loadingLedger/.test(gateSource) &&
    /onboardStepOf|progressbar/.test(gateSource) &&
    /JOURNEY_STEPS\.includes\(activeStep\)/.test(gateSource) &&
    !/PLAN_STEPS|personalizing/.test(gateSource),
);
ok(
  'value flows through personal intention into preview and contextual capture trust',
  /activeStep === 'focus'[\s\S]*?activeStep === 'tracking'[\s\S]*?activeStep === 'intention'[\s\S]*?activeStep === 'preview'[\s\S]*?activeStep === 'capture'/.test(gateSource) &&
    /activeStep === 'preview'[\s\S]*?onPress=\{showCapture\}/.test(gateSource) &&
    !/activeStep === 'privacy'/.test(gateSource) &&
    /testID="onboarding-context-trust"/.test(gateSource) &&
    /discoveredResult && discoveredResult\.tx > 0[\s\S]*?onboardProPreviewAction/.test(gateSource) &&
    /GROWTH_PLACEMENTS\.postImportPro/.test(gateSource),
);
ok(
  'tracking choice changes a real product scene instead of collecting a dead survey answer',
  /<TrackingChooser value=\{selectedTracking\} onChange=\{chooseTracking\} marketId=\{state\.marketId\}/.test(gateSource) &&
    /id: 'bank-apps'/.test(aliveScenesSource) &&
    /id: 'spreadsheet'/.test(aliveScenesSource) &&
    /id: 'finance-app'/.test(aliveScenesSource) &&
    /id: 'none'/.test(aliveScenesSource) &&
    /onboardTrackingOneView/.test(aliveScenesSource),
);
ok(
  'Android source setup persists readiness before explicit final completion',
  /await beginHistoryImport\(\)[\s\S]*?await ensureDurable\(\)[\s\S]*?setAndroidSmsReady\(true\)/.test(gateSource) &&
    /const finishAndroidCapture = async[\s\S]*?saveJourney\('complete'\)[\s\S]*?await ensureDurable\(\)[\s\S]*?setCompletionOutcome\('automatic'\)/.test(gateSource) &&
    /outcome: outcomeOverride \?\? completionOutcome/.test(gateSource),
);
ok(
  'funnel instrumentation is provider-neutral and covers the important first-run decisions',
  ['onboarding_started', 'onboarding_focus_selected', 'onboarding_tracking_selected',
    'onboarding_value_previewed', 'onboarding_privacy_seen', 'capture_setup_started',
    'capture_permission_granted', 'capture_permission_denied', 'manual_tracking_selected',
    'onboarding_completed'].every((event) => gateSource.includes(`'${event}'`)),
);
ok(
  'manual completion keeps the gate visible through a failed durable save',
  /const showOverlay\s*=[\s\S]{0,240}\(!state\.onboarded \|\| finishing \|\| previewMode\)/.test(gateSource) &&
    /const openWafra = async[\s\S]*?setFinishing\(true\)[\s\S]*?await ensureDurable\(\)[\s\S]*?setFinishing\(false\)[\s\S]*?catch[\s\S]*?setFinishSaveFailed\(true\)/.test(gateSource) &&
    /finishSaveFailed \? <Button[\s\S]{0,220}openWafra\(requestedFirstEntry\.current, requestedDestination\.current\)/.test(gateSource),
);
ok(
  'completion copy distinguishes automatic, manual and failed outcomes while SMS denial stays inline',
  /type CompletionOutcome = 'automatic' \| 'manual' \| 'denied' \| 'failed'/.test(gateSource) &&
    /setCompletionOutcome\('failed'\)/.test(gateSource) &&
    /onboardCompleteManualBody/.test(gateSource) &&
    /onboardCompleteNeedsAttentionBody/.test(gateSource) &&
    /onboardSmsDeniedInline/.test(gateSource) &&
    !/setCompletionOutcome\('denied'\)/.test(gateSource),
);
ok(
  'the no-SMS onboarding choice durably opts out before completion',
  /const continueManually = async \(\) => \{[\s\S]*?await setCaptureOptOut\(true\)[\s\S]*?setCompletionOutcome\('manual'\)[\s\S]*?setStep\('complete'\)/.test(gateSource) &&
    gateSource.includes('onPress={() => void runSetupAction(continueManually)}'),
);
ok(
  'choosing automatic capture clears a prior durable opt-out before either platform starts',
  /const startScan = async \(\) => \{[\s\S]*?await setCaptureOptOut\(false\)[\s\S]*?await beginHistoryImport\(\)/.test(gateSource) &&
    /const beginCapture = async \(\) => \{[\s\S]*?if \(Platform\.OS === 'ios'\)[\s\S]*?await setCaptureOptOut\(false\)[\s\S]*?router\.push\('\/ios-setup\?fromOnboarding=1'\)/.test(gateSource),
);
ok(
  'Android stages history without inbox parsing and waits for explicit source-selection completion',
  /const startScan = async \(\) => \{[\s\S]*?await beginHistoryImport\(\)[\s\S]*?setAndroidSmsReady\(true\)/.test(gateSource) &&
    !/const startScan = async \(\) => \{[\s\S]*?await scanInbox/.test(gateSource) &&
    /const finishAndroidCapture = async[\s\S]*?setStep\('complete'\)/.test(gateSource),
);
ok(
  'Android resumes the configured automatic reveal after a restart instead of sending the user backward',
  /pendingAutomaticReveal[\s\S]*?state\.onboardingProfile\?\.stage === 'complete'[\s\S]*?state\.historyImport !== null[\s\S]*?state\.captureOptOut === false[\s\S]*?setCompletionOutcome\('automatic'\)[\s\S]*?setStep\('complete'\)/.test(gateSource),
);
ok(
  'iPhone onboarding shows a personalized completion reveal before leaving setup',
  /fromOnboarding && setupComplete[\s\S]*?onboardCompleteAutomaticTitle[\s\S]*?onboardingInsight\.title[\s\S]*?onboardingInsight\.body/.test(iosSource),
);
ok(
  'denied SMS onboarding can retry or open the exact app settings',
  /smsDenied[\s\S]*?retryHistoryRead[\s\S]*?runSetupAction\(startScan\)[\s\S]*?openPhoneSettings[\s\S]*?Linking\.openSettings/.test(gateSource),
);
ok(
  'iOS manual opt-out revokes a setup that was started before returning to onboarding',
    /await setCaptureOptOut\(true\)[\s\S]*?if \(Platform\.OS === 'ios'\)[\s\S]*?try \{[\s\S]*?await getRelayConfigStrict\(\)[\s\S]*?await unpairDevice\(relay\)[\s\S]*?setShortcutCleanup\('revoked'\)[\s\S]*?catch[\s\S]*?setShortcutCleanup\('uncertain'\)[\s\S]*?finally[\s\S]*?await disableRelayBackgroundSync\(\)[\s\S]*?shortcutCleanupUncertain/.test(gateSource),
);
ok(
  'iOS manual completion clears the guided-history return marker',
  /const continueManually = async \(\) => \{[\s\S]*?if \(Platform\.OS === 'ios'\)[\s\S]*?type: 'onboarding-return-cleared'[\s\S]*?setCompletionOutcome\('manual'\)/.test(
    gateSource,
  ),
);
ok(
  'iOS checklist completion durably finishes onboarding before opening the selected first view',
  gateSource.includes('/ios-setup?fromOnboarding=1') &&
    /completeIosMessageOnboardingAttempt\(\{[\s\S]*?ensureDurable,[\s\S]*?type: 'onboarding-finished'[\s\S]*?onboardingLandingPath\(onboardingFocus\)/.test(iosSource) &&
    /setOnboardingProfile\(\{[\s\S]*?stage: 'complete'/.test(iosSource),
);
ok(
  'manual exit durably opts out while automated completion still requires both outcomes',
  /const continueManually = async \(\) => \{[\s\S]*?await setCaptureOptOut\(true\)[\s\S]*?setCompletionOutcome\('manual'\)[\s\S]*?setStep\('complete'\)/.test(gateSource) &&
    /const continueWithoutAutomaticCapture = useCallback/.test(iosSource) &&
    /await setCaptureOptOut\(true\)[\s\S]*?type: 'manual-only'[\s\S]*?completeIosMessageOnboardingAttempt/.test(iosSource) &&
    /if \(!setupComplete\) return/.test(iosSource) &&
    /progress\.historyStatus === 'complete'/.test(iosSource) &&
    !/skipIncomplete|const finishLater/.test(iosSource),
);
ok(
  'iOS checklist keeps automatic history handoff separate from the explicit manual opt-out',
  /const historyInstallUrl = historyShortcutInstallUrl\(\)/.test(iosSource) &&
    /await confirmIosHistoryShortcutInstalled\(\)/.test(iosSource) &&
    /await beginIosHistoryHandoffForOrigin\(historyReturnOrigin, startedAt\)/.test(iosSource) &&
    /Linking\.openURL\(newHandoff \? historyShortcutRunUrl\(\) : historyShortcutContinueUrl\(\)\)/.test(iosSource) &&
    /const continueWithoutAutomaticCapture = useCallback/.test(iosSource) &&
    /await setCaptureOptOut\(true\)[\s\S]*?type: 'manual-only'/.test(iosSource),
);
ok(
  'first run cannot silently pin a worldwide user to the AED sample ledger',
  !gateSource.includes('loadDemoData') && !gateSource.includes("t('startWithSample')"),
);

/* ── the first-launch states these screens are actually in ────────────
 *
 * Everything below is about the first ten minutes of the app's life, which is
 * why it lives in the onboarding suite: a phone that has imported one message,
 * a paste the parser cannot read, and a relay that will not answer. None of
 * these are exotic — they are the ordinary state of a new install. */

const { parseSmsBatch } = require('./build/sms-parser');
const { buildImportPlan } = require('./build/import-plan');
const { netWorthBreakdown, netWorthFils, reliableBalanceFils } = require('./build/balances');

const walletSource = fs.readFileSync(
  path.join(__dirname, '../../src/app/(tabs)/wallet.tsx'),
  'utf8',
);
const walletOverviewSource = fs.readFileSync(
  path.join(__dirname, '../../src/components/wallet/balance-overview.tsx'),
  'utf8',
);
const walletPresentationSource = `${walletSource}\n${walletOverviewSource}`;
const importSource = fs.readFileSync(path.join(__dirname, '../../src/app/import-sms.tsx'), 'utf8');

ok('Android ignores forged iOS history deep-link parameters',
  /history:\s*historyParam/.test(importSource) &&
    /const history = Platform\.OS === 'ios' \? historyParam : undefined/.test(importSource));

ok('the tab-shell history owner records parser completion in the final page write',
  /parserRereadComplete: page\.inboxHistoryComplete/.test(
    fs.readFileSync(path.join(__dirname, '../../src/hooks/use-history-import.ts'), 'utf8'),
  ));
ok('a completed Settings history scan records the migration even when nothing changed',
  /inboxHistoryComplete[\s\S]*?p\.batch\.parserRereadComplete = true[\s\S]*?await importBatch\(p\.batch\)\.durable/.test(
    importSource,
  ));
ok('Settings rebuilds a completed Android scan against the latest ledger before confirmation',
  /pendingInboxResult[\s\S]*?buildImportPlan\([\s\S]*?pendingInboxResult\.parsed,[\s\S]*?state,[\s\S]*?pendingInboxResult\.newestTs,[\s\S]*?pendingInboxResult\.declined/.test(
    importSource,
  ) &&
    /currentPlan\.batch\.parserRereadComplete = true/.test(importSource));

const emptyLedger = {
  hydrated: true,
  accounts: [],
  transactions: [],
  bills: [],
  goals: [],
  budgets: [],
  merchantOverrides: {},
};

i18n.setLanguage('en');
eq('balance-coverage copy resolves every placeholder',
  i18n.tf('balanceCoverage', { known: 2, total: 4 }),
  'Balances recorded for 2 of 4 active accounts');

/* Net worth: a sum of nothing is not an answer.
 *
 * One purchase alert is the whole of what a new install knows. It creates the
 * card, and the card has no bank-quoted balance — so the only account on the
 * phone is unknowable and the sum over it is 0. Wallet used to print that 0 in
 * display type under "Net worth", above a row saying "no balance SMS yet". */
{
  const parsed = parseSmsBatch(
    'Your Credit Card ending 4455 was used for AED 320.00 at TALABAT on 05/08/2026.',
    {},
  );
  const plan = buildImportPlan(parsed, emptyLedger, 0);
  const accounts = plan.batch.newAccounts.map((account, i) => ({ ...account, id: `acc${i}` }));
  const transactions = plan.batch.transactions.map((tx, i) => ({
    ...tx,
    id: `tx${i}`,
    accountId: 'acc0',
    source: 'sms',
  }));
  const state = { accounts, transactions };

  eq('one purchase alert creates a card with no balance to stand behind',
    accounts.map((account) => reliableBalanceFils(state, account)), [null]);
  eq('so the net-worth sum over it is zero, which is not the same as zero money',
    netWorthFils(state), 0);

  const breakdown = netWorthBreakdown(state);
  eq('the auditable projection reports that missing coverage explicitly',
    [breakdown.knownAccountCount, breakdown.unknownAccountCount], [0, 1]);

  // Wallet consumes the auditable balance projection without presenting its
  // incomplete subtraction as net worth.
  ok('Wallet uses the shared balance breakdown rather than rebuilding it in UI',
    /netWorthBreakdown\(state\)/.test(walletSource) &&
      /balances\.balanceByAccountId/.test(walletSource));
  ok('Wallet prints a dash, not AED 0, when nothing is knowable',
    /p\.knownBalanceCount > 0\s*\? formatAmount\(p\.balanceFils\) : '—'/.test(
      walletOverviewSource,
    ));
  ok('Wallet replaces net worth with a focused recorded-balances summary',
    /availableBalances/.test(walletPresentationSource) &&
      /balanceCoverage/.test(walletPresentationSource) &&
      !/paidFromAccounts/.test(walletPresentationSource) &&
      !/cashOutBreakdown/.test(walletPresentationSource) &&
      !/estimatedNetWorth/.test(walletPresentationSource));
}

/* A paste the parser cannot read.
 *
 * An OTP is the message people paste by mistake most often. It parses to
 * nothing, and the plan built from nothing is all zeros — which the screen
 * rendered as "0 matched · 0 cards · 0 unread" with no preview, no button, no
 * explanation, and with the relay/email/PDF alternatives hidden, because that
 * block is gated on there being no plan. */
{
  const parsed = parseSmsBatch('Your OTP is 445566 for your transaction. Do not share with anyone.', {});
  eq('an OTP parses to nothing', parsed, []);
  const plan = buildImportPlan(parsed, emptyLedger, 0);
  eq('and the plan built from nothing is all zeros',
    [plan.txCount, plan.dueCount, plan.billDues.length, plan.healedCount], [0, 0, 0, 0]);

  const emptyBranch = importSource.indexOf(
    'if (p.txCount === 0 && p.dueCount === 0 && p.billDues.length === 0 && p.healedCount === 0)',
    importSource.indexOf('const runParse'),
  );
  ok('the paste path has an empty-result branch of its own', emptyBranch > 0);
  ok('an empty result clears the plan rather than rendering three zeros',
    importSource.indexOf('setPlan(null)', emptyBranch) > emptyBranch);
  ok('and distinguishes "already filed" from "we cannot read this"',
    /kind: 'filed', count: skipped/.test(importSource) &&
      /kind: 'unreadable', count: messageBlocks\(input\)/.test(importSource));
  // The alternative routes stay gated on `plan === null`, which is exactly why
  // clearing the plan is the fix: they come back at the moment they are needed.
  ok('the alternate import routes are visible on an unreadable paste',
    /\{!history && !scanning && plan === null && \(/.test(importSource) &&
      /<SupplementImports \/>/.test(importSource));
}

/* Native failures stay source-free and translated. A thrown storage or
 * Linking exception must never become user-facing text. */
{
  ok('iOS setup never renders a native or Linking exception message',
    !/\b(?:e|err|error)\.message\b/.test(iosSource) &&
      !/\b(?:e|err|error)\.message\b/.test(iosControllerSource));
  ok('it maps each bounded controller failure to translated copy instead',
    /case 'shortcut-install':/.test(iosSource) &&
      /case 'shortcut-run':/.test(iosSource) &&
      /case 'shortcuts-missing':/.test(iosSource) &&
      /case 'load':/.test(iosSource));
  ok('and the failure block is announced without source data',
    /accessibilityLiveRegion="polite"/.test(iosSource) &&
      /AccessibilityInfo\.announceForAccessibility/.test(iosSource));
}

try {
  require('child_process').execFileSync(process.execPath,
    [path.join(__dirname, 'onboarding-resume.helpers.js')], { stdio: 'inherit' });
  ok('shipping resume effect preserves cold-launch, return, retry and erase behavior', true);
} catch {
  ok('shipping resume effect preserves cold-launch, return, retry and erase behavior', false);
}

console.log(`\nonboarding: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
