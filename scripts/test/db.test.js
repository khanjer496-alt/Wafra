// Exercises src/lib/db-schema.ts — the half of the storage layer that can be
// proven off-device. The migration it describes runs exactly once on a real
// user's phone against data written by every version of the app they have ever
// had installed, so the tests that matter most here are the ugly ones: blobs
// with missing fields, rows from before a field existed, and duplicates.
const schema = require('./build/db-schema');

let pass = 0, fail = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}\n    got ${a}\n    want ${e}`); }
}
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} ${detail}`); }
}
function throws(name, fn) {
  try { fn(); fail++; console.log(`✗ ${name} (no throw)`); }
  catch { pass++; console.log(`✓ ${name}`); }
}

// ── migrations ──
// Invariants the runner in db.ts depends on. Versions that are not strictly
// ascending, or that skip a number, mean a device sitting on the gap either
// replays a migration or never receives one.
const versions = schema.MIGRATIONS.map((m) => m.version);
ok('migrations start at 1', versions[0] === 1);
ok('migrations strictly ascending', versions.every((v, i) => i === 0 || v > versions[i - 1]));
ok('migration versions contiguous', versions.every((v, i) => v === i + 1));
eq('SCHEMA_VERSION is the last migration', schema.SCHEMA_VERSION, versions[versions.length - 1]);
ok('every migration has statements', schema.MIGRATIONS.every((m) => m.statements.length > 0));

// A fresh database owes everything; a current one owes nothing. Calling on
// every launch has to be free, which is the whole point of the second case.
eq('fresh database applies every migration',
  schema.migrationsToApply(0).map((m) => m.version), versions);
eq('current database applies nothing', schema.migrationsToApply(schema.SCHEMA_VERSION), []);
eq('partly migrated database applies only the tail',
  schema.migrationsToApply(1).map((m) => m.version), versions.filter((v) => v > 1));

// Idempotency: running the returned set and bumping the version leaves nothing
// owed, no matter how many times the sequence repeats.
let simulated = 0;
for (let round = 0; round < 3; round++) {
  for (const m of schema.migrationsToApply(simulated)) simulated = m.version;
}
eq('replaying migrations converges on SCHEMA_VERSION', simulated, schema.SCHEMA_VERSION);
eq('converged database owes nothing', schema.migrationsToApply(simulated), []);

// Ordering is enforced by the function, not by how the list happens to be
// written — a merge that appends out of order must still run in order.
const scrambled = [
  { version: 3, statements: ['c'] },
  { version: 1, statements: ['a'] },
  { version: 2, statements: ['b'] },
];
eq('migrationsToApply sorts by version',
  schema.migrationsToApply(0, scrambled).map((m) => m.version), [1, 2, 3]);
eq('migrationsToApply skips already-applied versions',
  schema.migrationsToApply(2, scrambled).map((m) => m.version), [3]);

// A downgrade must refuse rather than run old statements over a newer schema.
throws('a newer schema than the build understands throws',
  () => schema.migrationsToApply(schema.SCHEMA_VERSION + 1));
throws('a newer schema throws for a custom list too',
  () => schema.migrationsToApply(4, scrambled));

// Every DDL statement has to survive being replayed after a crash mid-step.
const allDdl = schema.MIGRATIONS.flatMap((m) => m.statements);
ok('every DDL statement is IF NOT EXISTS',
  allDdl.every((s) => /IF NOT EXISTS/i.test(s)),
  allDdl.filter((s) => !/IF NOT EXISTS/i.test(s)).join(' | '));

// The indices the product brief's 5,000-transaction target depends on.
const ddlText = allDdl.join('\n');
ok('index on date exists (period filtering)', /idx_transactions_date ON transactions\(date\)/.test(ddlText));
ok('index on account_id exists (wallet balances)',
  /idx_transactions_account_date ON transactions\(account_id, date\)/.test(ddlText));
ok('index on category exists (budgets, analytics)',
  /idx_transactions_category_date ON transactions\(category, date\)/.test(ddlText));
