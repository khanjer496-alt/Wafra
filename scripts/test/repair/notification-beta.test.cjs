'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const moduleFor = env => load(path.join(root, 'src/lib/trusted-bank-notification-packages.ts'), {}, { process: { env } });
const globalMoneyStub = {
  ledgerMoneySpec: (currency) => {
    const code = String(currency ?? '').trim().toUpperCase();
    const exponent = code === 'JPY' ? 0 : ['KWD', 'BHD', 'OMR', 'JOD'].includes(code) ? 3 : 2;
    return /^[A-Z]{3}$/.test(code) ? { schemaVersion: 2, currency: code, exponent } : null;
  },
};
const globalCategoryStub = {
  suggestUniversalCategory: (event) => ({
    merchant: event?.merchant?.value ?? '',
    category: event?.family === 'cash-withdrawal' ? 'cash-withdrawal' : 'other',
    source: 'unresolved',
    reason: 'test-stub',
    needsReview: true,
  }),
};

test('normal Android builds expose notification capture when the native module is available', () => {
  assert.equal(typeof moduleFor({}).isBankNotificationCaptureAvailable, 'function');
  for (const value of [undefined, '', '0', 'true', 'yes', '1']) {
    for (const nativeAvailable of [false, undefined, 'true', true]) {
      const actual = moduleFor({ EXPO_PUBLIC_WAFRA_ANDROID_NOTIFICATION_CAPTURE_BETA: value }).isBankNotificationCaptureAvailable(nativeAvailable);
      assert.equal(actual, nativeAvailable === true);
    }
  }
});

test('native notification admission is built into ordinary Android APKs', () => {
  const gradle = read('modules/notification-reader/android/build.gradle');
  assert.match(gradle, /buildConfig true/);
  assert.match(gradle, /buildConfigField 'boolean', 'WAFRA_ANDROID_NOTIFICATION_CAPTURE_ENABLED', 'true'/);
  const native = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/TrustedBankNotificationPackages.kt');
  assert.match(native, /CAPTURE_ENABLED[^\n]*BuildConfig\.WAFRA_ANDROID_NOTIFICATION_CAPTURE_ENABLED/);
  assert.match(native, /installer\(context, packageName\) == "com\.android\.vending"/);
  assert.match(native, /CAPTURE_ENABLED && markets\.containsKey\(packageName\)/);
});

test('curated package identity remains exact while native intake can discover new Play financial candidates', () => {
  const enabled = moduleFor({});
  assert.equal(enabled.trustedBankNotificationMarket('com.example.notificationproducer'), null);
  assert.equal(enabled.trustedBankNotificationMarket('com.emiratesnbd.android.spoof'), null);
  assert.equal(enabled.trustedBankNotificationMarket('com.emiratesnbd.android'), 'AE');
  const native = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/TrustedBankNotificationPackages.kt');
  const listener = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/BankNotificationListenerService.kt');
  assert.doesNotMatch(native, /ApplicationInfo\.CATEGORY_FINANCE/);
  assert.match(native, /SOURCE_FINANCIAL_CANDIDATE/);
  assert.match(listener, /TrustedBankNotificationPackages\.sourceClass\(this, sbn\.packageName, body\)/);
  assert.match(listener, /SensitiveNotificationFilter\.shouldReject\(body\)/);
  // Exact curated banks are package-authenticated and must reach the real
  // parser even when the cheap native money regex does not understand one
  // notification rendering. Unknown Play financial candidates keep the gate.
  assert.match(listener, /sourceClass != TrustedBankNotificationPackages\.SOURCE_TRUSTED_BANK[\s\S]{0,180}!MONEY_RE\.containsMatchIn/);
  assert.match(listener, /moneyHeuristicBypassed/);
  assert.match(listener, /Notification\.EXTRA_TEXT_LINES/);
  assert.match(listener, /Notification\.EXTRA_SUB_TEXT/);
  assert.match(listener, /Notification\.EXTRA_INFO_TEXT/);
  assert.match(listener, /Notification\.EXTRA_SUMMARY_TEXT/);
  assert.match(listener, /Notification\.EXTRA_TITLE_BIG/);
  assert.match(listener, /Notification\.EXTRA_MESSAGES/);
  assert.match(listener, /Notification\.EXTRA_HISTORIC_MESSAGES/);
  assert.match(listener, /notification\.tickerText/);
  assert.match(listener, /filter \{ key -> looksLikeTextExtraKey\(key\) \}/);
  assert.match(listener, /extendedMoneySurface/);
  assert.match(listener, /POSTING_CONTEXT_RE/);
  assert.match(listener, /composedMoneySurface/);
  assert.match(listener, /listOf\(contextCandidate, moneyCandidate\)\.distinct\(\)\.joinToString\(" "\)/);
  assert.equal(enabled.trustedBankNotificationSender('com.adcb.nexgen'), 'ADCB');
});

