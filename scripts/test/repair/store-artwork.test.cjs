'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]);

test('store sources contain no logo host, remote resolver or third-party artwork require', () => {
  for (const dir of ['src', 'modules', 'targets']) for (const file of files(path.join(root, dir))) {
    if (!/\.(?:tsx?|swift|kt|java|json|js)$/.test(file)) continue;
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /(?:api|cdn)\.brandfetch\.io|require\([^)]*assets\/merchants|R\.drawable\.wafra_logo_|Image\("wafra_logo_/,
      path.relative(root, file));
  }
  for (const file of ['src/lib/merchant-logo-resolver.ts', 'src/lib/bank-logo-resolver.ts', 'src/lib/verified-logo-identities.ts', 'src/components/ui/merchant-logo-assets.ts']) {
    assert.equal(fs.existsSync(path.join(root, file)), false, file + ' must be removed');
  }
});

test('no third-party mark is present in app or native widget assets', () => {
  assert.deepEqual(files(path.join(root, 'assets/merchants')).filter(f => /\.(png|svg|webp|jpe?g)$/i.test(f)), []);
  for (const dir of ['targets/widget/Assets.xcassets', 'modules/wafra-widgets/android/src/main/res']) {
    assert.deepEqual(files(path.join(root, dir)).filter(f => /wafra_logo_/.test(f)), [], dir);
  }
});
