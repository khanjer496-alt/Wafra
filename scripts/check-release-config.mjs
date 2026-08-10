import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const app = JSON.parse(await readFile(new URL('app.json', root), 'utf8'));
const eas = JSON.parse(await readFile(new URL('eas.json', root), 'utf8'));
const wrangler = await readFile(new URL('server/wrangler.toml', root), 'utf8');
const privacy = await readFile(new URL('docs/privacy-policy.md', root), 'utf8');
const terms = await readFile(new URL('docs/terms-of-use.md', root), 'utf8');
const storeListing = await readFile(new URL('docs/store-listing.md', root), 'utf8');

const errors = [];
const BROKEN_CAPTURE_SHORTCUT_ID = '85bd1e080e5849b591049eccffb9a3a1';
const requireValue = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') errors.push(`${label} is missing`);
};
const requireHttps = (value, label, pathPattern) => {
  requireValue(value, label);
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') errors.push(`${label} must use HTTPS`);
    if (pathPattern && !pathPattern.test(url.pathname)) errors.push(`${label} has an unexpected path`);
  } catch {
    errors.push(`${label} is not a valid URL`);
  }
};

const extra = app.expo?.extra ?? {};
if (app.expo?.ios?.bundleIdentifier !== 'app.wafra.ios') {
  errors.push('expo.ios.bundleIdentifier must be app.wafra.ios');
}
if (app.expo?.android?.package !== 'app.wafra.android') {
  errors.push('expo.android.package must be app.wafra.android');
}
if (!eas.build?.production || !eas.submit?.production) {
  errors.push('eas.json needs production build and submit profiles');
}
if (eas.build?.development?.developmentClient !== true) {
  errors.push('eas.json development profile must build the development client');
}
requireValue(extra.revenueCatAndroidKey, 'expo.extra.revenueCatAndroidKey');
requireValue(extra.revenueCatIosKey, 'expo.extra.revenueCatIosKey');
requireHttps(extra.privacyPolicyUrl, 'expo.extra.privacyPolicyUrl');
requireHttps(extra.termsOfUseUrl, 'expo.extra.termsOfUseUrl');
requireHttps(extra.supportUrl, 'expo.extra.supportUrl');
if (extra.revenueCatAndroidKey && !/^goog_[A-Za-z0-9]+$/.test(extra.revenueCatAndroidKey)) {
  errors.push('expo.extra.revenueCatAndroidKey must be a RevenueCat Google public SDK key');
}
if (extra.revenueCatIosKey && !/^appl_[A-Za-z0-9]+$/.test(extra.revenueCatIosKey)) {
  errors.push('expo.extra.revenueCatIosKey must be a RevenueCat Apple public SDK key');
}

const productionEnv = eas.build?.production?.env ?? {};
const relayUrl = process.env.EXPO_PUBLIC_WAFRA_RELAY_URL ?? productionEnv.EXPO_PUBLIC_WAFRA_RELAY_URL;
const captureShortcutUrl =
  process.env.EXPO_PUBLIC_WAFRA_SHORTCUT_URL ?? productionEnv.EXPO_PUBLIC_WAFRA_SHORTCUT_URL;
const historyShortcutUrl =
  process.env.EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL ??
  productionEnv.EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL;

requireHttps(relayUrl, 'EXPO_PUBLIC_WAFRA_RELAY_URL');
requireHttps(
  captureShortcutUrl,
  'EXPO_PUBLIC_WAFRA_SHORTCUT_URL',
  /^\/shortcuts\/[A-Za-z0-9_-]+\/?$/,
);
requireHttps(
  historyShortcutUrl,
  'EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL',
  /^\/shortcuts\/[A-Za-z0-9_-]+\/?$/,
);
if (captureShortcutUrl?.includes(BROKEN_CAPTURE_SHORTCUT_ID)) {
  errors.push(
    'EXPO_PUBLIC_WAFRA_SHORTCUT_URL points to the retired file-path/sender-blind Shortcut',
  );
}
if (captureShortcutUrl && historyShortcutUrl && captureShortcutUrl === historyShortcutUrl) {
  errors.push('capture and history Shortcut URLs must be different');
}

const projectId = process.env.EXPO_PUBLIC_WAFRA_PROJECT_ID ?? extra.eas?.projectId;
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId ?? '')) {
  errors.push('set EXPO_PUBLIC_WAFRA_PROJECT_ID or expo.extra.eas.projectId to the EAS project UUID');
}

const databaseId = wrangler.match(/^\s*database_id\s*=\s*"([^"]+)"\s*$/m)?.[1] ?? '';
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(databaseId)) {
  errors.push('server/wrangler.toml needs the production D1 database UUID');
}

if (privacy.includes('support@example.com') || terms.includes('support@example.com')) {
  errors.push('replace support@example.com in the legal documents');
}
if (privacy.includes('[pending before release]')) {
  errors.push('complete the relay entity/jurisdiction in docs/privacy-policy.md');
}
if (/\[\[(LEGAL ENTITY|JURISDICTION)\]\]/.test(terms)) {
  errors.push('complete the legal entity and jurisdiction in docs/terms-of-use.md');
}
if (/\[(business email|host the landing page privacy section)[^\]]*pending\]/i.test(storeListing)) {
  errors.push('complete the contact email and hosted privacy-policy URL in docs/store-listing.md');
}

if (errors.length > 0) {
  console.error('Wafra is not production-configured:\n');
  for (const error of errors) console.error(`  - ${error}`);
  console.error('\nNo files were changed. Development and simulator builds remain usable.');
  process.exit(1);
}

console.log('Release configuration is complete. Physical-device capture and store-console review are still manual gates.');
