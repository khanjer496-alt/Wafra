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
