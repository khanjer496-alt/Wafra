'use strict';
// App Store Review Guideline 2.3.10: copy an iPhone shows must not name another
// platform. Each message that names Android or Google Play has an iOS variant,
// picked where the message is shown; Android and the web keep the original.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { t } = load(path.join(root, 'src/lib/i18n.ts'));

const OTHER_PLATFORM = /android|google|play store|play console|أندرويد|اندرويد|جوجل|غوغل/i;
const PAIRS = [
  ['privacyBuiltInBody', 'privacyBuiltInBodyIos'],
  ['privacySecurityExact', 'privacySecurityExactIos'],
  ['playOnlyBody', 'playOnlyBodyIos'],
  ['manageSubscriptionFailedBody', 'manageSubscriptionFailedBodyIos'],
];

for (const [shared, ios] of PAIRS) for (const language of ['en', 'ar']) {
  test(`${ios} names no other platform: ${language}`, () => {
    const copy = t(ios, language);
    assert.ok(copy.trim().length > 0);
    assert.doesNotMatch(copy, OTHER_PLATFORM);
    if (language === 'ar') assert.match(copy, /[؀-ۿ]/, 'the Arabic variant is Arabic');
    // The shared wording, which Android shows, still names Android or Google Play.
    assert.match(t(shared, language), OTHER_PLATFORM);
    assert.notEqual(copy, t(shared, language));
    // The privacy sheet heads each paragraph with its first sentence; iPhone keeps the same headings.
    if (shared.startsWith('privacy')) assert.equal(copy.split('.')[0], t(shared, language).split('.')[0]);
  });
}

for (const key of ['playOnlyBodyIos', 'manageSubscriptionFailedBodyIos']) for (const language of ['en', 'ar']) {
  test(`${key} still says where to go: the App Store (${language})`, () => {
    assert.match(t(key, language), /App Store/);
  });
}

// Every use of a shared key anywhere in src/ is the non-iOS branch of a
// ternary whose iOS branch is that key's Ios variant.
test('no source shows a shared key without its iOS variant beside it', () => {
  const files = [];
  const collect = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(rel);
      else if (/\.tsx?$/.test(entry.name) && !rel.endsWith('ios-background-parser-source.generated.ts')) files.push(rel);
    }
  };
  collect('src');
  for (const file of files) {
    if (file === path.join('src', 'lib', 'i18n.ts')) continue;
    const source = read(file);
    for (const [shared, ios] of PAIRS) {
      const uses = source.match(new RegExp(`'${shared}'`, 'g'))?.length ?? 0;
      const guarded = source.match(new RegExp(`'${ios}' : '${shared}'`, 'g'))?.length ?? 0;
      assert.equal(uses, guarded, `${file} shows ${shared} without ${ios}`);
    }
  }
});

test('every surface that shows these messages picks the iOS variant on iPhone', () => {
  const surfaces = [
    'src/app/settings.tsx',
    'src/hooks/use-pro-checkout.ts',
    'src/components/pro/pro-plan-options.tsx',
    'src/components/onboarding/e-paywall.tsx',
  ];
  for (const file of surfaces) {
    const source = read(file);
    for (const [shared] of PAIRS) {
      assert.doesNotMatch(source, new RegExp(`t\\('${shared}'\\)`), `${file} shows ${shared} on every platform`);
    }
  }
  const settings = read('src/app/settings.tsx');
  assert.match(settings, /t\(Platform\.OS === 'ios' \? 'privacyBuiltInBodyIos' : 'privacyBuiltInBody'\)/);
  assert.match(settings, /t\(Platform\.OS === 'ios' \? 'privacySecurityExactIos' : 'privacySecurityExact'\)/);
  const checkout = read('src/hooks/use-pro-checkout.ts');
  assert.equal((checkout.match(/t\(store === 'appStore' \? 'playOnlyBodyIos' : 'playOnlyBody'\)/g) ?? []).length, 2);
  assert.equal((checkout.match(/t\(store === 'appStore' \? 'manageSubscriptionFailedBodyIos' : 'manageSubscriptionFailedBody'\)/g) ?? []).length, 2);
  const paywall = read('src/components/onboarding/e-paywall.tsx');
  assert.equal((paywall.match(/t\(store === 'appStore' \? 'playOnlyBodyIos' : 'playOnlyBody'\)/g) ?? []).length, 3);
  assert.match(read('src/components/pro/pro-plan-options.tsx'), /t\(store === 'appStore' \? 'playOnlyBodyIos' : 'playOnlyBody'\)/);
});

