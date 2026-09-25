'use strict';
// Pure helpers and copy behind the redesigned detail screens (merchants, one
// merchant, Review, transfers, capture status). Real source; only module
// resolution is supplied, from the shipping build.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
// Values built inside the loaded module come from another realm; compare as data.
const same = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);

const root = path.resolve(__dirname, '../../..');
const build = (name) => require(`../build/${name}.js`);
const format = build('format');
const common = {
  '@/lib/categories': build('categories'),
  '@/lib/format': format,
  '@/lib/ledger': build('ledger'),
  '@/lib/period': build('period'),
  '@/lib/uncategorised': build('uncategorised'),
};
const merchantSpending = load(path.join(root, 'src/lib/merchant-spending.ts'), {
  ...common, '@/lib/ledger-money': build('ledger-money'),
});
const insights = load(path.join(root, 'src/lib/merchant-insights.ts'), { ...common, '@/lib/merchant-spending': merchantSpending });
const copy = load(path.join(root, 'src/lib/details-copy.ts'));
const reasons = load(path.join(root, 'src/lib/review-reasons.ts'), { '@/lib/alert-review-tray': build('alert-review-tray') });
const pairs = load(path.join(root, 'src/lib/transfer-pairs.ts'), { '@/lib/transfer-reconciliation': build('transfer-reconciliation') });
const capture = load(path.join(root, 'src/lib/capture-health-summary.ts'), {
  '@/lib/format': format, '@/lib/ios-capture-health': build('ios-capture-health'),
});

let seq = 0;
const tx = (over = {}) => ({
  id: `t${++seq}`, type: 'expense', amountFils: 1000, category: 'other', accountId: 'card',
  title: 'Shop', date: '2026-09-10', source: 'manual', ...over,
});
const live = new Set(['card', 'bank']);
const none = new Set();

/* ── copy ─────────────────────────────────────────────────────────────── */

function shape(value, trail = []) {
  if (typeof value === 'function') return [`${trail.join('.')}()`];
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().flatMap((key) => shape(value[key], [...trail, key]));
  }
  return [trail.join('.')];
}

test('details copy: English and Arabic have identical keys and value kinds', () => {
  same(shape(copy.detailsCopy.ar), shape(copy.detailsCopy.en));
  const strings = (value) => typeof value === 'string' ? [value]
    : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
  for (const text of strings(copy.detailsCopy.ar)) assert.ok(text.trim().length > 0);
  assert.ok(strings(copy.detailsCopy.ar).every((text) => /[؀-ۿ]|^Apple Pay$/.test(text)),
    'every Arabic string is Arabic');
  assert.equal(copy.detailsWords('ar'), copy.detailsCopy.ar);
  assert.equal(copy.detailsWords('en'), copy.detailsCopy.en);
  assert.equal(copy.detailsWords(undefined), copy.detailsCopy.en);
});

test('details copy: counts are pluralised in both languages', () => {
  const en = copy.detailsCopy.en; const ar = copy.detailsCopy.ar;
  assert.equal(en.payments(1), '1 payment');
  assert.equal(en.payments(3), '3 payments');
  assert.equal(en.currency.meta('€342.00', 1), '€342.00 · 1 payment');
  same([0, 1, 2, 3, 10, 11, 99, 100, 101, 103, 111].map(copy.arabicPluralCategory),
    ['zero', 'one', 'two', 'few', 'few', 'many', 'many', 'other', 'other', 'few', 'many']);
  assert.equal(ar.payments(1), 'دفعة واحدة');
  assert.equal(ar.payments(2), 'دفعتان');
  assert.equal(ar.payments(5), '5 دفعات');
  assert.equal(ar.payments(14), '14 دفعة');
  assert.equal(ar.merchants.count(14), '14 تاجراً');
  assert.equal(ar.merchants.count(100), '100 تاجر');
});

