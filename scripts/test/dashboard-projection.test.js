/**
 * Home's ledger derivation is exercised through the dashboard projection's
 * one interface. The test loads the TypeScript source directly so this suite
 * can stay independent of the shared test-build manifest.
 */
const fs = require('fs');
const Module = require('module');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const originalResolveFilename = Module._resolveFilename;
const originalTsLoader = require.extensions['.ts'];

require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

Module._resolveFilename = function resolveWafraAlias(request, parent, isMain, options) {
  if (request.startsWith('@/lib/')) {
    const filename = path.join(root, 'src/lib', `${request.slice('@/lib/'.length)}.ts`);
    return originalResolveFilename.call(this, filename, parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const { projectDashboard } = require('../../src/lib/dashboard-projection.ts');
const { setActiveMarket, setLedgerCurrency } = require('../../src/lib/markets.ts');

Module._resolveFilename = originalResolveFilename;
if (originalTsLoader) require.extensions['.ts'] = originalTsLoader;
else delete require.extensions['.ts'];

let pass = 0;
let fail = 0;

function ok(name, condition, detail) {
  if (condition) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, `got ${a}, want ${e}`);
}

const accounts = [
  { id: 'main', name: 'Current', kind: 'bank', openingFils: 0, color: '#111' },
  { id: 'savings', name: 'Savings', kind: 'bank', openingFils: 0, color: '#222' },
  { id: 'archived', name: 'Old card', kind: 'card', openingFils: 0, color: '#333', archived: true },
];

function tx(id, over = {}) {
  return {
    id,
    type: 'expense',
    amountFils: 1000,
    category: 'other',
    accountId: 'main',
    title: 'Shop',
    date: '2026-07-09',
    source: 'manual',
    ...over,
  };
}

function state(transactions = [], over = {}) {
  return {
    hydrated: true,
    accounts,
    transactions,
    budgets: [],
    bills: [],
    cardDues: [],
    goals: [],
    merchantOverrides: {},
    accountHints: {},
    notSubscriptions: [],
    lastScanTs: 0,
    onboarded: true,
    userName: '',
    appLock: false,
    monthStartDay: 1,
    pro: true,
    privateMode: false,
    dailySummary: false,
    trialStartTs: 0,
    marketId: 'AE',
    language: 'en',
    themePreference: 'system',
    ...over,
  };
}

const now = new Date('2026-07-10T12:00:00Z');
const period = { mode: 'month', key: '2026-07' };
const request = (ledger, over = {}) => ({
  state: ledger,
  period,
  now,
  ...over,
});

setLedgerCurrency(null);
setActiveMarket('AE');

{
  const projected = projectDashboard(request(state()));
  eq('an empty ledger has one reconciled zero hero', projected.hero, {
    incomeFils: 0,
    expenseFils: 0,
    cashOutFils: 0,
    netFils: 0,
  });
  ok('the selected current month is marked live', projected.live === true);
  ok('an empty ledger exposes no comparison, insight, rows, or upcoming money',
    projected.comparison === null && projected.insight === null &&
      projected.activityRows.length === 0 && projected.upcoming.items.length === 0);
  ok('empty parser and categorisation prompts stay quiet',
    !projected.unreadFormats.shouldPrompt && !projected.uncategorised.shouldPrompt);
}

{
  const transactions = [
    tx('alpha', {
      amountFils: 1055,
      title: 'Alpha Market',
      source: 'sms',
      raw: 'Alpha format AED 10.55',
    }),
    tx('beta', {
      amountFils: 2044,
      title: 'Beta Store',
      date: '2026-07-08',
      raw: 'Beta debit USD 20.44',
      originalCurrency: 'USD',
      originalAmountMinor: 500,
      fxSource: 'bank',
    }),
    tx('gamma', {
      amountFils: 3001,
      title: 'Gamma Shop',
      date: '2026-07-07',
      raw: 'Gamma purchase for 30.01 dirhams',
    }),
    tx('salary', {
      type: 'income',
      amountFils: 10055,
      category: 'salary',
      title: 'Salary',
      date: '2026-07-06',
    }),
    tx('move-out', {
      amountFils: 40000,
      category: 'other',
      title: 'Own account transfer',
      date: '2026-07-05',
      isTransfer: true,
    }),
    tx('move-in', {
      type: 'income',
      amountFils: 40000,
      category: 'other',
      accountId: 'savings',
      title: 'Incoming transfer',
      date: '2026-07-05',
    }),
    tx('hidden', {
      amountFils: 990000,
      category: 'shopping',
      accountId: 'archived',
      title: 'Hidden spend',
      originalCurrency: 'USD',
      originalAmountMinor: 250000,
      fxSource: 'bank',
    }),
    tx('previous', {
      amountFils: 5000,
      category: 'groceries',
      title: 'Previous spend',
      date: '2026-06-08',
    }),
  ];
  const ledger = state(transactions, {
    bills: [{
      id: 'electricity',
      title: 'Electricity',
      category: 'utilities',
      amountFils: 25000,
      dueDay: 12,
      paidMonths: [],
    }],
  });
  const before = JSON.stringify(ledger);
  const projected = projectDashboard(request(ledger));

  eq('hero figures share live-account, transfer, and display-rounding rules', projected.hero, {
    incomeFils: 10100,
    expenseFils: 6100,
    cashOutFils: 6100,
    netFils: 4000,
  });
  eq('the comparison uses the same eligible current rows',
    [projected.comparison?.currentFils, projected.comparison?.previousFils], [6100, 5000]);
  eq('period activity excludes archived and both internal-transfer halves',
    projected.activityRows.map((row) => row.id), ['alpha', 'beta', 'gamma', 'salary']);
  ok('the internal-transfer fact is reusable by row rendering',
    projected.internalTransactionIds.has('move-out') &&
      projected.internalTransactionIds.has('move-in'));
  eq('the latest automatic capture fact follows existing ledger order',
    projected.lastAutomaticCaptureDate, '2026-07-09');
  eq('foreign activity uses the same live-account scope as the hero',
    [projected.foreignActivity.groups[0]?.currency, projected.foreignActivity.totalLocalFils],
    ['USD', 2044]);
  ok('a due bill inside the horizon is part of the same view model',
    projected.upcoming.withinDays === 9 &&
      projected.upcoming.items.some((item) => item.id === 'bill-electricity' && item.daysLeft === 2));
  ok('three distinct unread formats and uncategorised merchants cross both prompt floors',
    projected.unreadFormats.count === 3 && projected.unreadFormats.shouldPrompt &&
      projected.uncategorised.summary.merchants.length === 3 &&
      projected.uncategorised.shouldPrompt);
  ok('projection has no mutation side effect on the store snapshot', JSON.stringify(ledger) === before);

  if (projected.insight) {
    const afterDismiss = projectDashboard(request(ledger, {
      dismissedInsightId: projected.insight.id,
    }));
    ok('dismissing one insight projects the next one rather than filtering in the screen',
      afterDismiss.insight === null || afterDismiss.insight.id !== projected.insight.id);
  } else {
    ok('fixture produces an insight for dismissal projection', false);
  }
}

{
  const rows = Array.from({ length: 8 }, (_, index) => tx(`row-${index}`, {
    title: `Known row ${index}`,
    category: 'groceries',
    date: `2026-07-${String(9 - index).padStart(2, '0')}`,
  }));
  const projected = projectDashboard(request(state(rows)));
  eq('the interface owns Home activity ordering and its six-row cap',
    projected.activityRows.map((row) => row.id), rows.slice(0, 6).map((row) => row.id));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
