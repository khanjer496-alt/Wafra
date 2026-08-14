const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  LOCAL_AI_BENCHMARK,
  LOCAL_AI_JSON_SCHEMA,
  parseLocalAiVerdict,
  runLocalAiBenchmark,
} = require('./build/local-ai-contract.js');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
  if (condition) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const ROOT = path.join(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

(async () => {
  const valid = {
    status: 'posted', kind: 'salary', direction: 'credit', confidence: 'high',
  };
  ok('the structured verdict accepts only the closed contract',
    JSON.stringify(parseLocalAiVerdict(valid)) === JSON.stringify(valid));
  ok('free-text or money fields cannot escape the model contract',
    parseLocalAiVerdict({ ...valid, reason: 'private alert text' }) === null &&
      parseLocalAiVerdict({ ...valid, amount: 8500 }) === null);
  ok('the native JSON grammar forbids additional model output',
    LOCAL_AI_JSON_SCHEMA.additionalProperties === false &&
      LOCAL_AI_JSON_SCHEMA.required.length === 4);

  const expected = new Map(LOCAL_AI_BENCHMARK.map((row) => [row.source, row.expected]));
  const perfect = await runLocalAiBenchmark(async (source) => ({
    ...expected.get(source), confidence: 'high',
  }));
  ok('only an exact, safety-clean model clears the small gate',
    perfect.releaseEligible && perfect.exact === perfect.total && perfect.safetyFailures === 0,
    JSON.stringify(perfect));

  const unsafe = await runLocalAiBenchmark(async (source) => {
    const row = expected.get(source);
    if (row.status === 'non-posting') {
      return { status: 'posted', kind: 'business-income', direction: 'credit', confidence: 'high' };
    }
    return { ...row, confidence: 'high' };
  });
  ok('inventing posted money fails the release gate',
    !unsafe.releaseEligible && unsafe.safetyFailures > 0, JSON.stringify(unsafe));

  const missing = await runLocalAiBenchmark(async () => null);
  ok('runtime failures fail closed instead of being counted as correct',
    !missing.releaseEligible && missing.exact === 0 && missing.safetyFailures === missing.total);

  const model = read('src/lib/local-ai-model.ts');
  const manager = read('src/lib/local-ai-model-adapter.native.ts');
  const runtime = read('src/lib/local-ai-runtime-adapter.native.ts');
  ok('the model artifact is immutable and checksum verified in bounded chunks',
    /91cad51170dc346986eccefdc2dd33a9da36ead9/.test(model) &&
      /6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e/.test(model) &&
      /FileHandle|file\.open\(\)/.test(manager) && /sha256\.create\(\)/.test(manager) &&
      !/\.bytes\(\)/.test(manager));
  ok('the model lives in disposable cache and is never a ledger or backup field',
    /Paths\.cache/.test(manager) && !/Paths\.document/.test(manager) &&
      !/Transaction|ImportBatch|useStore/.test(manager));
  ok('native inference suppresses logs and clears raw prompt state after every call',
    /toggleNativeLog\(false\)/.test(runtime) &&
      /finally[\s\S]*clearCache\(true\)/.test(runtime) &&
      !/console\.(log|debug|info|warn)/.test(runtime));

  const eas = JSON.parse(read('eas.json'));
  const ordinaryProfiles = Object.entries(eas.build)
    .filter(([name]) => name !== 'local-ai-preview');
  ok('every ordinary EAS build pins the evaluator off',
    ordinaryProfiles.every(([, profile]) =>
      profile.env?.EXPO_PUBLIC_WAFRA_LOCAL_AI_EVAL === '0'));
  ok('only the internal local-AI profile enables the lab',
    eas.build['local-ai-preview']?.distribution === 'internal' &&
      eas.build['local-ai-preview']?.env?.EXPO_PUBLIC_WAFRA_LOCAL_AI_EVAL === '1');

  const githubBuild = read('.github/workflows/build-apk.yml');
  ok('GitHub local-AI builds require an explicit manual input and remain ARM64-only',
    /workflow_dispatch:[\s\S]{0,800}local_ai:[\s\S]{0,200}type: boolean/.test(githubBuild) &&
      /EXPO_PUBLIC_WAFRA_LOCAL_AI_EVAL: \$\{\{ github\.event\.inputs\.local_ai == 'true' && '1' \|\| '0' \}\}/.test(githubBuild) &&
      /github\.event\.inputs\.local_ai[\s\S]{0,200}reactNativeArchitectures=arm64-v8a/.test(githubBuild) &&
      /wafra-local-ai-apk/.test(githubBuild));
  ok('manual local-AI builds never produce a Play bundle',
    (githubBuild.match(/github\.event\.inputs\.local_ai != 'true'/g) ?? []).length === 2);

  const autolinkConfig = (enabled, platform) => {
    const result = spawnSync(
      path.join(ROOT, 'node_modules/.bin/expo-modules-autolinking'),
      ['react-native-config', '--platform', platform, '--json'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          EXPO_PUBLIC_WAFRA_LOCAL_AI_EVAL: enabled ? '1' : '0',
        },
      },
    );
    if (result.status !== 0) throw new Error(result.stderr || 'autolinking config failed');
    return JSON.parse(result.stdout);
  };
  for (const platform of ['android', 'ios']) {
    const ordinaryAutolinking = autolinkConfig(false, platform);
    const internalAutolinking = autolinkConfig(true, platform);
    ok(`ordinary ${platform} builds do not autolink the native model runtime`,
      !ordinaryAutolinking.dependencies?.['llama.rn']);
    ok(`internal ${platform} builds autolink the native model runtime`,
      !!internalAutolinking.dependencies?.['llama.rn']);
  }

  const app = JSON.parse(read('app.json'));
  const llamaPlugin = app.expo.plugins.find((entry) => Array.isArray(entry) && entry[0] === 'llama.rn');
  ok('Expo config enables the cross-platform runtime without experimental Android GPU paths',
    !!llamaPlugin && llamaPlugin[1].enableOpenCLAndHexagon === false &&
      app.expo.plugins.includes('expo-build-properties'));

  const expoConfig = (enabled) => {
    const result = spawnSync(
      path.join(ROOT, 'node_modules/.bin/expo'),
      ['config', '--type', 'prebuild', '--json'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'production',
          EAS_BUILD_PROFILE: enabled ? 'local-ai-preview' : 'production',
          EXPO_PUBLIC_WAFRA_LOCAL_AI_EVAL: enabled ? '1' : '0',
        },
      },
    );
    if (result.status !== 0) throw new Error(result.stderr || 'expo config failed');
    return JSON.parse(result.stdout);
  };
  const productionConfig = expoConfig(false);
  const internalConfig = expoConfig(true);
  const hasLlamaEntitlement = (config) =>
    config.ios?.entitlements?.['com.apple.developer.kernel.extended-virtual-addressing'] === true ||
    config.ios?.entitlements?.['com.apple.developer.kernel.increased-memory-limit'] === true;
  ok('ordinary production config does not inherit local-AI memory entitlements',
    !hasLlamaEntitlement(productionConfig));
  ok('the explicitly flagged internal build receives the local-AI memory entitlements',
    hasLlamaEntitlement(internalConfig));

  console.log(`\nlocal-ai: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
