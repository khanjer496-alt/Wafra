const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const loadTs = require('./load-typescript.cjs');
const load = require('../../universal-test/load-ts.cjs').createLoader();

for (const os of ['ios', 'android']) {
  test(`${os}: logo networking requires explicit consent and revocation invalidates queued jobs`, () => {
    const logos = loadTs(path.resolve(__dirname, '../../../src/lib/logo-cache-lifecycle.ts'), {
      '@react-native-async-storage/async-storage': {}, 'react-native': { Platform: { OS: os } },
    });
    assert.equal(logos.logoCacheGeneration(), null, 'fresh and upgraded installs start offline');
    logos.setLogoLookupsAllowed(true);
    const generation = logos.logoCacheGeneration();
    assert.equal(typeof generation, 'number');
    assert.equal(logos.isLogoCacheGenerationCurrent(generation), true);
    logos.setLogoLookupsAllowed(false);
    assert.equal(logos.logoCacheGeneration(), null);
    assert.equal(logos.isLogoCacheGenerationCurrent(generation), false, 'queued search/cache results lose authority');
    logos.setLogoLookupsAllowed(true);
    assert.notEqual(logos.logoCacheGeneration(), generation, 'old request cannot regain authority after opt-in');
  });
}

test('App Lock hides every widget amount by default, including old preference-less installs', () => {
  const { widgetSnapshotForLedger } = load('@/lib/widget-ledger');
  const state = { hydrated: true, onboarded: true, appLock: true, privateMode: false,
    accounts: [], transactions: [], budgets: [], bills: [], cardDues: [],
    notSubscriptions: [], cancelledSubscriptions: {}, transferInternalIds: [] };
  const input = { state, now: new Date(2026, 10, 9, 12), language: 'en', moneySpec: { currency: 'AED', exponent: 2 } };
  for (const preference of [undefined, true]) {
    const snapshot = widgetSnapshotForLedger({ ...input, state: { ...state, hideWidgetAmountsWhenLocked: preference } }, []);
    assert.equal(snapshot.hidden, true);
    for (const key of ['todayMinor', 'leftInBudgetsMinor', 'budgetTotalMinor', 'perDayMinor']) {
      if (key in snapshot) assert.equal(snapshot[key], null, key);
    }
    assert.ok(snapshot.last7Minor.every(value => value === null));
    assert.ok(snapshot.bills.every(bill => bill.amountMinor === null));
    if (snapshot.spending) {
      assert.equal(snapshot.spending.totalMinor, null);
      assert.ok(snapshot.spending.categories.every(category => category.amountMinor === null));
    }
  }
  assert.equal(widgetSnapshotForLedger({ ...input, state: { ...state, hideWidgetAmountsWhenLocked: false } }, []).hidden, false);
  assert.equal(widgetSnapshotForLedger({ ...input, state: { ...state, appLock: false } }, []).hidden, false);
});

test('native privacy bridge receives independent lock and widget preferences', async () => {
  const calls = [];
  const native = { setAppPrivacy: async (...args) => calls.push(args) };
  const bridge = loadTs(path.resolve(__dirname, '../../../modules/wafra-widgets/index.ts'), {
    'react-native': { Platform: { OS: 'ios' } },
    'expo-modules-core': { requireOptionalNativeModule: () => native },
  });
  await bridge.setAppPrivacy(true, true);
  await bridge.setAppPrivacy(true, false);
  await bridge.setAppPrivacy(false, true);
  assert.deepEqual(calls.map(args => Array.from(args)), [[true, true], [true, false], [false, true]]);
});

test('store re-clears the native widget copy only when the effective guard changed; onboarding logos need consent', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const root = path.resolve(__dirname, '../../..');
  const store = fs.readFileSync(path.join(root, 'src/lib/store.tsx'), 'utf8');
  assert.match(store, /const changed = appliedWidgetGuard\.current !== null && appliedWidgetGuard\.current !== guard;/);
  assert.match(store, /if \(changed\) await invalidateWidgetSnapshotSync\(\);/);
  assert.ok(!/\n\s*await invalidateWidgetSnapshotSync\(\);\s*\n\s*if \(cancelled\) return;\s*\n\s*const current = authoritativeState\.current;/.test(store));
  const scenes = fs.readFileSync(path.join(root, 'src/components/onboarding/alive-scenes.tsx'), 'utf8');
  assert.match(scenes, /const uri = consented && Platform\.OS !== 'android' && domain \? verifiedLogoUrl\(domain\) : null;/);
});

