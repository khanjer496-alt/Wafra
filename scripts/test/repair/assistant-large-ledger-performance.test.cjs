'use strict';
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { test } = require('node:test');

const native = require('../build/stub-react-native');
const assistant = require('../build/wafra-assistant');
const transfer = require('../build/transfer-reconciliation');

test('14.7k-row Ask Wafra path stays bounded and reuses its snapshot index', async () => {
  const previousPlatform = native.Platform.OS;
  native.Platform.OS = 'android';
  try {
    const accounts = Array.from({ length: 44 }, (_, index) => ({
      id: `account-${index}`,
      name: `Account ${index}`,
      kind: 'bank',
      openingFils: 0,
      archived: false,
    }));
    const transactions = Array.from({ length: 14_761 }, (_, index) => ({
      id: `row-${index}`,
      date: `2026-${String((index % 9) + 1).padStart(2, '0')}-${String((index % 27) + 1).padStart(2, '0')}`,
      title: `Merchant ${index % 800}`,
      amountFils: 100 + (index % 5_000),
      category: index % 5 === 0 ? 'other' : 'dining',
      type: index % 6 === 0 ? 'income' : 'expense',
      accountId: `account-${index % accounts.length}`,
      source: 'sms',
      smsKey: `s${1_700_000_000_000 + index}-${index}`,
    }));
    const state = {
      hydrated: true,
      accounts,
      transactions,
      bills: [],
      cardDues: [],
      budgets: [],
      notSubscriptions: [],
      merchantOverrides: {},
      monthStartDay: 1,
      historyImport: { status: 'complete' },
      transferNormalizationVersion: transfer.TRANSFER_NORMALIZATION_VERSION,
      transferInternalIds: [],
    };
    const now = new Date('2026-09-16T12:00:00Z');
    const period = { mode: 'month', key: '2026-09' };

    const firstStarted = performance.now();
    const first = await assistant.runWafraAssistantCooperatively(
      state,
      'How much did I spend?',
      now,
      null,
      period,
    );
    const firstMs = performance.now() - firstStarted;
    assert.equal(first.request.tool, 'spending-total');
    assert.ok(first.answer.data.transactionCount > 0);
    // This is an algorithmic guard on Node, not a phone-frame benchmark. It is
    // intentionally loose: the previous regression occupied JS for ~4.5 s.
    assert.ok(firstMs < 1_000, `first 14.7k-row query took ${firstMs.toFixed(1)} ms`);

    const secondStarted = performance.now();
    const second = await assistant.runWafraAssistantCooperatively(
      state,
      'What are my top merchants?',
      now,
      null,
      period,
    );
    const secondMs = performance.now() - secondStarted;
    assert.equal(second.request.tool, 'top-merchants');
    assert.ok(secondMs < 500, `cached 14.7k-row query took ${secondMs.toFixed(1)} ms`);
  } finally {
    native.Platform.OS = previousPlatform;
  }
});