test('details copy: the currency footer names only the rate sources actually used', () => {
  const footer = copy.detailsCopy.en.currency.footer;
  assert.equal(footer({ bankQuotedCount: 0, referenceCount: 0, estimatedCount: 0 }), '');
  assert.match(footer({ bankQuotedCount: 0, referenceCount: 4, estimatedCount: 0 }), /reference rate for its own date/);
  assert.doesNotMatch(footer({ bankQuotedCount: 3, referenceCount: 0, estimatedCount: 0 }), /reference/);
  assert.match(footer({ bankQuotedCount: 3, referenceCount: 0, estimatedCount: 0 }), /your bank reported/);
  assert.match(footer({ bankQuotedCount: 0, referenceCount: 0, estimatedCount: 2 }), /approximate rate/);
  const mixed = footer({ bankQuotedCount: 1, referenceCount: 2, estimatedCount: 1 });
  assert.match(mixed, /1 payment uses the amount your bank reported/);
  assert.match(mixed, /2 payments use a reference rate/);
  assert.match(mixed, /1 payment uses an approximate rate/);
  assert.notEqual(copy.detailsCopy.ar.currency.footer({ bankQuotedCount: 1, referenceCount: 2, estimatedCount: 1 }), '');
});

/* ── merchants directory ──────────────────────────────────────────────── */

test('merchant ranking: by amount and by visits, stable on ties', () => {
  const stats = [
    { title: 'Cafe', category: 'dining', totalFils: 5400, count: 8 },
    { title: 'Grocer', category: 'groceries', totalFils: 61240, count: 14 },
    { title: 'Landlord', category: 'rent', totalFils: 110000, count: 1 },
    { title: 'Bakery', category: 'dining', totalFils: 5400, count: 8 },
  ];
  same(insights.rankMerchants(stats, 'amount').map((row) => [row.rank, row.title]),
    [[1, 'Landlord'], [2, 'Grocer'], [3, 'Bakery'], [4, 'Cafe']]);
  same(insights.rankMerchants(stats, 'visits').map((row) => [row.rank, row.title]),
    [[1, 'Grocer'], [2, 'Bakery'], [3, 'Cafe'], [4, 'Landlord']]);
});

test('new merchants: only offered when the ledger history predates the period by a margin', () => {
  const period = { mode: 'month', key: '2026-09' };
  const current = ['cafe', 'new place'];
  assert.equal(insights.newMerchantKeys([tx({ date: '2025-01-01' })], { mode: 'all' }, current).available, false);
  // History that starts inside the period cannot call anything new.
  const inside = insights.newMerchantKeys([tx({ title: 'Cafe', date: '2026-09-03' })], period, current);
  same([inside.available, inside.reason, inside.keys.size], [false, 'no-history', 0]);
  // History a few days older than the period is still too thin.
  const thin = insights.newMerchantKeys([tx({ title: 'Cafe', date: '2026-08-25' })], period, current);
  same([thin.available, thin.reason], [false, 'history-too-short']);
  const ledger = [
    tx({ title: 'Cafe', date: '2026-06-02' }),
    // A refund (income) before the period still means the name is not new.
    tx({ title: 'Refund Co', type: 'income', date: '2026-07-10' }),
    tx({ title: 'Cafe', date: '2026-09-05' }), tx({ title: 'New Place', date: '2026-09-06' }),
    tx({ title: 'Refund Co', date: '2026-09-07' }),
  ];
  const result = insights.newMerchantKeys(ledger, period, ['cafe', 'new place', 'refund co']);
  assert.equal(result.available, true);
  same([...result.keys], ['new place']);
});

/* ── one merchant, month by month ─────────────────────────────────────── */

