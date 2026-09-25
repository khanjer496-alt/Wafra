'use strict';
/**
 * AI category suggestions (`src/lib/on-device-category.ts`) through the
 * compiled shipping modules: deterministic merchant rules win, the model may
 * only return a closed expense category id (or "unsure"), and nothing is
 * written without the user's tap (the suggestion is advice only).
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const build = path.resolve(__dirname, '../build');
const { createOnDeviceAI } = require(path.join(build, 'on-device-ai.js'));
const {
  CATEGORY_SUGGESTION_SCHEMA, SUGGESTIBLE_EXPENSE_CATEGORIES, acceptModelCategory, createCategoryAdvisor, merchantForModel,
} = require(path.join(build, 'on-device-category.js'));
const { cancelLocalSemanticBackgroundWork } = require(path.join(build, 'local-semantic-background-policy.js'));
const { CATEGORIES } = require(path.join(build, 'categories.js'));

function advisor(reply, availability = { status: 'available', provider: 'apple-foundation-models', languages: ['en', 'ar'] }) {
  const calls = [];
  const native = {
    getAvailability: async () => availability,
    respond: async (...args) => { calls.push(args); return typeof reply === 'function' ? reply(...args) : reply; },
    cancel: async () => {},
    prepare: async () => availability,
  };
  return { advisor: createCategoryAdvisor(createOnDeviceAI(native)), calls };
}
const suggest = (a, merchant, extra = {}) => a.suggest({ merchant, appLanguage: 'en', ...extra });

test('only closed expense ids are offered; other, income and unknown ids are never accepted', () => {
  const choices = CATEGORY_SUGGESTION_SCHEMA.fields[0].choices;
  assert.deepEqual(choices, [...SUGGESTIBLE_EXPENSE_CATEGORIES, 'unsure']);
  assert.ok(!choices.includes('other') && !choices.includes('salary') && !choices.includes('business'));
  const expense = CATEGORIES.filter((category) => category.type === 'expense' && category.id !== 'other').map((c) => c.id);
  assert.deepEqual([...SUGGESTIBLE_EXPENSE_CATEGORIES], expense);
  for (const bad of ['unsure', 'other', 'salary', 'business', 'Groceries', 'food', '', null, 42, ['groceries']]) {
    assert.equal(acceptModelCategory(bad), null, String(bad));
  }
  assert.equal(acceptModelCategory('groceries'), 'groceries');
});

test('the user merchant rule wins and the model is never asked', async () => {
  const { advisor: a, calls } = advisor('{"category":"dining"}');
  const result = await suggest(a, 'ZX QUILLMORE', { overrides: { 'expense:zx quillmore': 'groceries' } });
  assert.deepEqual(result, { kind: 'rule', category: 'groceries' });
  assert.equal(calls.length, 0);
});

test('shipped vocabulary/activity rules win over the model', async () => {
  const { advisor: a, calls } = advisor('{"category":"travel"}');
  const result = await suggest(a, 'AL NOOR SUPERMARKET');
  assert.deepEqual(result, { kind: 'rule', category: 'groceries' });
  assert.equal(calls.length, 0);
});

test('an unresolved merchant gets a model suggestion from the closed list only', async () => {
  const { advisor: a, calls } = advisor('{"category":"groceries"}');
  const result = await suggest(a, 'ZX QUILLMORE');
  assert.equal(result.kind, 'on-device-ai');
  assert.equal(result.category, 'groceries');
  assert.equal(result.provider, 'apple-foundation-models');
  const [, task, , prompt, schemaJson, maxTokens] = calls[0];
  assert.equal(task, 'categorize');
  assert.equal(prompt, 'Merchant: ZX QUILLMORE', 'only the merchant name crosses to the model');
  assert.deepEqual(JSON.parse(schemaJson), JSON.parse(JSON.stringify(CATEGORY_SUGGESTION_SCHEMA)));
  assert.ok(maxTokens <= 64);
});

test('unsure, off-list, extra-field or unavailable replies give no suggestion', async () => {
  for (const reply of ['{"category":"unsure"}', '{"category":"other"}', '{"category":"salary"}',
    '{"category":"groceries","confidence":"high"}', 'groceries', '{"category":"Groceries"}']) {
    const { advisor: a } = advisor(reply);
    assert.equal((await suggest(a, 'ZX QUILLMORE 44')).kind, 'none', reply);
  }
  for (const status of ['unsupported-os', 'device-not-eligible', 'not-enabled', 'model-not-ready']) {
    const { advisor: a, calls } = advisor('{"category":"groceries"}', { status, provider: 'gemini-nano' });
    assert.deepEqual(await suggest(a, 'ZX QUILLMORE 44'), { kind: 'none', reason: 'unavailable' });
    assert.equal(calls.length, 0);
  }
});

test('long digit runs are masked and unusable names are not sent', async () => {
  assert.equal(merchantForModel('POS 123456789 ZX SHOP\u202E'), 'POS # ZX SHOP');
  assert.equal(merchantForModel('x'.repeat(200)).length, 80);
  const { advisor: a, calls } = advisor('{"category":"shopping"}');
  await suggest(a, 'ZX QUILLMORE 4111111111111111');
  assert.equal(calls[0][3], 'Merchant: ZX QUILLMORE #');
  assert.equal((await suggest(a, '12345678')).kind, 'none');
  assert.equal(calls.length, 1);
});

test('Arabic merchant names follow the platform language list', async () => {
  const englishOnly = advisor('{"category":"groceries"}', { status: 'available', provider: 'gemini-nano' });
  assert.deepEqual(await suggest(englishOnly.advisor, 'بقالة النور الحديثة للتجارة'),
    { kind: 'rule', category: 'groceries' }, 'Arabic activity words are still handled by rules');
  const unknown = await suggest(englishOnly.advisor, 'مؤسسة الفجر');
  assert.equal(unknown.kind, 'none');
  assert.equal(englishOnly.calls.length, 0);
});

test('suggestions are cached for the session and dropped on reset/background', async () => {
  const { advisor: a, calls } = advisor('{"category":"groceries"}');
  await suggest(a, 'ZX QUILLMORE 44');
  await suggest(a, 'zx quillmore 44');
  assert.equal(calls.length, 1);
  a.clear();
  await suggest(a, 'ZX QUILLMORE 44');
  assert.equal(calls.length, 2);

  const shared = require(path.join(build, 'on-device-category.js')).categoryAdvisor;
  assert.equal(typeof shared.clear, 'function');
  cancelLocalSemanticBackgroundWork(); // registered listener must not throw
});
