'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('tab projections reuse immutable ledger work instead of rescanning on every focus', () => {
  const ledger = read('src/lib/ledger.ts');
  const insights = read('src/lib/insights.ts');
  const subscriptions = read('src/lib/subscriptions.ts');
  const balances = read('src/lib/balances.ts');
  assert.match(ledger, /liveAccountIdsCache\?\.accounts === accounts/);
  assert.match(insights, /monthSummaryCache\?\.transactions === transactions/);
  assert.match(insights, /monthSummaryCache\.live === live/);
  assert.match(insights, /monthSummaryCache\.internal === internal/);
  assert.match(subscriptions, /subscriptionDetectionCache\.findIndex\(\(entry\) =>/);
  assert.match(subscriptions, /sameDetectionKey\(entry, transactions, notSubscriptions, todayKey, liveAccounts, internalTransfers\)/);
  assert.match(subscriptions, /entry\.transactions === transactions/);
  assert.match(subscriptions, /entry\.liveAccounts === liveAccounts/);
  assert.match(balances, /netWorthBreakdownCache\?\.accounts === state\.accounts/);
  assert.match(balances, /netWorthBreakdownCache\.transactions === state\.transactions/);
});

test('Android tab shell keeps the measured freeze/detach configuration', () => {
  const tabs = read('src/components/app-tabs-layout.tsx');
  assert.match(tabs, /freezeOnBlur: Platform\.OS === 'android'/);
  assert.doesNotMatch(tabs, /detachInactiveScreens=\{false\}/);
});
