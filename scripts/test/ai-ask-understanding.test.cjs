'use strict';
// Ask Wafra model-output mapping (src/lib/ai-ask-understanding.ts) and the
// synthetic question set that trains the tagger's intent and slot heads.
// Runs the CURRENT source in memory: node scripts/test/ai-ask-understanding.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createLoader } = require('../universal-test/load-ts.cjs');

const load = createLoader();
const ask = load('@/lib/ai-ask-understanding');
const assistant = load('@/lib/wafra-assistant');
const { isAssistantToolRequest } = load('@/lib/wafra-assistant-ai');
const { currentMonthPeriod } = load('@/lib/period');
const questions = require('../parser-ai/ask/questions.cjs');
const { requestSlots, goldSlots, buildState } = require('../parser-ai/ask/score-rules.cjs');

const NOW = new Date(2026, 8, 20, 12);
const ACCOUNTS = [{ id: 'acct-visa', name: 'Visa Platinum' }, { id: 'acct-everyday', name: 'Everyday' }];
const MERCHANTS = ['Talabat', 'Carrefour', 'طلبات'];
const ctx = (extra = {}) => ({ now: NOW, knownMerchants: MERCHANTS, knownAccounts: ACCOUNTS, ...extra });
const span = (question, label, text, p) => {
  const start = question.indexOf(text);
  assert.ok(start >= 0, `${text} not in ${question}`);
  return { label, start, end: start + text.length, ...(p === undefined ? {} : { p }) };
};
const model = (intent, question, spans, intentP = 0.95) => ({ intent, intentP, spans: spans.map(([label, text, p]) => span(question, label, text, p)) });
const HELP = { tool: 'help', clarification: 'I didn’t quite understand that.', unrecognized: true };

test('label inventories are closed and stable', () => {
  assert.equal(ask.ASK_BIO_LABELS.length, 1 + 2 * ask.ASK_SLOT_LABELS.length);
  assert.equal(ask.ASK_BIO_LABELS[0], 'O');
  assert.ok(ask.ASK_INTENTS.includes('unknown'));
  for (const intent of ask.ASK_INTENTS) assert.ok(ask.ASK_INTENT_SLOTS[intent], intent);
});

test('lexicons never map one normalised phrase to two values', () => {
  const check = (lexicon, what) => {
    const seen = new Map();
    for (const language of ask.ASK_LANGUAGES) {
      for (const [key, surfaces] of Object.entries(lexicon[language])) {
        for (const surface of surfaces) {
          const norm = ask.askTokens(surface).join(' ');
          assert.ok(norm, `${what} ${surface} normalises to nothing`);
          if (seen.has(norm)) assert.equal(seen.get(norm), key, `${what} "${surface}" (${language}) collides`);
          seen.set(norm, key);
        }
      }
    }
  };
  check(ask.ASK_CATEGORY_LEXICON, 'category');
  check(ask.ASK_PERIOD_LEXICON, 'period');
  const numbers = new Map();
  for (const language of ask.ASK_LANGUAGES) {
    ask.ASK_NUMBER_WORDS[language].forEach((variants, index) => {
      for (const word of variants) {
        const norm = ask.askTokens(word).join(' ');
        if (numbers.has(norm)) assert.equal(numbers.get(norm), index + 1, `number word ${word} collides`);
        numbers.set(norm, index + 1);
      }
    });
  }
  for (const language of ask.ASK_LANGUAGES) {
    for (const [key, surfaces] of Object.entries(ask.ASK_CATEGORY_LEXICON[language])) {
      for (const surface of surfaces) assert.equal(ask.normalizeAskCategory(surface), key, `${language} ${surface}`);
    }
  }
});

test('period spans normalise to closed keys, and refuse what the planner owns', () => {
  const cases = {
    'هالشهر': 'this-month', 'هذا الشهر': 'this-month', 'الشهر اللي فات': 'last-month', 'البارحة': 'yesterday',
    'اليوم': 'today', 'hari ini': 'today', 'آخر ٣٠ يوم': 'last-days:30', 'في آخر 7 أيام': 'last-days:7',
    'since January': 'since-month:1', 'من بداية يناير': 'since-month:1', 'Mart ayından beri': 'since-month:3',
    'Ağustos ayında': 'month:8', 'le mois dernier': 'last-month', "l'année dernière": 'last-year', 'letzten 30 Tagen': 'last-days:30',
    'bulan kemarin': 'last-month', 'kemarin': 'yesterday', 'pichle mahine': 'last-month', 'March': 'month:3', 'Sept': 'month:9',
    'كانون الأول': 'month:12', 'كانون الثاني': 'month:1', 'in March': 'month:3',
  };
  for (const [text, key] of Object.entries(cases)) assert.equal(ask.normalizeAskPeriodKey(text), key, text);
  for (const text of ['2026-03', 'March 2025', 'March to May', 'last 200 days', 'next week', 'Ramadan', '']) {
    assert.equal(ask.normalizeAskPeriodKey(text), null, text);
  }
});

