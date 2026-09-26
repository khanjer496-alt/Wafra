const fs = require('fs');
const path = require('path');
const onboarding = require('./build/onboarding');
const i18n = require('./build/i18n');
const growth = require('./build/growth-funnel');
const backupValidation = require('./build/backup-validation');
const bankExamples = require('./build/onboarding-bank-examples');
const markets = require('./build/markets');

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
  // The alert-delivery answer is optional: every ledger onboarded before the
  // step existed restores without it, and must keep restoring without it.
  eq('backup validation still accepts a profile with no alert-delivery answer',
    backupValidation.isValidBackupState(profileState), true);
  // iPhone statement-step marker: optional boolean, so a relaunch resumes at live capture.
  eq('backup validation accepts the iPhone statement-step marker',
    backupValidation.isValidBackupState({ ...profileState,
      onboardingProfile: { ...profileState.onboardingProfile, stage: 'capture', statementStepDone: true } }), true);
  eq('backup validation rejects a malformed statement-step marker',
    backupValidation.isValidBackupState({ ...profileState,
      onboardingProfile: { ...profileState.onboardingProfile, statementStepDone: 'yes' } }), false);
  for (const alerts of ['sms', 'notifications', 'neither', 'unsure', null]) {
    eq(`backup validation accepts the alert-delivery answer (${alerts})`,
      backupValidation.isValidBackupState({ ...profileState,
        onboardingProfile: { ...profileState.onboardingProfile, alerts } }), true);
  }
  eq('backup validation rejects an unknown alert-delivery answer',
    backupValidation.isValidBackupState({ ...profileState,
      onboardingProfile: { ...profileState.onboardingProfile, alerts: 'whatsapp' } }), false);
  eq('backup validation accepts the alert-delivery stage',
    backupValidation.isValidBackupState({ ...profileState,
      onboardingProfile: { ...profileState.onboardingProfile, stage: 'alerts' } }), true);
  // The confirmed country is optional and tolerant: a ledger written by a build
  // that illustrates more countries has to restore on this one too.
  for (const country of ['AE', 'GB', 'ZZ', 'PK', null]) {
    eq(`backup validation accepts a confirmed onboarding country (${country})`,
      backupValidation.isValidBackupState({ ...profileState,
        onboardingProfile: { ...profileState.onboardingProfile, country } }), true);
  }
  for (const country of ['gb', 'GBR', 'G1', '', 7]) {
    eq(`backup validation rejects a malformed onboarding country (${JSON.stringify(country)})`,
      backupValidation.isValidBackupState({ ...profileState,
        onboardingProfile: { ...profileState.onboardingProfile, country } }), false);
  }
}

/* The country a person confirms outranks the phone, and outranks it everywhere
 * — the whole complaint was a UAE resident being shown British banks because
 * his store account was British. It is the ledger's country (date order, and
 * the parser pack for a ledger without AED/SAR money), but it never widens the
 * set of launch-tested parser packs and never pins a currency. */
{
  const region = bankExamples.onboardingBankRegion;
  const gb = region('AE', 'GB');
  const ae = region('AE', 'AE');
  eq('a confirmed country wins over the launch market fallback', gb?.id, 'GB');
  ok('and brings that country\'s own banks with it',
    gb?.banks?.some((bank) => /HSBC/i.test(bank.name)) === true);
  eq('confirming the market you are already in stays on it', ae?.id, 'AE');
  eq('a country Wafra cannot illustrate stays neutral rather than guessing',
    region('AE', 'ZZ'), null);
  eq('and so does an explicit somewhere-else',
    region('AE', bankExamples.ONBOARDING_REGION_ELSEWHERE), null);

  // Display only: the parser's market pack is a closed set of two, and nothing
  // the picker can return may widen it.
  ok('no confirmable country can select a parser market beyond the two tested ones',
    bankExamples.ONBOARDING_REGION_IDS
      .filter((id) => markets.canSelectMarket(id))
      .join(',') === 'AE,SA');
  ok('and somewhere-else selects only the neutral pack, which has no Gulf banks',
    markets.canSelectMarket(bankExamples.ONBOARDING_REGION_ELSEWHERE) &&
      markets.MARKETS.map((market) => market.id).join(',') === 'AE,SA');

  eq('a stored country is normalized to an ISO region code',
    bankExamples.normalizeOnboardingCountry(' gb '), 'GB');
  for (const bad of ['GBR', 'g', '', null, undefined, 12, {}]) {
    eq(`a malformed stored country is dropped rather than drawn (${JSON.stringify(bad)})`,
      bankExamples.normalizeOnboardingCountry(bad), null);
  }

  ok('every pickable country has a flag and a name in both languages',
    [...bankExamples.ONBOARDING_REGION_IDS, bankExamples.ONBOARDING_REGION_ELSEWHERE]
      .every((id) => {
        const entry = bankExamples.ONBOARDING_REGION_LABELS[id];
        return !!entry?.flag && ['en', 'ar'].every((lang) =>
          i18n.t(entry.labelKey, lang) && i18n.t(entry.labelKey, lang) !== entry.labelKey);
      }));
  ok('every illustrable country can actually be picked',
    ['AE', 'SA', 'US', 'GB', 'FR', 'DE', 'ES', 'IT', 'NL', 'IN', 'QA', 'KW', 'BH', 'OM', 'EG', 'JO']
      .every((id) => bankExamples.ONBOARDING_REGION_IDS.includes(id)));
  ok('the country sheet says what it changes (dates, examples), not a promise about what Wafra can read',
    /dates/i.test(i18n.t('onboardCountrySheetBody', 'en')) &&
      /example banks/i.test(i18n.t('onboardCountrySheetBody', 'en')) &&
      /come from your alerts/i.test(i18n.t('onboardCountrySheetBody', 'en')));
}

