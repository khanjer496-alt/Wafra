const path = require('path');
const fs = require('fs');
const { createHash } = require('crypto');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail) => {
  if (condition) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const NOW = Date.UTC(2026, 7, 11, 12, 0, 0);
const france = 'BNP Paribas: Paiement par carte débité de EUR 12,34 chez PRIVATE-BOUTIQUE';
const uae = 'Purchase of AED 50.00 at CARREFOUR with Debit Card ending 1234';
const declined = 'Your transaction of AED 500.00 at SHARAF DG was declined due to insufficient funds.';
const otp = 'BNP Paribas: OTP 123456 pour EUR 12,34. Ne partagez jamais ce code.';
const chase = 'Chase Alert: Your card ending 1234 was charged USD 20.00 at TARGET.';
const unfamiliarFabSalary = 'WPS AED 8,500.00 posted to A/C XXXX1234.';

const nativeRoot = path.resolve(
  __dirname,
  '../../modules/sms-reader/android/src/main/java/expo/modules/smsreader',
);
const nativeFilter = fs.readFileSync(path.join(nativeRoot, 'SensitiveMessageFilter.kt'), 'utf8');
const nativeInbox = fs.readFileSync(path.join(nativeRoot, 'SmsReaderModule.kt'), 'utf8');
const nativeDelivery = fs.readFileSync(path.join(nativeRoot, 'SmsDeliveryReceiver.kt'), 'utf8');
ok('OTP and security-code bodies stop at the native Android bridge/buffer boundary',
  /one\[ -\]\?time password|verification code|security code/.test(nativeFilter) &&
    /use\|enter\|input\|key in/.test(nativeFilter) &&
    nativeInbox.includes('SensitiveMessageFilter.shouldReject(body)') &&
    nativeDelivery.includes('SensitiveMessageFilter.shouldReject(body)') &&
    !nativeDelivery.includes('putString(KEY') &&
    nativeInbox.includes('AsyncFunction("clearCaptured")') &&
    nativeInbox.includes('OnCreate') &&
    nativeInbox.indexOf('SensitiveMessageFilter.shouldReject(body)') <
      nativeInbox.indexOf('"body" to body'),
  JSON.stringify({ nativeFilter: nativeFilter.length, nativeInbox: nativeInbox.length }));
ok('routine Android inbox paging and identity use the lossless date/id cursor',
  nativeInbox.includes('Telephony.Sms._ID') &&
    nativeInbox.includes('${Telephony.Sms.DATE} DESC, ${Telephony.Sms._ID} DESC') &&
    nativeInbox.includes('beforeId.toLong().toString()') &&
    nativeInbox.includes('"id" to it.getLong(idIdx).toDouble()'),
  nativeInbox.length);
const notificationRoot = path.resolve(
  __dirname,
  '../../modules/notification-reader/android/src/main/java/expo/modules/notificationreader',
);
const notificationFilter = fs.readFileSync(
  path.join(notificationRoot, 'SensitiveNotificationFilter.kt'), 'utf8',
);
const notificationListener = fs.readFileSync(
  path.join(notificationRoot, 'BankNotificationListenerService.kt'), 'utf8',
);
const notificationStore = fs.readFileSync(
  path.join(notificationRoot, 'NotificationCaptureStore.kt'), 'utf8',
);
ok('bank-app OTP notifications are refused before queueing and purged on upgrade',
  /verification code|security code/.test(notificationFilter) &&
    notificationListener.includes('SensitiveNotificationFilter.shouldReject(body)') &&
    notificationListener.indexOf('SensitiveNotificationFilter.shouldReject(body)') <
      notificationListener.indexOf('NotificationCaptureStore.append(') &&
    notificationStore.includes('SensitiveNotificationFilter.shouldReject'),
  JSON.stringify({ notificationFilter: notificationFilter.length }));

let inboxRows = [
  { address: 'BNPPARIBAS', body: france, date: NOW + 1_000 },
  { address: 'ADCB', body: uae, date: NOW + 2_000 },
  { address: 'ADCB', body: declined, date: NOW + 3_000 },
      { address: 'BNPPARIBAS', body: otp, date: NOW + 4_000 },
      { address: 'CHASE', body: chase, date: NOW + 4_500 },
      { address: 'FAB', body: unfamiliarFabSalary, date: NOW + 4_750 },
];
let receivedRows = [{ address: 'BNPPARIBAS', body: france, date: NOW + 1_500 }];
let notificationsEnabled = true;
const acknowledgedNotifications = [];
const notificationReadSince = [];
const inboxReadCursors = [];
let notificationRows = [{
  id: 'notification-row-0001',
  pkg: 'net.bnpparibas.mescomptes',
  title: 'BNP Paribas',
  text: 'Paiement par carte débité de EUR 9,99 chez PRIVATE-CAFE',
  ts: NOW + 5_000,
}];
const smsReader = {
  async getInboxSms(sinceMs, beforeDateMs, beforeId, max) {
    inboxReadCursors.push({ sinceMs, beforeDateMs, beforeId, max });
    return inboxRows.map((row, index) => ({ id: row.id ?? index + 1, ...row }));
  },
  async getReceived() {
    // The inbox body guard must keep the receiver's copy out of review too.
    return receivedRows;
  },
};
const notificationReader = {
  isEnabled: () => notificationsEnabled,
  async getCaptured(sinceMs) {
    notificationReadSince.push(sinceMs);
    return notificationRows;
  },
  async ackCaptured(ids) {
    acknowledgedNotifications.push(...ids);
    return true;
  },
  async clearCaptured() {
    return true;
  },
};

const installNativeStub = (moduleName, value) => {
  const resolved = require.resolve(path.join(__dirname, 'build', moduleName));
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: { __esModule: true, default: value },
    children: [],
    paths: [],
  };
};

