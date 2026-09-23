'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const engine = require('../build/wafra-assistant.js');
const { groundLocalAssistantRequest: ground, isIndependentAssistantQuestion: fresh, normalizeLocalAssistantQuestion: normalize } = load(path.join(root, 'src/lib/local-assistant-grounding.ts'), { '@/lib/wafra-assistant': engine });
const now = new Date('2026-09-23T12:00:00Z');
const period = { mode: 'month', key: '2026-08' };
const state = { transactions: [{ id: 'a', title: 'Talabat', type: 'expense', amountFils: 3000, date: '2026-08-10', category: 'food', accountId: 'cash' }], accounts: [{id: 'cash', name: 'Cash', type: 'cash'}], bills: [], cardDues: [], budgets: [], notSubscriptions: [], monthStartDay: 1 };
const candidate = { tool: 'spending-total', period: { mode: 'month', key: '2026-09' } };
const plain = x => JSON.parse(JSON.stringify(x));
test('clarification suggestions for review tools are executable by the real planner', () => {
  for (const tool of ['possible-duplicates', 'money-review', 'data-coverage']) {
    const result = ground(state, 'Please interpret an unknown phrase', { tool, period }, now, period);
    assert.equal(result.tool, 'help');
    assert.equal(engine.planAssistantQuestion(state, result.suggestions[0], now, null, period).tool, tool);
  }
});
test('independent questions can use semantic help after an earlier answer; references cannot', () => {
  for (const q of ['What is my outgoing money?', 'How much did I spend?', 'Give me my expenditure']) assert.equal(fresh(q), true, q);
  for (const q of ['And last month?', 'How much was that?', 'What about groceries?', 'Why did it change?', 'Same for August', 'How much do I owe on this card?', 'What are these payments?']) assert.equal(fresh(q), false, q);
});
test('explicit period and merchant are compiled by actual deterministic planner', () => {
  const q = 'Give me my outgoing money at Talabat last month';
  const out = ground(state, q, candidate, now, period);
  assert.equal(out.tool, 'merchant-breakdown');
  assert.equal(out.merchant, 'Talabat');
  assert.deepEqual(plain(out.period), { mode: 'month', key: '2026-08' });
});
test('unsupported or unknown constraints never receive the prototype default total', () => {
  for (const q of ['Give me my outgoing money below 200', 'Give me my outgoing money at UnknownShop', 'my outgoings excluding secret purchases', 'كم صرفت قبل سنة']) {
    assert.equal(ground(state, q, candidate, now, period).tool, 'help', q);
  }
});
test('neutral phrases respect selected scope; exact current-month phrase grounds calendar month', () => {
  assert.deepEqual(plain(ground(state, 'my outgoings', candidate, now, period).period), period);
  assert.deepEqual(plain(ground(state, 'كم صرفت هذا الشهر', candidate, now, period).period), {mode: 'month', key: '2026-09'});
});
test('unrecognized free text asks a scoped clarification instead of silently using defaults', () => {
  const out = ground(state, 'please compute an arbitrary complex total', candidate, now, period);
  assert.equal(out.tool, 'help');
  assert.match(out.clarification, /dates.*merchant.*category/);
  assert.equal(out.suggestions.length, 1);
});


test('bounded aliases work before AI download and preserve the entire constraint suffix', () => {
  const q = 'Give me my expenditure at Talabat last month';
  assert.equal(normalize(q), 'how much did I spend at Talabat last month');
  assert.equal(engine.planAssistantQuestion(state, normalize(q), now, null, period).merchant, 'Talabat');
  assert.equal(engine.planAssistantQuestion(state, normalize('Give me my expenditure under 200'), now, null, period).tool, 'help');
  assert.equal(normalize('my ongoing charges'), 'What are my active subscriptions?');
  assert.equal(normalize('my ongoing charges at Talabat'), 'my ongoing charges at Talabat');
});
