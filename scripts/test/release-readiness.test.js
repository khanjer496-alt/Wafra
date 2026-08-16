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
    ios: { bundleIdentifier: 'app.wafra.ios' },
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
      production: { env: {
        EXPO_PUBLIC_WAFRA_RELAY_URL: 'https://relay.wafra.example',
        EXPO_PUBLIC_WAFRA_SHORTCUT_URL: 'https://www.icloud.com/shortcuts/captureGood1',
        EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL: 'https://www.icloud.com/shortcuts/historyGood2',
      } },
    },
    submit: { production: { android: { track: 'internal' } } },
  });
  write(root, 'server/wrangler.toml', 'database_id = "fa920e7b-c661-4517-917d-26e8b4878721"\n');
  write(root, 'docs/privacy-policy.md', 'Contact support@wafra.example. Relay by Wafra LLC, UAE.');
  write(root, 'docs/terms-of-use.md', 'Wafra LLC; laws of the UAE. support@wafra.example');
  write(root, 'docs/store-listing.md', 'Support: support@wafra.example. Privacy: https://wafra.example/privacy');
  return root;
};

(async () => {
  const { assessReleaseReadiness } = await import('../lib/release-readiness.mjs');

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
    const root = validFixture();
    const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
    eas.build.production.env.EXPO_PUBLIC_WAFRA_SHORTCUT_URL =
      'https://www.icloud.com/shortcuts/85bd1e080e5849b591049eccffb9a3a1';
    delete eas.build.production.env.EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL;
    write(root, 'eas.json', eas);
    const report = await assessReleaseReadiness({
      root,
      intent: { kind: 'build', platform: 'ios', profile: 'production', submit: true },
    });
    const codes = report.findings.map(({ code }) => code);
    ok('production iOS uses the same Shortcut rules locally and in CI',
      codes.includes('broken-capture-shortcut') && codes.includes('history-shortcut'), codes.join(','));
    fs.rmSync(root, { recursive: true, force: true });
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
