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

const write = (root, relative, value) => {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
};

const validFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-release-'));
  write(root, 'app.json', { expo: {
    slug: 'wafra', version: '1.0.0',
    runtimeVersion: { policy: 'fingerprint' },
    updates: {
      url: 'https://u.expo.dev/fa920e7b-c661-4517-917d-26e8b4878721',
      enabled: true,
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 1500,
    },
    ios: {
      bundleIdentifier: 'app.wafra.ios',
      infoPlist: { ITSAppUsesNonExemptEncryption: true },
    },
    android: { package: 'app.wafra.android' },
    plugins: [['expo-localization', {
      supportedLocales: { ios: ['en', 'ar'], android: ['en', 'ar'] },
    }]],
    extra: {
      eas: { projectId: 'fa920e7b-c661-4517-917d-26e8b4878721' },
      revenueCatAndroidKey: 'goog_PUBLIC123',
      revenueCatIosKey: 'appl_PUBLIC123',
      privacyPolicyUrl: 'https://wafra.example/privacy',
      termsOfUseUrl: 'https://wafra.example/terms',
      supportUrl: 'https://wafra.example/support',
    },
  } });
  write(root, 'eas.json', {
    build: {
      development: { developmentClient: true },
      preview: {},
      production: { channel: 'production', environment: 'production', env: {
        EXPO_PUBLIC_WAFRA_RELAY_URL: 'https://relay.wafra.example',
        EXPO_PUBLIC_WAFRA_SHORTCUT_URL: `https://www.icloud.com/shortcuts/${'a'.repeat(32)}`,
        EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL: `https://www.icloud.com/shortcuts/${'b'.repeat(32)}`,
      } },
      'production-candidate': {
        extends: 'production',
        channel: 'production-candidate',
        environment: 'production',
      },
    },
    submit: { production: { android: { track: 'internal' } } },
  });
  write(root, 'server/wrangler.toml', 'database_id = "fa920e7b-c661-4517-917d-26e8b4878721"\n');
  write(root, 'docs/privacy-policy.md', 'Nasida Apps LLC. Contact support@wafra.example.');
  write(root, 'docs/terms-of-use.md', 'Nasida Apps LLC; laws chosen by publisher. support@wafra.example');
  write(root, 'docs/store-listing.md', 'Support: support@wafra.example. Privacy: https://wafra.example/privacy');
  write(root, 'docs/store-compliance/google-play.md', 'Google Play declaration package.');
  write(root, 'docs/store-compliance/apple-app-store.md', 'Apple App Store declaration package.');
  write(root, 'docs/store-compliance/global-launch-board.md', 'Launch board.');
  write(root, 'docs/store-compliance/monitoring-and-rollback.md', 'Monitoring and rollback.');
  write(root, 'docs/store-compliance/apple-export-compliance.json', {
    schemaVersion: 1,
    status: 'approved',
    itsAppUsesNonExemptEncryption: true,
  });
  return root;
};

