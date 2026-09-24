'use strict';
/**
 * Ask Wafra with the platform on-device model (`src/lib/on-device-assistant.ts`),
 * end to end through the compiled shipping modules:
 *   deterministic planner -> (only unrecognised Help) model picks ONE closed
 *   tool -> Wafra grounds period/merchant -> production validator -> ledger
 *   executor computes the figures.
 * The model is a scripted native bridge; nothing here claims device quality.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const build = path.resolve(__dirname, '../build');
const { createOnDeviceAI } = require(path.join(build, 'on-device-ai.js'));
const {
  ASK_PLAN_SCHEMA, compileOnDeviceAskPlan, improveAssistantRequestOnDevice, mentionsUnmappedDate, questionPeriodChoice,
} = require(path.join(build, 'on-device-assistant.js'));
const { planAssistantQuestion, executeAssistantTool } = require(path.join(build, 'wafra-assistant.js'));
const { isAssistantToolRequest } = require(path.join(build, 'wafra-assistant-ai.js'));

const account = { id: 'bank-1', name: 'Everyday', kind: 'bank', openingFils: 0, color: '#000000' };
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
  notSubscriptions: [], bills: [], cardDues: [],
};
const now = new Date('2026-09-20T12:00:00Z');
const period = { mode: 'month', key: '2026-09' };

const plan = (fields) => JSON.stringify({
  tool: 'none', period: 'default', category: 'none', merchant: '',
  accountKind: 'none', metric: 'default', baseline: 'none', ...fields,
});

function model(reply, availability = { status: 'available', provider: 'apple-foundation-models', languages: ['en'] }) {
  const calls = [];
  const native = {
    getAvailability: async () => availability,
    respond: async (...args) => { calls.push(args); return typeof reply === 'function' ? reply(...args) : reply; },
    cancel: async () => {},
    prepare: async () => availability,
  };
  return { ai: createOnDeviceAI(native), calls };
}

async function ask(question, reply, options = {}) {
  const deterministic = planAssistantQuestion(state, question, now, null, period);
  const { ai, calls } = model(reply, options.availability);
  const outcome = await improveAssistantRequestOnDevice({
    question, deterministicRequest: deterministic, previousRequest: options.previous ?? null,
    defaultPeriod: period, now, appLanguage: 'en', ai,
    knownMerchants: [...new Set(state.transactions.map((row) => row.title))],
    knownAccountNames: ['Everyday', 'Emirates NBD', 'Cash'],
  });
  return { deterministic, outcome, calls };
}

test('model picks a tool; Wafra validates and the ledger executor computes the answer', async () => {
  const { deterministic, outcome, calls } = await ask('Give me a fiscal digest', plan({ tool: 'spending-total' }));
  assert.equal(deterministic.tool, 'help');
  assert.equal(calls.length, 1);
  assert.equal(outcome.source, 'on-device-ai');
  assert.deepEqual(outcome.request, { tool: 'spending-total', period });
  assert.ok(isAssistantToolRequest(outcome.request));
  const answer = executeAssistantTool(state, outcome.request, now);
  assert.equal(answer.tool, 'spending-total');
  const direct = executeAssistantTool(state, { tool: 'spending-total', period }, now);
  assert.equal(answer.headline, direct.headline, 'figures come from the executor, identical to a typed request');
  // The prompt carries the question and the closed catalog, never ledger rows.
  const [, task, instructions, prompt, schemaJson] = calls[0];
  assert.equal(task, 'ask-plan');
  assert.equal(prompt, 'Question: Give me a fiscal digest');
  for (const secret of ['Talabat', 'Carrefour', '3000', '20000', 'bank-1', 'Everyday']) {
    assert.ok(!instructions.includes(secret) && !prompt.includes(secret), `ledger value ${secret} never reaches the model`);
  }
  assert.deepEqual(JSON.parse(schemaJson).fields.map((field) => field.name),
    ['tool', 'period', 'category', 'merchant', 'accountKind', 'metric', 'baseline']);
});

test('the closed schema offers no money fields and no identifier-based tools', () => {
  const names = ASK_PLAN_SCHEMA.fields.map((field) => field.name);
  assert.ok(!names.some((name) => /amount|total|fils|balance|account(?!Kind)|card|bill|date|limit|days/i.test(name)),
    'no numeric or identifier fields: numbers never come from the model');
  const tools = ASK_PLAN_SCHEMA.fields.find((field) => field.name === 'tool').choices;
  assert.ok(!tools.includes('obligation-status') && !tools.includes('help'));
  assert.ok(tools.includes('none'));
});

test('an invalid or hostile tool choice is rejected and the deterministic Help stays', async () => {
  for (const reply of [
    plan({ tool: 'delete-everything' }),
    plan({ tool: 'obligation-status' }),
    plan({ tool: 'spending-total', amount: '5000' }),
    '{"tool":"spending-total"}',
    'I think you spent AED 5,000 this month.',
  ]) {
    const { deterministic, outcome } = await ask('Give me a fiscal digest', reply);
    assert.equal(outcome.source, 'deterministic', reply);
    assert.equal(outcome.request, deterministic);
  }
});

test('merchant must be copied from the question; an invented merchant is rejected', async () => {
  const grounded = await ask('digest my Talabat habit', plan({ tool: 'merchant-breakdown', merchant: 'Talabat' }));
  assert.equal(grounded.outcome.source, 'on-device-ai');
  assert.deepEqual(grounded.outcome.request, { tool: 'merchant-breakdown', period, merchant: 'Talabat' });
  assert.equal(executeAssistantTool(state, grounded.outcome.request, now).data.totalFils, 5_000);
  const invented = await ask('digest my Talabat habit', plan({ tool: 'merchant-breakdown', merchant: 'Carrefour' }));
  assert.equal(invented.outcome.source, 'deterministic');
  const missing = await ask('digest my Talabat habit', plan({ tool: 'merchant-breakdown' }));
  assert.equal(missing.outcome.source, 'deterministic');
  const lowercase = await ask('digest my talabat habit', plan({ tool: 'merchant-breakdown', merchant: 'talabat' }));
  assert.equal(lowercase.outcome.request.merchant, 'Talabat', 'the ledger title is used, never the model spelling');
  const notInLedger = await ask('digest my blue bottle habit', plan({ tool: 'merchant-breakdown', merchant: 'blue bottle' }));
  assert.equal(notInLedger.outcome.source, 'deterministic', 'a merchant absent from the ledger is refused');
});

test('a plan that would silently widen the question scope is refused', async () => {
  // A named merchant the plan dropped: answering would show ALL spending.
  const droppedKnown = await ask('digest my Talabat habit', plan({ tool: 'spending-total' }));
  assert.equal(droppedKnown.outcome.source, 'deterministic');
  // An unknown capitalised name (not in the ledger) the plan cannot carry.
  const unknownName = await ask('Give me a fiscal digest for Blue Bottle', plan({ tool: 'spending-total' }));
  assert.equal(unknownName.outcome.source, 'deterministic');
  // Account/bank names cannot be expressed by the plan at all.
  const account = await ask('Give me a fiscal digest of emirates nbd', plan({ tool: 'spending-total' }));
  assert.equal(account.outcome.source, 'deterministic');
  // Generic account words are ordinary topics, not scope.
  const cash = await ask('Give me a cash digest', plan({ tool: 'cash-outflow' }));
  assert.equal(cash.outcome.source, 'on-device-ai');
  // A category filter the user never named is dropped, not applied.
  const invented = await ask('Give me a fiscal digest', plan({ tool: 'spending-total', category: 'travel' }));
  assert.deepEqual(invented.outcome.request, { tool: 'spending-total', period });
  const named = await ask('Give me a fiscal digest of groceries', plan({ tool: 'spending-total', category: 'groceries' }));
  assert.deepEqual(named.outcome.request, { tool: 'spending-total', period, category: 'groceries' });
});

test('periods come from the question wording; a disagreeing model is rejected', async () => {
  assert.equal(questionPeriodChoice('digest for last month'), 'last-month');
  assert.equal(questionPeriodChoice('digest'), 'default');
  assert.equal(questionPeriodChoice('this month versus last month'), null);
  const agreed = await ask('Give me a fiscal digest for last month', plan({ tool: 'spending-total', period: 'last-month' }));
  assert.equal(agreed.outcome.source, 'on-device-ai');
  assert.deepEqual(agreed.outcome.request.period, { mode: 'month', key: '2026-08' });
  const disagreed = await ask('Give me a fiscal digest for last month', plan({ tool: 'spending-total', period: 'this-year' }));
  assert.equal(disagreed.outcome.source, 'deterministic');
  const invented = await ask('Give me a fiscal digest', plan({ tool: 'spending-total', period: 'all-time' }));
  assert.equal(invented.outcome.source, 'deterministic', 'a period the user never named is not accepted');
});

test('explicit dates never reach the model', async () => {
  for (const question of ['fiscal digest for March', 'fiscal digest 2025', 'fiscal digest since Monday',
    'fiscal digest past 3 weeks', 'ملخص مصاريف شهر مارس', 'ملخص مصاريف ٢٠٢٥', 'fiscal digest in ramadan',
    'fiscal digest lately', 'fiscal digest so far', 'fiscal digest before payday', 'ملخص مصاريف رمضان',
    'ملخص مصاريف مؤخراً', 'fiscal digest over the last few months']) {
    assert.equal(mentionsUnmappedDate(question), true, question);
    const { outcome, calls } = await ask(question, plan({ tool: 'spending-total' }));
    assert.equal(calls.length, 0, question);
    assert.equal(outcome.source, 'deterministic');
  }
});

test('a recognised question, a follow-up, or an unavailable model never calls the model', async () => {
  const recognised = await ask('How much did I spend?', plan({ tool: 'income-total' }));
  assert.notEqual(recognised.deterministic.tool, 'help');
  assert.equal(recognised.calls.length, 0);
  assert.equal(recognised.outcome.request, recognised.deterministic);

  const followUp = await ask('Give me a fiscal digest', plan({ tool: 'spending-total' }),
    { previous: { tool: 'spending-total', period } });
  assert.equal(followUp.calls.length, 0);

  for (const status of ['unsupported-os', 'device-not-eligible', 'not-enabled', 'model-not-ready']) {
    const off = await ask('Give me a fiscal digest', plan({ tool: 'spending-total' }),
      { availability: { status, provider: 'apple-foundation-models' } });
    assert.equal(off.calls.length, 0, status);
    assert.equal(off.outcome.source, 'deterministic');
    assert.equal(off.outcome.reason, 'unavailable');
  }
});

test('safety clarifications are never replaced by the model', async () => {
  const { ai, calls } = model(plan({ tool: 'spending-total' }));
  const clarification = { tool: 'help', clarification: 'Which card do you mean?' };
  const outcome = await improveAssistantRequestOnDevice({
    question: 'Give me a fiscal digest', deterministicRequest: clarification, defaultPeriod: period, now, appLanguage: 'en', ai,
  });
  assert.equal(outcome.request, clarification);
  assert.equal(calls.length, 0);
});

test('Arabic questions reach the model only when the platform lists Arabic', async () => {
  const englishOnly = await ask('ما هي مصاريفي', plan({ tool: 'spending-total' }));
  assert.equal(englishOnly.calls.length, 0);
  assert.equal(englishOnly.outcome.reason, 'language-unsupported');
  const gemini = await ask('ما هي مصاريفي', plan({ tool: 'spending-total' }),
    { availability: { status: 'available', provider: 'gemini-nano' } });
  assert.equal(gemini.calls.length, 0, 'Gemini Nano publishes no language list: English only');
  const arabic = await ask('ما هي مصاريفي', plan({ tool: 'spending-total' }),
    { availability: { status: 'available', provider: 'apple-foundation-models', languages: ['ar', 'en'] } });
  assert.equal(arabic.calls.length, 1);
  assert.equal(arabic.outcome.source, 'on-device-ai');
});

test('category, limit and closed arguments are validated by the production validator', async () => {
  const category = await ask('Give me a fiscal digest about eating out', plan({ tool: 'category-breakdown', category: 'dining' }));
  assert.deepEqual(category.outcome.request, { tool: 'category-breakdown', period, category: 'dining' });
  assert.equal(executeAssistantTool(state, category.outcome.request, now).data.totalFils, 5_000);
  const noCategory = await ask('Give me a fiscal digest about eating out', plan({ tool: 'category-breakdown' }));
  assert.equal(noCategory.outcome.source, 'deterministic');
  const top = await ask('Give me a fiscal digest of shops', plan({ tool: 'top-merchants' }));
  assert.deepEqual(top.outcome.request, { tool: 'top-merchants', period }, 'the executor default limit applies');
  const badKind = await ask('Give me a fiscal digest of accounts', plan({ tool: 'top-accounts', accountKind: 'credit-card' }));
  assert.equal(badKind.outcome.source, 'deterministic', 'top-accounts accepts only all/bank/card');
  const baseline = await ask('Give me a fiscal digest against history', plan({ tool: 'historical-baseline' }));
  assert.equal(baseline.outcome.source, 'deterministic', 'historical-baseline needs a closed baseline');
});

test('compileOnDeviceAskPlan is pure and returns validator-approved requests only', () => {
  const ctx = { question: 'Give me a fiscal digest', defaultPeriod: period, now };
  assert.equal(compileOnDeviceAskPlan({ tool: 'none' }, ctx), null);
  assert.equal(compileOnDeviceAskPlan({ tool: 'help' }, ctx), null);
  const upcoming = compileOnDeviceAskPlan({ tool: 'upcoming-payments', period: 'default', category: 'none', merchant: '',
    withinDays: '14', accountKind: 'none', metric: 'default', baseline: 'none' }, ctx);
  assert.deepEqual(upcoming, { tool: 'upcoming-payments' }, 'a day window is never taken from the model');
  const settlement = compileOnDeviceAskPlan({ tool: 'credit-card-settlement-summary', period: 'last-month', category: 'none',
    merchant: '', accountKind: 'none', metric: 'default', baseline: 'none' }, { ...ctx, question: 'cards settled last month' });
  assert.equal(settlement, null, 'settlement months stay with the deterministic planner');
});

test('timeout or slow model keeps the deterministic answer', async () => {
  const { outcome } = await ask('Give me a fiscal digest',
    () => Promise.reject(Object.assign(new Error('late'), { code: 'ERR_ON_DEVICE_AI_TIMEOUT' })));
  assert.equal(outcome.source, 'deterministic');
  assert.equal(outcome.reason, 'timeout');
});
