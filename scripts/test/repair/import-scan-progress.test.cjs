'use strict';
// Live figures for a watched Android inbox read: the promotions counter, the
// "just found" rows and the native inbox count. All of it is display-only;
// these tests also pin that nothing about what is imported changed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const build = path.join(__dirname, '../build');
const root = path.resolve(__dirname, '../../..');
const NOW = Date.UTC(2026, 7, 11, 12, 0, 0);
const purchase = 'Purchase of AED 50.00 at CARREFOUR with Debit Card ending 1234';
const promo = 'ADCB: Get 10% cashback on your next purchase at partner stores. T&Cs apply.';
const personal = 'See you at 8 for dinner';
// Offer wording from a person's phone number is not a bank promotion.
const personalOffer = 'Get 20% off at the new cafe, they have a cashback offer too';

const inboxRows = [
  { id: 1, address: 'ADCB', body: promo, date: NOW + 1_000 },
  { id: 2, address: 'ADCB', body: purchase, date: NOW + 2_000 },
  { id: 3, address: '+971500000000', body: personal, date: NOW + 3_000 },
  { id: 4, address: '+971500000001', body: personalOffer, date: NOW + 500 },
];
let countAnswer = (sinceMs, atOrAfterMs) => inboxRows.filter((row) => row.date >= Math.max(sinceMs, atOrAfterMs)).length;
const countCalls = [];
const smsReader = {
  async getInboxSms(sinceMs, beforeDateMs, beforeId, max) {
    return inboxRows
      .filter((row) => row.date >= sinceMs && (row.date < beforeDateMs || (row.date === beforeDateMs && row.id < beforeId)))
      .sort((a, b) => b.date - a.date || b.id - a.id)
      .slice(0, max);
  },
  async getReceived() { return []; },
  async getInboxCount(sinceMs, atOrAfterMs) {
    countCalls.push([sinceMs, atOrAfterMs]);
    return countAnswer(sinceMs, atOrAfterMs);
  },
};
const installNativeStub = (moduleName, value) => {
  const resolved = require.resolve(path.join(build, moduleName));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true,
    exports: { __esModule: true, default: value }, children: [], paths: [] };
};
installNativeStub('sms-reader.js', smsReader);
installNativeStub('notification-reader.js', { isAvailable: () => false, isEnabled: () => false });
const expoCrypto = require(path.join(build, 'stub-expo-crypto.js'));
expoCrypto.CryptoDigestAlgorithm = { SHA256: 'sha256' };
expoCrypto.digestStringAsync = async (_algorithm, data) => createHash('sha256').update(data, 'utf8').digest('hex');
require(path.join(build, 'stub-secure-store.js')).__keychain.items.set('wafra.database.key.v1', 'a5'.repeat(32));
const reactNative = require(path.join(build, 'stub-react-native.js'));
reactNative.Platform.OS = 'android';
const markets = require(path.join(build, 'markets.js'));
markets.setLedgerCurrency(null);
markets.setActiveMarket('AE');
const { scanInbox, countInboxMessages } = require(path.join(build, 'auto-import.js'));

test('a watched scan reports promotions skipped, the oldest page date and the rows just found', async () => {
  const progress = [];
  const result = await scanInbox(0, {}, (scanned, found, detail) => progress.push({ scanned, found, detail }), 'en-AE');
  const last = progress[progress.length - 1];
  assert.ok(last && last.detail, 'detail arrives as an optional third argument');
  assert.equal(last.detail.promotionsSkipped, 1, 'the bank cashback offer is counted; the personal one is not');
  assert.equal(result.promotionsSkipped, 1);
  assert.equal(last.detail.oldestInboxDateMs, NOW + 500);
  assert.equal(last.detail.recentFound.length, 1);
  const [found] = last.detail.recentFound;
  assert.deepEqual(Object.keys(found).sort(), ['amountMinor', 'category', 'currency', 'merchant', 'type']);
  assert.equal(found.amountMinor, 5000);
  assert.equal(found.currency, 'AED');
  assert.equal(found.type, 'expense');
  assert.match(found.merchant, /carrefour/i);
  assert.doesNotMatch(JSON.stringify(last.detail), /Purchase of|cashback|Debit Card|ADCB/,
    'no message text or sender leaves the scanner in progress detail');
});

