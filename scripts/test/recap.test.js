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
  if (request.startsWith('@/')) {
    const relative = request.slice(2);
    for (const ext of ['.ts', '.tsx']) {
      const filename = path.join(root, 'src', `${relative}${ext}`);
      if (fs.existsSync(filename)) return originalResolveFilename.call(this, filename, parent, isMain, options);
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const { primaryRecapDescriptor, projectRecap, recapCandidates, recapDescriptor, hasRecapActivity } = require('../../src/lib/recap.ts');
const { setMonthStartDay } = require('../../src/lib/format.ts');

Module._resolveFilename = originalResolveFilename;
if (originalTsLoader) require.extensions['.ts'] = originalTsLoader;
else delete require.extensions['.ts'];

let pass = 0;
let fail = 0;
function ok(name, condition, detail = '') {
  if (condition) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
function eq(name, actual, expected) {
  const okay = JSON.stringify(actual) === JSON.stringify(expected);
  if (okay) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`); }
}

const accounts = [
  { id: 'bank', name: 'Current account', kind: 'bank', openingFils: 0, color: '#111' },
  { id: 'card', name: 'Everyday card', kind: 'card', cardType: 'credit', last4: '4821', openingFils: 0, color: '#222' },
];
const tx = (id, over = {}) => ({
  id,
  type: 'expense',
  amountFils: 1_000,
  category: 'other',
  accountId: 'card',
  title: 'Shop',
  date: '2026-08-01',
  source: 'manual',
  ...over,
});
const transactions = [
  tx('dining', { title: 'Cafe One', category: 'dining', amountFils: 10_000, date: '2026-08-02' }),
  tx('shopping', { title: 'Store Two', category: 'shopping', amountFils: 5_000, date: '2026-08-10' }),
  tx('split', { title: 'Mixed Basket', category: 'groceries', amountFils: 2_000, date: '2026-08-21',
    splits: [{ category: 'groceries', amountFils: 1_000 }, { category: 'dining', amountFils: 1_000 }] }),
  tx('salary', { type: 'income', title: 'Salary', category: 'salary', accountId: 'bank', amountFils: 100_000, date: '2026-08-25' }),
  tx('transfer', { title: 'Card payment', amountFils: 20_000, date: '2026-08-15', isTransfer: true }),
  tx('invest', { title: 'Broker', category: 'investing', amountFils: 50_000, date: '2026-08-12' }),
  tx('previous', { title: 'July Shop', category: 'shopping', amountFils: 20_000, date: '2026-07-11' }),
];
const state = {
  accounts,
  transactions,
  transferInternalIds: [],
  transferNormalizationVersion: undefined,
  historyImport: { status: 'running' },
};

setMonthStartDay(1);
eq('September surfaces the completed August recap', primaryRecapDescriptor(new Date('2026-09-17T12:00:00')).id, 'month:2026-08');
eq('January surfaces the completed annual recap', primaryRecapDescriptor(new Date('2027-01-17T12:00:00')).id, 'year:2026');
eq('January keeps both the annual and December stories available',
  recapCandidates(new Date('2027-01-17T12:00:00')).map((row) => row.id),
  ['year:2026', 'month:2026-12']);
ok('a newest-first prefix cannot hide a later in-month recap row',
  hasRecapActivity([
    tx('sep', { date: '2026-09-01' }),
    tx('july', { date: '2026-07-01' }),
    tx('aug', { date: '2026-08-15' }),
  ], recapDescriptor('month', '2026-08')));
ok('newest-first still finds August after skipping September',
  hasRecapActivity([
    tx('sep', { date: '2026-09-20' }),
    tx('aug', { date: '2026-08-15' }),
    tx('july', { date: '2026-07-01' }),
  ], recapDescriptor('month', '2026-08')));
ok('a ledger with no in-month activity is not recap-eligible',
  !hasRecapActivity([
    tx('sep', { date: '2026-09-20' }),
    tx('july', { date: '2026-07-01' }),
  ], recapDescriptor('month', '2026-08')));

const recap = projectRecap(state, recapDescriptor('month', '2026-08'));
eq('spending excludes transfers and investing', recap.totalSpendFils, 17_000);
eq('income remains income', recap.totalIncomeFils, 100_000);
eq('net is income minus spending', recap.netFils, 83_000);
eq('only real spending rows count as purchases', recap.spendingCount, 3);
eq('split allocations feed category totals', recap.topCategories[0], {
  category: 'dining', label: 'Dining', spendFils: 11_000, percent: 65,
});
eq('most-used card is based on actual spending rows', recap.mostUsedAccount && {
  id: recap.mostUsedAccount.account.id,
  count: recap.mostUsedAccount.count,
  spendFils: recap.mostUsedAccount.spendFils,
}, { id: 'card', count: 3, spendFils: 17_000 });
eq('previous-period change is deterministic', {
  previous: recap.previousSpendFils,
  change: recap.spendChangeFils,
  percent: recap.spendChangePercent,
}, { previous: 20_000, change: -3_000, percent: -15 });
eq('no-spend days use the completed month', recap.noSpendDays, 28);

// Time of day: four buckets of spending payments, counted only when the
// payment has a clock time. The caption's base is that timed count.
const at = (iso) => new Date(iso).getTime();
const timed = projectRecap({ ...state, transactions: [
  tx('morning', { title: 'Bakery', date: '2026-08-03', ts: at('2026-08-03T08:30:00') }),
  tx('evening-1', { title: 'Diner', date: '2026-08-04', ts: at('2026-08-04T19:00:00') }),
  tx('evening-2', { title: 'Cinema', date: '2026-08-05', ts: at('2026-08-05T20:15:00') }),
  tx('night', { title: 'Taxi', date: '2026-08-06', ts: at('2026-08-06T23:40:00') }),
  tx('untimed', { title: 'Market', date: '2026-08-07' }),
  tx('transfer-timed', { title: 'Card payment', isTransfer: true, date: '2026-08-08', ts: at('2026-08-08T13:00:00') }),
  tx('income-timed', { type: 'income', title: 'Salary', category: 'salary', accountId: 'bank', date: '2026-08-09', ts: at('2026-08-09T14:00:00') }),
] }, recapDescriptor('month', '2026-08'));
eq('time-of-day counts only timed spending payments', timed.timeOfDay,
  { morning: 1, afternoon: 0, evening: 2, night: 1 });
eq('the time-of-day base is timed payments, not every payment', [timed.timedCount, timed.spendingCount], [4, 5]);
eq('the favourite time agrees with the bars', timed.favoriteTime, { bucket: 'evening', count: 2 });
eq('a ledger without clock times has no time-of-day base', [recap.timedCount, recap.timeOfDay],
  [0, { morning: 0, afternoon: 0, evening: 0, night: 0 }]);

setMonthStartDay(25);
eq('salary-day reporting changes which month just completed',
  primaryRecapDescriptor(new Date('2026-09-17T12:00:00')).id, 'month:2026-07');
setMonthStartDay(1);

const homeSource = fs.readFileSync(path.join(root, 'src/screens/journal-home-screen.tsx'), 'utf8');
const summarySource = fs.readFileSync(path.join(root, 'src/components/reference-home-summary.tsx'), 'utf8');
const storySource = fs.readFileSync(path.join(root, 'src/components/recap/recap-story.tsx'), 'utf8');
const routeSource = fs.readFileSync(path.join(root, 'src/app/recap.tsx'), 'utf8');
const layoutSource = fs.readFileSync(path.join(root, 'src/components/app-root-layout.tsx'), 'utf8');

ok('Home defers recap discovery until after launch interactions',
  /InteractionManager\.runAfterInteractions[\s\S]{0,700}2_600/.test(homeSource));
ok('Home never runs the full recap projection', !/\bprojectRecap\b/.test(homeSource));
ok('the W mark, not a fake brand asset, owns the recap entry',
  /RecapLogoTrigger/.test(homeSource) && /brandMark=/.test(homeSource) && /WafraMark/.test(
    fs.readFileSync(path.join(root, 'src/components/recap/recap-logo-trigger.tsx'), 'utf8')));
ok('the shared Home summary keeps its old dependency surface',
  !/recap-logo-trigger/.test(summarySource) && /brandMark\?: React\.ReactNode/.test(summarySource));
ok('story visuals reuse Wafra merchant, bank and category primitives',
  ['MerchantAvatar', 'BankAvatar', 'useCategoricalPalette', 'WafraMark'].every((name) => storySource.includes(name)));
ok('recap deliberately avoids decorative gradient UI', !/LinearGradient|RadialGradient/.test(storySource));
ok('full recap analytics live behind the dedicated route',
  /projectRecap\(state, descriptor\)/.test(routeSource));
ok('the root navigator declares the recap screen',
  /Stack\.Screen name="recap"/.test(layoutSource));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