test('categories, counts', () => {
  assert.equal(ask.normalizeAskCategory('بالمطاعم'), 'dining');
  assert.equal(ask.normalizeAskCategory('للمطاعم'), 'dining');
  assert.equal(ask.normalizeAskCategory('restoranlara'), 'dining');
  assert.equal(ask.normalizeAskCategory('Supermärkte'), 'groceries', 'inflected plural of one lexicon word');
  assert.equal(ask.normalizeAskCategory('coffee'), null, 'narrow concepts are never widened to a category');
  assert.equal(ask.normalizeAskCategory('restaurants and rent'), null, 'two categories in one span is ambiguous');
  assert.equal(ask.normalizeAskTopN('٥'), 5);
  assert.equal(ask.normalizeAskTopN('cinq'), 5);
  assert.equal(ask.normalizeAskTopN('خمسة'), 5);
  assert.equal(ask.normalizeAskTopN('11'), null);
  assert.equal(ask.normalizeAskTopN('0'), null);
});

test('period resolution agrees with the deterministic planner', () => {
  const state = { accounts: [], transactions: [], bills: [], cardDues: [], notSubscriptions: [] };
  const cases = { today: 'today', yesterday: 'yesterday', 'this week': 'this-week', 'last week': 'last-week',
    'this month': 'this-month', 'last month': 'last-month', 'this year': 'this-year', 'last year': 'last-year',
    'all time': 'all-time', 'March': 'month:3', 'November': 'month:11', 'the last 30 days': 'last-days:30' };
  for (const [phrase, key] of Object.entries(cases)) {
    const planned = assistant.planAssistantQuestion(state, `How much did I spend ${phrase}?`, NOW);
    assert.equal(planned.tool, 'spending-total', phrase);
    assert.deepEqual(ask.resolveAskPeriod(key, NOW), planned.period, phrase);
  }
  assert.deepEqual(ask.resolveAskPeriod('since-month:1', NOW), { mode: 'range', from: '2026-01-01', to: '2026-09-20' });
  assert.deepEqual(ask.resolveAskPeriod('since-month:11', NOW), { mode: 'range', from: '2025-11-01', to: '2026-09-20' });
  assert.equal(ask.resolveAskPeriod('last-days:91', NOW), null);
  assert.equal(ask.resolveAskPeriod('month:13', NOW), null);
});

test('maps Gulf Arabic to the same request the rules produce for English', () => {
  const q = 'كم صرفت على المطاعم هالشهر؟';
  const request = ask.mapAskModelOutput(model('spending_total', q, [['Q_CAT', 'المطاعم'], ['Q_PERIOD', 'هالشهر']]), q, ctx());
  const state = { accounts: [], transactions: [], bills: [], cardDues: [], notSubscriptions: [] };
  assert.deepEqual(request, assistant.planAssistantQuestion(state, 'How much did I spend on dining this month?', NOW));
  assert.ok(isAssistantToolRequest(request));
});