/* Which answers owe the user a statement.
 *
 * The rule exists because only an SMS inbox is an archive. A notification is
 * gone the moment it is dismissed, so "notifications" means Wafra can follow
 * the future and not the past — exactly the case this tester hit with a bank
 * that never texted him. An ABSENT answer is not a gap: that is every ledger
 * onboarded before the question existed, and those already have their history. */
{
  const gap = onboarding.onboardingHistoryGap;
  eq('a texting bank needs no statement', gap('sms'), false);
  eq('a notification-only bank cannot reach the past', gap('notifications'), true);
  eq('a bank that does neither cannot either', gap('neither'), true);
  eq('an unsure answer is offered the import rather than guessed at', gap('unsure'), true);
  eq('an unanswered question is not a gap', gap(null), false);
  eq('and neither is a profile saved before the step existed', gap(undefined), false);

  /* The answer has to be giveable AFTER setup, because the person it was
   * written for finished setup before the question existed. A ledger with no
   * profile at all is the normal case there, not an edge one. */
  const withAlerts = onboarding.onboardingProfileWithAlerts;
  const fresh = withAlerts(null, 'notifications', 1234);
  eq('a ledger that never had a profile still records the answer', fresh.alerts, 'notifications');
  eq('and is stamped complete, never sent back through the questionnaire', fresh.stage, 'complete');
  eq('with a clock rather than a missing one', fresh.startedAt, 1234);
  ok('and stays a valid persisted profile',
    backupValidation.isValidBackupState({ transactions: [], onboardingProfile: fresh }));

  const existing = { v: 1, stage: 'complete', focus: 'bills', tracking: 'bank-apps',
    intention: 'stay-ahead', country: 'AE', startedAt: 99 };
  const updated = withAlerts(existing, 'neither', 5678);
  eq('answering later changes the answer and nothing else',
    updated, { ...existing, alerts: 'neither' });
  eq('and never rewrites the original start clock', updated.startedAt, 99);
  eq('re-answering replaces rather than stacks',
    withAlerts(updated, 'sms').alerts, 'sms');

  /* A bank that sends nothing is not covered "from now on" either. Drawing or
   * promising future capture there is the same false reassurance this question
   * exists to remove, and AGENTS.md forbids claiming coverage we do not have. */
  const noCapture = onboarding.onboardingNoAutomaticCapture;
  eq('a bank that sends nothing has no automatic input at all', noCapture('neither'), true);
  for (const answer of ['sms', 'notifications', 'unsure', null, undefined]) {
    eq(`every other answer names a channel Wafra can follow (${answer})`, noCapture(answer), false);
  }
  ok('and the copy for that case promises no automatic future capture',
    !/catch everything from here|on its own/i.test(i18n.t('onboardHistoryGapManualBody', 'en')) &&
      /sends nothing/i.test(i18n.t('onboardHistoryGapManualBody', 'en')));
  ok('every string that case needs is translated in both languages',
    ['onboardHistoryGapManualTitle', 'onboardHistoryGapManualBody', 'onboardAlertsReachManual',
      'statementImportNoCaptureDetail']
      .every((key) => ['en', 'ar'].every((lang) => i18n.t(key, lang) && i18n.t(key, lang) !== key)));

  /* Rebuilding the profile field by field is what erased these answers the
   * moment an iPhone finished setup, because the reducer replaces the whole
   * object. The stage helper must carry through anything it does not name. */
  const atStage = onboarding.onboardingProfileAtStage;
  const full = { v: 1, stage: 'capture', focus: 'bills', tracking: 'bank-apps',
    intention: 'stay-ahead', alerts: 'notifications', country: 'AE', startedAt: 7 };
  eq('completing setup keeps every answer and only moves the stage',
    atStage(full, 'complete', 99), { ...full, stage: 'complete' });
  eq('including a field this build does not name',
    atStage({ ...full, somethingNewer: 1 }, 'complete', 99).somethingNewer, 1);
  eq('and a ledger with no profile still gets a usable one', atStage(null, 'complete', 42).startedAt, 42);
  ok('which is still a valid persisted profile',
    backupValidation.isValidBackupState({ transactions: [], onboardingProfile: atStage(full, 'complete', 99) }));

  const prefersNotifications = onboarding.onboardingPrefersNotificationCapture;
  eq('capture setup leads with notifications only when that is the answer',
    prefersNotifications('notifications'), true);
  eq('a texting bank keeps the SMS-first capture recommendation',
    prefersNotifications('sms'), false);
  eq('an unanswered question changes no capture default', prefersNotifications(null), false);

  eq('every alert-delivery answer has exactly one preset',
    onboarding.ALERT_DELIVERY_PRESETS.map((preset) => preset.id),
    ['sms', 'notifications', 'neither', 'unsure']);
  ok('every alert-delivery preset is translated in both languages',
    onboarding.ALERT_DELIVERY_PRESETS.every((preset) =>
      ['en', 'ar'].every((lang) =>
        i18n.t(preset.titleKey, lang) && i18n.t(preset.detailKey, lang) &&
        i18n.t(preset.titleKey, lang) !== preset.titleKey &&
        i18n.t(preset.detailKey, lang) !== preset.detailKey)));
}