test('counting promotions changes nothing that is imported or reviewed', async () => {
  const result = await scanInbox(0, {}, undefined, 'en-AE');
  assert.equal(result.parsed.length, 1, 'only the purchase is parsed');
  assert.equal(result.reviewCandidates.length, 0, 'the offer is not turned into a review');
  assert.equal(result.declined.length, 0);
});

test('the native inbox count is used only when it is a real answer', async () => {
  countAnswer = () => 4;
  assert.equal(await countInboxMessages(0), 4);
  assert.deepEqual(countCalls.at(-1), [0, 0]);
  assert.equal(await countInboxMessages(0, NOW + 2_000), 4);
  assert.deepEqual(countCalls.at(-1), [0, NOW + 2_000]);
  for (const answer of [-1, 1.5, Number.NaN, undefined]) {
    countAnswer = () => answer;
    assert.equal(await countInboxMessages(0), null, `native ${answer} is unknown, never a total`);
  }
  countAnswer = () => { throw new Error('provider restricted'); };
  assert.equal(await countInboxMessages(0), null);
  const saved = smsReader.getInboxCount;
  delete smsReader.getInboxCount;
  assert.equal(await countInboxMessages(0), null, 'an older native build has no count');
  smsReader.getInboxCount = saved;
  reactNative.Platform.OS = 'ios';
  countAnswer = () => 3;
  assert.equal(await countInboxMessages(0), null, 'no inbox count off Android');
  reactNative.Platform.OS = 'android';
});

test('the native count is read-only, body-free and permission-gated', () => {
  const kotlin = fs.readFileSync(path.join(root,
    'modules/sms-reader/android/src/main/java/expo/modules/smsreader/SmsReaderModule.kt'), 'utf8');
  const start = kotlin.indexOf('AsyncFunction("getInboxCount")');
  assert.ok(start > 0);
  const body = kotlin.slice(start, kotlin.indexOf('AsyncFunction(', start + 10));
  assert.match(body, /checkSelfPermission\(Manifest\.permission\.READ_SMS\) != PackageManager\.PERMISSION_GRANTED\) \{\s*return@AsyncFunction -1/);
  assert.match(body, /Telephony\.Sms\.Inbox\.CONTENT_URI,\s*arrayOf\(Telephony\.Sms\._ID\),/, 'the projection is the row id alone');
  assert.match(body, /"\$\{Telephony\.Sms\.DATE\} >= \?"/);
  assert.match(body, /\?\.use \{ it\.count \} \?: -1/, 'the cursor is closed and only its count returned');
  assert.match(body, /catch \(_: Exception\) \{\s*-1/);
  assert.doesNotMatch(body, /BODY|ADDRESS|getString|insert|update\(|delete\(/, 'no text is read and nothing is written');
  const typings = fs.readFileSync(path.join(root, 'modules/sms-reader/index.ts'), 'utf8');
  assert.match(typings, /getInboxCount\?\(sinceMs: number, atOrAfterMs: number\): Promise<number>;/,
    'optional, so older binaries are handled');
});

test('the import screen shows a percentage only from that count and throttles live updates', () => {
  const screen = fs.readFileSync(path.join(root, 'src/app/import-sms.tsx'), 'utf8');
  assert.match(screen, /const scanPercent = scanDetail && inboxTotal !== null/);
  assert.match(screen, /Math\.min\(99, Math\.floor/, 'never 100% while bank-app notifications are still read');
  assert.match(screen, /: <ScanPanel reducedMotion=\{reducedMotion\} \/>/, 'no count, no ring: the indeterminate panel stays');
  assert.match(screen, /const PROGRESS_THROTTLE_MS = 250;/);
  assert.match(screen, /entering=\{reducedMotion \? undefined : FadeInDown\.duration\(Motion\.change\)\}/);
});
