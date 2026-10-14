'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '../../..');
const adapter = path.join(root, 'src/lib/ios-background-alert-parser.ts');
const cache = new Map();
// This closure executes only current shipping TypeScript. No native, parser,
// ledger, rate, AI or platform stub can conceal an unwanted dependency.
function load(id) {
  assert.match(id, /^@\/lib\/[a-z0-9.-]+$/i, 'the adapter must have a pure local source closure');
  const file = path.join(root, 'src/lib', id.slice('@/lib/'.length) + '.ts');
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('require', 'module', 'exports', output)(load, module, module.exports);
  return module.exports;
}
const observedAt = Date.parse('2026-10-13T12:00:00Z');
const context = (currency = 'AED', country = 'AE') => ({ v: 1, country,
  parserMarket: country === 'AE' || country === 'SA' ? country : 'ZZ',
  ledgerMoney: { currency, exponent: currency === 'JOD' || currency === 'KWD' ? 3 : currency === 'JPY' ? 0 : 2 },
  sourceHash: 'a'.repeat(64) });
function parse(body, sender = 'ENBD', settings = context(), at = observedAt) {
  assert.ok(fs.existsSync(adapter), 'the shipping iOS background parser adapter is missing');
  return load('@/lib/ios-background-alert-parser').parseIosBackgroundAlert({
    v: 1, context: settings, sender, body, observedAt: at,
  });
}
// Canonical synthetic bank grammar already used by the normal parser tests.
// These controls prove adapter behavior, never independent bank-wide coverage.
const purchase = 'Purchase of AED 187.50 with Debit Card ending 1234 at CARREFOUR on 13/10/2026.';
const usd = 'Purchase of USD 24.86 with Debit Card ending 1234 at SAMPLE STORE.';
const globalUsd = 'Chase Bank alert: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET.';
const transfers = require('../fixtures/enbd-transfer-capture.js');