ok('partial index on sms_key exists (rescan dedupe)',
  /idx_transactions_sms_key ON transactions\(sms_key\) WHERE sms_key IS NOT NULL/.test(ddlText));

// ── statement builders ──
eq('upsertSql names every column once',
  schema.upsertSql('budgets'),
  'INSERT OR REPLACE INTO budgets (category, limit_fils) VALUES (?, ?)');
const budgetRow = schema.budgetToRow({ category: 'dining', limitFils: 50000 });
eq('rowValues follows the column order', schema.rowValues('budgets', budgetRow), ['dining', 50000]);
ok('every table has a placeholder per column',
  schema.ALL_TABLES.every((t) => {
    const sql = schema.upsertSql(t);
    const cols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(', ').length;
    const marks = (sql.match(/\?/g) || []).length;
    return cols === marks;
  }));
ok('TABLE_SOURCES covers every row collection',
  Object.keys(schema.emptyRows()).every((k) => schema.TABLE_SOURCES.some((s) => s.key === k)));

// ── mapper round-trips ──
const account = {
  id: 'acc-1', name: 'ENBD Credit Card •4833', kind: 'card', openingFils: -125000,
  color: '#60A5FA', last4: '4833', bankName: 'Emirates NBD', cardType: 'credit',
  snapshotFils: 923593, snapshotKind: 'limit', creditLimitFils: 2000000,
  snapshotTs: 1753700000000, archived: true,
};
eq('account round-trips', schema.rowToAccount(schema.accountToRow(account)), account);

const bareAccount = { id: 'acc-2', name: 'Cash', kind: 'cash', openingFils: 0, color: '#8E8E93' };
eq('account with no optional fields round-trips',
  schema.rowToAccount(schema.accountToRow(bareAccount)), bareAccount);

const tx = {
  id: 'tx-1', type: 'expense', amountFils: 4550, category: 'groceries', accountId: 'acc-1',
  title: 'Carrefour', note: 'weekly shop', date: '2026-07-18', source: 'sms',
  smsKey: 's1753700000000-4550', isTransfer: true, userEdited: true, raw: 'AED 45.50 at CARREFOUR',
};
eq('transaction round-trips', schema.rowToTransaction(schema.transactionToRow(tx)), tx);

const bareTx = {
  id: 'tx-2', type: 'income', amountFils: 1200000, category: 'salary',
  accountId: 'acc-3', title: 'Salary', date: '2026-07-01',
};
eq('manual transaction with no optional fields round-trips',
  schema.rowToTransaction(schema.transactionToRow(bareTx)), bareTx);

// A pre-v2 row has no `source` at all, and must not be invented one — the
// re-parse and healing paths key off source === 'sms'.
const preV2 = schema.transactionToRow({ ...bareTx, source: undefined });
eq('pre-v2 row stores NULL source', preV2.source, null);
eq('NULL source reads back as undefined', schema.rowToTransaction(preV2).source, undefined);
eq('garbage source is not carried through',
  schema.rowToTransaction({ ...preV2, source: 'imported' }).source, undefined);

// The optional booleans have two spellings in the domain (absent and false)
// and one in SQL. false normalises to absent on the way back, which is what
// every `!t.isTransfer` in the app already assumes.
const falseFlags = schema.transactionToRow({ ...bareTx, isTransfer: false, userEdited: false });
eq('false flags store as 0', [falseFlags.is_transfer, falseFlags.user_edited], [0, 0]);
eq('0 flags read back as undefined, not false',
  [schema.rowToTransaction(falseFlags).isTransfer, schema.rowToTransaction(falseFlags).userEdited],
  [undefined, undefined]);

eq('budget round-trips',
  schema.rowToBudget(schema.budgetToRow({ category: 'dining', limitFils: 50000 })),
  { category: 'dining', limitFils: 50000 });

