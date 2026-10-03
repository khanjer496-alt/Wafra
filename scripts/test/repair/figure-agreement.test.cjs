'use strict';

// Figures that two surfaces print for the same thing must agree: the Spending
// category sheet and the category list print one share label.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const { createHarness, walk, text } = require('./reference-harness.cjs');

// Read shipping sources without rebuilding the shared full-suite directory.
function load(name, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../../../src/lib', `${name}.ts`), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)(id => {
    if (Object.hasOwn(dependencies, id)) return dependencies[id];
    assert.ok(id.startsWith('@/lib/'), `unexpected dependency ${id}`);
    return require(path.join(__dirname, '../build', id.slice('@/lib/'.length)));
  }, module, module.exports);
  return module.exports;
}

const presentation = load('reference-presentation');

const sheetShare = tree => {
  const sheet = walk(tree).find(n => n.type === 'Sheet');
  assert.ok(sheet, 'category sheet open');
  const line = walk(sheet).find(n => n.type === 'Text' || n.props?.children !== undefined
    ? /of spending|من الإنفاق/.test(text(n)) && !walk(n).slice(1).some(c => /of spending|من الإنفاق/.test(text(c)))
    : false);
  assert.ok(line, 'share line in sheet');
  return text(line).replace(/\s+/g, ' ').trim();
};
const listShare = (tree, category) => text(walk(tree).find(n => n.props?.testID === `spending-share-${category}`))
  .replace(/\s+/g, ' ').trim();

test('the category sheet prints the same share label as the category list', () => {
  // states[5] is the selected category, by hook order (see reference-redesign.test.cjs).
  for (const category of ['dining', 'other', 'transport']) {
    const tree = createHarness({ states: { 5: category } }).render('flow');
    const label = listShare(tree, category).match(/^\S+/)[0];
    assert.equal(sheetShare(tree), `${label} of spending`, category);
  }
  // Dining is 620 of 5,360: the list says 11.6%; a rounded sheet said 12%.
  assert.equal(sheetShare(createHarness({ states: { 5: 'dining' } }).render('flow')), '11.6% of spending');
});

test('a sub-one-percent category is not "0%" on the sheet when the list says otherwise', () => {
  const extra = { id: 'tiny', title: 'Pharmacy', amountFils: 2200, category: 'health', date: '2026-09-04',
    type: 'expense', accountId: 'enbd', source: 'sms' };
  const base = createHarness().deps['@/lib/store'].useStore().state.transactions;
  for (const language of ['en', 'ar']) {
    const tree = createHarness({ language, states: { 5: 'health' }, state: { transactions: [...base, extra] } }).render('flow');
    const sheet = sheetShare(tree);
    assert.doesNotMatch(sheet, /^0%|^٠٪/);
    const expected = presentation.spendingShareLabel(presentation.spendingShare(2200, 536000 + 2200), language);
    assert.ok(sheet.startsWith(expected), `${language}: ${sheet} vs ${expected}`);
    assert.ok(listShare(tree, 'health').startsWith(expected), `${language} list`);
  }
});
