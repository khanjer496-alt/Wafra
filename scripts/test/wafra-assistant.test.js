const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  answerWafraQuestion,
  executeAssistantTool,
  latestAssistantContext,
  planAssistantCorrection,
  planAssistantQuestion,
  runWafraAssistant,
  shouldTryAssistantSemanticFallback,
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
  let scope = planAssistantQuestion(state, 'How much did I spend at Talabat and Carrefour?', now);
  scope = planAssistantQuestion(state, 'Exclude Carrefour', now, scope);
  const comparison = planAssistantQuestion(state, 'Compare last month', now, scope);
  assert.equal(comparison.tool, 'compare-periods', 'a resolved period follow-up must keep a merchant union and exclusions');
  assert.deepEqual(comparison.excludedMerchants, ['Carrefour']);
  const answer = executeAssistantTool(state, comparison, now);
  assert.equal(answer.data.currentFils, 5_000);
  assert.equal(answer.data.previousFils, 2_000);
}

{
  const talabat = planAssistantQuestion(state, 'How much did I spend at Talabat?', now);
  const why = planAssistantQuestion(state, 'Why did it increase?', now, talabat);
  assert.equal(why.tool, 'compare-periods');
  assert.equal(why.merchant, 'Talabat', 'pronoun follow-up must retain the merchant scope');
  const whyAnswer = executeAssistantTool(state, why, now);
  assert.equal(whyAnswer.data.currentFils, 5_000);
  assert.equal(whyAnswer.data.previousFils, 2_000);

  const bareWhy = planAssistantQuestion(state, 'Why?', now, talabat);
  assert.equal(bareWhy.tool, 'compare-periods');
  assert.equal(bareWhy.merchant, 'Talabat');

  const againstLastMonth = planAssistantQuestion(state, 'How does that compare to last month?', now, talabat);
  assert.equal(againstLastMonth.tool, 'compare-periods');
  assert.deepEqual(againstLastMonth.period, { mode: 'range', from: '2026-09-01', to: '2026-09-20' });
  assert.deepEqual(againstLastMonth.comparisonPeriod, { mode: 'range', from: '2026-08-01', to: '2026-08-20' });
  assert.equal(againstLastMonth.merchant, 'Talabat');

  const lastMonth = planAssistantQuestion(state, 'How much last month?', now, talabat);
  assert.equal(lastMonth.tool, 'merchant-breakdown');
  assert.equal(lastMonth.period.key, '2026-08');
  assert.equal(lastMonth.merchant, 'Talabat');

  const groceries = planAssistantQuestion(state, 'What about groceries?', now, talabat);
  assert.equal(groceries.tool, 'category-breakdown');
  assert.equal(groceries.category, 'groceries');
  assert.equal(groceries.merchant, undefined, 'switching subject must not intersect the prior merchant');

  const backToMerchant = planAssistantQuestion(state, 'And Talabat?', now, groceries);
  assert.equal(backToMerchant.tool, 'merchant-breakdown');
  assert.equal(backToMerchant.merchant, 'Talabat');
  assert.equal(backToMerchant.category, undefined, 'switching subject must not retain the prior category');

  const explicitOverall = planAssistantQuestion(state, 'Why did my spending change?', now, talabat);
  assert.equal(explicitOverall.tool, 'compare-periods');
  assert.equal(explicitOverall.merchant, undefined, 'explicit overall wording must override conversational merchant context');

  const explicitTotal = planAssistantQuestion(state, 'How much did I spend?', now, talabat);
  assert.equal(explicitTotal.tool, 'spending-total');
  assert.equal(explicitTotal.merchant, undefined, 'a complete new question must not inherit the prior merchant');

  const explicitIncome = planAssistantQuestion(state, 'How much income did I receive?', now, talabat);
  assert.equal(explicitIncome.tool, 'income-total');
  assert.equal(explicitIncome.merchant, undefined, 'explicit income wording must not inherit a spending merchant');

  const clarificationTurn = { tool: 'help', clarification: 'Choose a merchant.' };
  assert.deepEqual(latestAssistantContext([talabat, clarificationTurn]), talabat,
    'a clarification must not erase the last substantive conversation scope');
}

// Conversation-smoothing regressions from real Ask Wafra usage: recorded
// identities beat vocabulary, relative periods advance from the current turn,
// and zero results do not advertise empty evidence.
{
  const visa = { ...account, id: 'visa-card', name: 'Visa', kind: 'card', cardType: 'credit' };
  const mastercard = { ...account, id: 'master-card', name: 'Mastercard', kind: 'card', cardType: 'credit' };
  const local = { ...state, accounts: [account, visa, mastercard], transactions: [
    ...state.transactions,
    { ...tx('jul-food', '2026-07-05', 'Talabat', 1_500), accountId: account.id },
    { ...tx('noon-web', '2026-09-08', 'NOON.COM', 12_000, 'shopping'), accountId: visa.id },
    { ...tx('noon-minutes', '2026-09-09', 'Noon Minutes', 3_000, 'groceries'), accountId: mastercard.id },
    { ...tx('visa-a', '2026-09-10', 'Cafe A', 1_000), accountId: visa.id },
    { ...tx('visa-b', '2026-09-11', 'Cafe B', 1_000), accountId: visa.id },
    { ...tx('mc-a', '2026-09-12', 'Large shop', 9_000, 'shopping'), accountId: mastercard.id },
  ] };

  assert.equal(planAssistantQuestion(local, 'How much did I spend on NOON.COM?', now).tool, 'merchant-breakdown');
  assert.equal(planAssistantQuestion(local, 'How much did I spend on Talbat?', now).merchant, 'Talabat');
  assert.equal(planAssistantQuestion(local, 'How much did I spend on dining?', now).tool, 'category-breakdown');
  const categoryCollision = { ...state, transactions: [...state.transactions,
    tx('merchant-with-category-word', '2026-09-09', 'Previous groceries', 900, 'groceries')] };
  const groceriesCategory = planAssistantQuestion(categoryCollision, 'How much did I spend on groceries this month?', now);
  assert.equal(groceriesCategory.tool, 'category-breakdown');
  assert.equal(groceriesCategory.category, 'groceries', 'generic category language must not be stolen by a merchant containing that word');
  const noon = answerWafraQuestion(local, 'How much did I spend on Noon?', now);
  assert.equal(noon.tool, 'help');
  assert.ok(noon.suggestions.some((item) => item.includes('NOON.COM')) && noon.suggestions.some((item) => item.includes('Noon Minutes')));
  const priorMerchant = planAssistantQuestion(local, 'How much did I spend at Talabat?', now);
  const noonFollowUp = answerWafraQuestion(local, 'What about Noon?', now, priorMerchant);
  assert.equal(noonFollowUp.tool, 'help');
  assert.ok(noonFollowUp.suggestions.some((item) => item.includes('Noon Minutes')),
    'ambiguous merchant follow-ups should offer recorded merchant choices instead of generic help');

  const accounts = planAssistantQuestion(local, 'Compare Visa with Mastercard', now);
  assert.equal(accounts.tool, 'compare-accounts');
  assert.equal(accounts.leftAccountId, visa.id, 'account comparison preserves the order in the question');
  assert.equal(accounts.rightAccountId, mastercard.id);
  assert.equal(accounts.category, undefined, 'the recorded Visa account must outrank the Government category alias');

  const talabat = planAssistantQuestion(local, 'How much did I spend at Talabat this month?', now);
  const august = planAssistantQuestion(local, 'What about last month?', now, talabat);
  assert.equal(august.period.key, '2026-08');
  const july = planAssistantQuestion(local, 'What about last month?', now, august);
  assert.equal(july.period.key, '2026-07', 'repeating last month advances from the current conversation period');
  const beforeThat = planAssistantQuestion(local, 'And before that?', now, august);
  assert.equal(beforeThat.period.key, '2026-07');
  const { assistantFollowUpQuestions } = require('./build/wafra-assistant');
  assert.match(assistantFollowUpQuestions(august)[0], /July 2026/, 'quick reply must not suggest the same relative month again');

  const noTalabat = answerWafraQuestion(local, 'How much did I spend at Talabat June 2026?', now);
  assert.equal(noTalabat.data.transactionCount, 0);
  assert.match(noTalabat.body, /No recorded Talabat transactions/i);
  assert.equal(noTalabat.evidence, undefined, 'zero results do not expose an empty View transactions action');

  const countRanking = answerWafraQuestion(local, 'Which card did I use most often?', now);
  assert.equal(countRanking.tool, 'top-accounts');
  assert.equal(countRanking.data.metric, 'count');
  assert.equal(countRanking.facts[0].label, 'Visa');

  const augustHighest = answerWafraQuestion(local, 'Was August my highest month?', now);
  assert.equal(augustHighest.tool, 'historical-baseline');
  assert.equal(augustHighest.data.selectedIsHighest, false);
  assert.match(augustHighest.body, /^No\./);
}

