import { readFile } from 'node:fs/promises';
import path from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APPLE_KEY = /^appl_[A-Za-z0-9]+$/;
const GOOGLE_KEY = /^goog_[A-Za-z0-9]+$/;
const SHORTCUT_PATH = /^\/shortcuts\/[A-Za-z0-9_-]+\/?$/;
const BROKEN_CAPTURE_SHORTCUT_ID = '85bd1e080e5849b591049eccffb9a3a1';

const finding = (code, title, detail, remediation) => ({ code, title, detail, remediation });

const readText = async (root, relative, findings) => {
  try {
    return await readFile(path.join(root, relative), 'utf8');
  } catch {
    findings.push(finding(
      `missing-file:${relative}`,
      `${relative} could not be read`,
      'Release readiness cannot be evaluated without this repository file.',
      `Restore ${relative} and run the check again.`,
    ));
    return null;
  }
};

const readJson = async (root, relative, findings) => {
  const text = await readText(root, relative, findings);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    findings.push(finding(
      `invalid-json:${relative}`,
      `${relative} is not valid JSON`,
      'The release configuration cannot be evaluated reliably.',
      `Fix the JSON syntax in ${relative}.`,
    ));
    return null;
  }
};

const requireValue = (value, code, label, findings) => {
  if (typeof value === 'string' && value.trim() !== '') return true;
  findings.push(finding(code, `${label} is missing`, `${label} must be configured for this release intent.`, `Set ${label}.`));
  return false;
};

const requireHttps = (value, code, label, findings, { host, pathPattern } = {}) => {
  if (!requireValue(value, code, label, findings)) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || (host && url.hostname !== host) ||
      (pathPattern && !pathPattern.test(url.pathname))) {
      throw new Error('unexpected URL');
    }
  } catch {
    const expected = host ? `https://${host}/shortcuts/...` : 'a valid HTTPS URL';
    findings.push(finding(code, `${label} is invalid`, `${label} must use ${expected}.`, `Replace ${label} with ${expected}.`));
  }
};

const publicValue = (name, profileEnv, publicEnv) => publicEnv[name] ?? profileEnv[name];

const checkProject = (expo, findings) => {
  const projectId = expo?.extra?.eas?.projectId ?? '';
  if (!UUID.test(projectId)) {
    findings.push(finding(
      'project-id',
      'expo.extra.eas.projectId is missing or invalid',
      'EAS cannot resolve the project and push delivery cannot be tied to this app.',
      'Run eas init once or copy the project UUID from Expo project settings into app.json.',
    ));
  }
};

const checkPlatformIdentity = (expo, platform, findings) => {
  if ((platform === 'ios' || platform === 'all') && expo?.ios?.bundleIdentifier !== 'app.wafra.ios') {
    findings.push(finding('bundle-id', 'The iOS bundle identifier is incorrect', 'Apple must receive app.wafra.ios.', 'Set expo.ios.bundleIdentifier to app.wafra.ios.'));
  }
  if ((platform === 'android' || platform === 'all') && expo?.android?.package !== 'app.wafra.android') {
    findings.push(finding('package-id', 'The Android package identifier is incorrect', 'Google Play must receive app.wafra.android.', 'Set expo.android.package to app.wafra.android.'));
  }
};

const checkStoreLocalization = (expo, findings) => {
  const localization = (expo?.plugins ?? []).find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-localization',
  );
  const locales = localization?.[1]?.supportedLocales;
  for (const platform of ['ios', 'android']) {
    if (JSON.stringify(locales?.[platform]) !== JSON.stringify(['en', 'ar'])) {
      findings.push(finding(
        `supported-locales:${platform}`,
        `${platform} supported app languages are incomplete`,
        'The launch listing and in-app language set must both expose English and Arabic.',
        `Configure expo-localization supportedLocales.${platform} as ["en", "ar"].`,
      ));
    }
  }
};

const checkStoreSubmitProfiles = (eas, findings) => {
  if (eas?.submit?.production?.android?.track !== 'internal') {
    findings.push(finding(
      'android-submit-track',
      'The Android production submit profile does not target internal testing',
      'The first automated Play submission must remain on the internal track.',
      'Set eas.json submit.production.android.track to internal.',
    ));
  }
};

