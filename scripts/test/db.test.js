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

// ── replaceAll: what a restore is allowed to destroy ──
// db.replaceAll truncates REPLACEABLE_TABLES and merges the settings it was
// given. The bug this replaced truncated `settings` too, so restoring a
// transactions-only backup read every setting back at its default: biometric
// lock silently off, Pro revoked, every budget window recomputed against day 1,
// RTL dropped. Nothing told the user any of it had happened.
ok('replaceAll does not truncate settings', !schema.REPLACEABLE_TABLES.includes('settings'));
eq('replaceAll truncates every other table',
  schema.ALL_TABLES.filter((t) => t !== 'settings'), [...schema.REPLACEABLE_TABLES]);
ok('replaceAll never truncates meta', !schema.REPLACEABLE_TABLES.includes('meta'));

// The evidence: the whole-state mapper emits one settings row for a payload
// that carries no settings, and it is the invented one.
eq('a settings-less payload maps to exactly the invented onboarded row',
  schema.stateToRows({ transactions: [tx] }).settings, [{ key: 'onboarded', value: 'true' }]);

// The replacement path emits none, so nothing stored is disturbed.
const partial = schema.stateToReplacement({ transactions: [tx] });
eq('a transactions-only restore writes no settings at all', partial.settings, []);
eq('a transactions-only restore inserts no settings rows', partial.rows.settings, []);
eq('a transactions-only restore still carries its transactions',
  partial.rows.transactions.map((r) => r.id), ['tx-1']);

// The regression itself, played out against the settings table. `stored` is the
// user before the restore; only the keys the payload names may change.
const stored = schema.settingsToRows({
  lastScanTs: 1753700000000, onboarded: true, userName: 'Jerry', appLock: true,
  monthStartDay: 25, pro: true, trialStartTs: 1750000000000, marketId: 'ae', language: 'ar',
});
function applyReplacement(existing, replacement) {
  const byKey = new Map(existing.map((r) => [r.key, r.value]));
  for (const row of replacement.settings) byKey.set(row.key, row.value);
  return [...byKey].map(([key, value]) => ({ key, value }));
}
eq('restoring a transactions-only backup keeps app lock, Pro, month start and language',
  schema.rowsToSettings(applyReplacement(stored, partial)),
  { lastScanTs: 1753700000000, onboarded: true, userName: 'Jerry', appLock: true,
    monthStartDay: 25, pro: true, trialStartTs: 1750000000000, marketId: 'ae', language: 'ar' });

// Demo data names no security or entitlement setting either, and loading it is
// not a request to give up a purchase.
eq('loading demo data does not revoke Pro or disarm the lock',
  schema.rowsToSettings(applyReplacement(stored, schema.stateToReplacement({
    accounts: [bareAccount], transactions: [bareTx], onboarded: true, userName: 'there',
  }))),
  { lastScanTs: 1753700000000, onboarded: true, userName: 'there', appLock: true,
    monthStartDay: 25, pro: true, trialStartTs: 1750000000000, marketId: 'ae', language: 'ar' });

// A full backup carries every setting, so a full restore still replaces every
// setting — the merge changes the partial case, not this one.
const fullRestore = schema.stateToReplacement({
  transactions: [tx],
  lastScanTs: 0, onboarded: false, userName: 'Ada', appLock: false, monthStartDay: 1,
  pro: false, trialStartTs: 0, marketId: 'sa', language: 'en',
});
eq('a full backup restore overwrites every setting',
  schema.rowsToSettings(applyReplacement(stored, fullRestore)),
  { lastScanTs: 0, onboarded: false, userName: 'Ada', appLock: false, monthStartDay: 1,
    pro: false, trialStartTs: 0, marketId: 'sa', language: 'en' });
// "Absent" and "explicitly false" are different requests and must stay so.
eq('an explicit appLock:false is written, not skipped',
  schema.stateToReplacement({ appLock: false }).settings, [{ key: 'appLock', value: 'false' }]);
eq('an omitted appLock is not written',
  schema.stateToReplacement({ pro: true }).settings, [{ key: 'pro', value: 'true' }]);
