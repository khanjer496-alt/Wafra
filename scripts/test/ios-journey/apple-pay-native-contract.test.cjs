const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('Wallet capture binds the currency amount object without binary floating point or guessed fields', () => {
  const plugin = read('modules/wafra-live-capture/plugin/index.js');
  const capture = plugin.split('struct CaptureWafraApplePayIntent: AppIntent {')[1].split('@available(iOS 26.0, *)')[0];
  assert.match(capture, /var amount: IntentCurrencyAmount\?/);
  assert.match(capture, /var merchant: String\?/);
  assert.match(capture, /amount: amount\?\.amount, currency: amount\?\.currencyCode/);
  assert.match(capture, /ReturnsValue<Bool>/);
  assert.match(capture, /case \.ignored: return \.result\(value: false\)/);
  assert.match(capture, /case \.disabled:\s*await WafraLiveCaptureNotice\.postIfDue\(\)\s*return \.result\(value: false\)/);
  assert.match(capture, /eventId: UUID\(\)\.uuidString, observedAt: Date\(\)/);
  assert.doesNotMatch(capture, /Double|Float|NumberFormatter|purchaseDate|cardId|cardLabel|providerId|recordFirstCapturedAt/);
  // Card or Pass is one optional String, passed straight to the store and never logged.
  assert.match(capture, /var cardOrPass: String\?/);
  assert.match(capture, /merchant: merchant,\s*cardOrPass: cardOrPass, eventId:/);
  assert.equal((capture.match(/@Parameter\(/g) ?? []).length, 3);
  assert.doesNotMatch(capture, /print\(|NSLog|os_log|Logger|debugPrint/);
  const setup = plugin.split('struct RecordWafraApplePaySetupProofIntent: AppIntent {')[1].split('@available(iOS 26.0, *)')[0];
  assert.doesNotMatch(setup, /@Parameter|stageApplePay|recordSetupProof\(/);
  assert.match(setup, /recordApplePaySetupProof\(at: Date\(\)\)/);
});

test('Wallet source remains protected from both older JS readers', () => {
  const module = read('modules/wafra-live-capture/ios/WafraLiveCaptureModule.swift');
  assert.match(module, /AsyncFunction\("listPendingRecords"\)[\s\S]*?includeNotifications: false/);
  assert.match(module, /AsyncFunction\("listPendingRecordsIncludingNotifications"\)[\s\S]*?includeNotifications: true\)/);
  assert.match(module, /AsyncFunction\("listPendingApplePayRecords"\)[\s\S]*?shared\.listPendingApplePayRecords\(limit: nativeLimit\)/);
  const store = read('modules/wafra-live-capture/ios/WafraLiveCaptureStore.swift');
  assert.match(store, /includeApplePay: Bool = false/);
  assert.match(store, /case \.applePay: if !includeApplePay \{ continue \}/);
  assert.match(store, /NSDecimalString\(&amount, Locale\(identifier: "en_US_POSIX"\)\)/);
  // The card value is sanitized before use and is never an admission gate: an
  // unusable card is dropped, and the body carries it only in sanitized form.
  assert.match(store, /let card = Self\.sanitizedApplePayCardOrPass\(cardOrPass\)/);
  assert.match(store, /cardOrPass: card\s*\)/);
  assert.match(store, /applePayCardOrPass: card\)/);
  assert.match(store, /private struct ApplePayPayload: Codable \{\s*let amount: String\s*let currency: String\s*let merchant: String\s*(?:\/\/\/[^\n]*\n\s*)*let cardOrPass: String\?\s*\}/);
  // Older three-key bodies stay valid; the fourth key must be a real string.
  assert.match(store, /Set\(fields\.keys\) == Set\(\["amount", "currency", "merchant"\]\) \|\|\s*\(Set\(fields\.keys\) == Set\(\["amount", "currency", "merchant", "cardOrPass"\]\) && fields\["cardOrPass"\] is String\)/);
  assert.match(store, /payload\.cardOrPass\.map\(\{ Self\.sanitizedApplePayCardOrPass\(\$0\) == \$0 \}\) \?\? true/);
  assert.doesNotMatch(store, /print\(|NSLog|os_log|debugPrint/);
});
