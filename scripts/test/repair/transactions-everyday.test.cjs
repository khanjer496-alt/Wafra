'use strict';
// Transactions redesign: type chips, source, account links, search, swipe
// actions and the entry sheet's category / transfer states. Executes the
// shipping modules with the reference harness's explicit substitutes.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { createHarness, walk, text } = require('./reference-harness.cjs');

const root = path.resolve(__dirname, '../../..');
const plain = (value) => JSON.parse(JSON.stringify(value));
const byId = (tree, id) => walk(tree).find((node) => node.props?.testID === id);
// transactions.tsx useState order: 3 filters, 7 editing, 8 entryMode, 9 deleting.
const FILTERS = 3; const EDITING = 7; const MODE = 8; const DELETING = 9;
// entry-detail-sheet.tsx: 10 ruleAsk, 12 categoryPicking, 13 pickedCategory.
const RULE = 10; const PICKING = 12; const PICKED = 13;

function screen(options = {}) {
  const h = createHarness(options);
  h.deps['react-native'].Keyboard = { dismiss: () => h.events.push(['keyboard-dismiss']) };
  h.deps['react-native'].SectionList = (p) => h.jsx('SectionList', { ...p, children: p.ListHeaderComponent });
  h.deps['@react-native-community/datetimepicker'] = { __esModule: true, default: 'DateTimePicker' };
  h.deps['@/lib/period'].periodRange = () => '';
  const tree = h.local('@/app/transactions').default();
  const list = walk(tree).find((node) => node.type === 'SectionList');
  return { ...h, tree, list, rows: list.props.sections.flatMap((section) => section.data) };
}

const source = load(path.join(root, 'src/lib/transaction-source.ts'));
const filter = load(path.join(root, 'src/lib/transaction-filter.ts'), {
  '@/lib/categories': require('../build/categories.js'),
  '@/lib/format': require('../build/format.js'),
  '@/lib/ledger': require('../build/ledger.js'),
  '@/lib/splits': require('../build/splits.js'),
  '@/lib/transaction-source': source,
});
const base = { type: null, accountId: null, categories: new Set(), datePreset: 'all', dateFrom: null, dateTo: null, minFils: null, sort: 'newest' };
const opts = (extra = {}) => ({ query: '', merchant: null, smsOnly: false, currentKey: '2026-09', period: { mode: 'all' },
  live: new Set(['card', 'bank']), internal: new Set(), corroborating: new Set(), ...extra });
const row = (id, extra = {}) => ({ id, title: 'Cafe', type: 'expense', category: 'dining', amountFils: 4562, accountId: 'card',
  date: '2026-09-0' + (1 + (id.length % 8)), source: 'sms', ...extra });

