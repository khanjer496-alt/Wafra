'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const presentation = load(path.resolve(__dirname, '../../../src/lib/transfer-review-presentation.ts'));
const { projectTransferHistory, transferHistoryItems, transferAccountLabel, transferRecentStart, transferSearchText } = presentation;
const tx = (id, date = '2026-09-09', extra = {}) => ({ id, date, type: 'expense', title: 'Outgoing transfer',
  amountFils: 10000, accountId: 'wio', category: 'other', source: 'sms', ...extra });
const group = (id, rows, extra = {}) => ({ id, transactionIds: rows.map(row => row.id), accountId: 'wio',
  direction: 'expense', status: 'ownership-unknown', bulkEligible: false, ...extra });
// The isolated TypeScript loader has its own Array prototype; compare JSON values across that boundary.
const project = (groups, rows, options = {}) => JSON.parse(JSON.stringify(projectTransferHistory({ groups, rowsById: new Map(rows.map(row => [row.id, row])),
  accountLabels: new Map([['wio', 'Wio Account ·2615'], ['fab', 'FAB Account ·0003']]), scope: 'recent', todayISO: '2026-09-09',
  moneyLabel: amount => `AED ${(amount / 100).toFixed(2)}`, ...options })));

test('3,106 historical transfers are saved, not mounted as 3,106 review actions', () => {
  const rows = Array.from({ length: 3106 }, (_, n) => tx(`history-${n}`, '2022-11-05'));
  const groups = [group('wio', rows)];
  const before = JSON.stringify({ rows, groups });
  const recent = project(groups, rows);
  assert.equal(recent.count, 0); assert.equal(recent.outsideRecentCount, 3106);
  const all = project(groups, rows, { scope: 'all' });
  assert.equal(all.count, 3106);
  assert.equal(transferHistoryItems(all.groups, new Set(), {}).length, 1, 'one collapsed group, no entry actions');
  const expanded = transferHistoryItems(all.groups, new Set(['wio']), {});
  assert.equal(expanded.filter(item => item.kind === 'entry').length, 20);
  assert.equal(expanded.at(-1).kind, 'more');
  assert.equal(transferHistoryItems(all.groups, new Set(['wio']), { wio: 40 }).filter(item => item.kind === 'entry').length, 40);
  assert.equal(JSON.stringify({ rows, groups }), before, 'browsing never mutates or classifies records');
});

test('calendar window includes 90 days, across leap years, and never silently changes stored dates', () => {
  assert.equal(transferRecentStart('2026-09-09'), '2026-06-12');
  assert.equal(transferRecentStart('2024-03-01'), '2023-12-03');
  for (const bad of ['2026-02-30', '2026-13-01', 'garbage']) assert.throws(() => transferRecentStart(bad));
  const rows = [tx('before', '2026-06-11'), tx('boundary', '2026-06-12'), tx('today'), tx('future', '2026-09-10')];
  assert.deepEqual(project([group('g', rows)], rows).groups[0].rows.map(row => row.id), ['today', 'boundary']);
  assert.equal(project([group('g', rows)], rows).outsideRecentCount, 2);
});

test('latest groups and entries come first, not opaque hash IDs or oldest dates', () => {
  const rows = [tx('z-new'), tx('a-old', '2026-07-01'), tx('b-middle', '2026-08-20')];
  const groups = [group('a-group', [rows[2]]), group('z-group', rows.slice(0, 2))];
  const out = project(groups, rows);
  assert.deepEqual(out.groups.map(g => g.id), ['z-group', 'a-group']);
  assert.deepEqual(out.groups[0].rows.map(row => row.id), ['z-new', 'a-old']);
});

test('account display never repeats a masked ending and never changes the saved label', () => {
  for (const name of ['Wio Account ·2615', 'Wio Account ••2615', 'Wio Account XXXX2615', 'حساب ·٢٦١٥']) {
    assert.equal(transferAccountLabel({ name, last4: '2615' }), name);
  }
  assert.equal(transferAccountLabel({ name: 'Wio', last4: '2615' }), 'Wio · ••2615');
  assert.equal(transferAccountLabel({ name: 'Account 12615', last4: '2615' }), 'Account 12615 · ••2615');
  assert.equal(transferAccountLabel({ name: 'Cash' }), 'Cash');
});

test('search handles Arabic numbers, dates, account, exact amount and bounded reference without reading raw SMS', () => {
  const rows = [tx('one', '2026-09-09', { title: 'Transfer', amountFils: 187400, raw: 'PRIVATE-SOURCE-MUST-NOT-BE-SEARCHED',
    transferEvidence: { reference: 'REF-998877' } }), tx('other', '2026-09-08', { amountFils: 700 })];
  for (const query of ['Wio 2615 1874.00', '١٬٨٧٤٫٠٠', 'REF-998877', '2026-09-09']) {
    assert.deepEqual(project([group('g', rows)], rows, { query }).groups[0].rows.map(row => row.id), ['one']);
  }
  assert.equal(project([group('g', rows)], rows, { query: 'PRIVATE-SOURCE-MUST-NOT-BE-SEARCHED' }).count, 0);
  assert.equal(transferSearchText('١٬٨٧٤٫٠٠'), '1874.00');
});

test('filtered bulk permission never expands beyond the actual same-counterparty group', () => {
  const rows = [tx('old', '2022-01-01'), tx('new')];
  for (const bulkEligible of [false, true]) {
    const out = project([group('g', rows, { bulkEligible })], rows);
    assert.equal(out.groups[0].bulkEligible, bulkEligible);
    assert.deepEqual(out.groups[0].transactionIds, ['new']);
  }
});

test('successive search terms reuse the prepared index without reformatting the whole history', () => {
  const rows = Array.from({ length: 3106 }, (_, i) => tx(`entry-${i}`));
  const groups = [group('g', rows)], rowsById = new Map(rows.map(row => [row.id, row]));
  let formats = 0;
  const searchIndex = presentation.indexTransferHistory(groups, rowsById, new Map([['wio', 'Wio']]),
    amount => { formats += 1; return `AED ${amount / 100}`; });
  assert.equal(formats, 3106);
  for (const query of ['w', 'wi', 'wio']) {
    assert.equal(project(groups, rows, { query, searchIndex, moneyLabel: () => { throw Error('reformatted'); } }).count, 3106);
  }
  assert.equal(formats, 3106);
});

test('a deep link shows exactly its old transfer, ignoring the browsing window but never pulling in its whole group', () => {
  const rows = [tx('old', '2022-01-01'), tx('new')];
  const out = project([group('g', rows)], rows, { focusedId: 'old', query: 'does-not-match' });
  assert.deepEqual(out.groups[0].transactionIds, ['old']);
  assert.equal(transferHistoryItems(out.groups, new Set(), {}, true).filter(item => item.kind === 'entry').length, 1);
  assert.equal(project([group('g', rows)], rows, { focusedId: 'deleted' }).count, 0);
});

test('the full-history suggestion respects search instead of advertising unrelated old records', () => {
  const rows = [tx('new', '2026-09-09', { title: 'Alpha' }), tx('old-match', '2022-01-01', { title: 'Alpha' }),
    tx('old-unrelated', '2022-01-01', { title: 'Beta' })];
  const result = project([group('g', rows)], rows, { query: 'Alpha' });
  assert.equal(result.count, 1); assert.equal(result.outsideRecentCount, 1);
  assert.equal(project([group('g', rows)], rows, { query: 'Unmatched' }).outsideRecentCount, 0);
});
