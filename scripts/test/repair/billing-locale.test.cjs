'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const load = require('./load-typescript.cjs');
const { billingLocaleIdentifier } = load(path.resolve(__dirname, '../../../src/lib/billing-locale.ts'));

test('billing locale keeps the chosen language and actual device region separate', () => {
  for (const [language, region, want] of [
    ['en', 'JP', 'en_JP'],
    ['en', 'US', 'en_US'],
    ['en', 'GB', 'en_GB'],
    ['ar', 'KW', 'ar_KW'],
    ['ar', 'SA', 'ar_SA'],
    ['en', 'AE', 'en_AE'],
    ['fr', 'GB', 'fr_GB'],
    ['pt', 'PT', 'pt_PT'],
    ['zh-Hant', 'HK', 'zh_Hant_HK'],
    ['sr-Latn', 'DE', 'sr_Latn_DE'],
  ]) assert.equal(billingLocaleIdentifier(language, region), want, `${language}/${region}`);
});

test('missing device region uses an explicit language-region preference without inventing UAE', () => {
  assert.equal(billingLocaleIdentifier('en-GB', null), 'en_GB');
  assert.equal(billingLocaleIdentifier('zh-Hans-CN'), 'zh_Hans_CN');
  assert.equal(billingLocaleIdentifier('en'), 'en');
  assert.equal(billingLocaleIdentifier('ar', ''), 'ar');
});

test('an explicitly selected regional language variant is preserved', () => {
  assert.equal(billingLocaleIdentifier('fr-CA', 'GB'), 'fr_CA');
  assert.equal(billingLocaleIdentifier('pt-BR', 'PT'), 'pt_BR');
  assert.equal(billingLocaleIdentifier('zh-Hant-TW', 'HK'), 'zh_Hant_TW');
});

test('billing locale normalizes casing, script and separators at the SDK boundary', () => {
  assert.equal(billingLocaleIdentifier('  ZH_hant ', ' hk '), 'zh_Hant_HK');
  assert.equal(billingLocaleIdentifier('fil-PH', 'ph'), 'fil_PH');
  assert.equal(billingLocaleIdentifier('en-001'), 'en_001');
  assert.equal(billingLocaleIdentifier('en-US-u-nu-arab', 'GB'), 'en_US');
});

test('malformed locale inputs fall back to English without fabricating a region', () => {
  assert.equal(billingLocaleIdentifier('', null), 'en');
  assert.equal(billingLocaleIdentifier('not a locale', 'JP'), 'en_JP');
  assert.equal(billingLocaleIdentifier('en--US', 'Japan'), 'en');
  assert.equal(billingLocaleIdentifier('ar-KW', 'not-a-region'), 'ar_KW');
});