// The pre-onboarding heuristic belongs to the AsyncStorage migration only. A
// restore that never mentions `onboarded` must not decide the user is past it.
eq('a restore does not invent onboarded', schema.stateToReplacement({}).settings, []);
eq('the legacy import still assumes onboarded',
  schema.scalarSettingsFrom({ transactions: [] }, true).onboarded, true);
eq('everything else still assumes nothing',
  schema.scalarSettingsFrom({ transactions: [] }).onboarded, undefined);
// Values are coerced on the way in, so a hand-edited backup cannot store a
// string where a number belongs and blank the setting on the next read.
eq('a wrong-typed setting in a payload is dropped, not written',
  schema.stateToReplacement({ monthStartDay: '25', appLock: 'yes' }).settings, []);

// ── the legacy AsyncStorage layout ──
// The meta key is rewritten on every state change; the :tx:N chunks only when
// their contents change. So a kill mid-write truncates the meta key while the
// chunks holding the entire history stay intact, and reading "meta will not
// parse" as "fresh install" throws that history away permanently.
eq('a missing meta key is absent', schema.parseLegacyMeta(null).kind, 'absent');
eq('an undefined meta key is absent', schema.parseLegacyMeta(undefined).kind, 'absent');
// A zero-byte value is a write that got as far as truncating the old one.
eq('an empty meta key is corrupt, not absent', schema.parseLegacyMeta('').kind, 'corrupt');
eq('a truncated meta key is corrupt',
  schema.parseLegacyMeta('{"accounts":[],"txChunks":13,"userNam').kind, 'corrupt');
eq('a meta key holding a bare string is corrupt', schema.parseLegacyMeta('"hi"').kind, 'corrupt');
eq('a meta key holding an array is corrupt', schema.parseLegacyMeta('[1,2]').kind, 'corrupt');
eq('a meta key holding null is corrupt', schema.parseLegacyMeta('null').kind, 'corrupt');
const okMeta = schema.parseLegacyMeta(JSON.stringify({ userName: 'Jerry', txChunks: 13 }));
eq('a healthy meta key reports its chunk count', [okMeta.kind, okMeta.chunks], ['ok', 13]);
eq('a healthy meta key keeps its state', okMeta.state.userName, 'Jerry');
eq('a negative chunk count reads as none',
  schema.parseLegacyMeta(JSON.stringify({ txChunks: -4 })).chunks, 0);
eq('a non-numeric chunk count reads as none',
  schema.parseLegacyMeta(JSON.stringify({ txChunks: 'lots' })).chunks, 0);
// Pre-chunking builds stored transactions inline.
const inlineMeta = schema.parseLegacyMeta(JSON.stringify({ transactions: [tx] }));
eq('an inline-transactions meta key is recognised',
  [inlineMeta.kind, inlineMeta.inlineTransactions, inlineMeta.chunks], ['ok', true, 0]);

// Chunk keys are found by scanning, because a truncated meta key has no count
// to trust and a partly applied multiSet can leave the count one chunk behind.
const diskKeys = [
  'wafra/state/v1', 'wafra/state/v1:tx:0', 'wafra/state/v1:tx:10', 'wafra/state/v1:tx:2',
  'wafra/state/v1:tx:2', 'wafra/state/v1:tx:007', 'wafra/state/v1:tx:', 'wafra/state/v1:tx:1x',
  'wafra/state/v2:tx:3', 'some-other-library/cache',
];
eq('chunk indices sort numerically, not lexically',
  schema.legacyChunkIndices(diskKeys), [0, 2, 10]);
eq('a duplicated key counts once', schema.legacyChunkIndices(['wafra/state/v1:tx:4', 'wafra/state/v1:tx:4']), [4]);
eq('no keys means no chunks', schema.legacyChunkIndices([]), []);
// Reclaim may only delete keys the import could read — never a `:tx:007` that
// no build writes and legacyChunkIndices refuses, and never another library's.
eq('reclaim sweeps the meta key and every readable chunk, and nothing else',
  schema.legacyKeysToReclaim(diskKeys),
  ['wafra/state/v1', 'wafra/state/v1:tx:0', 'wafra/state/v1:tx:2', 'wafra/state/v1:tx:10']);