test('domestic source principal needs no original money fields', () => {
  const result = parse(purchase);
  assert.equal(result.route, 'parsed');
  assert.equal(result.provenance, 'launch');
  assert.equal(result.notification.style, 'movement');
  assert.equal(result.notification.family, 'purchase');
  assert.equal(result.notification.direction, 'debit');
  assert.deepEqual(result.notification.amount, { currency: 'AED', minorUnits: '18750', exponent: 2 });
  assert.deepEqual(result.notification.instrument, { kind: 'card', last4: '1234' });
});
for (const [currency, literal, minorUnits, exponent] of [
  ['USD', '24.86', '2486', 2], ['JOD', '24.501', '24501', 3], ['JPY', '2400', '2400', 0],
]) test(`${currency} original source money survives an AED ledger`, () => {
  const result = parse(usd.replace('USD 24.86', `${currency} ${literal}`));
  assert.equal(result.route, 'parsed');
  assert.deepEqual(result.notification.amount, { currency, minorUnits, exponent });
});
test('missing reference FX retains global original money with Review wording', () => {
  const result = parse(globalUsd, 'CHASE');
  assert.equal(result.route, 'review');
  assert.equal(result.provenance, 'unverified');
  assert.equal(result.notification.style, 'review');
  assert.deepEqual(result.notification.amount, { currency: 'USD', minorUnits: '2486', exponent: 2 });
});
test('best-effort posting is disabled even on a matching USD ledger', () => {
  const result = parse(globalUsd, 'CHASE', context('USD', 'US'));
  assert.equal(result.route, 'review');
  assert.equal(result.notification.style, 'review');
});
test('Saudi launch purchase retains the SAR principal instead of its balance', () => {
  const result = parse('POS purchase of SAR 125.50 at JARIR BOOKSTORE using Mada Card ending 1234. Available balance SAR 2,500.00.', 'ALRAJHI', context('SAR', 'SA'));
  assert.equal(result.route, 'parsed');
  assert.deepEqual(result.notification.amount, { currency: 'SAR', minorUnits: '12550', exponent: 2 });
});
test('known salary credit uses neutral received-money family', () => {
  const result = parse('Salary of AED 18,500.00 has been credited to your account ending 5678');
  assert.equal(result.notification.family, 'income');
  assert.equal(result.notification.direction, 'credit');
  assert.equal(result.notification.amount.minorUnits, '1850000');
});
for (const [currency, sender, body, minorUnits, exponent] of [
  ['EUR', 'DEUTSCHEBANK', 'Deutsche Bank: Kartenzahlung EUR 28,40 wurde belastet bei NORD MARKT.', '2840', 2],
  ['GBP', 'BARCLAYS', 'Barclays: Your card ending 1234 was charged GBP 12.34 at SAMPLE MARKET.', '1234', 2],
  ['JOD', 'ARABBANKJO', 'Arab Bank: Your card ending 1234 was charged JOD 24.501 at SAMPLE MARKET.', '24501', 3],
]) test(`${currency} missing FX remains source-qualified Review on AED`, () => {
  const result = parse(body, sender);
  assert.equal(result.route, 'review');
  assert.equal(result.notification.style, 'review');
  assert.deepEqual(result.notification.amount, { currency, minorUnits, exponent });
});
test('explicit unknown country preserves ISO source money without a currency guess', () => {
  const result = parse(globalUsd, 'CHASE', context('AED', 'ZZ'));
  assert.deepEqual(result.notification.amount, { currency: 'USD', minorUnits: '2486', exponent: 2 });
});
for (const [i, row] of transfers.entries()) test(`real-derived ENBD transfer leg ${i} never claims account ownership`, () => {
  const result = parse(row.body);
  assert.equal(result.route, 'parsed');
  assert.equal(result.notification.family, 'transfer');
  assert.equal(result.notification.direction, row.type === 'income' ? 'credit' : 'debit');
  assert.equal(result.notification.amount.minorUnits, String(row.minor));
  assert.equal(result.notification.instrument?.last4 ?? null, i === 1 ? '6382' : null);
  assert.equal(result.notification.merchant, null, 'a transfer rail is not a named counterparty');
});
// Existing parser corpus formats exercise the other structural transfer
// titles. This preview cleanup adds no new bank grammar or coverage claim.
for (const [name, body] of [
  ['bank transfer', 'AED 36.00 has been debited from your account no. 095XXX11XXX01 MOBILE BANKING TRANSFER TO AE····0021XXX85XXX01. The available balance is AED 26,209.80.'],
  ['own-account transfer', 'AED 2,500.00 has been transferred from your Account XXX1234 to your Wio Account ending 5678 on 10/09/2026.'],
  ['savings transfer', 'AED 3,000.00 has been debited from your account no. 095-XXX11XXX-01 RULE TRANSFER TO SAVINGS WITH ONE-SHOT SAVING. The available balance is AED 2257.74.'],
  ['inward remittance', 'Inward remittance of 5,000.00 AED has been credited to your account XX0002.'],
  ['outward remittance', 'Outward Remittance \nDebit \nAccount XXXX0002 \nAED 7000.00\nValue Date 06/05/25  \nAvailable Balance AED 4877.51'],
]) test(`${name} previews omit parser-created counterparty titles`, () => {
  const result = parse(body);
  assert.equal(result.route, 'parsed');
  assert.equal(result.notification.family, 'transfer');
  assert.equal(result.notification.merchant, null);
});
for (const [name, body, expected] of [
  ['named recipient', 'Dear Ahmed Salem, AED 750.00 has been debited from your Saving Bank Account ending with 2501 for a FastPay transfer to Khalid Rashid. If this is not you; contact us immediately.', 'Transfer to Khalid Rashid'],
  ['named payer', 'AED 3,000.00 credited to your account XXXX5678 via funds transfer from AHMED ALI', 'Ahmed Ali'],
]) test(`${name} remains in a transfer preview`, () => {
  const result = parse(body);
  assert.equal(result.notification.family, 'transfer');
  assert.equal(result.notification.merchant, expected);
});
// Name substitutions in known grammar are synthetic collision controls.
test('a source-proven payer matching a generic transfer title remains named', () => {
  const result = parse('AED 3,000.00 credited to your account XXXX5678 via funds transfer from Incoming Transfer');
  assert.equal(result.notification.family, 'transfer');
  assert.equal(result.notification.merchant, 'Incoming Transfer');
});
test('a purchase merchant matching a generic transfer title remains named', () => {
  const result = parse(purchase.replace('CARREFOUR', 'INCOMING TRANSFER'));
  assert.equal(result.notification.family, 'purchase');
  assert.equal(result.notification.merchant, 'Incoming Transfer');
});
for (const sender of ['', 'Wafra Automation', 'Wafra Shortcut', 'Shortcut']) test(`placeholder ${sender || 'empty'} cannot establish an issuer`, () => {
  assert.deepEqual(parse(transfers[3].body, sender), parse(transfers[3].body, ''));
});
const silent = [
  ['personal', 'Hi Ann, I have just spent USD 50.00 at Example Market.', '+12025550190'],
  ['spoofed personal', 'I spent AED 50.00 at Carrefour today.', 'ENBD'],
  ['OTP', 'Your OTP for USD 24.86 purchase at NORTH STAR MARKET is 123456. Do not share.', 'CHASE'],
  ['grouped OTP', 'Your OTP is 123 456 for a purchase of USD 24.86. Do not share.', 'CHASE'],
  ['future wording', 'Chase Bank alert: Your card ending 4421 will be charged USD 24.86 at NORTH STAR MARKET.', 'CHASE'],
  ['future date', globalUsd + ' on 2026-12-30.', 'CHASE'],
  ['negated', 'AED 1,714.50 has not been transferred to your account 202XXX55XXX02.', 'ENBD'],
  ['declined', 'Chase: Your purchase of USD 24.86 at NORTH STAR MARKET was declined. Card ending 4421.', 'CHASE'],
  ['promotion', 'Get 20% cashback! Spend USD 50.00 at NORTH STAR MARKET this week.', 'CHASE'],
  ['statement', 'Your Credit Card ending 4821 statement is generated. Total due AED 3,240.00, minimum due AED 162.00 by 05/08/2026', 'ENBD'],
  ['repayment', 'Payment towards Credit Card from Account XXXXX0135 Amount: AED 500.00 Date: 29/10/2026 Available Balance: AED 6,854.30', 'ENBD'],
  ['balance only', 'Chase: Your account ending 4421 balance is USD 1,024.86.', 'CHASE'],
  ['ambiguous principal', 'Bank alert: Your card ending 1234 was charged USD 24.86 and USD 50.00 at EXAMPLE MARKET.', ''],
  ['masked principal', 'Purchase of AED ····9235.93 with Debit Card ending 1234 at SAMPLE STORE.', 'ENBD'],
  ['zero principal', usd.replace('24.86', '0.00'), 'ENBD'],
  ['unsafe integer principal', usd.replace('24.86', '9007199254740992.00'), 'ENBD'],
];
for (const [name, body, sender] of silent) test(`${name} stays silent`, () => {
  assert.equal(parse(body, sender).notification, null);
});
test('receipt advice does not erase a completed primary movement', () => {
  const result = parse(transfers[2].body + ' If you have not made this transfer, contact your bank.');
  assert.equal(result.notification.family, 'transfer');
  assert.equal(result.notification.amount.minorUnits, '171450');
});
test('a shared dollar in unknown country is not inferred from the pinned ledger', () => {
  assert.equal(parse(globalUsd.replace('USD 24.86', '$24.86'), '', context('USD', null)).notification, null);
});
test('missing and malformed settings suppress only the preview', () => {
  for (const settings of [null, { ...context(), ledgerMoney: null }, { ...context(), sourceHash: 'bad' },
    { ...context(), country: 'XX' }, { ...context(), parserMarket: 'US' },
    { ...context(), parserMarket: ['AE'] },
    { ...context(), ledgerMoney: { currency: 'JPY', exponent: 2 } },
    { ...context(), ledgerMoney: { currency: 'CLF', exponent: 4 } }]) {
    assert.equal(parse(purchase, 'ENBD', settings).notification, null);
  }
});
test('bounded input refuses whole oversize or malformed input without truncation', () => {
  for (const [body, sender, at] of [
    [purchase + 'a'.repeat(4096), 'ENBD', observedAt],
    [purchase + '😀'.repeat(1024), 'ENBD', observedAt],
    [purchase, 'A'.repeat(81), observedAt], [purchase, 'ENBD', NaN],
    [purchase, 'ENBD', -1], [purchase + '\ud800', 'ENBD', observedAt],
  ]) assert.equal(parse(body, sender, context(), at).notification, null);
});
test('per-call country, market and ledger globals cannot bleed into another preview', () => {
  parse(purchase);
  parse(globalUsd, 'CHASE', context('USD', 'US'));
  assert.equal(parse(globalUsd.replace('USD 24.86', '$24.86'), '', context('USD', null)).notification, null);
  parse(purchase, 'ENBD', null);
  assert.equal(load('@/lib/country').getActiveCountry(), null);
  assert.equal(load('@/lib/markets').pinnedLedgerCurrencyCode(), null);
  assert.equal(load('@/lib/markets').getActiveMarket().id, 'ZZ');
});
test('serialization exports only the bounded scalar notification contract', () => {
  const result = parse(transfers[0].body);
  assert.deepEqual(Object.keys(result).sort(), ['notification', 'parserVersion', 'provenance', 'route', 'v']);
  assert.deepEqual(Object.keys(result.notification).sort(), ['amount', 'direction', 'family', 'instrument', 'merchant', 'style']);
  const serialized = JSON.stringify(result);
  assert.ok(Buffer.byteLength(serialized) <= 2048);
  assert.doesNotMatch(serialized, /raw|reference|balance|category|fxRate|owner|202XXX55XXX02|1430025/i);
  assert.equal(result.parserVersion, load('@/lib/sms-parser').PARSER_VERSION);
});
// Review reproductions: preview admission is stricter than retaining a receipt
// for foreground Review. These are suppression controls, not new bank formats.
for (const [name, sender, body] of [
  ['credit then debit', 'ENBD', 'AED 50.00 has been credited to your account 1234. AED 60.00 has been deducted from your account 1234.'],
  ['debit then credit', 'ENBD', 'AED 60.00 has been deducted from your account 1234. AED 50.00 has been credited to your account 1234.'],
  ['known-format example', 'ENBD', 'For example: AED 50.00 has been credited to your account 1234.'],
  ['addressed first-person spending', '+12025550190', 'Honey, I spent USD 50.00 using my credit card at CARREFOUR.'],
  ['first-person card discussion', '+12025550190', 'My credit card was charged USD 50.00 at CARREFOUR.'],
  ['quoted bank-event question', '+12025550190', 'Please explain this: Your credit card ending 4421 was charged USD 24.86 at NORTH STAR MARKET.'],
]) test(`review reproduction ${name} cannot produce a bank preview`, () => {
  assert.equal(parse(body, sender).notification, null);
});
for (const [name, body, currency, minorUnits, exponent] of [
  ['labeled balance', 'Purchase of AED 187.50 with Debit Card ending 1234 at CARREFOUR MALL OF EMIRATES, DUBAI on 17/07/2026. Avl balance AED 9,149.34', 'AED', '18750', 2],
  ['labeled fee', 'Cash withdrawal USD 100.00 completed. Service fee USD 2.00 charged.', 'USD', '10000', 2],
  ['parenthetical bank FX quote', 'Purchase of USD 9.99 (AED 36.70) at NETFLIX with Credit Card ending 4821', 'USD', '999', 2],
  ['real-derived compact FX quote', 'Payment of INR 270 (AED 10.96) was done at Craft docs', 'INR', '27000', 2],
  ['known refund bank FX quote', 'Purchase amount of THB 340.00 at SAMPLE STORE on your Debit Card ending 1234 has been refunded AED 37.40 to your card account. Avl Bal is AED 9,001.00.', 'THB', '34000', 2],
]) test(`${name} cannot compete with the proven principal`, () => {
  const result = parse(body);
  assert.equal(result.route, 'parsed');
  assert.deepEqual(result.notification.amount, { currency, minorUnits, exponent });
});
test('three-decimal cash principal and separate fee remain a cash movement', () => {
  const result = parse('Cash withdrawal JOD 24.501 completed. Service fee JOD 2.000 charged.');
  assert.equal(result.route, 'parsed');
  assert.equal(result.notification.family, 'cash-withdrawal');
  assert.equal(result.notification.direction, 'debit');
  assert.deepEqual(result.notification.amount, { currency: 'JOD', minorUnits: '24501', exponent: 3 });
});
