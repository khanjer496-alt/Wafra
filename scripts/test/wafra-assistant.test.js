const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  answerWafraQuestion,
  executeAssistantTool,
  planAssistantQuestion,
} = require('./build/wafra-assistant');
const {
  buildAssistantExplanationEnvelope,
  buildAssistantInterpretationEnvelope,
  isAssistantToolRequest,
} = require('./build/wafra-assistant-ai');
const markets = require('./build/markets');

const account = {
  id: 'bank-1', name: 'Everyday', kind: 'bank', openingFils: 0, color: '#000000',
};
const tx = (id, date, title, amountFils, category = 'dining', type = 'expense') => ({
  id, date, title, amountFils, category, type, accountId: account.id, source: 'sms',
});
const state = {
  accounts: [account],
  transactions: [
    tx('sep-food-1', '2026-09-02', 'Talabat', 3_000, 'dining'),
    tx('sep-food-2', '2026-09-05', 'Talabat', 2_000, 'dining'),
    tx('sep-grocery', '2026-09-06', 'Carrefour', 1_000, 'groceries'),
    tx('sep-income', '2026-09-01', 'Salary', 20_000, 'salary', 'income'),
    tx('aug-food', '2026-08-05', 'Talabat', 2_000, 'dining'),
  ],
  notSubscriptions: [],
  bills: [],
  cardDues: [],
};

const now = new Date('2026-09-20T12:00:00Z');

{
  const request = planAssistantQuestion(state, 'What are my top spending categories?', now);
  assert.equal(request.tool, 'top-categories');
  const answer = executeAssistantTool(state, request, now);
  assert.equal(answer.tool, 'top-categories');
  assert.equal(answer.data.spendingFils, 6_000);
  assert.equal(answer.facts[0].label, 'Dining');
  assert.equal(answer.facts[0].value.includes('50'), true,
    'AED formatter should preserve the 5,000 fils dining total as a visible money figure');
}

{
  const answer = answerWafraQuestion(state, 'How much did I spend at Talabat?', now);
  assert.equal(answer.tool, 'merchant-breakdown');
  assert.equal(answer.data.totalFils, 5_000);
  assert.equal(answer.data.transactionCount, 2);
}

{
  const answer = answerWafraQuestion(state, 'Why did my spending change?', now);
  assert.equal(answer.tool, 'compare-periods');
  assert.equal(answer.data.currentFils, 6_000);
  assert.equal(answer.data.previousFils, 2_000);
  assert.equal(answer.data.deltaPercent, 200);
  assert.ok(answer.facts.some((fact) => fact.label === 'Dining change'));
}

{
  const answer = answerWafraQuestion(state, 'What am I on track to spend this month?', now);
  assert.equal(answer.tool, 'month-forecast');
  assert.equal(answer.data.spentFils, 6_000);
  assert.equal(typeof answer.data.projectedFils, 'number');
}

{
  const interpretation = buildAssistantInterpretationEnvelope('Why am I spending more?');
  assert.equal(interpretation.v, 1);
  assert.equal(interpretation.question, 'Why am I spending more?');
  assert.ok(interpretation.tools.some((tool) => tool.tool === 'compare-periods'));

  const answer = answerWafraQuestion(state, 'How much did I spend at Talabat?', now);
  const explanation = buildAssistantExplanationEnvelope('Explain this', answer);
  assert.equal(explanation.tool, 'merchant-breakdown');
  assert.equal(explanation.result.data.totalFils, 5_000);
  assert.equal(JSON.stringify(explanation).includes('bank-1'), false,
    'the model envelope must not contain account identifiers');
}

{
  assert.equal(isAssistantToolRequest({
    tool: 'top-merchants', period: { mode: 'month', key: '2026-09' }, limit: 5,
  }), true);
  assert.equal(isAssistantToolRequest({
    tool: 'category-breakdown', period: { mode: 'month', key: '2026-09' }, category: 'dining',
  }), true);
  assert.equal(isAssistantToolRequest({
    tool: 'category-breakdown', period: { mode: 'month', key: '2026-09' }, category: 'made-up',
  }), false);
  assert.equal(isAssistantToolRequest({ tool: 'delete-everything' }), false,
    'a provider cannot invent a mutating capability');
}

console.log('✓ Wafra Assistant deterministic tools and AI boundary');

{
  const empty = { ...state, transactions: [] };
  const spending = answerWafraQuestion(empty, 'How much did I spend this month?', now);
  assert.equal(spending.data.totalFils, 0);
  assert.equal(spending.data.transactionCount, 0);
  const top = answerWafraQuestion(empty, 'What are my top spending categories?', now);
  assert.equal(top.data.spendingFils, 0);
  assert.equal(top.facts.length, 0);
}

