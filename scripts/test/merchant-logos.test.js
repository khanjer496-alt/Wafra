const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createHash } = require('node:crypto');

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
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/merchants/sources.json'), 'utf8'));
const assets = new Map();
const catalog = compile('src/components/ui/merchant-logo-assets.ts', (id) => {
  assert.match(id, /^\.\.\/\.\.\/\.\.\/assets\/merchants\/[a-z0-9]+\.png$/,
    'runtime may only import the bundled PNG allowlist, never a network/data service');
  const file = path.basename(id);
  const evidence = manifest.find(row => row.file === file);
  assert.ok(evidence, `missing provenance for ${file}`);
  const bytes = fs.readFileSync(path.join(root, 'assets/merchants', file));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.readUInt32BE(16), 128, `${file}: width`);
  assert.equal(bytes.readUInt32BE(20), 128, `${file}: height`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), evidence.sha256, `${file}: reviewed bytes`);
  assert.equal(bytes.length, evidence.bytes);
  assert.match(evidence.sourceUrl, /^https:\/\//);
  assert.ok(evidence.retrievedOn && evidence.transformation);
  assets.set(file, assets.size + 1);
  return assets.get(file);
});
const matches = {
  Careem: 'careem', 'Careem Food': 'careem', 'كَرِيم دبي': 'careem',
  Talabat: 'talabat', 'طلبات': 'talabat', 'Talabat.com UAE': 'talabat',
  Deliveroo: 'deliveroo', 'Carrefour': 'carrefour', 'CARREFOUR HYPER #004 DUBAI ARE': 'carrefour',
  'كارفور الشارقة': 'carrefour', 'Lulu Hypermarket': 'lulu', 'LuLu Hyper Market': 'lulu',
  'لُولُو هايبرماركت': 'lulu', Spinneys: 'spinneys', 'Noon.com': 'noon', 'نون': 'noon',
  'Amazon.ae': 'amazon', 'Amazon Prime': 'amazon', 'أمازون': 'amazon',
  Netflix: 'netflix', 'NETFLIX.COM': 'netflix', 'Spotify Premium': 'spotify',
  'YouTube Premium': 'youtube', 'GOOGLE *YOUTUBE PREMIUM': 'youtube',
  'Apple.com/bill': 'apple', 'iCloud+': 'apple', 'Apple Store US': 'apple',
  'Google One': 'google', 'Starbucks Coffee': 'starbucks', 'ستاربكس': 'starbucks',
  "McDonald’s": 'mcdonalds', KFC: 'kfc', IKEA: 'ikea', 'Uber *Trip': 'uber',
  Emirates: 'emirates', 'طيران الإمارات': 'emirates', 'Booking.com': 'bookingdotcom',
  Airbnb: 'airbnb', Claude: 'claude', Anthropic: 'claude', 'GitHub Copilot': 'github',
  Notion: 'notion', 'Discord Nitro': 'discord', 'Telegram Premium': 'telegram', Dropbox: 'dropbox',
  'RTA Nol Top-up': 'rta', 'ENOC Fuel': 'enoc', 'EPPCO': 'enoc', 'ADNOC Oasis': 'adnoc',
  'du Home Internet': 'du', 'Etisalat Postpaid': 'etisalat', 'e& UAE': 'etisalat',
  'OSN+': 'osn', 'DEWA Bill': 'dewa', '  Ｃａｒｅｅｍ  ': 'careem',
};
for (const [title, id] of Object.entries(matches)) {
  const logo = catalog.merchantLogoFor(title);
  assert.equal(logo?.id, id, `${title}: correct bundled identity`);
  assert.equal(typeof logo.source, 'number', 'Metro static asset ID, not a URL');
  assert.equal(logo.source, assets.get(id + '.png'));
  assert.equal(catalog.merchantLogoFor(title), logo, 'stable identity avoids allocations in scrolling rows');
  assert.ok(Object.isFrozen(logo), 'callers cannot mutate shared merchant identity');
}
assert.equal(new Set(Object.values(matches)).size, assets.size, 'every shipped brand has a positive test');
assert.equal(assets.size, 34, 'an empty or accidentally reduced catalogue must fail');
assert.equal(manifest.length, assets.size, 'provenance and shipped assets stay in sync');
assert.deepEqual(fs.readdirSync(path.join(root, 'assets/merchants')).filter(file => file.endsWith('.png')).sort(), [...assets.keys()].sort());
assert.ok(manifest.reduce((sum, row) => sum + row.bytes, 0) < 512 * 1024, 'keep the offline logo pack small');

const samples = ['', null, undefined, 123, 'LuLu Exchange', 'Lulu International Exchange',
  'لولو للصرافة', 'كريم للبشرة', 'Cafe near Carrefour', 'PayPal Talabat',
  'Talabat Starbucks', 'Apple Cafe', 'Pineapple Cafe', 'Amazon Cafe', 'Noon Saloon',
  'Emirates NBD', 'Emirates Islamic Dubai', 'Emirates Cooperative Society',
  'Uberoi Restaurant', 'Notionally Trading', 'Shop at IKEA', 'Google Unknown Shop',
  'ADNOC employee transfer', 'DU BAI CAFE', 'Unknown Place', 'constructor', '__proto__',
  'toString', 'https://merchant.invalid/logo.png', 'Careem' + ' '.repeat(241),
  'Carrefour\nContact support', 'Talabat; Starbucks'];
for (const title of samples) {
  assert.equal(catalog.merchantLogoFor(title), null,
    `${title}: ambiguous/unrecognised merchants must use the category fallback`);
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
assert.equal(image.props.cachePolicy, 'memory-disk');
assert.equal(image.props.recyclingKey, 'qa-one');
assert.equal(image.props.transition, 0, 'no row animations or logo cross-fades while scrolling');
image.props.onError();
assert.equal(known.type(known.props).type, 'category', 'an unreadable image falls back immediately');
assert.notEqual(PrototypeAvatar({ title: 'Another QA Shop', category: 'transport' }).key, known.key);
failed = false;
const real = MerchantAvatar({ title: 'Lulu Hypermarket', category: 'groceries', size: 64 });
assert.equal(real.key, 'lulu');
assert.equal(real.type(real.props).props.testID, 'merchant-logo-lulu');
const detail = fs.readFileSync(path.join(root, 'src/components/entry-detail-sheet.tsx'), 'utf8');
assert.match(detail, /MerchantAvatar title=\{transaction.title\} category=\{transaction.category\} size=\{64\}/);
console.log(`✓ ${assets.size} bundled logos; ${Object.keys(matches).length} identity cases; ${samples.length} negative cases; asset integrity, privacy, accessibility and failure recovery`);
