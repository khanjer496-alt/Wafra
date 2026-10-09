'use strict';
/**
 * Both diagnostic files carry the recent re-read receipt
 * (recentRereadParserVersion): the parser release whose bounded re-read of
 * the last 14 days of messages last completed. A receipt behind the current
 * parser means the next routine scan re-reads that window again, which is
 * what a support reader needs to tell a one-time post-update re-read from one
 * that repeats. An integer or null, nothing else.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildDiagnosticExport } = require('../build/diagnostic-export.js');
const { setActiveMarket, setLedgerCurrency } = require('../build/markets.js');
setActiveMarket('AE'); setLedgerCurrency('AED', 2);

const epoch = Date.parse('2026-09-08T12:00:00Z');
const build = { version: '1.0.0', build: 'test', platform: 'android' };
const state = (extra = {}) => ({ hydrated: true, privateMode: false, ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  marketId: 'AE', language: 'en', monthStartDay: 1, parserVersion: 49, lastScanTs: 0, historyImport: null,
  accounts: [], transactions: [], budgets: [], bills: [], cardDues: [], goals: [], merchantOverrides: {},
  accountHints: {}, notSubscriptions: [], reviewTray: { schemaVersion: 1, pending: [], tombstones: [], templateRules: [] }, ...extra });
const options = { includeRetainedMessages: false, logoFor: () => ({ id: null, reason: 'unknown' }) };

test('the diagnostic export names the recent re-read receipt, as an integer or null', async () => {
  assert.equal((await buildDiagnosticExport(state({ recentRereadParserVersion: 61 }), build, options, epoch)).build.recentRereadVersion, 61);
  assert.equal((await buildDiagnosticExport(state(), build, options, epoch)).build.recentRereadVersion, null);
  assert.equal((await buildDiagnosticExport(state({ recentRereadParserVersion: '62' }), build, options, epoch)).build.recentRereadVersion, null);
  assert.equal((await buildDiagnosticExport(state({ recentRereadParserVersion: -1 }), build, options, epoch)).build.recentRereadVersion, null);
  assert.equal((await buildDiagnosticExport(state({ recentRereadParserVersion: 61.5 }), build, options, epoch)).build.recentRereadVersion, null);
});

test('the tester diagnostics carry the same receipt through an integer-only reader', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../src/lib/android-tester-diagnostics.ts'), 'utf8');
  assert.match(source, /recentRereadVersion: safeVersion\(state\.recentRereadParserVersion\),/);
  assert.match(source, /const safeVersion = \(value: unknown\): number \| null =>\n\s+typeof value === 'number' && Number\.isSafeInteger\(value\) && value >= 0 \? value : null;/);
});
