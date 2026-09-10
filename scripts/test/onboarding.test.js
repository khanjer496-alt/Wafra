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
const i18nSource = fs.readFileSync(path.join(__dirname, '../../src/lib/i18n.ts'), 'utf8');
const iosSource = fs.readFileSync(path.join(__dirname, '../../src/app/ios-setup.tsx'), 'utf8');
const iosControllerSource = fs.readFileSync(
  path.join(__dirname, '../../src/lib/ios-capture-setup.ts'),
  'utf8',
);
const moneyPreviewSource = fs.readFileSync(
  path.join(__dirname, '../../src/components/onboarding/money-preview.tsx'),
  'utf8',
);

ok(
  'value-first onboarding precedes optional planning without forcing a country',
  gateSource.includes("const JOURNEY_STEPS: readonly Step[] = ['focus', 'tracking', 'preview', 'privacy']") &&
    gateSource.includes("const PLAN_STEPS: readonly Step[] = ['goals', 'budget']") &&
    gateSource.includes('FOCUS_PRESETS.map') &&
    gateSource.includes('TRACKING_PRESETS.map') &&
    gateSource.includes('setOnboardingPlan(plan)') &&
    !gateSource.includes('setMarket(plan.answers.marketId)') &&
    !gateSource.includes('plan.budgets.forEach(upsertBudget)') &&
    !gateSource.includes('plan.goals.forEach(addGoal)'),
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
  'welcome embeds an explicitly labeled interactive example without ledger or setup writes',
  /<MoneyPreview reducedMotion=\{reducedMotion\}/.test(gateSource) &&
    /onboardSampleMessage/.test(moneyPreviewSource) &&
    /onboardSampleNote/.test(moneyPreviewSource) &&
    /setRevealed/.test(moneyPreviewSource) &&
    /activeStep === 'welcome'[\s\S]*?<MoneyPreview reducedMotion=\{reducedMotion\}[\s\S]*?onboardChooseStart/.test(gateSource) &&
    !/exampleVisible|SetupIllustration/.test(gateSource) &&
    !/useStore|importBatch|addTransaction|setOnboarded|setCaptureOptOut|loadDemoData/.test(moneyPreviewSource) &&
    !/function points\(/.test(gateSource),
);
ok(
  'capture choice is presented as two explicit accessible start modes',
  /<StartOption automatic disabled=\{setupBusy\} onPress=\{\(\) => void runSetupAction\(beginCapture\)\}/.test(gateSource) &&
    /<StartOption automatic=\{false\} disabled=\{setupBusy\} onPress=\{\(\) => void runSetupAction\(continueManually\)\}/.test(gateSource) &&
    /accessibilityRole="button"/.test(gateSource) &&
    /onboardAutomaticChoice/.test(gateSource) &&
    /onboardManualChoice/.test(gateSource),
);
ok(
  'web preview offers manual tracking without a nonfunctional automatic choice',
  /Platform\.OS !== 'web' && \([\s\S]{0,180}<StartOption automatic disabled=/.test(gateSource) &&
    /<StartOption automatic=\{false\} disabled=\{setupBusy\} onPress=\{\(\) => void runSetupAction\(continueManually\)\}/.test(gateSource) &&
    /Platform\.OS === 'web' \? 'onboardManualChoiceWebBody'/.test(gateSource),
);
ok(
  'capture options are equally weighted and notification beta setup remains outside first run',
  !/styles\.startOptionFeatured|recommendedPill|t\('recommended'\)/.test(gateSource) &&
    !/NotificationReader|alsoReadNotifs|notifNoteOnboard/.test(gateSource),
);
ok(
  'first-run gate exempts guided history routes only on iOS',
  /const isIosSetupRoute\s*=\s*Platform\.OS === 'ios'[\s\S]{0,180}pathname === '\/ios-setup'[\s\S]{0,100}pathname === '\/import-sms'/.test(gateSource) &&
    /const showOverlay\s*=[\s\S]{0,220}!isIosSetupRoute/.test(gateSource),
);
eq('iOS onboarding uses the compact bank-alert heading', i18n.t('onboardCaptureTitleIos', 'en'), 'Start your way');
eq('iOS onboarding explains that the capture choice can change', i18n.t('onboardCaptureBodyIos', 'en'), 'Choose what works for you. You can change this later.');
eq('iOS automatic choice names local setup and permits later history', i18n.t('onboardAutomaticChoiceIosBody', 'en'), 'Set up local bank alerts. Past messages can wait.');
eq('iOS automatic action names Apple Shortcuts rather than direct inbox access', i18n.t('onboardAutomaticChoiceIos', 'en'), 'Set up Apple Shortcuts');
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
  'iOS onboarding has exactly two choices and puts full details behind Learn more',
  (gateSource.match(/<StartOption/g) ?? []).length === 2 &&
    /Platform\.OS === 'ios' \? 'onboardAutomaticChoiceIos'/.test(gateSource) &&
    /Platform\.OS === 'ios' \? 'onboardManualChoiceIos'/.test(gateSource) &&
    /Platform\.OS === 'ios' \? 'onboardManualChoiceIosBody'/.test(gateSource) &&
    /<BottomSheet[\s\S]*?visible=\{learnMoreVisible\}[\s\S]*?onboardCaptureLearnMoreTitle/.test(gateSource) &&
    /onboardCaptureLearnMoreAction/.test(gateSource) &&
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
  'onboarding uses real scan and import results rather than fake personalization delays',
  /progress\.scanned/.test(gateSource) &&
    /progress\.found/.test(gateSource) &&
    /discoveredResult\.tx/.test(gateSource) &&
    /discoveredResult\.accounts/.test(gateSource) &&
    /discoveredResult\.bills/.test(gateSource) &&
    /state\.transactions\.length/.test(gateSource) &&
    /state\.bills\.length \+ state\.cardDues\.length/.test(gateSource) &&
    !/setTimeout/i.test(gateSource),
);
ok(
  'first run waits for encrypted hydration and separates value-funnel progress from optional planning',
  /if \(!state\.hydrated\s*\|\|/.test(gateSource) &&
    /resumeReady/.test(gateSource) &&
    /loadingLedger/.test(gateSource) &&
    /onboardStepOf|progressbar/.test(gateSource) &&
    /JOURNEY_STEPS\.includes\(activeStep\)/.test(gateSource) &&
    /PLAN_STEPS\.includes\(activeStep\)/.test(gateSource) &&
    /progressSteps=\{personalizing/.test(gateSource),
);
ok(
  'value is shown before privacy and capture, and Pro appears only after real activity exists',
  /activeStep === 'focus'[\s\S]*?activeStep === 'tracking'[\s\S]*?activeStep === 'preview'[\s\S]*?activeStep === 'privacy'[\s\S]*?activeStep === 'capture'/.test(gateSource) &&
    /discoveredResult && discoveredResult\.tx > 0[\s\S]*?onboardProPreviewAction/.test(gateSource) &&
    /GROWTH_PLACEMENTS\.postImportPro/.test(gateSource),
);
ok(
  'tracking choice changes the value explanation instead of collecting a dead survey answer',
  /const trackingOutcomeKey: StringKey = tracking === 'none'/.test(gateSource) &&
    /tracking === 'bank-apps'/.test(gateSource) &&
    /tracking === 'spreadsheet'/.test(gateSource) &&
    /tracking === 'finance-app'/.test(gateSource) &&
    /\{t\(trackingOutcomeKey\)\}/.test(gateSource),
);
ok(
  'Android automatic completion records the automatic outcome synchronously',
  /await openWafra\(false, undefined, 'automatic'\)/.test(gateSource) &&
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
  /const showOverlay\s*=[\s\S]{0,220}\(!state\.onboarded \|\| finishing\)/.test(gateSource) &&
    /const openWafra = async[\s\S]*?setFinishing\(true\)[\s\S]*?await ensureDurable\(\)[\s\S]*?setFinishing\(false\)[\s\S]*?catch[\s\S]*?setFinishSaveFailed\(true\)/.test(gateSource) &&
    /finishSaveFailed \? <Button[\s\S]{0,220}openWafra\(requestedFirstEntry\.current\)/.test(gateSource),
);
ok(
  'completion copy matches automatic, manual, denied, and failed outcomes',
  /type CompletionOutcome = 'automatic' \| 'manual' \| 'denied' \| 'failed'/.test(gateSource) &&
    /setCompletionOutcome\('denied'\)/.test(gateSource) &&
    /setCompletionOutcome\('failed'\)/.test(gateSource) &&
    /onboardCompleteManualBody/.test(gateSource) &&
    /onboardCompleteNeedsAttentionBody/.test(gateSource),
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
  'Android opens Home after durable setup instead of blocking on inbox parsing',
  /const startScan = async \(\) => \{[\s\S]*?await beginHistoryImport\(\)[\s\S]*?await openWafra\(false, undefined, 'automatic'\)/.test(gateSource) &&
    !/const startScan = async \(\) => \{[\s\S]*?await scanInbox/.test(gateSource),
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
  'manual exit remains gate-owned while automated setup requires both outcomes',
  /const continueManually = async \(\) => \{[\s\S]*?await setCaptureOptOut\(true\)[\s\S]*?setCompletionOutcome\('manual'\)[\s\S]*?setStep\('complete'\)/.test(gateSource) &&
    /if \(!setupComplete\) return/.test(iosSource) &&
    /progress\.historyStatus === 'complete'/.test(iosSource) &&
    !/skipIncomplete|const finishLater/.test(iosSource) &&
    !iosSource.includes("type: 'manual-only'"),
);
ok(
  'iOS checklist embeds history handoff without opting out of capture',
  /const historyInstallUrl = historyShortcutInstallUrl\(\)/.test(iosSource) &&
    /await confirmIosHistoryShortcutInstalled\(\)/.test(iosSource) &&
    /await beginIosHistoryHandoffForOrigin\(historyReturnOrigin, startedAt\)/.test(iosSource) &&
    /Linking\.openURL\(newHandoff \? historyShortcutRunUrl\(\) : 'shortcuts:\/\/'\)/.test(iosSource) &&
    !iosSource.includes('setCaptureOptOut(true)'),
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
  ok('Wallet replaces net worth with balances, card dues and paid-from-account facts',
    /availableBalances/.test(walletPresentationSource) &&
      /balanceCoverage/.test(walletPresentationSource) &&
      /paidFromAccounts/.test(walletPresentationSource) &&
      /cashOutBreakdown/.test(walletPresentationSource) &&
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