installNativeStub('sms-reader.js', smsReader);
installNativeStub('notification-reader.js', notificationReader);
const expoCrypto = require('./build/stub-expo-crypto.js');
expoCrypto.CryptoDigestAlgorithm = { SHA256: 'sha256' };
expoCrypto.digestStringAsync = async (_algorithm, data) =>
  createHash('sha256').update(data, 'utf8').digest('hex');
const secureStore = require('./build/stub-secure-store.js');
secureStore.__keychain.items.set('wafra.database.key.v1', 'a5'.repeat(32));
const reactNative = require('./build/stub-react-native.js');
reactNative.Platform.OS = 'android';
const markets = require('./build/markets.js');
markets.setLedgerCurrency(null);
markets.setActiveMarket('AE');
const { scanInbox } = require('./build/auto-import.js');

(async () => {
  const first = await scanInbox(0, {}, undefined, 'fr-FR');
  ok('launch-tested UAE parsing still produces the ordinary import row',
    first.parsed.length === 1 && first.parsed[0].currency === 'AED' &&
      first.parsed[0].merchant === 'Carrefour' && first.parsed[0].sourceEventId === 'a2' &&
      first.detectedLaunchMarket === 'AE',
    JSON.stringify(first.parsed));
  ok('the first routine page starts from a date/id cursor rather than timestamp alone',
    inboxReadCursors[0]?.sinceMs === 0 &&
      inboxReadCursors[0]?.beforeId === Number.MAX_SAFE_INTEGER &&
      inboxReadCursors[0]?.max === 1000,
    JSON.stringify(inboxReadCursors[0]));
  ok('a parse-null, institution-backed global alert becomes review evidence only',
    first.reviewCandidates.length === 4 && first.reviewCandidates[0].market === 'FR' &&
      first.reviewCandidates[0].amount.currency === 'EUR' &&
      first.reviewCandidates[0].amount.minorUnits === '1234' &&
      first.reviewCandidates[0].channel === 'inbox', JSON.stringify(first.reviewCandidates));
  ok('parse-null bank-app notifications use the same review-only seam',
    first.reviewCandidates[3]?.channel === 'push' &&
      first.reviewCandidates[3]?.amount.minorUnits === '999',
    JSON.stringify(first.reviewCandidates));
  ok('reading a notification does not delete it before ledger durability',
    acknowledgedNotifications.length === 0, JSON.stringify(acknowledgedNotifications));
  ok('unacknowledged notifications are reread independently of the ledger watermark',
    notificationReadSince[0] === 0, JSON.stringify(notificationReadSince));
  ok('a globally routed alert cannot be converted through the active UAE parser',
    first.reviewCandidates[1]?.market === 'US' &&
      first.reviewCandidates[1]?.amount.currency === 'USD' &&
      first.reviewCandidates[1]?.amount.minorUnits === '2000' &&
      first.parsed.every((item) => item.originalCurrency !== 'USD'),
    JSON.stringify({ parsed: first.parsed, reviews: first.reviewCandidates }));
  ok('an unfamiliar Gulf salary reaches review instead of disappearing or auto-posting',
    first.reviewCandidates[2]?.market === 'AE' &&
      first.reviewCandidates[2]?.direction === 'credit' &&
      first.reviewCandidates[2]?.family === 'transfer' &&
      first.reviewCandidates[2]?.amount.currency === 'AED' &&
      first.reviewCandidates[2]?.amount.minorUnits === '850000' &&
      first.parsed.every((item) => item.amountFils !== 850000),
    JSON.stringify({ parsed: first.parsed, reviews: first.reviewCandidates }));
  ok('review template identity is opaque and retained without source text',
    /^art1_[0-9a-f]{64}$/.test(first.reviewCandidates[2]?.templateKey ?? ''),
    JSON.stringify(first.reviewCandidates[2]));
  ok('review evidence contains no source or sender text',
    !JSON.stringify(first.reviewCandidates).includes('PRIVATE-BOUTIQUE') &&
      !JSON.stringify(first.reviewCandidates).includes('PRIVATE-CAFE') &&
      !JSON.stringify(first.reviewCandidates).includes('BNPPARIBAS'),
    JSON.stringify(first.reviewCandidates));
  ok('non-posting alerts stay exclusively in the metadata-only healing channel',
    first.declined.length === 2 &&
      first.declined[0].smsTs === NOW + 3_000 &&
      first.declined[0].sourceEventId === 'a3' &&
      first.declined[0].reason === 'declined' &&
      first.declined[1].smsTs === NOW + 4_000 &&
      first.declined[1].sourceEventId === 'a4' &&
      first.declined[1].reason === 'security-challenge' &&
      first.declined.every((item) => !Object.prototype.hasOwnProperty.call(item, 'raw')) &&
      first.reviewCandidates.every(
        (item) => item.observedAt !== NOW + 3_000 && item.observedAt !== NOW + 4_000,
      ),
    JSON.stringify({ declined: first.declined, reviews: first.reviewCandidates }));
  ok('OTP and duplicate delivery copies never enter review',
    first.reviewCandidates.length === 4 && first.scannedCount === 8,
    JSON.stringify(first));
  await first.commit();
  ok('the scan exposes an explicit post-durability notification acknowledgement',
    acknowledgedNotifications.length === 1 &&
      acknowledgedNotifications[0] === 'notification-row-0001',
    JSON.stringify(acknowledgedNotifications));

  inboxRows = [];
  receivedRows = [];
  notificationRows = [{
    id: 'hostile-notification-0001',
    pkg: 'com.example.chat',
    title: 'Friends',
    text: 'Purchase of AED 50.00 at CARREFOUR with Debit Card ending 1234',
    ts: NOW + 5_500,
  }];
  const hostile = await scanInbox(0, {}, undefined, 'en-AE');
  await hostile.commit();
  ok('an untrusted app cannot imitate a bank alert or earn acknowledgement',
    hostile.parsed.length === 0 && hostile.reviewCandidates.length === 0 &&
      acknowledgedNotifications.length === 1,
    JSON.stringify({ hostile, acknowledgedNotifications }));

  inboxRows = [
    { address: 'BNPPARIBAS', body: france, date: NOW + 1_000 },
    { address: 'ADCB', body: uae, date: NOW + 2_000 },
    { address: 'ADCB', body: declined, date: NOW + 3_000 },
    { address: 'BNPPARIBAS', body: otp, date: NOW + 4_000 },
    { address: 'CHASE', body: chase, date: NOW + 4_500 },
    { address: 'FAB', body: unfamiliarFabSalary, date: NOW + 4_750 },
  ];
  receivedRows = [{ address: 'BNPPARIBAS', body: france, date: NOW + 1_500 }];
  notificationRows = [{
    id: 'notification-row-0001',
    pkg: 'net.bnpparibas.mescomptes',
    title: 'BNP Paribas',
    text: 'Paiement par carte débité de EUR 9,99 chez PRIVATE-CAFE',
    ts: NOW + 5_000,
  }];

  const second = await scanInbox(0, {}, undefined, 'fr-FR');
  ok('a parser reread derives the same opaque review identity',
    second.reviewCandidates[0]?.sourceKey === first.reviewCandidates[0]?.sourceKey &&
      second.reviewCandidates[0]?.id === first.reviewCandidates[0]?.id,
    JSON.stringify({ first: first.reviewCandidates, second: second.reviewCandidates }));

  inboxRows = [{
    address: 'FAB', body: 'WPS AED 9,100.00 posted to A/C XXXX1234.', date: NOW + 86_404_750,
  }];
  receivedRows = [];
  notificationRows = [];
  const nextSalary = await scanInbox(0, {}, undefined, 'en-AE');
  ok('changed amount and date keep the same private template but a distinct event identity',
    nextSalary.reviewCandidates[0]?.templateKey === first.reviewCandidates[2]?.templateKey &&
      nextSalary.reviewCandidates[0]?.sourceKey !== first.reviewCandidates[2]?.sourceKey,
    JSON.stringify({ first: first.reviewCandidates[2], next: nextSalary.reviewCandidates[0] }));

  inboxRows = [{
    address: 'FAB',
    body: 'AED 2,500.00 has been transferred to your FAB account from JOHN DOE',
    date: NOW + 172_804_750,
  }];
  const uncertainIncoming = await scanInbox(0, {}, undefined, 'en-AE');
  ok('a parser-readable but unclassified incoming transfer is reviewed instead of guessed as income',
    uncertainIncoming.parsed.length === 0 && uncertainIncoming.reviewCandidates.length === 1 &&
      uncertainIncoming.reviewCandidates[0]?.direction === 'credit' &&
      uncertainIncoming.reviewCandidates[0]?.family === 'transfer' &&
      uncertainIncoming.reviewCandidates[0]?.amount.minorUnits === '250000',
    JSON.stringify(uncertainIncoming));

  inboxRows = [
    { address: 'BNPPARIBAS', body: france, date: NOW + 1_000 },
    { address: 'ADCB', body: uae, date: NOW + 2_000 },
    { address: 'ADCB', body: declined, date: NOW + 3_000 },
    { address: 'BNPPARIBAS', body: otp, date: NOW + 4_000 },
    { address: 'CHASE', body: chase, date: NOW + 4_500 },
    { address: 'FAB', body: unfamiliarFabSalary, date: NOW + 4_750 },
  ];
  receivedRows = [{ address: 'BNPPARIBAS', body: france, date: NOW + 1_500 }];
  notificationRows = [{
    id: 'notification-row-0001',
    pkg: 'net.bnpparibas.mescomptes',
    title: 'BNP Paribas',
    text: 'Paiement par carte débité de EUR 9,99 chez PRIVATE-CAFE',
    ts: NOW + 5_000,
  }];

  secureStore.__keychain.items.set('wafra.database.key.v1', '5a'.repeat(32));
  const afterKeyRotation = await scanInbox(0, {}, undefined, 'fr-FR');
  ok('review identities are keyed to the erase-managed SQLCipher identity',
    afterKeyRotation.reviewCandidates[0]?.sourceKey !== first.reviewCandidates[0]?.sourceKey,
    JSON.stringify({ first: first.reviewCandidates[0], rotated: afterKeyRotation.reviewCandidates[0] }));

  secureStore.__keychain.items.delete('wafra.database.key.v1');
  let identityFailure = false;
  try {
    await scanInbox(0, {}, undefined, 'fr-FR');
  } catch (error) {
    identityFailure = error instanceof Error &&
      error.message === 'Encrypted review identity is unavailable';
  }
  ok('missing encrypted identity fails the whole scan before a watermark can advance',
    identityFailure);

  inboxRows = [{ address: 'ADCB', body: uae, date: NOW + 2_000 }];
  receivedRows = [{ address: 'CHASE', body: chase, date: NOW + 4_500 }];
  notificationsEnabled = false;
  let deliveryIdentityFailure = false;
  try {
    await scanInbox(0, {}, undefined, 'en-US');
  } catch (error) {
    deliveryIdentityFailure = error instanceof Error &&
      error.message === 'Encrypted review identity is unavailable';
  }
  ok('delivery review identity failure cannot be swallowed by best-effort collection',
    deliveryIdentityFailure);

  receivedRows = [];
  notificationsEnabled = true;
  const acknowledgementsBeforePushFailure = acknowledgedNotifications.length;
  let pushIdentityFailure = false;
  try {
    await scanInbox(0, {}, undefined, 'fr-FR');
  } catch (error) {
    pushIdentityFailure = error instanceof Error &&
      error.message === 'Encrypted review identity is unavailable';
  }
  ok('push review identity failure cannot be swallowed by best-effort collection',
    pushIdentityFailure && acknowledgedNotifications.length === acknowledgementsBeforePushFailure);
  secureStore.__keychain.items.set('wafra.database.key.v1', '5a'.repeat(32));

  notificationsEnabled = false;
  inboxRows = [
    {
      address: 'CAPITALONE',
      body: 'Your card ending 1234 was charged USD 20.00 at TARGET.',
      date: NOW + 5_100,
    },
    {
      address: 'REVOLUT',
      body: 'Your card ending 5678 was charged EUR 18.00 at MARKET.',
      date: NOW + 5_200,
    },
  ];
  const ambiguousGlobal = await scanInbox(0, {}, undefined, 'en-AE');
  ok('unknown or ambiguous foreign issuers never fall through the UAE parser',
    ambiguousGlobal.parsed.length === 0 && ambiguousGlobal.reviewCandidates.length === 0,
    JSON.stringify(ambiguousGlobal));

  notificationsEnabled = true;
  inboxRows = Array.from({ length: 50 }, (_, index) => ({
    address: 'BNPPARIBAS',
    body: `BNP Paribas: Paiement par carte débité de EUR ${index + 1},00 chez STORE-${index}`,
    date: NOW - 100_000 + index,
  }));
  const boundedNewest = await scanInbox(0, {}, undefined, 'fr-FR');
  ok('the bounded review window keeps a newer push over older inbox history',
    boundedNewest.reviewCandidates.length === 50 &&
      boundedNewest.reviewCandidates.some((item) => item.channel === 'push') &&
      boundedNewest.reviewCandidates.every((item) => item.observedAt !== NOW - 100_000),
    JSON.stringify(boundedNewest.reviewCandidates));

  markets.setLedgerCurrency(null);
  markets.setActiveMarket('AE');
  notificationsEnabled = false;
  receivedRows = [];
  inboxRows = [{
    address: 'ALRAJHI',
    body: 'Purchase of SAR 50.00 at PANDA with Debit Card ending 1234',
    date: NOW + 6_000,
  }];
  const saudi = await scanInbox(0, {}, undefined, 'en-US');
  ok('launch-tested Saudi parsing auto-selects its pack without locale or country input',
    saudi.parsed.length === 1 && saudi.parsed[0].currency === 'SAR' &&
      saudi.parsed[0].amountFils === 5000 &&
      saudi.parsed[0].originalCurrency === undefined &&
      saudi.detectedLaunchMarket === 'SA' &&
      saudi.reviewCandidates.length === 0 && markets.getActiveMarket().id === 'AE',
    JSON.stringify(saudi));

  markets.setLedgerCurrency(null);
  inboxRows = [{
    address: 'ADCB',
    body: 'ADCB: Purchase of USD 9.99 (AED 36.70) at APPLE with card ending 1234',
    date: NOW + 7_000,
  }];
  const uaeForeign = await scanInbox(0, {}, undefined, 'en-US');
  ok('a UAE foreign-card posting stays on the launch parser with local settlement money',
    uaeForeign.parsed.length === 1 && uaeForeign.parsed[0].currency === 'AED' &&
      uaeForeign.parsed[0].amountFils === 3670 &&
      uaeForeign.parsed[0].originalCurrency === 'USD' &&
      uaeForeign.detectedLaunchMarket === 'AE' &&
      uaeForeign.reviewCandidates.length === 0,
    JSON.stringify(uaeForeign));

  markets.setLedgerCurrency(null);
  markets.setActiveMarket('AE');
  inboxRows = [
    {
      id: 901,
      address: 'ADCB',
      body: 'Purchase of AED 25.00 at STORE ONE with Debit Card ending 1234',
      date: NOW + 8_000,
    },
    {
      id: 902,
      address: 'ADCB',
      body: 'Purchase of AED 25.00 at STORE TWO with Debit Card ending 1234',
      date: NOW + 8_000,
    },
  ];
  const sameTimestamp = await scanInbox(0, {}, undefined, 'en-AE');
  ok('same-timestamp same-value Android alerts retain distinct provider identities',
    sameTimestamp.parsed.length === 2 &&
      sameTimestamp.parsed[0].sourceEventId === 'a901' &&
      sameTimestamp.parsed[1].sourceEventId === 'a902',
    JSON.stringify(sameTimestamp.parsed));

  reactNative.Platform.OS = 'ios';
  const ios = await scanInbox(123, {}, undefined, 'fr-FR');
  ok('the review-candidate scanner remains Android-only',
    ios.reviewCandidates.length === 0 && ios.parsed.length === 0 && ios.newestTs === 123,
    JSON.stringify(ios));

  reactNative.Platform.OS = 'ios';
  console.log(`\nandroid-review-capture: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  reactNative.Platform.OS = 'ios';
  console.error(error);
  process.exit(1);
});
