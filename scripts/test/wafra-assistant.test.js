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
  const incoming = tx('income-regression', '2026-09-12', 'Incoming transfer', 5_000, 'other', 'income');
  const evidence = { version: 1, currency: 'AED', attribution: 'source' };
  const cases = [
    { name: 'cash deposit is money movement, not income',
      row: { ...incoming, title: 'Cash deposit' }, additionalIncomeFils: 0 },
    { name: 'external decision overrides the legacy transfer flag',
      row: { ...incoming, isTransfer: true,
        transferDecision: { version: 1, ownership: 'external', decidedAt: now.getTime() } },
      additionalIncomeFils: 5_000 },
    { name: 'own decision excludes income without a legacy transfer flag',
      row: { ...incoming,
        transferDecision: { version: 1, ownership: 'own', decidedAt: now.getTime() } },
      additionalIncomeFils: 0 },
    { name: 'unresolved transfer ownership stays outside confirmed income',
      row: { ...incoming, transferEvidence: evidence }, additionalIncomeFils: 0 },
    { name: 'source-proven external income survives the legacy transfer flag',
      row: { ...incoming, isTransfer: true, transferEvidence: { ...evidence, explicitExternal: true } },
      additionalIncomeFils: 5_000 },
    { name: 'source-proven own transfer is not earned income',
      row: { ...incoming, transferEvidence: { ...evidence, explicitOwn: true } }, additionalIncomeFils: 0 },
    { name: 'completed cashback remains income',
      row: { ...incoming, title: 'Cashback credit', amountFils: 250 }, additionalIncomeFils: 250 },
    { name: 'card repayment receipt is not income',
      row: { ...incoming, title: 'Card payment', isTransfer: true, cardPaymentSide: 'receipt' },
      additionalIncomeFils: 0 },
  ];
  const actual = cases.map(({ name, row }) => {
    const withIncoming = { ...state, transactions: [...state.transactions, row] };
    const income = answerWafraQuestion(withIncoming, 'How much income did I receive this month?', now);
    const net = answerWafraQuestion(withIncoming, 'Did I spend more than I earned this month?', now);
    return { name, incomeFils: income.data.totalFils, netFils: net.data.netFils };
  });
  assert.deepEqual(actual, cases.map(({ name, additionalIncomeFils }) => ({
    name, incomeFils: 20_000 + additionalIncomeFils, netFils: 14_000 + additionalIncomeFils,
  })), 'Assistant income and net must follow the same financial inclusion rules as the ledger');
}

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
  assert.equal(answer.data.averageFils, 2_500);
  assert.equal(answer.data.largestFils, 3_000);
  assert.ok(answer.body.includes('Sep 2026'), 'answer should confirm the period it used');
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
  const spending = answerWafraQuestion(state, 'How much did I spend this month?', now);
  assert.ok(spending.facts.some((fact) => fact.label === 'Top category'));
  assert.ok(spending.facts.some((fact) => fact.label === 'Average transaction'));
  const income = answerWafraQuestion(state, 'How much income did I receive this month?', now);
  assert.equal(income.tool, 'income-total');
  assert.equal(income.facts[0].label, 'Salary');
}

{
  const biggest = answerWafraQuestion(state, 'What was my biggest purchase this month?', now);
  assert.equal(biggest.tool, 'largest-purchases');
  assert.equal(biggest.data.largestFils, 3_000);
  assert.equal(biggest.facts[0].label, 'Talabat');

  const daily = answerWafraQuestion(state, 'How much do I spend per day?', now);
  assert.equal(daily.tool, 'daily-average');
  assert.equal(daily.data.totalFils, 6_000);
  assert.ok(daily.data.elapsedDays > 0);

  const net = answerWafraQuestion(state, 'Did I spend more than I earned this month?', now);
  assert.equal(net.tool, 'net-income-spending');
  assert.equal(net.data.incomeFils, 20_000);
  assert.equal(net.data.spendingFils, 6_000);
  assert.equal(net.data.netFils, 14_000);
}

{
  const interpretation = buildAssistantInterpretationEnvelope('Why am I spending more?');
  assert.equal(interpretation.v, 1);
  assert.equal(interpretation.question, 'Why am I spending more?');
  assert.ok(interpretation.tools.some((tool) => tool.tool === 'compare-periods'));
  assert.ok(interpretation.tools.some((tool) => tool.tool === 'largest-purchases'));
  assert.ok(interpretation.tools.some((tool) => tool.tool === 'help'));

  const answer = answerWafraQuestion(state, 'How much did I spend at Talabat?', now);
  const explanation = buildAssistantExplanationEnvelope('Explain this', answer);
  assert.equal(explanation.tool, 'merchant-breakdown');
  assert.equal(explanation.result.data.totalFils, 5_000);
  assert.equal(JSON.stringify(explanation).includes('bank-1'), false,
    'the model envelope must not contain account identifiers');
}

