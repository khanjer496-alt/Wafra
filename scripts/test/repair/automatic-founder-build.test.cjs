'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
function founder(env) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/founder-pro.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, process: { env } });
  return module.exports;
}
test('automatic founder access needs both explicit build flags', () => {
  for (const eligibility of [undefined, '0', '1', 'true', ' 1']) {
    for (const automatic of [undefined, '0', '1', 'true', ' 1']) {
      const flags = founder({ EXPO_PUBLIC_WAFRA_FOUNDER_UNLOCK: eligibility,
        EXPO_PUBLIC_WAFRA_AUTO_FOUNDER_PRO: automatic });
      assert.equal(flags.isAutomaticFounderProBuild(), eligibility === '1' && automatic === '1');
      assert.equal(flags.isFounderUnlockBuild(), eligibility === '1', 'gesture eligibility stays independent');
    }
  }
});
test('only the selected TestFlight profile opts into automatic local grants', () => {
  const profiles = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8')).build;
  const effective = name => ({ ...(profiles[name].extends ? effective(profiles[name].extends) : {}), ...profiles[name].env });
  for (const name of Object.keys(profiles)) {
    assert.equal(founder(effective(name)).isAutomaticFounderProBuild(), name === 'history-beta', name);
  }
});

test('APK workflow enables automatic access only for explicit eligible APK inputs', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/build-apk.yml'), 'utf8');
  const expression = name => {
    const match = workflow.match(new RegExp(`${name}: \\$\\{\\{ (.+) \\}\\}`));
    assert.ok(match, `${name} must be explicitly pinned in the bundling job`);
    return Function('github', `return (${match[1]});`);
  };
  const eligibility = expression('EXPO_PUBLIC_WAFRA_FOUNDER_UNLOCK');
  const automatic = expression('EXPO_PUBLIC_WAFRA_AUTO_FOUNDER_PRO');
  const refusal = workflow.match(/name: Refuse conflicting automatic tester Pro inputs\n\s+if: ([^\n]+)/);
  assert.ok(refusal);
  const rejected = Function('inputs', `return (${refusal[1]});`);
  for (const auto_pro of [false, true]) for (const bundle of [false, true]) for (const founder_unlock of [false, true]) {
    const inputs = { auto_pro, bundle, founder_unlock };
    const github = { event: { inputs: Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, String(value)])) } };
    const active = founder({ EXPO_PUBLIC_WAFRA_FOUNDER_UNLOCK: eligibility(github),
      EXPO_PUBLIC_WAFRA_AUTO_FOUNDER_PRO: automatic(github) }).isAutomaticFounderProBuild();
    assert.equal(active, auto_pro && !bundle && founder_unlock, JSON.stringify(inputs));
    assert.equal(rejected(inputs), auto_pro && (bundle || !founder_unlock), JSON.stringify(inputs));
  }
  assert.equal(automatic({ event: { inputs: {} } }), '0', 'older dispatches do not silently gain auto-Pro');
  assert.match(workflow, /auto_pro:\n[^\n]+\n\s+type: boolean\n\s+default: false/);
});
