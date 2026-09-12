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
  const answer = executeAssistantTool(state, { tool: 'largest-purchases', period: { mode: 'month', key: '2026-09' }, limit: 2 }, now);
  assert.deepEqual(answer.evidence[0].transactionIds, ['sep-food-1', 'sep-food-2'], 'proof must match the purchases shown, not every expense');
  assert.equal(answer.evidence[0].totalFils, 5_000);
  assert.equal(answer.evidence[0].ordered, true, 'the evidence view preserves the displayed purchase ranking');
  assert.equal(answer.data.displayedPurchaseCount, 2);
  assert.equal(answer.data.displayedTotalFils, 5_000);
}

// These are user questions, not parser implementation assertions: every
// requested restriction must survive, or the answer must ask for clarification.
{
  const salary = answerWafraQuestion(state, 'How much salary did I receive?', now);
  assert.equal(salary.tool, 'income-total', 'salary must not become spending at a merchant called Salary');
  assert.equal(salary.data.totalFils, 20_000);
  const paid = answerWafraQuestion(state, 'What did I pay at Carrefour last month?', now);
  assert.equal(paid.tool, 'merchant-breakdown', 'a historical payment question must not become upcoming bills');
  assert.equal(paid.data.totalFils, 0);
  for (const question of [
    'How much did I spend at Unknown Shop?',
    'How much did I spend from my current account?',
    'Can I afford to spend 500 this month?',
    'How much did I spend before August?',
    'How much did I spend on 03/04/2026?',
    'How much did I spend in the last 100 days?',
  ]) {
    const answer = answerWafraQuestion(state, question, now);
    assert.equal(answer.tool, 'help', `unsupported constraints must not broaden: ${question}`);
    assert.equal(answer.data, undefined);
    assert.equal(answer.evidence, undefined);
  }
  const categoryComparison = answerWafraQuestion(state, 'Why did my dining spending increase?', now);
  assert.equal(categoryComparison.tool, 'compare-periods');
  assert.equal(categoryComparison.data.currentFils, 5_000);
  assert.equal(categoryComparison.data.previousFils, 2_000);
  const merchantComparison = answerWafraQuestion(state, 'Compare Talabat September 2026 with August 2026', now);
  assert.equal(merchantComparison.tool, 'compare-periods');
  assert.equal(merchantComparison.data.currentFils, 5_000);
  assert.equal(merchantComparison.data.previousFils, 2_000);
  const reverse = answerWafraQuestion(state, 'Compare Talabat August 2026 with September 2026', now);
  assert.equal(reverse.data.currentFils, 2_000, 'named comparison periods retain the question order');
  assert.equal(reverse.data.previousFils, 5_000);
}


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
  assert.equal(answer.data.projectedFils, null, 'old recorded spending must not look like a current pace');
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

{
  const examples = [
    ['from 2026-09-02 to 2026-09-05', '2026-09-02', '2026-09-05', 5_000],
    ['September 2 to 5, 2026', '2026-09-02', '2026-09-05', 5_000],
    ['September 2, 2026 to September 6, 2026', '2026-09-02', '2026-09-06', 6_000],
    ['from 2 September 2026 to 5 September 2026', '2026-09-02', '2026-09-05', 5_000],
  ];
  for (const [phrase, from, to, expected] of examples) {
    const answer = answerWafraQuestion(state, `How much did I spend ${phrase}?`, now);
    assert.equal(answer.data?.totalFils, expected, phrase);
    assert.equal(answer.evidence[0].from, from);
    assert.equal(answer.evidence[0].to, to);
  }
  for (const phrase of ['from 2026-02-30 to 2026-03-02', 'September 5 to 2, 2026', 'between August and September']) {
    assert.equal(answerWafraQuestion(state, `How much did I spend ${phrase}?`, now).tool, 'help', phrase);
  }
  assert.equal(answerWafraQuestion(state, 'How much did I spend?', now, null,
    { mode: 'month', key: '2026-08' }).data.totalFils, 2_000, 'screen period is the default');
}

{
  const second = { ...account, id: 'bank-2', name: 'Current Account' };
  const accountsState = { ...state, accounts: [account, second], transactions: [...state.transactions,
    { ...tx('second-food', '2026-09-03', 'Talabat', 7_000), accountId: second.id },
    { ...tx('second-rent', '2026-09-04', 'Landlord', 50_000, 'rent'), accountId: second.id },
  ] };
  const result = answerWafraQuestion(accountsState, 'How much did I spend from my Current Account?', now);
  assert.equal(result.tool, 'spending-total', 'current account must not match rent');
  assert.equal(result.data.totalFils, 57_000);
  assert.deepEqual(result.evidence[0].transactionIds, ['second-food', 'second-rent']);
  assert.deepEqual(result.evidence[0].accountNames, ['Current Account']);
  const request = planAssistantQuestion(accountsState, 'How much dining spending at Talabat from Everyday this month?', now);
  assert.equal(executeAssistantTool(accountsState, request, now).data.totalFils, 5_000);
  const follow = planAssistantQuestion(accountsState, 'What about last month?', now, request);
  assert.equal(executeAssistantTool(accountsState, follow, now).data.totalFils, 2_000);
  assert.deepEqual(follow.accountIds, ['bank-1']);
  assert.equal(follow.category, 'dining');
  assert.equal(follow.merchant, 'Talabat');
}

