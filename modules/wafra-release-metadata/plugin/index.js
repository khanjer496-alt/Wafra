function isDevelopmentBuild(profile, nodeEnv, profiles = require('../../../eas.json').build) {
  // Local Expo/Debug generation keeps discovery unless production is explicit.
  if (!profile) return nodeEnv !== 'production';
  const seen = new Set();
  let developmentClient, configuration;
  for (let name = profile; name;) {
    if (seen.has(name) || !profiles[name]) throw new Error(`Invalid EAS build profile ancestry: ${name}`);
    seen.add(name);
    const current = profiles[name];
    if (developmentClient === undefined && Object.hasOwn(current, 'developmentClient')) {
      developmentClient = current.developmentClient;
    }
    configuration ??= current.ios?.buildConfiguration;
    name = current.extends;
  }
  if (configuration === 'Debug') return true;
  if (configuration === 'Release') return false;
  return developmentClient === true;
}

function withReleaseMetadata(config, {enabled} = {}) {
  // Decided when prebuild applies the plugin, never from config options, so the
  // hashed config (and the expo-updates runtime fingerprint) is env-independent.
  if (enabled === undefined) enabled = !isDevelopmentBuild(process.env.EAS_BUILD_PROFILE, process.env.NODE_ENV);
  if (!enabled) return config;
  const {withBaseMod} = require('@expo/config-plugins');
  return withBaseMod(config, {
    platform: 'ios', mod: 'infoPlist',
    async action({modRequest: {nextMod, ...modRequest}, ...input}) {
      // withInfoPlist actions run before the next registered action. Await the
      // complete inner chain so the launcher's additions are present first.
      const result = await nextMod({...input, modRequest});
      const plist = result.modResults;
      if (Array.isArray(plist.NSBonjourServices)) {
        const services = plist.NSBonjourServices.filter(value => value !== '_expo._tcp');
        if (services.length) plist.NSBonjourServices = services;
        else delete plist.NSBonjourServices;
      }
      if (typeof plist.NSLocalNetworkUsageDescription === 'string' &&
          plist.NSLocalNetworkUsageDescription.includes('Expo Dev Launcher')) {
        delete plist.NSLocalNetworkUsageDescription;
      }
      return result;
    },
  });
}

module.exports = withReleaseMetadata;
module.exports.isDevelopmentBuild = isDevelopmentBuild;
