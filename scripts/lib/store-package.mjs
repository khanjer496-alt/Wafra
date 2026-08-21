import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { writeAppStoreConnectMetadata } from './app-store-connect-package.mjs';

const APPLE_LAUNCH_LOCALES = ['ar-SA', 'en-US'];
const GOOGLE_LAUNCH_LOCALES = ['ar', 'en-US'];

const assertExactValues = (actual, expected, label) => {
  const normalized = [...actual].sort();
  if (JSON.stringify(normalized) !== JSON.stringify(expected)) {
    throw new Error(`${label} must be exactly ${expected.join(', ')}`);
  }
};

const writeText = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${value.trim()}\n`, 'utf8');
};

const isInside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
};

const resetOutput = async (root, output, allowOutsideRoot) => {
  const resolvedRoot = path.resolve(root);
  const resolvedOutput = path.resolve(output);
  if (resolvedOutput === resolvedRoot || path.dirname(resolvedOutput) === resolvedOutput) {
    throw new Error(`Refusing to replace unsafe store-package output: ${resolvedOutput}`);
  }
  const artifactsRoot = path.join(resolvedRoot, 'artifacts');
  if (!allowOutsideRoot && !isInside(artifactsRoot, resolvedOutput)) {
    throw new Error(`Store-package output must be inside ${artifactsRoot}`);
  }
  await rm(resolvedOutput, { recursive: true, force: true });
  await mkdir(resolvedOutput, { recursive: true });
};

const writeAppleMetadata = async (output, metadata) => {
  const fields = {
    name: 'name.txt',
    subtitle: 'subtitle.txt',
    keywords: 'keywords.txt',
    promotionalText: 'promotional_text.txt',
    description: 'description.txt',
  };
  for (const [locale, entry] of Object.entries(metadata.apple.locales)) {
    for (const [field, filename] of Object.entries(fields)) {
      await writeText(path.join(output, 'apple', 'metadata', locale, filename), entry[field]);
    }
  }
};

const writeGoogleMetadata = async (output, metadata) => {
  const fields = {
    title: 'title.txt',
    shortDescription: 'short_description.txt',
    fullDescription: 'full_description.txt',
  };
  for (const listingName of metadata.googlePlay.launchListings) {
    const entry = metadata.googlePlay.listings[listingName];
    const localeRoot = path.join(output, 'google', 'metadata', 'android', entry.languageCode);
    for (const [field, filename] of Object.entries(fields)) {
      await writeText(path.join(localeRoot, filename), entry[field]);
    }
  }
};

const copyMatching = async ({ source, destination, predicate }) => {
  const names = (await readdir(source)).filter(predicate).sort();
  await mkdir(destination, { recursive: true });
  for (const name of names) {
    await cp(path.join(source, name), path.join(destination, name));
  }
  return names.length;
};

const copyAppleAssets = async (root, output) => {
  const source = path.join(root, 'docs', 'store-assets', 'appstore');
  const locales = { 'en-US': 'appstore-6.9-dark-en-', 'ar-SA': 'appstore-6.9-dark-ar-' };
  for (const [locale, prefix] of Object.entries(locales)) {
    const count = await copyMatching({
      source,
      destination: path.join(output, 'apple', 'screenshots', locale),
      predicate: (name) => name.startsWith(prefix) && name.endsWith('.png'),
    });
    if (count !== 8) throw new Error(`Apple ${locale} requires 8 screenshots; found ${count}`);
  }
};

const copyGoogleAssets = async (root, output) => {
  const locales = { 'en-US': 'gulf-en', ar: 'gulf-ar' };
  for (const [locale, sourceLocale] of Object.entries(locales)) {
    const localeRoot = path.join(output, 'google', 'metadata', 'android', locale, 'images');
    const count = await copyMatching({
      source: path.join(root, 'docs', 'store-assets', 'play', sourceLocale),
      destination: path.join(localeRoot, 'phoneScreenshots'),
      predicate: (name) => name.endsWith('.png'),
    });
    if (count !== 8) throw new Error(`Google Play ${locale} requires 8 screenshots; found ${count}`);
    await mkdir(localeRoot, { recursive: true });
    await cp(
      path.join(root, 'docs', 'store-assets', 'play', `${sourceLocale}-feature-graphic.png`),
      path.join(localeRoot, 'featureGraphic.png'),
    );
  }
};

export const prepareStorePackage = async ({
  root,
  output,
  includeAssets = false,
  allowOutsideRoot = false,
}) => {
  const [metadata, pricing, appConfig] = await Promise.all([
    readFile(path.join(root, 'docs', 'store-metadata.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'docs', 'store-pricing.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'app.json'), 'utf8').then(JSON.parse),
  ]);
  assertExactValues(Object.keys(metadata.apple.locales), APPLE_LAUNCH_LOCALES, 'Apple locales');
  assertExactValues(
    metadata.googlePlay.launchListings.map(
      (listing) => metadata.googlePlay.listings[listing]?.languageCode,
    ),
    GOOGLE_LAUNCH_LOCALES,
    'Google Play launch locales',
  );
  await resetOutput(root, output, allowOutsideRoot);
  await Promise.all([
    writeAppleMetadata(output, metadata),
    writeAppStoreConnectMetadata({
      output,
      metadata,
      version: appConfig.expo.version,
    }),
    writeGoogleMetadata(output, metadata),
  ]);
  if (includeAssets) {
    await copyAppleAssets(root, output);
    await copyGoogleAssets(root, output);
  }
  const manifest = {
    generatedAt: new Date().toISOString(),
    launchStorefronts: metadata.launchScope.storefronts,
    appleLocales: Object.keys(metadata.apple.locales),
    appStoreVersion: appConfig.expo.version,
    googleLocales: metadata.googlePlay.launchListings.map(
      (listing) => metadata.googlePlay.listings[listing].languageCode,
    ),
    assetsIncluded: includeAssets,
    subscriptionLocalizations: {
      apple: metadata.apple.subscriptionLocalizations,
      google: metadata.googlePlay.subscriptionLocalizations,
    },
    pricing,
  };
  await writeFile(
    path.join(output, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  return manifest;
};