test('iOS privacy cover observes UIApplication notifications and registers at launch (UIScene-safe)', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const swift = fs.readFileSync(path.resolve(__dirname, '../../../modules/wafra-widgets/ios/WafraPrivacyCover.swift'), 'utf8');
  for (const name of ['willResignActiveNotification', 'didEnterBackgroundNotification', 'didBecomeActiveNotification']) {
    assert.match(swift, new RegExp(`UIApplication\\.${name}`), name);
  }
  assert.match(swift, /didFinishLaunchingWithOptions[\s\S]{0,200}_ = WafraPrivacyCover\.shared/);
  // The delegate callbacks stay too: covering is idempotent, so both paths are safe.
  assert.match(swift, /applicationWillResignActive[\s\S]{0,80}resignActive\(\)/);
});

test('Android setAppPrivacy purges only an unredacted widget snapshot (no empty widgets at every launch)', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const dir = path.resolve(__dirname, '../../../modules/wafra-widgets/android/src/main/java/expo/modules/wafrawidgets');
  const module_ = fs.readFileSync(path.join(dir, 'WafraWidgetsModule.kt'), 'utf8');
  const widgets = fs.readFileSync(path.join(dir, 'WafraWidgets.kt'), 'utf8');
  assert.match(module_, /if \(context != null\) WafraWidgets\.purgeUnredactedSnapshot\(context\)/);
  assert.ok(!/setAppPrivacy[\s\S]{0,500}WafraWidgets\.store\(context, null\)/.test(module_), 'no unconditional clear in setAppPrivacy');
  assert.match(widgets, /fun purgeUnredactedSnapshot[\s\S]{0,400}optBoolean\("hidden", false\)[\s\S]{0,120}if \(!hidden\) store\(context, null\)/);
});

test('CI typechecks the iOS privacy cover on the macOS native job, and widget changes trigger it', () => {
  const fs = require('node:fs');
  const YAML = require('yaml');
  const ci = YAML.parse(fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/ci.yml'), 'utf8'));
  const step = ci.jobs['native-ios'].steps.find((s) => s.run === 'bash scripts/test/native-app-privacy-typecheck.sh');
  assert.ok(step, 'native-ios runs native-app-privacy-typecheck.sh');
  assert.match(ci.jobs['native-ios']['runs-on'], /^macos/);
  const filter = ci.jobs['native-paths'].steps.find((s) => s.id === 'filter').with.filters;
  assert.match(filter, /- 'modules\/wafra-widgets\/ios\/\*\*'/);
  assert.match(filter, /- 'scripts\/test\/native-app-privacy-typecheck\.sh'/);
});

test('the typecheck stub of WafraWidgetsModule matches the real module for every member the privacy cover uses', () => {
  // The typecheck compiles WafraPrivacyCover.swift against a stub of
  // WafraWidgetsModule, not the Expo module itself. Pin the stub to the real
  // declarations so a rename or value change in the real file fails here.
  const fs = require('node:fs');
  const ios = path.resolve(__dirname, '../../../modules/wafra-widgets/ios');
  const script = fs.readFileSync(path.resolve(__dirname, '../native-app-privacy-typecheck.sh'), 'utf8');
  const cover = fs.readFileSync(path.join(ios, 'WafraPrivacyCover.swift'), 'utf8');
  const real = fs.readFileSync(path.join(ios, 'WafraWidgetsModule.swift'), 'utf8');
  const stub = script.match(/WidgetBridge\.swift" <<'SWIFT'\n([\s\S]*?)\nSWIFT/);
  assert.ok(stub, 'the script still writes the WidgetBridge.swift stub');
  const declared = new Map();
  for (const line of stub[1].split('\n')) {
    const m = line.trim().match(/^static (?:let|func) (\w+)(.*?)\s*(?:\{\s*\})?$/);
    if (m) declared.set(m[1], line.trim().replace(/\s*\{\s*\}$/, ''));
  }
  const used = new Set([...cover.matchAll(/WafraWidgetsModule\.(\w+)/g)].map((m) => m[1]));
  assert.ok(used.size > 0, 'the privacy cover uses WafraWidgetsModule');
  for (const name of used) {
    assert.ok(declared.has(name), `stub declares WafraWidgetsModule.${name}, which WafraPrivacyCover.swift uses`);
    const decl = declared.get(name);
    const escaped = decl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    assert.match(real, new RegExp(`^\\s*${escaped}\\s*(?:\\{|$)`, 'm'), `real WafraWidgetsModule.swift has: ${decl}`);
  }
});
