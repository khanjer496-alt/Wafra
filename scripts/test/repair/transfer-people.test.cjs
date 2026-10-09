'use strict';
// Transfers grouped by person: who a waiting transfer went to or came from,
// one answer per person through the existing batch save, and one honest count
// of everything waiting (Home's Needs you, the Transfers card, the Transactions
// summary). Real reconciler, real batch resolver and real money rules; fixed
// clock; synthetic rows and names only.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const load = require('./load-typescript.cjs');
const { core, ledger } = require('./load-transfer-ledger.cjs');
const { transferHeavyLedger } = require('../fixtures/transfer-heavy-ledger.cjs');

const root = path.resolve(__dirname, '../../..');
const plain = value => JSON.parse(JSON.stringify(value));
const activityLib = load(path.join(root, 'src/lib/transfer-activity.ts'), { '@/lib/transfer-reconciliation': core });
const people = load(path.join(root, 'src/lib/transfer-people.ts'), {
  '@/lib/transfer-activity': activityLib, '@/lib/transfer-reconciliation': core });
const answers = load(path.join(root, 'src/lib/transfer-answer.ts'), { '@/lib/transfer-reconciliation': core });
const batch = load(path.join(root, 'src/lib/transfer-batch.ts'), { '@/lib/transfer-reconciliation': core });
const filter = load(path.join(root, 'src/lib/transaction-filter.ts'), {
  '@/lib/categories': require('../build/categories.js'),
  '@/lib/format': require('../build/format.js'),
  '@/lib/ledger': ledger,
  '@/lib/splits': require('../build/splits.js'),
  '@/lib/transaction-source': load(path.join(root, 'src/lib/transaction-source.ts')),
});

const NOW = Date.UTC(2026, 9, 9, 8); // fixed clock: 9 Oct 2026, 12:00 in Dubai
const DAY = 86_400_000;
const accounts = [
  { id: 'fab', name: 'FAB Current', kind: 'bank', bankName: 'FAB', last4: '4111', openingFils: 0 },
  { id: 'enbd', name: 'ENBD Savings', kind: 'bank', bankName: 'Emirates NBD', last4: '4222', openingFils: 0 },
];
let clock = 0;
/** A bank transfer alert row: named when `name` is given, nothing else known. */
const transfer = (id, type, amountFils, name, extra = {}) => {
  const ts = NOW - (clock += 1) * DAY;
  return { id, type, amountFils, category: 'other', accountId: type === 'expense' ? 'fab' : 'enbd',
    title: name ? `Transfer ${type === 'expense' ? 'to' : 'from'} ${name}` : type === 'expense' ? 'Outgoing transfer' : 'Incoming transfer',
    date: new Date(ts).toISOString().slice(0, 10), ts, source: 'sms', smsKey: `s${ts}-${id}`,
    transferEvidence: { version: 1, currency: 'AED', attribution: 'source', sourceBank: type === 'expense' ? 'FAB' : 'Emirates NBD',
      ...(name ? { counterpartyName: name } : {}) }, ...extra };
};
const purchase = (id, amountFils) => ({ id, type: 'expense', amountFils, category: 'dining', accountId: 'fab', title: 'Cafe',
  date: '2026-10-01', ts: NOW - 8 * DAY, source: 'sms', smsKey: `s-${id}` });

function ledgerRows() {
  clock = 0;
  return [
    transfer('m1', 'expense', 40_000, 'MARIAM S'),
    transfer('m2', 'income', 15_000, 'Mariam S.'),
    transfer('m3', 'expense', 10_000, 'MARIAM S'),
    transfer('h1', 'expense', 25_000, 'AL-HASHIMI'),
    transfer('h2', 'expense', 5_000, 'Al Hashimi'),
    transfer('u1', 'expense', 7_000),
    transfer('u2', 'income', 3_000),
    // Already answered: someone else, never asked again.
    transfer('done', 'expense', 9_000, 'MARIAM S', { transferDecision: { version: 1, ownership: 'external', decidedAt: NOW - DAY } }),
    // The bank said who it was and that it was not the person: confirmed, never a question.
    transfer('ext', 'expense', 6_000, 'SARA ALI', { transferEvidence: { version: 1, currency: 'AED', attribution: 'source',
      sourceBank: 'FAB', counterpartyName: 'SARA ALI', explicitExternal: true } }),
    purchase('cafe', 2_500),
  ];
}
const assess = rows => {
  const reconciliation = core.reconcileTransfers(rows, accounts);
  return { reconciliation, activity: activityLib.getTransferActivity(rows, accounts, reconciliation) };
};
const totals = (rows) => {
  const { reconciliation } = assess(rows);
  const internal = core.reconciliationInternalIds(reconciliation);
  const live = ledger.liveAccountIds(accounts);
  const sum = predicate => rows.filter(row => predicate(row, live, internal)).reduce((total, row) => total + row.amountFils, 0);
  return { spent: sum(ledger.isSpending), income: sum(ledger.isIncome) };
};