test('filter projection: kinds, sources, maximum, account names and typed amounts', () => {
  const rows = [
    row('text'), row('push', { viaPush: true, amountFils: 120000 }), row('pdf', { captureSource: 'pdf', amountFils: 999 }),
    row('hand', { source: 'manual', accountId: 'bank', title: 'Bakery' }), row('xfer', { isTransfer: true, amountFils: 21200 }),
  ];
  const names = new Map([['card', 'Visa Emirates NBD'], ['bank', 'Checking']]);
  const index = filter.createTransactionFilterIndex(rows, 'en', names);
  const ids = (filters, extra) => filter.projectTransactionFilter(index, { ...base, ...filters }, opts(extra)).filtered.map((r) => r.id);
  assert.deepEqual(plain(ids({ kind: 'transfers' }, { transferIds: new Set(['xfer']) })), ['xfer']);
  assert.deepEqual(plain(ids({ kind: 'review' }, { reviewIds: new Set(['hand']) })), ['hand']);
  assert.deepEqual(plain(ids({ kind: 'review' }, {})), [], 'no review set means nothing needs review');
  assert.deepEqual(plain(ids({ sources: new Set(['statement', 'manual']) }).sort()), ['hand', 'pdf']);
  assert.deepEqual(plain(ids({ sources: new Set(['notification']) })), ['push']);
  assert.deepEqual(plain(ids({ maxFils: 4562 }).sort()), ['hand', 'pdf', 'text'], 'the maximum is inclusive');
  assert.deepEqual(plain(ids({ minFils: 1000, maxFils: 50000 }).sort()), ['hand', 'text', 'xfer']);
  assert.deepEqual(plain(ids({}, { query: 'checking' })), ['hand'], 'search matches the account name');
  assert.deepEqual(plain(ids({}, { query: 'emirates' }).sort()), ['pdf', 'push', 'text', 'xfer'], 'and its bank');
  assert.deepEqual(plain(ids({}, { query: '45.6' }).sort()), ['hand', 'text'], 'a typed decimal is a prefix');
  assert.deepEqual(plain(ids({}, { query: '45' }).sort()), ['hand', 'text'], 'a whole number is that whole amount');
  assert.deepEqual(plain(ids({}, { query: '4' })), [], '"4" does not find 45.62 or 1,200');
  assert.deepEqual(plain(ids({}, { query: '212' })), ['xfer']);
  assert.deepEqual(plain(ids({}, { query: '1,200' })), ['push'], 'group marks are ignored');
  assert.deepEqual(plain(ids({}, { query: '٤٥' }).sort()), ['hand', 'text'], 'Arabic-Indic digits read as numbers');
  assert.equal(filter.amountMatches(4562, '45.62'), true);
  assert.equal(filter.amountMatches(4562, '045'), true);
  assert.equal(filter.amountMatches(45620, '45.62', 3), true);
  assert.equal(filter.amountMatches(45, '45', 0), true);
  assert.equal(filter.amountMatches(450, '45', 0), false);
  assert.deepEqual(plain(ids({}, { query: '4.5', amountExponent: 3 }).sort()), ['hand', 'text'], 'the ledger exponent decides where the decimals are');
  assert.deepEqual(plain(ids({}, { query: '4.5' })), []);
  // Confirmed transfers normally leave the list for their own surface; the
  // Transfers chip is the one view that lists them.
  const separate = new Set(['xfer']);
  assert.equal(ids({}, { separateTransferIds: separate }).includes('xfer'), false);
  assert.deepEqual(plain(ids({ kind: 'transfers' }, { separateTransferIds: separate, transferIds: separate })), ['xfer']);
  assert.equal(filter.amountSearchText(4562), '45.62');
  assert.equal(filter.amountSearchText(12345, 3), '12.345');
  assert.equal(filter.amountSearchText(1500, 0), '1500');
  assert.equal(filter.numericAmountQuery('coffee'), null);
});

test('type chips: All, Spending, Income, Transfers, Needs review each set one filter', () => {
  const h = screen();
  const chips = byId(h.tree, 'transactions-type-chips');
  assert.deepEqual(plain(walk(chips).filter((n) => n.props?.accessibilityRole === 'button').map((n) => n.props.accessibilityLabel)),
    ['All', 'Spending', 'Income', 'Transfers', 'Needs review']);
  const press = (id) => {
    const pressable = walk(byId(h.tree, `transactions-chip-${id}`)).find((n) => n.props?.onPress);
    pressable.props.onPress();
    const update = h.events.filter((e) => e[0] === 'state' && e[1] === FILTERS).at(-1)[2];
    return update({ type: null, kind: null, keep: true });
  };
  assert.deepEqual(plain(press('spending')), { type: 'expense', kind: null, keep: true });
  assert.deepEqual(plain(press('income')), { type: 'income', kind: null, keep: true });
  assert.deepEqual(plain(press('transfers')), { type: null, kind: 'transfers', keep: true });
  assert.deepEqual(plain(press('review')), { type: null, kind: 'review', keep: true });
  assert.deepEqual(plain(press('all')), { type: null, kind: null, keep: true });
});

