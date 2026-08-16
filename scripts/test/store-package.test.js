const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

(async () => {
  const root = path.resolve(__dirname, '../..');
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-store-package-'));
  const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-store-malformed-'));
  const { prepareStorePackage } = await import('../lib/store-package.mjs');

  try {
    let rejectedOutsideArtifacts = false;
    try {
      await prepareStorePackage({ root, output });
    } catch {
      rejectedOutsideArtifacts = true;
    }
    ok('store packaging refuses arbitrary output directories', rejectedOutsideArtifacts);

    const manifest = await prepareStorePackage({ root, output, allowOutsideRoot: true });
    const appleName = fs.readFileSync(
      path.join(output, 'apple/metadata/en-US/name.txt'),
      'utf8',
    ).trim();
    const googleArabic = fs.readFileSync(
      path.join(output, 'google/metadata/android/ar/short_description.txt'),
      'utf8',
    ).trim();
    ok('canonical metadata generates both Apple launch locales',
      manifest.appleLocales.join(',') === 'en-US,ar-SA', manifest.appleLocales.join(','));
    ok('canonical metadata generates only active Google Play launch locales',
      manifest.googleLocales.join(',') === 'en-US,ar', manifest.googleLocales.join(','));
    ok('generated Apple metadata preserves the reviewed listing name',
      appleName === 'Wafra: Budget & Money Tracker', appleName);
    ok('generated Google metadata preserves localized Arabic copy',
      googleArabic.includes('بخصوصية'), googleArabic);
    ok('metadata-only preparation never implies screenshots were reviewed',
      manifest.assetsIncluded === false);
    ok('generated manifest keeps live pricing approval blocked',
      manifest.pricing.approvalStatus === 'pending-commercial-approval');

    let rejectedUnsafeOutput = false;
    try {
      await prepareStorePackage({ root, output: root, allowOutsideRoot: true });
    } catch {
      rejectedUnsafeOutput = true;
    }
    ok('store packaging refuses to replace the repository root', rejectedUnsafeOutput);

    fs.mkdirSync(path.join(malformedRoot, 'docs'), { recursive: true });
    fs.copyFileSync(
      path.join(root, 'docs/store-pricing.json'),
      path.join(malformedRoot, 'docs/store-pricing.json'),
    );
    const malformedMetadata = JSON.parse(
      fs.readFileSync(path.join(root, 'docs/store-metadata.json'), 'utf8'),
    );
    malformedMetadata.apple.locales['../../escaped'] = malformedMetadata.apple.locales['en-US'];
    fs.writeFileSync(
      path.join(malformedRoot, 'docs/store-metadata.json'),
      `${JSON.stringify(malformedMetadata)}\n`,
    );
    let rejectedMalformedLocale = false;
    try {
      await prepareStorePackage({
        root: malformedRoot,
        output: path.join(malformedRoot, 'artifacts/store-package'),
      });
    } catch {
      rejectedMalformedLocale = true;
    }
    ok('store packaging rejects locale path traversal before writing', rejectedMalformedLocale);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
    fs.rmSync(malformedRoot, { recursive: true, force: true });
  }

  console.log(`\nstore-package: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