test('maps merchants, accounts, counts and comparisons to known ids only', () => {
  let q = 'وش أكبر ٥ مشتريات من طلبات الشهر الماضي؟';
  assert.deepEqual(ask.mapAskModelOutput(model('largest_purchases', q, [['Q_TOPN', '٥'], ['Q_MER', 'طلبات'], ['Q_PERIOD', 'الشهر الماضي']]), q, ctx()),
    { tool: 'largest-purchases', period: { mode: 'month', key: '2026-08' }, merchant: 'طلبات', limit: 5 });
  q = '¿Cuánto gasté con visa platinum en marzo?';
  assert.deepEqual(ask.mapAskModelOutput(model('spending_total', q, [['Q_ACCT', 'visa platinum'], ['Q_PERIOD', 'marzo']]), q, ctx()),
    { tool: 'spending-total', period: { mode: 'month', key: '2026-03' }, accountIds: ['acct-visa'] });
  q = 'Vergleiche diesen Monat mit letzten Monat';
  assert.deepEqual(ask.mapAskModelOutput(model('compare_periods', q, [['Q_PERIOD', 'diesen Monat'], ['Q_CMP', 'letzten Monat']]), q, ctx()),
    { tool: 'compare-periods', period: { mode: 'month', key: '2026-09' }, comparisonPeriod: { mode: 'month', key: '2026-08' } });
  q = 'Quelle carte ai-je le plus utilisée ?';
  assert.deepEqual(ask.mapAskModelOutput(model('top_accounts', q, []), q, ctx()),
    { tool: 'top-accounts', period: currentMonthPeriod(NOW), accountKind: 'card', metric: 'amount' });
  q = 'Kaç kartım var?';
  assert.deepEqual(ask.mapAskModelOutput(model('account_inventory', q, []), q, ctx()), { tool: 'account-inventory', accountKind: 'card' });
  q = 'Hangi hesaplarım var?';
  assert.deepEqual(ask.mapAskModelOutput(model('account_inventory', q, []), q, ctx()), { tool: 'account-inventory', accountKind: 'all' });
  q = 'Quais assinaturas eu tenho?';
  assert.deepEqual(ask.mapAskModelOutput(model('subscriptions', q, []), q, ctx()), { tool: 'subscriptions' });
  const selected = { mode: 'range', from: '2026-09-01', to: '2026-09-10' };
  q = 'Gastos por categoría';
  assert.deepEqual(ask.mapAskModelOutput(model('top_categories', q, []), q, ctx({ defaultPeriod: selected })), { tool: 'top-categories', period: selected });
});

test('refuses rather than guessing', () => {
  const refuse = (output, q, extra) => assert.equal(ask.mapAskModelOutput(output, q, ctx(extra)), null, JSON.stringify(output));
  let q = 'كم صرفت على المطاعم هالشهر؟';
  const good = model('spending_total', q, [['Q_CAT', 'المطاعم'], ['Q_PERIOD', 'هالشهر']]);
  refuse({ ...good, intent: 'unknown' }, q);
  refuse({ ...good, intent: 'transfer_money' }, q);
  refuse({ ...good, intentP: 0.79 }, q);
  refuse({ ...good, intentP: 0.9 }, q, { intentThreshold: 0.95 });
  refuse({ ...good, intentP: Number.NaN }, q);
  refuse(model('spending_total', q, [['Q_CAT', 'المطاعم', 0.3], ['Q_PERIOD', 'هالشهر']]), q);
  refuse({ ...good, spans: [...good.spans, { label: 'Q_BANK', start: 0, end: 2 }] }, q);
  refuse({ ...good, spans: [{ label: 'Q_CAT', start: 5, end: 500 }] }, q);
  refuse({ ...good, spans: [{ label: 'Q_CAT', start: 3, end: 10 }, { label: 'Q_PERIOD', start: 8, end: 14 }] }, q);
  refuse(model('subscriptions', q, [['Q_CAT', 'المطاعم']]), q);
  q = 'How much did I spend on coffee?';
  refuse(model('spending_total', q, [['Q_CAT', 'coffee']]), q);
  q = 'How much did I spend at Starbucks?';
  refuse(model('spending_total', q, [['Q_MER', 'Starbucks']]), q);
  q = 'How much did I spend at Talabat?';
  refuse(model('spending_total', q, []), q);
  q = 'Show my transactions over 500 this month';
  refuse(model('spending_total', q, [['Q_PERIOD', 'this month']]), q);
  q = 'Show my top 15 merchants';
  refuse(model('top_merchants', q, [['Q_TOPN', '15']]), q);
  q = 'How much did I spend in March 2025?';
  refuse(model('spending_total', q, [['Q_PERIOD', 'March 2025']]), q);
  q = 'Am I on track last month?';
  refuse(model('month_forecast', q, [['Q_PERIOD', 'last month']]), q);
  q = 'Compare all time with last month';
  refuse(model('compare_periods', q, [['Q_PERIOD', 'all time'], ['Q_CMP', 'last month']]), q);
  q = 'How much did I spend with Mastercard Gold?';
  refuse(model('spending_total', q, [['Q_ACCT', 'Mastercard Gold']]), q);
  refuse(null, q);
  refuse({ intent: 'spending_total' }, q);
});

