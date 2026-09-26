'use strict';
// Settings redesign: copy parity, biometric naming and the two status helpers.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const kind = load(path.join(root, 'src/lib/biometric-kind.ts'));
const copyModule = load(path.join(root, 'src/lib/settings-copy.ts'), { '@/lib/biometric-kind': kind });
const status = load(path.join(root, 'src/lib/settings-status.ts'));

const shape = (value) => {
  if (typeof value === 'function') return 'function';
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape(value[key])]));
  }
  return typeof value;
};

test('settings copy has identical keys and value kinds in English and Arabic', () => {
  const { en, ar } = copyModule.SETTINGS_COPY;
  assert.deepEqual(shape(ar), shape(en));
  const walk = (value, key) => {
    if (typeof value === 'string') {
      assert.ok(value.trim().length > 0, key);
      return;
    }
    if (typeof value === 'function') return;
    for (const [k, v] of Object.entries(value)) walk(v, `${key}.${k}`);
  };
  walk(ar, 'ar');
  walk(en, 'en');
});

test('backup, trusted-devices and lock copy stay truthful', () => {
  for (const lang of ['en', 'ar']) {
    const copy = copyModule.settingsCopy(lang);
    // The backup is a plain JSON file: it may say so, but never "encrypted backup".
    assert.doesNotMatch(copy.backupDetail, /encrypted backup|نسخة احتياطية مشفّرة/i);
    assert.match(copy.backupDetail, /JSON/);
    // The lock hides the ledger; it never claims the ledger stays encrypted.
    assert.doesNotMatch(copy.lockedBody, /encrypt|مشفّر|تشفير/i);
    // Trusted devices share new relayed items only.
    assert.doesNotMatch(copy.trustedDetail, /one ledger|ledger/i);
  }
  assert.match(copyModule.settingsCopy('en').backupDetail, /not encrypted/);
});

test('Arabic counts use singular, dual and plural forms', () => {
  const ar = copyModule.settingsCopy('ar');
  assert.equal(ar.merchantsToPlace(1), 'عنصر واحد بانتظار التصنيف');
  assert.equal(ar.merchantsToPlace(2), 'عنصران بانتظار التصنيف');
  assert.equal(ar.merchantsToPlace(5), '5 عناصر بانتظار التصنيف');
  assert.equal(ar.merchantsToPlace(12), '12 عنصرًا بانتظار التصنيف');
  // After a round hundred, or 100+1 / 100+2, the noun is genitive singular.
  assert.equal(ar.merchantsToPlace(100), '100 عنصر بانتظار التصنيف');
  assert.equal(ar.merchantsToPlace(101), '101 عنصر بانتظار التصنيف');
  assert.equal(ar.merchantsToPlace(102), '102 عنصر بانتظار التصنيف');
  assert.equal(ar.merchantsToPlace(103), '103 عناصر بانتظار التصنيف');
  assert.equal(ar.merchantsToPlace(111), '111 عنصرًا بانتظار التصنيف');
  assert.equal(ar.merchantsToPlace(200), '200 عنصر بانتظار التصنيف');
  assert.equal(ar.proTrialBody(1), 'الالتقاط التلقائي متاح ليوم واحد إضافي.');
  assert.equal(ar.proTrialBody(2), 'الالتقاط التلقائي متاح ليومين إضافيين.');
  assert.equal(ar.proTrialBody(9), 'الالتقاط التلقائي متاح لمدة 9 أيام إضافية.');
  assert.equal(ar.proTrialBody(14), 'الالتقاط التلقائي متاح لمدة 14 يومًا إضافيًا.');
  const en = copyModule.settingsCopy('en');
  assert.equal(en.proTrialBody(1), 'Automatic capture is included for 1 more day.');
  assert.equal(en.unreadFormats(3), '3 formats Wafra couldn’t read');
  assert.equal(en.smsAllowed(0), 'Allowed · no SMS entries this month yet');
  assert.equal(en.smsAllowed(1), 'Allowed · 1 SMS entry this month');
  assert.equal(en.smsAllowed(41), 'Allowed · 41 SMS entries this month');
});

