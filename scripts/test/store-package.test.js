const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

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
  const assetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-store-assets-'));
  const { prepareStorePackage } = await import('../lib/store-package.mjs');
  const { APPLE_SCREENSHOT_TARGET } = await import('../lib/apple-screenshot-target.mjs');
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
    const googleEnglish = fs.readFileSync(
      path.join(output, 'google/metadata/android/en-US/short_description.txt'),
      'utf8',
    ).trim();
    const ascAppInfo = JSON.parse(fs.readFileSync(
      path.join(output, 'apple/asc-metadata/app-info/en-US.json'),
      'utf8',
    ));
    const ascVersion = JSON.parse(fs.readFileSync(
      path.join(output, 'apple/asc-metadata/version/1.0.0/en-US.json'),
      'utf8',
    ));
    ok('canonical metadata generates only the required Apple launch locale',
      manifest.appleLocales.join(',') === 'en-US', manifest.appleLocales.join(','));
    ok('canonical metadata generates only active Google Play launch locales',
      manifest.googleLocales.join(',') === 'en-US', manifest.googleLocales.join(','));
    ok('generated Apple metadata preserves the reviewed listing name',
      appleName === 'Wafra: Budget & Money Tracker', appleName);
    ok('generated Google metadata preserves the global English listing copy',
      googleEnglish === JSON.parse(fs.readFileSync(
        path.join(root, 'docs/store-metadata.json'), 'utf8',
      )).googlePlay.listings['global-en'].shortDescription, googleEnglish);
    ok('generated asc app-info metadata preserves the reviewed listing identity',
      ascAppInfo.name === 'Wafra: Budget & Money Tracker' && Boolean(ascAppInfo.subtitle));
    ok('generated asc version metadata preserves the global English copy',
      ascVersion.description.includes('without connecting a bank account') && Boolean(ascVersion.keywords));
    ok('optional Arabic metadata is not made a launch prerequisite',
      !fs.existsSync(path.join(output, 'apple/metadata/ar-SA')) &&
      !fs.existsSync(path.join(output, 'google/metadata/android/ar')));
    ok('generated manifest pins metadata to the configured App Store version',
      manifest.appStoreVersion === '1.0.0', manifest.appStoreVersion);
    ok('metadata-only preparation never implies screenshots were reviewed',
      manifest.assetsIncluded === false);
    const sourcePricing = JSON.parse(fs.readFileSync(path.join(root, 'docs/store-pricing.json'), 'utf8'));
    const packagedManifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
    ok('generated package manifest preserves the pricing decision and its storefront evidence',
      isDeepStrictEqual(packagedManifest.pricing, sourcePricing));

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

    // Real packaging behaviour, using disposable placeholder bytes (not images).
    fs.mkdirSync(path.join(assetsRoot, 'docs'), { recursive: true });
    for (const file of ['store-pricing.json', 'store-metadata.json']) {
      fs.copyFileSync(path.join(root, 'docs', file), path.join(assetsRoot, 'docs', file));
    }
    fs.copyFileSync(path.join(root, 'app.json'), path.join(assetsRoot, 'app.json'));
    const appleAssets = path.join(assetsRoot, 'docs/store-assets/appstore');
    const playAssets = path.join(assetsRoot, 'docs/store-assets/play/global-en');
    fs.mkdirSync(appleAssets, { recursive: true });
    fs.mkdirSync(playAssets, { recursive: true });
    const expectedNames = [];
    for (let i = 1; i <= 8; i += 1) {
      const name = `appstore-6.3-en-${String(i).padStart(2, '0')}.png`;
      expectedNames.push(name);
      fs.writeFileSync(path.join(appleAssets, name), `current candidate ${i}`);
      fs.writeFileSync(path.join(appleAssets, `appstore-6.9-dark-en-${i}.png`), `obsolete ${i}`);
      fs.writeFileSync(path.join(playAssets, `${i}.png`), `unchanged android ${i}`);
    }
    fs.writeFileSync(path.join(assetsRoot, 'docs/store-assets/play/global-en-feature-graphic.png'), 'android graphic');
    const assetsOutput = path.join(assetsRoot, 'artifacts/store-package');
    await prepareStorePackage({ root: assetsRoot, output: assetsOutput, includeAssets: true });
    const packagedApple = path.join(assetsOutput, 'apple/screenshots/en-US');
    ok('asset packaging copies only the eight new medium-display captures',
      isDeepStrictEqual(fs.readdirSync(packagedApple).sort(), expectedNames) &&
        fs.readFileSync(path.join(packagedApple, fs.readdirSync(packagedApple)[0]), 'utf8').startsWith('current candidate'));
    for (const name of expectedNames) fs.unlinkSync(path.join(appleAssets, name));
    let rejectedObsoleteAssets = false;
    try {
      await prepareStorePackage({ root: assetsRoot, output: assetsOutput, includeAssets: true });
    } catch (error) {
      rejectedObsoleteAssets = /Apple en-US requires 8 screenshots; found 0/.test(error.message);
    }
    ok('old screenshots cannot satisfy packaging when the new captures are absent', rejectedObsoleteAssets);

    const screenshotMetadata = JSON.parse(fs.readFileSync(path.join(root, 'docs/store-metadata.json'), 'utf8')).screenshots.apple;
    ok('metadata and capture geometry agree with the approved medium target',
      screenshotMetadata.pixels === '1206x2622' &&
      screenshotMetadata.pixels === `${APPLE_SCREENSHOT_TARGET.width}x${APPLE_SCREENSHOT_TARGET.height}` &&
      APPLE_SCREENSHOT_TARGET.logicalWidth * APPLE_SCREENSHOT_TARGET.scale === 1206 &&
      APPLE_SCREENSHOT_TARGET.logicalHeight * APPLE_SCREENSHOT_TARGET.scale === 2622);

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
    ok('asc screenshot preview and apply both target the medium-display slot',
      [screenshotPreview, screenshotApply].every((plan) => {
        const args = plan.commands[0].args;
        return args[args.indexOf('--device-type') + 1] === 'IPHONE_61' && !args.includes('IPHONE_69');
      }));
    ok('asc screenshot preview is always a dry run',
      screenshotPreview.commands[0].args.includes('--dry-run'));
    ok('asc screenshot apply requires confirmation and preserves existing screenshots',
      screenshotApply.confirmation === ASC_SCREENSHOT_CONFIRMATION &&
      screenshotApply.commands[0].args.includes('--skip-existing') &&
      !screenshotApply.commands[0].args.includes('--replace'));
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
    fs.rmSync(malformedRoot, { recursive: true, force: true });
    fs.rmSync(assetsRoot, { recursive: true, force: true });
  }

  console.log(`\nstore-package: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