test('known bank packages survive OEM/restore installer metadata while unknown apps still require Play provenance', () => {
  const native = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/TrustedBankNotificationPackages.kt');
  const trustedBranch = native.indexOf('if (isTrusted(context, packageName)) return SOURCE_TRUSTED_BANK');
  const playBranch = native.indexOf('if (!playInstalled(context, packageName)) return null');
  assert.ok(trustedBranch >= 0 && playBranch > trustedBranch,
    'exact curated package ids must be admitted before the unknown-app Play installer gate');
});

test('ordinary notification drains are sweep-free and shade recovery is explicit', () => {
  const module = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/NotificationReaderModule.kt');
  const listener = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/BankNotificationListenerService.kt');
  const getCaptured = module.indexOf('AsyncFunction("getCaptured")');
  const readQueue = module.indexOf('NotificationCaptureStore.read(context, sinceMs.toLong())');
  const getCapturedBody = module.slice(getCaptured, readQueue);
  assert.ok(getCaptured >= 0 && readQueue > getCaptured);
  assert.doesNotMatch(getCapturedBody,
    /sweepOrRequestRebind|sweepConnected|refreshQueuedVisible|Thread\.sleep/,
    'ordinary queue reads must not re-extract/decrypt visible notifications before reading');
  const targetedStart = listener.indexOf('private fun refreshQueuedVisible()');
  const targetedEnd = listener.indexOf('private fun queuedVisibleMatchCount()', targetedStart);
  const targeted = listener.slice(targetedStart, targetedEnd);
  assert.ok(targetedStart >= 0 && targetedEnd > targetedStart);
  assert.match(targeted, /NotificationCaptureStore\.retainedIdentities\(this\)/);
  assert.match(targeted, /queued\.contains\(notification\.packageName to notification\.postTime\)/);
  assert.match(targeted, /capture\(notification, wakeAfterAppend = false\)/);
  assert.doesNotMatch(targeted, /sweepActiveNotifications|requestRebind/);
  const explicitSweep = module.indexOf('AsyncFunction("sweepVisible")');
  assert.ok(explicitSweep >= 0 && explicitSweep < getCaptured);
  assert.match(module.slice(explicitSweep, getCaptured), /BankNotificationListenerService\.sweepOrRequestRebind\(context\)/);
  assert.match(module.slice(explicitSweep, getCaptured), /Thread\.sleep\(50\)/);
  assert.match(listener, /requestRebind\(ComponentName\(context, BankNotificationListenerService::class\.java\)\)/);
  assert.match(listener, /fun isConnected\(\): Boolean = connected != null/);
  assert.match(listener, /override fun onListenerConnected\(\)[\s\S]{0,320}scheduleSweep\(\)/);
  assert.match(listener, /private fun scheduleSweep\(\)[\s\S]{0,180}recoveryExecutor\.execute[\s\S]{0,180}sweepActiveNotifications\(\)/,
    'listener reconnect recovery must leave KeyStore/shade work off the callback thread');
});