test('an account link scopes the list to that account across all time, and can be cleared', () => {
  const h = screen({ params: { account: 'adcb' }, state: { transactions: [
    ...createHarness().state.transactions,
    { id: 'adcb-1', title: 'Noon', amountFils: 9900, category: 'shopping', type: 'expense', accountId: 'adcb', date: '2026-06-02', source: 'sms' },
  ] } });
  assert.deepEqual(plain(h.rows.map((r) => r.id)), ['adcb-1'], 'only that account, including older months');
  const chip = byId(h.tree, 'transactions-account-filter');
  assert.match(text(chip), /Account: ADCB/);
  chip.props.onPress();
  const clear = h.events.filter((e) => e[0] === 'state' && e[1] === FILTERS).at(-1)[2];
  assert.equal(clear({ accountId: 'adcb' }).accountId, null);
});

test('rows read "time · source" beside the logo tile and put the category under the amount', () => {
  const h = screen();
  const item = { ...h.state.transactions[1], viaPush: true };
  const rendered = h.list.props.renderItem({ item, index: 0 });
  const merchant = byId(rendered, 'transaction-merchant-link');
  assert.match(text(merchant), /app alert/);
  const rowSource = require('node:fs').readFileSync(path.join(root, 'src/components/transaction-row.tsx'), 'utf8');
  assert.equal((rowSource.match(/<MerchantAvatar title=\{transaction\.title\} category=\{transaction\.category\} size=\{36\} \/>/g) || []).length, 2,
    'both row shapes keep the merchant logo tile');
  const details = byId(rendered, 'transaction-details-link');
  assert.match(text(details), /Dining/);
  assert.match(details.props.accessibilityLabel, /app alert/);
});

test('swipe actions: Category opens the picker, Transfer opens the sheet to read; Delete asks first', () => {
  const h = screen();
  const item = h.state.transactions[1];
  const rendered = h.list.props.renderItem({ item, index: 0 });
  const swipe = walk(rendered).find((n) => n.type === 'SwipeRow');
  assert.deepEqual(plain(swipe.props.actions.map((a) => a.name)), ['category', 'transfer', 'delete']);
  const details = byId(rendered, 'transaction-details-link');
  assert.deepEqual(plain(details.props.accessibilityActions.map((a) => a.name)), ['category', 'transfer', 'delete'],
    'the same actions are offered to screen readers');

  h.events.length = 0;
  swipe.props.actions[0].onPress();
  assert.ok(h.events.some((e) => e[0] === 'state' && e[1] === MODE && e[2] === 'category'));
  assert.ok(h.events.some((e) => e[0] === 'state' && e[1] === EDITING && e[2]?.id === item.id));
  h.events.length = 0;
  details.props.onAccessibilityAction({ nativeEvent: { actionName: 'transfer' } });
  assert.ok(h.events.some((e) => e[0] === 'state' && e[1] === MODE && e[2] === 'read'), 'Transfer opens the sheet to read it');
  assert.ok(h.events.some((e) => e[0] === 'state' && e[1] === EDITING && e[2]?.id === item.id));
  assert.equal(h.events.some((e) => e[0] === 'route'), false);
  h.events.length = 0;
  swipe.props.actions[2].onPress();
  assert.ok(h.events.some((e) => e[0] === 'state' && e[1] === DELETING && e[2]?.id === item.id));
  assert.equal(h.events.some((e) => e[0] === 'deleteTransaction'), false, 'nothing is deleted by the swipe itself');

  const confirming = screen({ states: { [DELETING]: item } });
  const sheet = walk(confirming.tree).find((n) => n.props?.name === 'ConfirmSheet');
  assert.equal(sheet.props.destructive, true);
  sheet.props.onConfirm();
  assert.deepEqual(plain(confirming.events.filter((e) => e[0] === 'deleteTransaction')), [['deleteTransaction', item.id]]);
});