const checkBuildProfile = (eas, profile, submit, findings) => {
  if (!eas?.build?.[profile]) {
    findings.push(finding('build-profile', `Build profile ${profile} is missing`, 'The selected EAS build profile does not exist.', `Add eas.json build.${profile} or choose an existing profile.`));
  }
  if (submit && !eas?.submit?.[profile]) {
    findings.push(finding('submit-profile', `Submit profile ${profile} is missing`, 'Auto-submission needs a submit profile with the same name.', `Add eas.json submit.${profile} or build with submission disabled.`));
  }
};

const checkProductionRuntime = (expo, eas, platform, publicEnv, findings) => {
  const extra = expo?.extra ?? {};
  const env = eas?.build?.production?.env ?? {};
  const relayUrl = publicValue('EXPO_PUBLIC_WAFRA_RELAY_URL', env, publicEnv);
  const captureUrl = publicValue('EXPO_PUBLIC_WAFRA_SHORTCUT_URL', env, publicEnv);
  const historyUrl = publicValue('EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL', env, publicEnv);
  const e2eDemo = publicValue('EXPO_PUBLIC_WAFRA_E2E_DEMO', env, publicEnv);
  const smsCorpusJs = publicValue(
    'EXPO_PUBLIC_WAFRA_SMS_CORPUS_EXPORT',
    env,
    publicEnv,
  );
  const smsCorpusNative = publicValue('WAFRA_SMS_CORPUS_EXPORT', env, publicEnv);

  if (e2eDemo === '1') {
    findings.push(finding(
      'e2e-demo-ledger',
      'The browser E2E demo ledger is enabled in production',
      'A production build must start from the customer\'s real empty or persisted ledger.',
      'Remove EXPO_PUBLIC_WAFRA_E2E_DEMO from the production profile and environment.',
    ));
  }

  if (smsCorpusJs === '1' || smsCorpusNative === '1') {
    findings.push(finding(
      'sms-corpus-export',
      'The temporary raw SMS corpus exporter is enabled in production',
      'A store build must not expose the internal full-inbox export path.',
      'Remove both SMS corpus export flags from the production profile and environment.',
    ));
  }

  requireHttps(relayUrl, 'relay-url', 'EXPO_PUBLIC_WAFRA_RELAY_URL', findings);
  if (platform === 'ios' || platform === 'all') {
    requireHttps(captureUrl, 'capture-shortcut', 'EXPO_PUBLIC_WAFRA_SHORTCUT_URL', findings, {
      host: 'www.icloud.com', pathPattern: SHORTCUT_PATH,
    });
    requireHttps(historyUrl, 'history-shortcut', 'EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL', findings, {
      host: 'www.icloud.com', pathPattern: SHORTCUT_PATH,
    });
    if (captureUrl?.includes(BROKEN_CAPTURE_SHORTCUT_ID)) {
      findings.push(finding('broken-capture-shortcut', 'The production Capture link is retired', 'That Shortcut is file-path based and sender-blind.', 'Publish and physically test the current Wafra Capture graph, then replace the URL.'));
    }
    if (captureUrl && historyUrl && captureUrl === historyUrl) {
      findings.push(finding('distinct-shortcuts', 'Capture and History links are identical', 'The two Shortcuts have different permissions and data paths.', 'Publish distinct iCloud links for Capture and History Import.'));
    }
    if (!APPLE_KEY.test(extra.revenueCatIosKey ?? '')) {
      findings.push(finding('revenuecat-ios-key', 'The RevenueCat iOS key is missing or invalid', 'A production iOS build cannot sell or restore Pro.', 'Configure the public appl_ RevenueCat SDK key.'));
    }
  }
  if ((platform === 'android' || platform === 'all') && !GOOGLE_KEY.test(extra.revenueCatAndroidKey ?? '')) {
    findings.push(finding('revenuecat-android-key', 'The RevenueCat Android key is missing or invalid', 'A production Android build cannot sell or restore Pro.', 'Configure the public goog_ RevenueCat SDK key.'));
  }
  requireHttps(extra.privacyPolicyUrl, 'privacy-url', 'expo.extra.privacyPolicyUrl', findings);
  requireHttps(extra.termsOfUseUrl, 'terms-url', 'expo.extra.termsOfUseUrl', findings);
  requireHttps(extra.supportUrl, 'support-url', 'expo.extra.supportUrl', findings);
};