test('a name is grouped by its letters only: case, spacing and banks’ punctuation, nothing more', () => {
  const key = people.transferPersonKey;
  assert.equal(key('MARIAM S.'), key('Mariam S'));
  assert.equal(key('mariam   s'), key('MARIAM S'));
  assert.equal(key('AL-HASHIMI'), key('Al Hashimi'));
  assert.equal(key("D'SOUZA"), key('D SOUZA'));
  // Arabic short vowels and the tatweel are how a name is drawn, not who it names.
  assert.equal(key('مَرْيَم'), key('مريم'));
  assert.equal(key('مـريم'), key('مريم'));
  // Never merged: a title, an accent or an initial can be a different person.
  assert.notEqual(key('MR AHMED KHAN'), key('AHMED KHAN'));
  assert.notEqual(key('José'), key('Jose'));
  assert.notEqual(key('MARIAM S'), key('MARIAM'));
  assert.equal(key('. -'), undefined, 'no letter left: not a person');
});

test('only a name the bank alert stated counts; a title or malformed evidence never invents one', () => {
  assert.equal(people.transferPersonName(transfer('a', 'expense', 1, 'LAYLA H')), 'LAYLA H');
  const titled = { ...transfer('b', 'expense', 1), title: 'Transfer to LAYLA H' };
  assert.equal(people.transferPersonName(titled), undefined);
  const malformed = transfer('c', 'expense', 1, undefined, { transferEvidence: { version: 1, currency: 'AED', attribution: 'source',
    counterpartyName: 'LAYLA 4411' } });
  assert.equal(people.transferPersonName(malformed), undefined, 'the reconciler’s own name validation applies');
});

test('person groups hold every waiting transfer with one person, both directions, newest first', () => {
  const rows = ledgerRows();
  const { activity } = assess(rows);
  const groups = plain(people.transferPeople(activity));
  assert.deepEqual(groups.map(group => [group.key, group.name, group.ids]), [
    ['person:mariam s', 'MARIAM S', ['m1', 'm2', 'm3']],
    ['person:al hashimi', 'AL-HASHIMI', ['h1', 'h2']],
  ], 'most transfers first; the most used spelling (the newest on a tie); unnamed, answered and explicit rows left out');
  const mariam = groups[0];
  assert.deepEqual([mariam.incoming, mariam.outgoing, mariam.inFils, mariam.outFils, mariam.direction],
    [1, 2, 15_000, 50_000, 'between'], 'money in and out are counted apart; one answer then names both directions');
  assert.equal(mariam.initial, 'M');
  assert.equal(groups[1].direction, 'expense');
  assert.equal(people.transferPeople(activity), people.transferPeople(activity), 'cached per activity list');
});

test('a row with own-account evidence keeps its own question and never joins a person', () => {
  clock = 0;
  const out = transfer('pair-out', 'expense', 50_000, 'MARIAM S');
  const into = transfer('pair-in', 'income', 50_000);
  into.ts = out.ts + 60_000; into.date = out.date; into.smsKey = 'pair-in';
  const reconciliation = { byId: new Map([
    ['pair-out', { id: 'pair-out', status: 'likely-own', reason: 'amount-time', counterpartId: 'pair-in', candidateIds: ['pair-in'] }],
    ['pair-in', { id: 'pair-in', status: 'likely-own', reason: 'amount-time', counterpartId: 'pair-out', candidateIds: ['pair-out'] }],
  ]), pendingIds: new Set(['pair-out', 'pair-in']), internalIds: new Set(), groups: [] };
  const activity = activityLib.getTransferActivity([out, into], accounts, reconciliation);
  assert.equal(people.transferPeople(activity).length, 0, 'a likely own-account pair is asked about as its own route');
  const summary = plain(people.transferWaitingSummary(activity));
  assert.deepEqual(summary, { transfers: 1, people: 0, withPeople: 0 }, 'one movement, counted once');
  assert.deepEqual(plain(people.transferQuestions(activity).map(question => question.key)), ['pair-out']);
});