test('span text supplied by the model is ignored; the question slice is authoritative', () => {
  const q = 'How much did I spend on rent this month?';
  const output = model('spending_total', q, [['Q_CAT', 'rent'], ['Q_PERIOD', 'this month']]);
  output.spans[0].text = 'dining';
  assert.equal(ask.mapAskModelOutput(output, q, ctx()).category, 'rent');
});

test('rules first: the model acts only when the rules did not understand a fresh question', () => {
  const q = 'كم صرفت على المطاعم هالشهر؟';
  const good = model('spending_total', q, [['Q_CAT', 'المطاعم'], ['Q_PERIOD', 'هالشهر']]);
  const answered = { tool: 'spending-total', period: currentMonthPeriod(NOW) };
  assert.deepEqual(ask.understandAskQuestion(q, answered, good, ctx()), { source: 'rules', request: answered });
  const safety = { tool: 'help', clarification: 'I can explain recorded spending and income, but cannot reliably answer that condition.' };
  assert.equal(ask.understandAskQuestion(q, safety, good, ctx()).source, 'rules', 'a safety clarification is never overridden');
  const viaModel = ask.understandAskQuestion(q, HELP, good, ctx());
  assert.equal(viaModel.source, 'model');
  assert.equal(viaModel.request.tool, 'category-breakdown');
  assert.equal(ask.understandAskQuestion(q, { tool: 'help' }, good, ctx()).source, 'model');
  assert.deepEqual(ask.understandAskQuestion(q, HELP, good, ctx({ previousRequest: answered })),
    { source: 'refused', request: HELP, reason: 'conversation-context-present' });
  assert.deepEqual(ask.understandAskQuestion(q, HELP, null, ctx()), { source: 'refused', request: HELP, reason: 'no-model-output' });
  assert.deepEqual(ask.understandAskQuestion(q, HELP, { ...good, intentP: 0.2 }, ctx()),
    { source: 'refused', request: HELP, reason: 'model-output-rejected' });
  const oos = 'حول 500 درهم إلى أحمد';
  assert.equal(ask.understandAskQuestion(oos, HELP, model('unknown', oos, [], 0.99), ctx()).source, 'refused');
});

test('question set: template coverage, template-disjoint split, gold round-trips through the mapping', () => {
  const rows = questions.generate();
  const { TEMPLATES } = require('../parser-ai/ask/templates.cjs');
  for (const language of ask.ASK_LANGUAGES) {
    for (const intent of ask.ASK_INTENTS) {
      const min = language === 'en' || language === 'ar' ? 15 : 6;
      assert.ok(TEMPLATES[language][intent].length >= min, `${language}/${intent} has ${TEMPLATES[language][intent].length} templates`);
    }
  }
  const splitOf = new Map();
  for (const row of rows) {
    if (splitOf.has(row.template)) assert.equal(splitOf.get(row.template), row.split, row.template);
    splitOf.set(row.template, row.split);
  }
  for (const split of ['train', 'dev', 'test']) assert.ok(rows.some((row) => row.split === split), split);
  for (const language of ask.ASK_LANGUAGES) {
    for (const intent of ask.ASK_INTENTS) {
      assert.ok(rows.some((row) => row.language === language && row.intent === intent && row.split === 'test'), `${language}/${intent} has test rows`);
    }
  }
  const unknownShare = rows.filter((row) => row.intent === 'unknown').length / rows.length;
  assert.ok(unknownShare > 0.08 && unknownShare < 0.15, `unknown share ${unknownShare}`);
  assert.equal(new Set(rows.map((row) => row.question)).size, rows.length, 'questions are unique');
  assert.deepEqual(questions.generate().slice(0, 50), rows.slice(0, 50), 'generation is deterministic');

  const { merchants, accounts } = buildState();
  const context = { now: questions.NOW, knownMerchants: merchants, knownAccounts: accounts.map(({ id, name }) => ({ id, name })) };
  const names = new Map(accounts.map((account) => [account.id, account.name]));
  for (const row of rows) {
    const request = ask.mapAskModelOutput({ intent: row.intent, intentP: 1, spans: row.spans }, row.question, context);
    if (row.intent === 'unknown') { assert.equal(request, null, row.id); continue; }
    assert.ok(request, `${row.id} ${row.question}`);
    assert.equal(requestSlots(request, names), goldSlots(row), `${row.id} ${row.question}`);
  }
});
