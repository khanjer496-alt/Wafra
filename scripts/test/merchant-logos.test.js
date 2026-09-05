const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
function compile(relative, require) {
  const filename = path.join(root, relative);
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  // No fetch, XMLHttpRequest, network modules, or user-data services in scope.
  vm.runInNewContext(output, { exports, require }, { filename });
  return exports;
}
const catalog = compile('src/components/ui/merchant-logo-assets.ts', (id) => {
  throw new Error(`Shipping catalog must not import unapproved artwork or services: ${id}`);
});
const samples = ['', 'Lulu Hypermarket', 'Carrefour', 'Careem', 'Talabat',
  'LuLu Exchange', 'لولو للصرافة', 'كريم', 'كَرِيم', 'كريم دبي',
  'Cafe near Carrefour', 'PayPal Talabat', 'Talabat Starbucks', 'Apple Cafe',
  'Netflix', 'Unknown Place', 'constructor', '__proto__', 'toString'];
for (const title of samples) {
  assert.equal(catalog.merchantLogoFor(title), null,
    `${title}: shipping uses category icons until artwork rights are established`);
}

let failed = false;
const jsx = (type, props, key) => ({ type, props, key });
function loadAvatar(identities) {
  return compile('src/components/ui/merchant-avatar.tsx', (id) => {
    switch (id) {
      case 'react/jsx-runtime': return { jsx, jsxs: jsx };
      case 'react': return { useState: () => [failed, (value) => { failed = value; }] };
      case 'react-native': return { StyleSheet: { create: (value) => value }, View: 'view' };
      case 'expo-image': return { Image: 'image' };
      case '@/components/ui/category-avatar': return { CategoryAvatar: 'category' };
      case '@/components/ui/merchant-logo-assets': return identities;
      case '@/constants/theme': return { Radius: { control: 12, tile: 8 } };
      default: throw new Error(`Unexpected runtime dependency: ${id}`);
    }
  }).MerchantAvatar;
}
const MerchantAvatar = loadAvatar(catalog);
for (const title of samples) {
  const fallback = MerchantAvatar({ title, category: 'other', size: 44 });
  assert.equal(fallback.type, 'category');
  assert.equal(fallback.props.category, 'other');
  assert.equal(fallback.props.size, 44);
}

// Exercise the retained image branch with an explicit synthetic asset fixture;
// no third-party logo is required or distributed by this test.
const PrototypeAvatar = loadAvatar({ merchantLogoFor: (title) =>
  title === 'QA Shop' ? { id: 'qa-one', source: 1 } : { id: 'qa-two', source: 2 } });
const known = PrototypeAvatar({ title: 'QA Shop', category: 'groceries', size: 44 });
assert.equal(known.key, 'qa-one', 'identity changes remount failed-image state');
const tile = known.type(known.props);
assert.equal(tile.props.accessibilityElementsHidden, true, 'merchant row supplies accessible identity');
const image = tile.props.children;
assert.equal(image.type, 'image');
assert.equal(image.props.source, 1);
assert.equal(image.props.contentFit, 'contain', 'preserve artwork proportions');
assert.equal(image.props.accessible, false);
image.props.onError();
assert.equal(known.type(known.props).type, 'category', 'an unreadable image falls back immediately');
assert.notEqual(PrototypeAvatar({ title: 'Another QA Shop', category: 'transport' }).key, known.key);
console.log('✓ empty shipping logo catalog, category fallback, synthetic image accessibility and failure recovery');