test('merchant months: never before the first recorded month, real zeros kept, current month last', () => {
  const ledger = [
    tx({ title: 'Cafe', amountFils: 500, date: '2026-05-03' }),
    tx({ title: 'Cafe', amountFils: 700, date: '2026-05-20' }),
    tx({ title: 'Other shop', amountFils: 999, date: '2026-04-15' }),
    tx({ title: 'CAFE ', amountFils: 300, date: '2026-07-01' }),
    // Not spending: a transfer leg, an internal id and a hidden account.
    tx({ title: 'Cafe', amountFils: 5000, date: '2026-07-02', isTransfer: true }),
    tx({ id: 'internal', title: 'Cafe', amountFils: 6000, date: '2026-07-03' }),
    tx({ title: 'Cafe', amountFils: 7000, date: '2026-07-04', accountId: 'hidden' }),
  ];
  const today = new Date('2026-09-20T12:00:00');
  const months = insights.merchantMonthlySeries(ledger, 'Cafe', { mode: 'month', key: '2026-09' },
    live, new Set(['internal']), 'expense', today);
  // A single month period shows six months of context, clipped to the ledger's
  // first month (April), so nothing before April is claimed as zero.
  same(months.map((m) => m.key), ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
  same(months.map((m) => m.fils), [0, 1200, 0, 300, 0, 0]);
  same(months.map((m) => m.count), [0, 2, 0, 1, 0, 0]);
  same(months.map((m) => m.selected), [false, false, false, false, false, true]);
});

test('merchant months: a year stops at the current month and a long range keeps the last twelve', () => {
  const ledger = [tx({ title: 'Cafe', date: '2024-01-10' }), tx({ title: 'Cafe', amountFils: 250, date: '2026-02-11' })];
  const today = new Date('2026-09-20T12:00:00');
  const year = insights.merchantMonthlySeries(ledger, 'Cafe', { mode: 'year', year: 2026 }, live, none, 'expense', today);
  assert.equal(year[0].key, '2026-01');
  assert.equal(year[year.length - 1].key, '2026-09');
  assert.ok(year.every((m) => m.selected));
  assert.equal(year.find((m) => m.key === '2026-02').fils, 250);
  const all = insights.merchantMonthlySeries(ledger, 'Cafe', { mode: 'all' }, live, none, 'expense', today);
  assert.equal(all.length, insights.MERCHANT_SERIES_MAX_MONTHS);
  same([all[0].key, all[all.length - 1].key], ['2025-10', '2026-09']);
  same(insights.merchantMonthlySeries([], 'Cafe', { mode: 'all' }, live, none, 'expense', today), []);
  same(insights.merchantMonthlySeries(ledger, '  ', { mode: 'all' }, live, none, 'expense', today), []);
});

test('merchant months: income sources count income only', () => {
  const ledger = [
    tx({ title: 'Employer', type: 'income', category: 'salary', amountFils: 900000, date: '2026-08-25' }),
    tx({ title: 'Employer', amountFils: 100, date: '2026-08-26' }),
  ];
  const months = insights.merchantMonthlySeries(ledger, 'Employer', { mode: 'month', key: '2026-08' },
    live, none, 'income', new Date('2026-09-20T12:00:00'));
  // Six months of context end at the selected month and never reach before the first entry.
  same(months.map((m) => [m.key, m.fils, m.count]), [['2026-08', 900000, 1]]);
});

test('merchant rule: reads the saved rule by direction and counts only rows the rewrite moves', () => {
  const ledger = [
    tx({ title: 'Cafe', category: 'dining' }),
    tx({ title: 'Cafe', category: 'other' }),
    tx({ title: 'cafe', category: 'shopping' }),
    tx({ title: 'Cafe', category: 'other', userEdited: true }), // a hand decision is never rewritten
    tx({ title: 'Cafe', category: 'other', isTransfer: true }),
    tx({ title: 'Cafe', type: 'income', category: 'other' }),
  ];
  const unset = insights.merchantRuleSummary(ledger, {}, 'Cafe');
  assert.equal(unset.category, null);
  assert.equal(unset.applies, 3);
  assert.equal(unset.movable('dining'), 2);
  assert.equal(unset.movable('salary'), 0, 'an income category cannot rule an expense merchant');
  const saved = insights.merchantRuleSummary(ledger, { 'expense:cafe': 'dining' }, 'Cafe');
  assert.equal(saved.category, 'dining');
  const income = insights.merchantRuleSummary(ledger, { 'expense:cafe': 'dining' }, 'Cafe', 'income');
  assert.equal(income.category, null);
  assert.equal(income.applies, 1);
});

/* ── Review reasons ───────────────────────────────────────────────────── */

const field = (value, evidence = value === null ? 'missing' : 'explicit') => ({ value, evidence, spans: [], alternatives: [], issues: [] });
const universal = (event = {}, extra = {}) => ({
  kind: 'universal', id: 'r1', sourceKey: 's1', observedAt: 1, expiresAt: 2, channel: 'inbox', parserVersion: 1,
  event: { family: 'purchase', status: 'posted', direction: 'debit', amount: field({ currency: 'EUR', minorUnits: '100', exponent: 2 }),
    merchant: field('Cafe'), ...event },
  ...extra,
});
const facts = (ordinaryPosting = true, amountChoices = 1) => ({ ordinaryPosting, amountChoices });

test('review reasons: consequence order, from structured fields only', () => {
  assert.equal(reasons.reviewReason(universal({}, { attentionReason: 'possible-apple-pay-duplicate', currencyConflict: true }), facts()), 'apple-pay-duplicate');
  assert.equal(reasons.reviewReason(universal({}, { attentionReason: 'possible-notification-replay' }), facts()), 'notification-replay');
  assert.equal(reasons.reviewReason(universal({}, { currencyConflict: true }), facts(false)), 'currency');
  assert.equal(reasons.reviewReason(universal(), facts(false)), 'not-a-payment');
  assert.equal(reasons.reviewReason(universal(), facts(true, 2)), 'amount-choice');
  assert.equal(reasons.reviewReason(universal(), facts(true, 0)), 'amount-missing');
  assert.equal(reasons.reviewReason(universal({ merchant: field('Cafe', 'ambiguous') }), facts()), 'merchant-unsure');
  assert.equal(reasons.reviewReason(universal({}, { sourceClass: 'financial-candidate' }), facts()), 'unfamiliar-app');
  assert.equal(reasons.reviewReason(universal(), facts()), 'confirm');
  const registered = { id: 'x', family: 'purchase', amount: { currency: 'USD', minorUnits: '1420', exponent: 2 } };
  assert.equal(reasons.reviewReason(registered, facts()), 'confirm');
  assert.equal(reasons.reviewReason({ ...registered, sourceClass: 'financial-candidate' }, facts()), 'unfamiliar-app');
});

test('review merchant and purchase wording come only from what the alert stated', () => {
  assert.equal(reasons.reviewMerchant(universal()), 'Cafe');
  assert.equal(reasons.reviewMerchant(universal({ merchant: field('Cafe', 'ambiguous') })), null);
  assert.equal(reasons.reviewMerchant({ id: 'x', family: 'purchase' }), null);
  assert.equal(reasons.reviewIsPurchase(universal()), true);
  assert.equal(reasons.reviewIsPurchase(universal({ family: 'transfer' })), false);
  assert.equal(reasons.reviewIsPurchase({ id: 'x', family: 'refund' }), false);
});

/* ── transfer pairs ───────────────────────────────────────────────────── */

const leg = (id, type, accountId, over = {}) => tx({ id, type, accountId, title: 'Transfer', isTransfer: true,
  source: 'manual', amountFils: 21200, date: '2026-09-17', ...over });

test('transfer pairs: suggestions need a live likely-own leg and an undecided counterpart', () => {
  const out = leg('out', 'expense', 'bank');
  const inn = leg('in', 'income', 'savings');
  const rows = new Map([[out.id, out], [inn.id, inn]]);
  const byId = new Map([
    ['out', { id: 'out', status: 'likely-own', reason: 'amount-time', counterpartId: 'in', candidateIds: ['in'] }],
    ['in', { id: 'in', status: 'likely-own', reason: 'amount-time', counterpartId: 'out', candidateIds: ['out'] }],
  ]);
  const found = pairs.suggestedTransferPairs({ byId, pendingIds: new Set(['out', 'in']) }, rows);
  assert.equal(found.length, 1, 'both directions collapse into one card');
  same([found[0].out.id, found[0].in.id], ['out', 'in']);
  assert.equal(found[0].counterpartId, found[0].anchorId === 'out' ? 'in' : 'out');
  same(pairs.suggestedTransferPairs({ byId, pendingIds: new Set() }, rows), [], 'resolved legs are not suggested');
  const decided = new Map(rows).set('in', { ...inn, transferDecision: { version: 1, ownership: 'external', decidedAt: 1 } });
  same(pairs.suggestedTransferPairs({ byId, pendingIds: new Set(['out', 'in']) }, decided), []);
  const card = new Map([['out', { ...byId.get('out'), status: 'likely-card-repayment' }]]);
  same(pairs.suggestedTransferPairs({ byId: card, pendingIds: new Set(['out']) }, rows), [],
    'card repayments are never offered as a transfer pair');
  const sameAccount = new Map(rows).set('in', { ...inn, accountId: 'bank' });
  same(pairs.suggestedTransferPairs({ byId, pendingIds: new Set(['out', 'in']) }, sameAccount), []);
});

test('transfer pairs: matched means both legs are confirmed and name each other', () => {
  const out = leg('out', 'expense', 'bank', { date: '2026-09-02' });
  const inn = leg('in', 'income', 'savings', { date: '2026-09-02' });
  const lone = leg('lone', 'expense', 'bank', { date: '2026-09-03' });
  const rows = new Map([[out.id, out], [inn.id, inn], [lone.id, lone]]);
  const byId = new Map([
    ['out', { id: 'out', status: 'confirmed-own', reason: 'user', counterpartId: 'in', candidateIds: [] }],
    ['in', { id: 'in', status: 'confirmed-own', reason: 'user', counterpartId: 'out', candidateIds: [] }],
    ['lone', { id: 'lone', status: 'confirmed-own', reason: 'user', counterpartId: 'in', candidateIds: [] }],
  ]);
  const matched = pairs.matchedTransferPairs({ byId }, rows);
  same(matched.map((pair) => pair.key), ['out|in']);
  same(pairs.matchedTransferPairs({ byId }, rows, (pair) => pair.out.date >= '2026-10-01'), []);
  const suggestedOnly = new Map([...byId].map(([id, a]) => [id, { ...a, status: 'likely-own' }]));
  same(pairs.matchedTransferPairs({ byId: suggestedOnly }, rows), [], 'a suggestion is never shown as matched');
});

/* ── capture status ───────────────────────────────────────────────────── */

const health = (over = {}) => ({ enabled: true, entitled: true, pending: 0, dropped: 0, corrupt: false,
  lastReceivedAt: null, lastHandledAt: null, firstCapturedAt: null, ...over });

test('capture status: "working" only from a recent processing receipt', () => {
  const now = Date.parse('2026-09-25T09:41:00Z');
  same(capture.captureHealthStatus(null, now), { kind: 'unknown' });
  same(capture.captureHealthStatus(health({ enabled: false }), now), { kind: 'off' });
  same(capture.captureHealthStatus(health({ entitled: false }), now), { kind: 'paused' });
  same(capture.captureHealthStatus(health({ dropped: 2, lastHandledAt: now }), now), { kind: 'attention' });
  same(capture.captureHealthStatus(health(), now), { kind: 'never' });
  same(capture.captureHealthStatus(health({ lastHandledAt: now - 60_000, pending: 3 }), now),
    { kind: 'working', lastHandledAt: now - 60_000 });
  const old = now - capture.CAPTURE_WORKING_WINDOW_MS - 1;
  same(capture.captureHealthStatus(health({ lastHandledAt: old }), now), { kind: 'quiet', lastHandledAt: old });
});

test('capture counters: alerts added this month exclude manual entries and statement imports', () => {
  format.setMonthStartDay(1);
  const today = new Date('2026-09-25T12:00:00');
  const ledger = [
    tx({ source: 'sms', date: '2026-09-01' }),
    tx({ source: 'sms', date: '2026-09-24' }),
    tx({ source: 'sms', date: '2026-08-31' }),
    tx({ source: 'manual', date: '2026-09-10' }),
    tx({ source: 'sms', date: '2026-09-11', captureSource: 'pdf' }),
    tx({ source: 'sms', date: '2026-09-12', statementImportId: 'a'.repeat(32) }),
  ];
  assert.equal(capture.capturedThisMonth(ledger, today), 2);
});

test('capture banks: only banks with alert-recorded entries, never archived or statement-only', () => {
  const accounts = [
    { id: 'a', bankName: 'First Bank', kind: 'bank' },
    { id: 'b', bankName: 'first bank ', kind: 'card' },
    { id: 'c', bankName: 'Statement Bank', kind: 'bank' },
    { id: 'd', bankName: 'Old Bank', kind: 'bank', archived: true },
    { id: 'e', kind: 'cash' },
  ];
  const ledger = [
    tx({ accountId: 'a', source: 'sms' }), tx({ accountId: 'b', source: 'sms' }),
    tx({ accountId: 'c', source: 'sms', captureSource: 'csv' }),
    tx({ accountId: 'd', source: 'sms' }), tx({ accountId: 'e', source: 'sms' }),
  ];
  same(capture.banksSeenInAlerts(accounts, ledger), ['First Bank']);
});

/* ── merchant page components ─────────────────────────────────────────── */

function componentHarness(file, { state = {}, store = {}, language = 'en' } = {}) {
  const slots = []; let cursor = 0; const events = [];
  const jsx = (type, props = {}) => typeof type === 'function' ? type(props) : { type, props };
  const boundary = (name) => (props) => ({ type: name, props });
  const deps = {
    react: { useMemo: (fn) => fn(), useState: (initial) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    } },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { View: 'View', Pressable: 'Pressable', StyleSheet: { create: (s) => s } },
    '@/components/themed-text': { ThemedText: boundary('Text') },
    '@/components/ui/bottom-sheet': { BottomSheet: (props) => props.visible ? { type: 'Sheet', props } : null },
    '@/components/ui/category-avatar': { CategoryAvatar: boundary('CategoryAvatar') },
    '@/components/ui/category-chips': { CategoryChips: boundary('CategoryChips') },
    '@/components/ui/choice-sheet': { ChoiceSheet: boundary('ChoiceSheet') },
    '@/components/ui/confirm-sheet': { ConfirmSheet: boundary('ConfirmSheet') },
    '@/components/ui/icon': { Icon: boundary('Icon') },
    '@/components/ui/grow-bar': { GrowBar: boundary('GrowBar') },
    '@/hooks/use-language': { useLanguage: () => language },
    '@/hooks/use-theme': { useTheme: () => ({ primary: 'primary', income: 'income', track: 'track', cardBorder: 'rule' }) },
    '@/lib/categories': common['@/lib/categories'],
    '@/lib/details-copy': copy,
    '@/lib/format': format,
    '@/lib/i18n': build('i18n'),
    '@/lib/merchant-insights': insights,
    '@/lib/merchant-spending': merchantSpending,
    '@/lib/store': { useStore: () => ({ state, ...store,
      setMerchantOverride: (...args) => events.push(['setMerchantOverride', ...args]) }) },
  };
  const module = load(path.join(root, file), deps);
  const walkTree = (node, out = []) => {
    if (Array.isArray(node)) node.forEach((child) => walkTree(child, out));
    else if (node && typeof node === 'object') { out.push(node); walkTree(node.props?.children, out); }
    return out;
  };
  const textOf = (node) => Array.isArray(node) ? node.map(textOf).join(' ')
    : node && typeof node === 'object' ? textOf(node.props?.children) : node === null || node === undefined || node === false ? '' : String(node);
  return { module, events, walk: walkTree, text: textOf, reset: () => { cursor = 0; } };
}

