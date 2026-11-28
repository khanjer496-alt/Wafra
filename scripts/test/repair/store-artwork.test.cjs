'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]);

// 1.0.2: every merchant and bank logo is fetched from Brandfetch at run time and
// cached on the phone. No third-party mark ships inside the app or its widgets
// (the trademark reason from 1.0 stays), and Brandfetch is the only logo host.
test('store sources contain no bundled third-party artwork require', () => {
  for (const dir of ['src', 'modules', 'targets']) for (const file of files(path.join(root, dir))) {
    if (!/\.(?:tsx?|swift|kt|java|json|js)$/.test(file)) continue;
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /require\([^)]*assets\/merchants|R\.drawable\.wafra_logo_|Image\("wafra_logo_/,
      path.relative(root, file));
  }
  assert.equal(fs.existsSync(path.join(root, 'src/components/ui/merchant-logo-assets.ts')), false, 'no bundled require map');
});

test('no third-party mark is present in app or native widget assets', () => {
  assert.deepEqual(files(path.join(root, 'assets/merchants')).filter(f => /\.(png|svg|webp|jpe?g)$/i.test(f)), []);
  for (const dir of ['targets/widget/Assets.xcassets', 'modules/wafra-widgets/android/src/main/res']) {
    assert.deepEqual(files(path.join(root, dir)).filter(f => /wafra_logo_/.test(f)), [], dir);
  }
});

test('Brandfetch is the only logo host, reached only through the validated URL builders', () => {
  const hosts = new Set();
  for (const file of files(path.join(root, 'src'))) {
    if (!/\.tsx?$/.test(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const [host] of source.matchAll(/(?:api|cdn)\.brandfetch\.io|logo\.dev|logo\.clearbit\.com|google\.com\/s2\/favicons/g)) {
      hosts.add(`${path.relative(root, file)} ${host}`);
    }
  }
  assert.deepEqual([...hosts].sort(), [
    'src/lib/verified-logo-identities.ts api.brandfetch.io',
    'src/lib/verified-logo-identities.ts cdn.brandfetch.io',
  ]);
});
