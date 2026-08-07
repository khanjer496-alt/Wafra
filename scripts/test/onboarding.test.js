const fs = require('fs');
const path = require('path');
const onboarding = require('./build/onboarding');

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

const gateSource = fs.readFileSync(
  path.join(__dirname, '../../src/components/onboarding-gate.tsx'),
  'utf8',
);
const iosSource = fs.readFileSync(path.join(__dirname, '../../src/app/ios-setup.tsx'), 'utf8');

ok(
  'questionnaire plan is wired to persistent store actions',
  [
    'setMarket(plan.answers.marketId)',
    'setMonthStartDay(plan.answers.monthStartDay)',
    'plan.budgets.forEach(upsertBudget)',
    'plan.goals.forEach(addGoal)',
  ].every((needle) => gateSource.includes(needle)),
);
ok(
  'iOS Shortcut setup returns to the personalized completion',
  gateSource.includes('/ios-setup?fromOnboarding=1') &&
    iosSource.includes("router.replace('/?onboarding=complete')"),
);
ok(
  'sample data remains a first-run path',
  gateSource.includes('onPress={loadDemoData}'),
);

console.log(`\nonboarding: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