test('Transfer swipes open the entry sheet to read it; only a declined candidate keeps Category', () => {
  const h = screen();
  const pending = { ...h.state.transactions[1], id: 'pending', title: 'Bank transfer',
    transferEvidence: { version: 1, currency: 'AED', attribution: 'fallback' } };
  const swipe = walk(h.list.props.renderItem({ item: pending, index: 0 })).find((n) => n.type === 'SwipeRow');
  assert.deepEqual(plain(swipe.props.actions.map((a) => a.name)), ['transfer', 'delete']);
  swipe.props.actions[0].onPress();
  assert.equal(h.events.some((e) => e[0] === 'route'), false, 'never the old review screen');
  assert.deepEqual(plain(h.events.filter((e) => e[0] === 'state' && e[1] === MODE)), [['state', MODE, 'read']]);
  assert.deepEqual(plain(h.events.filter((e) => e[0] === 'state' && e[1] === EDITING).map((e) => e[2].id)), ['pending']);
  const ordinary = walk(h.list.props.renderItem({ item: h.state.transactions[1], index: 0 })).find((n) => n.type === 'SwipeRow');
  ordinary.props.actions.find((a) => a.name === 'transfer').onPress();
  assert.deepEqual(plain(h.events.filter((e) => e[0] === 'state' && e[1] === MODE).at(-1)), ['state', MODE, 'read']);
  assert.equal(h.events.some((e) => e[0] === 'route'), false);
  const own = { ...h.state.transactions[1], id: 'own', isTransfer: true };
  const ownSwipe = walk(h.list.props.renderItem({ item: own, index: 0 })).find((n) => n.type === 'SwipeRow');
  assert.deepEqual(plain(ownSwipe.props.actions.map((a) => a.name)), ['delete']);
  // "Not a transfer" keeps the row a candidate only so Undo is reachable; it swipes like an ordinary row.
  const declined = { ...pending, id: 'declined', transferDecision: { version: 1, ownership: 'none', decidedAt: 1 } };
  const declinedSwipe = walk(h.list.props.renderItem({ item: declined, index: 0 })).find((n) => n.type === 'SwipeRow');
  assert.deepEqual(plain(declinedSwipe.props.actions.map((a) => a.name)), ['category', 'transfer', 'delete']);
  declinedSwipe.props.actions[0].onPress();
  assert.deepEqual(plain(h.events.filter((e) => e[0] === 'state' && e[1] === MODE).at(-1)), ['state', MODE, 'category']);
});

test('Transactions hands the sheet the reconciliation it already holds, so own links from here', async () => {
  const bank = ['1111', '2222'].map((last4, i) => ({ id: `bank-${i}`, name: `Bank ${i}`, kind: 'bank', bankName: 'ADCB', last4, openingFils: 0, color: '#111111' }));
  const leg = (id, extra) => ({ id, type: 'expense', amountFils: 10000, category: 'other', accountId: 'bank-0', title: 'Outgoing transfer',
    date: '2026-09-08', ts: 1788861600000, source: 'sms', captureInstrument: { last4: '1111', kind: 'account', bankIdentity: 'adcb' },
    transferEvidence: { version: 1, currency: 'AED', attribution: 'source', reference: 'TRANSFER-123456' }, ...extra });
  const out = leg('out');
  const incoming = leg('in', { type: 'income', accountId: 'bank-1', title: 'Incoming transfer',
    captureInstrument: { last4: '2222', kind: 'account', bankIdentity: 'adcb' } });
  const options = { state: { accounts: bank, transactions: [out, incoming, { ...createHarness().state.transactions[1], id: 'shop', accountId: 'bank-0' }] } };
  const sheetOf = (editing) => walk(screen({ ...options, states: { [EDITING]: editing } }).tree).find((n) => n.props?.name === 'EntryDetailSheet');
  const expected = createHarness(options).deps['@/lib/ledger'].transferReconciliationForState(createHarness(options).state).byId.get('out');
  assert.equal(expected.counterpartId, 'in');
  const sheet = sheetOf(out);
  assert.deepEqual(plain(sheet.props.transferAssessment), plain(expected));
  assert.equal(sheetOf(options.state.transactions[2]).props.transferAssessment, undefined, 'an ordinary row has none');
  assert.equal(sheetOf(null).props.transferAssessment, undefined, 'nothing is looked up while the sheet is closed');
  // The sheet, given what Transactions passes, shows the link. Own is already the answer, so
  // tapping it again saves nothing (re-saving could unpay a card statement).
  const detail = createHarness(options);
  const tree = detail.renderDetail(out, { transferAssessment: sheet.props.transferAssessment });
  assert.match(text(tree), /Linked to/);
  byId(tree, 'transfer-answer-own').props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(detail.events.some((e) => e[0] === 'answer'), false);
  // With the same counterpart only suggested, own saves with that counterpart.
  const likely = createHarness(options);
  const suggested = { ...sheet.props.transferAssessment, status: 'likely-own' };
  byId(likely.renderDetail(out, { transferAssessment: suggested }), 'transfer-answer-own').props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  const saved = likely.events.find((e) => e[0] === 'answer')[1];
  assert.equal(saved.answer, 'own');
  assert.equal(saved.counterpart.id, 'in');
});

