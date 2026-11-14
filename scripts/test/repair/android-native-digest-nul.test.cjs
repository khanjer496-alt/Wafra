'use strict';
// Android RC 396 F1, second cause. expo-modules-core converts every String
// argument on Android with env->NewStringUTF(utf8.c_str()), which stops at the
// first NUL. The Android review identity joins its fields with U+0000, so on a
// device every review hashed only its constant domain prefix: all reviews got
// ONE id, and the tray admitted the first and refused every other one.
// The digest stub below models that bridge exactly: it hashes the input up to
// its first NUL.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { createHash } = require('node:crypto');

const BUILD = path.resolve(__dirname, '../build');
const INBOX = [
  ['ENBD', 'Purchase of AED 37.45 with Debit Card ending 1234 at QA MART on 13-NOV-2026 10:05. Avl Bal AED 5,123.40.'],
  ['ADCB', 'ADCB: AED 120.00 spent on Card ending 5678 at WAFRA TEST CAFE, DUBAI on 13/11/2026 11:12. Available limit AED 9,880.00'],
  ['FAB', 'Your FAB Card ending 4455 was used for AED 85.50 at DEMO PHARMACY on 13-Nov-26 12:30.'],
  ['MASHREQ', 'Mashreq Credit Card ending 1234: AED 640.00 spent at SAMPLE FUEL STATION. Avail credit AED 4,360.00.'],
  ['ENBD', 'AED 1,234.56 debited from your card ending 1234 at QA APPLIANCES on 13-NOV-2026 13:40.'],
  ['ADCB', 'ADCB: AED 15.00 debited from Account ending 9876 at SAMPLE KIOSK on 13/11/2026 09:10. Balance AED 3,210.00.'],
  ['MASHREQ', 'Get 5% cashback up to AED 200.00 on dining this month at selected outlets. T&C apply.'],
  ['ENBD', 'Pre-approved personal loan up to AED 50,000.00 is waiting for you. Call now to apply.'],
  ['ADCB', 'ADCB: Your account balance is AED 12,345.67 as on 13/11/2026.'],
];

// Android's String path: the bridge cuts at the first NUL. Its typed-array path is intact.
const androidBridgeDigest = async (_algorithm, data) =>
  createHash('sha256').update(data.split('\u0000')[0], 'utf8').digest('hex');
const bytesDigest = async (_algorithm, bytes) => {
  const out = createHash('sha256').update(Buffer.from(bytes)).digest();
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
};
const fullStringDigest = async (_algorithm, data) => createHash('sha256').update(data, 'utf8').digest('hex');

function setup(platform = 'android', stringDigest = androidBridgeDigest, withBytes = true) {
  const now = Date.now();
  const rows = INBOX.map(([address, body], index) => ({ id: index + 1, address, body, date: now - (INBOX.length - index) * 60_000 }));
  const stub = (name, value) => {
    const resolved = require.resolve(path.join(BUILD, name));
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, default: value }, children: [], paths: [] };
  };
  stub('sms-reader.js', {
    async getInboxSms(sinceMs, beforeDateMs, beforeId, max) {
      return rows.filter(r => r.date >= sinceMs && (r.date < beforeDateMs || (r.date === beforeDateMs && r.id < beforeId)))
        .sort((a, b) => b.date - a.date || b.id - a.id).slice(0, max);
    },
    async getReceived() { return []; },
  });
  stub('notification-reader.js', { isAvailable: () => false, isEnabled: () => false, async getCaptured() { return []; },
    async ackCaptured() { return true; }, async clearCaptured() { return true; } });
  const crypto = require(path.join(BUILD, 'stub-expo-crypto.js'));
  crypto.CryptoDigestAlgorithm = { SHA256: 'sha256' };
  crypto.digestStringAsync = stringDigest;
  if (withBytes) crypto.digest = bytesDigest; else delete crypto.digest;
  require(path.join(BUILD, 'stub-secure-store.js')).__keychain.items.set('wafra.database.key.v1', 'a5'.repeat(32));
  require(path.join(BUILD, 'stub-react-native.js')).Platform.OS = platform;
  const markets = require(path.join(BUILD, 'markets.js'));
  markets.setLedgerCurrency('AED');
  markets.setActiveMarket('AE');
  return require(path.join(BUILD, 'auto-import.js'));
}

test('with an Android bridge that cuts at NUL, two different Review items still get different ids', async () => {
  const auto = setup();
  const page = await auto.scanInbox(0, {}, undefined, undefined, { cursor: null, pageSize: 128, legacyReviewSourceKeys: [],
    historyRepair: true, knownReviewSourceKeys: [], includeNotificationQueue: false });
  assert.ok(page.reviewCandidates.length >= 2, 'the loan offer and the balance SMS both reach Review');
  const ids = page.reviewCandidates.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length, `ids are distinct: ${ids.join(', ')}`);
  const tray = require(path.join(BUILD, 'alert-review-tray.js'));
  const admitted = tray.admitPreparedReviewAlerts(tray.emptyAlertReviewTray(), page.reviewCandidates, Date.now(), 'hold-source');
  assert.deepEqual(admitted.outcomes, page.reviewCandidates.map(() => 'admitted'), 'the tray admits every item; none is refused');
});

test('Android ids equal the documented identity (what a NUL-preserving string digest computes)', async () => {
  const scan = auto => auto.scanInbox(0, {}, undefined, undefined, { cursor: null, pageSize: 128, legacyReviewSourceKeys: [],
    historyRepair: true, knownReviewSourceKeys: [], includeNotificationQueue: false });
  const android = (await scan(setup('android'))).reviewCandidates.map(item => [item.id, item.sourceKey]);
  const reference = (await scan(setup('android', fullStringDigest, false))).reviewCandidates.map(item => [item.id, item.sourceKey]);
  assert.deepEqual(android, reference);
});