/* The question is about delivery, never about which bank. Onboarding copy that
 * named a provider would be a partnership claim Wafra has not made. */
{
  const alertCopy = ['onboardAlertsTitle', 'onboardAlertsBody', 'onboardHistoryGapTitle',
    'onboardHistoryGapBody', 'onboardHistoryGapAction']
    .flatMap((key) => ['en', 'ar'].map((lang) => i18n.t(key, lang)));
  ok('the alert question and statement offer name no bank',
    alertCopy.every((line) => !/HSBC|Emirates NBD|FAB|ADCB|Liv|Barclays|Lloyds/i.test(line)));
  ok('the statement offer promises future capture without promising past capture',
    /catch everything from here/i.test(i18n.t('onboardHistoryGapBody', 'en')) &&
      /import a statement/i.test(i18n.t('onboardHistoryGapBody', 'en')));
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
// Design language E (2026-09-26): the steps are their own modules; the gate
// keeps every action, the resume, the overlay and the capture machinery.
const stepSource = (name) => fs.readFileSync(
  path.join(__dirname, `../../src/components/onboarding/${name}.tsx`),
  'utf8',
);
const eLibSource = fs.readFileSync(path.join(__dirname, '../../src/lib/onboarding-e.ts'), 'utf8');
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

// 2026-09-26, design language E: five numbered steps (name, goals, watch,
// reminders, first payment), then the pattern and the paywall. The old
// money-plan wizard (PLAN_STEPS, budget presets) stays gone; the goals here
// are `wafraGoals`, which hold no money, and a watched limit is only what the
// person dialled.
ok(
  'first-run personalization is one integrated journey without the optional goals/budget wizard',
  /case 'name':[\s\S]{0,40}<NameStep[\s\S]*case 'goals':[\s\S]{0,40}<GoalsStep[\s\S]*case 'watch':[\s\S]{0,40}<WatchStep[\s\S]*case 'reminders':[\s\S]{0,40}<RemindersStep[\s\S]*case 'capture':\s*case 'live':[\s\S]*case 'pattern':[\s\S]{0,40}<PatternStep[\s\S]*case 'paywall':[\s\S]{0,40}<PaywallStep/.test(gateSource) &&
    /export const ONBOARDING_E_TOTAL_STEPS = 5;/.test(eLibSource) &&
    !gateSource.includes('PLAN_STEPS') &&
    !gateSource.includes("activeStep === 'budget'") &&
    !gateSource.includes('onboardPersonalizeOptional') &&
    !gateSource.includes('setOnboardingPlan') &&
    /setGoals\(goalsDraft\)/.test(gateSource),
);
/* The statement offer has to follow the answer, and has to stay out of the way
 * of the two screens that are already recovery surfaces. Stacking it on top of
 * a failed setup or a refused SMS permission reads as the app giving up. */
ok(
  'the completion statement offer follows the alert answer and yields to recovery states',
  /const showHistoryGapOffer = activeStep === 'complete' &&[\s\S]{0,400}onboardingHistoryGap\(selectedAlerts\)/.test(gateSource) &&
    /onboardingHistoryGap\(selectedAlerts\) &&\s*!failedCompletion &&\s*!finishSaveFailed &&\s*!smsDenied/.test(gateSource) &&
    /\{showHistoryGapOffer \? <View/.test(gateSource) &&
    // The offer opens the in-onboarding importer and keeps the result stage,
    // so the person comes back to their result, the pattern and the paywall.
    /onboarding_history_gap_import_opened[\s\S]{0,260}openStatementImport\(\);/.test(gateSource) &&
    /const fromResult = activeStep === 'complete';[\s\S]{0,120}saveJourney\(fromResult \? 'complete' : 'capture'\)/.test(gateSource),
);
ok(
  'each Back step returns to the step before it and saves that stage',
  /activeStep === 'live' \|\| activeStep === 'capture'\) \{\s*setStep\('reminders'\);\s*saveJourney\('alerts'\);/.test(gateSource) &&
    /activeStep === 'reminders'\) \{\s*setStep\('watch'\);\s*saveJourney\('tracking'\);/.test(gateSource) &&
    /activeStep === 'watch'\) \{\s*setStep\('goals'\);\s*saveJourney\('focus'\);/.test(gateSource) &&
    /activeStep === 'goals'\) \{\s*setStep\('name'\);\s*saveJourney\('welcome'\);/.test(gateSource),
);
ok(
  'the alert answer is durable, so an interrupted setup resumes with it',
  /setAlerts\(state\.onboardingProfile\.alerts \?\? null\)/.test(gateSource) &&
    /alerts: alertsRef\.current \?\? alerts \?\? current\?\.alerts \?\? null,/.test(gateSource) &&
    /const selectedAlerts = alerts \?\? state\.onboardingProfile\?\.alerts \?\? null/.test(gateSource),
);
/* iOS has no completion screen in the gate — setup exits straight into the
 * app — so the statement offer Android shows there had nowhere to appear, and
 * the profile was being rebuilt without the new answers on the way out. */
ok(
  'finishing iPhone setup preserves the answers instead of rebuilding the profile',
  /onboardingProfileAtStage\(state\.onboardingProfile, 'complete', Date\.now\(\)\)/.test(iosSource) &&
    !/stage: 'complete',\s*\n\s*focus: onboardingFocus/.test(iosSource),
);
// 2026-09-25: iPhone setup offers statements BEFORE live capture, so finishing
// setup exits into the chosen view instead of repeating the statement offer.
ok(
  'and exits into the chosen view, because statements were already offered first',
  /const finishDestination = useCallback\(\s*\(\) => onboardingLandingPath\(state\.onboardingProfile\?\.focus \?\? null\)/
    .test(iosSource) &&
    !/\/statement-import' as const/.test(iosSource) &&
    /exitToRoot\(finishDestination\(\)\)/.test(iosSource) &&
    // Design language E: statements sit beside live capture on step 5.
    /icon="upload" title=\{words\.importStatements\}[\s\S]{0,160}onPress=\{openStatementImport\}/.test(gateSource),
);
// iPhone setup finishes onboarding itself. The gate that launched it shows
// the result, the pattern and the paywall once over Home, writing nothing.
ok(
  'after iPhone setup finishes, the reveal and paywall show once without a second completion',
  /iosSetupLaunched\.current = true;[\s\S]{0,200}router\.push\('\/ios-setup\?fromOnboarding=1'\)/.test(gateSource) &&
    /if \(!state\.onboarded \|\| !iosSetupLaunched\.current \|\| previewMode\) return;[\s\S]{0,120}iosSetupLaunched\.current = false;[\s\S]{0,200}setRevealAfterSetup\(true\)/.test(gateSource) &&
    /const finishJourney = \(\) => \{\s*if \(revealAfterSetup\) \{\s*setRevealAfterSetup\(false\);\s*setHandoff\(patternInputFromState\(state\)\);\s*return;\s*\}/.test(gateSource) &&
    /const openWafra = async[\s\S]{0,300}iosSetupLaunched\.current = false;/.test(gateSource) &&
    /const continueManually = async \(\) => \{[\s\S]{0,120}iosSetupLaunched\.current = false;/.test(gateSource),
);

/* Settings is where an already-onboarded user finds this, so the question and
 * the fix it points at have to sit together — and the statement row has to say
 * WHY it is being suggested, or it reads as an unexplained upsell. */
ok(
  'Settings can answer the alert question after setup, beside the statement it points at',
  /settingsAlertDeliveryTitle/.test(settingsSource) &&
    /setPreferenceSheet\('alerts'\)/.test(settingsSource) &&
    /onboardingProfileWithAlerts\(state\.onboardingProfile, next, Date\.now\(\)\)/.test(settingsSource) &&
    /onboardingHistoryGap\(alertsAnswer\)\s*\?\s*t\('statementImportGapDetail'\)/.test(settingsSource),
);
ok(
  'the after-setup sheet keeps the question out of the caps header',
  /title=\{t\('settingsAlertDeliveryHeader'\)\}/.test(settingsSource) &&
    /question=\{t\('onboardAlertsTitle'\)\}/.test(settingsSource),
);
ok(
  'and every string it adds is translated in both languages',
  ['settingsAlertDeliveryHeader', 'settingsAlertDeliveryTitle', 'settingsAlertDeliveryUnset',
    'statementImportGapDetail']
    .every((key) => ['en', 'ar'].every((lang) => i18n.t(key, lang) && i18n.t(key, lang) !== key)),
);
ok(
  'Settings has its own country control (it sets date order after setup), not the onboarding one',
  /settingsCountryTitle/.test(settingsSource) &&
    !/onboardCountrySheetTitle|OnboardingCountryConfirm/.test(settingsSource),
);
// Design language E: the country and the ledger currency are two compact
// confirm rows on the Name step — the device's guess until corrected, each
// "Change" opening the existing sheet. Never one merged control.
ok(
  'the country and the currency are confirmed on the Name step as two separate rows',
  /country=\{shownCountry\} suggestedCountry=\{deviceRegion\} onCountry=\{chooseCountry\}/.test(gateSource) &&
    /currency=\{shownCurrency\} onCurrency=\{chooseCurrency\}/.test(gateSource) &&
    /testID="onboarding-country-confirm"/.test(stepSource('e-name')) &&
    /testID="onboarding-currency-confirm"/.test(stepSource('e-name')) &&
    /<CountryPickerSheet/.test(stepSource('e-name')) && /<LedgerCurrencySheet/.test(stepSource('e-name')),
);
ok(
  'the device Region is read once and only as a guess the person can correct',
  /function deviceCountry\(\): string \| null \{[\s\S]{0,120}normalizeOnboardingCountry\(getLocales\(\)\[0\]\?\.regionCode\)/.test(gateSource) &&
    /const deviceRegion = useMemo\(deviceCountry, \[\]\)/.test(gateSource) &&
    /const shownCountry = selectedCountry \?\? deviceRegion/.test(gateSource),
);
ok(
  'the country control is durable without rewinding setup',
  /const chooseCountry = \(id: string\) => \{[\s\S]{0,500}stage: current\?\.stage \?\? 'welcome',[\s\S]{0,200}country: next,/.test(gateSource) &&
    /setCountry\(normalizeOnboardingCountry\(state\.onboardingProfile\.country\)\)/.test(gateSource) &&
    /country: country \?\? normalizeOnboardingCountry\(current\?\.country\) \?\? null,/.test(gateSource),
);
ok(
  'a chosen currency is the ledger\'s, written like Settings writes it, and never in the preview',
  /const chooseCurrency = \(code: string\) => \{\s*if \(previewMode\) \{\s*setCurrencyDraft\(code\);\s*return;\s*\}[\s\S]{0,200}if \(setLedgerMoney\(code\) && code !== shownCurrency\) \{[\s\S]{0,160}limitMinor: 0/.test(gateSource),
);
ok(
  'the alert scene states what Wafra can reach rather than naming a bank',
  /export function AlertDeliveryChooser/.test(aliveScenesSource) &&
    /onboardAlertsReachPast/.test(aliveScenesSource) &&
    /onboardAlertsReachFuture/.test(aliveScenesSource),
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
  // Design language E: the name is step 1 of 5, and the first tile of the pattern.
  'name personalization is step 1, saved on this device before the journey moves on',
  stepSource('e-name').includes('testID="onboarding-name-input"') &&
    stepSource('e-name').includes('testID="onboarding-name-preview"') &&
    /<EStepFrame palette=\{band\} step=\{1\}/.test(stepSource('e-name')) &&
    /<WelcomeStep onStart=\{openName\}/.test(gateSource) &&
    /onboardNameSkip/.test(stepSource('e-name')) &&
    /setUserName\(nextName\)[\s\S]*?saveJourney\('focus'\)[\s\S]*?ensureDurable\(\)/.test(gateSource) &&
    /case 'name': return 1;/.test(eLibSource),
);
ok(
  'Home greeting uses the durable onboarding name while preserving the skipped-name fallback',
  /state\.userName === 'there' \? null : normalizePreferredName\(state\.userName\)/.test(journalHomeSource) &&
    /const greeting = preferredName[\s\S]{0,180}greetingBase/.test(journalHomeSource),
);
ok(
  'saved preferred name personalizes later onboarding without touching financial data',
  /words\.workingTitle\(preferredName\)/.test(gateSource) &&
    /name=\{preferredName\}/.test(gateSource) &&
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
  // Design language E: Welcome draws Wafra's mark and an example pattern,
  // labelled and spoken as an example, and writes nothing. The regional
  // scenes remain for setup-preview and the setup shell.
  'welcome uses real Wafra identity and an example pattern without ledger writes',
  /<LogoDraw size=\{38\} color=\{band\.accent\} \/>/.test(stepSource('e-welcome')) &&
    /<PatternMosaic key=\{replay\} tiles=\{tiles\} tile=\{tile\} animate accessibilityLabel=\{words\.exampleLabel\} \/>/.test(stepSource('e-welcome')) &&
    !/useStore|importBatch|addTransaction|setOnboarded|setCaptureOptOut|loadDemoData/.test(stepSource('e-welcome')) &&
    // No language button on the first page (owner decision, 2026-09-25).
    !/setUiLanguage|I18nManager|onboarding-language-switch/.test(gateSource + stepSource('e-welcome')) &&
    /WafraMark/.test(aliveScenesSource) &&
    /onboardingBankRegion/.test(aliveScenesSource) &&
    /verifiedLogoUrl/.test(aliveScenesSource) &&
    /US:[\s\S]*GB:[\s\S]*FR:[\s\S]*DE:[\s\S]*IN:[\s\S]*QA:[\s\S]*KW:/.test(onboardingBankExamplesSource) &&
    !/useStore|importBatch|addTransaction|setOnboarded|setCaptureOptOut|loadDemoData/.test(aliveScenesSource) &&
    !/Gmail|Excel|fake contact/i.test(aliveScenesSource),
);
ok(
  'welcome money reveal uses real regional alerts with restrained product-like motion',
  /function PosterAlertCard/.test(aliveScenesSource) &&
    /card\.value = withDelay[\s\S]*?withTiming/.test(aliveScenesSource) &&
    /translateY:[\s\S]*?\[18, 0\]/.test(aliveScenesSource) &&
    !/POSTER_ROTATIONS|withSpring|rotate:/.test(aliveScenesSource) &&
    /onboardingAlertExamples/.test(aliveScenesSource) &&
    /onboardSceneAlertsToPicture/.test(aliveScenesSource) &&
    !/function MessageParse|function Token/.test(aliveScenesSource),
);
ok(
  // Design language E: the result is an editorial strip of real counts and,
  // when one exists, the real payment that arrived — never a success badge.
  'successful completion shows real results as strips and the arrived payment, not a generic success card',
  /<ResultStrip palette=\{stepBand\} cells=\{\[/.test(gateSource) &&
    /strip: \{ flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1/.test(stepSource('e-first-payment')) &&
    /automaticCompletion && firstPayment && !failedCompletion && !smsDenied && !finishSaveFailed/.test(gateSource) &&
    /<ArrivedCard palette=\{stepBand\} transaction=\{firstPayment\.arrived\}/.test(gateSource),
);
ok(
  'Android capture exposes SMS, bank-app notifications, statement import, either automatic source, both, or manual',
  /onPress=\{\(\) => void openSmsSource\(\)\}/.test(gateSource) &&
    /const openSmsSource = async[\s\S]{0,260}await runSetupAction\(startScan\)/.test(gateSource) &&
    /onPress=\{\(\) => void runSetupAction\(connectAndroidNotifications\)\}/.test(gateSource) &&
    /onPress=\{openStatementImport\}/.test(gateSource) &&
    /words\.importStatements/.test(gateSource) &&
    /onPress=\{\(\) => void runSetupAction\(finishAndroidCapture\)\}/.test(gateSource) &&
    /onboardCaptureContinueBoth/.test(gateSource) &&
    /onboardCaptureContinueOne/.test(gateSource) &&
    /onPress=\{\(\) => void runSetupAction\(continueManually\)\}/.test(gateSource),
);
ok(
  'web preview offers manual tracking without a nonfunctional automatic choice',
  /\{Platform\.OS === 'android' \? <>/.test(gateSource) &&
    /\{Platform\.OS !== 'web' && !previewMode \? <SourceRow palette=\{stepBand\} icon="upload"/.test(gateSource) &&
    /<SourceRow palette=\{stepBand\} icon="plus" title=\{words\.addByHand\}[\s\S]{0,160}runSetupAction\(continueManually\)/.test(gateSource) &&
    /Platform\.OS === 'android' \? words\.captureBodyAndroid : words\.captureBodyWeb/.test(gateSource),
);
ok(
  'Android notification capture is a first-class source while neither automatic source is visually recommended',
  !/styles\.startOptionFeatured|recommendedPill|t\('recommended'\)/.test(gateSource) &&
    /NotificationReader/.test(gateSource) &&
    /androidNotificationReady/.test(gateSource) &&
    /androidSmsReady/.test(gateSource),
);
ok(
  'first-run gate exempts iOS setup and only the in-memory-authorized statement route',
  /const isIosSetupRoute\s*=\s*Platform\.OS === 'ios'[\s\S]{0,180}pathname === '\/ios-setup'[\s\S]{0,200}pathname === '\/import-sms'/.test(gateSource) &&
    /const statementImportSession = useRef<string \| null>\(null\)/.test(gateSource) &&
    /const isOnboardingStatementRoute\s*=[\s\S]{0,160}pathname === '\/statement-import'[\s\S]{0,160}params\.statementSession === statementImportSession\.current/.test(gateSource) &&
    /statementImportSession\.current = session[\s\S]{0,180}statementSession=\$\{session\}/.test(gateSource) &&
    /const showOverlay\s*=[\s\S]{0,280}!isIosSetupRoute[\s\S]{0,80}!isOnboardingStatementRoute/.test(gateSource),
);
eq('iOS onboarding uses the compact bank-alert heading', i18n.t('onboardCaptureTitleIos', 'en'), 'Choose how to add activity');
eq('iOS onboarding explains that the capture choice can change', i18n.t('onboardCaptureBodyIos', 'en'), 'Connect supported bank alerts, or start manually. You can change this later.');
eq('iOS automatic choice explains the Shortcut and keeps history optional', i18n.t('onboardAutomaticChoiceIosBody', 'en'), 'Add one Wafra Shortcut, then turn on a Message automation. Past messages are optional.');
eq('iOS automatic action names the bank-alert connection', i18n.t('onboardAutomaticChoiceIos', 'en'), 'Connect bank alerts');
eq('statement import is a first-run choice on either phone', i18n.t('onboardStatementChoice', 'en'), 'Import bank statements');
eq('statement import discloses its secure relay before file selection', i18n.t('onboardStatementChoiceBody', 'en'), 'Send PDF, CSV, or TSV through Wafra’s secure relay. Raw files are parsed in memory, then discarded.');
eq('capture trust distinguishes local alerts from cloud statement import', i18n.t('onboardCaptureLocalAutomaticBody', 'en'), 'SMS/Message capture is local. Statement import uses the secure relay only when you choose it.');
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
  'onboardPastTitle',
  'onboardPastBody',
  'onboardPastAction',
  'onboardLater',
  'onboardHowItWorks',
  'onboardLiveTitle',
  'onboardLiveBody',
  'onboardLiveAction',
  'onboardNotNow',
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
      i18n.t('onboardStatementChoiceBody', language).length <= 112 &&
      i18n.t('onboardManualChoiceIosBody', language).length <= 92 &&
      i18n.t('onboardCapturePrivacyIos', language).length <= 64),
);
// 2026-09-25: iPhone setup is two short steps. Past: a bank statement. New:
// Messages capture. One sentence and one primary action each; Later / Not now
// and a "How it works" disclosure carry everything else.
const introStepSource = fs.readFileSync(path.join(__dirname, '../../src/components/onboarding/setup-intro-step.tsx'), 'utf8');
ok(
  // Design language E: iPhone step 5 is live capture (the evidence checklist
  // and one Set up), with statements and "by hand" as the honest ways past
  // it and the privacy details behind How it works. The intro step component
  // stays for the setup preview.
  'iOS setup offers live capture with one primary action, statements and by-hand beside it, details behind How it works',
  /label=\{t\('onboardLiveAction'\)\}\s*onPress=\{\(\) => void runSetupAction\(beginCapture\)\}/.test(gateSource) &&
    /icon="upload" title=\{words\.importStatements\}[\s\S]{0,160}onPress=\{openStatementImport\}/.test(gateSource) &&
    /icon="plus" title=\{words\.addByHand\}[\s\S]{0,160}runSetupAction\(continueManually\)/.test(gateSource) &&
    /<BottomSheet[\s\S]*?visible=\{learnMoreVisible\}[\s\S]*?onboardCaptureLearnMoreTitle[\s\S]*?onboardCaptureLearnMorePrivacy/.test(gateSource) &&
    /label=\{t\('onboardHowItWorks'\)\}\s*onPress=\{\(\) => setLearnMoreVisible\(true\)\}/.test(gateSource) &&
    // The setup preview's intro step keeps its one primary and one ghost.
    (introStepSource.match(/<Button\b/g) ?? []).length === 2 &&
    /variant="ghost"/.test(introStepSource) &&
    /accessibilityLabel=\{howLabel\}/.test(introStepSource) &&
    !iosVisibleCopy.includes(universalSenderLabel) &&
    !iosVisibleCopy.includes(universalSenderLabelArabic),
);
ok(
  'forced-dark onboarding gives How it works and Later/Not now explicit visible colours',
  /howText: \{ color: night\.textSecondary/.test(introStepSource) &&
    /label=\{secondary\.label\}[\s\S]{0,160}labelColor=\{night\.text\}/.test(introStepSource) &&
    /label=\{primary\.label\}[\s\S]{0,160}labelColor=\{night\.onPrimary\}/.test(introStepSource) &&
    /const night = Colors\.dark;/.test(introStepSource),
);
ok(
  'iOS setup copy stays one short sentence per step in both languages',
  ['en', 'ar'].every((language) =>
    ['onboardPastBody', 'onboardLiveBody'].every((key) => i18n.t(key, language).length <= 64 &&
      (i18n.t(key, language).match(/[.!؟?]/g) ?? []).length <= 1) &&
    ['onboardPastTitle', 'onboardLiveTitle'].every((key) => i18n.t(key, language).length <= 32)),
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
    /accessibilityRole="progressbar"/.test(stepSource('e-frame')) &&
    /words\.stepOf\(step, ONBOARDING_E_TOTAL_STEPS\)/.test(stepSource('e-frame')) &&
    !/PLAN_STEPS|personalizing/.test(gateSource),
);
// Design language E: every answer visibly changes something real — the
// pattern, Home's order, a budget, the reminders — and the result, the
// pattern and the paywall follow the first payment.
ok(
  'each answer changes something real, and the first payment leads to the pattern and the paywall',
  /const patternTiles = useMemo\(\(\) => buildPattern\(patternInput\), \[patternInput\]\)/.test(gateSource) &&
    /<GoalsStep goals=\{goalsDraft\}[\s\S]{0,200}tiles=\{patternTiles\}/.test(gateSource) &&
    /const showPattern = \(\) => \{[\s\S]{0,300}onboarding_value_previewed[\s\S]{0,200}setStep\('pattern'\)/.test(gateSource) &&
    /onPress=\{showPattern\}/.test(gateSource) &&
    /continueLabel=\{showPaywall \? words\.oneLastThing : words\.openWafra\}/.test(gateSource) &&
    /testID="onboarding-context-trust"/.test(stepSource('e-first-payment')) &&
    /<TrustLine palette=\{stepBand\}/.test(gateSource),
);
ok(
  'the pattern carries no money and matches what Home will draw',
  !/amount|Fils|Minor/.test(stepSource('e-pattern').replace(/\/\*[\s\S]*?\*\//g, '')) &&
    /const live = patternInputFromState\(\{/.test(gateSource) &&
    /setHandoff\(patternInputFromState\(state\)\)/.test(gateSource),
);
ok(
  'Android source setup persists readiness before explicit final completion',
  /await beginHistoryImport\(\)[\s\S]*?await ensureDurable\(\)[\s\S]*?setAndroidSmsReady\(true\)/.test(gateSource) &&
    /const finishAndroidCapture = async[\s\S]*?saveJourney\('complete'\)[\s\S]*?await ensureDurable\(\)[\s\S]*?setCompletionOutcome\('automatic'\)/.test(gateSource) &&
    /outcome: outcomeOverride \?\? completionOutcome/.test(gateSource),
);
ok(
  'funnel instrumentation is provider-neutral and covers the important first-run decisions',
  // Design language E: goals are the "focus" decision and the alert answer
  // is recorded from the capture choice; there is no tracking question.
  ['onboarding_started', 'onboarding_focus_selected', 'onboarding_alerts_selected',
    'onboarding_value_previewed', 'onboarding_privacy_seen', 'capture_setup_started',
    'capture_permission_granted', 'capture_permission_denied', 'manual_tracking_selected',
    'onboarding_completed'].every((event) => gateSource.includes(`'${event}'`)),
);
ok(
  'manual completion keeps the gate visible through a failed durable save',
  /const showOverlay\s*=[\s\S]{0,240}\(!state\.onboarded \|\| finishing \|\| previewMode \|\| revealAfterSetup\)/.test(gateSource) &&
    /const openWafra = async[\s\S]*?setFinishing\(true\)[\s\S]*?await ensureDurable\(\)[\s\S]*?setFinishing\(false\)[\s\S]*?catch[\s\S]*?setFinishSaveFailed\(true\)/.test(gateSource) &&
    /finishSaveFailed \? <EButton[\s\S]{0,220}openWafra\(requestedFirstEntry\.current, requestedDestination\.current\)/.test(gateSource),
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
// 2026-09-25: the done card replaces the three-line completion reveal.
ok(
  'iPhone setup ends on a done card with a pass result before leaving setup',
  /futureStep === 'ready' \? \([\s\S]{0,120}testID="ios-capture-ready"[\s\S]{0,120}shortcutCopy\.doneTitle[\s\S]{0,400}tone: 'pass'/.test(iosSource),
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
    // The destination is resolved by finishDestination() now, so it can be the
    // statement import for a bank that leaves no history; the ordering this
    // assertion exists for — durable finish BEFORE the exit — is unchanged.
    /completeIosMessageOnboardingAttempt\(\{[\s\S]*?ensureDurable,[\s\S]*?type: 'onboarding-finished'[\s\S]*?exitToRoot\(finishDestination\(\)\)/.test(iosSource) &&
    /setOnboardingProfile\(\s*onboardingProfileAtStage\(state\.onboardingProfile, 'complete'/.test(iosSource),
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
    // The band figure only when a balance is known; otherwise a drawn dash.
    /p\.knownBalanceCount > 0\s*\?\s*<BandFigure[\s\S]*?fils=\{p\.balanceFils\}[\s\S]*?:\s*<View[\s\S]*?>—<\/ThemedText>/.test(
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

{
  // Known banks: the user's own answer to "Which banks text you?", the only
  // bank identity an iOS history import has when neither the sender (absent
  // on iOS 26) nor the body names the bank.
  eq('backup validation accepts a known-banks list',
    backupValidation.isValidBackupState({ transactions: [], knownBanks: ['ADIB', 'FAB'] }), true);
  eq('backup validation accepts an empty known-banks list',
    backupValidation.isValidBackupState({ transactions: [], knownBanks: [] }), true);
  eq('backup validation rejects a known-banks value that is not a list',
    backupValidation.isValidBackupState({ transactions: [], knownBanks: 'ADIB' }), false);
  eq('backup validation rejects non-string known-bank entries',
    backupValidation.isValidBackupState({ transactions: [], knownBanks: [7] }), false);
  let known = null;
  try { known = require('./build/known-banks'); } catch { known = null; }
  ok('known-banks helpers exist', known !== null);
  if (known) {
    eq('sanitizeKnownBanks keeps only real bank names, once each',
      JSON.stringify(known.sanitizeKnownBanks(['ADIB', 'Nope Bank', 'ADIB', 7, 'Al Rajhi'])), JSON.stringify(['ADIB', 'Al Rajhi']));
    eq('sanitizeKnownBanks tolerates a missing value', JSON.stringify(known.sanitizeKnownBanks(undefined)), '[]');
    eq('singleKnownBank resolves exactly one bank', known.singleKnownBank(['ADIB'])?.name, 'ADIB');
    eq('singleKnownBank refuses to pick between two', known.singleKnownBank(['ADIB', 'FAB']), null);
    eq('singleKnownBank is null when none is known', known.singleKnownBank([]), null);
    const accounts = [
      { id: 'a', name: 'Account •9957', kind: 'bank', openingFils: 0, color: '#FB923C', last4: '9957' },
      { id: 'b', name: 'FAB Credit Card •1234', kind: 'card', cardType: 'credit', openingFils: 0, color: '#00A3E0', last4: '1234', bankName: 'FAB' },
    ];
    const labelled = known.accountsLabelledWithBank(accounts, known.singleKnownBank(['ADIB']));
    ok('accountsLabelledWithBank labels only accounts that have no bank',
      labelled[0].bankName === 'ADIB' && labelled[0].color === '#0E5AA7' && labelled[0].name === 'Account •9957' &&
      labelled[1].bankName === 'FAB' && labelled[1].color === '#00A3E0', labelled);
    const withCash = known.accountsLabelledWithBank([
      { id: 'cash', name: 'Cash', kind: 'cash', openingFils: 0, color: '#999' },
      { id: 'c', name: 'Account •0315', kind: 'bank', openingFils: 0, color: '#FB923C', last4: '0315' },
    ], known.singleKnownBank(['ADIB']));
    ok('accountsLabelledWithBank leaves cash alone', withCash[0].bankName === undefined && withCash[1].bankName === 'ADIB', withCash);
    const order = known.bankPickerOptions(['FAB', 'Nope'], 'AE').map((bank) => bank.name);
    ok('bankPickerOptions lists known banks first, then the rest of the market once',
      order[0] === 'FAB' && order.filter((name) => name === 'FAB').length === 1 && order.includes('ADIB') && !order.includes('Nope'), order);
    ok('knownBankOptions lists the market pack banks',
      known.knownBankOptions('AE').some((b) => b.name === 'ADIB') && !known.knownBankOptions('AE').some((b) => b.name === 'Al Rajhi') &&
      known.knownBankOptions('SA').some((b) => b.name === 'Al Rajhi'));
  }
  const iosSetupSource = fs.readFileSync(path.join(__dirname, '../../src/app/ios-setup.tsx'), 'utf8');
  const cardsSource = fs.readFileSync(path.join(__dirname, '../../src/app/cards.tsx'), 'utf8');
  const walletSource = fs.readFileSync(path.join(__dirname, '../../src/app/(tabs)/wallet.tsx'), 'utf8');
  // Setup no longer asks which banks text the user: that question gated the
  // checklist without improving capture, and bank identity now comes from the
  // alert itself. The screen must not reintroduce it or save a guessed bank.
  ok('the iOS setup screen reaches capture without a bank question',
    !iosSetupSource.includes("t('iosBanksTitle')") && !iosSetupSource.includes('setKnownBanks('));
  ok('the cards and wallet account sheets offer "Set bank"',
    cardsSource.includes("t('accountSetBank')") && walletSource.includes("t('accountSetBank')") &&
    cardsSource.includes("t('accountNoBank')") && walletSource.includes("t('accountNoBank')"));
  for (const key of ['accountSetBank', 'accountNoBank', 'accountBankQuestion']) {
    ok(`i18n has ${key} in both languages`,
      typeof i18n.t(key, 'en') === 'string' && i18n.t(key, 'en') !== key && typeof i18n.t(key, 'ar') === 'string' && i18n.t(key, 'ar') !== key);
  }
}

console.log(`\nonboarding: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