{
  const lateState = { ...state, transactions: [...state.transactions,
    tx('aug-late', '2026-08-29', 'Carrefour', 50_000, 'groceries'),
    tx('sep-future', '2026-09-29', 'Carrefour', 70_000, 'groceries'),
  ] };
  const comparison = answerWafraQuestion(lateState, 'Why did my spending change?', now);
  assert.equal(comparison.data.currentFils, 6_000);
  assert.equal(comparison.data.previousFils, 2_000, 'implicit comparison must match elapsed days');
  assert.equal(comparison.evidence[0].to, '2026-09-20');
  assert.equal(comparison.evidence[1].to, '2026-08-20');
  assert.equal(comparison.evidence[0].transactionIds.includes('sep-future'), false);
  assert.equal(comparison.evidence[1].transactionIds.includes('aug-late'), false);
  const full = answerWafraQuestion(lateState, 'Compare August 2026 with September 2026', now);
  assert.equal(full.data.currentFils, 52_000, 'explicit periods retain their full requested dates');
  assert.equal(full.evidence[0].to, '2026-08-31');
}

{
  const split = { ...tx('split-evidence', '2026-09-10', 'Carrefour', 10_000, 'shopping'), splits: [
    { category: 'groceries', amountFils: 7_000 }, { category: 'shopping', amountFils: 3_000 },
  ] };
  const result = answerWafraQuestion({ ...state, transactions: [split] }, 'How much groceries spending at Carrefour?', now);
  assert.equal(result.data.totalFils, 7_000);
  assert.deepEqual(result.evidence[0].transactionIds, ['split-evidence']);
  assert.deepEqual(result.evidence[0].contributions, { 'split-evidence': 7_000 });
  assert.equal(result.evidence[0].totalFils, 7_000);
  const net = answerWafraQuestion(state, 'Income minus spending', now);
  assert.deepEqual(net.evidence.map((group) => [group.label, group.totalFils]), [['Income', 20_000], ['Spending', 6_000]]);
  assert.match(net.body, /Based on recorded transactions/);
  assert.match(net.body, /missing imports/i);
  assert.equal(JSON.stringify(buildAssistantExplanationEnvelope('Explain', result)).includes('split-evidence'), false,
    'exact transaction evidence stays out of the optional explanation envelope');
}

{
  for (const title of ['Salary & bills', 'R&D / Cafe? #2 + 20%', 'Cedar "Express" \\ West', 'May Cafe', 'Rent a Car']) {
    const named = { ...state, transactions: [tx('named-merchant', '2026-09-02', title, 1_234)] };
    const result = answerWafraQuestion(named, `Why did spending at ${JSON.stringify(title)} change?`, now);
    assert.equal(result.tool, 'compare-periods', title);
    assert.equal(result.data.currentFils, 1_234, title);
    const income = { ...state, transactions: [tx('named-income', '2026-09-02', title, 4_321, 'business', 'income')] };
    assert.equal(answerWafraQuestion(income, `How much income did I receive from ${JSON.stringify(title)}?`, now).data.totalFils, 4_321, title);
  }
  assert.equal(answerWafraQuestion(state, 'Why did my other spending change?', now).data.currentFils, 0);
}

{
  for (const question of ['Spend at Talabat and Carrefour', 'How much groceries and dining spending?',
    'How much did I spend with Unknown Shop?', 'How much did I spend over 20?', 'How much did I spend in London?']) {
    assert.equal(answerWafraQuestion(state, question, now).tool, 'help', question);
  }
  const ambiguousState = { ...state, transactions: [tx('branch-a', '2026-09-02', 'STARBUCKS MALL', 1_000), tx('branch-b', '2026-09-03', 'STARBUCKS CENTER', 2_000)] };
  const answer = answerWafraQuestion(ambiguousState, 'How much did I spend at Starbucks last month?', now);
  assert.equal(answer.tool, 'help');
  assert.equal(answer.evidence, undefined);
  assert.equal(answer.data, undefined);
  assert.equal(answer.suggestions.length, 2);
  for (const suggestion of answer.suggestions) {
    const selected = answerWafraQuestion(ambiguousState, suggestion, now);
    assert.equal(selected.tool, 'merchant-breakdown');
    assert.equal(selected.data.totalFils, 0, 'merchant clarification choices must retain requested period');
  }
}