test('Always <category>: shows the saved rule and moves existing entries only through the entry-sheet choice', () => {
  const transactions = [
    tx({ title: 'Cafe', category: 'other' }), tx({ title: 'Cafe', category: 'other' }), tx({ title: 'Cafe', category: 'dining' }),
  ];
  const h = componentHarness('src/components/merchant-category-rule.tsx', { state: { transactions, merchantOverrides: {} } });
  const render = () => { h.reset(); return h.module.MerchantCategoryRule({ merchant: 'Cafe', kind: 'expense' }); };
  let tree = render();
  const en = copy.detailsCopy.en;
  const row = h.walk(tree).find((node) => node.props?.testID === 'merchant-category-rule');
  assert.ok(h.text(row).includes(en.merchant.noRule));
  assert.ok(h.text(row).includes(en.entries(3)));
  row.props.onPress();
  tree = render();
  const chips = h.walk(tree).find((node) => node.type === 'CategoryChips');
  assert.ok(chips, 'the picker opens');
  chips.props.onToggle('dining');
  tree = render();
  const choice = h.walk(tree).find((node) => node.type === 'ChoiceSheet');
  assert.ok(choice.props.body.includes('2'), 'the question names the two entries that would move');
  assert.deepEqual(h.events, [], 'nothing is written before the choice');
  choice.props.onSelect('all');
  same(h.events, [['setMerchantOverride', 'Cafe', 'dining', true, 'expense']]);

  const saved = componentHarness('src/components/merchant-category-rule.tsx',
    { state: { transactions, merchantOverrides: { 'expense:cafe': 'dining' } } });
  saved.reset();
  const savedTree = saved.module.MerchantCategoryRule({ merchant: 'Cafe', kind: 'expense' });
  assert.ok(saved.text(savedTree).includes(en.merchant.always('Dining')));
  saved.reset();
  assert.equal(saved.module.MerchantCategoryRule({ merchant: 'AB', kind: 'expense' }), null, 'too short a name for a rule');
});