{
  const natural = { ...state, transactions: [
    ...state.transactions,
    tx('salary-natural', '2026-09-10', 'Salary', 20_000, 'salary', 'income'),
    tx('natural-before', '2026-09-04', 'Market', 1_000, 'groceries'),
    tx('natural-after', '2026-09-12', 'Market', 2_000, 'groceries'),
  ] };
  assert.deepEqual(planAssistantQuestion(natural, 'How much did I spend over the last 2 weeks?', now).period,
    { mode: 'range', from: '2026-09-07', to: '2026-09-20' });
  assert.deepEqual(planAssistantQuestion(natural, 'How much did I spend first half this month?', now).period,
    { mode: 'range', from: '2026-09-01', to: '2026-09-15' });
  assert.equal(answerWafraQuestion(natural, 'How much did I spend after salary?', now).data.totalFils >= 2_000, true);
  assert.equal(planAssistantQuestion(natural, 'How much did I spend this week?', now).tool, 'spending-total');
  assert.equal(planAssistantQuestion(natural, 'How much did I spend month to date?', now).tool, 'spending-total');
  assert.equal(planAssistantQuestion(natural, 'How much did I spend in the past fortnight?', now).tool, 'spending-total');
  assert.equal(planAssistantQuestion(natural, 'How much did I spend since September 5?', now).tool, 'spending-total');
  assert.deepEqual(planAssistantQuestion(natural, 'How much did I spend since Sep 5?', now).period,
    { mode: 'range', from: '2026-09-05', to: '2026-09-20' });
  assert.deepEqual(planAssistantQuestion(natural, 'How much did I spend after Sep 5?', now).period,
    { mode: 'range', from: '2026-09-06', to: '2026-09-20' });
  assert.deepEqual(planAssistantQuestion(natural, 'How much did I spend before Sep 5?', now).period,
    { mode: 'range', from: '2026-09-01', to: '2026-09-04' });
  assert.deepEqual(planAssistantQuestion(natural, 'How much did I spend this weekend?', now).period,
    { mode: 'range', from: '2026-09-19', to: '2026-09-20' });
  assert.deepEqual(planAssistantQuestion(natural, 'How much did I spend after my pay came in?', now).period,
    { mode: 'range', from: '2026-09-10', to: '2026-09-20' });
  assert.deepEqual(planAssistantQuestion(natural, 'How much did I spend before pay?', now).period,
    { mode: 'range', from: '2026-09-01', to: '2026-09-09' });

  const talabatContext = planAssistantQuestion(state, 'How much did I spend at Talabat?', now);
  const sameMonthLastYear = planAssistantQuestion(state, 'Same month last year', now, talabatContext);
  assert.equal(sameMonthLastYear.tool, 'merchant-breakdown');
  assert.deepEqual(sameMonthLastYear.period, { mode: 'month', key: '2025-09' });
  assert.equal(sameMonthLastYear.merchant, 'Talabat');
  const twoMonthsAgo = planAssistantQuestion(state, 'Two months ago', now, talabatContext);
  assert.equal(twoMonthsAgo.tool, 'merchant-breakdown');
  assert.deepEqual(twoMonthsAgo.period, { mode: 'month', key: '2026-07' });
  assert.equal(twoMonthsAgo.merchant, 'Talabat');
}

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
  assert.ok(answer.facts.some((fact) => fact.label === 'Top merchant driver' && /Talabat/.test(fact.value)));
  assert.ok(answer.facts.some((fact) => fact.label === 'Largest current purchase' && /Talabat/.test(fact.value)));
  assert.match(answer.body, /Dining was the biggest category driver/i);
  assert.match(answer.body, /Talabat was the biggest merchant driver/i);
  assert.match(answer.body, /largest recorded purchase/i);
}