test('the lock is named for the hardware the phone reports', () => {
  const { biometricKindFrom, AUTH_TYPE } = kind;
  assert.equal(biometricKindFrom([AUTH_TYPE.FACIAL_RECOGNITION], 'ios'), 'face-id');
  assert.equal(biometricKindFrom([AUTH_TYPE.FINGERPRINT], 'ios'), 'touch-id');
  assert.equal(biometricKindFrom([], 'ios'), 'passcode');
  assert.equal(biometricKindFrom([AUTH_TYPE.FACIAL_RECOGNITION, AUTH_TYPE.FINGERPRINT], 'android'), 'fingerprint');
  assert.equal(biometricKindFrom([AUTH_TYPE.FACIAL_RECOGNITION], 'android'), 'face');
  assert.equal(biometricKindFrom([AUTH_TYPE.IRIS], 'android'), 'iris');
  assert.equal(biometricKindFrom(null, 'android'), 'passcode');
  const en = copyModule.settingsCopy('en');
  assert.equal(en.lockTitle['face-id'], 'Face ID lock');
  assert.equal(en.lockTitle.fingerprint, 'Fingerprint lock');
  assert.equal(en.unlockWith['touch-id'], 'Unlock with Touch ID');
});

test('Android SMS count covers this month’s SMS rows only', () => {
  const now = new Date(2026, 8, 25, 12, 0, 0);
  const rows = [
    { source: 'sms', date: '2026-09-01' },
    { source: 'sms', date: '2026-09-24' },
    { source: 'sms', date: '2026-08-31' },
    { source: 'manual', date: '2026-09-10' },
    { date: '2026-09-10' },
    { source: 'sms', viaPush: true, date: '2026-09-10' },
    { source: 'sms', statementImportId: 'abc', captureSource: 'pdf', date: '2026-09-10' },
    { source: 'sms', captureSource: 'csv', date: '2026-09-10' },
  ];
  assert.equal(status.androidSmsAddedThisMonth(rows, now), 2);
  assert.equal(status.androidSmsAddedThisMonth([], now), 0);
});

test('capture time label is today’s clock, an earlier date, or nothing', () => {
  const now = new Date(2026, 8, 25, 12, 0, 0);
  const today = new Date(2026, 8, 25, 9, 41, 0).getTime();
  assert.equal(status.captureLastHandledLabel(today, now, 'en'), '09:41');
  const earlier = status.captureLastHandledLabel(new Date(2026, 8, 20, 9, 41).getTime(), now, 'en');
  assert.match(earlier, /20 Sept?/);
  assert.equal(status.captureLastHandledLabel(null, now, 'en'), null);
  assert.equal(status.captureLastHandledLabel(undefined, now, 'en'), null);
  assert.equal(status.captureLastHandledLabel(-5, now, 'en'), null);
  assert.equal(status.captureLastHandledLabel(Number.NaN, now, 'en'), null);
});

test('Customize Home copy has matching keys and a title for every Home section', () => {
  const customize = load(path.join(root, 'src/lib/customize-copy.ts'));
  const { en, ar } = customize.CUSTOMIZE_COPY;
  assert.deepEqual(shape(ar), shape(en));
  assert.deepEqual(Object.keys(en.widgetTitle).sort(), ['activity', 'assistant', 'due', 'insight', 'upcoming']);
  assert.equal(en.widgetTitle.due, 'Due soon');
  assert.equal(en.widgetTitle.activity, 'Latest activity');
  for (const value of Object.values(ar.widgetTitle)) assert.match(value, /[؀-ۿ]/);
});

test('Customize Home keeps accessible reorder buttons, fixed rows and a Done action', () => {
  const source = require('node:fs').readFileSync(path.join(root, 'src/app/home-customize.tsx'), 'utf8');
  assert.match(source, /accessibilityLabel=\{`\$\{t\('moveUp'\)\} \$\{title\}`\}/);
  assert.match(source, /accessibilityLabel=\{`\$\{t\('moveDown'\)\} \$\{title\}`\}/);
  assert.match(source, /actions: \[\{ icon: 'check', label: copy\.done, onPress: router\.back, testID: 'home-customize-done' \}\]/);
  assert.match(source, /testID="home-customize-fixed"[\s\S]*copy\.moneyOverviewTitle[\s\S]*copy\.captureTitle/);
  assert.doesNotMatch(source, /homeCustomizeFixed/);
});
