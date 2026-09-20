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
  const cards = read('src/lib/cards.ts');
  assert.match(cards, /reissueCache\?\.transactions === state\.transactions/);
  assert.match(cards, /reissueCache\.cardDues === state\.cardDues/);
});

test('Wallet balance projection does not reconcile the full transfer graph on first paint', () => {
  const balances = read('src/lib/balances.ts');
  const breakdown = balances.match(/export function netWorthBreakdown[\s\S]*?\n\}/)?.[0] ?? '';
  assert.doesNotMatch(breakdown, /=\s*reconcileTransfers\s*\(/,
    'recorded-balance projection must not synchronously rebuild the transfer graph');
  assert.match(breakdown, /transaction\.source === 'sms'/,
    'SMS-fed accounts must still remain excluded from derived running balances');
});

test('manual account balance skips transfer reconciliation when bank-capture evidence is absent', () => {
  const balances = read('src/lib/balances.ts');
  const account = balances.match(/export function accountBalanceFils[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(account, /hasCapturedRows/);
  assert.match(account, /t\.source === 'sms' \|\| Boolean\(t\.smsKey\)/);
  assert.match(account, /hasCapturedRows\s*\?\s*reconcileTransfers/);
});

test('Android tab shell keeps the measured freeze/detach configuration', () => {
  const tabs = read('src/components/app-tabs-layout.tsx');
  assert.match(tabs, /freezeOnBlur: Platform\.OS === 'android'/);
  assert.doesNotMatch(tabs, /detachInactiveScreens=\{false\}/);
});
