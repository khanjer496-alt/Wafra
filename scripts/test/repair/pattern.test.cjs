'use strict';
// The personal pattern (design language E): deterministic, composed exactly
// as the approved boards, and never carrying money.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
// Loaded in its own VM realm: hand plain values back so deepEqual compares content.
const plain = (value) => value === undefined ? value : JSON.parse(JSON.stringify(value));
const loaded = load(path.join(root, 'src/lib/pattern.ts'));
const pattern = Object.fromEntries(Object.entries(loaded).map(([name, value]) =>
  [name, typeof value === 'function' ? (...args) => plain(value(...args)) : value]));
const types = require('../build/types.js');
const { isValidBackupState, BACKUP_GOAL_IDS } = require('../build/backup-validation.js');
const { loadStore } = require('../../perf/load-store.cjs');

const ALL_GOALS = ['salary', 'bills', 'subscriptions', 'spend-less', 'cash-cards'];
const cells = (tiles) => tiles.map((tile) => `${tile.col}:${tile.row}:${tile.kind}:${tile.color}${tile.mark ? '/' + tile.mark : ''}${tile.rotation ? '@' + tile.rotation : ''}`).sort();

test("Sara's answers draw exactly the boards' header pattern (M_NAME + M_GOALS + M_WATCH + M_REMIND)", () => {
  const tiles = pattern.buildPattern({
    name: 'Sara', goals: ALL_GOALS, watched: ['dining', 'groceries'],
    reminders: { bills: true, cards: true, dailySummary: true },
  });
  assert.deepEqual(cells(tiles), [
    // boards_e.py, cell by cell
    '0:0:letter:clay/cream',
    '1:0:quarter:green@90',
    '2:0:circle:mint',
    '1:1:ring:green',
    '0:1:half:ochre',
    '4:0:quarter:clay@180',
    '3:0:glyph:sand/clay',
    '2:1:glyph:sand/green',
    '5:0:dot:ochre',
    '3:1:dot:cream',
    '4:1:ring:ochre',
    '5:1:bars:mint',
  ].sort());
  assert.equal(tiles.find((tile) => tile.kind === 'letter').letter, 'S');
  assert.deepEqual(tiles.filter((tile) => tile.kind === 'glyph').map((tile) => tile.category), ['dining', 'groceries']);
});

test('the same answers always draw the same pattern, in any order', () => {
  const a = pattern.buildPattern({ name: 'layla', goals: ['bills', 'salary'], watched: ['transport'], reminders: { cards: true } });
  const b = pattern.buildPattern({ name: 'layla', goals: ['salary', 'bills', 'bills'], watched: ['transport'], reminders: { cards: true } });
  assert.deepEqual(a, b);
  assert.deepEqual(a, pattern.buildPattern(JSON.parse(JSON.stringify({ name: 'layla', goals: ['bills', 'salary'], watched: ['transport'], reminders: { cards: true } }))));
  assert.deepEqual(a.map((tile) => tile.order), a.map((_tile, index) => index), 'reveal order is the build order');
});

test('it never leaves the 6 × 2 grid and never stacks two tiles in one cell', () => {
  const tiles = pattern.buildPattern({ name: 'Omar', goals: ALL_GOALS, watched: ['dining', 'groceries', 'shopping', 'transport'],
    reminders: { bills: true, cards: true, dailySummary: true } });
  assert.ok(tiles.length <= pattern.PATTERN_COLUMNS * pattern.PATTERN_ROWS);
  assert.equal(pattern.PATTERN_COLUMNS, 6);
  assert.equal(pattern.PATTERN_ROWS, 2);
  for (const tile of tiles) {
    assert.ok(tile.col >= 0 && tile.col < 6 && tile.row >= 0 && tile.row < 2, tile.key);
  }
  assert.equal(new Set(tiles.map((tile) => `${tile.col}:${tile.row}`)).size, tiles.length);
  assert.equal(tiles.filter((tile) => tile.group === 'watch').length, 2, 'two watched categories at most');
});

test('a missing answer leaves its cell empty rather than inventing one', () => {
  const bare = pattern.buildPattern({});
  assert.deepEqual(bare.map((tile) => [tile.kind, tile.col, tile.row]), [['square', 0, 0]], 'no name: a plain tile, not a made-up letter');
  const named = pattern.buildPattern({ name: '  نورة ' });
  assert.equal(named[0].letter, 'ن', 'Arabic names keep their first letter');
  assert.equal(pattern.patternInitial('7eleven'), null, 'only a letter becomes the initial');
  assert.equal(pattern.patternInitial('élodie'), 'É');
  assert.equal(pattern.buildPattern({ reminders: { bills: false, cards: false, dailySummary: false } }).length, 1);
});