{
  const transfer = tx('own-transfer', '2026-09-07', 'Move to savings', 900_000, 'other');
  transfer.isTransfer = true;
  const withTransfer = { ...state, transactions: [...state.transactions, transfer] };
  const answer = answerWafraQuestion(withTransfer, 'How much did I spend this month?', now);
  assert.equal(answer.data.totalFils, 6_000, 'own-account transfers must never inflate Assistant spending');
}

{
  const split = tx('split-1', '2026-09-10', 'Hypermarket', 10_000, 'shopping');
  split.splits = [
    { category: 'groceries', amountFils: 7_000 },
    { category: 'shopping', amountFils: 3_000 },
  ];
  const splitState = { ...state, transactions: [split] };
  const groceries = executeAssistantTool(splitState, {
    tool: 'category-breakdown', period: { mode: 'month', key: '2026-09' }, category: 'groceries',
  }, now);
  assert.equal(groceries.data.totalFils, 7_000, 'category breakdown must count only the split allocation');
  assert.equal(groceries.data.transactionCount, 1);
  assert.equal(groceries.facts[0].label, 'Hypermarket');
  const top = executeAssistantTool(splitState, {
    tool: 'top-categories', period: { mode: 'month', key: '2026-09' },
  }, now);
  assert.equal(top.facts[0].label, 'Groceries', 'top categories must use split allocations, not headline category');
}

{
  const early = new Date('2026-09-03T12:00:00Z');
  const forecast = answerWafraQuestion(state, 'What am I on track to spend this month?', early);
  assert.equal(forecast.data.projectedFils, null, 'forecast must stay conservative with too little month history');
}

{
  const lastMonth = planAssistantQuestion(state, 'How much did I spend last month?', now);
  assert.deepEqual(lastMonth.period, { mode: 'month', key: '2026-08' });
  const lastYear = planAssistantQuestion(state, 'How much did I spend last year?', now);
  assert.deepEqual(lastYear.period, { mode: 'year', year: 2025 });
  const allTime = planAssistantQuestion(state, 'How much did I spend all time?', now);
  assert.deepEqual(allTime.period, { mode: 'all' });
}

{
  markets.setLedgerCurrency('USD', 2);
  const answer = answerWafraQuestion(state, 'How much did I spend this month?', now);
  assert.match(answer.body, /USD/, 'Assistant display must follow the ledger currency, not assume AED');
  markets.setLedgerCurrency(null);
}

{
  const hugeQuestion = `why ${'x'.repeat(2_000)}`;
  assert.equal(buildAssistantInterpretationEnvelope(hugeQuestion).question.length, 1_000);

  assert.equal(isAssistantToolRequest({
    tool: 'spending-total', period: { mode: 'month', key: '2026-13' },
  }), false, 'impossible month must be rejected');
  assert.equal(isAssistantToolRequest({
    tool: 'spending-total', period: { mode: 'range', from: '2026-02-30', to: '2026-03-01' },
  }), false, 'impossible date must be rejected');
  assert.equal(isAssistantToolRequest({
    tool: 'spending-total', period: { mode: 'range', from: '2026-10-01', to: '2026-09-01' },
  }), false, 'reversed date range must be rejected');
  assert.equal(isAssistantToolRequest({
    tool: 'top-merchants', period: { mode: 'month', key: '2026-09' }, limit: 11,
  }), false, 'provider limits above the local cap must be rejected');
  assert.equal(isAssistantToolRequest({ tool: 'upcoming-payments', withinDays: 91 }), false);
  assert.equal(isAssistantToolRequest({
    tool: 'merchant-breakdown', period: { mode: 'month', key: '2026-09' }, merchant: 'x'.repeat(161),
  }), false, 'oversized provider merchant arguments must be rejected');
}

{
  const explanation = buildAssistantExplanationEnvelope('Explain', {
    tool: 'spending-total',
    title: 'Spending',
    body: 'Exact local result',
    data: {
      totalFils: 123,
      accountId: 'private-account',
      card_id: 'private-card',
      rawSms: 'private message',
      transactionId: 'private-transaction',
    },
  });
  assert.equal(explanation.result.data.totalFils, 123);
  const serialized = JSON.stringify(explanation.result.data);
  for (const secret of ['private-account', 'private-card', 'private message', 'private-transaction']) {
    assert.equal(serialized.includes(secret), false, `explanation boundary leaked ${secret}`);
  }
}

{
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/lib/wafra-assistant.ts'), 'utf8');
  assert.equal(/[\u0600-\u06ff]/.test(source), false,
    'deterministic Assistant core must not embed one language-specific non-Latin vocabulary');
}

console.log('✓ Wafra Assistant global hardening edge cases');