const bill = {
  id: 'bill-1', title: 'DEWA Bill', category: 'utilities', amountFils: 45000, dueDay: 25,
  accountId: 'acc-1', autoDetected: true, paidMonths: ['2026-06', '2026-07'],
};
eq('bill round-trips', schema.rowToBill(schema.billToRow(bill)), bill);
eq('bill with no paid months round-trips',
  schema.rowToBill(schema.billToRow({
    id: 'bill-2', title: 'du', category: 'telecom', amountFils: 38900, dueDay: 10, paidMonths: [],
  })),
  { id: 'bill-2', title: 'du', category: 'telecom', amountFils: 38900, dueDay: 10,
    accountId: undefined, autoDetected: undefined, paidMonths: [] });
eq('corrupt paid_months degrades to empty, it does not throw',
  schema.rowToBill({ id: 'b', title: 'T', category: 'other', amount_fils: 1, due_day: 1,
    account_id: null, auto_detected: 0, paid_months: '{not json' }).paidMonths, []);

const due = {
  id: 'due-1', accountId: 'acc-1', totalDueFils: 350000, minDueFils: 17500,
  dueDate: '2026-08-05', paidFils: 100000, settledAt: '2026-08-01T09:00:00.000Z',
};
eq('card due round-trips', schema.rowToCardDue(schema.cardDueToRow(due)), due);
eq('unsettled card due round-trips',
  schema.rowToCardDue(schema.cardDueToRow({ ...due, settledAt: undefined })),
  { ...due, settledAt: undefined });

const goal = { id: 'goal-1', title: 'Emergency fund', emoji: 'target', targetFils: 2000000, savedFils: 650000 };
eq('goal round-trips', schema.rowToGoal(schema.goalToRow(goal)), goal);

// ── settings ──
const settings = {
  lastScanTs: 1753700000000, onboarded: true, userName: 'Jerry', appLock: true,
  monthStartDay: 25, pro: true, trialStartTs: 1750000000000, marketId: 'ae', language: 'ar',
};
eq('settings round-trip', schema.rowsToSettings(schema.settingsToRows(settings)), settings);
eq('missing settings fall back to defaults', schema.rowsToSettings([]), schema.DEFAULT_SETTINGS);
eq('a partial write leaves the rest at their defaults',
  schema.rowsToSettings(schema.settingsToRows({ userName: 'Ada' })),
  { ...schema.DEFAULT_SETTINGS, userName: 'Ada' });
// JSON encoding, not stringification: a numeric-looking name stays a string,
// and an empty marketId stays distinguishable from a missing row.
eq('a numeric-looking userName stays a string',
  schema.rowsToSettings(schema.settingsToRows({ userName: '0' })).userName, '0');
eq('empty marketId survives the round trip',
  schema.rowsToSettings(schema.settingsToRows({ marketId: '' })).marketId, '');
eq('a corrupt settings row falls back to its default',
  schema.rowsToSettings([{ key: 'monthStartDay', value: 'not json' }]).monthStartDay, 1);
eq('a settings row of the wrong type falls back to its default',
  schema.rowsToSettings([{ key: 'userName', value: '42' }]).userName, 'there');

// ── legacy blob → rows ──
const legacyBlob = {
  accounts: [account, bareAccount],
  transactions: [tx, bareTx],
  budgets: [{ category: 'dining', limitFils: 50000 }],
  bills: [bill],
  cardDues: [due],
  goals: [goal],
  merchantOverrides: { 'Carrefour ': 'groceries' },
  accountHints: { 4833: 'acc-1' },
  notSubscriptions: ['Netflix'],
  lastScanTs: 1753700000000,
  onboarded: true,
  userName: 'Jerry',
  appLock: false,
  monthStartDay: 25,
  pro: true,
  trialStartTs: 1750000000000,
  marketId: 'ae',
  language: 'en',
};
const full = schema.legacyStateToRows(legacyBlob);
eq('legacy: every collection converts',
  [full.rows.accounts.length, full.rows.transactions.length, full.rows.budgets.length,
   full.rows.bills.length, full.rows.cardDues.length, full.rows.goals.length],
  [2, 2, 1, 1, 1, 1]);
