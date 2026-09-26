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
    nativeInbox.includes('${Telephony.Sms.DATE} DESC, ${Telephony.Sms._ID} DESC LIMIT $limit') &&
    nativeInbox.includes('beforeId.toLong()') &&
    nativeInbox.includes('"id" to row.id.toDouble()'),
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
const notificationRepostIdentity = fs.readFileSync(
  path.join(notificationRoot, 'NotificationRepostIdentity.kt'), 'utf8',
);
ok('a re-posted bank notification is one posting, not a second charge',
  // Identity was (package, postTime) alone, and everything downstream trusted
  // it: a notification's capture key is `s{postTime}-{amount}` and dedupe.ts
  // only pairs a push with an SMS, never a push with a push. An issuer
  // redelivering one alert with a fresh postTime therefore double-counted the
  // charge, with no window anywhere able to see the two copies as one event.
  notificationStore.includes('REPOST_WINDOW_MS = 30L * 60 * 1000') &&
    notificationStore.includes('repostReceipt(pkg: String, title: String, text: String, ts: Long)') &&
    // The identity is the normalized essentials, never the raw bytes: a
    // byte-exact `pkg\0title\0text` digest let one ADCB alert the bank
    // re-posted three times (another builder, title or text surface) reach
    // the ledger twice. NotificationRepostIdentity runs as Kotlin in
    // kotlin-regex.test.js.
    notificationStore.includes('NotificationRepostIdentity.of(pkg, title, text)') &&
    !/digest\("\$pkg\\u0000\$title\\u0000\$text"/.test(notificationStore) &&
    notificationStore.includes('return "repost"') &&
    // The guard must be consulted before the row is queued, and must outlive
    // the queue row itself — by redelivery time the first copy is normally
    // drained, so comparing against the queue alone would see nothing.
    notificationStore.indexOf('return "repost"') <
      notificationStore.indexOf('writeAll(context, next)') &&
    notificationStore.includes('if (eventIdentity != null) recordRecentContent(prefs, eventIdentity)') &&
    // Every path that admits or re-sees a posting records its receipt: a
    // repaired row, and a shade sweep re-reading a queued or acknowledged one.
    notificationStore.includes('eventIdentity?.let { recordRecentContent(prefs, it) }\n      return "repaired"') &&
    /eventIdentity\?\.let \{ ensureRecentContent\(prefs, it\) \}\s*return "acknowledged"/.test(notificationStore) &&
    /eventIdentity\?\.let \{ ensureRecentContent\(prefs, it\) \}\s*return "duplicate"/.test(notificationStore),
  JSON.stringify({ notificationStore: notificationStore.length }));
ok('retained re-post receipts stay ciphertext and are erased with the queue',
  // The class invariant is that SharedPreferences holds only opaque ids, IVs
  // and AES-GCM ciphertext. A bare content hash would weaken it: anyone with
  // the file could confirm a guessed alert body by hashing it.
  notificationStore.includes('putString(RECENT_CONTENT, encryptPayload(') &&
    notificationStore.includes('decryptPayload(stored)') &&
    notificationStore.includes('.remove(RECENT_CONTENT)') &&
    !/putString\(RECENT_CONTENT, (?!encryptPayload)/.test(notificationStore),
  JSON.stringify({ notificationStore: notificationStore.length }));
ok('re-post suppression requires an explicit transaction clock',
  notificationRepostIdentity.includes('val TRANSACTION_DATETIME_RE') &&
    notificationRepostIdentity.includes('TRANSACTION_DATETIME_RE.findAll(surface)') &&
    notificationRepostIdentity.includes('if (clocks.isEmpty()) return null') &&
    notificationStore.includes('val eventIdentity = repostReceipt(pkg, title, text, ts)') &&
    notificationStore.includes('if (eventIdentity != null && isRecentRepost(recentContent(prefs), eventIdentity))') &&
    notificationStore.includes('kotlin.math.abs(it.ts - candidate.ts) <= REPOST_WINDOW_MS'),
  JSON.stringify({ notificationStore: notificationStore.length }));
ok('a summary is skipped only beside a visible child, and history is never read as the posting',
  // A summary restates its children, and InboxStyle/MessagingStyle history
  // re-posts every older alert with each update; choosing the longest entry
  // re-captured an old charge. A summary with no visible child is captured.
  // History is a fallback for every package, used only when no other field
  // carries an amount, and only through NotificationTextSurfaces.newest(),
  // whose decisions run as Kotlin in kotlin-regex.test.js.
  /flags and Notification\.FLAG_GROUP_SUMMARY\) != 0 &&\s*summaryHasVisibleChild\(sbn\)\) \{\s*recordAdmission\("groupSummary", adcb\)\s*return/
    .test(notificationListener) &&
    notificationListener.includes('NotificationTextSurfaces.summaryHasVisibleChild(') &&
    notificationListener.indexOf('FLAG_GROUP_SUMMARY') <
      notificationListener.indexOf('NotificationCaptureStore.append(') &&
    notificationListener.indexOf('addText(extras.getCharSequence(Notification.EXTRA_BIG_TEXT))') <
      notificationListener.indexOf('addText(extras.getCharSequence(Notification.EXTRA_TEXT))') &&
    notificationListener.includes(
      'preferredCandidates.firstOrNull { MONEY_RE.containsMatchIn(it) }') &&
    !/addText\(extras\.(?:get|getCharSequenceArray)\(Notification\.EXTRA_(?:TEXT_LINES|MESSAGES|HISTORIC_MESSAGES)\)\)/
      .test(notificationListener) &&
    notificationListener.includes('.filter { key -> !CONVERSATION_EXTRA_KEYS.contains(key) }') &&
    (notificationListener.match(/addText\(newestConversationText\)/g) ?? []).length === 1 &&
    // Outside the curated-bank block: review-first apps get the fallback too.
    notificationListener.indexOf('addText(newestConversationText)') >
      notificationListener.indexOf('.forEach { key -> addText(extras.get(key)) }\n      }') &&
    /newestConversationText != null &&\s*textCandidates\.none \{ MONEY_RE\.containsMatchIn\(it\) \}/
      .test(notificationListener) &&
    notificationListener.includes(
      'NotificationTextSurfaces.newest(textLines(lines), messages(current)) { MONEY_RE.containsMatchIn(it) }') &&
    // History still reaches the OTP/security filter.
    notificationListener.includes('(listOf(title) + nonBlankTextCandidates + conversationSurfaces)'),
  JSON.stringify({ notificationListener: notificationListener.length }));
{
  const start = notificationStore.indexOf('fun admissionBlockReason(');
  const end = notificationStore.indexOf('@Synchronized', start);
  const diagnostics = start >= 0 && end > start ? notificationStore.slice(start, end) : '';
  ok('admission diagnostics name a suppressed re-post with the same test append() applies',
    diagnostics.includes('pkg: String, title: String, text: String, ts: Long') &&
      diagnostics.includes('val eventIdentity = repostReceipt(pkg, title, text, ts)') &&
      diagnostics.includes('isRecentRepost(recentContent(prefs), eventIdentity)') &&
      diagnostics.includes('"repost" else null'),
    JSON.stringify({ diagnostics: diagnostics.length }));
}
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
process.env.EXPO_PUBLIC_WAFRA_ANDROID_NOTIFICATION_CAPTURE_BETA = '1';
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
    return inboxRows
      .map((row, index) => ({ id: row.id ?? index + 1, ...row }))
      .filter((row) => row.date >= sinceMs &&
        (row.date < beforeDateMs || (row.date === beforeDateMs && row.id < beforeId)))
      .sort((a, b) => b.date - a.date || b.id - a.id)
      .slice(0, max);
  },
  async getReceived() {
    // The inbox body guard must keep the receiver's copy out of review too.
    return receivedRows;
  },
};
const notificationReader = {
  isAvailable: () => true,
  isEnabled: () => notificationsEnabled,
  async getCaptured(sinceMs) {
    notificationReadSince.push(sinceMs);
    const trusted = new Set([
      'net.bnpparibas.mescomptes',
      'ae.hsbc.hsbcuae',
      'com.adcb.nexgen',
      'com.barclays.android.barclaysmobilebanking',
      'com.hdfcbank.android.now',
    ]);
    return notificationRows.map((row) => ({
      sourceClass: row.sourceClass ?? (trusted.has(row.pkg) ? 'trusted-bank' : 'financial-candidate'),
      appLabel: row.appLabel ?? row.title ?? '',
      ...row,
    }));
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
const { scanInbox, getAndroidNotificationImportDiagnostics,
  MESSAGING_APP_PACKAGES, SMS_APP_PACKAGES, CHAT_APP_PACKAGES,
  hasCarrierDuplicateIdentity } = require('./build/auto-import.js');
const nativeTrustedPackages = fs.readFileSync(
  path.join(notificationRoot, 'TrustedBankNotificationPackages.kt'), 'utf8',
);
const nativeReaderModule = fs.readFileSync(
  path.join(notificationRoot, 'NotificationReaderModule.kt'), 'utf8',
);
{
  const kotlinSet = (name) => {
    const block = nativeTrustedPackages.match(
      new RegExp(`val ${name}: Set<String> = setOf\\(([\\s\\S]*?)\\n {2}\\)`))?.[1] ?? '';
    return [...block.matchAll(/"([A-Za-z0-9_.]+)"/g)].map((m) => m[1]).sort();
  };
  const kotlinSms = kotlinSet('smsAppPackages');
  const kotlinChat = kotlinSet('chatAppPackages');
  const capture = nativeTrustedPackages.slice(
    nativeTrustedPackages.indexOf('fun sourceClass('),
    nativeTrustedPackages.indexOf('fun queuedSourceClass('));
  ok('SMS and chat app lists match natively and in JS',
    kotlinSms.length >= 5 && kotlinChat.length >= 5 &&
      JSON.stringify(kotlinSms) === JSON.stringify([...SMS_APP_PACKAGES].sort()) &&
      JSON.stringify(kotlinChat) === JSON.stringify([...CHAT_APP_PACKAGES].sort()) &&
      JSON.stringify([...kotlinSms, ...kotlinChat].sort()) ===
        JSON.stringify([...MESSAGING_APP_PACKAGES].sort()) &&
      kotlinSms.includes('com.google.android.apps.messaging') &&
      kotlinSms.includes('com.samsung.android.messaging') &&
      kotlinChat.includes('com.whatsapp'),
    JSON.stringify({ kotlinSms, kotlinChat }));
  ok('natively, a messaging app is never a financial candidate; only the SMS route, without READ_SMS, reaches Review',
    nativeTrustedPackages.includes('Telephony.Sms.getDefaultSmsPackage(context)') &&
      nativeTrustedPackages.includes('checkSelfPermission(Manifest.permission.READ_SMS)') &&
      // Curated banks first, then messaging apps, and both before the Play
      // gate and the money-word test that used to admit Messages.
      capture.indexOf('if (isTrusted(context, packageName)) return SOURCE_TRUSTED_BANK') >= 0 &&
      capture.indexOf('if (isTrusted(context, packageName)) return SOURCE_TRUSTED_BANK') <
        capture.indexOf('if (isMessagingApp(context, packageName)) {') &&
      capture.indexOf('if (isMessagingApp(context, packageName)) {') <
        capture.indexOf('if (!playInstalled(context, packageName)) return null') &&
      /isSmsApp\(context, packageName\) && !smsReadable\(context\)[\s\S]{0,120}SOURCE_MESSAGING_REVIEW else null/
        .test(capture) &&
      // Queued rows always reach JS so they can be acknowledged or reviewed.
      nativeReaderModule.includes('TrustedBankNotificationPackages.queuedSourceClass('),
    JSON.stringify({ capture: capture.length }));
}

const baseLedgerState = () => ({ hydrated: true, marketId: 'AE',
  ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  accounts: [], transactions: [], cardDues: [], bills: [], budgets: [], goals: [],
  accountHints: {}, merchantOverrides: {}, lastScanTs: 0, parserVersion: 0 });

(async () => {
  const first = await scanInbox(0, {}, undefined, 'fr-FR');
  ok('launch-tested UAE parsing and explicit salary produce ordinary import rows',
    first.parsed.length === 2 && first.parsed[0].currency === 'AED' &&
      first.parsed[0].merchant === 'Carrefour' && first.parsed[0].sourceEventId === 'a2' &&
      first.parsed[1].merchant === 'Salary' && first.parsed[1].type === 'income' &&
      first.parsed[1].amountFils === 850000 && first.parsed[1].sourceEventId === 'a6' &&
      first.detectedLaunchMarket === 'AE',
    JSON.stringify(first.parsed));
  ok('the first routine page starts from a date/id cursor rather than timestamp alone',
    inboxReadCursors[0]?.sinceMs === 0 &&
      inboxReadCursors[0]?.beforeId === Number.MAX_SAFE_INTEGER &&
      inboxReadCursors[0]?.max === 1000,
    JSON.stringify(inboxReadCursors[0]));
  ok('a parse-null, institution-backed global alert becomes review evidence only',
    first.reviewCandidates.length === 3 && first.reviewCandidates[0].market === 'FR' &&
      first.reviewCandidates[0].amount.currency === 'EUR' &&
      first.reviewCandidates[0].amount.minorUnits === '1234' &&
      first.reviewCandidates[0].channel === 'inbox', JSON.stringify(first.reviewCandidates));
  ok('parse-null bank-app notifications use the same review-only seam',
    first.reviewCandidates[2]?.channel === 'push' &&
      first.reviewCandidates[2]?.amount.minorUnits === '999',
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
  ok('an explicit posted Gulf salary auto-posts with exact money and salary meaning',
    first.parsed[1]?.currency === 'AED' && first.parsed[1]?.amountFils === 850000 &&
      first.parsed[1]?.type === 'income' && first.parsed[1]?.categoryGuess === 'salary' &&
      first.parsed[1]?.transferHint === false &&
      first.reviewCandidates.every((item) => item.amount.minorUnits !== '850000'),
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
      first.declined.some((item) => item.smsTs === NOW + 3_000 &&
        item.sourceEventId === 'a3' && item.reason === 'declined') &&
      first.declined.some((item) => item.smsTs === NOW + 4_000 &&
        item.sourceEventId === 'a4' && item.reason === 'security-challenge') &&
      first.declined.every((item) => !Object.prototype.hasOwnProperty.call(item, 'raw')) &&
      first.reviewCandidates.every(
        (item) => item.observedAt !== NOW + 3_000 && item.observedAt !== NOW + 4_000,
      ),
    JSON.stringify({ declined: first.declined, reviews: first.reviewCandidates }));
  ok('OTP and duplicate delivery copies never enter review',
    first.reviewCandidates.length === 3 && first.scannedCount === 8,
    JSON.stringify(first));
  await first.commit();
  ok('the scan exposes an explicit post-durability notification acknowledgement',
    acknowledgedNotifications.length === 1 &&
      acknowledgedNotifications[0] === 'notification-row-0001',
    JSON.stringify(acknowledgedNotifications));

  // Global Android bank-app capture is not a UAE/Saudi-only feature. Exact
  // curated package identity or a strong installed-app banking identity may
  // auto-import a source-grounded posting when its native currency matches the
  // ledger. Only truly ambiguous packages remain Review-first.
  inboxRows = [];
  receivedRows = [];
  markets.setLedgerCurrency('EUR', 2);
  notificationRows = [{
    id: 'bnp-eur-push-global-01',
    pkg: 'net.bnpparibas.mescomptes',
    title: 'BNP Paribas',
    text: 'Paiement par carte débité de EUR 9,99 chez PRIVATE-CAFE',
    ts: NOW + 5_100,
  }];
  const bnpGlobal = await scanInbox(0, {}, undefined, 'fr-FR', { notificationOnly: true });
  ok('trusted BNP Android push auto-imports in a matching EUR ledger',
    bnpGlobal.parsed.length === 1 && bnpGlobal.reviewCandidates.length === 0 &&
      bnpGlobal.parsed[0]?.currency === 'EUR' && bnpGlobal.parsed[0]?.amountFils === 999 &&
      bnpGlobal.parsed[0]?.merchant === 'PRIVATE-CAFE',
    JSON.stringify(bnpGlobal));
  await bnpGlobal.commit();

  markets.setLedgerCurrency('GBP', 2);
  notificationRows = [{
    id: 'barclays-gbp-global-01',
    pkg: 'com.barclays.android.barclaysmobilebanking',
    title: 'Barclays',
    text: 'Your card ending 1234 was charged GBP 12.34 at TESCO.',
    ts: NOW + 5_150,
  }];
  const barclaysGlobal = await scanInbox(0, {}, undefined, 'en-GB', { notificationOnly: true });
  ok('trusted Barclays Android push auto-imports in a matching GBP ledger',
    barclaysGlobal.parsed.length === 1 && barclaysGlobal.reviewCandidates.length === 0 &&
      barclaysGlobal.parsed[0]?.currency === 'GBP' && barclaysGlobal.parsed[0]?.amountFils === 1234,
    JSON.stringify(barclaysGlobal));
  await barclaysGlobal.commit();

  markets.setLedgerCurrency('JPY', 0);
  notificationRows = [{
    id: 'learned-jpy-global-0001',
    pkg: 'com.example.jpbank',
    appLabel: 'JP Bank',
    title: 'JP Bank',
    text: 'Card purchase JPY 2400 at LOCAL CAFE.',
    ts: NOW + 5_175,
  }];
  const learnedJpy = await scanInbox(0, {}, undefined, 'ja-JP', { notificationOnly: true });
  ok('an unseen Play bank app with strong installed identity auto-imports zero-decimal JPY',
    learnedJpy.parsed.length === 1 && learnedJpy.reviewCandidates.length === 0 &&
      learnedJpy.parsed[0]?.currency === 'JPY' && learnedJpy.parsed[0]?.amountFils === 2400,
    JSON.stringify(learnedJpy));
  await learnedJpy.commit();

  markets.setLedgerCurrency('KWD', 3);
  notificationRows = [{
    id: 'learned-kwd-global-0001',
    pkg: 'com.example.kwbank',
    appLabel: 'Kuwait Bank',
    title: 'Kuwait Bank',
    text: 'تم خصم KWD ١٢٫٣٤٥ لشراء بالبطاقة لدى LOCAL CAFE',
    ts: NOW + 5_190,
  }];
  const learnedKwd = await scanInbox(0, {}, undefined, 'ar-KW', { notificationOnly: true });
  ok('an unseen Play bank app with strong installed identity auto-imports three-decimal KWD',
    learnedKwd.parsed.length === 1 && learnedKwd.reviewCandidates.length === 0 &&
      learnedKwd.parsed[0]?.currency === 'KWD' && learnedKwd.parsed[0]?.amountFils === 12345,
    JSON.stringify(learnedKwd));
  await learnedKwd.commit();

  markets.setLedgerCurrency(null);
  markets.setActiveMarket('AE');

  notificationRows = [{
    id: 'adcb-notification-format-0001',
    pkg: 'com.adcb.nexgen',
    title: 'ADCBAlert',
    text: 'Credit Card XX7720 was used for AED25.90 on 14/09/2026 23:52:52 at TEST MERCHANT',
    ts: NOW + 5_250,
  }];
  const adcbPush = await scanInbox(0, {}, undefined, 'en-AE', { notificationOnly: true });
  ok('the exact ADCB Android push format imports through the full notification parser path',
    adcbPush.parsed.length === 1 && adcbPush.reviewCandidates.length === 0 &&
      adcbPush.parsed[0]?.amountFils === 2590 && adcbPush.parsed[0]?.merchant === 'Test Merchant' &&
      adcbPush.parsed[0]?.card?.last4 === '7720' && adcbPush.parsed[0]?.card?.kind === 'credit' &&
      adcbPush.parsed[0]?.date === '2026-09-14',
    JSON.stringify(adcbPush));
  const ackBeforeAdcbPush = acknowledgedNotifications.length;
  await adcbPush.commit();
  ok('the ADCB push is acknowledged only after the parsed row commit boundary',
    acknowledgedNotifications.length === ackBeforeAdcbPush + 1 &&
      acknowledgedNotifications.includes('adcb-notification-format-0001'),
    JSON.stringify(acknowledgedNotifications));

  // An owner's ADCB app posted ONE charge three times (owner-consented text,
  // already masked). The native re-post guard missed a copy and the ledger
  // got two rows 160 s apart — past the two-minute push↔push title rule. The
  // alert states its own clock to the second, and that stated event is what
  // the ledger now matches, however the copies' delivery times, titles and
  // text surfaces differ. Two genuine charges state different seconds.
  {
    const { buildImportPlan } = require('./build/import-plan.js');
    const { reconcileCaptureDuplicates } = require('./build/dedupe.js');
    const adcbText = 'Credit Card XX2518 was used for AED290.00 on 25/09/2026 17:38:39 at SOUTHERN FRIED CHICK, Sharjah-AE. Available limit AED58823.09';
    const firstPost = 1790343524092; // 13:38:44Z, the owner's first stored copy
    const copies = [
      { id: 'adcb-repost-copy-0001', pkg: 'com.adcb.nexgen', title: 'ADCBAlert', text: adcbText, ts: firstPost },
      // BIG_TEXT vs TEXT surface: line breaks and doubled spaces; app-name title.
      { id: 'adcb-repost-copy-0002', pkg: 'com.adcb.nexgen', title: 'ADCB',
        text: `  ${adcbText.replace(' was used', '\n was  used').replace(' at ', '  at ')} `, ts: 1790343684541 },
      { id: 'adcb-repost-copy-0003', pkg: 'com.adcb.nexgen', title: 'ADCBAlert',
        text: adcbText.replace('AED290.00', 'AED 290.00'), ts: firstPost + 300_000 },
    ];
    const scanCopies = async (rows) => {
      notificationRows = rows;
      const scanned = await scanInbox(0, {}, undefined, 'en-AE', { notificationOnly: true });
      await scanned.commit();
      return scanned;
    };
    const stored = (plan, state = baseLedgerState(), prefix = 'row') => ({ ...state,
      transactions: [...state.transactions,
        ...plan.batch.transactions.map((row, index) => ({ ...row, id: `${prefix}-${index}` }))] });

    const all = await scanCopies(copies);
    const onePlan = buildImportPlan(all.parsed, baseLedgerState(), all.newestTs);
    ok('three copies of one re-posted ADCB alert in one scan become exactly one ledger row',
      all.parsed.length === 3 && onePlan.batch.transactions.length === 1 &&
        onePlan.batch.transactions[0].amountFils === 29000 &&
        onePlan.batch.transactions[0].title === 'Southern Fried Chick' &&
        /^e1:[0-9a-f]{16}:[0-9a-f]{16}$/.test(onePlan.batch.transactions[0].captureEventIdentity ?? ''),
      JSON.stringify({ parsed: all.parsed.length, rows: onePlan.batch.transactions }));

    const first = await scanCopies(copies.slice(0, 1));
    let ledger = stored(buildImportPlan(first.parsed, baseLedgerState(), first.newestTs));
    const second = await scanCopies(copies.slice(1, 2));
    const secondPlan = buildImportPlan(second.parsed, ledger, second.newestTs);
    const third = await scanCopies(copies.slice(2));
    const thirdPlan = buildImportPlan(third.parsed, ledger, third.newestTs);
    ok('later copies (160 s and 300 s after, other title/surface) add nothing to a stored row',
      ledger.transactions.length === 1 && secondPlan.batch.transactions.length === 0 &&
        thirdPlan.batch.transactions.length === 0 &&
        // Nothing rewrites the stored row's clock or identity either.
        secondPlan.batch.updates.length === 0 && thirdPlan.batch.updates.length === 0,
      JSON.stringify({ second: secondPlan.batch, third: thirdPlan.batch }));

    const genuine = await scanCopies([
      copies[0],
      { id: 'adcb-genuine-second-01', pkg: 'com.adcb.nexgen', title: 'ADCBAlert',
        text: adcbText.replace('17:38:39', '17:39:02'), ts: firstPost + 23_000 },
    ]);
    ok('two genuine identical charges 23 s apart (17:38:39, 17:39:02) stay two rows',
      buildImportPlan(genuine.parsed, baseLedgerState(), genuine.newestTs).batch.transactions.length === 2,
      JSON.stringify(genuine.parsed.map((row) => row.smsTs)));
    const genuineLater = await scanCopies([{ id: 'adcb-genuine-second-02', pkg: 'com.adcb.nexgen', title: 'ADCBAlert',
      text: adcbText.replace('17:38:39', '17:39:02'), ts: firstPost + 23_000 }]);
    ok('a genuine second charge arriving after the first was stored is still posted',
      buildImportPlan(genuineLater.parsed, ledger, genuineLater.newestTs).batch.transactions.length === 1);

    const noSeconds = adcbText.replace('17:38:39', '17:38');
    const clockless = await scanCopies([
      { ...copies[0], id: 'adcb-no-seconds-0001', text: noSeconds },
      { ...copies[0], id: 'adcb-no-seconds-0002', text: noSeconds, ts: firstPost + 160_000 },
      { ...copies[0], id: 'adcb-no-seconds-0003', text: noSeconds, ts: firstPost + 190_000 },
    ]);
    const clocklessPlan = buildImportPlan(clockless.parsed, baseLedgerState(), clockless.newestTs);
    ok('an alert without seconds keeps the old rules: no identity, two-minute title window only',
      clocklessPlan.batch.transactions.length === 2 &&
        clocklessPlan.batch.transactions.every((row) => row.captureEventIdentity === undefined),
      JSON.stringify(clocklessPlan.batch.transactions.map((row) => row.ts)));

    // The bank SMS about the same charge, twenty minutes away from the push
    // in either order — beyond both the two-minute and the lagged window.
    const { parseSms } = require('./build/sms-parser.js');
    const smsBody = 'Your Cr.Card XXX2518 was used for AED290.00 on 25/09/2026 17:38:39 at SOUTHERN FRIED CHICK,Sharjah-AE. Avl Cr.Limit is AED58823.09';
    const smsAt = (ts) => ({ ...parseSms(smsBody, {}, { sender: 'ADCBAlert', observedAt: ts }),
      smsTs: ts, sender: 'ADCBAlert', channel: 'inbox' });
    const smsLedger = stored(buildImportPlan([smsAt(firstPost - 20 * 60_000)], baseLedgerState(), firstPost));
    const pushAfterSms = await scanCopies(copies);
    ok('an SMS stored 20 minutes earlier explains every push copy of the same stated event',
      smsLedger.transactions.length === 1 &&
        buildImportPlan(pushAfterSms.parsed, smsLedger, pushAfterSms.newestTs).batch.transactions.length === 0,
      JSON.stringify(smsLedger.transactions));
    const smsLater = buildImportPlan([smsAt(firstPost + 20 * 60_000)], ledger, firstPost + 20 * 60_000);
    ok('an SMS arriving 20 minutes after the stored push replaces it instead of adding a row',
      smsLater.batch.transactions.length === 0 &&
        smsLater.batch.updates.some((update) => update.id === 'row-0' && update.viaPush === false),
      JSON.stringify(smsLater.batch));

    // Rows a racing drain already stored twice: the repair keeps the first,
    // folds only a copy of the same stated event, and never an edited row.
    const pushRow = ledger.transactions[0];
    const copyRow = { ...pushRow, id: 'row-copy', ts: 1790343684541, smsKey: 's1790343684541-29000' };
    ok('repair: a stored push copy of the same stated event folds into the first row',
      reconcileCaptureDuplicates([pushRow, copyRow]).map((row) => row.id).join() === 'row-0');
    ok('repair: an edited copy is kept, never removed',
      reconcileCaptureDuplicates([pushRow, { ...copyRow, userEdited: true, title: 'Lunch' }])
        .some((row) => row.title === 'Lunch'));
    ok('repair: two edited copies both stay',
      reconcileCaptureDuplicates([{ ...pushRow, userEdited: true }, { ...copyRow, userEdited: true }]).length === 2);
    const genuineRow = { ...copyRow, id: 'row-genuine',
      captureEventIdentity: buildImportPlan(genuineLater.parsed, baseLedgerState(), genuineLater.newestTs)
        .batch.transactions[0].captureEventIdentity };
    ok('repair: a genuine charge with another stated second is never folded',
      reconcileCaptureDuplicates([pushRow, genuineRow]).length === 2 &&
        genuineRow.captureEventIdentity !== pushRow.captureEventIdentity);
  }

  // The default SMS app re-announces every bank SMS. While Wafra can read
  // SMS itself, a Messages notification is a second copy: it must neither
  // import, reach Review, nor ride an earlier Review approval that "learned"
  // the package. Chat apps carry money-looking text from anyone.
  const messagingAlert = 'Purchase of AED 50.00 at CARREFOUR with Debit Card ending 1234';
  const messagingRows = (smsAppClass) => [{
    id: 'messages-app-bank-sms-0001',
    pkg: 'com.google.android.apps.messaging',
    appLabel: 'Messages',
    title: 'ADCB',
    text: messagingAlert,
    ts: NOW + 5_300,
    sourceClass: smsAppClass,
  }, {
    id: 'whatsapp-money-chat-0001',
    pkg: 'com.whatsapp',
    appLabel: 'WhatsApp',
    title: 'Bank',
    text: messagingAlert,
    ts: NOW + 5_310,
    sourceClass: 'messaging-review',
  }, {
    id: 'unseen-play-bank-control-01',
    pkg: 'com.example.unseenbank',
    appLabel: 'Unseen',
    title: 'Unseen',
    text: 'Card purchase CAD 24.90 at LOCAL CAFE.',
    ts: NOW + 5_320,
    sourceClass: 'financial-candidate',
  }];
  const originalSmsCheck = reactNative.PermissionsAndroid.check;
  for (const smsAppClass of ['messaging-review', 'financial-candidate']) {
    reactNative.PermissionsAndroid.check = async () => true;
    notificationRows = messagingRows(smsAppClass);
    const withSms = await scanInbox(0, {}, undefined, 'en-AE', {
      notificationOnly: true,
      learnedNotificationPackages: ['com.google.android.apps.messaging'],
    });
    const withSmsDiagnostics = getAndroidNotificationImportDiagnostics();
    ok(`with READ_SMS, messaging-app rows (${smsAppClass}) never import or reach Review, even for a learned package`,
      withSms.parsed.length === 0 &&
        withSms.reviewCandidates.length === 1 &&
        withSms.reviewCandidates[0].observedAt === NOW + 5_320 &&
        withSmsDiagnostics?.ignored === 2,
      JSON.stringify({ withSms, withSmsDiagnostics }));
    const ackBeforeMessaging = acknowledgedNotifications.length;
    await withSms.commit();
    ok(`with READ_SMS, messaging-app rows (${smsAppClass}) are acknowledged out of the encrypted queue`,
      acknowledgedNotifications.slice(ackBeforeMessaging).includes('messages-app-bank-sms-0001') &&
        acknowledgedNotifications.slice(ackBeforeMessaging).includes('whatsapp-money-chat-0001'),
      JSON.stringify(acknowledgedNotifications.slice(ackBeforeMessaging)));

    // Without READ_SMS the Messages notification is the user's only route
    // to their bank SMS. It goes to Review — never straight to the ledger,
    // never carrying a package identity Review could learn to trust — and a
    // chat app still goes nowhere.
    reactNative.PermissionsAndroid.check = async () => false;
    notificationRows = messagingRows(smsAppClass);
    const withoutSms = await scanInbox(0, {}, undefined, 'en-AE', {
      notificationOnly: true,
      learnedNotificationPackages: ['com.google.android.apps.messaging'],
    });
    const messagesReview = withoutSms.reviewCandidates.find((item) => item.observedAt === NOW + 5_300);
    ok(`without READ_SMS, a Messages bank SMS (${smsAppClass}) reaches Review only, as an unlearnable source`,
      withoutSms.parsed.length === 0 && !!messagesReview &&
        messagesReview.channel === 'push' &&
        messagesReview.sourcePackage === undefined && messagesReview.sourceClass === undefined &&
        !withoutSms.reviewCandidates.some((item) => item.observedAt === NOW + 5_310),
      JSON.stringify(withoutSms.reviewCandidates));
    const ackBeforeReview = acknowledgedNotifications.length;
    await withoutSms.commit();
    ok(`without READ_SMS, the reviewed Messages row (${smsAppClass}) and the chat row are acknowledged`,
      acknowledgedNotifications.slice(ackBeforeReview).includes('messages-app-bank-sms-0001') &&
        acknowledgedNotifications.slice(ackBeforeReview).includes('whatsapp-money-chat-0001'),
      JSON.stringify(acknowledgedNotifications.slice(ackBeforeReview)));
  }
  reactNative.PermissionsAndroid.check = originalSmsCheck;

  notificationRows = [{
    id: 'hostile-notification-0001',
    pkg: 'com.example.chat',
    appLabel: 'Friends Chat',
    title: 'Friends',
    text: 'Purchase of AED 50.00 at CARREFOUR with Debit Card ending 1234',
    ts: NOW + 5_500,
  }];
  const hostile = await scanInbox(0, {}, undefined, 'en-AE');
  await hostile.commit();
  ok('an untrusted Play financial candidate cannot auto-post and is review-only',
    hostile.parsed.length === 0 && hostile.reviewCandidates.length === 1 &&
      hostile.reviewCandidates[0]?.kind === 'universal' &&
      hostile.reviewCandidates[0]?.sourcePackage === 'com.example.chat' &&
      hostile.reviewCandidates[0]?.sourceClass === 'financial-candidate' &&
      acknowledgedNotifications.includes('hostile-notification-0001'),
    JSON.stringify({ hostile, acknowledgedNotifications }));

  notificationRows = [{
    id: 'power-bank-monitor-0001',
    pkg: 'com.example.powerbankmonitor',
    appLabel: 'Power Bank Monitor',
    title: 'Battery status',
    text: 'Purchase of AED 51.00 at CARREFOUR with Debit Card ending 1234',
    ts: NOW + 5_650,
  }];
  const fakeBankLabel = await scanInbox(0, {}, undefined, 'en-AE', { notificationOnly: true });
  await fakeBankLabel.commit();
  ok('a non-financial app label containing the word bank cannot gain automatic trust',
    fakeBankLabel.parsed.length === 0 && fakeBankLabel.reviewCandidates.length === 1 &&
      fakeBankLabel.reviewCandidates[0]?.sourcePackage === 'com.example.powerbankmonitor' &&
      fakeBankLabel.reviewCandidates[0]?.sourceClass === 'financial-candidate',
    JSON.stringify(fakeBankLabel));

  notificationRows = [{
    id: 'noncurated-adib-0001',
    pkg: 'com.example.adibmobile',
    appLabel: 'ADIB',
    title: 'ADIB',
    text: 'Purchase of AED 61.25 at CARREFOUR with Debit Card ending 1234',
    ts: NOW + 5_750,
  }];
  const nonCuratedBank = await scanInbox(0, {}, undefined, 'en-AE', { notificationOnly: true });
  ok('a non-curated bank with strong installed app identity auto-imports on first sight',
    nonCuratedBank.parsed.length === 1 && nonCuratedBank.reviewCandidates.length === 0 &&
      nonCuratedBank.parsed[0]?.amountFils === 6125 && nonCuratedBank.parsed[0]?.merchant === 'Carrefour',
    JSON.stringify(nonCuratedBank));
  await nonCuratedBank.commit();
  ok('the first non-curated bank transaction is acknowledged only after the normal commit boundary',
    acknowledgedNotifications.includes('noncurated-adib-0001'),
    JSON.stringify(acknowledgedNotifications));

  notificationRows = [{
    id: 'noncurated-adib-0002',
    pkg: 'com.example.adibmobile',
    title: 'ADIB',
    text: 'Purchase of AED 62.50 at CARREFOUR with Debit Card ending 1234',
    ts: NOW + 5_900,
  }];
  const learnedBank = await scanInbox(0, {}, undefined, 'en-AE', { notificationOnly: true });
  ok('the same non-curated verified bank keeps auto-posting future confident transactions',
    learnedBank.parsed.length === 1 && learnedBank.reviewCandidates.length === 0 &&
      learnedBank.parsed[0]?.amountFils === 6250 && learnedBank.parsed[0]?.merchant === 'Carrefour',
    JSON.stringify(learnedBank));
  await learnedBank.commit();

  const ackBeforeAmbiguousTrusted = acknowledgedNotifications.length;
  notificationRows = [{
    id: 'trusted-unrecognized-0001',
    pkg: 'ae.hsbc.hsbcuae',
    title: 'HSBC UAE',
    text: 'AED 42.00 reference updated',
    ts: NOW + 5_950,
  }];
  const unresolvedTrusted = await scanInbox(0, {}, undefined, 'en-AE', { notificationOnly: true });
  const trustedReviewDiagnostics = getAndroidNotificationImportDiagnostics();
  ok('a terse money-bearing trusted-bank parser miss falls back to Review instead of becoming invisible',
    unresolvedTrusted.parsed.length === 0 && unresolvedTrusted.reviewCandidates.length === 1 &&
      unresolvedTrusted.reviewCandidates[0]?.kind === 'universal' &&
      unresolvedTrusted.reviewCandidates[0]?.sourcePackage === 'ae.hsbc.hsbcuae' &&
      unresolvedTrusted.reviewCandidates[0]?.sourceClass === 'trusted-bank' &&
      trustedReviewDiagnostics?.review === 1 &&
      trustedReviewDiagnostics?.unresolved === 0 &&
      trustedReviewDiagnostics?.unresolvedParserMiss === 0 &&
      acknowledgedNotifications.length === ackBeforeAmbiguousTrusted,
    JSON.stringify({ unresolvedTrusted, trustedReviewDiagnostics, acknowledgedNotifications }));
  await unresolvedTrusted.commit();
  ok('the trusted-bank Review row is acknowledged only after its durable commit boundary',
    acknowledgedNotifications.length === ackBeforeAmbiguousTrusted + 1 &&
      acknowledgedNotifications.includes('trusted-unrecognized-0001'),
    JSON.stringify({ unresolvedTrusted, acknowledgedNotifications }));
  const firstUnresolvedAttempt = getAndroidNotificationImportDiagnostics();
  const unresolvedRetry = await scanInbox(0, {}, undefined, 'en-AE', { notificationOnly: true });
  const secondUnresolvedAttempt = getAndroidNotificationImportDiagnostics();
  ok('a committed trusted-bank Review row is safe if a native test double returns it again',
    firstUnresolvedAttempt?.review === 1 &&
      secondUnresolvedAttempt?.review === 1 &&
      unresolvedRetry.parsed.length === 0 && unresolvedRetry.reviewCandidates.length === 1 &&
      acknowledgedNotifications.length === ackBeforeAmbiguousTrusted + 1,
    JSON.stringify({ firstUnresolvedAttempt, secondUnresolvedAttempt }));

  const hsbcTitle = 'Your credit card transaction is approved';
  const hsbcPurchase = 'Your Credit Card ending with *** 1234 has been used for AED 42.00 on 11/09/2026 17:10:20 at SAMPLE RESTAURANT. Your available limit is AED 5,000.00.';
  notificationRows = [
    { id: 'hsbc-uae-purchase-0001', pkg: 'ae.hsbc.hsbcuae', title: hsbcTitle,
      text: hsbcPurchase, ts: NOW + 6_000 },
    { id: 'hsbc-uae-limit-000001', pkg: 'ae.hsbc.hsbcuae', title: 'HSBC UAE',
      text: 'Your available limit is AED 5,000.00.', ts: NOW + 7_000 },
    { id: 'hsbc-uae-offer-000001', pkg: 'ae.hsbc.hsbcuae', title: 'HSBC UAE',
      text: 'Get AED 50 cashback on your next card purchase.', ts: NOW + 8_000 },
    { id: 'hsbc-uae-otp-0000001', pkg: 'ae.hsbc.hsbcuae', title: 'HSBC UAE',
      text: 'OTP 123456 for an AED 42.00 card transaction.', ts: NOW + 9_000 },
    { id: 'hsbc-eg-imitator-0001', pkg: 'com.htsu.hsbcpersonalbanking',
      appLabel: 'Generic Alerts', title: hsbcTitle, text: hsbcPurchase, ts: NOW + 10_000 },
  ];
  const inboxReadsBeforePush = inboxReadCursors.length;
  const hsbcOnly = await scanInbox(0, {}, undefined, 'en-AE', { notificationOnly: true });
  ok('HSBC UAE push-only capture imports one purchase while unknown finance apps stay review-only',
    inboxReadCursors.length === inboxReadsBeforePush && !hsbcOnly.inboxHistoryComplete &&
      hsbcOnly.parsed.length === 1 && hsbcOnly.parsed[0].channel === 'push' &&
      hsbcOnly.parsed[0].amountFils === 4200 &&
      hsbcOnly.parsed[0].merchant === 'Sample Restaurant' &&
      hsbcOnly.reviewCandidates.some(row => row.kind === 'universal' &&
        row.sourcePackage === 'ae.hsbc.hsbcuae' &&
        row.event.family === 'balance' && row.event.status === 'informational') &&
      hsbcOnly.reviewCandidates.some(row => row.kind === 'universal' &&
        row.sourcePackage === 'com.htsu.hsbcpersonalbanking' &&
        row.sourceClass === 'financial-candidate') &&
      !hsbcOnly.reviewCandidates.some(row => row.observedAt === NOW + 8_000) &&
      hsbcOnly.parsed.every(row => row.amountFils !== 500000 && row.amountFils !== 5000),
    JSON.stringify({ parsed: hsbcOnly.parsed, reviews: hsbcOnly.reviewCandidates }));
  const ackBeforeHsbc = acknowledgedNotifications.length;
  await hsbcOnly.commit();
  ok('trusted HSBC rows and review-only finance candidates are acknowledged after durability',
    acknowledgedNotifications.length === ackBeforeHsbc + 5 &&
      acknowledgedNotifications.includes('hsbc-eg-imitator-0001'),
    JSON.stringify(acknowledgedNotifications));

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
  ok('a second explicit salary is another exact automatic income event',
    nextSalary.parsed.length === 1 && nextSalary.reviewCandidates.length === 0 &&
      nextSalary.parsed[0]?.merchant === 'Salary' &&
      nextSalary.parsed[0]?.type === 'income' && nextSalary.parsed[0]?.amountFils === 910000,
    JSON.stringify(nextSalary));

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

  // The owner's FAB salary field list, verbatim (account masked by them). It
  // used to parse as an uncategorised "Account credit", which
  // shouldReviewParsedIncome sends to Review, so the salary never posted.
  inboxRows = [{
    address: 'FAB',
    body: 'Salary Credit\nAccount XXXX0002\nAED 28500.00\n26/09/2026\nBalance AED 28965.77',
    // Received on the day it states: a field-list date later than the
    // received day is refused as a posting date, so the fixture's synthetic
    // NOW (August) cannot carry a September salary.
    date: Date.UTC(2026, 8, 26, 6, 0, 0),
  }];
  const fabFieldSalary = await scanInbox(0, {}, undefined, 'en-AE');
  ok('a FAB field-list salary credit posts as Salary income on its stated date, not Review',
    fabFieldSalary.parsed.length === 1 && fabFieldSalary.reviewCandidates.length === 0 &&
      fabFieldSalary.parsed[0]?.merchant === 'Salary' &&
      fabFieldSalary.parsed[0]?.categoryGuess === 'salary' &&
      fabFieldSalary.parsed[0]?.type === 'income' &&
      fabFieldSalary.parsed[0]?.amountFils === 2850000 &&
      fabFieldSalary.parsed[0]?.date === '2026-09-26' &&
      fabFieldSalary.parsed[0]?.card?.last4 === '0002' &&
      fabFieldSalary.parsed[0]?.snapshotFils === 2896577,
    JSON.stringify(fabFieldSalary));

  {
    // The owner's device: an older parser parked this salary in Review, Review
    // then lost it, and the watermark had already moved past it. v54 reads it
    // as Salary, but the routine scan starts after lastScanTs and never sees
    // it again. The one-time recent-window re-read (capture.ts) must add it
    // exactly once and re-add nothing the ledger already holds.
    const { buildImportPlan } = require('./build/import-plan.js');
    const { materializeImportBatch, applyMaterializedImportBatch } = require('./build/ledger-import.js');
    const salaryAt = Date.UTC(2026, 8, 26, 2, 47, 36);
    inboxRows = [
      { id: 41_001, address: 'ADCB', body: uae, date: salaryAt - 3 * 60 * 60 * 1000 },
      { id: 41_002, address: 'FAB',
        body: 'Salary Credit\nAccount XXXX0002\nAED 28500.00\n26/09/2026\nBalance AED 28965.77', date: salaryAt },
      { id: 41_003, address: 'ADCB', body: uae.replace('50.00', '75.00'), date: salaryAt + 5 * 60 * 60 * 1000 },
    ];
    let ids = 0;
    const commit = (state, batch) => applyMaterializedImportBatch(state,
      materializeImportBatch(batch, state, (prefix) => `${prefix}-recovery-${ids++}`));
    // What survived on the phone: both purchases, no salary, cursor past it.
    const firstScan = await scanInbox(0, {}, undefined, 'en-AE');
    const survived = firstScan.parsed.filter((row) => row.sourceEventId !== 'a41002');
    let ledger = commit(baseLedgerState(),
      buildImportPlan(survived, baseLedgerState(), salaryAt + 5 * 60 * 60 * 1000).batch);
    ok('recovery fixture: the ledger starts with both purchases and no salary',
      ledger.transactions.length === 2 && !ledger.transactions.some((t) => t.category === 'salary') &&
        ledger.lastScanTs === salaryAt + 5 * 60 * 60 * 1000,
      JSON.stringify(ledger.transactions));
    const routine = await scanInbox(ledger.lastScanTs + 1, {}, undefined, 'en-AE');
    ok('recovery fixture: the routine watermark never reads the lost salary again',
      routine.parsed.length === 0 && routine.reviewCandidates.length === 0, JSON.stringify(routine.parsed));

    const floor = salaryAt + 6 * 60 * 60 * 1000 - 14 * 24 * 60 * 60 * 1000;
    const reread = await scanInbox(floor, {}, undefined, 'en-AE');
    const recovery = buildImportPlan(reread.parsed, ledger, reread.newestTs, new Date(salaryAt + 6 * 60 * 60 * 1000),
      reread.declined);
    ok('the recent re-read adds the lost salary once and neither purchase again',
      recovery.txCount === 1 && recovery.batch.transactions[0]?.category === 'salary' &&
        recovery.batch.transactions[0]?.type === 'income' &&
        recovery.batch.transactions[0]?.amountFils === 2850000 &&
        recovery.batch.transactions[0]?.date === '2026-09-26' &&
        !recovery.batch.updates.some((update) => update.remove),
      JSON.stringify({ txs: recovery.batch.transactions, updates: recovery.batch.updates }));
    ledger = commit(ledger, { ...recovery.batch, recentRereadParserVersion: 54 });
    ok('the re-read receipt lands with its rows and never rewinds the watermark',
      ledger.recentRereadParserVersion === 54 && ledger.lastScanTs === salaryAt + 5 * 60 * 60 * 1000 &&
        ledger.transactions.filter((t) => t.category === 'salary').length === 1,
      JSON.stringify({ receipt: ledger.recentRereadParserVersion, lastScanTs: ledger.lastScanTs }));
    const again = await scanInbox(floor, {}, undefined, 'en-AE');
    const second = buildImportPlan(again.parsed, ledger, again.newestTs, new Date(salaryAt + 6 * 60 * 60 * 1000),
      again.declined);
    ok('re-reading the same window again posts nothing twice',
      second.txCount === 0 && !second.batch.updates.some((update) => update.remove),
      JSON.stringify(second.batch.transactions));
    const older = commit(ledger, { ...second.batch, recentRereadParserVersion: 53 });
    ok('an older re-read receipt can never replace a newer one', older.recentRereadParserVersion === 54);
  }

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
  ok('review ids are keyed to the erase-managed SQLCipher identity while native aliases stay exact',
    afterKeyRotation.reviewCandidates[0]?.id !== first.reviewCandidates[0]?.id &&
      afterKeyRotation.reviewCandidates[0]?.sourceKey === first.reviewCandidates[0]?.sourceKey,
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
    ambiguousGlobal.parsed.length === 0 && ambiguousGlobal.reviewCandidates.length === 2 &&
      ambiguousGlobal.reviewCandidates.every((item) => item.kind === 'universal'),
    JSON.stringify(ambiguousGlobal));

  notificationsEnabled = true;
  inboxRows = Array.from({ length: 50 }, (_, index) => ({
    address: 'BNPPARIBAS',
    body: `BNP Paribas: Paiement par carte débité de EUR ${index + 1},00 chez STORE-${index}`,
    date: NOW - 100_000 + index,
  }));
  notificationRows = [{
    id: 'unknown-global-review-0001',
    pkg: 'com.example.globalbank',
    appLabel: 'Generic Alerts',
    title: 'Global Bank',
    text: 'Card purchase EUR 77.00 at NEW SHOP',
    ts: NOW + 5_600,
  }];
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
  const sameTimestampIds = new Set(sameTimestamp.parsed.map((item) => item.sourceEventId));
  ok('same-timestamp same-value Android alerts retain distinct provider identities',
    sameTimestamp.parsed.length === 2 &&
      sameTimestampIds.has('a901') && sameTimestampIds.has('a902'),
    JSON.stringify(sameTimestamp.parsed));

  const duplicatedProviderBody =
    'Purchase of AED 14.05 at DUPLICATE CONTROL with Debit Card ending 1234';
  inboxRows = [
    { id: 30_850, address: 'FAB', body: duplicatedProviderBody, date: NOW + 10_000 },
    { id: 30_849, address: 'FAB', body: duplicatedProviderBody, date: NOW + 9_244 },
    // Same real-looking alert after the strict sub-second window is a distinct
    // event and must remain visible even though its body is byte-identical.
    { id: 30_848, address: 'FAB', body: duplicatedProviderBody, date: NOW + 7_000 },
  ];
  const providerDuplicate = await scanInbox(0, {}, undefined, 'en-AE');
  const providerDuplicateIds = new Set(
    providerDuplicate.parsed.map((item) => item.sourceEventId),
  );
  ok('byte-identical consecutive Android provider rows within one second collapse once',
    providerDuplicate.parsed.length === 2 &&
      providerDuplicateIds.has('a30850') && providerDuplicateIds.has('a30848') &&
      providerDuplicate.declined.some((item) =>
        item.sourceEventId === 'a30849' && item.reason === 'exact-provider-duplicate') &&
      providerDuplicate.declined.every((item) =>
        !Object.prototype.hasOwnProperty.call(item, 'raw')),
    JSON.stringify({ parsed: providerDuplicate.parsed, declined: providerDuplicate.declined }));

  // Carrier double delivery: the provider stores one SMS twice, minutes apart
  // and with unrelated ids. Fold it only when the body carries something a
  // second genuine charge could not share word for word — never a bare hh:mm.
  const tokenCases = require('./fixtures/distinguishing-token-cases');
  tokenCases.forEach(([body, fold], index) => {
    ok(`JS carrier-duplicate identity rule says ${fold} for case ${index + 1}`,
      hasCarrierDuplicateIdentity(body) === fold, body);
  });
  const carrierScan = async (rows) => {
    inboxRows = rows;
    const scan = await scanInbox(0, {}, undefined, 'en-AE');
    const ids = new Set(scan.parsed.map((item) => item.sourceEventId));
    return { scan, ids };
  };
  const withBalance =
    'Purchase of AED 14.05 at CARRIER CONTROL with Debit Card ending 1234. Avl Bal AED 2,345.67';
  const noToken = 'Purchase of AED 14.05 at CARRIER CONTROL with Debit Card ending 1234';
  const other = 'Purchase of AED 3.00 at OTHER SHOP with Debit Card ending 1234';
  {
    const { scan, ids } = await carrierScan([
      { id: 31_900, address: 'FAB', body: withBalance, date: NOW + 600_000 },
      { id: 31_880, address: 'FAB', body: other, date: NOW + 400_000 },
      { id: 31_870, address: 'FAB', body: withBalance, date: NOW + 360_000 },
    ]);
    // The EARLIER copy is kept — the one a previous scan may already have
    // stored — and the fold never emits a retirement for either copy.
    ok('a carrier re-delivery minutes later with a balance figure is one message',
      ids.has('a31870') && ids.has('a31880') && !ids.has('a31900') &&
        scan.parsed.filter((item) => item.sourceEventId === 'a31870')[0]?.amountFils === 1405 &&
        !scan.declined.some((item) => item.sourceEventId === 'a31900' ||
          item.sourceEventId === 'a31870'),
      JSON.stringify({ parsed: scan.parsed, declined: scan.declined }));
  }
  {
    // Shipped fixture adib-compact-masked-card: its only clock is hh:mm. A
    // double tap or a merchant charging twice in one minute reads identically
    // and both charges are real.
    const adib = 'XXX456789 was used for AED 42.50 on Jan 17 2023 1:04PM at CARREFOUR,AE.';
    const { scan, ids } = await carrierScan([
      { id: 31_930, address: 'ADIB', body: adib, date: NOW + 640_000 },
      { id: 31_920, address: 'ADIB', body: adib, date: NOW + 600_000 },
    ]);
    ok('two same-minute charges whose only clock is hh:mm both survive',
      ids.has('a31930') && ids.has('a31920') && scan.declined.length === 0,
      JSON.stringify({ parsed: scan.parsed, declined: scan.declined }));
  }
  {
    // A ledger that already stored both copies before this fold existed is
    // left alone: the rescan declines nothing and so retires nothing.
    const { buildImportPlan } = require('./build/import-plan.js');
    const both = await carrierScan([
      { id: 31_910, address: 'FAB', body: withBalance, date: NOW + 700_000 },
      { id: 31_905, address: 'FAB', body: withBalance, date: NOW + 460_000 },
    ]);
    const firstImport = buildImportPlan(
      both.scan.parsed.map((item) => ({ ...item, sourceEventId: 'a31910', smsTs: NOW + 700_000 }))
        .concat(both.scan.parsed), baseLedgerState(), NOW + 700_000,
    );
    const stored = { ...baseLedgerState(), transactions: firstImport.batch.transactions
      .map((row, index) => ({ ...row, id: `stored-${index}` })) };
    const reread = buildImportPlan(both.scan.parsed, stored, NOW + 700_000, undefined, both.scan.declined);
    ok('the carrier fold never removes a row the ledger already holds',
      stored.transactions.length === 2 && both.scan.declined.length === 0 &&
        !reread.batch.updates.some((update) => update.remove),
      JSON.stringify({ stored: stored.transactions.length, updates: reread.batch.updates }));
  }
  {
    // The 1-second provider-duplicate retirement still exists; it must not
    // remove a row that is part of a transfer, whatever its evidence says.
    const { buildImportPlan } = require('./build/import-plan.js');
    const row = { ...(await carrierScan([
      { id: 31_960, address: 'FAB', body: noToken, date: NOW + 900_000 },
    ])).scan.parsed[0] };
    const imported = buildImportPlan([row], baseLedgerState(), NOW + 900_000).batch.transactions[0];
    const retire = [{ smsTs: NOW + 900_000, sender: 'FAB', channel: 'inbox',
      sourceEventId: 'a31960', reason: 'exact-provider-duplicate' }];
    const planFor = (extra) => buildImportPlan([], { ...baseLedgerState(),
      transactions: [{ ...imported, id: 'provider-dup', ...extra }] }, NOW + 900_000, undefined, retire);
    ok('a provider-duplicate retirement still removes an ordinary stored copy',
      planFor({}).batch.updates.some((update) => update.id === 'provider-dup' && update.remove),
      JSON.stringify(planFor({}).batch.updates));
    ok('a provider-duplicate retirement never removes a transfer or transfer-matched row',
      !planFor({ isTransfer: true }).batch.updates.some((update) => update.remove) &&
        !planFor({ transferMatch: { kind: 'own-account', counterpartId: 'other', matchedAt: NOW } })
          .batch.updates.some((update) => update.remove),
      JSON.stringify([planFor({ isTransfer: true }).batch.updates,
        planFor({ transferMatch: { kind: 'own-account' } }).batch.updates]));
  }
  {
    const { scan, ids } = await carrierScan([
      { id: 31_950, address: 'FAB', body: noToken, date: NOW + 600_000 },
      { id: 31_940, address: 'FAB', body: noToken, date: NOW + 360_000 },
    ]);
    ok('two identical charges with nothing to tell them apart both survive',
      ids.has('a31950') && ids.has('a31940') &&
        !scan.declined.some((item) => item.sourceEventId === 'a31940'),
      JSON.stringify({ parsed: scan.parsed, declined: scan.declined }));
  }
  {
    const { ids } = await carrierScan([
      { id: 31_990, address: 'FAB', body: withBalance, date: NOW + 1_260_000 },
      { id: 31_980, address: 'FAB', body: withBalance, date: NOW + 600_000 },
    ]);
    ok('an identical balance-bearing body eleven minutes later is a separate message',
      ids.has('a31990') && ids.has('a31980'), JSON.stringify([...ids]));
  }
  {
    const { ids } = await carrierScan([
      { id: 32_010, address: 'FAB', body: withBalance, date: NOW + 600_000 },
      { id: 32_000, address: 'ADCB', body: withBalance, date: NOW + 540_000 },
    ]);
    ok('an identical body from a different sender is never folded',
      ids.has('a32010') && ids.has('a32000'), JSON.stringify([...ids]));
  }
  {
    inboxRows = [];
    receivedRows = [
      { address: 'FAB', body: withBalance, date: NOW + 600_000 },
      { address: 'FAB', body: withBalance, date: NOW + 780_000 },
      { address: 'FAB', body: noToken, date: NOW + 600_000 },
      { address: 'FAB', body: noToken, date: NOW + 780_000 },
    ];
    const scan = await scanInbox(0, {}, undefined, 'en-AE');
    const delivered = scan.parsed.filter((item) => item.channel === 'delivery');
    ok('the delivery buffer folds the same carrier re-delivery and keeps tokenless repeats',
      delivered.filter((item) => item.smsTs === NOW + 600_000).length === 2 &&
        delivered.filter((item) => item.smsTs === NOW + 780_000).length === 1,
      JSON.stringify(delivered));
    receivedRows = [];
  }

  inboxRows = Array.from({ length: 1001 }, (_, index) => ({
    id: 2_000 + index,
    address: 'ADCB',
    body: `Purchase of AED 1.00 at PAGE SHOP ${index} with Debit Card ending 1234`,
    date: NOW + 20_000 + index,
  }));
  receivedRows = [];
  notificationsEnabled = false;
  inboxReadCursors.length = 0;
  const multipage = await scanInbox(0, {}, undefined, 'en-AE');
  ok('a full inbox page continues until the provider proves end of history',
    multipage.inboxScannedCount === 1001 && multipage.inboxHistoryComplete === true &&
      inboxReadCursors.length === 2 && inboxReadCursors[0].max === 1000,
    JSON.stringify({
      count: multipage.inboxScannedCount,
      complete: multipage.inboxHistoryComplete,
      pages: inboxReadCursors.length,
    }));

  inboxReadCursors.length = 0;
  const firstResumablePage = await scanInbox(
    0,
    {},
    undefined,
    'en-AE',
    { maxInboxPages: 1 },
  );
  ok('a resumable scan returns after one bounded provider page',
    firstResumablePage.inboxScannedCount === 1000 &&
      firstResumablePage.inboxHistoryComplete === false &&
      firstResumablePage.nextCursor?.beforeId === 2_002 &&
      inboxReadCursors.length === 1,
    JSON.stringify({
      count: firstResumablePage.inboxScannedCount,
      complete: firstResumablePage.inboxHistoryComplete,
      cursor: firstResumablePage.nextCursor,
      reads: inboxReadCursors,
    }));
  const secondResumablePage = await scanInbox(
    0,
    {},
    undefined,
    'en-AE',
    { maxInboxPages: 1, cursor: firstResumablePage.nextCursor },
  );
  const resumableIds = new Set([
    ...firstResumablePage.parsed,
    ...secondResumablePage.parsed,
  ].map((item) => item.sourceEventId));
  ok('the next resumable page overlaps one row and still reaches history end losslessly',
    secondResumablePage.inboxScannedCount === 2 &&
      secondResumablePage.inboxHistoryComplete === true &&
      secondResumablePage.nextCursor === null &&
      resumableIds.size === 1001,
    JSON.stringify({
      count: secondResumablePage.inboxScannedCount,
      complete: secondResumablePage.inboxHistoryComplete,
      cursor: secondResumablePage.nextCursor,
      unique: resumableIds.size,
    }));

  inboxReadCursors.length = 0;
  const largerHistoryPage = await scanInbox(
    0,
    {},
    undefined,
    'en-AE',
    { maxInboxPages: 1, pageSize: 2000 },
  );
  ok('history scans can request the larger bounded provider page without changing ordinary defaults',
    largerHistoryPage.inboxScannedCount === 1001 &&
      largerHistoryPage.inboxHistoryComplete === true &&
      inboxReadCursors.length === 1 && inboxReadCursors[0].max === 2000,
    JSON.stringify({
      count: largerHistoryPage.inboxScannedCount,
      complete: largerHistoryPage.inboxHistoryComplete,
      reads: inboxReadCursors,
    }));

  // The existing synthetic Chase fixture is newly discovered by a full
  // history scan. Its old event date must not consume the review window.
  inboxRows = [{ id: 9001, address: 'CHASE', body: chase,
    date: NOW - 90 * 24 * 60 * 60 * 1000 }];
  receivedRows = [];
  notificationsEnabled = false;
  const discoveredAt = Date.now();
  const oldDiscovery = await scanInbox(0, {}, undefined, 'en-AE');
  ok('newly discovered Android history receives a full review window',
    oldDiscovery.reviewCandidates.length === 1 &&
      oldDiscovery.reviewCandidates[0].observedAt === inboxRows[0].date &&
      oldDiscovery.reviewCandidates[0].expiresAt >= discoveredAt + 30 * 24 * 60 * 60 * 1000,
    JSON.stringify(oldDiscovery.reviewCandidates));

  // Reuse the universal extractor's explicitly synthetic structural probes.
  // These are review suggestions, never evidence of a supported bank template.
  inboxRows = [
    { id: 9100, address: 'UNLISTED-BANK', date: NOW,
      body: 'Card purchase CAD 24.90 at MAPLE CAFE on 2026-09-05. Available balance CAD 500.00.' },
    { id: 9101, address: 'UNLISTED-BANK', date: NOW + 1,
      body: 'Credit card statement. Minimum due AED 25.00. Due date 2026-09-25.' },
    { id: 9102, address: 'UNLISTED-BANK', date: NOW + 2,
      body: 'Credit card statement. Minimum due SAR 25.00. Due date 2026-09-25.' },
    { id: 9103, address: 'ALEX', date: NOW + 3, body: 'I paid USD 24.90 for dinner.' },
    { id: 9104, address: 'UNLISTED-BANK', date: NOW + 4,
      body: 'Card purchase CAD 24.90 at LOCAL CAFE requires OTP123456.' },
    { id: 9105, address: 'UNLISTED-BANK', date: NOW + 5,
      body: 'Card purchase CAD 24.90 at LOCAL CAFE.' },
    { id: 9106, address: 'UNLISTED-BANK', date: NOW + 6,
      body: 'Card purchase AED 24,90 at LOCAL CAFE on 2026-09-05.' },
    { id: 9107, address: 'UNLISTED-BANK', date: NOW + 7,
      body: 'Card purchase SAR 24,90 at LOCAL CAFE on 2026-09-05.' },
    { id: 9108, address: 'UNLISTED-BANK', date: NOW + 8,
      body: 'Card purchase JPY 2400 at LOCAL CAFE on 2026-09-05.' },
    { id: 9109, address: 'UNLISTED-BANK', date: NOW + 9,
      body: 'Card purchase KWD 12٫345 at LOCAL CAFE on 2026-09-05.' },
  ];
  receivedRows = [];
  notificationsEnabled = false;
  const generic = await scanInbox(0, {}, undefined, 'en-AE');
  const suggestions = generic.reviewCandidates.filter((item) => item.kind === 'universal');
  ok('unregistered global alerts and UAE/Saudi statement misses reach review without automatic rows',
    suggestions.length === 8 && generic.parsed.length === 0, JSON.stringify(generic));
  const purchaseSuggestion = suggestions.find((item) => item.sourceKey === 'android_message_review_source_a9100');
  ok('Android universal suggestion preserves exact source identity and native currency',
    purchaseSuggestion?.event.amount.value?.currency === 'CAD' &&
      purchaseSuggestion.event.amount.value.minorUnits === '2490');
  ok('minimum-only local statements remain informational facts with an unknown total',
    suggestions.filter((item) => item.event.family === 'statement').length === 2 &&
      suggestions.filter((item) => item.event.family === 'statement').every((item) =>
        item.event.amount.value === null && item.event.statementTotal.value === null));
  ok('validated generic extraction improves AED and SAR transaction misses as review only',
    ['AED', 'SAR'].every((currency) => suggestions.some((item) =>
      item.event.family === 'purchase' && item.event.amount.value?.currency === currency &&
      item.event.amount.value.minorUnits === '2490')));
  ok('generic capture preserves zero- and three-decimal source money without a ledger conversion',
    suggestions.some((item) => item.event.amount.value?.currency === 'JPY' &&
      item.event.amount.value.minorUnits === '2400' && item.event.amount.value.exponent === 0) &&
    suggestions.some((item) => item.event.amount.value?.currency === 'KWD' &&
      item.event.amount.value.minorUnits === '12345' && item.event.amount.value.exponent === 3));
  const undatedSuggestion = suggestions.find((item) => item.sourceKey === 'android_message_review_source_a9105');
  ok('receipt time never fills a missing transaction date in a universal suggestion',
    undatedSuggestion?.event.transactionDate.evidence === 'missing' &&
      undatedSuggestion.event.transactionDate.value === null);
  ok('universal review output never retains raw messages, sender or source spans',
    suggestions.every((item) => !Object.hasOwn(item, 'raw') && !Object.hasOwn(item, 'sender') &&
      !JSON.stringify(item).includes('UNLISTED-BANK') && !/"spans":\[(?!\])/.test(JSON.stringify(item))));

  const registeredBody = 'AED 2,500.00 has been credited to your account from JOHN DOE.';
  inboxRows = [{ id: 9200, address: 'FAB', date: NOW + 10, body: registeredBody }];
  const registeredCapture = await scanInbox(0, {}, undefined, 'en-AE');
  const registeredReview = registeredCapture.reviewCandidates[0];
  ok('registered bank reviews also retain their exact native provider alias',
    registeredReview?.kind !== 'universal' &&
      registeredReview?.sourceKey === 'android_message_review_source_a9200');
  if (registeredReview) {
    const state = { hydrated: true, marketId: 'AE',
      ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
      accounts: [{ id: 'review-bank', kind: 'bank', name: 'Bank', openingFils: 0 }],
      transactions: [], cardDues: [], bills: [], budgets: [], goals: [],
      accountHints: {}, merchantOverrides: {}, lastScanTs: 0,
      reviewTray: { schemaVersion: 1, pending: [registeredReview], tombstones: [], templateRules: [] } };
    const promotion = require('./build/review-promotion.js').planReviewPromotion(state, {
      reviewId: registeredReview.id, type: 'income', title: 'Confirmed transfer',
      category: 'business', accountId: 'review-bank', date: '2026-08-11', betweenOwnAccounts: false,
    }, 'confirmed-source', NOW + 20);
    const confirmed = promotion.outcome === 'added' ? promotion.transaction : null;
    ok('explicitly confirmed registered review uses the native canonical transaction identity',
      confirmed?.smsKey === `ha9200t${registeredReview.observedAt}`);
    if (confirmed) {
      const reread = { ...require('./build/sms-parser.js').parseSms(registeredBody),
        date: '2026-08-11', smsTs: NOW + 10, sender: 'FAB', channel: 'inbox', sourceEventId: 'a9200' };
      const replay = require('./build/import-plan.js').buildImportPlan([reread], {
        ...state, transactions: [confirmed], reviewTray: promotion.reviewTray,
      }, NOW + 10);
      ok('later canonical parser reread cannot duplicate a registered review confirmation',
        replay.txCount === 0 && replay.batch.updates.length === 0);
    }
  }
  const legacyIdentityFor = (body, sender, observedAt) => {
    const key = secureStore.__keychain.items.get('wafra.database.key.v1');
    const hash = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
    const derivedKey = hash(`wafra.alert-review-identity.v1\u0000${key}`);
    const material = ['inbox', String(observedAt), sender.toLowerCase(),
      body.replace(/\s+/g, ' ').trim().toLowerCase()].join('\u0000');
    const digest = hash(`${derivedKey}\u0000${material}`);
    return { id: `ari1_${digest}`, sourceKey: `arc1_${digest}` };
  };
  const legacyReview = legacyIdentityFor(registeredBody, 'FAB', NOW + 10);
  const withBindings = await scanInbox(0, {}, undefined, 'en-AE', {
    legacyReviewSourceKeys: [legacyReview.sourceKey],
  });
  const binding = withBindings.reviewSourceBindings?.[0];
  ok('review source binding attests the exact old tuple from the same native message',
    withBindings.reviewSourceBindings?.length === 1 && binding.legacyId === legacyReview.id &&
      binding.legacySourceKey === legacyReview.sourceKey && binding.sourceKey === 'android_message_review_source_a9200' &&
      binding.id === withBindings.reviewCandidates[0].id && binding.observedAt === NOW + 10 &&
      !JSON.stringify(binding).includes(registeredBody));
  inboxRows = [{ id: 9201, address: 'ADCB', date: NOW + 11, body: uae }];
  const legacyParsed = legacyIdentityFor(uae, 'ADCB', NOW + 11);
  const parsedBindingScan = await scanInbox(0, {}, undefined, 'en-AE', {
    legacyReviewSourceKeys: [legacyParsed.sourceKey],
  });
  ok('newly understood inbox rows bind an old review before canonical import planning',
    parsedBindingScan.parsed.length === 1 && parsedBindingScan.reviewCandidates.length === 0 &&
      parsedBindingScan.reviewSourceBindings?.[0]?.legacySourceKey === legacyParsed.sourceKey &&
      parsedBindingScan.reviewSourceBindings[0].sourceKey === 'android_message_review_source_a9201');
  const unrelatedBindingScan = await scanInbox(0, {}, undefined, 'en-AE', {
    legacyReviewSourceKeys: [`arc1_${'0'.repeat(64)}`],
  });
  ok('a requested legacy hash never becomes a provider binding without exact source agreement',
    unrelatedBindingScan.reviewSourceBindings?.length === 0);
  const originalDigest = expoCrypto.digestStringAsync;
  let extraDigests = 0;
  expoCrypto.digestStringAsync = async (...args) => { extraDigests++; return originalDigest(...args); };
  await scanInbox(0, {}, undefined, 'en-AE');
  expoCrypto.digestStringAsync = originalDigest;
  ok('ordinary parsed inbox rows do not hash source when no legacy binding was requested', extraDigests === 0);
  const bindingKey = secureStore.__keychain.items.get('wafra.database.key.v1');
  secureStore.__keychain.items.delete('wafra.database.key.v1');
  let bindingIdentityFailure = false;
  try {
    await scanInbox(0, {}, undefined, 'en-AE', { legacyReviewSourceKeys: [legacyParsed.sourceKey] });
  } catch (error) {
    bindingIdentityFailure = error.message === 'Encrypted review identity is unavailable';
  }
  secureStore.__keychain.items.set('wafra.database.key.v1', bindingKey);
  ok('a requested parsed-source migration cannot skip failed identity access and advance a cursor', bindingIdentityFailure);


  inboxRows = [9301, 9303].map((id) => ({ id, address: 'UNLISTED-BANK', date: NOW + 30,
    body: 'Card purchase CAD 24.90 at LOCAL CAFE.' }));
  const sameClock = await scanInbox(0, {}, undefined, 'en-AE');
  ok('distinct provider identities cannot share a review id even with identical body and clock',
    sameClock.reviewCandidates.length === 2 &&
      new Set(sameClock.reviewCandidates.map((item) => item.id)).size === 2);

  const refusedPasteBlocks = [];
  const pastedRows = require('./build/launch-alert-parser.js').parsePastedBankAlerts(
    `${uae}\n\nCard purchase CAD 24.90 at LOCAL CAFE.`, {},
    (source) => refusedPasteBlocks.push(source),
  );
  ok('mixed paste forwards only refused blocks without changing supported parsed rows',
    pastedRows.length === 1 && pastedRows[0].currency === 'AED' &&
      refusedPasteBlocks.length === 1 && refusedPasteBlocks[0] === 'Card purchase CAD 24.90 at LOCAL CAFE.');

  // BNPL PROVIDER SOURCES. The bank's card charge to Tabby/Tamara is the one
  // real outflow; the provider's own SMS or app notification restates it
  // under the SHOP's name, which dedupe can never pair with "Tabby". Such a
  // source must neither post nor raise a Review card inviting the user to add
  // it — and a learned (previously approved) provider package must not start
  // auto-posting either. Bodies are illustrative, not verified provider copy:
  // the gate is the sender/package identity.
  markets.setLedgerCurrency(null);
  markets.setActiveMarket('AE');
  notificationsEnabled = true;
  const bankChargeToTabby = 'Purchase of AED 49.75 to TABBY with Credit Card ending 1234. Avl limit AED 5,000.00';
  inboxRows = [
    { id: 9401, address: 'Tabby', date: NOW + 40_000,
      body: 'AED 49.75 charged to your card ending 1234 for your Noon order. Remaining: 2 payments.' },
    { id: 9402, address: 'Tamara', date: NOW + 40_100,
      body: 'We have received your payment of AED 120.00 for your order from Namshi.' },
    { id: 9403, address: 'AD-Tabby', date: NOW + 40_200,
      body: 'تم خصم 49.75 درهم من بطاقتك المنتهية بـ 1234 لطلبك من نون' },
    { id: 9404, address: 'ADCB', date: NOW + 40_300, body: bankChargeToTabby },
  ];
  receivedRows = [{ address: 'TABBY', date: NOW + 40_400,
    body: 'Your order of AED 199.00 at Noon is split into 4 payments. First payment of AED 49.75 paid.' }];
  notificationRows = [
    { id: 'tabby-app-push-000001', pkg: 'app.tabby.client', appLabel: 'Tabby', title: 'Payment received',
      text: 'Your payment of AED 49.75 for your Noon order has been received.', ts: NOW + 40_500 },
    { id: 'tamara-app-push-00001', pkg: 'co.tamara.user', appLabel: 'Tamara', title: 'Tamara',
      text: 'AED 49.75 charged to your card ending 1234 for your Namshi order.', ts: NOW + 40_600 },
  ];
  const ackBeforeBnpl = acknowledgedNotifications.length;
  const bnpl = await scanInbox(0, {}, undefined, 'en-AE');
  const bnplDiagnostics = getAndroidNotificationImportDiagnostics();
  ok('BNPL provider SMS and app pushes neither post nor raise Review; the bank charge to Tabby still posts once',
    bnpl.parsed.length === 1 && bnpl.parsed[0]?.merchant === 'Tabby' &&
      bnpl.parsed[0]?.amountFils === 4975 && bnpl.parsed[0]?.type === 'expense' &&
      bnpl.parsed[0]?.categoryGuess === 'shopping' && bnpl.parsed[0]?.channel === 'inbox' &&
      bnpl.reviewCandidates.length === 0 &&
      bnpl.declined.every((row) => row.smsTs !== NOW + 40_000 && row.smsTs !== NOW + 40_500),
    JSON.stringify({ parsed: bnpl.parsed, reviews: bnpl.reviewCandidates, declined: bnpl.declined }));
  ok('BNPL provider app pushes are settled as ignored, not left to retry as parser misses',
    bnplDiagnostics?.ignored === 2 && bnplDiagnostics?.review === 0 &&
      bnplDiagnostics?.autoParsed === 0 && bnplDiagnostics?.unresolved === 0,
    JSON.stringify(bnplDiagnostics));
  await bnpl.commit();
  ok('BNPL provider app pushes are acknowledged after the commit boundary',
    acknowledgedNotifications.length === ackBeforeBnpl + 2 &&
      acknowledgedNotifications.includes('tabby-app-push-000001') &&
      acknowledgedNotifications.includes('tamara-app-push-00001'),
    JSON.stringify(acknowledgedNotifications));

  // A user who approved one provider push before this fix has the package in
  // the learned set, which otherwise authorizes automatic posting.
  inboxRows = [];
  receivedRows = [];
  notificationRows = [
    { id: 'tabby-app-push-000002', pkg: 'app.tabby.client', appLabel: 'Tabby', title: 'Tabby',
      text: 'AED 49.75 charged to your card ending 1234 for your Noon order.', ts: NOW + 41_000 },
  ];
  const learnedBnpl = await scanInbox(0, {}, undefined, 'en-AE', {
    notificationOnly: true, learnedNotificationPackages: ['app.tabby.client', 'co.tamara.user'],
  });
  ok('a previously learned BNPL provider package cannot auto-post its restatement',
    learnedBnpl.parsed.length === 0 && learnedBnpl.reviewCandidates.length === 0,
    JSON.stringify(learnedBnpl));
  await learnedBnpl.commit();

  // Same notification text from an ordinary unknown Play app is unaffected:
  // still Review-first, exactly as the hostile-app case above.
  notificationRows = [
    { id: 'tabby-lookalike-app-01', pkg: 'com.example.tabbytailoring', appLabel: 'Tabby Tailoring', title: 'Tabby Tailoring',
      text: 'Purchase of AED 50.00 at CARREFOUR with Debit Card ending 1234', ts: NOW + 41_500 },
  ];
  const lookalike = await scanInbox(0, {}, undefined, 'en-AE', { notificationOnly: true });
  ok('a non-provider app whose label contains Tabby keeps the ordinary Review path',
    lookalike.parsed.length === 0 && lookalike.reviewCandidates.length === 1 &&
      lookalike.reviewCandidates[0]?.sourcePackage === 'com.example.tabbytailoring',
    JSON.stringify(lookalike));
  await lookalike.commit();
  notificationRows = [];
  notificationsEnabled = false;

  // History import, iOS local capture and diagnostics parse through the launch
  // session with the record's own sender. On a ledger with no pinned currency
  // the worldwide fallback used to post the provider's "split into 4" notice
  // as a AED 49.75 Noon expense and its refund notice as income.
  {
    const { createLaunchAlertSession } = require('./build/launch-alert-parser.js');
    markets.setLedgerCurrency(null);
    markets.setActiveMarket('AE');
    const providerBodies = [
      'Your order of AED 199.00 at Noon is split into 4 payments. First payment of AED 49.75 paid.',
      'Refund of AED 49.75 for your Noon order has been processed to your card ending 1234.',
      bankChargeToTabby,
    ];
    const leaked = [];
    for (const sender of ['Tabby', 'Tamara', 'app.tabby.client Tabby']) {
      const session = createLaunchAlertSession({ overrides: {} });
      for (const body of providerBodies) {
        const row = session.parse(body, sender, session.inspect(body, sender), undefined, NOW);
        if (row) leaked.push({ sender, body, merchant: row.merchant, amountFils: row.amountFils });
      }
    }
    const bankSession = createLaunchAlertSession({ overrides: {} });
    const bankRow = bankSession.parse(bankChargeToTabby, 'ADCB', bankSession.inspect(bankChargeToTabby, 'ADCB'), undefined, NOW);
    ok('the launch session never posts a BNPL provider source, on either parser path',
      leaked.length === 0 && bankRow?.merchant === 'Tabby' && bankRow?.amountFils === 4975,
      JSON.stringify({ leaked, bankRow }));
  }

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