// App Lock on iPhone uses Apple's names: Face ID, Touch ID and the passcode.
// "Fingerprint, face unlock, or your phone PIN" and "screen lock" are Android
// words (build 195 showed them under Settings → Privacy and security → App
// Lock), so each lock message has an iOS variant; Android keeps the original.
const ANDROID_LOCK_WORDS = /fingerprint|face unlock|\bPIN\b|screen lock|البصمة|بصمة|التعرّف على الوجه|تعرّفاً على الوجه|قفل الشاشة|قفل شاشة|رمز الهاتف/i;
const APPLE_LOCK_WORDS = /Face ID|Touch ID|passcode|رمز الدخول|رمز دخول/;
const LOCK_PAIRS = [
  ['appLockDetail', 'appLockDetailIos'],
  ['noScreenLock', 'noScreenLockIos'],
  ['noScreenLockBody', 'noScreenLockBodyIos'],
  ['phoneHasNoLock', 'phoneHasNoLockIos'],
  ['setPhoneLockBody', 'setPhoneLockBodyIos'],
];

for (const [shared, ios] of LOCK_PAIRS) for (const language of ['en', 'ar']) {
  test(`${ios} uses Apple's lock names, not Android's: ${language}`, () => {
    const copy = t(ios, language);
    assert.ok(copy.trim().length > 0);
    assert.doesNotMatch(copy, ANDROID_LOCK_WORDS);
    assert.doesNotMatch(copy, OTHER_PLATFORM);
    assert.match(copy, APPLE_LOCK_WORDS);
    if (language === 'ar') assert.match(copy, /[؀-ۿ]/, 'the Arabic variant is Arabic');
    // Android still shows its own wording, unchanged.
    assert.match(t(shared, language), ANDROID_LOCK_WORDS);
    assert.notEqual(copy, t(shared, language));
  });
}

test('the App Lock row subtitle on iPhone is exactly Apple-worded in English and Arabic', () => {
  assert.equal(t('appLockDetailIos', 'en'), 'Face ID, Touch ID, or your passcode');
  assert.equal(t('appLockDetailIos', 'ar'), 'Face ID أو Touch ID أو رمز الدخول');
  assert.equal(t('appLockDetail', 'en'), 'Fingerprint, face unlock, or your phone PIN', 'Android keeps its line');
});

test('the per-biometric App Lock lines an iPhone can show name no Android lock', () => {
  const { SETTINGS_COPY } = load(path.join(root, 'src/lib/settings-copy.ts'));
  const { biometricKindFrom, AUTH_TYPE } = load(path.join(root, 'src/lib/biometric-kind.ts'));
  const iosKinds = new Set([[], [AUTH_TYPE.FINGERPRINT], [AUTH_TYPE.FACIAL_RECOGNITION], [AUTH_TYPE.IRIS],
    [AUTH_TYPE.FINGERPRINT, AUTH_TYPE.FACIAL_RECOGNITION]].map((types) => biometricKindFrom(types, 'ios')));
  assert.deepEqual([...iosKinds].sort(), ['face-id', 'passcode', 'touch-id']);
  for (const language of ['en', 'ar']) {
    const copy = SETTINGS_COPY[language];
    for (const kind of iosKinds) {
      for (const line of [copy.lockTitle[kind], copy.lockDetail[kind], copy.unlockWith[kind]]) {
        if (line !== undefined) assert.doesNotMatch(line, ANDROID_LOCK_WORDS, `${language}/${kind}: ${line}`);
      }
    }
  }
});

test('no source shows a shared lock message without its iOS variant beside it', () => {
  const settings = read('src/app/settings.tsx');
  assert.match(settings, /copy\.lockDetail\[biometricKind\]\) \|\| t\(Platform\.OS === 'ios' \? 'appLockDetailIos' : 'appLockDetail'\)/);
  assert.equal((settings.match(/t\(Platform\.OS === 'ios' \? 'noScreenLockBodyIos' : 'noScreenLockBody'\)/g) ?? []).length, 2);
  const gate = read('src/components/lock-gate.tsx');
  assert.match(gate, /t\(Platform\.OS === 'ios' \? 'phoneHasNoLockIos' : 'phoneHasNoLock'\)/);
  assert.match(gate, /t\(Platform\.OS === 'ios' \? 'setPhoneLockBodyIos' : 'setPhoneLockBody'\)/);
  // Every file in src/ that shows one of these keys picks the iOS variant on iPhone.
  const files = [];
  const collect = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(rel);
      else if (/\.tsx?$/.test(entry.name) && !rel.endsWith('ios-background-parser-source.generated.ts')) files.push(rel);
    }
  };
  collect('src');
  for (const file of files) {
    if (file === path.join('src', 'lib', 'i18n.ts')) continue;
    const source = read(file);
    for (const [shared, ios] of LOCK_PAIRS) {
      const uses = source.match(new RegExp(`'${shared}'`, 'g'))?.length ?? 0;
      const guarded = source.match(new RegExp(`'${ios}' : '${shared}'`, 'g'))?.length ?? 0;
      assert.equal(uses, guarded, `${file} shows ${shared} without ${ios}`);
    }
  }
});
