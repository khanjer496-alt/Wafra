module.exports = ({ config }) => {
  // Paged history is the shipping iOS transport. The old Shortcut crossed the
  // app boundary once per Message; this keeps native paging intents available
  // in every iOS build so Wafra can receive bounded batches and process them
  // locally.
  const pagedPlugin = './modules/wafra-message-history/plugin/paged';
  const plugins = config.plugins || [];
  const hasPagedPlugin = plugins.some((plugin) =>
    (Array.isArray(plugin) ? plugin[0] : plugin) === pagedPlugin,
  );
  const withPagedHistory = hasPagedPlugin
    ? config
    : { ...config, plugins: [...plugins, pagedPlugin] };

  // High-refresh capability must live in Expo config rather than only in the
  // generated native projects. Otherwise a clean EAS/prebuild can silently
  // restore the 60 Hz ceiling on iOS and drop Android's refresh preference.
  const highRefreshPlugin = './modules/wafra-high-refresh/plugin';
  const withPagedPlugins = withPagedHistory.plugins || [];
  const hasHighRefreshPlugin = withPagedPlugins.some((plugin) =>
    (Array.isArray(plugin) ? plugin[0] : plugin) === highRefreshPlugin,
  );
  const withNativePerformance = hasHighRefreshPlugin
    ? withPagedHistory
    : { ...withPagedHistory, plugins: [...withPagedPlugins, highRefreshPlugin] };

  // apple-targets derives CURRENT_PROJECT_VERSION from ios.buildNumber.
  // Use the literal local version before native generation; remote injection
  // after config evaluation cannot synchronize extension versions reliably.
  const buildNumber = config.ios?.buildNumber;
  if (typeof buildNumber !== 'string' || !/^[0-9]+(?:\.[0-9]+){0,2}$/.test(buildNumber)) {
    throw new Error('An explicit valid iOS host build number is required');
  }
  const releaseMetadataPlugin = './modules/wafra-release-metadata/plugin';
  const {isDevelopmentBuild} = require(releaseMetadataPlugin);
  const nativePlugins = (withNativePerformance.plugins || []).filter(plugin =>
    (Array.isArray(plugin) ? plugin[0] : plugin) !== releaseMetadataPlugin);
  // Register the normally automatic launcher before our final metadata mod;
  // its run-once history prevents the later legacy pass from reapplying it.
  if (!nativePlugins.some(plugin => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-dev-client')) {
    nativePlugins.push('expo-dev-client');
  }
  nativePlugins.push([releaseMetadataPlugin, {
    enabled: !isDevelopmentBuild(process.env.EAS_BUILD_PROFILE, process.env.NODE_ENV),
  }]);
  return { ...withNativePerformance, plugins: nativePlugins, ios: { ...withNativePerformance.ios, buildNumber } };
};