{
  const onePurchase = executeAssistantTool(state,
    { tool: 'largest-purchases', period: { mode: 'month', key: '2026-09' }, limit: 1 }, now);
  assert.deepEqual(planAssistantCorrection(state, 'That was groceries, not dining.', onePurchase), {
    kind: 'transaction-category', transactionId: 'sep-food-1', category: 'groceries',
  });
  assert.deepEqual(planAssistantCorrection(state, 'Talabat should be groceries', onePurchase), {
    kind: 'merchant-category', merchant: 'Talabat', category: 'groceries', direction: 'expense',
  });
  const multi = answerWafraQuestion(state, 'How much did I spend at Talabat?', now);
  const multiCorrection = planAssistantCorrection(state, 'That was groceries.', multi);
  assert.equal(multiCorrection.kind, 'clarification',
    'a pronoun correction must not choose between multiple evidenced transactions');
  assert.deepEqual(multiCorrection.suggestions, ['Set all matching transactions to Groceries', 'Choose one transaction']);
  assert.deepEqual(planAssistantCorrection(state, 'Set all matching transactions to Groceries', multi), {
    kind: 'merchant-category', merchant: 'Talabat', category: 'groceries', direction: 'expense',
  });
  assert.deepEqual(planAssistantCorrection(state, 'Talabat is not a subscription', multi), {
    kind: 'not-subscription', merchant: 'Talabat',
  });
  assert.deepEqual(planAssistantCorrection(state, 'That is not a subscription', multi), {
    kind: 'not-subscription', merchant: 'Talabat',
  });
  const { runWafraAssistant } = require('./build/wafra-assistant');
  const choose = runWafraAssistant(state, 'Choose one transaction', now,
    planAssistantQuestion(state, 'How much did I spend at Talabat?', now));
  assert.equal(choose.answer.showEvidence, true);
  assert.equal(choose.answer.evidence[0].transactionIds.length, 2);
  const transfer = { ...tx('transfer-one', '2026-09-08', 'Transfer to savings', 1_500, 'other'),
    transferEvidence: { version: 1, currency: 'AED', attribution: 'source' } };
  const transferState = { ...state, transactions: [...state.transactions, transfer] };
  const transferAnswer = { tool: 'spending-total', title: 'Transfer', body: '',
    evidence: [{ label: 'Transfer', transactionIds: [transfer.id], totalFils: transfer.amountFils, accountNames: ['Everyday'] }] };
  assert.deepEqual(planAssistantCorrection(transferState, 'This is my own transfer', transferAnswer), {
    kind: 'transfer-ownership', transactionId: transfer.id, ownership: 'own',
  });
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
  assert.equal(shouldTryAssistantSemanticFallback('What is my favorite colour?',
    planAssistantQuestion(state, 'What is my favorite colour?', now)), true);
  const capabilities = answerWafraQuestion(state, 'What can you do?', now);
  assert.equal(capabilities.tool, 'help');
  assert.equal(shouldTryAssistantSemanticFallback('What can you do?',
    planAssistantQuestion(state, 'What can you do?', now)), false);
  const unsupported = planAssistantQuestion(state, 'Should I spend more than 500 AED?', now);
  assert.equal(unsupported.tool, 'help');
  assert.equal(shouldTryAssistantSemanticFallback('Should I spend more than 500 AED?', unsupported), false,
    'specific local safety refusals must never be broadened by the model');
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
  assert.ok(net.coverage?.notes.some((note) => /import|recorded/i.test(note)),
    'coverage caveats stay available without repeating them inside every answer body');
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
  for (const question of ['How much did I spend with Unknown Shop?', 'How much did I spend over 20?', 'How much did I spend in London?']) {
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

// Final-launch conversational language: accept common shorthand and chat phrasing
// without allowing it to hijack an explicitly recorded merchant identity.
{
  for (const question of [
    'What subs do I have?',
    'Show my subs',
    'What sub do I have?',
    'What memberships do I have?',
    'What am I subscribed to?',
    'Any auto renewals?',
    'Recurring stuff?',
    'What recurring payments do I have?',
    'What subscriptons do I have?',
    'Can u show my subs?',
    'pls show my subs',
    'Hey Wafra, what subs do I have?',
    'Would u pls show my subs?',
    'What services am I paying for?',
    'What do I pay every month?',
    'Anything renewing?',
  ]) {
    assert.equal(answerWafraQuestion(state, question, now).tool, 'subscriptions', question);
  }

  for (const question of ['Anything due?', 'What do I owe?', 'Payments coming up?', 'Bills coming up?', 'Stuff due?',
    'What needs paying?', 'Anything I need to pay?', 'What payments are next?']) {
    assert.equal(answerWafraQuestion(state, question, now).tool, 'upcoming-payments', question);
  }

  assert.deepEqual(planAssistantQuestion(state, 'How much did I spend MTD?', now).period,
    { mode: 'range', from: '2026-09-01', to: '2026-09-20' });
  assert.deepEqual(planAssistantQuestion(state, 'How much did I spend YTD?', now).period,
    { mode: 'range', from: '2026-01-01', to: '2026-09-20' });
  assert.deepEqual(planAssistantQuestion(state, 'How much did I spend last 2w?', now).period,
    { mode: 'range', from: '2026-09-07', to: '2026-09-20' });
  assert.deepEqual(planAssistantQuestion(state, 'How much did I spend last 7d?', now).period,
    { mode: 'range', from: '2026-09-14', to: '2026-09-20' });
  assert.deepEqual(planAssistantQuestion(state, 'How much did I spend this month so far?', now).period,
    { mode: 'range', from: '2026-09-01', to: '2026-09-20' });
  assert.deepEqual(planAssistantQuestion(state, 'How much did I spend year so far?', now).period,
    { mode: 'range', from: '2026-01-01', to: '2026-09-20' });
  assert.deepEqual(planAssistantQuestion(state, 'How much did I spend yday?', now).period,
    { mode: 'range', from: '2026-09-19', to: '2026-09-19' });
  const merchantContext = planAssistantQuestion(state, 'How much did I spend at Talabat?', now);
  const merchantMtd = planAssistantQuestion(state, 'MTD', now, merchantContext);
  assert.equal(merchantMtd.tool, 'merchant-breakdown');
  assert.equal(merchantMtd.merchant, 'Talabat');
  assert.deepEqual(merchantMtd.period, { mode: 'range', from: '2026-09-01', to: '2026-09-20' });
  const { runWafraAssistant, assistantFollowUpQuestions } = require('./build/wafra-assistant');
  const txns = runWafraAssistant(state, 'Show txns', now, merchantContext);
  assert.equal(txns.request.merchant, 'Talabat');
  assert.equal(txns.answer.showEvidence, true);

  const card = { ...account, id: 'launch-card', name: 'Launch Visa', kind: 'card', cardType: 'credit' };
  const cardState = { ...state, accounts: [account, card], transactions: [...state.transactions,
    { ...tx('launch-card-row', '2026-09-09', 'Cafe', 2_500), accountId: card.id },
  ] };
  const cc = planAssistantQuestion(cardState, 'Which cc did I use most?', now);
  assert.equal(cc.tool, 'top-accounts');
  assert.equal(cc.accountKind, 'card');
  assert.equal(planAssistantQuestion(cardState, 'Which acct did I use most?', now).tool, 'top-accounts');

  assert.equal(answerWafraQuestion(state, 'Top spends', now).tool, 'largest-purchases');
  assert.equal(answerWafraQuestion(state, 'Top shops', now).tool, 'top-merchants');
  assert.equal(answerWafraQuestion(state, 'Where did my money go?', now).tool, 'top-categories');
  assert.equal(answerWafraQuestion(state, 'Anything off?', now).tool, 'money-review');
  assert.equal(answerWafraQuestion(state, 'Anything fishy?', now).tool, 'money-review');
  assert.equal(answerWafraQuestion(state, 'Weird charges?', now).tool, 'unusual-charges');
  assert.equal(answerWafraQuestion(state, 'Same charge twice?', now).tool, 'possible-duplicates');
  assert.equal(answerWafraQuestion(state, 'Did I pay twice?', now).tool, 'possible-duplicates');
  assert.equal(answerWafraQuestion(state, 'Same amount twice?', now).tool, 'possible-duplicates');
  assert.equal(answerWafraQuestion(state, 'Double charges?', now).tool, 'possible-duplicates');
  assert.equal(answerWafraQuestion(state, 'How much did I get paid?', now).tool, 'income-total');
  assert.equal(answerWafraQuestion(state, 'How much was my paycheck?', now).tool, 'income-total');
  assert.equal(answerWafraQuestion(state, 'How much salary came in?', now).tool, 'income-total');
  assert.equal(answerWafraQuestion(state, 'How much grocreies spending?', now).tool, 'category-breakdown');
  assert.equal(answerWafraQuestion(state, 'How much did I spend on resturant?', now).tool, 'category-breakdown');

  const merchantNamedSubs = { ...state, transactions: [...state.transactions, tx('subs-shop', '2026-09-08', 'Subs', 1_200)] };
  const explicitSubsMerchant = planAssistantQuestion(merchantNamedSubs, 'How much did I spend at Subs?', now);
  assert.equal(explicitSubsMerchant.tool, 'merchant-breakdown');
  assert.equal(explicitSubsMerchant.merchant, 'Subs');

  const merchantAnswer = answerWafraQuestion(state, 'How much did I spend at Talabat?', now);
  assert.deepEqual(planAssistantCorrection(state, 'That is not a sub', merchantAnswer),
    { kind: 'not-subscription', merchant: 'Talabat' });
  assert.deepEqual(planAssistantCorrection(state, 'Talabat is not a sub', merchantAnswer),
    { kind: 'not-subscription', merchant: 'Talabat' });

  assert.deepEqual(assistantFollowUpQuestions({ tool: 'subscriptions' }),
    ['Which recurring charges changed?', 'What payments are due soon?', 'Anything unusual?']);
  assert.deepEqual(assistantFollowUpQuestions({ tool: 'upcoming-payments', withinDays: 30 }),
    ['What subscriptions do I have?', 'Anything unusual?', 'How much did I spend?']);
}

{
  const reviewState = { ...state, transactions: [...state.transactions,
    tx('coffee-review', '2026-09-06', 'STARBUCKS MARINA', 3_000),
    tx('business-review', '2026-09-07', 'Client invoice', 9_000, 'business', 'income'),
  ] };
  for (const question of ['How much did I spend on dining and Amazon?',
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
  for (const question of ['Compare spending at Talabat vs Starbucks']) {
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

// Local multi-filter analysis: unions inside a dimension, intersections across
// dimensions, and exclusions against individual split allocations.
{
  const second = { ...account, id: 'bank-2', name: 'Savings' };
  const split = { ...tx('local-split', '2026-09-10', 'Carrefour', 10_000, 'shopping'), splits: [
    { category: 'groceries', amountFils: 6_000 }, { category: 'dining', amountFils: 3_000 },
    { category: 'rent', amountFils: 1_000 },
  ] };
  const local = { ...state, accounts: [account, second], transactions: [...state.transactions, split,
    { ...tx('savings-dining', '2026-09-10', 'Talabat', 900), accountId: second.id },
    tx('rent-local', '2026-09-10', 'Landlord', 50_000, 'rent'),
  ] };
  const combined = answerWafraQuestion(local, 'How much groceries and dining spending at Talabat and Carrefour using Everyday and Savings?', now);
  assert.equal(combined.data?.totalFils, 15_900, 'all four named dimensions must survive');
  assert.equal(combined.evidence[0].contributions['local-split'], 9_000);
  const excluded = answerWafraQuestion(local, 'How much did I spend excluding rent?', now);
  assert.equal(excluded.data?.totalFils, 15_900);
  assert.equal(excluded.evidence[0].contributions['local-split'], 9_000);
  const first = planAssistantQuestion(local, 'How much groceries and dining spending at Carrefour using Everyday?', now);
  const follow = planAssistantQuestion(local, 'Exclude groceries', now, first);
  assert.equal(executeAssistantTool(local, follow, now).data?.totalFils, 3_000);
  const last = planAssistantQuestion(local, 'What about last month?', now, follow);
  assert.equal(executeAssistantTool(local, last, now).data?.totalFils, 0);
  assert.deepEqual(last.excludedCategories, ['groceries']);
  assert.equal(last.merchant, 'Carrefour');
  assert.deepEqual(last.accountIds, ['bank-1']);
  assert.equal(answerWafraQuestion(local, 'How much spending excluding Unknown Shop?', now).tool, 'help');
}

{
  const { runWafraAssistant } = require('./build/wafra-assistant');
  const rows = [...state.transactions,
    tx('rent-now', '2026-09-03', 'Landlord', 9_000, 'rent'),
    tx('rent-before', '2026-08-03', 'Landlord', 8_000, 'rent'),
    tx('prior-late', '2026-08-29', 'Late Store', 99_000),
  ];
  const local = { ...state, transactions: rows };
  const first = runWafraAssistant(local, 'How much did I spend?', now);
  const comparison = runWafraAssistant(local, 'Compare last month', now, first.request);
  assert.equal(comparison.answer.data.currentFils, 15_000);
  assert.equal(comparison.answer.data.previousFils, 10_000);
  assert.deepEqual(comparison.request.period, { mode: 'range', from: '2026-09-01', to: '2026-09-20' });
  assert.deepEqual(comparison.request.comparisonPeriod, { mode: 'range', from: '2026-08-01', to: '2026-08-20' });
  const exclusion = runWafraAssistant(local, 'Exclude rent', now, comparison.request);
  assert.equal(exclusion.answer.data.currentFils, 6_000);
  assert.equal(exclusion.answer.data.previousFils, 2_000);
  assert.deepEqual(exclusion.request.comparisonPeriod, comparison.request.comparisonPeriod);
  const proof = runWafraAssistant(local, 'Show those transactions', now, exclusion.request);
  assert.equal(proof.answer.showEvidence, true);
  assert.deepEqual(proof.answer.evidence[1].transactionIds, ['aug-food']);
  const again = runWafraAssistant(local, 'Compare the same dates', now, exclusion.request);
  assert.deepEqual(again.answer.evidence, exclusion.answer.evidence);
  const empty = runWafraAssistant(local, 'How much rent spending excluding rent?', now);
  assert.equal(empty.answer.data.totalFils, 0, 'exclusions win, even against a sole inclusion');
  assert.equal(empty.answer.evidence, undefined, 'zero-result answers do not expose empty transaction evidence');
}

{
  const split = { ...tx('driver-split', '2026-09-10', 'Carrefour', 1_001, 'shopping'), splits: [
    { category: 'dining', amountFils: 334 }, { category: 'groceries', amountFils: 667 },
  ] };
  const local = { ...state, transactions: [...state.transactions, split] };
  for (const code of ['USD', 'JPY', 'KWD']) {
    markets.setLedgerCurrency(code, code === 'JPY' ? 0 : code === 'KWD' ? 3 : 2);
    const answer = answerWafraQuestion(local, 'Why did dining and groceries spending change excluding groceries?', now);
    assert.equal(answer.data.currentFils, 5_334);
    assert.equal(answer.data.previousFils, 2_000);
    assert.equal(answer.data.currentCount, 3);
    assert.ok(answer.findings.some((finding) => finding.title.endsWith('· merchant')));
    assert.ok(answer.findings.some((finding) => finding.title.endsWith('· category')));
    for (const finding of answer.findings) {
      for (const group of finding.evidence) {
        assert.equal(group.totalFils, Object.values(group.contributions).reduce((sum, value) => sum + value, 0));
      }
      assert.ok(finding.request, 'a drilldown is an exact local request rather than reinterpretation');
      const drilldown = executeAssistantTool(local, finding.request, now);
      assert.equal(drilldown.data.currentFils, finding.evidence[0].totalFils);
      assert.equal(drilldown.data.previousFils, finding.evidence[1].totalFils);
    }
  }
  markets.setLedgerCurrency(null);
  const offset = { ...state, transactions: [tx('old-merchant', '2026-08-04', 'Old Cafe', 1_000), tx('new-merchant', '2026-09-04', 'New Cafe', 1_000)] };
  const noNetChange = answerWafraQuestion(offset, 'Why did my spending change?', now);
  assert.equal(noNetChange.data.deltaFils, 0);
  assert.ok(noNetChange.findings.some((finding) => finding.title.startsWith('New Cafe')), 'merchant shifts remain visible when category changes net to zero');
}

{
  const recurringRows = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']
    .map((date, i) => tx(`service-${i}`, date, 'Local service', i === 3 ? 1_200 : 1_000, 'software'));
  const unusualRows = [950, 1000, 1000, 1050, 1000].map((value, i) => tx(`usual-${i}`, `2026-08-0${i + 1}`, 'Neighborhood cafe', value));
  unusualRows.push(tx('unusual-current', '2026-09-10', 'Neighborhood cafe', 4_000));
  const stamp = Date.parse('2026-09-10T12:00:00Z');
  const duplicates = [0, 1].map((i) => ({ ...tx(`candidate-${i}`, '2026-09-10', 'Local market', 2_000), ts: stamp + i * 60_000 }));
  const split = { ...tx('pattern-split', '2026-09-10', 'Neighborhood cafe', 4_000), splits: [
    { category: 'dining', amountFils: 2_000 }, { category: 'groceries', amountFils: 2_000 },
  ] };
  const fx = { ...tx('pattern-fx', '2026-09-10', 'Local service', 9_000), originalCurrency: 'EUR', originalAmountMinor: 3_000 };
  const local = { ...state, transactions: [...recurringRows, ...unusualRows, ...duplicates, split, fx] };
  for (const [question, tool, id, baselineCount] of [
    ['Which recurring charges changed?', 'recurring-changes', 'service-3', 3],
    ['Show unusual charges', 'unusual-charges', 'unusual-current', 5],
    ['Show possible duplicate charges', 'possible-duplicates', 'candidate-0', 0],
  ]) {
    const answer = answerWafraQuestion(local, question, now);
    assert.equal(answer.tool, tool, question);
    assert.equal(answer.data.candidateCount, 1, question);
    const finding = answer.findings[0];
    assert.ok(finding.evidence[0].transactionIds.includes(id));
    assert.equal(finding.evidence[1]?.transactionIds.length ?? 0, baselineCount);
    for (const group of finding.evidence) {
      assert.equal(group.totalFils, Object.values(group.contributions).reduce((sum, value) => sum + value, 0));
      assert.equal(group.transactionIds.includes('pattern-split'), false);
      assert.equal(group.transactionIds.includes('pattern-fx'), false);
    }
    assert.match(answer.coverage.notes.join(' '), /split|conversion/i);
  }
  const review = answerWafraQuestion(local, 'Anything unusual?', now);
  assert.equal(review.tool, 'money-review');
  assert.ok(review.data.duplicateCount >= 1);
  assert.ok(review.data.unusualCount >= 1);
  assert.ok(review.data.recurringChangeCount >= 1);
  assert.ok(review.findings.some((finding) => finding.title.startsWith('Possible duplicate ·')));
  assert.ok(review.findings.some((finding) => finding.title.startsWith('Unusual purchase ·')));
  assert.ok(review.findings.some((finding) => finding.title.startsWith('Recurring change ·')));
  assert.match(review.body, /not proof that anything is wrong/i);
  assert.equal(answerWafraQuestion(local, 'Which recurring charges changed at Local service?', now).data.candidateCount, 1);
  assert.equal(answerWafraQuestion(local, 'Which recurring charges changed excluding Local service?', now).data.candidateCount, 0);
  assert.equal(answerWafraQuestion(local, 'Show unusual dining charges', now).tool, 'help', 'patterns may not compare allocated split amounts to full-charge history');
  assert.equal(answerWafraQuestion(local, 'What is my daily average unusual spending?', now).tool, 'help', 'unsupported metric must not become a pattern list');
  assert.equal(answerWafraQuestion(local, 'How much recurring spending?', now).tool, 'help');
  assert.equal(answerWafraQuestion(local, 'Show unusual charges in London', now).tool, 'help');
}

{
  const spare = { ...account, id: 'spare', name: 'Spare' };
  const local = { ...state, accounts: [account, spare], historyImport: { status: 'complete' } };
  const answer = answerWafraQuestion(local, 'What is my recorded history?', now);
  assert.equal(answer.tool, 'data-coverage');
  assert.deepEqual([answer.coverage.recordCount, answer.coverage.accountCount, answer.coverage.totalAccounts], [4, 1, 2]);
  assert.equal(answer.coverage.firstDate, '2026-09-01');
  assert.equal(answer.coverage.lastDate, '2026-09-06');
  assert.match(answer.coverage.notes.join(' '), /does not confirm|do not prove/);
  assert.equal(answer.data.totalFils, undefined, 'coverage must not add income and spending into a meaningless money total');
  assert.equal(answer.evidence, undefined);
  const excluded = answerWafraQuestion(local, 'How much did I spend excluding Everyday?', now);
  assert.equal(excluded.data.totalFils, 0);
  assert.equal(excluded.coverage.totalAccounts, 1);
  const unknown = answerWafraQuestion(local, 'What is my recorded history using Missing account?', now);
  assert.equal(unknown.tool, 'help');
  const direct = executeAssistantTool(local, { tool: 'spending-total', period: { mode: 'month', key: '2026-09' }, merchants: ['Talabat'], merchant: 'Talabat' }, now);
  assert.equal(direct.tool, 'help', 'singular/plural API ambiguity must clarify');
  const incomplete = answerWafraQuestion({ ...local, historyImport: { status: 'paused' } }, 'What is my data coverage?', now);
  assert.match(incomplete.coverage.notes[0], /paused/);
}
console.log('✓ Local Ask unions, exclusions, frozen comparisons, driver proof, pattern routing and coverage');

// Independent review regressions: understood words must not silently change
// the requested direction, ranking, or relationship between dimensions.
{
  const local = { ...state, transactions: [...state.transactions, tx('review-rent', '2026-09-04', 'Landlord', 9_000, 'rent')] };
  for (const phrase of ['minus rent', 'other than rent']) {
    assert.equal(answerWafraQuestion(local, `How much did I spend ${phrase}?`, now).data?.totalFils, 6_000, phrase);
  }
  const top = answerWafraQuestion(local, 'Show my top 3 purchases', now);
  assert.equal(top.tool, 'largest-purchases');
  assert.equal(top.data.displayedPurchaseCount, 3);
  assert.equal(top.evidence[0].transactionIds.length, 3);
  const excludeSalary = answerWafraQuestion(local, 'How much did I spend excluding salary?', now);
  assert.equal(excludeSalary.tool, 'spending-total');
  assert.equal(excludeSalary.data.totalFils, 15_000);
  for (const question of ['How much did I spend excluding rent from Everyday account?',
    'How much income and spending this month?', 'How much did I spend on dining more than groceries?',
    'Compare dining and groceries', 'Which recurring charges decreased?', 'What are my top 3 dining expenses by date?']) {
    assert.equal(answerWafraQuestion(local, question, now).tool, 'help', question);
  }
  const second = { ...account, name: 'Travel', id: 'travel' };
  const accountComparison = answerWafraQuestion({ ...local, accounts: [account, second] }, 'Compare Everyday account and Travel account', now);
  assert.equal(accountComparison.tool, 'compare-accounts');
  assert.equal(accountComparison.data.leftFils, 15_000);
  assert.equal(accountComparison.data.rightFils, 0);
  const special = { ...state, transactions: [tx('without-title', '2026-09-04', 'Shop Without Borders', 100)] };
  assert.equal(answerWafraQuestion(special, 'How much did I spend at "Shop Without Borders"?', now).data.totalFils, 100);
}

// Historical baselines are calculated only when asked and never infer zero-spend
// months from gaps in imported history.
{
  const history = { ...state, transactions: [
    tx('jun', '2026-06-05', 'Market', 1_000, 'groceries'),
    tx('jul', '2026-07-05', 'Market', 3_000, 'groceries'),
    tx('aug', '2026-08-05', 'Market', 2_000, 'groceries'),
    tx('sep', '2026-09-05', 'Market', 5_000, 'groceries'),
  ] };
  const highest = answerWafraQuestion(history, 'Is this my highest month?', now);
  assert.equal(highest.tool, 'historical-baseline');
  assert.equal(highest.data.monthKey, '2026-09');
  assert.equal(highest.data.baselineFils, 5_000);
  assert.equal(answerWafraQuestion(history, 'Is this my highest grocery month?', now).tool, 'historical-baseline');

  const typical = answerWafraQuestion(history, 'What is my normal monthly spending?', now);
  assert.equal(typical.tool, 'historical-baseline');
  assert.equal(typical.data.monthsAnalyzed, 3);
  assert.equal(typical.data.baselineFils, 2_000);
  assert.equal(typical.data.currentFils, 5_000);

  const similar = answerWafraQuestion(history, 'When did I last spend this much?', now);
  assert.equal(similar.tool, 'historical-baseline');
  assert.equal(similar.data.similarFound, false,
    'last-time wording must not relabel a merely-nearest amount as similar');

  const recentComparable = { ...history, transactions: [
    tx('jun-similar', '2026-06-05', 'Market', 5_100, 'groceries'),
    tx('jul-similar', '2026-07-05', 'Market', 4_800, 'groceries'),
    tx('aug-not-similar', '2026-08-05', 'Market', 8_000, 'groceries'),
    tx('sep-current', '2026-09-05', 'Market', 5_000, 'groceries'),
  ] };
  const lastSimilar = answerWafraQuestion(recentComparable, 'When did I last spend this much?', now);
  assert.equal(lastSimilar.data.monthKey, '2026-07', 'most recent comparable month wins over a closer older amount');
  assert.equal(lastSimilar.data.similarFound, true);
  const closest = answerWafraQuestion(recentComparable, 'Which earlier month was closest to this?', now);
  assert.equal(closest.data.monthKey, '2026-06', 'explicit closest wording retains nearest-amount semantics');
}

// Natural date phrases resolve locally to exact ranges. Payday language depends
// on an observed Salary row and never guesses a payday from locale or profile.
{
  const salaryLater = { ...state, transactions: [
    tx('salary-later', '2026-09-10', 'Salary', 20_000, 'salary', 'income'),
    tx('before-pay', '2026-09-05', 'Market', 1_000, 'groceries'),
    tx('after-pay', '2026-09-12', 'Market', 2_000, 'groceries'),
  ] };
  const twoWeeks = planAssistantQuestion(state, 'How much did I spend in the last 2 weeks?', now);
  assert.deepEqual(twoWeeks.period, { mode: 'range', from: '2026-09-07', to: '2026-09-20' });
  const firstHalf = planAssistantQuestion(state, 'How much did I spend in the first half of this month?', now);
  assert.deepEqual(firstHalf.period, { mode: 'range', from: '2026-09-01', to: '2026-09-15' });
  const sincePayday = answerWafraQuestion(salaryLater, 'How much did I spend since payday?', now);
  assert.equal(sincePayday.data.totalFils, 2_000);
  assert.equal(sincePayday.evidence[0].from, '2026-09-10');
  const beforePayday = answerWafraQuestion(salaryLater, 'How much did I spend before my salary came in?', now);
  assert.equal(beforePayday.data.totalFils, 1_000);
  assert.equal(beforePayday.evidence[0].to, '2026-09-09');
}

// Account/card questions rank or compare exact local accounts without exposing
// account ids in user-visible answer data.
{
  const savings = { ...account, id: 'savings', name: 'Savings' };
  const card = { ...account, id: 'visa', name: 'Visa', kind: 'card', cardType: 'credit' };
  const local = { ...state, accounts: [account, savings, card], transactions: [
    { ...tx('everyday-row', '2026-09-03', 'Cafe', 5_000), accountId: account.id },
    { ...tx('savings-row', '2026-09-04', 'Market', 8_000, 'groceries'), accountId: savings.id },
    { ...tx('card-row', '2026-09-05', 'Restaurant', 10_000, 'dining'), accountId: card.id },
  ] };
  const ranked = answerWafraQuestion(local, 'Which card did I use most for dining?', now);
  assert.equal(ranked.tool, 'top-accounts');
  assert.equal(ranked.facts[0].label, 'Visa');
  assert.equal(ranked.facts[0].value.includes('100'), true);

  const compared = answerWafraQuestion(local, 'Compare Everyday account and Savings account', now);
  assert.equal(compared.tool, 'compare-accounts');
  assert.equal(compared.data.leftFils, 5_000);
  assert.equal(compared.data.rightFils, 8_000);
  assert.equal(compared.evidence.length, 2);
}

{
  const local = { ...state, transactions: [tx('case-a', '2026-09-01', 'Cafe', 100), tx('case-b', '2026-09-02', ' CAFE ', 200), tx('punctuation', '2026-09-03', 'Cafe!', 400)] };
  assert.equal(answerWafraQuestion(local, 'How much did I spend at "Cafe"?', now).data.totalFils, 300);
  assert.equal(answerWafraQuestion(local, 'How much did I spend at "Cafe!"?', now).data.totalFils, 400);
  const caseOnly = { ...local, transactions: local.transactions.slice(0, 2) };
  assert.equal(answerWafraQuestion(caseOnly, 'How much did I spend at Cafe?', now).data.totalFils, 300);
}

{
  const cash = executeAssistantTool(state, { tool: 'cash-outflow', period: { mode: 'month', key: '2026-09' }, excludedAccountIds: ['bank-1'] }, now);
  assert.equal(cash.data.totalFils, 0);
  assert.equal(cash.evidence, undefined);
  const stamp = Date.parse('2026-08-31T23:59:30Z');
  const local = { ...state, transactions: [
    { ...tx('boundary-before', '2026-08-31', 'Market', 1_000), ts: stamp },
    { ...tx('boundary-selected', '2026-09-01', 'Market', 1_000), ts: stamp + 60_000 },
  ] };
  const result = answerWafraQuestion(local, 'Show possible duplicate charges', now);
  assert.equal(result.data.candidateCount, 1);
  assert.equal(result.evidence[0].from, '2026-08-31', 'proof scope includes every cited candidate, including the adjacent prior day');
  assert.equal(result.evidence[0].to, '2026-09-01');
  assert.equal(result.evidence[0].totalFils, 2_000);
  const { runWafraAssistant } = require('./build/wafra-assistant');
  const comparison = runWafraAssistant(state, 'Why did my spending change?', now);
  const repeated = runWafraAssistant(state, 'Compare last month', now, comparison.request);
  assert.deepEqual(repeated.answer.evidence, comparison.answer.evidence, 'repeating a resolved comparison must not drift to an adjacent 20-day range');
}

// Broader vocabulary and typo-tolerant merchant resolution must keep the
// bounded grammar's promise: only supported filters land on a financial tool,
// unresolved ones ask for clarification with concrete "did you mean" hints.
{
  // Broad category names may route to the category total, but narrower concepts
  // must not silently inherit the whole category. We do not know which dining
  // purchases were coffee/lunch/takeaway, or which transport purchases were fuel.
  for (const question of [
    'How much did I spend on coffee this month?',
    'How much did I spend on lunch this month?',
    'How much did I spend on takeaway this month?',
    'How much did I spend on fuel this month?',
    'How much did I spend on shoes this month?',
    'How much did I spend on AI tools this month?',
  ]) {
    const answer = answerWafraQuestion(state, question, now);
    assert.equal(answer.tool, 'help', `narrow concept must not broaden to a whole category: ${question}`);
    assert.equal(answer.data, undefined);
  }
  const coffeeClarification = answerWafraQuestion(state, 'How much did I spend on coffee this month?', now);
  assert.match(coffeeClarification.body, /without guessing/i);
  assert.ok(coffeeClarification.suggestions.includes('How much did I spend on dining?'));

  const accountClarification = answerWafraQuestion(state, 'How much did I spend from my current account?', now);
  assert.equal(accountClarification.tool, 'help');
  assert.ok(accountClarification.suggestions.some((item) => /Everyday account/.test(item)),
    'unknown account wording should offer exact local account names instead of a dead end');

  // Casual spending verbs still route to the spending intent when no category
  // is named, and to a category-breakdown when one is.
  const burned = answerWafraQuestion(state, 'How much did I burn on food this month?', now);
  assert.equal(burned.tool, 'category-breakdown');
  assert.equal(burned.data.category, 'dining');
  assert.equal(burned.data.totalFils, 5_000);
  const dropped = answerWafraQuestion(state, 'How much did I drop this month?', now);
  assert.equal(dropped.tool, 'spending-total');
  assert.equal(dropped.data.totalFils, 6_000);

  // "Take home" and "waste" carry semantics the ledger cannot prove. Do not
  // reinterpret them as all income/all spending just because an amount exists.
  for (const question of ['How much did I take home this month?', 'How much did I waste this month?']) {
    const answer = answerWafraQuestion(state, question, now);
    assert.equal(answer.tool, 'help', `subjective or narrower metric must clarify: ${question}`);
    assert.equal(answer.data, undefined);
  }
  const earnings = answerWafraQuestion(state, 'How much earnings did I receive this month?', now);
  assert.equal(earnings.tool, 'income-total');
  assert.equal(earnings.data.totalFils, 20_000);

  // Fuzzy merchant match: a small typo resolves to the recorded merchant.
  const typo = answerWafraQuestion(state, 'How much did I spend at Talbat this month?', now);
  assert.equal(typo.tool, 'merchant-breakdown');
  assert.equal(typo.data.merchant, 'Talabat');
  assert.equal(typo.data.totalFils, 5_000);

  // Ambiguous or clearly-wrong merchant names still ask, never guess.
  const ambiguous = answerWafraQuestion(state, 'How much did I spend at "Xyzzy"?', now);
  assert.equal(ambiguous.tool, 'help', 'no match must not collapse into a spending total');
  assert.equal(ambiguous.data, undefined);

  // Two similar merchants: the fuzzy pass must surface both as candidates,
  // not silently pick one.
  const twins = { ...state, transactions: [
    tx('twin-a', '2026-09-01', 'Karak House', 500),
    tx('twin-b', '2026-09-02', 'Karak Home', 600),
  ] };
  const twinAnswer = answerWafraQuestion(twins, 'How much did I spend at "Karak Houm"?', now);
  assert.equal(twinAnswer.tool, 'help');
  assert.ok(twinAnswer.suggestions && twinAnswer.suggestions.length >= 2,
    'ambiguous typo must offer both close matches as suggestions');

  // The existing "unknown qualifier stays unresolved" rule must survive:
  // unrecognised specifier words never become a broader answer.
  for (const question of [
    'How much online spending did I do this month?',
    'How much cash did I spend this month?',
    'What is my average transaction amount this month?',
  ]) {
    const answer = answerWafraQuestion(state, question, now);
    assert.equal(answer.tool, 'help', `qualifier must not slip through: ${question}`);
  }
}
console.log('✓ Ask Wafra broader vocabulary and typo-tolerant merchant resolution');

// Account/card inventory questions are about the recorded account list, not
// spending in the selected month. They should answer directly and safely
// narrow by a named bank without requiring an account-selection clarification.
{
  const adcbCreditA = { ...account, id: 'adcb-credit-a', name: 'ADCB TouchPoints Card', kind: 'card', cardType: 'credit',
    bankName: 'ADCB', last4: '1111' };
  const adcbCreditB = { ...adcbCreditA, id: 'adcb-credit-b', name: 'ADCB Traveller Card', last4: '2222' };
  const adcbDebit = { ...adcbCreditA, id: 'adcb-debit', name: 'ADCB Debit Card', cardType: 'debit', last4: '3333' };
  const enbdCredit = { ...adcbCreditA, id: 'enbd-credit', name: 'ENBD Credit Card', bankName: 'Emirates NBD', last4: '4444' };
  const archivedAdcb = { ...adcbCreditA, id: 'adcb-old', name: 'Old ADCB Card', archived: true, last4: '9999' };
  const inventoryState = { ...state, accounts: [account, adcbCreditA, adcbCreditB, adcbDebit, enbdCredit, archivedAdcb] };

  const adcbCount = answerWafraQuestion(inventoryState, 'How many adcb credit cards I have ?', now);
  assert.equal(adcbCount.tool, 'account-inventory');
  assert.equal(adcbCount.data.accountCount, 2);
  assert.equal(adcbCount.data.accountKind, 'credit-card');
  assert.equal(adcbCount.data.bankName, 'ADCB');
  assert.match(adcbCount.headline, /2 credit cards/i);
  assert.equal(adcbCount.facts.length, 2);

  const allCredit = answerWafraQuestion(inventoryState, 'How many credit cards do I have?', now);
  assert.equal(allCredit.tool, 'account-inventory');
  assert.equal(allCredit.data.accountCount, 3);

  const debit = answerWafraQuestion(inventoryState, 'How many ADCB debit cards do I have?', now);
  assert.equal(debit.data.accountCount, 1);
  assert.equal(debit.data.accountKind, 'debit-card');

  const list = answerWafraQuestion(inventoryState, 'Show me my credit cards', now);
  assert.equal(list.tool, 'account-inventory');
  assert.equal(list.facts.length, 3);

  assert.equal(isAssistantToolRequest({ tool: 'account-inventory', accountKind: 'credit-card', bankName: 'ADCB' }), true);
  assert.equal(isAssistantToolRequest({ tool: 'account-inventory', accountKind: 'loan', bankName: 'ADCB' }), false);
}
console.log('✓ Ask Wafra account and card inventory');

// Obligation/status questions must use statement/bill accounting rather than
// falling through to generic spending language. A "settled" answer requires
// recorded statement coverage plus enough payment allocation to reach zero.
{
  const card = { ...account, id: 'enbd-card', name: 'ENBD Credit Card', kind: 'card', cardType: 'credit',
    bankName: 'Emirates NBD', last4: '4110' };
  const payment = { ...tx('enbd-payment', '2026-09-18', 'Card payment', 5_000, 'other', 'income'),
    accountId: card.id, isTransfer: true, cardPaymentSide: 'receipt' };
  const due = { id: 'enbd-due', accountId: card.id, totalDueFils: 5_000, minDueFils: 250,
    dueDate: '2026-09-25', paidFils: 0 };
  const cardState = { ...state, accounts: [account, card], transactions: [...state.transactions, payment], cardDues: [due] };

  for (const question of ['Did I settle enbd credit card?', 'Is my ENBD card paid?', 'Did I clear my card?',
    'Did the card payment go through?', 'Is ENBD settled?', 'Have I paid the statement?']) {
    const answer = answerWafraQuestion(cardState, question, now);
    assert.equal(answer.tool, 'obligation-status', question);
    assert.equal(answer.data.settled, true, question);
    assert.equal(answer.data.remainingFils, 0, question);
    assert.match(answer.headline, /settled/i, question);
    assert.equal(answer.destination, '/bills');
  }

  const remaining = answerWafraQuestion(cardState, 'How much is left on ENBD?', now);
  assert.equal(remaining.tool, 'obligation-status');
  assert.equal(remaining.data.remainingFils, 0);

  const paid = answerWafraQuestion(cardState, 'How much did I pay toward ENBD?', now);
  assert.equal(paid.tool, 'obligation-status');
  assert.equal(paid.data.paidFils, 5_000);
  assert.equal(paid.data.paymentCount, 1);
  assert.deepEqual(paid.evidence[0].transactionIds, ['enbd-payment']);

  const when = answerWafraQuestion(cardState, 'When did I pay ENBD card?', now);
  assert.equal(when.tool, 'obligation-status');
  assert.equal(when.data.latestPaymentDate, '2026-09-18');
  assert.equal(answerWafraQuestion(cardState, 'When did I pay the card?', now).data.latestPaymentDate, '2026-09-18');

  // After a ranking answer, conversational references such as “this card”
  // should resolve to the card Wafra just showed first. The requested month
  // also has to select that statement instead of silently checking the newest.
  const fabTop = { ...card, id: 'fab-top', name: 'FAB Credit Card ·3749', bankName: 'FAB', last4: '3749' };
  const otherCard = { ...card, id: 'other-card', name: 'ADCB Credit Card ·2518', bankName: 'ADCB', last4: '2518' };
  const rankedState = {
    ...cardState,
    accounts: [account, fabTop, otherCard],
    transactions: [
      { ...tx('fab-spend', '2026-09-05', 'Merchant A', 8_000), accountId: fabTop.id },
      { ...tx('adcb-spend', '2026-09-06', 'Merchant B', 2_000), accountId: otherCard.id },
      { ...payment, id: 'fab-sep-payment', accountId: fabTop.id },
    ],
    cardDues: [
      { ...due, id: 'fab-sep-due', accountId: fabTop.id, dueDate: '2026-09-25' },
      { ...due, id: 'fab-oct-due', accountId: fabTop.id, dueDate: '2026-10-25', totalDueFils: 7_000 },
    ],
  };
  const rankedContext = planAssistantQuestion(rankedState, 'Which card did I use most?', now);
  assert.equal(rankedContext.tool, 'top-accounts');
  const contextualStatus = runWafraAssistant(
    rankedState, 'Did u settle this card for September?', now, rankedContext,
  );
  assert.equal(contextualStatus.request.tool, 'obligation-status');
  assert.equal(contextualStatus.request.accountId, fabTop.id);
  assert.equal(contextualStatus.request.monthKey, '2026-09');
  assert.equal(contextualStatus.answer.data.settled, true);
  assert.equal(contextualStatus.answer.data.dueDate, '2026-09-25');
  assert.match(contextualStatus.answer.body, /statement due in September 2026 is settled/i);

  const context = planAssistantQuestion(cardState, 'Did I settle ENBD card?', now);
  const follow = planAssistantQuestion(cardState, 'How much is left?', now, context);
  assert.equal(follow.tool, 'obligation-status');
  assert.equal(follow.accountId, card.id);
  assert.equal(follow.query, 'remaining');
  const show = runWafraAssistant(cardState, 'Show the payments', now, context);
  assert.equal(show.request.tool, 'obligation-status');
  assert.equal(show.answer.showEvidence, true);

  const partialPayment = { ...payment, id: 'enbd-partial', amountFils: 3_000 };
  const partialState = { ...cardState, transactions: [...state.transactions, partialPayment] };
  const partial = answerWafraQuestion(partialState, 'Did I settle ENBD credit card?', now);
  assert.equal(partial.data.settled, false);
  assert.equal(partial.data.remainingFils, 2_000);
  assert.match(partial.headline, /2,?000|20\.00|remaining/i);

  const noStatement = answerWafraQuestion({ ...cardState, cardDues: [] }, 'Did I settle ENBD card?', now);
  assert.equal(noStatement.tool, 'obligation-status');
  assert.equal(noStatement.data.statementAvailable, false);
  assert.match(noStatement.headline, /can.t confirm/i);

  const secondCard = { ...card, id: 'enbd-card-2', name: 'ENBD Platinum', last4: '9221' };
  const ambiguous = answerWafraQuestion({ ...cardState, accounts: [account, card, secondCard] }, 'Did I settle ENBD card?', now);
  assert.equal(ambiguous.tool, 'help');
  assert.ok(ambiguous.suggestions.length >= 2);

  const dewa = { id: 'dewa-bill', title: 'DEWA', category: 'utilities', amountFils: 1_200,
    dueDay: 20, paidMonths: ['2026-09'] };
  const billState = { ...state, bills: [dewa] };
  const billPaid = answerWafraQuestion(billState, 'Did I pay DEWA?', now);
  assert.equal(billPaid.tool, 'obligation-status');
  assert.equal(billPaid.data.paid, true);
  assert.match(billPaid.headline, /paid/i);
  const billUnpaid = answerWafraQuestion({ ...billState, bills: [{ ...dewa, paidMonths: [] }] }, 'How much is left on DEWA bill?', now);
  assert.equal(billUnpaid.tool, 'obligation-status');
  assert.equal(billUnpaid.data.remainingFils, 1_200);

  const networkCard = { ...card, id: 'network-card', name: 'Travel Mastercard 7788', bankName: 'Other Bank', last4: '7788' };
  const networkState = { ...cardState, accounts: [account, networkCard], cardDues: [{ ...due, id: 'network-due', accountId: networkCard.id }],
    transactions: [{ ...payment, id: 'network-payment', accountId: networkCard.id }] };
  assert.equal(answerWafraQuestion(networkState, 'Did I pay off Mastercard?', now).tool, 'obligation-status');

  // A plain merchant payment question must keep its historical spending meaning.
  assert.equal(answerWafraQuestion(state, 'How much did I pay at Carrefour last month?', now).tool, 'merchant-breakdown');
  assert.notEqual(answerWafraQuestion(cardState, 'How much did I pay at Carrefour with my card?', now).tool, 'obligation-status');
}
console.log('✓ Ask Wafra obligation and settlement status');
