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
});

test('production cannot satisfy the Screenmap demo guard', () => {
  const eas = JSON.parse(read('eas.json'));
  assert.equal(eas.build.production.env.EXPO_PUBLIC_WAFRA_FOUNDER_UNLOCK, '0');
  assert.equal(eas.build['screenmap-simulator'].extends, 'development-simulator');
  assert.equal(eas.build['screenmap-simulator'].env.EXPO_PUBLIC_WAFRA_SCREENMAP_DEMO, '1');
  assert.equal(eas.build['screenmap-simulator'].env.EXPO_PUBLIC_WAFRA_FOUNDER_UNLOCK, '1');
  assert.equal(eas.build['development-simulator'].env.EXPO_PUBLIC_WAFRA_SCREENMAP_DEMO, undefined);
  assert.equal(eas.build.development.developmentClient, true);
  assert.equal(eas.build.development.env.EXPO_PUBLIC_WAFRA_FOUNDER_UNLOCK, '1');
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
    assert.match(workflow, /expo_token: \$\{\{ secrets\.EXPO_TOKEN \}\}/);
    assert.match(workflow, /eas_profile: screenmap-simulator/);
    assert.match(workflow, /publish: 'false'/);
  }
});