{
  const fresh = { ...state, transactions: [...state.transactions,
    tx('recent', '2026-09-18', 'Cafe', 3_000),
  ] };
  const current = answerWafraQuestion(fresh, 'What am I on track to spend this month?', now);
  assert.equal(current.data.projectedFils, 13_500);
  assert.match(current.body, /estimated spending/i);
  const history = answerWafraQuestion(fresh, 'What am I on track to spend last month?', now);
  assert.equal(history.data.projectedFils, null);
  assert.doesNotMatch(history.body, /this month/i);
  const lateImport = { ...fresh, transactions: fresh.transactions.filter((row) => row.date >= '2026-09-05') };
  assert.equal(answerWafraQuestion(lateImport, 'What am I on track to spend?', now).data.projectedFils, null,
    'a ledger starting partway through the month cannot justify a whole-month pace');
}

{
  for (const [code, exponent, minor, formatted] of [['USD', 2, 12345, '123.45'], ['JPY', 0, 12345, '12,345'], ['KWD', 3, 12345, '12.345']]) {
    markets.setLedgerCurrency(code, exponent);
    const result = answerWafraQuestion({ ...state, transactions: [tx('currency', '2026-09-02', 'Store', minor)] }, 'How much did I spend?', now);
    assert.match(result.body, new RegExp(`${code} ${formatted.replace('.', '\\.')}`));
    assert.equal(result.evidence[0].totalFils, minor);
  }
  markets.setLedgerCurrency(null);
}
console.log('✓ Ask Wafra exact scopes, evidence, global currency and contextual questions');

{
  for (const question of ['What bills did I pay last month?', 'What rent is due soon?', 'What bills are due in August?',
    'What is due next month?', 'What is due next week?', 'How much did I spend 500?']) {
    assert.equal(answerWafraQuestion(state, question, now).tool, 'help', `unsupported scope: ${question}`);
  }
  const collisions = { ...state, transactions: [...state.transactions,
    tx('category-named-merchant', '2026-09-06', 'Groceries', 45_000, 'dining'),
  ] };
  assert.equal(answerWafraQuestion(collisions, 'Why did my groceries spending change?', now).data.currentFils, 1_000,
    'an exact merchant called Groceries must not hijack a category question');
  const due = answerWafraQuestion(state, 'What is due in the next 7 days?', now);
  assert.equal(due.tool, 'upcoming-payments');
  assert.equal(due.destination, '/bills');
  assert.equal(due.evidence, undefined);
  assert.match(due.body, /predicted/);
  const subscriptions = answerWafraQuestion(state, 'What are my biggest subscriptions?', now);
  assert.equal(subscriptions.destination, '/bills');
  assert.equal(subscriptions.evidence, undefined);
  assert.match(subscriptions.body, /estimates/);
  const { assistantFollowUpQuestions } = require('./build/wafra-assistant');
  const scoped = planAssistantQuestion(state, 'How much did I spend at Talabat?', now);
  for (const question of assistantFollowUpQuestions(scoped)) {
    const follow = planAssistantQuestion(state, question, now, scoped);
    assert.notEqual(follow.tool, 'help', `offered follow-up must execute: ${question}`);
    assert.equal(follow.merchant, 'Talabat', `offered follow-up must retain merchant: ${question}`);
  }
}

{
  const reviewState = { ...state, transactions: [...state.transactions,
    tx('coffee-review', '2026-09-06', 'STARBUCKS MARINA', 3_000),
    tx('business-review', '2026-09-07', 'Client invoice', 9_000, 'business', 'income'),
  ] };
  for (const question of ['How much did I spend at Talabat or Starbucks?', 'How much did I spend on dining and Amazon?',
    'What is my daily average income?', 'What are my Netflix subscriptions?']) {
    const result = answerWafraQuestion(reviewState, question, now);
    assert.equal(result.tool, 'help', question);
    assert.equal(result.data, undefined, question);
    assert.equal(result.evidence, undefined, question);
  }
  const business = answerWafraQuestion(reviewState, 'How much business income did I receive?', now);
  assert.equal(business.tool, 'income-total');
  assert.equal(business.data.totalFils, 9_000);
  assert.deepEqual(business.evidence[0].transactionIds, ['business-review']);
  const missingAccount = executeAssistantTool(reviewState, { tool: 'spending-total', period: { mode: 'month', key: '2026-09' }, accountIds: ['missing'] }, now);
  assert.equal(missingAccount.tool, 'help');
  assert.equal(missingAccount.data, undefined);
}