test('no money ever enters it: limits, balances and amounts cannot change the pattern', () => {
  const base = {
    userName: 'Sara', wafraGoals: ['bills'], dailySummary: false,
    budgets: [{ category: 'dining', limitFils: 120000 }, { category: 'groceries', limitFils: 200000 }],
    bills: [{ id: 'b', title: 'DEWA', category: 'utilities', amountFils: 42000, dueDay: 3, paidMonths: [] }],
    cardDues: [], accounts: [{ id: 'c', name: 'Card', kind: 'card', cardType: 'credit', openingFils: 0, color: '#000', snapshotFils: 318000 }],
  };
  const input = pattern.patternInputFromState(base);
  assert.deepEqual(Object.keys(input).sort(), ['goals', 'name', 'reminders', 'watched']);
  const serialized = JSON.stringify(input);
  for (const amount of ['120000', '200000', '42000', '318000']) assert.ok(!serialized.includes(amount), `input carries ${amount}`);
  const richer = { ...base,
    budgets: base.budgets.map((budget) => ({ ...budget, limitFils: budget.limitFils * 37 })),
    bills: base.bills.map((bill) => ({ ...bill, amountFils: 1 })),
    accounts: base.accounts.map((account) => ({ ...account, snapshotFils: 99999999 })) };
  assert.deepEqual(pattern.buildPattern(pattern.patternInputFromState(richer)), pattern.buildPattern(input));
  const tiles = pattern.buildPattern(input);
  const allowed = new Set(['key', 'group', 'kind', 'col', 'row', 'color', 'mark', 'rotation', 'category', 'letter', 'order']);
  for (const tile of tiles) {
    for (const [key, value] of Object.entries(tile)) {
      assert.ok(allowed.has(key), `unexpected tile field ${key}`);
      if (typeof value === 'number') assert.ok(['col', 'row', 'rotation', 'order'].includes(key) && value <= 270, `${key}=${value}`);
    }
  }
  const palette = new Set(['ink', 'clay', 'ochre', 'slate', 'green', 'mint', 'sand', 'cream']);
  assert.ok(tiles.every((tile) => palette.has(tile.color) && (tile.mark === undefined || palette.has(tile.mark))), 'palette tokens only');
});

test('state mapping: the placeholder name is no name; watched = limited categories; reminders = what can be reminded', () => {
  const input = pattern.patternInputFromState({ userName: 'there', budgets: [], bills: [], cardDues: [], accounts: [], dailySummary: true });
  assert.equal(input.name, null);
  assert.deepEqual(input.goals, []);
  assert.deepEqual(input.reminders, { bills: false, cards: false, dailySummary: true });
  const card = pattern.patternInputFromState({ userName: 'A', budgets: [{ category: 'dining', limitFils: 1 }], bills: [], cardDues: [],
    accounts: [{ id: 'x', kind: 'card', cardType: 'credit', archived: true }], dailySummary: false });
  assert.equal(card.reminders.cards, false, 'an archived card has nothing to remind about');
  assert.deepEqual(card.watched, ['dining']);
});

test('goal ids: known ids only, once each, canonical order; backups validate them the same way', () => {
  assert.deepEqual([...types.GOAL_IDS], ALL_GOALS);
  assert.deepEqual([...BACKUP_GOAL_IDS], [...types.GOAL_IDS], 'backup-validation spells the same five ids');
  assert.deepEqual(types.sanitizeGoalIds(['subscriptions', 'bills', 'bills', 'rich', 7]), ['bills', 'subscriptions']);
  assert.equal(types.sanitizeGoalIds('bills'), undefined);
  assert.equal(isValidBackupState({ transactions: [], wafraGoals: ['bills', 'salary'] }), true);
  assert.equal(isValidBackupState({ transactions: [] }), true, 'older backups without goals still restore');
  for (const invalid of [['bills', 'bills'], ['retire-early'], 'bills', [1], {}]) {
    assert.equal(isValidBackupState({ transactions: [], wafraGoals: invalid }), false, JSON.stringify(invalid));
  }
});

test('the store saves goals and drops anything unknown on hydrate and restore', () => {
  const { reducer } = loadStore();
  const hydrated = reducer({}, { type: 'hydrate', state: { onboarded: true, wafraGoals: ['bills', 'nope', 'salary'] } });
  assert.deepEqual(hydrated.wafraGoals, ['salary', 'bills']);
  const set = reducer(hydrated, { type: 'setGoals', goals: ['cash-cards', 'spend-less', 'cash-cards'] });
  assert.deepEqual(set.wafraGoals, ['spend-less', 'cash-cards']);
  const legacy = reducer(set, { type: 'hydrate', state: { onboarded: true } });
  assert.equal('wafraGoals' in legacy, false, 'a ledger from before goals stays without them');
  const garbage = reducer(set, { type: 'restore', state: { onboarded: true, wafraGoals: 'bills' } });
  assert.equal('wafraGoals' in garbage, false);
});
