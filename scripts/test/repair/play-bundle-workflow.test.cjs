const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const yaml = require('yaml');

const root = path.resolve(__dirname, '../../..');
const workflow = yaml.parse(fs.readFileSync(path.join(root, '.github/workflows/build-apk.yml'), 'utf8'));

test('Play build without its existing upload key stops before provisioning a disposable APK key', (t) => {
  const step = workflow.jobs.build.steps.find((entry) => entry.name === 'Configure release signing');
  assert.equal(step.env.PLAY_BUNDLE, '${{ inputs.bundle }}');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-play-signing-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  // Stop at the disposable-key branch without invoking a real keystore tool.
  fs.writeFileSync(path.join(temp, 'openssl'), '#!/bin/sh\nexit 57\n', { mode: 0o700 });
  function sign(bundle) {
    return spawnSync('bash', ['-c', step.run], {
      cwd: temp, encoding: 'utf8', env: { PATH: temp + path.delimiter + process.env.PATH,
        KEYSTORE_B64: '', KEYSTORE_PASSWORD: '', PLAY_BUNDLE: String(bundle) },
    });
  }
  const play = sign(true);
  assert.equal(play.status, 1);
  assert.match(play.stdout, /requires the existing WAFRA_KEYSTORE_B64 upload key/);
  assert.equal(sign(false).status, 57, 'sideload-only APK still takes the disposable-key branch');
});

test('only the Play workflow path configures and verifies the packaged update channel', () => {
  const channelSteps = workflow.jobs.build.steps.filter((step) => step.run?.includes('scripts/play-update-channel.cjs'));
  assert.equal(channelSteps.length, 2);
  assert.ok(channelSteps.every((step) => step.if === 'inputs.bundle && !inputs.corpus'));
  assert.match(channelSteps[0].run, /configure android\/app\/src\/main\/AndroidManifest\.xml/);
  assert.match(channelSteps[1].run, /dump manifest[\s\S]+app-release\.aab[\s\S]+play-update-channel\.cjs verify/);
});

test('Play manifest embeds the production channel and preserves unrelated request headers on reruns', async (t) => {
  const { AndroidConfig } = require('expo/config-plugins');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-play-update-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'AndroidManifest.xml');
  const key = AndroidConfig.Updates.Config.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY;
  fs.writeFileSync(file, `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:name=".MainApplication"><meta-data android:name="${key}"
    android:value="{&quot;x-other&quot;:&quot;keep&quot;,&quot;expo-channel-name&quot;:&quot;preview&quot;}"/></application>
  </manifest>`);
  const run = (mode) => spawnSync(process.execPath, [path.join(root, 'scripts/play-update-channel.cjs'), mode, file], { encoding: 'utf8' });
  assert.equal(run('verify').status, 1, 'a preview-channel release must fail the artifact check');
  for (let i = 0; i < 2; i++) assert.equal(run('configure').status, 0);
  assert.equal(run('verify').status, 0);
  const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(file);
  const entries = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest)['meta-data'].filter((entry) => entry.$['android:name'] === key);
  assert.equal(entries.length, 1);
  assert.deepEqual(JSON.parse(entries[0].$['android:value']), { 'x-other': 'keep', 'expo-channel-name': 'production' });
});
