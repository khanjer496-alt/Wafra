const fs = require('fs');
const path = require('path');
const onboarding = require('./build/onboarding');
const i18n = require('./build/i18n');

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
eq(
  'unsupported ledger currencies stay pending instead of becoming AED',
  onboarding.buildDeferredOnboardingPlan(
    { goalIds: ['travel'], budgetId: 'flexible' },
    'USD',
    null,
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
    'SAR',
    25,
    'en',
  )?.answers,
  { marketId: 'SA', goalIds: ['home'], budgetId: 'essentials', monthStartDay: 25 },
);
eq(
  'locale-derived SAR money does not activate a plan without bank-alert proof',
  onboarding.buildDeferredOnboardingPlan(
    { goalIds: ['home'], budgetId: 'essentials' },
    'SAR',
    null,
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
const iosSource = fs.readFileSync(path.join(__dirname, '../../src/app/ios-setup.tsx'), 'utf8');
const iosControllerSource = fs.readFileSync(
  path.join(__dirname, '../../src/lib/ios-capture-setup.ts'),
  'utf8',
);

ok(
  'first run collects goals and a budget plan without forcing a country',
  gateSource.includes("const QUESTION_STEPS: readonly Step[] = ['goals', 'budget', 'capture']") &&
    gateSource.includes('setOnboardingPlan(plan)') &&
    !gateSource.includes('setMarket(plan.answers.marketId)') &&
    !gateSource.includes('plan.budgets.forEach(upsertBudget)') &&
    !gateSource.includes('plan.goals.forEach(addGoal)'),
);
ok(
  'first run opens with a visual money story instead of a generic feature list',
  /<MoneyPreview reducedMotion=\{reducedMotion\}/.test(gateSource) &&
    /onboardPreviewIncome/.test(gateSource) &&
    /onboardPreviewBill/.test(gateSource) &&
    /onboardPreviewCard/.test(gateSource) &&
    !/function points\(/.test(gateSource),
);
ok(
  'capture choice is presented as two explicit accessible start modes',
  /<StartOption automatic onPress=/.test(gateSource) &&
    /<StartOption automatic=\{false\}/.test(gateSource) &&
    /accessibilityRole="button"/.test(gateSource) &&
    /onboardAutomaticChoice/.test(gateSource) &&
    /onboardManualChoice/.test(gateSource),
);
{
  const automaticBodies = [
    'onboardAutomaticChoiceAndroidBody',
    'onboardAutomaticChoiceIosBody',
  ];
  ok(
    'automatic capture discloses its three-day Pro boundary before selection',
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
    /result\.tx/.test(gateSource) &&
    /result\.accounts/.test(gateSource) &&
    !/setTimeout|personalizing/i.test(gateSource),
);
ok(
  'first run waits for encrypted hydration and shows truthful three-step progress',
  /if \(!state\.hydrated\)/.test(gateSource) &&
    /loadingLedger/.test(gateSource) &&
    /onboardStepOf|progressbar/.test(gateSource) &&
    /QUESTION_STEPS\.length/.test(gateSource),
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
    gateSource.includes('onPress={() => void continueManually()}'),
);
ok(
  'choosing automatic capture clears a prior durable opt-out before either platform starts',
  /const startScan = async \(\) => \{[\s\S]*?await setCaptureOptOut\(false\)[\s\S]*?await scanInbox/.test(gateSource) &&
    /const beginCapture = async \(\) => \{[\s\S]*?if \(Platform\.OS === 'ios'\)[\s\S]*?await setCaptureOptOut\(false\)[\s\S]*?router\.push\('\/ios-setup\?fromOnboarding=1'\)/.test(gateSource),
);
ok(
  'denied SMS onboarding can retry or open the exact app settings',
  /smsDenied[\s\S]*?retryHistoryRead[\s\S]*?startScan\(\)[\s\S]*?openPhoneSettings[\s\S]*?Linking\.openSettings/.test(gateSource),
);
ok(
  'iOS manual opt-out revokes a setup that was started before returning to onboarding',
  /await setCaptureOptOut\(true\)[\s\S]*?if \(Platform\.OS === 'ios'\)[\s\S]*?try \{[\s\S]*?await getRelayConfigStrict\(\)[\s\S]*?await unpairDevice\(relay\)[\s\S]*?setShortcutCleanup\('revoked'\)[\s\S]*?catch[\s\S]*?setShortcutCleanup\('uncertain'\)[\s\S]*?finally[\s\S]*?await disableRelayBackgroundSync\(\)[\s\S]*?shortcutCleanupUncertain/.test(gateSource),
);
ok(
  'iOS Shortcut setup returns to the personalized completion',
  gateSource.includes('/ios-setup?fromOnboarding=1') &&
    iosSource.includes("router.replace('/?onboarding=complete')"),
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
const importSource = fs.readFileSync(path.join(__dirname, '../../src/app/import-sms.tsx'), 'utf8');

ok('a completed onboarding inbox read records the parser migration in its ledger write',
  /inboxHistoryComplete[\s\S]*?parserRereadComplete: true/.test(gateSource));
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
  'Reliable balances for 2 of 4 active accounts');

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
    /balanceAccountCoverage\.known > 0[\s\S]*?formatAmount\(balances\.balanceFils, \{ decimals: false \}\)[\s\S]*?: '—'/.test(
      walletSource,
    ));
  ok('Wallet replaces net worth with balances, card dues and paid-from-account facts',
    /availableBalances/.test(walletSource) &&
      /balanceCoverage/.test(walletSource) &&
      /paidFromAccounts/.test(walletSource) &&
      /cashOutBreakdown/.test(walletSource) &&
      !/estimatedNetWorth/.test(walletSource));
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

/* The relay's own words are not copy.
 *
 * `RelayError.message` is English written for a developer — "Pairing failed
 * (503)." — and it was rendered verbatim on the screen the whole iPhone
 * product rests on, in an app that ships in Arabic. */
{
  ok('iOS setup never renders a relay exception message',
    !/\b(?:e|err|error)\.message\b/.test(iosSource) &&
      !/\b(?:e|err|error)\.message\b/.test(iosControllerSource));
  ok('it maps the relay error to translated copy instead',
    /error instanceof RelayError/.test(iosControllerSource) &&
      /error\.code === 'rate_limited'/.test(iosControllerSource) &&
      /case 'connect-rate-limited':/.test(iosSource));
  ok('and the failure block has room for what to do next',
    /errorDetail && \(/.test(iosSource));
}

console.log(`\nonboarding: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