test('notification diagnostics expose only source-free listener and queue state', () => {
  const module = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/NotificationReaderModule.kt');
  const listener = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/BankNotificationListenerService.kt');
  const bridge = read('modules/notification-reader/index.ts');
  const settings = read('src/app/settings.tsx');
  assert.match(module, /AsyncFunction\("getDiagnostics"\)/);
  assert.match(listener, /fun visibilityDiagnostics\(context: Context\): Map<String, Any>/);
  assert.match(listener, /"adcbVisible" to active\.any/);
  assert.match(listener, /"adcbActiveCount" to active\.count/);
  assert.match(module, /"queuedCandidateCount" to queued/);
  assert.match(module, /"queuedVisibleMatchCount" to queuedVisibleMatches/);
  assert.match(module, /"adcbAdmissionCounts"/);
  assert.match(listener, /recordAdmission\("moneyPassed", adcb\)/);
  assert.match(listener, /recordAdmission\(if \(appendResult == "repaired"\) "appendRepaired" else "appendSucceeded", adcb\)/);
  assert.match(listener, /recordAdmission\("exception", adcb\)/);
  assert.match(listener, /filter \{ MONEY_RE\.containsMatchIn\(it\) \}[\s\S]{0,80}maxByOrNull \{ it\.length \}/);
  assert.match(listener, /listOf\(title\) \+ nonBlankTextCandidates/);
  const store = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/NotificationCaptureStore.kt');
  assert.match(store, /"cleared-through"/);
  assert.match(store, /indexOfFirst \{ it\.pkg == pkg && it\.ts == ts \}/);
  assert.match(store, /prior\.copy\(title = title, text = text\)/);
  assert.match(store, /private const val ACKED = "acked_fingerprints"/);
  assert.match(store, /notificationFingerprint\(pkg, ts\)/);
  assert.match(store, /return "acknowledged"/);
  assert.match(store, /putString\(ACKED, JSONArray\(acked\)\.toString\(\)\)/);
  assert.match(store, /acknowledgedRows\.map \{ notificationFingerprint\(it\.pkg, it\.ts\) \}/);
  assert.match(bridge, /getDiagnostics\(\): Promise<NotificationReaderDiagnostics>/);
  const diagnosticStart = module.indexOf('AsyncFunction("getDiagnostics")');
  const diagnosticEnd = module.indexOf('AsyncFunction("sweepVisible")', diagnosticStart);
  const diagnosticBody = module.slice(diagnosticStart, diagnosticEnd);
  assert.match(diagnosticBody, /NotificationCaptureStore\.pendingCount\(context\)/);
  assert.doesNotMatch(diagnosticBody, /NotificationCaptureStore\.read\(context, 0L\)/,
    'source-free diagnostics must not decrypt the AndroidKeyStore-backed queue');
  assert.match(bridge, /sweepVisible\(\): Promise<boolean>/);
  assert.doesNotMatch(settings, /notifDiagnosticsTitle|notifDiagnosticsRefresh/,
    'raw notification diagnostics should not be part of normal Settings');
  assert.doesNotMatch(settings, /notifDiagnostics[\s\S]{0,500}\.text/);
});

test('only the official HSBC UAE Play package is eligible for UAE capture', () => {
  const enabled = moduleFor({});
  assert.equal(enabled.trustedBankNotificationMarket('ae.hsbc.hsbcuae'), 'AE');
  assert.equal(enabled.trustedBankNotificationMarket('com.htsu.hsbcpersonalbanking'), null);
  const native = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/TrustedBankNotificationPackages.kt');
  assert.match(native, /"ae\.hsbc\.hsbcuae" to "AE"/);
  assert.doesNotMatch(native, /"com\.htsu\.hsbcpersonalbanking" to /);
});

test('native opt-out defaults closed and clears ciphertext before future callbacks', () => {
  const base = 'modules/notification-reader/android/src/main/java/expo/modules/notificationreader/';
  const policy = read(`${base}NotificationCapturePolicy.kt`);
  const store = read(`${base}NotificationCaptureStore.kt`);
  const listener = read(`${base}BankNotificationListenerService.kt`);
  const module = read(`${base}NotificationReaderModule.kt`);
  assert.match(policy, /getBoolean\(ENABLED, false\)/);
  assert.match(policy, /if \(previousPush && !pushActive\) NotificationCaptureStore\.clear\(context\)/);
  assert.match(policy, /else if \(!leaseActive\) NotificationCaptureStore\.clear\(context\)/,
    'turning capture off must erase ciphertext even when the push source was already disabled');
  assert.ok(store.indexOf('if (!NotificationCapturePolicy.isEnabled(context)) return') <
    store.indexOf('purgeLegacyPlaintext(context)', store.indexOf('fun append(')));
  assert.ok(listener.indexOf('if (!NotificationCapturePolicy.isEnabled(this)) return') <
    listener.indexOf('NotificationCaptureStore.append('));
  assert.match(module, /AsyncFunction\("setCaptureEnabled"\)/);
  assert.match(module, /val wasEnabled = NotificationCapturePolicy\.isEnabled\(context\)/);
  assert.match(module, /val nowEnabled = NotificationCapturePolicy\.isEnabled\(context\)/);
  assert.match(module, /if \(!wasEnabled && nowEnabled\) BankNotificationListenerService\.scheduleSweepConnected\(\)/,
    'enabling admission must not block the JS/native bridge on a shade sweep');
  assert.match(module, /ComponentName\.unflattenFromString\(value\)/);
  assert.match(module, /if \(!NotificationCapturePolicy\.isEnabled\(context\) \|\| !hasSystemAccess\(context\)\)/);
});

