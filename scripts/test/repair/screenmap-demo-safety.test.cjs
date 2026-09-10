'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

test('Screenmap uses only the synthetic iOS development ledger', () => {
  const source = read('src/lib/store.tsx');
  const guard = source.match(
    /const SCREENMAP_DEMO_LEDGER =([\s\S]*?);\nconst SYNTHETIC_DEMO_LEDGER/,
  );
  assert.ok(guard, 'Screenmap demo guard is declared next to the existing E2E demo guard');
  assert.match(guard[1], /Platform\.OS === 'ios'/);
  assert.match(guard[1], /EXPO_PUBLIC_WAFRA_SCREENMAP_DEMO === '1'/);
  assert.match(guard[1], /EXPO_PUBLIC_WAFRA_FOUNDER_UNLOCK === '1'/);
  assert.match(source,
    /const SYNTHETIC_DEMO_LEDGER = E2E_DEMO_LEDGER \|\| SCREENMAP_DEMO_LEDGER/);
  assert.match(source,
    /SYNTHETIC_DEMO_LEDGER\s*\? demoState\(\)\s*:\s*\{ onboarded: false \}/);
  assert.match(source,
    /if \(SCREENMAP_DEMO_LEDGER\) \{[\s\S]*?dispatch\(\{ type: 'hydrate', state: demoState\(\) \}\);[\s\S]*?return true;[\s\S]*?\}\s*const loaded = await persistence\.load\(\);/,
    'Screenmap must hydrate synthetic data before encrypted persistence is read',
  );
  assert.match(source,
    /const persist = useCallback\(\(snapshot: AppState\): Promise<boolean> => \{[\s\S]*?if \(SCREENMAP_DEMO_LEDGER\) return Promise\.resolve\(true\);[\s\S]*?persistence\.save\(snapshot\)/,
    'Screenmap must not write its synthetic ledger to encrypted persistence',
  );
});

test('production cannot satisfy the Screenmap demo guard', () => {
  const eas = JSON.parse(read('eas.json'));
  const appConfig = read('app.config.js');
  assert.equal(eas.cli.version, '>=22.4.0');
  assert.equal(eas.build.production.env.EXPO_PUBLIC_WAFRA_FOUNDER_UNLOCK, '0');
  assert.equal(eas.build['screenmap-simulator'].extends, 'development-simulator');
  assert.equal(eas.build['screenmap-simulator'].env.EXPO_PUBLIC_WAFRA_SCREENMAP_DEMO, '1');
  assert.equal(eas.build['screenmap-simulator'].env.EXPO_PUBLIC_WAFRA_FOUNDER_UNLOCK, '1');
  assert.equal(eas.build['development-simulator'].env.EXPO_PUBLIC_WAFRA_SCREENMAP_DEMO, undefined);
  assert.equal(eas.build.development.developmentClient, true);
  assert.equal(eas.build.development.env.EXPO_PUBLIC_WAFRA_FOUNDER_UNLOCK, '1');
  assert.match(appConfig,
    /EXPO_PUBLIC_WAFRA_SCREENMAP_DEMO === '1'[\s\S]*?EXPO_PUBLIC_WAFRA_FOUNDER_UNLOCK === '1'/,
    'Screenmap config override must require both synthetic-review flags');
  assert.match(appConfig,
    /runtimeVersion:\s*undefined[\s\S]*?updates:[\s\S]*?enabled:\s*false/,
    'Screenmap must disable OTA runtime matching for the action-owned local Metro session');
});

test('Screenmap output and publishing stay private by default', () => {
  const ignore = read('.gitignore');
  const baseline = read('.github/workflows/screenmap-baseline.yml');
  const pr = read('.github/workflows/screenmap-pr.yml');
  const config = JSON.parse(read('.screenmap/config.json'));

  assert.match(ignore, /^\/\.screenmap\/out\/$/m);
  assert.equal(config.scheme, 'wafra');
  assert.equal(config.agent.enabled, false);
  for (const workflow of [baseline, pr]) {
    assert.match(workflow,
      /timeout-minutes: 60\n\s+env:\n\s+#?[\s\S]*?EXPO_PUBLIC_WAFRA_SCREENMAP_DEMO: '1'[\s\S]*?EXPO_PUBLIC_WAFRA_FOUNDER_UNLOCK: '1'[\s\S]*?steps:/,
      'Screenmap flags must be job-scoped so the action-owned Metro bundle receives them');
    assert.match(workflow, /Build local iOS simulator app/);
    assert.match(workflow, /-configuration Debug/,
      'Screenmap requires a dev-client that can connect to the Metro server started by the action');
    assert.match(workflow, /app_path: \$\{\{ runner\.temp \}\}\/wafra-screenmap-derived\/Build\/Products\/Debug-iphonesimulator\/Wafra\.app/);
    assert.doesNotMatch(workflow, /expo_token:/);
    assert.doesNotMatch(workflow, /eas_profile:/);
    assert.match(workflow, /publish: 'false'/);
  }
});
