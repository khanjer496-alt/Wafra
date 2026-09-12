'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const categories = require('../build/categories');
const boundary = load(path.join(root, 'src/lib/wafra-assistant-ai.ts'), { '@/lib/categories': categories });
const period = { mode: 'month', key: '2026-09' };

test('provider plans cannot silently drop a filter or accept malformed account scope', () => {
  for (const request of [
    { tool: 'spending-total', period, accountIds: 'checking' },
    { tool: 'spending-total', period, accountIds: [] },
    { tool: 'spending-total', period, accountIds: [''] },
    { tool: 'spending-total', period, accountIds: ['checking', 3] },
    { tool: 'spending-total', period, accountIds: Array.from({ length: 101 }, (_, n) => 'a' + n) },
    { tool: 'spending-total', period, merchant: 12 },
    { tool: 'spending-total', period, category: 'made-up' },
    { tool: 'spending-total', period, excludeMerchant: 'Coffee' },
    { tool: 'spending-total', period, comparisonPeriod: period },
    { tool: 'cash-outflow', period, merchant: 'Coffee' },
    { tool: 'subscriptions', period },
    { tool: 'upcoming-payments', accountIds: ['checking'] },
    { tool: 'help', clarification: 'A provider must not supply local clarification copy.' },
  ]) assert.equal(boundary.isAssistantToolRequest(request), false, JSON.stringify(request));
});

test('provider comparison windows reject invalid dates and extra boundaries', () => {
  for (const comparisonPeriod of [
    { mode: 'month', key: '2026-13' },
    { mode: 'range', from: '2026-02-30', to: '2026-03-05' },
    { mode: 'range', from: '2026-09-10', to: '2026-09-01' },
    { mode: 'month', key: '2026-08', from: '2026-08-15' },
  ]) assert.equal(boundary.isAssistantToolRequest({ tool: 'compare-periods', period, comparisonPeriod }), false);
});

test('valid combined filters and income categories survive the boundary', () => {
  for (const request of [
    { tool: 'spending-total', period, accountIds: ['checking'], merchant: 'Coffee', category: 'dining' },
    { tool: 'income-total', period, accountIds: ['checking'], category: 'salary' },
    { tool: 'compare-periods', period, category: 'groceries', comparisonPeriod: { mode: 'month', key: '2026-08' } },
    { tool: 'cash-outflow', period, accountIds: ['checking'] },
  ]) assert.equal(boundary.isAssistantToolRequest(request), true, JSON.stringify(request));
});

test('explanation envelopes keep local evidence and structured identifiers local', () => {
  const envelope = boundary.buildAssistantExplanationEnvelope('How much?', {
    tool: 'spending-total', title: 'Spending', body: 'Recorded spending',
    evidence: [{ label: 'Spending', transactionIds: ['secret-record-id'], accountNames: ['secret-account-name'], totalFils: 100 }],
    data: { totalFils: 100, transactionIds: 'secret-record-id', accountIds: 'secret-account-id',
      nested: { transactionIds: ['secret-nested-id'] }, invalid: Infinity },
  });
  assert.equal(JSON.stringify(envelope).includes('secret-'), false);
  assert.deepEqual(Object.keys(envelope.result.data), ['totalFils']);
});
