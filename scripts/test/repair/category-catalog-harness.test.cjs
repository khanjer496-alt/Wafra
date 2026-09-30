'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const load = require('./load-typescript.cjs');

for (const selectors of [false, true]) test(`shared loader keeps real category lookup reactive with ${selectors ? 'selector' : 'legacy'} store boundary`, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-catalog-harness-'));
  try {
    const file = path.join(directory, 'consumer.ts');
    fs.writeFileSync(file, "export { useCategoryCatalog } from '@/hooks/use-category-catalog'; export { isValidCustomCategoryCatalog } from '@/lib/custom-categories';");
    const id = 'custom:income:' + 'b'.repeat(32);
    let state = { customCategories: [{ id, name: 'Synthetic royalties', type: 'income' }] };
    let selections = 0;
    const store = selectors ? { useStoreSelector: selector => { selections++; return selector({ state }); } }
      : { useStore: () => { selections++; return { state }; } };
    const dependencies = { react: { useMemo: factory => factory() }, '@/lib/store': store };
    let unrelatedLoads = 0;
    Object.defineProperty(dependencies, '@/lib/widget-ledger', { enumerable: true, get() {
      unrelatedLoads++;
      throw new Error('Unrelated lazy module must not load for the category hook');
    } });
    const subject = load(file, dependencies);
    const before = subject.useCategoryCatalog();
    assert.equal(before.categoryLabel(id, 'en'), 'Synthetic royalties');
    assert.ok(before.incomeCategories.some(category => category.id === id));
    assert.ok(!before.expenseCategories.some(category => category.id === id));
    assert.equal(subject.isValidCustomCategoryCatalog(state.customCategories), true);
    state = { customCategories: [{ id, name: 'Restored royalties', type: 'income' }] };
    const after = subject.useCategoryCatalog();
    assert.equal(after.categoryLabel(id, 'ar'), 'Restored royalties');
    assert.equal(after.catalog, state.customCategories);
    assert.equal(selections, 2);
    assert.equal(unrelatedLoads, 0, 'loading the hook preserves unrelated lazy dependency boundaries');
    assert.equal(subject.isValidCustomCategoryCatalog([{ ...state.customCategories[0], type: 'expense' }]), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