test('the card asks people first, then the reconciler’s queue; unnamed one-offs wait for select mode: everything waiting', () => {
  const rows = ledgerRows();
  const { activity } = assess(rows);
  const questions = people.transferQuestions(activity);
  assert.deepEqual(plain(questions.map(question => question.key)), ['person:mariam s', 'person:al hashimi'],
    'the card walks people and the queue, never each unnamed one-off');
  const unnamed = people.transferUnnamedWaiting(activity);
  assert.deepEqual(plain(unnamed.map(record => record.transaction.id)), ['u1', 'u2'], 'newest first');
  const covered = questions.reduce((sum, question) => sum + (question.kind === 'person' ? question.person.ids.length : 1), 0);
  assert.equal(covered + unnamed.length, people.transferWaitingSummary(activity).transfers,
    'the card\'s questions and the unnamed one-offs are every waiting transfer, each once');
  assert.deepEqual(plain(people.transferWaitingSummary(activity)), { transfers: 7, people: 2, withPeople: 5 });
});

/** Answer one person through the batch request the Transfers page sends. */
function answerPerson(rows, key, answer) {
  const { activity } = assess(rows);
  const person = people.transferPeople(activity).find(group => group.key === key);
  const shown = person.ids.map(id => rows.find(row => row.id === id));
  const item = { key, kind: 'group', ids: person.ids, direction: person.direction,
    expectedFingerprints: batch.freezeTransferRows(shown), expectedGeneration: 1 };
  const decisions = batch.transferBatchDecisions([item], answer);
  return { person, decisions, request: { decisions, expectedFingerprints: item.expectedFingerprints, now: NOW } };
}

test('one person’s answer is one single-entry decision per transfer, never linked, never a group decision', () => {
  const rows = ledgerRows();
  const { decisions, request } = answerPerson(rows, 'person:mariam s', 'own');
  assert.deepEqual(plain(decisions), [{ ids: ['m1'], ownership: 'own' }, { ids: ['m2'], ownership: 'own' }, { ids: ['m3'], ownership: 'own' }]);
  const next = core.applyTransferDecisionBatch(rows, accounts, request);
  for (const id of ['m1', 'm2', 'm3']) {
    const row = next.find(entry => entry.id === id);
    assert.deepEqual(plain(row.transferDecision), { version: 1, ownership: 'own', decidedAt: NOW }, `${id}: own, no pair link`);
    assert.equal(row.transferMatch, undefined);
  }
  for (const id of ['h1', 'h2', 'u1', 'u2', 'done', 'cafe']) {
    assert.equal(next.find(entry => entry.id === id), rows.find(entry => entry.id === id), `${id} untouched`);
  }
  const after = assess(next);
  assert.equal(people.transferPeople(after.activity).some(group => group.key === 'person:mariam s'), false, 'answered, no longer asked');
  assert.equal(people.transferWaitingSummary(after.activity).transfers, 4);
});

test('totals: someone else counts, own stays out, not a transfer counts as ordinary; waiting stays out until answered', () => {
  const rows = ledgerRows();
  const before = totals(rows);
  // Only the café, the answered "someone else" and the bank's explicit external count yet.
  assert.deepEqual(before, { spent: 2_500 + 9_000 + 6_000, income: 0 });
  const external = core.applyTransferDecisionBatch(rows, accounts, answerPerson(rows, 'person:mariam s', 'external').request);
  assert.deepEqual(totals(external), { spent: before.spent + 50_000, income: 15_000 }, 'paid someone else and received from someone');
  const own = core.applyTransferDecisionBatch(rows, accounts, answerPerson(rows, 'person:mariam s', 'own').request);
  assert.deepEqual(totals(own), before, 'own money moved between the person’s accounts: neither spending nor income');
  const none = core.applyTransferDecisionBatch(rows, accounts, answerPerson(rows, 'person:mariam s', 'none').request);
  assert.deepEqual(totals(none), { spent: before.spent + 50_000, income: 15_000 }, 'an ordinary purchase and income');
  const { reconciliation } = assess(none);
  for (const id of ['m1', 'm2', 'm3']) assert.equal(reconciliation.byId.has(id), false, 'not a transfer leaves the graph');
});