eq('reclaim never deletes a chunk the import skipped',
  schema.legacyKeysToReclaim(['wafra/state/v1:tx:007']), []);
eq('reclaim finds the chunks even with the meta key already gone',
  schema.legacyKeysToReclaim(['wafra/state/v1:tx:1']), ['wafra/state/v1:tx:1']);
eq('reclaim on a device with nothing left removes nothing', schema.legacyKeysToReclaim([]), []);
eq('legacyChunkKey matches what the scanner accepts',
  schema.legacyChunkIndices([schema.legacyChunkKey(0), schema.legacyChunkKey(12)]), [0, 12]);

// The decision the whole defect turns on.
const chunkKeys13 = Array.from({ length: 13 }, (_, i) => schema.legacyChunkKey(i));
const truncated = schema.planLegacyImport(
  schema.parseLegacyMeta('{"accounts":[],"txChunks":13,"userNam'),
  schema.legacyChunkIndices([schema.LEGACY_STATE_KEY, ...chunkKeys13]),
);
eq('a truncated meta key beside intact chunks is not a fresh install', truncated.action, 'import');
eq('...and is flagged as a recovery, not an ordinary import', truncated.source, 'orphaned-chunks');
eq('...and reads every chunk on disk', [...truncated.chunkIndices],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
// Chunks with no meta key at all — an interrupted reclaim, or a meta key that
// never came back from a write — are the same rescue.
eq('orphaned chunks with no meta key are still imported',
  schema.planLegacyImport(schema.parseLegacyMeta(null), [0, 1]).source, 'orphaned-chunks');
// Only a device with genuinely nothing on it is a fresh install.
eq('nothing at all is a fresh install',
  schema.planLegacyImport(schema.parseLegacyMeta(null), []),
  { action: 'skip', reason: 'fresh-install' });
// A corrupt meta key with nothing behind it imports nothing either, but it is
// not the same event and the caller has to be able to tell the user so.
eq('a corrupt meta key with no chunks is unreadable, not fresh',
  schema.planLegacyImport(schema.parseLegacyMeta('{oops'), []),
  { action: 'skip', reason: 'unreadable' });

// A healthy meta key drives the import as before...
const healthy = schema.planLegacyImport(
  schema.parseLegacyMeta(JSON.stringify({ userName: 'Jerry', txChunks: 3 })),
  [0, 1, 2],
);
eq('a healthy blob imports from its meta key', [healthy.action, healthy.source], ['import', 'meta']);
eq('a healthy blob reads the chunks it claims', [...healthy.chunkIndices], [0, 1, 2]);
// ...but a chunk the meta key never learned about is read anyway: store.tsx
// writes the meta and the changed chunks in one multiSet, and a partial one
// leaves the count behind the rows.
eq('a chunk the meta count missed is still read',
  [...schema.planLegacyImport(
    schema.parseLegacyMeta(JSON.stringify({ txChunks: 3 })), [0, 1, 2, 3],
  ).chunkIndices],
  [0, 1, 2, 3]);
// Inline transactions are the whole ledger by themselves; reading rolled-back
// chunk residue beside them would duplicate or resurrect rows.
eq('inline transactions ignore chunk residue',
  [...schema.planLegacyImport(inlineMeta, [0, 1]).chunkIndices], []);
eq('a healthy blob with no transactions reads no chunks',
  [...schema.planLegacyImport(schema.parseLegacyMeta('{}'), []).chunkIndices], []);

// End to end: 5,000 transactions across 13 chunks, meta key truncated. Every
// row has to reach the database, and the user must not be sent back through
// onboarding on the strength of a meta key that no longer parses.
const bigChunks = [];
for (let i = 0; i < 5000; i++) {
  const chunk = Math.floor(i / 400);
  (bigChunks[chunk] ||= []).push({ ...tx, id: `tx-${i}`, smsKey: `s${i}` });
}
const rescuePlan = schema.planLegacyImport(
  schema.parseLegacyMeta('{"accounts":[{"id":"acc-1"'),
  schema.legacyChunkIndices(bigChunks.map((_, i) => schema.legacyChunkKey(i))),
);
const rescued = { ...rescuePlan.state };
rescued.transactions = rescuePlan.chunkIndices.flatMap((i) => JSON.parse(JSON.stringify(bigChunks[i])));
const rescuedRows = schema.legacyStateToRows(rescued);
eq('a truncated meta key still rescues all 5,000 transactions',
  rescuedRows.rows.transactions.length, 5000);
eq('...dropping none of them', rescuedRows.dropped.transactions, 0);
eq('...and does not send the user back through onboarding',
  schema.rowsToSettings(rescuedRows.rows.settings).onboarded, true);
// A single unreadable chunk costs its own ~400 rows and nothing more.
const holed = rescuePlan.chunkIndices
  .filter((i) => i !== 5)
  .flatMap((i) => JSON.parse(JSON.stringify(bigChunks[i])));
eq('one unreadable chunk costs only its own rows',
  schema.legacyStateToRows({ transactions: holed }).rows.transactions.length, 4600);

// ── WAL sidecars ──
// expo-sqlite's deleteDatabaseAsync removes only the main file (ios/
// SQLiteModule.swift and android/.../SQLiteModule.kt both call removeItem /
// File.delete on the one path), so a reset that stops there leaves committed
// ledger pages in -wal — and leaves a -wal written under the old key beside the
// new database, which is what makes the key-loss error unrecoverable.
eq('both sidecars are named',
  schema.walSidecarUris('/data/user/0/com.wafra/files/SQLite', 'wafra.db'),
  ['file:///data/user/0/com.wafra/files/SQLite/wafra.db-wal',
   'file:///data/user/0/com.wafra/files/SQLite/wafra.db-shm']);
// expo-file-system rejects a bare path: iOS checks url.isFileURL.
ok('every sidecar uri carries the file scheme',
  schema.walSidecarUris('/x/SQLite', 'wafra.db').every((u) => u.startsWith('file:///')));
eq('a directory that is already a uri is not double-prefixed',
  schema.walSidecarUris('file:///x/SQLite', 'wafra.db')[0], 'file:///x/SQLite/wafra.db-wal');
eq('a trailing slash does not double up',
  schema.walSidecarUris('/x/SQLite/', 'wafra.db')[0], 'file:///x/SQLite/wafra.db-wal');
eq('a leading slash on the name does not double up',
  schema.walSidecarUris('/x/SQLite', '/wafra.db')[0], 'file:///x/SQLite/wafra.db-wal');
ok('the main database file is not among them',
  schema.walSidecarUris('/x/SQLite', 'wafra.db').every((u) => !u.endsWith('/wafra.db')));

// ── against a real SQLite ──
// Everything above proves what the mappers decide. This proves the statements
// db.ts builds out of them actually run, and that the replaceAll sequence —
// DELETE the ledger tables, insert, merge settings — behaves in a database the
// way it does in the model above. SQLCipher is not needed for any of it: the
// migrations are plain DDL, and `PRAGMA key` is db.ts's business.
let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch { /* older Node: skip */ }
if (!DatabaseSync) {
  console.log('· node:sqlite unavailable — SQL execution tests skipped');
} else {
  const sql = new DatabaseSync(':memory:');
  // Exactly what migrate() does, minus the transaction wrapper.
  for (const migration of schema.migrationsToApply(0)) {
    for (const statement of migration.statements) sql.exec(statement);
    sql.exec(`PRAGMA user_version = ${migration.version}`);
  }
  ok('every migration statement is valid SQLite', true);
  eq('migrating from scratch lands on SCHEMA_VERSION',
    sql.prepare('PRAGMA user_version').get().user_version, schema.SCHEMA_VERSION);
  // Replaying is what a crash mid-migration forces; it must not throw.
  for (const migration of schema.MIGRATIONS) {
    for (const statement of migration.statements) sql.exec(statement);
  }
  ok('replaying every migration over a live schema is a no-op', true);

  // insertRows(), in miniature.
  function insertRows(rows) {
    for (const { table, key } of schema.TABLE_SOURCES) {
      const statement = sql.prepare(schema.upsertSql(table));
      for (const row of rows[key]) statement.run(...schema.rowValues(table, row));
    }
  }
  const seeded = schema.legacyStateToRows(legacyBlob).rows;
  insertRows(seeded);
  ok('every table accepts the columns upsertSql names', true);
  eq('the seeded ledger reads back whole',
    [sql.prepare('SELECT count(*) n FROM transactions').get().n,
     sql.prepare('SELECT count(*) n FROM accounts').get().n,
     sql.prepare('SELECT count(*) n FROM bills').get().n], [2, 2, 1]);
  // The settings the user actually has, written the way saveSettings does.
  for (const row of schema.settingsToRows({ appLock: true, pro: true, monthStartDay: 25, language: 'ar' })) {
    sql.prepare(schema.upsertSql('settings')).run(row.key, row.value);
  }

  // The defect, reproduced: the sequence replaceAll used to run — truncate
  // ALL_TABLES (settings among them) and insert stateToRows(payload) — against
  // the same database and the same transactions-only backup.
  const beforeFix = new DatabaseSync(':memory:');
  for (const migration of schema.migrationsToApply(0)) {
    for (const statement of migration.statements) beforeFix.exec(statement);
  }
  for (const row of schema.settingsToRows({ appLock: true, pro: true, monthStartDay: 25, language: 'ar' })) {
    beforeFix.prepare(schema.upsertSql('settings')).run(row.key, row.value);
  }
  for (const table of schema.ALL_TABLES) beforeFix.exec(`DELETE FROM ${table}`);
  for (const row of schema.stateToRows({ transactions: [{ ...tx, id: 'restored-1' }] }).settings) {
    beforeFix.prepare(schema.upsertSql('settings')).run(row.key, row.value);
  }
  eq('truncating settings silently disarms the lock, revokes Pro, moves the month and drops RTL',
    schema.rowsToSettings(beforeFix.prepare('SELECT key, value FROM settings').all()),
    { ...schema.DEFAULT_SETTINGS, onboarded: true });
  beforeFix.close();

  // db.replaceAll(), statement for statement, with a transactions-only backup.
  const replacement = schema.stateToReplacement({ transactions: [{ ...tx, id: 'restored-1' }] });
  for (const table of schema.REPLACEABLE_TABLES) sql.exec(`DELETE FROM ${table}`);
  insertRows(replacement.rows);
  for (const row of replacement.settings) {
    sql.prepare(schema.upsertSql('settings')).run(row.key, row.value);
  }
  eq('replaceAll replaces the ledger',
    sql.prepare('SELECT id FROM transactions').all().map((r) => r.id), ['restored-1']);
  eq('replaceAll empties the other collections',
    [sql.prepare('SELECT count(*) n FROM accounts').get().n,
     sql.prepare('SELECT count(*) n FROM bills').get().n,
     sql.prepare('SELECT count(*) n FROM goals').get().n], [0, 0, 0]);
  // The defect, in a database: app lock stayed armed, Pro stayed paid for, the
  // month still turns over on the 25th and the UI is still Arabic.
  eq('replaceAll leaves the settings the backup never mentioned',
    schema.rowsToSettings(sql.prepare('SELECT key, value FROM settings').all()),
    { lastScanTs: 1753700000000, onboarded: true, userName: 'Jerry', appLock: true,
      monthStartDay: 25, pro: true, trialStartTs: 1750000000000, marketId: 'ae', language: 'ar' });

  // clearAll() is the deliberate "erase everything", and it does take settings.
  for (const table of schema.ALL_TABLES) sql.exec(`DELETE FROM ${table}`);
  eq('clearAll does empty settings', sql.prepare('SELECT count(*) n FROM settings').get().n, 0);
  // meta is not in ALL_TABLES: losing it re-runs the legacy import over a live
  // ledger and resurrects every row the user has deleted since.
  sql.prepare(schema.upsertSql('meta')).run(schema.META_LEGACY_IMPORTED, '1');
  for (const table of schema.ALL_TABLES) sql.exec(`DELETE FROM ${table}`);
  eq('clearAll does not forget that the legacy import already ran',
    sql.prepare('SELECT value FROM meta WHERE key = ?').get(schema.META_LEGACY_IMPORTED).value, '1');
  sql.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