eq('legacy: nothing dropped from a healthy blob', full.dropped,
  { accounts: 0, transactions: 0, budgets: 0, bills: 0, cardDues: 0, goals: 0 });
// The conversion is the migration: what goes in has to come back out intact.
const restored = schema.rowsToState(full.rows);
eq('legacy: accounts survive the trip', restored.accounts, [account, bareAccount]);
eq('legacy: transactions survive the trip', restored.transactions, [tx, bareTx]);
eq('legacy: bills survive the trip', restored.bills, [bill]);
eq('legacy: card dues survive the trip', restored.cardDues, [due]);
eq('legacy: goals survive the trip', restored.goals, [goal]);
eq('legacy: settings survive the trip', restored.userName, 'Jerry');
eq('legacy: monthStartDay survives the trip', restored.monthStartDay, 25);
// Learned maps are keyed lowercase and trimmed, the way the store writes them.
eq('legacy: merchant overrides are normalised', restored.merchantOverrides, { carrefour: 'groceries' });
eq('legacy: account hints keep their last4 key', restored.accountHints, { 4833: 'acc-1' });
eq('legacy: notSubscriptions are lowercased', restored.notSubscriptions, ['netflix']);

// Nothing at all, or nothing usable. Both are ordinary, not exceptional.
eq('legacy: an empty blob converts to nothing', schema.legacyStateToRows({}).rows.transactions, []);
eq('legacy: null converts to nothing', schema.legacyStateToRows(null).rows.accounts, []);
eq('legacy: a string converts to nothing', schema.legacyStateToRows('wat').rows.accounts, []);
eq('legacy: an array converts to nothing', schema.legacyStateToRows([1, 2]).rows.accounts, []);
eq('legacy: collections of the wrong type convert to nothing',
  schema.legacyStateToRows({ transactions: 'nope', accounts: 42 }).rows.transactions, []);

// A blob with no `onboarded` predates the onboarding flow. Anyone holding one
// has plainly used the app, so they are not sent back through the intro.
eq('legacy: a blob with no onboarded flag counts as onboarded',
  schema.rowsToSettings(schema.legacyStateToRows({ transactions: [] }).rows.settings).onboarded, true);
eq('legacy: an explicit onboarded:false is respected',
  schema.rowsToSettings(schema.legacyStateToRows({ onboarded: false }).rows.settings).onboarded, false);

// Rows that cannot be keyed, placed or summed are dropped and counted rather
// than allowed to abort the insert and take the whole ledger down with them.
const messy = schema.legacyStateToRows({
  accounts: [{ name: 'no id' }, null, 'nope', account, { ...account, name: 'duplicate id' }],
  transactions: [
    tx,
    { ...tx, id: 'tx-dup-source' },
    { ...tx, id: 'tx-dup-source' },   // same id twice: first wins
    { ...tx, id: 'no-amount', amountFils: undefined },
    { ...tx, id: 'no-date', date: undefined },
    { id: 'no-anything' },
    null,
  ],
  budgets: [{ category: 'dining', limitFils: 1 }, { category: 'dining', limitFils: 2 },
            { category: 'nonsense', limitFils: 3 }, { category: 'rent' }],
  bills: [{ title: 'no id' }],
  cardDues: [{ id: 'd1' }, { id: 'd2', dueDate: '2026-08-05' }],
  goals: [{}, goal],
});
eq('legacy: unusable rows are dropped, not thrown on', messy.dropped,
  { accounts: 4, transactions: 5, budgets: 3, bills: 1, cardDues: 1, goals: 1 });
eq('legacy: a duplicate id keeps the first occurrence',
  messy.rows.transactions.filter((r) => r.id === 'tx-dup-source').length, 1);
eq('legacy: a duplicate account id keeps the first occurrence',
  messy.rows.accounts.map((r) => r.name), [account.name]);