test('Undo clears exactly the person’s answers and restores the same graph; a changed transfer refuses the whole save', () => {
  const rows = ledgerRows();
  const { request, decisions } = answerPerson(rows, 'person:mariam s', 'external');
  const saved = core.applyTransferDecisionBatch(rows, accounts, request);
  const byId = new Map(saved.map(row => [row.id, row]));
  const after = answers.savedAnswerFingerprints(answers.expectedTransferDecisions(decisions), byId, NOW);
  assert.ok(after, 'the save is recognised as exactly this answer');
  const undo = answers.buildTransferUndoMany({ rows: ['m1', 'm2', 'm3'].map(id => byId.get(id)), generation: 2 });
  assert.deepEqual(undo.expectedFingerprints, after);
  const undone = core.applyTransferDecisionBatch(saved, accounts, { ...undo, now: NOW + 1 });
  assert.deepEqual(plain(undone), plain(rows), 'every row as it was');
  const original = core.reconcileTransfers(rows, accounts);
  const restored = core.reconcileTransfers(undone, accounts);
  assert.deepEqual(plain([...restored.byId]), plain([...original.byId]));
  assert.deepEqual([...restored.pendingIds].sort(), [...original.pendingIds].sort());
  assert.deepEqual([...restored.internalIds].sort(), [...original.internalIds].sort());

  // A transfer edited after the person was picked: nothing is written, and the page says it changed.
  const edited = rows.map(row => row.id === 'm2' ? { ...row, amountFils: 15_100 } : row);
  let refusal;
  try { core.applyTransferDecisionBatch(edited, accounts, request); } catch (error) { refusal = error; }
  assert.ok(refusal, 'the whole save is refused');
  assert.equal(answers.isStaleTransferRejection(refusal), true, 'reported as "These transfers changed", not a failed save');
  assert.equal(batch.transferRowsChanged(request.expectedFingerprints, new Map(edited.map(row => [row.id, row]))), true,
    'the open sheet sees it too');
});

test('Home’s Needs you, the Transfers card and the Transactions summary give one number', () => {
  const rows = ledgerRows();
  const { reconciliation, activity } = assess(rows);
  const home = people.transferWaitingSummary(activity).transfers;
  const unasked = activityLib.unaskedPendingIds(activity, reconciliation.pendingIds).size;
  const card = people.transferWaitingSummary(activity).transfers + unasked;
  const index = filter.createTransactionFilterIndex(rows, 'en');
  const projection = filter.projectTransactionFilter(index, { type: null, accountId: null, categories: new Set(), datePreset: 'all',
    dateFrom: null, dateTo: null, minFils: null, sort: 'newest' }, {
    query: '', merchant: null, smsOnly: false, currentKey: '2026-10', period: { mode: 'all' },
    live: ledger.liveAccountIds(accounts), internal: core.reconciliationInternalIds(reconciliation), corroborating: reconciliation.corroboratingIds,
    separateTransferIds: new Set(activity.map(item => item.transaction.id)),
    reviewTransferIds: new Set(activity.filter(item => !item.confirmed).map(item => item.transaction.id)),
    separatedPartnerIds: activityLib.transferPartnerIds(activity) });
  assert.equal(home, 7);
  assert.equal(card, home);
  assert.equal(projection.separatedTransfers.reviewCount, home, 'all time, no filter: the same transfers');
});

test('15k rows with ~3k named transfers: people, the count and the questions in one short pass, no pairwise work', () => {
  const run = (count, candidates) => {
    const fixture = transferHeavyLedger(count, candidates, 7, { named: true });
    const reconciliation = core.reconcileTransfers(fixture.transactions, fixture.accounts);
    const started = performance.now();
    const activity = activityLib.getTransferActivity(fixture.transactions, fixture.accounts, reconciliation);
    const groups = people.transferPeople(activity);
    const summary = people.transferWaitingSummary(activity);
    const questions = people.transferQuestions(activity);
    const unnamed = people.transferUnnamedWaiting(activity);
    return { ms: performance.now() - started, groups, summary, questions, unnamed, activity };
  };
  run(3000, 600); // warm the loader
  const big = run(15000, 3000);
  // Forty names in four spellings each fold into forty people.
  assert.equal(big.groups.length, 40);
  assert.ok(big.groups[0].ids.length > 100, 'the most frequent person collects every spelling of the name');
  assert.ok(big.summary.withPeople > 1500, `${big.summary.withPeople} transfers with people`);
  const covered = big.questions.reduce((sum, question) => sum + (question.kind === 'person' ? question.person.ids.length : 1), 0);
  assert.equal(covered + big.unnamed.length, big.summary.transfers, 'the questions and the unnamed one-offs reach every waiting transfer');
  assert.ok(big.ms < 400, `activity, people, count and questions took ${big.ms.toFixed(1)}ms`);
  const double = run(30000, 6000);
  assert.ok(double.ms < big.ms * 4 + 50, `twice the ledger took ${double.ms.toFixed(1)}ms vs ${big.ms.toFixed(1)}ms: linear, not quadratic`);
});
