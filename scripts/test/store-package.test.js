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
  const {
    ASC_METADATA_CONFIRMATION,
    ASC_SCREENSHOT_CONFIRMATION,
    buildAppStoreConnectPlan,
  } = await import('../lib/app-store-connect-cli.mjs');

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
    const ascAppInfo = JSON.parse(fs.readFileSync(
      path.join(output, 'apple/asc-metadata/app-info/en-US.json'),
      'utf8',
    ));
    const ascVersion = JSON.parse(fs.readFileSync(
      path.join(output, 'apple/asc-metadata/version/1.0.0/ar-SA.json'),
      'utf8',
    ));
    ok('canonical metadata generates both Apple launch locales',
      manifest.appleLocales.join(',') === 'en-US,ar-SA', manifest.appleLocales.join(','));
    ok('canonical metadata generates only active Google Play launch locales',
      manifest.googleLocales.join(',') === 'en-US,ar', manifest.googleLocales.join(','));
    ok('generated Apple metadata preserves the reviewed listing name',
      appleName === 'Wafra: Budget & Money Tracker', appleName);
    ok('generated Google metadata preserves localized Arabic copy',
      googleArabic.includes('بخصوصية'), googleArabic);
    ok('generated asc app-info metadata preserves the reviewed listing identity',
      ascAppInfo.name === 'Wafra: Budget & Money Tracker' && Boolean(ascAppInfo.subtitle));
    ok('generated asc version metadata preserves localized Arabic copy',
      ascVersion.description.includes('وفرة') && Boolean(ascVersion.keywords));
    ok('generated manifest pins metadata to the configured App Store version',
      manifest.appStoreVersion === '1.0.0', manifest.appStoreVersion);
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
    fs.copyFileSync(path.join(root, 'app.json'), path.join(malformedRoot, 'app.json'));
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

    const ascContext = {
      appId: '6799171482',
      version: '1.0.0',
      metadataDir: '/tmp/metadata',
      screenshotsDir: '/tmp/screenshots',
    };
    const metadataPreview = buildAppStoreConnectPlan('metadata-preview', ascContext);
    const metadataApply = buildAppStoreConnectPlan('metadata-apply', ascContext);
    const screenshotPreview = buildAppStoreConnectPlan('screenshots-preview', ascContext);
    const screenshotApply = buildAppStoreConnectPlan('screenshots-apply', ascContext);
    const authPlan = buildAppStoreConnectPlan('auth', ascContext);
    const subscriptionAudit = buildAppStoreConnectPlan('subscriptions-audit', ascContext);
    ok('asc auth checks that the active environment or profile can access Wafra',
      authPlan.commands.some(({ args }) =>
        args.join(' ') === 'apps view --id 6799171482 --output table'));
    ok('asc auth does not validate unrelated stored profiles',
      authPlan.commands.every(({ args }) => !args.includes('--validate')));
    ok('asc subscription audit includes products and review versions',
      subscriptionAudit.commands[0].args.includes('subscriptions,versions'));
    ok('asc metadata preview is always a dry run',
      metadataPreview.commands[0].args.includes('--dry-run'));
    ok('asc metadata apply requires the exact live-write confirmation',
      metadataApply.confirmation === ASC_METADATA_CONFIRMATION);
    ok('asc metadata workflows never delete remote locales',
      !metadataPreview.commands[0].args.includes('--allow-deletes') &&
      !metadataApply.commands[0].args.includes('--allow-deletes'));
    ok('asc screenshot preview is always a dry run',
      screenshotPreview.commands[0].args.includes('--dry-run'));
    ok('asc screenshot apply requires confirmation and preserves existing screenshots',
      screenshotApply.confirmation === ASC_SCREENSHOT_CONFIRMATION &&
      screenshotApply.commands[0].args.includes('--skip-existing') &&
      !screenshotApply.commands[0].args.includes('--replace'));
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
