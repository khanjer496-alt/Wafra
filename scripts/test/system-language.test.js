const fs = require('node:fs');
const path = require('node:path');

const language = require('./build/system-language');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
  if (condition) {
    pass += 1;
    console.log(`✓ ${name}`);
    return;
  }
  fail += 1;
  console.log(`✗ ${name}\n    ${detail}`);
};

ok('System follows an Arabic per-app locale',
  language.resolveUiLanguage('system', [{ languageCode: 'ar' }]) === 'ar');
ok('System defaults non-Arabic locales to English',
  language.resolveUiLanguage('system', [{ languageCode: 'fr' }]) === 'en');
ok('an explicit English choice overrides an Arabic OS locale',
  language.resolveUiLanguage('en', [{ languageCode: 'ar' }]) === 'en');
ok('an explicit Arabic choice overrides an English OS locale',
  language.resolveUiLanguage('ar', [{ languageCode: 'en' }]) === 'ar');

const store = fs.readFileSync(path.resolve(__dirname, '../../src/lib/store.tsx'), 'utf8');
ok('the store observes Expo locale changes while System is selected',
  /useLocales\(\)/.test(store) && /type: 'syncSystemLanguage'/.test(store));

const appConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../app.json'), 'utf8'));
const localization = appConfig.expo.plugins.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-localization',
);
ok('Expo declares RTL-safe English and Arabic per-app locales',
  localization?.[1]?.supportsRTL === true &&
  ['ios', 'android'].every(
    (platform) => localization[1].supportedLocales?.[platform]?.join(',') === 'en,ar',
  ));

console.log(`\nsystem-language: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
