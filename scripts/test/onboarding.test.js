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
const iosControllerSource = fs.readFileSync(
  path.join(__dirname, '../../src/lib/ios-capture-setup.ts'),
  'utf8',
);

ok(
  'first run never forces a country or writes guessed-currency plans',
  gateSource.includes("const QUESTION_STEPS: readonly Step[] = ['capture']") &&
    gateSource.includes("onPress={() => setStep('capture')}") &&
    !gateSource.includes('setMarket(plan.answers.marketId)') &&
    !gateSource.includes('plan.budgets.forEach(upsertBudget)') &&
    !gateSource.includes('plan.goals.forEach(addGoal)'),
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
const { netWorthFils, reliableBalanceFils } = require('./build/balances');

const walletSource = fs.readFileSync(
  path.join(__dirname, '../../src/app/(tabs)/wallet.tsx'),
  'utf8',
);
const importSource = fs.readFileSync(path.join(__dirname, '../../src/app/import-sms.tsx'), 'utf8');

const emptyLedger = {
  hydrated: true,
  accounts: [],
  transactions: [],
  bills: [],
  goals: [],
  budgets: [],
  merchantOverrides: {},
};

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

  // Which is why the screen counts what it could know as well as summing it,
  // and prints the same dash its own rows print rather than that zero.
  ok('Wallet counts the accounts it cannot know a balance for',
    /reliableBalanceFils\(state, account\) === null/.test(walletSource) &&
      /worth\.known/.test(walletSource));
  ok('Wallet prints a dash, not AED 0, when nothing is knowable',
    /worth\.known > 0 \? formatAmount\(worth\.fils, \{ decimals: false \}\) : '—'/.test(
      walletSource,
    ));
  ok('and a partial answer names how many rows it left out',
    /worth\.unknown > 0 &&/.test(walletSource) &&
      /noBalanceYet'\)\} · \$\{worth\.unknown\}/.test(walletSource));
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