const checkStoreDocuments = async (root, findings) => {
  const [wrangler, privacy, terms, listing] = await Promise.all([
    readText(root, 'server/wrangler.toml', findings),
    readText(root, 'docs/privacy-policy.md', findings),
    readText(root, 'docs/terms-of-use.md', findings),
    readText(root, 'docs/store-listing.md', findings),
  ]);
  const databaseId = wrangler?.match(/^\s*database_id\s*=\s*"([^"]+)"\s*$/m)?.[1] ?? '';
  if (!UUID.test(databaseId)) findings.push(finding('d1-database-id', 'The production D1 database UUID is missing', 'The relay cannot be released against an unresolved database.', 'Set database_id in server/wrangler.toml.'));
  if (privacy?.includes('support@example.com') || terms?.includes('support@example.com')) {
    findings.push(finding('legal-contact', 'Legal documents still use the placeholder support address', 'Customers and reviewers need a real contact route.', 'Replace support@example.com in both legal documents.'));
  }
  if (privacy?.includes('[pending before release]')) findings.push(finding('privacy-relay-entity', 'The privacy policy relay entity is unfinished', 'The policy does not identify the relay entity and jurisdiction.', 'Complete the pending privacy-policy section.'));
  if (terms && /\[\[(LEGAL ENTITY|JURISDICTION)\]\]/.test(terms)) findings.push(finding('terms-placeholders', 'The terms contain legal placeholders', 'The contracting entity or jurisdiction is unresolved.', 'Complete the legal entity and jurisdiction in the terms.'));
  if (listing && /\[(business email|host the landing page privacy section)[^\]]*pending\]/i.test(listing)) {
    findings.push(finding('store-listing-placeholders', 'The store listing contains launch placeholders', 'Contact or hosted privacy details are unfinished.', 'Complete the pending store-listing fields.'));
  }
};

export const assessReleaseReadiness = async ({ root, intent, publicEnv = {} }) => {
  const absoluteRoot = path.resolve(root);
  const findings = [];
  const [app, eas] = await Promise.all([
    readJson(absoluteRoot, 'app.json', findings),
    readJson(absoluteRoot, 'eas.json', findings),
  ]);
  const expo = app?.expo ?? null;
  const platform = intent.platform ?? 'all';
  const profile = intent.kind === 'build' ? intent.profile : 'production';
  const submit = intent.kind === 'build' ? intent.submit : true;

  if (expo && eas) {
    checkProject(expo, findings);
    checkPlatformIdentity(expo, platform, findings);
    checkBuildProfile(eas, profile, submit, findings);
    if (intent.kind === 'store-release' && eas?.build?.development?.developmentClient !== true) {
      findings.push(finding('development-client', 'The development profile is not a development client', 'Device debugging would no longer use the expected client profile.', 'Set eas.json build.development.developmentClient to true.'));
    }
    if (intent.kind === 'store-release') {
      checkStoreLocalization(expo, findings);
      checkStoreSubmitProfiles(eas, findings);
    }
    if (profile === 'production' || intent.kind === 'store-release') {
      checkProductionRuntime(expo, eas, platform, publicEnv, findings);
    }
  }
  if (intent.kind === 'store-release') await checkStoreDocuments(absoluteRoot, findings);

  return {
    ready: findings.length === 0,
    findings,
    facts: {
      bundleId: expo?.ios?.bundleIdentifier ?? '',
      packageId: expo?.android?.package ?? '',
      slug: expo?.slug ?? '',
      version: expo?.version ?? '',
      projectId: expo?.extra?.eas?.projectId ?? '',
    },
  };
};
