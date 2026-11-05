const { AndroidConfig } = require('expo/config-plugins');
const { build } = require('../eas.json');

async function main(mode, file) {
  if (!file || !['configure', 'verify'].includes(mode)) {
    throw new Error('Usage: play-update-channel.cjs configure|verify AndroidManifest.xml');
  }
  if (build.production.channel !== 'production') {
    throw new Error('The Play bundle must use the production EAS Update channel.');
  }
  const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(file);
  const key = AndroidConfig.Updates.Config.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY;
  const raw = AndroidConfig.Manifest.getMainApplicationMetaDataValue(manifest, key);
  const headers = JSON.parse(raw ?? '{}');
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    throw new Error('Invalid expo-updates request headers in AndroidManifest.xml');
  }
  if (mode === 'verify') {
    if (headers['expo-channel-name'] !== build.production.channel) {
      throw new Error('Compiled Play bundle is missing its production EAS Update channel.');
    }
    console.log('Verified the production EAS Update channel in the compiled Play bundle.');
    return;
  }
  // Mirror EAS Build: change the generated native manifest, not shared Expo config.
  AndroidConfig.Manifest.addMetaDataItemToMainApplication(
    AndroidConfig.Manifest.getMainApplicationOrThrow(manifest), key,
    JSON.stringify({ ...headers, 'expo-channel-name': build.production.channel }),
  );
  await AndroidConfig.Manifest.writeAndroidManifestAsync(file, manifest);
}
main(...process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