(async () => {
  const { assessReleaseReadiness } = await import('../lib/release-readiness.mjs');
  const { validatePublishRevision, validateUpdateGroup } =
    await import('../lib/update-group.mjs');

  {
    const head = 'b'.repeat(40);
    ok('local OTA publishing accepts only the exact fetched origin/main revision',
      validatePublishRevision?.({ branch: 'main', head, remoteMain: head }).length === 0);
    ok('local OTA publishing rejects an unpushed or diverged main checkout',
      validatePublishRevision?.({ branch: 'main', head, remoteMain: 'c'.repeat(40) })
        ?.some((failure) => /origin\/main/.test(failure)) === true);
  }

  {
    const group = '11111111-1111-4111-8111-111111111111';
    const commit = 'a'.repeat(40);
    const failures = validateUpdateGroup({
      updates: [
        { group, branch: 'production-candidate', platform: 'ios',
          runtimeVersion: 'ios-fingerprint', gitCommitHash: commit },
        { group, branch: 'production-candidate', platform: 'android',
          runtimeVersion: 'android-fingerprint', gitCommitHash: commit },
      ],
      expectedGroup: group,
      expectedBranch: 'production-candidate',
      isCommitMerged: () => true,
    });
    ok('OTA provenance accepts platform-specific fingerprint runtimes from one merged commit',
      failures.length === 0, failures.join('; '));
  }

  {
    const root = validFixture();
    const report = await assessReleaseReadiness({
      root,
      intent: { kind: 'build', platform: 'ios', profile: 'preview', submit: false },
    });
    ok('preview build checks only what that build needs', report.ready, JSON.stringify(report.findings));
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const root = validFixture();
    write(root, 'docs/store-compliance/apple-export-compliance.json', {
      schemaVersion: 1,
      status: 'pending-publisher-review',
      itsAppUsesNonExemptEncryption: null,
    });
    const report = await assessReleaseReadiness({
      root,
      intent: { kind: 'store-release', platform: 'all' },
    });
    ok('store release blocks until Apple export compliance is publisher-approved',
      report.findings.some(({ code }) => code === 'apple-export-compliance'));
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const root = validFixture();
    const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
    app.expo.ios.infoPlist.ITSAppUsesNonExemptEncryption = false;
    write(root, 'app.json', app);
    const report = await assessReleaseReadiness({
      root,
      intent: { kind: 'store-release', platform: 'ios' },
    });
    ok('store release rejects an iOS encryption flag that disagrees with the retained decision',
      report.findings.some(({ code }) => code === 'apple-export-compliance-config'));
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const root = validFixture();
    const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
    delete app.expo.updates;
    write(root, 'app.json', app);
    const report = await assessReleaseReadiness({
      root,
      intent: { kind: 'build', platform: 'ios', profile: 'production-candidate', submit: true },
    });
    ok('production-candidate binary builds enforce OTA activation config',
      report.findings.some(({ code }) => code === 'update-url'));
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const root = validFixture();
    const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
    app.expo.runtimeVersion = { policy: 'appVersion' };
    app.expo.updates.fallbackToCacheTimeout = 10_000;
    write(root, 'app.json', app);
    const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
    eas.build['production-candidate'].channel = 'production';
    write(root, 'eas.json', eas);
    const report = await assessReleaseReadiness({
      root,
      intent: { kind: 'store-release', platform: 'all' },
    });
    const codes = report.findings.map(({ code }) => code);
    ok('store release rejects an unsafe or unisolated OTA configuration',
      codes.includes('update-runtime') &&
      codes.includes('update-startup') &&
      codes.includes('update-channel:production-candidate'),
      codes.join(','));
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const root = validFixture();
    const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
    app.expo.plugins = [];
    write(root, 'app.json', app);
    const report = await assessReleaseReadiness({
      root,
      intent: { kind: 'store-release', platform: 'all' },
    });
    ok('store release requires OS-visible English and Arabic app languages',
      report.findings.some(({ code }) => code === 'supported-locales:ios') &&
      report.findings.some(({ code }) => code === 'supported-locales:android'));
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const root = validFixture();
    const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
    delete eas.submit.production.android;
    write(root, 'eas.json', eas);
    const report = await assessReleaseReadiness({
      root,
      intent: { kind: 'store-release', platform: 'all' },
    });
    ok('store release keeps the first automated Android submission internal',
      report.findings.some(({ code }) => code === 'android-submit-track'));
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const root = validFixture();
    const report = await assessReleaseReadiness({
      root,
      intent: { kind: 'build', platform: 'android', profile: 'production', submit: true },
      publicEnv: {
        EXPO_PUBLIC_WAFRA_SMS_CORPUS_EXPORT: '1',
        WAFRA_SMS_CORPUS_EXPORT: '1',
      },
    });
    ok('production rejects the temporary full-inbox corpus exporter',
      report.findings.some(({ code }) => code === 'sms-corpus-export'));
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const root = validFixture();
    const report = await assessReleaseReadiness({
      root,
      intent: { kind: 'build', platform: 'ios', profile: 'production', submit: true },
      publicEnv: { EXPO_PUBLIC_WAFRA_E2E_DEMO: '1' },
    });
    ok('production rejects the browser-only demo ledger',
      report.findings.some(({ code }) => code === 'e2e-demo-ledger'));
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const root = validFixture();
    const report = await assessReleaseReadiness({
      root,
      intent: { kind: 'build', platform: 'ios', profile: 'preview', submit: true },
    });
    ok('submission requires the matching submit profile',
      report.findings.some(({ code }) => code === 'submit-profile'));
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const root = validFixture();
    const report = await assessReleaseReadiness({
      root,
      intent: { kind: 'store-release', platform: 'all' },
    });
    ok('one evaluator can approve a complete two-store configuration', report.ready,
      JSON.stringify(report.findings));
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    for (const invalidHistoryUrl of [
      'https://www.icloud.com/shortcuts/too-short',
      `https://www.icloud.com/shortcuts/${'b'.repeat(32)}/`,
      `https://www.icloud.com/shortcuts/${'b'.repeat(32)}?source=test`,
      `https://www.icloud.com/shortcuts/${'b'.repeat(32)}#fragment`,
      `https://user@www.icloud.com/shortcuts/${'b'.repeat(32)}`,
    ]) {
      const root = validFixture();
      const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
      eas.build.production.env.EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL =
        invalidHistoryUrl;
      write(root, 'eas.json', eas);
      const report = await assessReleaseReadiness({
        root,
        intent: { kind: 'build', platform: 'ios', profile: 'production', submit: true },
      });
      ok(`production iOS rejects malformed History Shortcut ${invalidHistoryUrl}`,
        report.findings.some(({ code }) => code === 'history-shortcut'),
        report.findings.map(({ code }) => code).join(','));
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  {
    const root = validFixture();
    const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
    eas.build.production.env.EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL =
      'https://www.icloud.com/shortcuts/cc85a21db99a4e4698c1a498de670199';
    write(root, 'eas.json', eas);
    const report = await assessReleaseReadiness({
      root,
      intent: { kind: 'build', platform: 'ios', profile: 'production', submit: true },
    });
    ok('production iOS rejects the superseded History Shortcut',
      report.findings.some(({ code }) => code === 'retired-history-shortcut'),
      report.findings.map(({ code }) => code).join(','));
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const root = validFixture();
    const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
    eas.build.production.env.EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL =
      'https://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef';
    write(root, 'eas.json', eas);
    const report = await assessReleaseReadiness({
      root,
      intent: { kind: 'build', platform: 'ios', profile: 'production', submit: true },
    });
    ok('production iOS permits a non-retired 32-hex History Shortcut', report.ready,
      JSON.stringify(report.findings));
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const root = validFixture();
    const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
    eas.build.production.env.EXPO_PUBLIC_WAFRA_SHORTCUT_URL =
      'https://www.icloud.com/shortcuts/ABCDEF0123456789ABCDEF0123456789';
    eas.build.production.env.EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL =
      'https://www.icloud.com/shortcuts/abcdef0123456789abcdef0123456789';
    write(root, 'eas.json', eas);
    const report = await assessReleaseReadiness({
      root,
      intent: { kind: 'build', platform: 'ios', profile: 'production', submit: true },
    });
    ok('production iOS rejects Capture and History URLs for the same artifact despite casing',
      report.findings.some(({ code }) => code === 'distinct-shortcuts'),
      report.findings.map(({ code }) => code).join(','));
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    for (const [name, variable, code] of [
      ['Capture', 'EXPO_PUBLIC_WAFRA_SHORTCUT_URL', 'capture-shortcut'],
      ['History', 'EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL', 'history-shortcut'],
    ]) {
      const root = validFixture();
      const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
      eas.build.production.env[variable] =
        'https://www.icloud.com:443/shortcuts/0123456789abcdef0123456789abcdef';
      write(root, 'eas.json', eas);
      const report = await assessReleaseReadiness({
        root,
        intent: { kind: 'build', platform: 'ios', profile: 'production', submit: true },
      });
      ok(`production iOS rejects an explicit port in the ${name} Shortcut URL`,
        report.findings.some((finding) => finding.code === code),
        report.findings.map(({ code: findingCode }) => findingCode).join(','));
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  {
    for (const [name, variable, code, invalidUrl] of [
      ['Capture', 'EXPO_PUBLIC_WAFRA_SHORTCUT_URL', 'capture-shortcut',
        ' https://www.icloud.com:443/shortcuts/0123456789abcdef0123456789abcdef'],
      ['History', 'EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL', 'history-shortcut',
        'https://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef '],
      ['Capture', 'EXPO_PUBLIC_WAFRA_SHORTCUT_URL', 'capture-shortcut',
        'https://@www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef'],
      ['History', 'EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL', 'history-shortcut',
        'https://@www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef'],
      ['Capture', 'EXPO_PUBLIC_WAFRA_SHORTCUT_URL', 'capture-shortcut',
        'HTTPS://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef'],
      ['History', 'EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL', 'history-shortcut',
        'HTTPS://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef'],
      ['Capture', 'EXPO_PUBLIC_WAFRA_SHORTCUT_URL', 'capture-shortcut',
        'https://WWW.ICLOUD.COM/shortcuts/0123456789abcdef0123456789abcdef'],
      ['History', 'EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL', 'history-shortcut',
        'https://WWW.ICLOUD.COM/shortcuts/0123456789abcdef0123456789abcdef'],
    ]) {
      const root = validFixture();
      const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
      eas.build.production.env[variable] = invalidUrl;
      write(root, 'eas.json', eas);
      const report = await assessReleaseReadiness({
        root,
        intent: { kind: 'build', platform: 'ios', profile: 'production', submit: true },
      });
      ok(`production iOS rejects a noncanonical ${name} Shortcut URL`,
        report.findings.some((finding) => finding.code === code),
        report.findings.map(({ code: findingCode }) => findingCode).join(','));
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  {
    for (const retiredId of [
      '03d2ab22a33f4fef9d503142575a70fb',
      '85bd1e080e5849b591049eccffb9a3a1',
    ]) {
      const root = validFixture();
      const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
      eas.build.production.env.EXPO_PUBLIC_WAFRA_SHORTCUT_URL =
        `https://www.icloud.com/shortcuts/${retiredId}`;
      delete eas.build.production.env.EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL;
      write(root, 'eas.json', eas);
      const report = await assessReleaseReadiness({
        root,
        intent: { kind: 'build', platform: 'ios', profile: 'production', submit: true },
      });
      const codes = report.findings.map(({ code }) => code);
      ok(`production iOS rejects retired Capture Shortcut ${retiredId}`,
        codes.includes('broken-capture-shortcut') && codes.includes('history-shortcut'),
        codes.join(','));
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  {
    const root = validFixture();
    const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
    app.expo.extra.revenueCatAndroidKey = '';
    write(root, 'app.json', app);
    const ios = await assessReleaseReadiness({
      root,
      intent: { kind: 'build', platform: 'ios', profile: 'production', submit: true },
    });
    const all = await assessReleaseReadiness({
      root,
      intent: { kind: 'store-release', platform: 'all' },
    });
    ok('platform-scoped builds do not inherit the other store billing gate',
      !ios.findings.some(({ code }) => code === 'revenuecat-android-key'));
    ok('the full launch gate still checks both storefronts',
      all.findings.some(({ code }) => code === 'revenuecat-android-key'));
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const root = validFixture();
    write(root, 'app.json', '{not json');
    const report = await assessReleaseReadiness({
      root,
      intent: { kind: 'build', platform: 'ios', profile: 'preview', submit: false },
    });
    ok('malformed configuration returns a typed finding instead of a stack trace',
      report.findings.some(({ code }) => code === 'invalid-json:app.json'));
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log(`\nrelease-readiness: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