test('Always <category>: a choice that moves nothing is a plain future-only confirmation', () => {
  const transactions = [tx({ title: 'Cafe', category: 'dining' })];
  const h = componentHarness('src/components/merchant-category-rule.tsx', { state: { transactions, merchantOverrides: {} } });
  const render = () => { h.reset(); return h.module.MerchantCategoryRule({ merchant: 'Cafe', kind: 'expense' }); };
  h.walk(render()).find((node) => node.props?.testID === 'merchant-category-rule').props.onPress();
  h.walk(render()).find((node) => node.type === 'CategoryChips').props.onToggle('dining');
  const confirm = h.walk(render()).find((node) => node.type === 'ConfirmSheet');
  assert.ok(confirm);
  confirm.props.onConfirm();
  same(h.events, [['setMerchantOverride', 'Cafe', 'dining', false, 'expense']]);
});

test('month bars draw empty months as a baseline and label bars with the real amount', () => {
  format.setMonthStartDay(1);
  const h = componentHarness('src/components/merchant-month-bars.tsx');
  const ledger = [tx({ title: 'Cafe', amountFils: 500, date: '2026-04-03' }), tx({ title: 'Cafe', amountFils: 250, date: '2026-06-03' })];
  h.reset();
  const tree = h.module.MerchantMonthBars({ transactions: ledger, merchant: 'Cafe', period: { mode: 'year', year: 2026 },
    live, internal: none, kind: 'expense' });
  const columns = h.walk(tree).filter((node) => node.props?.accessibilityRole === 'image');
  assert.ok(columns.length >= 3);
  assert.equal(h.walk(columns[0]).filter((node) => node.type === 'GrowBar').length, 1, 'April has a bar');
  assert.equal(h.walk(columns[1]).filter((node) => node.type === 'GrowBar').length, 0, 'May is an empty baseline');
  assert.match(columns[1].props.accessibilityLabel, /0 payments/);
  h.reset();
  assert.equal(h.module.MerchantMonthBars({ transactions: [], merchant: 'Cafe', period: { mode: 'all' }, live, internal: none, kind: 'expense' }), null);
});