test('the Transfers chip lists transfers and candidates, never a row answered "not a transfer"', () => {
  const base = createHarness().state.transactions;
  const candidate = { ...base[1], id: 'candidate', title: 'Bank transfer', transferEvidence: { version: 1, currency: 'AED', attribution: 'fallback' } };
  const declined = { ...candidate, id: 'declined', transferDecision: { version: 1, ownership: 'none', decidedAt: 1 } };
  const filters = { type: null, accountId: null, categories: new Set(), datePreset: 'all', dateFrom: null, dateTo: null, minFils: null,
    sort: 'newest', maxFils: null, sources: new Set(), kind: 'transfers' };
  const h = screen({ states: { [FILTERS]: filters }, state: { transactions: [candidate, declined] } });
  assert.deepEqual(plain(h.rows.map((r) => r.id)), ['candidate']);
});

test('entry detail: FX line labelled by its rate source, and a one-tap own-account action', () => {
  const h = createHarness();
  const fx = { ...h.state.transactions[1], originalCurrency: 'EUR', originalMinorUnits: 4200, originalExponent: 2,
    fxRate: 1.0862, fxSource: 'reference', fxRateDate: '2026-09-05' };
  const tree = h.renderDetail(fx);
  const line = byId(tree, 'entry-fx-line');
  assert.match(text(line), /EUR/);
  assert.match(text(line), /1\.0862/);
  assert.match(text(line), /Dated reference rate/);
  const bank = text(byId(h.renderDetail({ ...fx, fxSource: 'bank' }), 'entry-fx-line'));
  assert.match(bank, /Bank-quoted/);
  assert.equal(byId(h.renderDetail(h.state.transactions[1]), 'entry-fx-line'), undefined);

  // The same flag the old toggle wrote, in one tap and with no confirm sheet.
  const chip = byId(h.renderDetail(), 'entry-mark-transfer');
  assert.equal(chip.props.accessibilityLabel, 'Moved to my own account');
  chip.props.onPress();
  const edit = h.events.find((e) => e[0] === 'editTransaction');
  assert.deepEqual(plain(edit[2]), { isTransfer: true });
  assert.ok(h.events.some((e) => e[0] === 'close'));
  assert.equal(walk(h.renderDetail()).some((n) => n.props?.name === 'ConfirmSheet' && n.props.question?.includes('transfer')), false);
  // Rows that are already transfer candidates answer through the question instead.
  const pending = { ...h.state.transactions[1], transferEvidence: { version: 1, currency: 'AED', attribution: 'fallback' } };
  assert.equal(byId(h.renderDetail(pending), 'entry-mark-transfer'), undefined);
});

test('entry detail edit form: no transfer toggle and no transfer flag written by Save', () => {
  const h = createHarness({ states: { 0: true, 1: 'Talabat', 2: '620', 3: 'dining', 4: 'enbd', 5: '2026-09-03' } });
  const tree = h.renderDetail();
  assert.equal(walk(tree).some((n) => n.props?.label === 'Transfer between my accounts'), false);
  assert.equal(walk(tree).some((n) => text(n) === 'Transfer between my accounts'), false);
  walk(tree.props.footer).find((n) => n.props?.accessibilityLabel === 'Save changes' || n.props?.label === 'Save changes').props.onPress();
  const edit = h.events.find((e) => e[0] === 'editTransaction');
  assert.ok(edit);
  assert.equal('isTransfer' in edit[2], false);
});