{
  const credit = { ...account, id: 'credit-review', kind: 'card', cardType: 'credit', name: 'Credit card' };
  const debit = { ...tx('review-debit', '2026-08-01', 'Card payment', 12_000), isTransfer: true, cardPaymentSide: 'debit', ts: Date.parse('2026-08-01T00:01:00Z') };
  const receipt = { ...tx('review-receipt', '2026-07-31', 'Card payment', 12_000, 'other', 'income'), accountId: credit.id, isTransfer: true, cardPaymentSide: 'receipt', ts: Date.parse('2026-07-31T23:59:00Z') };
  const crossState = { ...state, accounts: [account, credit], transactions: [debit, receipt] };
  const result = executeAssistantTool(crossState, { tool: 'cash-outflow', period: { mode: 'range', from: '2026-08-01', to: '2026-08-01' }, accountIds: [account.id] }, now);
  assert.equal(result.data.totalFils, 12_000);
  assert.deepEqual(result.evidence[0].transactionIds, ['review-receipt']);
  assert.equal(result.evidence[0].contributions['review-receipt'], 12_000);
  assert.equal(result.evidence[0].effectiveDates['review-receipt'], '2026-08-01');
  assert.equal(result.evidence[0].effectiveAccountNames['review-receipt'], 'Everyday');
  assert.equal(receipt.date, '2026-07-31', 'effective cash metadata must never rewrite the original receipt');
  assert.equal(receipt.accountId, credit.id);
}

{
  const { setMonthStartDay } = require('./build/format');
  setMonthStartDay(25);
  try {
    const moneyYear = { ...state, transactions: [
      tx('year-current-tail', '2026-01-10', 'Cafe', 100),
      tx('year-prior-tail', '2025-01-10', 'Cafe', 100),
    ] };
    const annual = answerWafraQuestion(moneyYear, 'How much did I spend last year?', now);
    const comparison = answerWafraQuestion(moneyYear, 'Why did my spending change last year?', now);
    assert.equal(annual.data.totalFils, 100);
    assert.equal(comparison.data.currentFils, 100, 'comparison must retain the full salary-cycle reporting year');
    assert.equal(comparison.data.previousFils, 100);
    assert.equal(comparison.data.deltaPercent, 0);
    assert.equal(comparison.evidence[0].from, '2025-01-25');
    assert.equal(comparison.evidence[0].to, '2026-01-24');
    const namedCalendar = planAssistantQuestion(state, 'How much did I spend in August 2026?', now);
    assert.deepEqual(namedCalendar.period, { mode: 'range', from: '2026-08-01', to: '2026-08-31' },
      'an explicit named month is a calendar range even with custom reporting months');
  } finally { setMonthStartDay(1); }
  for (const question of ['Which recurring charges changed?', 'Compare spending at Talabat vs Starbucks']) {
    assert.equal(answerWafraQuestion(state, question, now).tool, 'help', question);
  }
}

{
  for (const question of ['Income minus spending on dining', 'Income minus spending at Talabat',
    'How much online spending?', 'How much cash did I spend?', 'How much did I spend for Unknown Shop?',
    'How much international spending?', 'How much reimbursable spending?', 'How much recurring spending?',
    'What is my average transaction amount?']) {
    const result = answerWafraQuestion(state, question, now);
    assert.equal(result.tool, 'help', `every qualifier must be consumed: ${question}`);
    assert.equal(result.data, undefined);
    assert.equal(result.evidence, undefined);
  }
  const directNet = executeAssistantTool(state, { tool: 'net-income-spending', period: { mode: 'month', key: '2026-09' }, category: 'dining' }, now);
  assert.equal(directNet.tool, 'help');
  assert.equal(answerWafraQuestion(state, 'Income minus spending from Everyday', now).data.netFils, 14_000);
  const { suggestedAssistantQuestions, assistantFollowUpQuestions } = require('./build/wafra-assistant');
  for (const question of suggestedAssistantQuestions(state, { mode: 'month', key: '2026-09' }, now)) {
    const request = planAssistantQuestion(state, question, now);
    assert.notEqual(request.tool, 'help', `curated starting question: ${question}`);
    for (const followUp of assistantFollowUpQuestions(request)) {
      assert.notEqual(planAssistantQuestion(state, followUp, now, request).tool, 'help', `curated follow-up: ${followUp}`);
    }
  }
}

{
  const { runWafraAssistant } = require('./build/wafra-assistant');
  const prior = runWafraAssistant(state, 'How much did I spend at Talabat?', now);
  assert.equal(prior.answer.showEvidence, undefined, 'financial answers should offer evidence without opening it automatically');
  const evidence = runWafraAssistant(state, 'Show those transactions', now, prior.request);
  assert.equal(evidence.answer.showEvidence, true);
  assert.deepEqual(evidence.answer.evidence[0].transactionIds, ['sep-food-1', 'sep-food-2']);
  assert.equal(runWafraAssistant(state, 'Show those transactions', now).answer.tool, 'help');
  assert.equal(answerWafraQuestion(state, 'What payments are due for Netflix?', now).tool, 'help');
}