test('native listener admission expires without an app foreground refresh', () => {
  const base = 'modules/notification-reader/android/src/main/java/expo/modules/notificationreader/';
  const policy = read(`${base}NotificationCapturePolicy.kt`);
  const module = read(`${base}NotificationReaderModule.kt`);
  assert.match(policy, /getLong\(EXPIRES_AT, 0L\)/);
  assert.match(policy, /expiresAt > System\.currentTimeMillis\(\)/);
  assert.match(module, /AsyncFunction\("setCaptureEnabled"\) \{ enabled: Boolean, expiresAtMs: Double/);
});

test('the scanner reads only with native availability and granted notification access', async () => {
  let available = true, enabled = true, reads = 0, acknowledgements = 0;
  const notification = { isAvailable: () => available, isEnabled: () => enabled,
    getCaptured: async () => { reads++; return []; }, ackCaptured: async () => { acknowledgements++; return true; } };
  const scanner = load(path.join(root, 'src/lib/auto-import.ts'), {
    '@/lib/capture-trace': load(path.join(root, 'src/lib/capture-trace.ts')),
    'react-native': { Platform: { OS: 'android' }, AppState: { currentState: 'active' } },
    'expo-crypto': {}, 'expo-secure-store': {},
    '../../modules/notification-reader': { __esModule: true, default: notification },
    '../../modules/sms-reader': { __esModule: true, default: { getInboxSms: async () => [] } },
    '@/lib/alert-review-tray': {}, '@/lib/format': { toISODate: () => '2026-09-08' },
    '@/lib/dedupe': { bodyPrint: value => value }, '@/lib/sms-parser': {},
    '@/lib/alert-institution-grammars': { hasUniversalInstitutionSender: () => false },
    '@/lib/markets': { detectLaunchMarketFromSender: () => null, pinnedLedgerCurrencyCode: () => null },
    '@/lib/ledger-money': globalMoneyStub,
    '@/lib/universal-categorization': globalCategoryStub,
    '@/lib/launch-alert-parser': { inspectGenericBankEventForReview: () => null, hasBankAlertMoneyHint: () => false, hasGenericBankAlertContext: () => false, createLaunchAlertSession: () => ({ inspect: () => null, detectedMarket: () => null, parse: () => null }) },
    '@/lib/unparsed-launch-alert': {}, '@/lib/trusted-bank-notification-packages': moduleFor({}), '@/lib/import-plan': {},
  });
  const run = async () => { const result = await scanner.scanInbox(0, {}, undefined, null); await result.commit(); };
  available = false;
  await run(); assert.equal(reads, 0, 'missing native reader remains unavailable');
  available = true; enabled = false;
  await run(); assert.equal(reads, 0, 'declined/revoked Android access prevents queue reads');
  enabled = true;
  await run(); assert.equal(reads, 1, 'ordinary build and granted access can read retained candidates');
  enabled = false;
  await run(); assert.equal(reads, 1, 'revocation takes effect on the next scan');
  assert.equal(acknowledgements, 0, 'no admission or permission operation acknowledges financial rows');
});

test('notification-only scan drains without touching the SMS inbox', async () => {
  let smsReads = 0, notificationReads = 0;
  const scanner = load(path.join(root, 'src/lib/auto-import.ts'), {
    '@/lib/capture-trace': load(path.join(root, 'src/lib/capture-trace.ts')),
    'react-native': { Platform: { OS: 'android' }, AppState: { currentState: 'active' } },
    'expo-crypto': {}, 'expo-secure-store': {},
    '../../modules/notification-reader': { __esModule: true, default: {
      isAvailable: () => true, isEnabled: () => true,
      getCaptured: async () => { notificationReads++; return []; },
    } },
    '../../modules/sms-reader': { __esModule: true, default: {
      getInboxSms: async () => { smsReads++; throw new Error('SMS must not be read'); },
    } },
    '@/lib/alert-review-tray': {}, '@/lib/format': { toISODate: () => '2026-09-08' },
    '@/lib/dedupe': { bodyPrint: value => value }, '@/lib/sms-parser': {},
    '@/lib/alert-institution-grammars': { hasUniversalInstitutionSender: () => false },
    '@/lib/markets': { detectLaunchMarketFromSender: () => null, pinnedLedgerCurrencyCode: () => null },
    '@/lib/ledger-money': globalMoneyStub,
    '@/lib/universal-categorization': globalCategoryStub,
    '@/lib/launch-alert-parser': { inspectGenericBankEventForReview: () => null, hasBankAlertMoneyHint: () => false, hasGenericBankAlertContext: () => false, createLaunchAlertSession: () => ({ inspect: () => null, detectedMarket: () => null, parse: () => null }) },
    '@/lib/unparsed-launch-alert': {}, '@/lib/trusted-bank-notification-packages': moduleFor({}), '@/lib/import-plan': {},
  });
  const result = await scanner.scanInbox(0, {}, undefined, null, { notificationOnly: true });
  assert.equal(smsReads, 0);
  assert.equal(notificationReads, 1);
  assert.equal(result.inboxHistoryComplete, false, 'notification scan cannot claim SMS history completion');
});

test('real bank app identity can auto-import on first sight while ambiguous apps remain review-first', () => {
  const scanner = read('src/lib/auto-import.ts');
  const promotion = read('src/lib/review-promotion.ts');
  const types = read('src/lib/types.ts');
  const bridge = read('modules/notification-reader/index.ts');
  const native = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/TrustedBankNotificationPackages.kt');
  assert.match(scanner, /learnedPackages\.has\(n\.pkg\)/);
  assert.match(scanner, /verifiedFinancialAppSender\(n\.appLabel \?\? ''\)/);
  assert.match(scanner, /sourceClass === 'trusted-bank' \|\| sourceClass === 'play-finance' \|\| learned/);
  assert.match(scanner, /FINANCIAL_APP_LABEL_RE/);
  assert.match(scanner, /KNOWN_FINTECH_LABEL_RE/);
  assert.match(scanner, /NON_FINANCIAL_BANK_LABEL_RE/);
  assert.match(scanner, /if \(NON_FINANCIAL_BANK_LABEL_RE\.test\(label\)\) return null/);
  assert.match(scanner, /detectLaunchMarketFromSender\(candidate\) !== null \|\| hasUniversalInstitutionSender\(candidate\)/);
  assert.match(scanner, /const launchParsed = trustedMarket === 'AE' \|\| trustedMarket === 'SA'/);
  assert.match(scanner, /parsedUniversalPosting\(universalEvent, source, overrides, routedMarket\)/);
  assert.match(scanner, /ledgerMoneySpec\(event\.amount\.value\.currency\)/);
  assert.match(scanner, /shouldReviewParsedIncome\(p\) \|\| !autoAuthorized/);
  assert.match(scanner, /p && autoAuthorized && !reviewed/);
  assert.match(scanner, /trustedBankNotificationSender\(n\.pkg\) \?\? verifiedSender \?\?/);
  assert.match(promotion, /item\.sourceClass === 'financial-candidate'/);
  assert.match(promotion, /learnedNotificationPackage/);
  assert.match(types, /trustedNotificationPackages: string\[\]/);
  assert.match(scanner, /parsedFinancialCandidateReview\(p, n\.ts\)/);
  assert.match(scanner, /decision\.kind === 'ignored' && decision\.reason === 'unrecognized' && parsedFallback/);
  assert.match(scanner, /decision = \{ kind: 'review', candidate: parsedFallback \}/);
  assert.match(bridge, /appLabel: string/);
  assert.match(bridge, /'trusted-bank' \| 'play-finance' \| 'financial-candidate'/);
  assert.match(native, /fun applicationLabel\(context: Context, packageName: String\): String/);
});

test('500 queued notification candidates process without touching SMS and ACK only after commit', async () => {
  let smsReads = 0, parseCalls = 0, acknowledgements = 0;
  const rows = Array.from({ length: 500 }, (_, index) => ({
    id: `notification-row-${String(index).padStart(4, '0')}`,
    pkg: 'com.example.financeapp',
    appLabel: 'Example Bank',
    title: 'Card purchase',
    text: `AED ${index + 1}.00 at TEST SHOP`,
    ts: 1_800_000_000_000 + index,
    sourceClass: 'financial-candidate',
  }));
  const parsed = {
    kind: 'transaction', type: 'expense', amountFils: 100, currency: 'AED',
    merchant: 'Test Shop', date: null, dueDay: null, minDueFils: null, card: null,
    reference: null, transferHint: false, snapshotFils: null, snapshotKind: null,
    categoryGuess: 'other', categoryDeliberate: false, raw: 'synthetic',
  };
  const scanner = load(path.join(root, 'src/lib/auto-import.ts'), {
    '@/lib/capture-trace': { captureTrace: () => {}, captureTraceEnabled: () => false },
    'react-native': { Platform: { OS: 'android' }, AppState: { currentState: 'active' } },
    'expo-crypto': {}, 'expo-secure-store': {},
    '../../modules/notification-reader': { __esModule: true, default: {
      isAvailable: () => true, isEnabled: () => true,
      getCaptured: async () => rows,
      ackCaptured: async ids => { acknowledgements += ids.length; return true; },
    } },
    '../../modules/sms-reader': { __esModule: true, default: {
      getInboxSms: async () => { smsReads++; return []; },
    } },
    '@/lib/alert-review-tray': {}, '@/lib/format': { toISODate: () => '2026-09-08' },
    '@/lib/dedupe': { bodyPrint: value => value }, '@/lib/sms-parser': {},
    '@/lib/alert-institution-grammars': { hasUniversalInstitutionSender: () => false },
    '@/lib/markets': { detectLaunchMarketFromSender: () => null, pinnedLedgerCurrencyCode: () => null },
    '@/lib/ledger-money': globalMoneyStub,
    '@/lib/universal-categorization': globalCategoryStub,
    '@/lib/launch-alert-parser': { inspectGenericBankEventForReview: () => null, hasBankAlertMoneyHint: () => false, hasGenericBankAlertContext: () => false, createLaunchAlertSession: () => ({
      inspect: () => null, detectedMarket: () => 'AE', parse: () => { parseCalls++; return parsed; },
    }) },
    '@/lib/unparsed-launch-alert': {}, '@/lib/trusted-bank-notification-packages': moduleFor({}), '@/lib/import-plan': {},
  });
  const result = await scanner.scanInbox(0, {}, undefined, null, { notificationOnly: true });
  assert.equal(smsReads, 0);
  assert.equal(parseCalls, 500);
  assert.equal(result.parsed.length, 500);
  assert.equal(result.scannedCount, 500);
  assert.equal(acknowledgements, 0);
  await result.commit();
  assert.equal(acknowledgements, 500);
});


test('eligible Android users are auto-admitted and prompted only for the unavoidable system grant', () => {
  const hook = read('src/hooks/use-auto-import.ts');
  const autoImport = read('src/lib/auto-import.ts');
  assert.match(hook, /if \(!current\.hydrated \|\| !current\.onboarded \|\| current\.captureOptOut \|\| !isProActive\(current\)\) return;/);
  assert.match(hook, /Platform\.OS !== 'android' \|\| !watchForeground \|\| androidNotificationAccessPromptShown/);
  assert.match(hook, /hasBankNotificationSystemAccess\(\)/);
  assert.match(hook, /openBankNotificationAccessSettings\(\)/);
  assert.match(autoImport, /NotificationReader\.hasSystemAccess\?\.\(\) === true/);
  assert.match(autoImport, /NotificationReader\.openSettings\?\.\(\) === true/);
});

test('Settings and draining use the same availability gate while permission revocation still blocks draining', () => {
  const settings = read('src/app/settings.tsx'); const scan = read('src/lib/auto-import.ts');
  assert.match(settings, /isBankNotificationCaptureAvailable\(NotificationReader\?\.isAvailable\?\.\(\) === true\)/);
  assert.match(scan, /isBankNotificationCaptureAvailable\(notificationReader\?\.isAvailable\?\.\(\) === true\)/);
  assert.match(scan, /notificationReader\?\.isEnabled\?\.\(\)/);
  assert.match(settings, /notifAccessFull/);
  const copy = load(path.join(root, 'src/lib/i18n.ts'));
  assert.match(copy.t('notifAccessFull', 'en'), /without SMS access/);
  assert.match(copy.t('notifAccessFull', 'ar'), /دون إذن الرسائل/);
});


test('foreground notification drain is independent of SMS freshness and self-heals a killed listener', () => {
  const hook = read('src/hooks/use-auto-import.ts');
  const scanner = read('src/lib/auto-import.ts');
  const settings = read('src/app/settings.tsx');
  const bridge = read('modules/notification-reader/index.ts');
  const module = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/NotificationReaderModule.kt');
  assert.match(hook, /const runAndroidNotificationDrain = useCallback/);
  assert.match(hook, /captureExecutor\.execute\('notification-only'\)/);
  assert.match(hook, /ANDROID_NOTIFICATION_RECOVERY_GRACE_MS\s*=\s*10_000/);
  assert.match(hook, /getPendingCount\?\.\(\)/);
  assert.match(hook, /if \(pending <= 0\) return;/);
  assert.match(hook, /ensureListenerConnected\?\.\(\)/);
  assert.match(hook, /setTimeout\([\s\S]*?getPendingCount[\s\S]*?runAndroidNotificationDrain\(\)[\s\S]*?ANDROID_NOTIFICATION_RECOVERY_GRACE_MS\)/,
    'source-free recovery waits until after the launch grace and opens KeyStore only for a real pending queue');
  const drainStart = hook.indexOf('const runAndroidNotificationDrain = useCallback');
  const drainEnd = hook.indexOf(`/**\n   * The current scan`, drainStart);
  const drainBody = hook.slice(drainStart, drainEnd);
  assert.doesNotMatch(drainBody, /lastScanAt|RESCAN_AFTER_MS|hasSmsPermission|getInboxSms/);
  assert.doesNotMatch(settings, /sweepVisible|recoverNotificationDiagnostics|notifDiagnosticsRefresh/,
    'normal Settings must not own notification recovery');
  assert.match(bridge, /ensureListenerConnected\?\(\): Promise<boolean>/);
  const healStart = module.indexOf('AsyncFunction("ensureListenerConnected")');
  const healEnd = module.indexOf('/** Opens the system Notification access screen', healStart);
  const healBody = module.slice(healStart, healEnd);
  assert.match(healBody, /if \(!BankNotificationListenerService\.isConnected\(\)\)/);
  assert.match(healBody, /sweepOrRequestRebind\(context\)/);
  const diagnosticsStart = module.indexOf('AsyncFunction("getDiagnostics")');
  const diagnosticsEnd = module.indexOf('AsyncFunction("sweepVisible")');
  assert.doesNotMatch(module.slice(diagnosticsStart, diagnosticsEnd), /sweepOrRequestRebind|sweepConnected/,
    'reading diagnostic counts must not sweep the full shade');
  const tester = read('src/lib/android-tester-diagnostics.ts');
  assert.match(tester, /getAndroidNotificationImportDiagnostics\(\)/);
  assert.match(scanner, /acknowledgementPlanned/);
  assert.match(scanner, /unresolved/);
  assert.match(scanner, /unresolvedTrustedBank/);
  assert.match(scanner, /unresolvedFinancialCandidate/);
  assert.match(scanner, /unresolvedParserMiss/);
  assert.match(scanner, /unresolvedReviewRefusal/);
});

test('bank-app queue changes wake the foreground app without scanning SMS or the full shade', () => {
  const module = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/NotificationReaderModule.kt');
  const listener = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/BankNotificationListenerService.kt');
  const bridge = read('modules/notification-reader/index.ts');
  const hook = read('src/hooks/use-auto-import.ts');
  assert.match(module, /Events\("onQueueChanged"\)/);
  assert.match(module, /sendEvent\("onQueueChanged", emptyMap<String, Any>\(\)\)/);
  assert.match(listener, /NotificationReaderModule\.notifyQueueChanged\(\)/);
  assert.match(bridge, /addListener\?\(event: 'onQueueChanged'/);
  assert.match(hook, /NotificationReader\.addListener\('onQueueChanged'/);
  const liveStart = hook.indexOf("NotificationReader.addListener('onQueueChanged'");
  const liveWindow = hook.slice(Math.max(0, liveStart - 1800), liveStart + 900);
  assert.match(liveWindow, /runAndroidNotificationDrain/);
  assert.doesNotMatch(liveWindow, /sweepVisible|getInboxSms|hasSmsPermission/);
});

test('Wafra transaction alerts are visible and sounding rather than silent', () => {
  const module = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/NotificationReaderModule.kt');
  const bridge = read('modules/notification-reader/index.ts');
  const instant = read('modules/sms-reader/android/src/main/java/expo/modules/smsreader/InstantAlert.kt');
  const relay = read('src/lib/background-relay.ts');
  const notifications = read('src/lib/notifications.ts');
  assert.match(module, /IMPORT_NOTICE_CHANNEL_ID = "wafra-live-bank-transactions-v2"/);
  assert.match(module, /NotificationManager\.IMPORTANCE_HIGH/);
  assert.match(module, /enableVibration\(true\)/);
  assert.match(bridge, /postImportNotice\?\(title: string, body: string\): boolean/);
  assert.match(instant, /CHANNEL_ID = "instant-transactions-v2"/);
  assert.match(instant, /NotificationManager\.IMPORTANCE_HIGH/);
  assert.match(instant, /enableVibration\(true\)/);
  assert.doesNotMatch(instant, /setSound\(null, null\)/);
  assert.match(relay, /sound: 'default'/);
  assert.match(relay, /interruptionLevel: 'active'/);
  assert.match(notifications, /shouldPlaySound: true/);
});

for (const mode of ['ready', 'cold', 'inactive']) for (const transport of ['notification', 'sms'])
test(`${transport} shadow ${mode}: no discarded inspection, admission delay, or money changes`, async () => {
  let releaseShadow;
  const pendingShadow = new Promise(resolve => { releaseShadow = resolve; });
  let observed = 0, queued = 0, inspected = 0, acknowledgements = 0, completed = false;
  const parsed = {
    kind: 'transaction', type: 'expense', amountFils: 12345, currency: 'AED',
    merchant: 'Test Shop', date: null, dueDay: null, minDueFils: null, card: '1234',
    reference: null, transferHint: false, snapshotFils: null, snapshotKind: null,
    categoryGuess: 'shopping', categoryDeliberate: false, raw: 'synthetic',
  };
  const scanner = load(path.join(root, 'src/lib/auto-import.ts'), {
    '@/lib/capture-trace': { captureTrace: () => {}, captureTraceEnabled: () => false },
    'react-native': { Platform: { OS: 'android' }, AppState: { currentState: mode === 'inactive' ? 'background' : 'active' } },
    'expo-crypto': {}, 'expo-secure-store': {},
    '../../modules/notification-reader': { __esModule: true, default: {
      isAvailable: () => true, isEnabled: () => transport === 'notification',
      getCaptured: async () => [{ id: 'shadow-delay-notification-001', pkg: 'com.adcb.nexgen', appLabel: 'ADCB',
        title: 'Card purchase', text: 'AED 123.45 at TEST SHOP', ts: 1_800_000_000_000, sourceClass: 'trusted-bank' }],
      ackCaptured: async ids => { acknowledgements += ids.length; return true; },
    } },
    '../../modules/sms-reader': { __esModule: true, default: { getInboxSms: async () => { assert.equal(transport, 'sms'); return [{ id: 123, address: 'ADCB', body: 'Card purchase AED 123.45 at TEST SHOP', date: 1_800_000_000_000 }]; } } },
    '@/lib/local-semantic-shadow': {
      canCollectLocalSemanticShadow: () => mode === 'ready',
      observeLocalSemanticParserShadow: async () => { observed++; await pendingShadow; },
      queueLocalSemanticParserShadow: () => { queued++; },
      buildLocalParserSemanticWindow: () => null,
    },
    '@/lib/alert-review-tray': {}, '@/lib/format': { toISODate: () => '2026-09-08' },
    '@/lib/dedupe': { bodyPrint: value => value }, '@/lib/sms-parser': {},
    '@/lib/alert-institution-grammars': { hasUniversalInstitutionSender: () => false },
    '@/lib/markets': { detectLaunchMarketFromSender: () => 'AE', pinnedLedgerCurrencyCode: () => null },
    '@/lib/ledger-money': globalMoneyStub, '@/lib/universal-categorization': globalCategoryStub,
    '@/lib/launch-alert-parser': {
      inspectGenericBankEventForReview: () => { inspected++; return { decision: 'review' }; },
      hasBankAlertMoneyHint: () => true, hasGenericBankAlertContext: () => true,
      createLaunchAlertSession: () => ({ inspect: () => null, detectedMarket: () => 'AE', parse: () => parsed }),
    },
    '@/lib/unparsed-launch-alert': {}, '@/lib/trusted-bank-notification-packages': moduleFor({}), '@/lib/import-plan': {},
  });
  const scan = scanner.scanInbox(0, {}, undefined, null, { notificationOnly: transport === 'notification', maxInboxPages: 1 }).then(result => { completed = true; return result; });
  try {
    // Let the scanner's native-Promise continuations settle while inference is
    // deliberately unresolved; there is no inference-speed timing threshold.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(completed, true, 'optional inference must not hold the admission result');
    const result = await scan;
    assert.equal(observed, 0);
    assert.equal(inspected, mode === 'ready' ? 1 : 0, 'only collectible shadow work needs a second inspection');
    assert.equal(queued, mode === 'ready' ? 1 : 0);
    assert.equal(result.parsed.length, 1);
    assert.equal(result.parsed[0].amountFils, 12345);
    assert.equal(result.parsed[0].currency, 'AED');
    assert.equal(acknowledgements, 0, 'queueing a metric cannot acknowledge native capture');
    await result.commit();
    assert.equal(acknowledgements, transport === 'notification' ? 1 : 0);
  } finally {
    releaseShadow();
    await scan;
  }
});