{
  const nonsense = answerWafraQuestion(state, 'What is my favorite colour?', now);
  assert.equal(nonsense.tool, 'help', 'unknown questions must not silently become a spending answer');
  const capabilities = answerWafraQuestion(state, 'What can you do?', now);
  assert.equal(capabilities.tool, 'help');
  assert.equal(isAssistantToolRequest({ tool: 'help' }), true);
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
  assert.deepEqual(planAssistantQuestion(state, 'How much did I spend today?', now).period,
    { mode: 'range', from: '2026-09-20', to: '2026-09-20' });
  assert.deepEqual(planAssistantQuestion(state, 'How much did I spend in the last 7 days?', now).period,
    { mode: 'range', from: '2026-09-14', to: '2026-09-20' });
  assert.deepEqual(planAssistantQuestion(state, 'How much did I spend in August?', now).period,
    { mode: 'month', key: '2026-08' });
  assert.deepEqual(planAssistantQuestion(state, 'How much did I spend in December?', now).period,
    { mode: 'month', key: '2025-12' }, 'a future month name without a year means the most recent occurrence');
}

{
  const top3 = planAssistantQuestion(state, 'Top 3 merchants this month', now);
  assert.equal(top3.tool, 'top-merchants');
  assert.equal(top3.limit, 3);
  const due7 = planAssistantQuestion(state, 'What is due in the next 7 days?', now);
  assert.equal(due7.tool, 'upcoming-payments');
  assert.equal(due7.withinDays, 7);
}

{
  const previous = planAssistantQuestion(state, 'How much did I spend at Talabat?', now);
  const followUp = planAssistantQuestion(state, 'What about last month?', now, previous);
  assert.equal(followUp.tool, 'merchant-breakdown');
  assert.equal(followUp.merchant, 'Talabat');
  assert.deepEqual(followUp.period, { mode: 'month', key: '2026-08' });
  const answer = executeAssistantTool(state, followUp, now);
  assert.equal(answer.data.totalFils, 2_000);
  const contextualTop = planAssistantQuestion(state, 'Top 3 merchants', now, followUp);
  assert.equal(contextualTop.tool, 'top-merchants');
  assert.deepEqual(contextualTop.period, { mode: 'month', key: '2026-08' },
    'short follow-ups should inherit the active reporting period');
}

{
  const noSeptemberTalabat = { ...state, transactions: state.transactions.filter((row) => !row.id.startsWith('sep-food')) };
  const request = planAssistantQuestion(noSeptemberTalabat, 'How much did I spend at Talabat this month?', now);
  assert.equal(request.tool, 'merchant-breakdown', 'merchant identity should come from ledger history, not only selected-period rows');
  assert.equal(executeAssistantTool(noSeptemberTalabat, request, now).data.totalFils, 0);
}

{
  const descriptorState = {
    ...state,
    transactions: [
      tx('coffee', '2026-09-08', 'STARBUCKS DUBAI MALL', 2_500, 'dining'),
      tx('grocer', '2026-09-09', 'Carrefour', 4_000, 'groceries'),
    ],
  };
  const request = planAssistantQuestion(descriptorState, 'How much did I spend at Starbucks?', now);
  assert.equal(request.tool, 'merchant-breakdown');
  assert.equal(request.merchant, 'STARBUCKS DUBAI MALL',
    'a unique merchant token should resolve a longer bank descriptor');

  const ambiguousState = {
    ...descriptorState,
    transactions: [
      ...descriptorState.transactions,
      tx('coffee-2', '2026-09-10', 'STARBUCKS MARINA', 2_000, 'dining'),
    ],
  };
  const ambiguous = planAssistantQuestion(ambiguousState, 'How much did I spend at Starbucks?', now);
  assert.notEqual(ambiguous.tool, 'merchant-breakdown',
    'a short name shared by multiple stored descriptors must not guess which merchant row the user meant');
}

{
  const priorOnly = {
    ...state,
    transactions: [
      tx('aug-travel', '2026-08-05', 'Airline', 9_000, 'travel'),
      tx('sep-food', '2026-09-05', 'Talabat', 2_000, 'dining'),
    ],
  };
  const answer = answerWafraQuestion(priorOnly, 'Why did my spending change?', now);
  assert.ok(answer.facts.some((fact) => fact.label === 'Travel change' && fact.value.startsWith('−')),
    'comparison must explain categories that disappeared as well as categories that grew');
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