// A budget's category IS its key, so an unknown one is dropped rather than
// folded into 'other' — that would silently merge two limits into one.
eq('legacy: budgets keep only recognised categories',
  messy.rows.budgets.map((r) => [r.category, r.limit_fils]), [['dining', 1]]);

// Unknown categories on a transaction DO fall back to 'other' — the row is
// still real spending, and dropping it would lose money from the ledger.
eq('legacy: an unknown transaction category becomes other',
  schema.legacyStateToRows({ transactions: [{ ...tx, category: 'crypto' }] }).rows.transactions[0].category,
  'other');
eq('legacy: a missing accountId becomes empty, not a dropped row',
  schema.legacyStateToRows({ transactions: [{ ...tx, accountId: undefined }] }).rows.transactions[0].account_id,
  '');
eq('legacy: a missing title gets a placeholder',
  schema.legacyStateToRows({ transactions: [{ ...tx, title: undefined }] }).rows.transactions[0].title,
  'Transaction');

// Money is integer fils. A float from a hand-edited backup rounds at the
// boundary rather than being stored as a REAL and poisoning every sum.
eq('legacy: fractional fils are rounded',
  schema.legacyStateToRows({ transactions: [{ ...tx, amountFils: 4550.6 }] }).rows.transactions[0].amount_fils,
  4551);
eq('legacy: a NaN amount drops the row',
  schema.legacyStateToRows({ transactions: [{ ...tx, amountFils: NaN }] }).dropped.transactions, 1);
eq('legacy: a string amount drops the row',
  schema.legacyStateToRows({ transactions: [{ ...tx, amountFils: '45.50' }] }).dropped.transactions, 1);

// A due whose bank never quoted a minimum gets the same 5% the importer uses.
eq('legacy: a due with no minimum gets 5%',
  schema.legacyStateToRows({ cardDues: [{ id: 'd', accountId: 'a', totalDueFils: 350000, dueDate: '2026-08-05' }] })
    .rows.cardDues[0].min_due_fils,
  17500);

// dueDay indexes into a month; anything outside 1–31 would place the bill
// outside the month entirely.
eq('legacy: a dueDay of 0 clamps to 1',
  schema.legacyStateToRows({ bills: [{ id: 'b', dueDay: 0, paidMonths: [] }] }).rows.bills[0].due_day, 1);
eq('legacy: a dueDay of 99 clamps to 31',
  schema.legacyStateToRows({ bills: [{ id: 'b', dueDay: 99, paidMonths: [] }] }).rows.bills[0].due_day, 31);
eq('legacy: a bill with no paidMonths gets an empty list',
  schema.legacyStateToRows({ bills: [{ id: 'b', dueDay: 5 }] }).rows.bills[0].paid_months, '[]');
eq('legacy: non-string entries are stripped from paidMonths',
  schema.rowToBill(schema.legacyStateToRows({ bills: [{ id: 'b', dueDay: 5, paidMonths: ['2026-07', 7, null] }] })
    .rows.bills[0]).paidMonths,
  ['2026-07']);

// Learned maps reject entries that could not be used anyway.
const mapEdges = schema.legacyStateToRows({
  merchantOverrides: { netflix: 'entertainment', spotify: 'nonsense', '': 'dining' },
  accountHints: { 1234: 'acc-1', 5678: '' },
  notSubscriptions: ['Netflix', 'netflix', '', 42],
});
eq('legacy: an override with an unknown category is skipped',
  mapEdges.rows.merchantOverrides.map((r) => r.merchant), ['netflix']);
eq('legacy: a hint pointing nowhere is skipped',
  mapEdges.rows.accountHints.map((r) => r.last4), ['1234']);
eq('legacy: notSubscriptions dedupe after lowercasing',
  mapEdges.rows.notSubscriptions.map((r) => r.merchant), ['netflix']);

// The same conversion serves backup restore, so it has to be idempotent:
// feeding it a state it produced must produce the identical state.
const twice = schema.rowsToState(schema.stateToRows(restored));
eq('state → rows → state is stable', twice, restored);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
