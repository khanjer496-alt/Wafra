'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('../../universal-test/load-ts.cjs');
const load = createLoader();
const { t } = load('@/lib/i18n');
const { SUPPLEMENT_COPY } = load('@/lib/supplement-copy');
const { importProcessingDisclosure, STATEMENT_PROCESSING_DISCLOSURE } = load('@/lib/import-processing-disclosure');
for (const language of ['en', 'ar']) test(`Import processing boundaries stay truthful and consistent in ${language}`, () => {
  const android = importProcessingDisclosure(language, 'android');
  const ios = importProcessingDisclosure(language, 'ios');
  const web = importProcessingDisclosure(language, 'web');
  assert.ok(t('pasteHint', language).endsWith(android));
  assert.ok(t('pasteHintIos', language).endsWith(ios));
  assert.ok(t('pasteHintWeb', language).endsWith(web));
  assert.equal(t('iosLocalUnsupportedBody', language), ios);
  assert.equal(SUPPLEMENT_COPY[language].uploadDisclosure, web);
  for (const line of [android, ios, web]) assert.ok(line.endsWith(STATEMENT_PROCESSING_DISCLOSURE[language]));
  if (language === 'en') {
    assert.match(android, /Pasted messages and SMS are read on this device/);
    assert.doesNotMatch(ios, /SMS are read on this device/);
    assert.match(ios, /older online Shortcut.*sends captured messages to Wafra’s server/);
    assert.doesNotMatch(t('pasteHint', language), /Everything is read/);
  } else {
    assert.match(android, /الرسائل الملصقة ورسائل SMS على هذا الجهاز/);
    assert.match(ios, /اختصاراً قديماً يعمل عبر الإنترنت/);
    assert.match(ios, /خادم وفرة لقراءتها/);
  }
});