test('entry detail: finer source labels for statement, Apple Pay and email rows', () => {
  const h = createHarness();
  const base = h.state.transactions[1];
  assert.match(text(h.renderDetail({ ...base, captureSource: 'pdf' })), /Bank statement \(PDF\)/);
  assert.match(text(h.renderDetail({ ...base, captureSource: 'csv' })), /Bank statement \(CSV\)/);
  assert.match(text(h.renderDetail({ ...base, smsKey: `apple_pay_review_source_${'b'.repeat(32)}` })), /Apple Pay \(Wallet\)/);
  assert.match(text(h.renderDetail({ ...base, captureSource: 'email' })), /Bank email/);
});

test('entry detail category state: a wrapping grid with Cancel/Done that keeps the merchant rule question', () => {
  const h = createHarness({ states: { [PICKING]: true, [PICKED]: 'groceries' } });
  const tree = h.renderDetail();
  assert.equal(tree.props.title, 'Category');
  const picker = byId(tree, 'entry-category-picker');
  assert.ok(picker);
  assert.ok(walk(picker).some((n) => n.props?.accessibilityState?.selected === true && n.props.accessibilityLabel === 'Groceries'));
  const done = walk(tree.props.footer).find((n) => n.props?.accessibilityLabel === 'Done' && n.props.onPress);
  done.props.onPress();
  const edit = h.events.find((e) => e[0] === 'editTransaction');
  assert.equal(edit[2].category, 'groceries');
  const ask = h.events.find((e) => e[0] === 'state' && e[1] === RULE);
  assert.deepEqual(plain(ask[2]), { merchant: 'Talabat', category: 'groceries', type: 'expense', count: 0 });
  // The existing remember sheet keeps its future-only / update-all choice with the count.
  const asking = createHarness({ states: { [RULE]: { merchant: 'Talabat', category: 'groceries', type: 'expense', count: 3 } } });
  const choice = walk(asking.renderDetail()).find((n) => n.props?.name === 'ChoiceSheet');
  assert.deepEqual(plain(choice.props.options.map((o) => o.value)), ['future', 'all']);
  assert.match(choice.props.body, /3/);

  const cancelling = createHarness({ states: { [PICKING]: true, [PICKED]: 'groceries' } });
  walk(cancelling.renderDetail().props.footer).find((n) => n.props?.accessibilityLabel === 'Cancel' && n.props.onPress).props.onPress();
  assert.equal(cancelling.events.some((e) => e[0] === 'editTransaction'), false);
});

test('filter sheet offers Source (only kinds present) and a maximum beside the minimum', () => {
  const h = screen();
  h.deps['@/components/transaction-filter-sheet'] = undefined;
  const sheetModule = h.local('@/components/transaction-filter-sheet');
  const props = { initialFilters: { ...base, sources: new Set() }, resetFilters: { ...base, sources: new Set() },
    accounts: h.state.accounts, hasUnassignedIncome: false,
    index: filter.createTransactionFilterIndex(h.state.transactions, 'en'),
    options: opts({ period: { mode: 'month', key: '2026-09' } }), sourceKinds: ['bank-text', 'statement', 'manual'],
    onClose() {}, onApply() {} };
  const tree = sheetModule.TransactionFilterSheet(props);
  const sections = walk(tree).filter((n) => n.props?.accessibilityState?.expanded === false).map((n) => n.props.accessibilityLabel);
  assert.ok(sections.some((label) => /^Source: /.test(label)));
  assert.ok(sections.some((label) => /^Maximum amount: /.test(label)));
  const single = sheetModule.TransactionFilterSheet({ ...props, sourceKinds: ['bank-text'] });
  assert.equal(walk(single).some((n) => /^Source: /.test(n.props?.accessibilityLabel ?? '')), false, 'one source is not a choice');
});
